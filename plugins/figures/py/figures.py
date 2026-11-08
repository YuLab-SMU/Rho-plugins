# Semantic figures for a live Python session: figures drawn with matplotlib, and with what draws
# through it (seaborn, pandas .plot). The Notebook's runner runs this file in a namespace of its own
# and calls
#
#   describe_figure(figure, into, namespace, **saving)
#       after the figure's picture is written: writes the figure record (rho.figure/1) to `into`
#       and returns its summary, {'problem': why} when it could not, or None for an object this file
#       does not describe. `namespace` is the session's; `saving` holds the savefig arguments the
#       picture was written with (bbox_inches, pad_inches), so the record draws the same page.
#
# matplotlib keeps what each Axes drew as artists: a scatter's points as one collection with their
# offsets, a line with its vertices, each bar a rectangle, a heatmap a mesh of cells, a label with
# its text and position. Each artist is given an id for the drawing, the figure is written as SVG,
# and each element matplotlib wrote inside that artist's group is named after the marks it stands
# for (data-rho="unit.element"). Where the elements cannot be matched to the artist's marks one for
# one, the layer says why and nothing is guessed.
#
# A mark keeps the values it was drawn at, in the data's units (a log axis is read in counts). Points,
# lines and labels whose x and y are two columns of a table in the session (a pandas DataFrame, a
# numeric Series with its index, a 2-D numeric array) are bound to its rows, value for value and in
# the table's order; rows that were not drawn are skipped. A position drawn from a column through a
# common transform (-log10, log10, log2, log2(x + 1), log1p) is matched through it, and the layer's
# mapping says so. A label that names rows of a table another layer of the same plot is bound to is
# bound by its text. A heatmap's cells name their row, column and value, and the row of the session
# table drawn when one holds the same values.
#
# A describer never changes the session: the ids it gives artists are taken back, and its output and
# warnings are discarded. The protected resources are the session's time and the state folder: it
# stops after maxSeconds, refuses more than maxMarks marks and writes no record over maxBytes.
import contextlib, io, json, math, os, platform, re, sys, time, uuid, warnings
import xml.etree.ElementTree as ET

limits = {'maxMarks': 30000, 'maxSeconds': 20, 'maxBytes': 16 * 1024 * 1024, 'maxColumns': 40,
          'maxTables': 64, 'maxTableCells': 5000000, 'maxComparedColumns': 64, 'maxCellChars': 160}
schema = 'rho.figure/1'
SVG, XLINK = 'http://www.w3.org/2000/svg', 'http://www.w3.org/1999/xlink'
drawn_tags = {'path', 'use', 'text', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'image'}
hidden_tags = {'defs', 'clipPath', 'mask', 'pattern', 'marker', 'metadata', 'style', 'title', 'desc', 'symbol'}

class Late(Exception): pass

def _np():
    import numpy
    return numpy

def clip(text, n=None):
    n = n or limits['maxCellChars']
    text = str(text)
    return text if len(text) <= n else text[:n - 1] + '…'

def num(v):
    try: v = float(v)
    except (TypeError, ValueError): return None
    return float('%.7g' % v) if math.isfinite(v) else None

def hex_colour(rgba):
    try:
        r, g, b = (max(0, min(255, int(round(float(c) * 255)))) for c in list(rgba)[:3])
        return '#%02x%02x%02x' % (r, g, b)
    except Exception: return None

# A column as the record keeps it: numbers to 7 significant digits, missing values as null, text cut.
def column(name, values):
    np = _np()
    arr = values if isinstance(values, np.ndarray) else np.asarray(list(values), dtype=object)
    kind = arr.dtype.kind
    if kind == 'b': return {'name': name, 'type': 'logical', 'values': [bool(v) for v in arr]}
    if kind in 'iu': return {'name': name, 'type': 'integer', 'values': [int(v) for v in arr]}
    if kind == 'f': return {'name': name, 'type': 'number', 'values': [num(v) for v in arr]}
    missing = lambda v: v is None or (isinstance(v, float) and math.isnan(v))
    present = [v for v in arr if not missing(v)]
    if present and all(isinstance(v, (bool, np.bool_)) for v in present):
        return {'name': name, 'type': 'logical', 'values': [None if missing(v) else bool(v) for v in arr]}
    if present and all(isinstance(v, (int, float, np.integer, np.floating)) and not isinstance(v, (bool, np.bool_)) for v in present):
        return {'name': name, 'type': 'number', 'values': [None if missing(v) else num(v) for v in arr]}
    return {'name': name, 'type': 'text', 'values': [None if missing(v) else clip(v) for v in arr]}

# Tables -------------------------------------------------------------------------------------------
# A table of the session, read only for the columns a comparison asks for.
class Table:
    def __init__(self, name, rows, names, get, index=None, index_name=None):
        self.name, self.rows, self.names, self.get = name, rows, names, get
        self.index, self.index_name, self.cache = index, index_name, {}
    def values(self, column):
        if column not in self.cache:
            self.cache[column] = self.index if column == '.index' else self.get(column)
        return self.cache[column]
    def numeric(self):
        np = _np()
        out = [c for c in self.names[:4 * limits['maxComparedColumns']] if getattr(self.values(c), 'dtype', None) is not None and self.values(c).dtype.kind in 'iuf'][:limits['maxComparedColumns']]
        if self.index is not None and self.index.dtype.kind in 'iuf': out.append('.index')
        return out
    # The column that names each row once: a text index, else a unique text column, else a unique
    # numeric id column.
    def key(self):
        np = _np()
        unique = lambda v: len(v) == len(set(v.tolist())) and not any(x is None or (isinstance(x, float) and math.isnan(x)) for x in v.tolist())
        if self.index is not None and self.index.dtype.kind in 'OUS' and unique(self.index): return self.index_name
        for c in self.names:
            v = self.values(c)
            if v.dtype.kind in 'OUS' and unique(v): return c
        for c in self.names:
            v = self.values(c)
            if v.dtype.kind in 'iu' and re.match(r'^(node|id|.*[._]id|ID)$', c) and unique(v): return c
        return None
    def source(self, rows):
        np = _np()
        rows = np.asarray(sorted(set(int(r) for r in rows)), dtype=np.int64)
        key = self.key()
        names = [c for c in self.names][:limits['maxColumns']]
        cols = [column(c, self.values(c)[rows]) for c in names]
        if self.index is not None and (self.index.dtype.kind in 'OUS' or self.index_name != '.rownames'):
            cols.insert(0, column(self.index_name, self.index[rows]))
        return {'id': self.name, 'rows': int(self.rows), 'columnsTotal': len(self.names), 'key': key, 'index': [int(r) for r in rows], 'columns': cols}

def series_values(series):
    np, pd = _np(), sys.modules.get('pandas')
    try:
        if pd is not None:
            if isinstance(series.dtype, pd.CategoricalDtype): return series.astype(object).to_numpy()
            if pd.api.types.is_datetime64_any_dtype(series) or pd.api.types.is_timedelta64_dtype(series): return series.astype(str).to_numpy()
            if pd.api.types.is_extension_array_dtype(series):
                if pd.api.types.is_numeric_dtype(series) and not pd.api.types.is_bool_dtype(series): return series.to_numpy(dtype=float, na_value=np.nan)
                return series.to_numpy(dtype=object, na_value=None)
        return series.to_numpy()
    except Exception: return np.asarray(series, dtype=object)

def as_table(name, value):
    np, pd = _np(), sys.modules.get('pandas')
    if pd is not None and isinstance(value, pd.DataFrame):
        if not len(value) or value.size > limits['maxTableCells']: return None
        labels, seen = [], set()
        for i, c in enumerate(value.columns):
            text = c if isinstance(c, str) else ' '.join(map(str, c)) if isinstance(c, tuple) else str(c)
            if text in seen: continue
            seen.add(text); labels.append((text, i))
        at = dict(labels)
        index = value.index
        index_name = index.name if isinstance(index.name, str) and index.name not in at else '.rownames'
        return Table(name, len(value), [t for t, _ in labels], lambda c: series_values(value.iloc[:, at[c]]), series_values(index.to_series()) if index.nlevels == 1 else None, index_name)
    if pd is not None and isinstance(value, pd.Series):
        if not len(value) or len(value) > limits['maxTableCells'] or not value.index.is_unique or not pd.api.types.is_numeric_dtype(value): return None
        label = value.name if isinstance(value.name, str) else 'value'
        index_name = value.index.name if isinstance(value.index.name, str) and value.index.name != label else '.rownames'
        return Table(name, len(value), [label], lambda c: series_values(value), series_values(value.index.to_series()), index_name)
    if isinstance(value, np.ndarray) and value.ndim == 2 and value.dtype.kind in 'iuf' and 0 < value.size <= limits['maxTableCells']:
        return Table(name, value.shape[0], [str(j) for j in range(value.shape[1])], lambda c: value[:, int(c)])
    return None

# The tables the cell's code names come first: a figure is bound to what its code drew from.
def session_tables(namespace, prefer=()):
    out = []
    first = [n for n in prefer if n in namespace]
    for name, value in [(n, namespace[n]) for n in first] + [(n, v) for n, v in list(namespace.items()) if n not in first]:
        if len(out) >= limits['maxTables']: break
        if name.startswith('_'): continue
        try: t = as_table(name, value)
        except Exception: t = None
        if t is not None: out.append(t)
    return out

# A drawn position matches a column through one of these, in this order.
def transforms(np):
    return [('{}', lambda v: v), ('-log10({})', lambda v: -np.log10(v)), ('log10({})', np.log10), ('log2({})', np.log2),
            ('log2({} + 1)', lambda v: np.log2(v + 1)), ('log1p({})', np.log1p)]

# Equal, or within 1e-9 of each other relative to their size. A value that is not finite matches only
# itself: -log10(0) is inf, and inf is not near every number.
def near(a, b):
    np = _np()
    with np.errstate(all='ignore'):
        return (a == b) | (np.isfinite(a) & np.isfinite(b) & (np.abs(a - b) <= 1e-9 * np.maximum(np.abs(a), np.abs(b))))

# The rows of a column, in order, whose values are the drawn ones; rows that were not drawn are
# skipped. None when the drawn values are not the column's.
def rows_of(drawn, col, u=None):
    np = _np()
    n = len(drawn)
    if u is None: u = np.unique(drawn)
    j = np.searchsorted(u, col)
    member = near(col, u[np.clip(j - 1, 0, len(u) - 1)]) | near(col, u[np.clip(j, 0, len(u) - 1)])
    kept = np.flatnonzero(member)
    if len(kept) < n: return None
    if len(kept) == n: return kept if near(col[kept], drawn).all() else None
    values = col[kept]
    if len(np.unique(values)) == len(values):
        order = np.argsort(values, kind='stable')
        at = np.clip(np.searchsorted(values[order], drawn), 0, len(values) - 1)
        lower = np.clip(at - 1, 0, len(values) - 1)
        pick = np.where(near(values[order][at], drawn), at, lower)
        rows = kept[order[pick]]
        return rows if near(col[rows], drawn).all() and (np.diff(rows) > 0).all() else None
    if len(kept) > 200000: return None
    out, k = [], 0
    for r, v in zip(kept.tolist(), values.tolist()):
        d = drawn[k]
        if v == d or (math.isfinite(v) and abs(v - d) <= 1e-9 * max(abs(v), abs(d))):
            out.append(r); k += 1
            if k == n: break
    return np.asarray(out, dtype=np.int64) if k == n else None

def match_table(cols, tables, deadline):
    np = _np()
    x, y = cols['x'], cols['y']
    n = len(x)
    if n < 3: return None
    best = None
    every = transforms(np)
    unique = {a: np.unique(cols[a]) for a in ('x', 'y')}
    for allowed in (every[:1], every):
        # A table with fewer rows than the marks drawn cannot hold them.
        for t in [t for t in tables if t.rows >= n]:
            numeric = t.numeric()
            with np.errstate(all='ignore'):
                for a, b in (('x', 'y'), ('y', 'x')):
                    for cn in numeric:
                        for name, f in allowed:
                            if time.monotonic() > deadline: raise Late()
                            source = np.asarray(t.values(cn), dtype=float)
                            rows = rows_of(cols[a], f(source), unique[a])
                            if rows is None: continue
                            fit, how = -1, None
                            for c2 in numeric:
                                v2 = np.asarray(t.values(c2), dtype=float)[rows]
                                for name2, f2 in every:
                                    k = int(near(f2(v2), cols[b]).sum())
                                    if k > fit: fit, how = k, (c2, name2)
                                    if fit == n: break
                                if fit == n: break
                            label = lambda c, form: form.format('row' if c == '.index' else c)
                            if fit < 0.99 * n:
                                # Marks all drawn at one value of the other axis (genes not tested, drawn
                                # at 0) are bound by this axis alone, where it names each row once.
                                drawn = f(source)[rows]
                                if np.ptp(cols[b]) == 0 and len(np.unique(drawn)) >= max(3, n / 2):
                                    found = {'table': t, 'rows': rows, 'differ': n, 'other': b, 'at': float(cols[b][0]), 'mapping': {a: label(cn, name)}}
                                    if best is None: best = found
                                continue
                            found = {'table': t, 'rows': rows, 'differ': n - fit, 'other': b,
                                     'mapping': {a: label(cn, name), b: label(how[0], how[1])}, 'how': {a: (cn, name), b: how}}
                            if best is None or found['differ'] < best['differ'] or (found['differ'] == best['differ'] and best['table'].key() is None and t.key() is not None and 'at' not in best): best = found
                            if best['differ'] == 0: break
                        if best and best['differ'] == 0: break
                    if best and best['differ'] == 0: break
            if best and best['differ'] == 0: break
        if best: break
    if best: best['mapping'] = {k: best['mapping'][k] for k in ('x', 'y') if k in best['mapping']}
    return best

# The row of a table each drawn position is, through the columns and transforms a layer was bound by;
# None unless every position is exactly one row.
def look_up(xs, ys, table, how):
    np = _np()
    if len(xs) > 500: return None
    f = dict(transforms(np))
    with np.errstate(all='ignore'):
        X = f[how['x'][1]](np.asarray(table.values(how['x'][0]), dtype=float))
        Y = f[how['y'][1]](np.asarray(table.values(how['y'][0]), dtype=float))
        rows = []
        for x, y in zip(xs, ys):
            hit = np.flatnonzero(near(X, x) & near(Y, y))
            if len(hit) != 1: return None
            rows.append(int(hit[0]))
    return np.asarray(rows, dtype=np.int64)

# Labels whose texts name rows of a table: its key, or another column whose values are unique.
def match_labels(labels, tables):
    np = _np()
    texts = [str(v).strip() for v in labels]
    if not texts or any(not t for t in texts): return None
    for t in tables:
        names = ([t.index_name] if t.index is not None and t.index.dtype.kind in 'OUS' else []) + [c for c in t.names if t.values(c).dtype.kind in 'OUS']
        for c in names:
            values = (t.index if c == t.index_name and t.index is not None else t.values(c)).tolist()
            where = {}
            for i, v in enumerate(values):
                if isinstance(v, str): where.setdefault(v.strip(), []).append(i)
            if all(len(where.get(x, ())) == 1 for x in texts):
                return {'table': t, 'rows': np.asarray([where[x][0] for x in texts], dtype=np.int64), 'mapping': {'label': 'row' if c == '.rownames' else c}}
    return None

# Artists --------------------------------------------------------------------------------------------
# Each artist drawn is a unit: an id is set on it for the drawing, and the elements matplotlib writes
# in its group are named after its marks. `spec` says how: 'each' (element i is mark i), 'all' (every
# element stands for all its marks) or 'line' (a line through all marks, then one marker per mark).
class Layer:
    def __init__(self, plot, kind, **columns):
        self.plot, self.kind, self.columns, self.units = plot, kind, {k: v for k, v in columns.items() if v is not None}, []
        self.group, self.reasons, self.mapping, self.source, self.rows, self.notes = None, [], {}, None, None, []
    @property
    def n(self): return len(next(iter(self.columns.values()))) if self.columns else 0

def same(a, b):
    return a is b or a == b

def finite_rows(np, *arrays):
    keep = np.ones(len(arrays[0]), dtype=bool)
    for a in arrays: keep &= np.isfinite(a)
    return keep

def to_data(ax, transform, xy):
    np = _np()
    if same(transform, ax.transData): return xy
    return ax.transData.inverted().transform(transform.transform(xy))

def colours(np, values, n):
    values = np.asarray(values)
    if values.ndim != 2 or not len(values): return None
    return [hex_colour(values[i % len(values)]) for i in range(n)]

def collection_layer(ax, k, coll):
    np = _np()
    import matplotlib.collections as mc
    paths = coll.get_paths()
    offsets = np.ma.filled(np.ma.asarray(coll.get_offsets(), dtype=float), np.nan).reshape(-1, 2)
    by_offset = len(offsets) > 1 or (len(offsets) == 1 and len(paths) <= 1 and not np.allclose(offsets, 0))
    if isinstance(coll, mc.QuadMesh): return mesh_layer(ax, k, coll)
    if by_offset:
        trf = coll.get_offset_transform()
        shown = trf.transform(offsets)
        keep = np.isfinite(shown).all(axis=1)
        xy = to_data(ax, trf, offsets[keep])
        n = int(keep.sum())
        idx = np.flatnonzero(keep)
        fc = colours(np, coll.get_facecolors(), len(offsets))
        sizes = np.asarray(coll.get_sizes(), dtype=float) if hasattr(coll, 'get_sizes') else np.asarray([])
        value = coll.get_array()
        value = np.ma.filled(np.ma.asarray(value, dtype=float), np.nan).ravel() if value is not None and np.size(value) == len(offsets) else None
        kind = 'points' if isinstance(coll, mc.PathCollection) else 'polygon'
        layer = Layer(k, kind, x=np.asarray(xy[:, 0], dtype=float), y=np.asarray(xy[:, 1], dtype=float),
                      value=value[idx] if value is not None else None,
                      colour=[fc[i] for i in idx] if fc else None,
                      size=np.asarray([sizes[i % len(sizes)] for i in idx], dtype=float) if len(sizes) else None)
        layer.units.append((coll, 'each', list(range(n))))
        return layer
    # A collection of paths (segments, polygons) without offsets: each path is a mark.
    trf = coll.get_transform()
    ext = []
    for p in paths:
        v = np.asarray(p.vertices, dtype=float)
        v = to_data(ax, trf, v) if len(v) else v
        ext.append(v)
    two = all(len(v) == 2 for v in ext)
    value = coll.get_array()
    value = np.ma.filled(np.ma.asarray(value, dtype=float), np.nan).ravel() if value is not None and np.size(value) == len(paths) else None
    fc = colours(np, coll.get_facecolors(), len(paths)) if not isinstance(coll, mc.LineCollection) else colours(np, coll.get_edgecolors(), len(paths))
    pick = lambda f: np.asarray([f(v) if len(v) else np.nan for v in ext], dtype=float)
    with np.errstate(all='ignore'), warnings.catch_warnings():
        warnings.simplefilter('ignore')
        if two: layer = Layer(k, 'segments', x=pick(lambda v: v[0, 0]), y=pick(lambda v: v[0, 1]), xend=pick(lambda v: v[1, 0]), yend=pick(lambda v: v[1, 1]), value=value, colour=fc)
        else: layer = Layer(k, 'lines' if isinstance(coll, mc.LineCollection) else 'polygon', xmin=pick(lambda v: np.nanmin(v[:, 0])), xmax=pick(lambda v: np.nanmax(v[:, 0])), ymin=pick(lambda v: np.nanmin(v[:, 1])), ymax=pick(lambda v: np.nanmax(v[:, 1])), value=value, colour=fc)
    layer.units.append((coll, 'each', list(range(len(paths)))))
    return layer

# Tick labels drawn at each position of an axis, when they name categories rather than numbers.
def tick_names(ax, axis):
    locator = type((ax.xaxis if axis == 'x' else ax.yaxis).get_major_locator()).__name__
    if locator not in ('FixedLocator', 'StrCategoryLocator'): return {}
    try:
        locs = list((ax.get_xticks if axis == 'x' else ax.get_yticks)())
        texts = [t.get_text() for t in (ax.get_xticklabels if axis == 'x' else ax.get_yticklabels)()]
    except Exception: return {}
    if len(locs) != len(texts) or not texts: return {}
    numeric = re.compile(r'^[\s−\-+]*[\d.,]+(e[−\-+]?\d+)?%?\s*$', re.I)
    if all(not t or numeric.match(t) or t.startswith('$') for t in texts): return {}
    return {float(l): t for l, t in zip(locs, texts) if t}

def named_at(names, values):
    out = []
    for v in values:
        hit = [t for l, t in names.items() if abs(l - v) <= 1e-9 * max(1.0, abs(v))]
        out.append(hit[0] if len(hit) == 1 else None)
    return out

def mesh_layer(ax, k, mesh):
    np = _np()
    array = mesh.get_array()
    coords = np.asarray(mesh.get_coordinates(), dtype=float)
    r, c = coords.shape[0] - 1, coords.shape[1] - 1
    values = np.ma.filled(np.ma.asarray(array, dtype=float), np.nan).reshape(-1) if array is not None else None
    if values is None or len(values) != r * c:
        layer = Layer(k, 'heatmap'); layer.reasons.append('Its cells have no values.'); return layer
    grid = values.reshape(r, c)
    cy, cx = (coords[:-1, :-1, 1] + coords[1:, 1:, 1]) / 2, (coords[:-1, :-1, 0] + coords[1:, 1:, 0]) / 2
    layer = Layer(k, 'heatmap', value=grid.reshape(-1))
    # Tick labels name the rows (columns) whose middles they sit at. Labels set on the cells' edges
    # instead, one for each, are read in their order when that names every row once, and noted.
    def names(axis, middle, low, high, word):
        ticks = tick_names(ax, axis)
        at = named_at(ticks, middle)
        if any(at) or len(ticks) != len(middle): return at
        for edge in (low, high):
            moved = named_at(ticks, edge)
            if all(moved) and len(set(moved)) == len(moved):
                layer.notes.append('Its %s labels sit on the %ss\' edges, not their middles; label k is read as naming %s k.' % (word, word, word))
                return moved
        return at
    rows_named = names('y', cy[:, 0], coords[:-1, 0, 1], coords[1:, 0, 1], 'row')
    cols_named = names('x', cx[0, :], coords[0, :-1, 0], coords[0, 1:, 0], 'column')
    layer.grid, layer.ticks = grid, (rows_named, cols_named)
    layer.units.append((mesh, 'each', list(range(r * c))))
    return layer

# Rows and columns of a session table holding the heatmap's values: the same table, or the same
# values with rows and columns reordered (a clustered heatmap).
def match_grid(grid, tables):
    np = _np()
    r, c = grid.shape
    def equal(a, b): return bool(((a == b) | (np.isnan(a) & np.isnan(b)) | near(a, b)).all())
    for t in tables:
        if t.rows != r or len(t.names) < c: continue
        numeric = [n for n in t.names if t.values(n).dtype.kind in 'iuf']
        if len(numeric) != c: continue
        m = np.column_stack([np.asarray(t.values(n), dtype=float) for n in numeric])
        if equal(m, grid): return t, list(range(r)), numeric
        # Columns by their sorted values, then rows by their values in that order.
        order = []
        for j in range(c):
            target = np.sort(grid[:, j])
            hit = [n for i, n in enumerate(numeric) if n not in order and equal(np.sort(m[:, i]), target)]
            if not hit: break
            order.append(hit[0])
        if len(order) != c: continue
        m2 = np.column_stack([np.asarray(t.values(n), dtype=float) for n in order])
        keys = {}
        for i, row in enumerate(m2): keys.setdefault(tuple(np.round(row, 9).tolist()), []).append(i)
        rows = []
        for row in grid:
            hit = keys.get(tuple(np.round(row, 9).tolist()), [])
            if len(hit) != 1: break
            rows.append(hit[0])
        if len(rows) == r and len(set(rows)) == r: return t, rows, order
    return None

# Row labels drawn beside a heatmap that name other rows of its table than the values they sit beside.
# A label is looked up in the table's index and text columns; the one naming most labels is used. A
# label found nowhere says nothing.
def mislabelled(t, rows, labels):
    if not any(labels): return None
    names = ([t.index_name] if t.index is not None and t.index.dtype.kind in 'OUS' else []) + [c for c in t.names if t.values(c).dtype.kind in 'OUS']
    best = None
    for c in names:
        values = (t.index if c == t.index_name and t.index is not None else t.values(c)).tolist()
        where = {}
        for i, v in enumerate(values):
            if isinstance(v, str): where.setdefault(v, []).append(i)
        found = [(i, where[l]) for i, l in enumerate(labels) if l and len(where.get(l, ())) == 1]
        if found and (best is None or len(found) > len(best[1])): best = (c, found, values)
    if not best: return None
    c, found, values = best
    wrong = [(i, at[0]) for i, at in found if at[0] != rows[i]]
    if not wrong: return None
    i, other = wrong[0]
    return '%d of %d rows are labelled with another row of %s: row %d is labelled %s and draws the values of %s.' % (
        len(wrong), len(found), t.name, i + 1, labels[i], values[rows[i]])

def distinct(names):
    seen, out = {}, []
    for n in names:
        seen[n] = seen.get(n, 0) + 1
        out.append(n if seen[n] == 1 else '%s (%d)' % (n, seen[n]))
    return out

def fill_heatmap(layer, tables, name):
    np = _np()
    grid, (rows_named, cols_named) = layer.grid, layer.ticks
    r, c = grid.shape
    found = match_grid(grid, tables)
    if found:
        t, rows, order = found
        index = t.index.tolist() if t.index is not None and t.index.dtype.kind in 'OUS' else None
        row_names = [str(index[i]) if index else (rows_named[i] or str(i + 1)) for i in rows]
        col_names = list(order)
        layer.source, layer.table, layer.rows = t.name, t, np.repeat(np.asarray(rows, dtype=np.int64), c)
        wrong = mislabelled(t, rows, rows_named)
        if wrong: layer.notes.append(wrong)
    else:
        row_names = [rows_named[i] or str(i + 1) for i in range(r)]
        col_names = distinct([cols_named[j] or str(j + 1) for j in range(c)])
        t = Table(name, r, col_names, lambda n: grid[:, col_names.index(n)], np.asarray(row_names, dtype=object), 'row')
        layer.source, layer.table, layer.rows = name, t, np.repeat(np.arange(r, dtype=np.int64), c)
    layer.columns = {'row': np.asarray([row_names[i] for i in range(r) for _ in range(c)], dtype=object),
                     'column': np.asarray([col_names[j] for _ in range(r) for j in range(c)], dtype=object),
                     'value': grid.reshape(-1)}
    layer.mapping = {'x': 'column', 'y': 'row', 'fill': 'value'}

def line_kind(ax, line):
    trf = line.get_transform()
    if same(trf, ax.transData): return 'lines'
    if same(trf, ax.get_yaxis_transform(which='grid')): return 'hline'
    if same(trf, ax.get_xaxis_transform(which='grid')): return 'vline'
    return None

def line_layers(ax, k):
    np = _np()
    from matplotlib.colors import to_rgba
    out, run, key = [], [], None
    def style(line, kind):
        return (kind, str(line.get_color()), str(line.get_linestyle()), str(line.get_marker()), float(line.get_linewidth()))
    lines = [l for l in ax.get_lines() if l.get_visible()]
    for line in lines:
        kind = line_kind(ax, line)
        s = style(line, kind)
        if run and s != key: out.append(run); run = []
        run.append((line, kind)); key = s
    if run: out.append(run)
    layers = []
    for run in out:
        kind = run[0][1]
        if kind is None:
            layer = Layer(k, 'lines'); layer.reasons.append('It is drawn in coordinates other than the data\'s.')
            for line, _ in run: layer.units.append((line, 'none', 0))
            layers.append(layer); continue
        if kind in ('hline', 'vline'):
            name = 'yintercept' if kind == 'hline' else 'xintercept'
            vals = np.asarray([float(np.asarray(l.get_ydata() if kind == 'hline' else l.get_xdata(), dtype=float)[0]) for l, _ in run])
            layer = Layer(k, 'abline', **{name: vals, 'colour': [hex_colour(to_rgba(l.get_color())) for l, _ in run]})
            for i, (line, _) in enumerate(run): layer.units.append((line, 'all', [i]))
            layers.append(layer); continue
        xs, ys, groups, units, start = [], [], [], [], 0
        for g, (line, _) in enumerate(run):
            xy = np.asarray(line.get_xydata(), dtype=float).reshape(-1, 2)
            keep = finite_rows(np, xy[:, 0], xy[:, 1])
            xy = xy[keep]
            xs.append(xy[:, 0]); ys.append(xy[:, 1]); groups.append(np.full(len(xy), g + 1))
            marks = list(range(start, start + len(xy))); start += len(xy)
            drawn_line = str(line.get_linestyle()) not in ('None', '', ' ', 'none') and line.get_linewidth() > 0
            markers = str(line.get_marker()) not in ('None', '', ' ', 'none') and line.get_markersize() > 0 and line.get_markevery() is None
            units.append((line, 'line' if drawn_line and markers else 'all' if drawn_line else 'each' if markers else 'none', marks))
        geom = 'points' if all(u[1] == 'each' for u in units) else 'lines'
        layer = Layer(k, geom, x=np.concatenate(xs), y=np.concatenate(ys))
        layer.group = np.concatenate(groups) if geom == 'lines' else None
        colour = run[0][0].get_color()
        layer.constant = {'colour': hex_colour(to_rgba(colour))}
        layer.units.extend(units)
        layers.append(layer)
    return layers

def patch_extent(ax, patch):
    np = _np()
    v = np.asarray(patch.get_path().vertices, dtype=float)
    if not len(v): return [np.nan] * 4
    # A bar's rectangle is placed in data coordinates by its own transform: read them there, exactly.
    if same(patch.get_data_transform(), ax.transData): d = patch.get_patch_transform().transform(v)
    else: d = ax.transData.inverted().transform(patch.get_transform().transform(v))
    with warnings.catch_warnings():
        warnings.simplefilter('ignore')
        return [float(np.nanmin(d[:, 0])), float(np.nanmax(d[:, 0])), float(np.nanmin(d[:, 1])), float(np.nanmax(d[:, 1]))]

def patch_layers(ax, k):
    np = _np()
    import matplotlib.patches as mp, matplotlib.container as mcont
    layers, taken = [], set()
    xnames, ynames = tick_names(ax, 'x'), tick_names(ax, 'y')
    for cont in ax.containers:
        if not isinstance(cont, mcont.BarContainer): continue
        patches = [p for p in cont.patches if p.get_visible()]
        if not patches: continue
        taken.update(id(p) for p in patches)
        ext = np.asarray([patch_extent(ax, p) for p in patches], dtype=float)
        horizontal = getattr(cont, 'orientation', 'vertical') == 'horizontal'
        middle = (ext[:, 2] + ext[:, 3]) / 2 if horizontal else (ext[:, 0] + ext[:, 1]) / 2
        label = named_at(ynames if horizontal else xnames, middle)
        layer = Layer(k, 'rect', xmin=ext[:, 0], xmax=ext[:, 1], ymin=ext[:, 2], ymax=ext[:, 3],
                      label=np.asarray(label, dtype=object) if any(label) else None,
                      fill=[hex_colour(p.get_facecolor()) for p in patches])
        cl = cont.get_label()
        if isinstance(cl, str) and cl and not cl.startswith('_'): layer.series = cl
        for i, p in enumerate(patches): layer.units.append((p, 'all', [i]))
        layers.append(layer)
    rest = [p for p in ax.patches if p.get_visible() and id(p) not in taken]
    for kind in ('rect', 'polygon'):
        mine = [p for p in rest if isinstance(p, mp.Rectangle) == (kind == 'rect')]
        if not mine: continue
        ext = np.asarray([patch_extent(ax, p) for p in mine], dtype=float)
        layer = Layer(k, kind, xmin=ext[:, 0], xmax=ext[:, 1], ymin=ext[:, 2], ymax=ext[:, 3], fill=[hex_colour(p.get_facecolor()) for p in mine])
        for i, p in enumerate(mine): layer.units.append((p, 'all', [i]))
        layers.append(layer)
    return layers

# Texts at data positions (labels of points) are one layer; texts placed in the axes' own
# coordinates (a note in a corner) are another, with no position in the data.
def text_layers(ax, k):
    np = _np()
    import matplotlib.text as mt
    placed, other = [], []
    for t in ax.texts:
        if not t.get_visible() or not t.get_text().strip(): continue
        if isinstance(t, mt.Annotation) and t.xycoords == 'data': placed.append((t, tuple(float(v) for v in t.xy)))
        elif same(t.get_transform(), ax.transData): placed.append((t, tuple(float(v) for v in t.get_position())))
        else: other.append(t)
    layers = []
    if placed:
        layer = Layer(k, 'text', x=np.asarray([p[1][0] for p in placed], dtype=float), y=np.asarray([p[1][1] for p in placed], dtype=float),
                      label=np.asarray([p[0].get_text() for p in placed], dtype=object))
        for i, (t, _) in enumerate(placed): layer.units.append((t, 'all', [i]))
        layers.append(layer)
    if other:
        layer = Layer(k, 'text', label=np.asarray([t.get_text() for t in other], dtype=object))
        for i, t in enumerate(other): layer.units.append((t, 'all', [i]))
        layers.append(layer)
    return layers

# Plots ----------------------------------------------------------------------------------------------
def legend_scale(ax):
    from matplotlib.colors import to_rgba
    leg = ax.get_legend()
    if leg is None: return None
    handles = getattr(leg, 'legend_handles', None) or getattr(leg, 'legendHandles', None) or []
    def colour(h):
        for getter in ('get_color', 'get_facecolor'):
            try:
                c = getattr(h, getter)()
                c = c[0] if hasattr(c, '__len__') and len(c) and hasattr(c[0], '__len__') else c
                return hex_colour(to_rgba(c))
            except Exception: continue
        return None
    return {'aesthetic': 'colour', 'title': leg.get_title().get_text(), 'breaks': [t.get_text() for t in leg.get_texts()], 'values': [colour(h) or '' for h in handles][:len(leg.get_texts())]}

def facets_of(title):
    out = {}
    for part in title.split(' | '):
        m = re.match(r'^\s*(.+?)\s*=\s*(.+?)\s*$', part)
        if not m: return {}
        out[m.group(1)] = m.group(2)
    return out

def position(ax, axis):
    lim = (ax.get_xlim if axis == 'x' else ax.get_ylim)()
    out = {'discrete': False, 'range': [num(lim[0]), num(lim[1])]}
    scale = (ax.get_xscale if axis == 'x' else ax.get_yscale)()
    if scale == 'log': out['transform'] = 'log-10'
    elif scale != 'linear': out['transform'] = scale
    names = tick_names(ax, axis)
    if names: out = {'discrete': True, 'levels': list(names.values())}
    return out

# The SVG ----------------------------------------------------------------------------------------------
def leaves(node, token):
    out = []
    for child in node:
        tag = child.tag.rsplit('}', 1)[-1]
        if tag in hidden_tags: continue
        if tag == 'g' and (child.get('id') or '').startswith(token): continue
        if tag in drawn_tags: out.append(child)
        else: out.extend(leaves(child, token))
    return out

def tag_svg(text, token, units):
    ET.register_namespace('', SVG); ET.register_namespace('xlink', XLINK)
    root = ET.fromstring(text)
    for parent in list(root.iter()):
        for child in list(parent):
            if child.tag in ('{%s}metadata' % SVG, '{%s}style' % SVG): parent.remove(child)
    # matplotlib's sheet sets these on every element; on the root they are inherited instead, and a
    # sheet in an inline SVG would reach the rest of the page.
    root.set('style', 'stroke-linejoin: round; stroke-linecap: butt')
    root.attrib.pop('width', None); root.attrib.pop('height', None)
    groups = {g.get('id'): g for g in root.iter('{%s}g' % SVG) if (g.get('id') or '').startswith(token)}
    named, lost = {}, {}
    for u, (layer_i, artist, spec, marks) in enumerate(units):
        g = groups.get('%s-%d' % (token, u))
        if g is None:
            if spec != 'none': lost[u] = 'It was not drawn.'
            continue
        g.attrib.pop('id', None)
        els = leaves(g, token)
        if spec == 'none' or not els: continue
        if spec == 'each':
            if len(els) != len(marks): lost[u] = 'Its %d marks were drawn as %d elements; they are not matched.' % (len(marks), len(els)); continue
            each = [[m] for m in marks]
        elif spec == 'all': each = [list(marks)] * len(els)
        elif spec == 'line':
            if len(els) == len(marks) + 1: each = [list(marks)] + [[m] for m in marks]
            elif len(els) == len(marks): each = [[m] for m in marks]
            else: lost[u] = 'Its %d markers were drawn as %d elements; they are not matched.' % (len(marks), len(els) - 1); continue
        uses = [e for e in els if e.tag == '{%s}use' % SVG]
        if uses:
            # A marker's shape is defined once and used for each point; its own stroke would hide
            # the highlight a selection puts on the use.
            for d in g.iter('{%s}defs' % SVG):
                for p in d: p.attrib.pop('style', None)
        for e_i, el in enumerate(els): el.set('data-rho', '%d.%d' % (u, e_i))
        named[u] = each
    return ET.tostring(root, encoding='unicode'), named, lost

# Describing -----------------------------------------------------------------------------------------
def describe(fig, namespace, saving, deadline, prefer=()):
    np = _np()
    import matplotlib
    axes = [ax for ax in fig.get_axes() if ax.get_visible() and not hasattr(ax, '_colorbar')]
    colourbars = [ax for ax in fig.get_axes() if hasattr(ax, '_colorbar')]
    plots, layers, problems = [], [], []
    for k, ax in enumerate(axes, start=1):
        title = ax.get_title() or ax.get_title('left') or ax.get_title('right') or None
        labels = {a: t for a, t in (('x', ax.get_xlabel()), ('y', ax.get_ylabel())) if t}
        scales = [s for s in [legend_scale(ax)] if s]
        for cax in colourbars:
            cb = cax._colorbar
            if getattr(getattr(cb, 'mappable', None), 'axes', None) is ax:
                label = (cax.get_ylabel() if cb.orientation == 'vertical' else cax.get_xlabel()) or ''
                ticks = [t.get_text() for t in (cax.get_yticklabels() if cb.orientation == 'vertical' else cax.get_xticklabels())]
                scales.append({'aesthetic': 'fill', 'title': label, 'breaks': [t for t in ticks if t], 'values': []})
        facets = facets_of(title) if title else {}
        plots.append({'plot': k, 'title': title, 'subtitle': None, 'caption': None, 'labels': labels,
                      'panels': [{'panel': 1, 'facets': facets}], 'facet': 'Grid' if facets else 'Null', 'coord': 'cartesian', 'scales': scales,
                      'positions': {'x': position(ax, 'x'), 'y': position(ax, 'y')}})
        for coll in ax.collections:
            if coll.get_visible(): layers.append(collection_layer(ax, k, coll))
        layers.extend(line_layers(ax, k))
        layers.extend(patch_layers(ax, k))
        layers.extend(text_layers(ax, k))
        if any(im.get_visible() for im in ax.images): problems.append('An image drawn with imshow is a picture: its cells are not bound.')
        if time.monotonic() > deadline: raise Late()
    total = sum(l.n for l in layers)
    if total > limits['maxMarks']: raise ValueError('The plot draws %d marks, more than the %d a figure binds.' % (total, limits['maxMarks']))

    # Bind points, lines and labels to the session's tables, then labels by their text.
    tables = None
    for l in layers:
        if l.kind in ('points', 'lines', 'text') and l.n and 'x' in l.columns and np.isfinite(l.columns['x']).all() and np.isfinite(l.columns['y']).all():
            if tables is None: tables = session_tables(namespace, prefer)
            # A table another layer of the same plot is bound to is compared first.
            mine = [o.table for o in layers if o.plot == l.plot and o.source is not None]
            found = match_table({'x': l.columns['x'], 'y': l.columns['y']}, mine + [t for t in tables if t not in mine], deadline)
            if found:
                l.source, l.table, l.rows, l.mapping, l.how = found['table'].name, found['table'], found['rows'], found['mapping'], found.get('how')
                if 'at' in found: l.notes.append('All %d marks are drawn at %s = %s.' % (l.n, found['other'], ('%.6g' % found['at'])))
                elif found['differ']: l.notes.append('%d of %d marks are drawn at a %s other than their %s.' % (found['differ'], l.n, found['other'], l.mapping[found['other']]))
    # A label drawn at a bound point's position names that point's row, in whatever order the labels
    # were drawn: each is looked up through the point layer's own columns.
    for l in layers:
        if l.kind == 'text' and l.source is None and l.n and 'x' in l.columns and np.isfinite(l.columns['x']).all() and np.isfinite(l.columns['y']).all():
            for o in layers:
                if o.plot != l.plot or o is l or getattr(o, 'how', None) is None: continue
                found = look_up(l.columns['x'], l.columns['y'], o.table, o.how)
                if found is not None: l.source, l.table, l.rows, l.mapping = o.source, o.table, found, dict(o.mapping); break
    for l in layers:
        if l.kind == 'text' and l.source is None and l.n:
            bound = [o.table for o in layers if o.plot == l.plot and o.source is not None and o.kind != 'heatmap']
            mine = [t for i, t in enumerate(bound) if t not in bound[:i]]
            found = match_labels(l.columns['label'], mine) if mine else None
            if found: l.source, l.table, l.rows, l.mapping = found['table'].name, found['table'], found['rows'], found['mapping']
    # A position on an axis of categories is named by its category.
    for l in layers:
        for a in ('x', 'y'):
            if a in l.columns and l.kind != 'heatmap' and plots[l.plot - 1]['positions'][a].get('discrete'):
                names = named_at(tick_names(axes[l.plot - 1], a), l.columns[a])
                if all(v is not None for v in names): l.columns[a] = np.asarray(names, dtype=object)
    for i, l in enumerate(layers):
        if l.kind == 'heatmap' and hasattr(l, 'grid'):
            if tables is None: tables = session_tables(namespace, prefer)
            fill_heatmap(l, tables, 'heatmap' + ('' if i == 0 else str(i + 1)))

    # Draw with each artist named, and take the names back.
    token = 'rho' + uuid.uuid4().hex[:10]
    # A rasterized artist is written as one image; for the figure it is drawn as what it is.
    units, old, raster, zorders = [], [], [], [(ax, ax.get_rasterization_zorder()) for ax in axes]
    for i, l in enumerate(layers):
        for artist, spec, marks in l.units:
            old.append((artist, artist.get_gid()))
            artist.set_gid('%s-%d' % (token, len(units)))
            if artist.get_rasterized(): raster.append(artist); artist.set_rasterized(False)
            units.append((i, artist, spec, marks))
    for ax, _ in zorders: ax.set_rasterization_zorder(None)
    buf = io.StringIO()
    try:
        with matplotlib.rc_context({'svg.fonttype': 'none', 'svg.hashsalt': 'rho', 'svg.image_inline': True}):
            options = {k: v for k, v in saving.items() if k in ('bbox_inches', 'pad_inches', 'facecolor', 'edgecolor', 'transparent', 'bbox_extra_artists')}
            fig.savefig(buf, format='svg', metadata={'Date': None}, **options)
    finally:
        for artist, gid in old: artist.set_gid(gid)
        for artist in raster: artist.set_rasterized(True)
        for ax, z in zorders: ax.set_rasterization_zorder(z)
    if time.monotonic() > deadline: raise Late()
    svg, named, lost = tag_svg(buf.getvalue(), token, units)

    out_units, out_layers, out_marks, sources, used = [], [], [], [], {}
    for i, l in enumerate(layers):
        mine = [u for u, unit in enumerate(units) if unit[0] == i and u in named]
        reasons = list(dict.fromkeys(l.reasons + [lost[u] for u, unit in enumerate(units) if unit[0] == i and u in lost]))
        n = l.n
        constant = dict(getattr(l, 'constant', {}))
        cols = {}
        for name, values in l.columns.items():
            vals = list(values) if not hasattr(values, 'dtype') else values
            if name in ('colour', 'fill', 'size') and n > 1 and len(set(map(str, vals))) == 1:
                constant[name] = vals[0] if not isinstance(vals[0], (float, np.floating)) else num(vals[0])
                continue
            if name in ('colour', 'fill', 'size') and n == 1:
                constant[name] = vals[0] if not isinstance(vals[0], (float, np.floating)) else num(vals[0]); continue
            if hasattr(values, 'dtype') and values.dtype.kind == 'f' and not np.isfinite(values).any(): continue
            cols[name] = values
        if l.source is not None:
            used.setdefault(l.source, (l.table, set()))[1].update(int(r) for r in l.rows)
        bound = 'none' if not mine else 'mark' if all(len(m) == 1 for u in mine for m in named[u]) else 'group'
        layer = {'plot': l.plot, 'layer': i + 1, 'geom': l.kind, 'stat': 'identity', 'position': 'identity', 'mapping': l.mapping,
                 'constants': {k: v for k, v in constant.items() if v is not None}, 'source': l.source, 'marks': n, 'units': len(mine), 'bound': bound}
        if getattr(l, 'series', None): layer['constants']['series'] = l.series
        if reasons: layer['unbound'] = reasons
        if l.notes: layer['notes'] = l.notes
        out_layers.append(layer)
        out_marks.append({'panel': [1] * n, 'group': [int(g) for g in l.group] if l.group is not None else [-1] * n,
                          'row': [int(r) for r in l.rows] if l.rows is not None else None,
                          'columns': [column(name, v) for name, v in cols.items()]})
    # Every unit keeps its place, so data-rho="U.E" names units[U]; one not matched names no marks.
    out_units = [{'layer': unit[0], 'panel': 1, 'marks': named.get(u, [])} for u, unit in enumerate(units)]
    for name, (table, rows) in used.items(): sources.append(table.source(rows))
    suptitle = getattr(fig, '_suptitle', None)
    title = (suptitle.get_text() if suptitle is not None and suptitle.get_text() else None) or (plots[0]['title'] if plots else None)
    return {'svg': svg, 'problems': list(dict.fromkeys(problems)), 'units': out_units,
            'figure': {'kind': 'matplotlib', 'title': title, 'plots': plots, 'layers': out_layers}, 'marks': out_marks, 'sources': sources}

def describe_figure(figure, into, namespace=None, prefer=(), **saving):
    try:
        from matplotlib.figure import Figure
    except Exception: return None
    if not isinstance(figure, Figure): return None
    import matplotlib, numpy
    started = time.monotonic()
    result, problem = None, None
    with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()), warnings.catch_warnings():
        warnings.simplefilter('ignore')
        try: result = describe(figure, namespace or {}, saving, started + limits['maxSeconds'], list(prefer or ()))
        except Late: problem = 'Describing the plot took longer than %d s; it stays a picture.' % limits['maxSeconds']
        except Exception as error: problem = str(error) or type(error).__name__
    if problem: return {'problem': problem}
    w, h = figure.get_size_inches()
    versions = {'Python': platform.python_version(), 'matplotlib': matplotlib.__version__, 'numpy': numpy.__version__}
    if 'seaborn' in sys.modules: versions['seaborn'] = getattr(sys.modules['seaborn'], '__version__', '')
    record = {'schema': schema, 'describer': 'matplotlib', 'size': {'width': num(w), 'height': num(h), 'units': 'in'}, 'versions': versions,
              'seconds': round(time.monotonic() - started, 2)}
    record.update(result)
    text = json.dumps(record, ensure_ascii=False, allow_nan=False, separators=(',', ':'))
    size = len(text.encode('utf-8'))
    if size > limits['maxBytes']: return {'problem': 'The figure record would take %.1f MB, more than %d MB.' % (size / 1048576, limits['maxBytes'] // 1048576)}
    tmp = into + '.tmp'
    with open(tmp, 'w', encoding='utf-8') as f: f.write(text)
    os.replace(tmp, into)
    f = result['figure']
    bound = len({(u['layer'], m) for u in result['units'] for ms in u['marks'] for m in ms})
    notes = [n for l in f['layers'] for n in l.get('notes', [])]
    return {'describer': 'matplotlib', 'kind': f['kind'], 'title': f['title'], 'layers': len(f['layers']),
            'marks': sum(l['marks'] for l in f['layers']), 'bound': bound, 'geoms': [l['geom'] for l in f['layers']], 'file': os.path.basename(into),
            **({'notes': notes[:4]} if notes else {})}
