# A live Python session for Rho. It reads one JSON request per line on stdin and answers on file
# descriptor 3, so what the person's code prints never mixes with the answers. Code runs in one
# namespace kept for the life of this process; a cell whose last statement is an expression shows
# that value, as a notebook does. Figures made with matplotlib are saved after each cell. An
# interrupt (SIGINT) stops the cell that is running and leaves the session and its variables.
import ast, io, json, linecache, os, sys, traceback, types

root = sys.argv[1]
os.chdir(root)
sys.path.insert(0, root)
answers = os.fdopen(3, 'w', buffering=1, encoding='utf-8')
real_out, real_err = sys.stdout, sys.stderr
# Requests come on stdin; the person's code reads an empty input instead.
requests, sys.stdin = sys.stdin, io.StringIO('')

def emit(value):
    answers.write(json.dumps(value, ensure_ascii=False) + '\n')
    answers.flush()

class Stream:
    def __init__(self, cell, name): self.cell, self.name = cell, name
    def write(self, text):
        if text: emit({'id': self.cell, 'kind': self.name, 'text': text})
        return len(text)
    def flush(self): pass
    def isatty(self): return False

namespace = {'__name__': '__main__', '__builtins__': __builtins__}

def clip(text, n=160):
    text = ' '.join(str(text).split())
    return text if len(text) <= n else text[:n - 1] + '…'

# Modules, and classes and functions imported from elsewhere, are where values come from,
# not values; what a cell defines itself is listed.
def listed():
    imported = lambda v: (isinstance(v, type) or callable(v)) and getattr(v, '__module__', '__main__') != '__main__'
    return [k for k, v in namespace.items() if not k.startswith('_') and not isinstance(v, types.ModuleType) and not imported(v)]

def variables(most):
    names = listed()
    items = []
    for name in names[:most]:
        value = namespace[name]
        shape = getattr(value, 'shape', None)
        if isinstance(shape, tuple): size = ' × '.join(str(n) for n in shape)
        elif hasattr(value, '__len__') and not isinstance(value, (str, bytes, type)) and not callable(value):
            try: size = str(len(value))
            except Exception: size = ''
        else: size = ''
        try:
            usage = getattr(value, 'memory_usage', None)
            bytes_ = int(usage(deep=False).sum()) if callable(usage) and hasattr(value, 'columns') else int(getattr(value, 'nbytes', 0)) or sys.getsizeof(value)
        except Exception: bytes_ = 0
        try:
            if callable(value) and hasattr(value, '__name__'): summary = clip(value.__name__ + str(__import__('inspect').signature(value)))
            elif hasattr(value, 'columns'): summary = clip(', '.join(map(str, list(value.columns)[:12])))
            else: summary = clip(repr(value))
        except Exception: summary = ''
        items.append({'name': name, 'type': type(value).__name__, 'size': size, 'bytes': bytes_, 'summary': summary})
    return {'items': items, 'omitted': max(0, len(names) - most)}

def save_figures(cell, folder, most):
    plt = sys.modules.get('matplotlib.pyplot')
    if not plt: return
    for i, number in enumerate(plt.get_fignums()):
        figure = plt.figure(number)
        if i < most:
            file = os.path.join(folder, f'{cell}-{i + 1}.png')
            figure.savefig(file, dpi=144, bbox_inches='tight')
            w, h = figure.get_size_inches()
            emit({'id': cell, 'kind': 'plot', 'file': file, 'width': int(w * 144), 'height': int(h * 144)})
    plt.close('all')

# What a cell's code reads and assigns, from its parsed text before it runs: the names it loads,
# the names it binds (also through df[...] = or obj.attr =, def, class and import), and its
# strings. What a function, lambda or comprehension binds is its own, and so is a name the cell
# bound in an earlier statement. Nothing is run to find them.
def lineage_of(code):
    try: tree = ast.parse(code)
    except SyntaxError: return set(), [], []
    mentioned, assigned, strings = set(), [], []
    scopes = (ast.FunctionDef, ast.AsyncFunctionDef, ast.Lambda, ast.ClassDef, ast.ListComp, ast.SetComp, ast.DictComp, ast.GeneratorExp)
    # A name the cell bound in an earlier statement is its own when read again; a statement's
    # names are bound once it has run (a loop's target before its body).
    before, pending, keys = set(), [], set()
    def bind(name):
        assigned.append(name)
        if pending: pending[-1].add(name)
    def settle():
        before.update(pending[-1]); pending[-1].clear()
    def base(node):
        while isinstance(node, (ast.Attribute, ast.Subscript, ast.Starred)): node = node.value
        return node.id if isinstance(node, ast.Name) else None
    # The names a function, lambda, class or comprehension binds for itself: its arguments, its
    # loop targets and what it assigns, other than names it declares global.
    def own(scope):
        names, declared = set(), set()
        for node in ast.walk(scope):
            if isinstance(node, (ast.Global, ast.Nonlocal)): declared |= set(node.names)
            elif isinstance(node, ast.Name) and not isinstance(node.ctx, ast.Load): names.add(node.id)
            elif isinstance(node, ast.arg): names.add(node.arg)
            elif isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)) and node is not scope: names.add(node.name)
            elif isinstance(node, (ast.Import, ast.ImportFrom)): names |= {(a.asname or a.name).split('.')[0] for a in node.names}
        return names - declared
    def visit(node, local):
        if local is None and isinstance(node, ast.stmt):
            pending.append(set())
            statement(node)
            before.update(pending.pop())
        else: inner(node, local)
    def statement(node):
        if isinstance(node, (ast.For, ast.AsyncFor)):
            visit(node.iter, None); visit(node.target, None); settle()
            for child in node.body + node.orelse: visit(child, None)
        elif isinstance(node, (ast.With, ast.AsyncWith)):
            for item in node.items: visit(item, None)
            settle()
            for child in node.body: visit(child, None)
        elif isinstance(node, (ast.Assign, ast.AnnAssign, ast.AugAssign)):
            if isinstance(node, ast.AugAssign) and isinstance(node.target, ast.Name) and node.target.id not in before: mentioned.add(node.target.id)
            if node.value is not None: visit(node.value, None)
            for target in node.targets if isinstance(node, ast.Assign) else [node.target]: visit(target, None)
        else: inner(node, None)
    # At the top level (local is None) names are the session's; within a scope only a mention of a
    # name the scope does not bind reads one. A comprehension's first iterable is read outside it.
    def inner(node, local):
        if isinstance(node, scopes):
            if local is None and isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)): bind(node.name)
            within = (local or set()) | own(node)
            first = node.generators[0].iter if isinstance(node, (ast.ListComp, ast.SetComp, ast.DictComp, ast.GeneratorExp)) else None
            if first is not None: visit(first, local)
            for child in ast.iter_child_nodes(node):
                if child is not getattr(node, 'generators', [None])[0]: visit(child, within)
                else:
                    for part in ast.iter_child_nodes(child):
                        if part is not first: visit(part, within)
            return
        if isinstance(node, ast.Name):
            if local is None and not isinstance(node.ctx, ast.Load): bind(node.id)
            elif isinstance(node.ctx, ast.Load) and node.id not in before and node.id not in (local or ()): mentioned.add(node.id)
        elif local is None and isinstance(node, (ast.Attribute, ast.Subscript)) and not isinstance(node.ctx, ast.Load):
            if base(node): bind(base(node))
        elif local is None and isinstance(node, (ast.Import, ast.ImportFrom)):
            for a in node.names: bind((a.asname or a.name).split('.')[0])
        elif isinstance(node, ast.Constant) and isinstance(node.value, str) and id(node) not in keys: strings.append(node.value)
        for child in ast.iter_child_nodes(node): visit(child, local)
    # A string that is a key or an index (d['trimmed'], df[['raw', 'clipkit']]) names a part, not a path.
    for node in ast.walk(tree):
        parts = node.keys if isinstance(node, ast.Dict) else [node.slice] if isinstance(node, ast.Subscript) else []
        for part in parts:
            for leaf in part.elts if isinstance(part, (ast.List, ast.Tuple)) else [part]:
                if isinstance(leaf, ast.Constant): keys.add(id(leaf))
    for node in tree.body: visit(node, None)
    return mentioned, list(dict.fromkeys(assigned)), list(dict.fromkeys(strings))

# The strings that name a place in the project, each as its project path, with the file's or
# folder's size and time before the cell. A path outside the project is not followed.
def stamp(path):
    try:
        info = os.stat(path)
        return ('folder', info.st_mtime_ns) if os.path.isdir(path) else (info.st_size, info.st_mtime_ns)
    except OSError: return None

def project_paths(strings, most=32):
    root, out = os.path.realpath(os.getcwd()), {}
    for text in [t for t in strings if 0 < len(t) < 512 and not any(c in t for c in '\n\r\t')][:most]:
        full = os.path.expanduser(text) if text.startswith(('/', '~')) else os.path.join(root, text)
        # The folder may not be there yet: one the cell makes before it writes into it.
        folder = os.path.realpath(os.path.dirname(full))
        full = os.path.normpath(os.path.join(folder, os.path.basename(full)))
        if full.startswith(root + os.sep): out[full[len(root) + 1:]] = stamp(full)
    return out

# Each named file the cell left in place is one it read; one it made or changed is one it wrote.
# A folder ends in /: one whose entries changed was written to. A folder that holds another named
# path is left to that path.
def touched(before):
    out = []
    for path, was in before.items():
        now = stamp(os.path.join(os.getcwd(), path))
        if now is None: continue
        folder = now[0] == 'folder'
        if folder and any(other != path and other.startswith(path + '/') for other in before): continue
        out.append({'path': path + ('/' if folder else ''), 'how': 'read' if was == now else 'wrote'})
    return out

def run(msg):
    cell, ok, interrupted = msg['id'], True, False
    known = set(listed())
    mentioned, assigned, strings = lineage_of(msg['code'])
    files = project_paths(strings)
    # Each cell's code is kept under its own name, so a traceback shows the line that failed,
    # also inside a function an earlier cell defined.
    name = f"<cell {msg.get('number', '')}>"
    linecache.cache[name] = (len(msg['code']), None, msg['code'].splitlines(True), name)
    sys.stdout, sys.stderr = Stream(cell, 'stdout'), Stream(cell, 'stderr')
    try:
        tree = ast.parse(msg['code'], name, 'exec')
        last = tree.body.pop() if tree.body and isinstance(tree.body[-1], ast.Expr) else None
        exec(compile(tree, name, 'exec'), namespace)
        if last is not None:
            value = eval(compile(ast.Expression(last.value), name, 'eval'), namespace)
            if value is not None: emit({'id': cell, 'kind': 'stdout', 'text': repr(value) + '\n'})
    except KeyboardInterrupt:
        ok, interrupted = False, True
        emit({'id': cell, 'kind': 'error', 'text': 'Interrupted.'})
    except BaseException as error:
        ok = False
        frames = [f for f in traceback.extract_tb(error.__traceback__) if f.filename != __file__]
        text = ''.join(traceback.format_list(frames)) + ''.join(traceback.format_exception_only(type(error), error))
        emit({'id': cell, 'kind': 'error', 'text': 'Traceback (most recent call last):\n' + text if frames else text})
    finally:
        sys.stdout, sys.stderr = real_out, real_err
    try: save_figures(cell, msg['plots'], msg['maxPlots'])
    except Exception as error: emit({'id': cell, 'kind': 'stderr', 'text': f'The figures could not be saved: {error}\n'})
    emit({'id': cell, 'kind': 'done', 'ok': ok, 'interrupted': interrupted, 'variables': variables(msg['maxVariables']),
          'used': sorted(mentioned & known), 'assigned': assigned, 'files': touched(files)})

# Looking at a value without changing it: what kind of thing it is and its facts, a page of its
# rows, elements or parts, and the code that reaches each part. Nothing is printed and nothing is
# assigned in the session; a value's own repr may run for its printed form. Every list, page and
# text is cut at the limits the host sends.
def type_name(value):
    kind = type(value)
    return kind.__name__ if kind.__module__ in ('builtins', '__main__') else kind.__module__.split('.')[0] + '.' + kind.__name__

def size_of(value):
    shape = getattr(value, 'shape', None)
    if isinstance(shape, tuple): return ' × '.join(str(n) for n in shape)
    if hasattr(value, '__len__') and not isinstance(value, (str, bytes, type)) and not callable(value):
        try: return str(len(value))
        except Exception: return ''
    return ''

def bytes_of(value):
    try:
        usage = getattr(value, 'memory_usage', None)
        if callable(usage) and hasattr(value, 'columns'): return int(usage(deep=False).sum())
        return int(getattr(value, 'nbytes', 0)) or sys.getsizeof(value)
    except Exception: return 0

def summary_of(value):
    try:
        if callable(value) and hasattr(value, '__name__'): return clip(value.__name__ + str(__import__('inspect').signature(value)))
        if hasattr(value, 'columns'): return clip(', '.join(map(str, list(value.columns)[:12])))
        return clip(repr(value))
    except Exception: return ''

def cell_text(value, width):
    try:
        if value is None: return 'None'
        if isinstance(value, float): text = format(value, '.6g')
        else: text = str(value)
    except Exception: text = '<' + type(value).__name__ + '>'
    text = ' '.join(text.split()) if '\n' in text else text
    return text if len(text) <= width else text[:width - 1] + '…'

def number(value):
    try: return format(float(value), '.6g')
    except Exception: return str(value)

def column_summary(column, limits):
    pd = sys.modules.get('pandas')
    try:
        if pd is not None and pd.api.types.is_bool_dtype(column): return f'{int(column.sum())} True'
        if pd is not None and pd.api.types.is_numeric_dtype(column) and column.notna().any(): return f'{number(column.min())} – {number(column.max())}'
        if pd is not None and pd.api.types.is_datetime64_any_dtype(column) and column.notna().any(): return f'{column.min()} – {column.max()}'
        if str(column.dtype) == 'category': return f'{len(column.cat.categories)} categories'
        if len(column) <= limits['maxSortRows']: return f'{column.nunique(dropna=True)} distinct'
    except Exception: pass
    return ''

def table_page(frame, msg, labels=None):
    pd = sys.modules.get('pandas') or __import__('pandas')
    limits = msg['limits']
    if not isinstance(frame, pd.DataFrame): frame = pd.DataFrame(frame)
    n, total = frame.shape
    order, sorted_, refused = None, None, None
    sort = msg.get('sort')
    if sort and sort.get('column', -1) < total:
        if n > limits['maxSortRows']: refused = f"Sorting takes at most {limits['maxSortRows']} rows."
        else:
            column = frame.iloc[:, sort['column']].reset_index(drop=True)
            order = list(column.sort_values(ascending=not sort.get('descending'), na_position='last', kind='mergesort').index)
            sorted_ = sort
    offset = min(msg['offset'], max(0, n - 1))
    positions = (order if order is not None else range(n))[offset:offset + msg['limit']]
    positions = list(positions)
    page = frame.iloc[positions]
    if labels is None: labels = [str(label) for label in frame.index]
    columns = []
    for j in range(min(total, limits['maxColumns'])):
        column = frame.iloc[:, j]
        numeric = bool(pd.api.types.is_numeric_dtype(column)) and not pd.api.types.is_bool_dtype(column)
        values = ['NaN' if numeric and pd.isna(v) else cell_text(v, limits['maxCellChars']) for v in page.iloc[:, j].tolist()]
        columns.append({'name': str(frame.columns[j]), 'type': str(column.dtype), 'numeric': numeric, 'missing': int(column.isna().sum()), 'summary': column_summary(column, limits), 'values': values})
    return {'rows': n, 'columnsTotal': total, 'offset': offset, 'rowLabels': [labels[p] for p in positions], 'sort': sorted_, 'sortRefused': refused, 'columns': columns}

def parts(value):
    """The parts a value is made of, and how code reaches each: (names, get(i), code(expr, i))."""
    pd = sys.modules.get('pandas')
    if isinstance(value, dict):
        keys = list(value.keys())
        return [str(k) for k in keys], lambda i: value[keys[i]], lambda e, i: f'{e}[{keys[i]!r}]'
    if isinstance(value, (list, tuple)):
        return [f'[{i}]' for i in range(len(value))], lambda i: value[i], lambda e, i: f'{e}[{i}]'
    if pd is not None and isinstance(value, pd.DataFrame):
        cols = list(value.columns)
        return [str(c) for c in cols], lambda i: value.iloc[:, i], lambda e, i: f'{e}[{cols[i]!r}]'
    if isinstance(value, (str, bytes, int, float, bool, complex, type(None), types.ModuleType)) or callable(value): return None
    try: attrs = sorted(k for k, v in vars(value).items() if not k.startswith('_'))
    except TypeError: return None
    return attrs, lambda i: getattr(value, attrs[i]), lambda e, i: f'{e}.{attrs[i]}'

def kind_of(value):
    pd, np = sys.modules.get('pandas'), sys.modules.get('numpy')
    if pd is not None and isinstance(value, pd.DataFrame): return 'table'
    if np is not None and isinstance(value, np.ndarray) and value.ndim == 2: return 'table'
    if hasattr(value, 'params') and hasattr(value, 'bse'): return 'model'
    if hasattr(value, 'get_params') and hasattr(value, 'fit'): return 'model'
    if callable(value): return 'function'
    if pd is not None and isinstance(value, pd.Series): return 'vector'
    if np is not None and isinstance(value, np.ndarray) and value.ndim == 1: return 'vector'
    if isinstance(value, (list, tuple)) and value and all(isinstance(v, (int, float, str, bool)) or v is None for v in value[:200]): return 'vector'
    if isinstance(value, (str, bytes, int, float, bool, complex, type(None))) or (np is not None and isinstance(value, np.generic)): return 'value'
    if isinstance(value, (dict, list, tuple)) or parts(value): return 'list'
    return 'other'

def printed(value, limits, label):
    try: text = repr(value)
    except Exception as error: text = f'It could not be printed: {error}'
    cut = len(text.encode()) > limits['maxText']
    return {'label': label, 'text': text.encode()[:limits['maxText']].decode('utf-8', 'ignore') if cut else text, 'cut': cut}

def describe_value(value, msg, name, code, trail):
    pd, np = sys.modules.get('pandas'), sys.modules.get('numpy')
    limits, facts = msg['limits'], []
    def fact(label, v):
        if v is not None and v != '': facts.append({'label': label, 'value': clip(v, 200)})
    kind = kind_of(value)
    out = {'name': name, 'expression': code, 'trail': trail, 'kind': kind, 'type': type_name(value), 'size': size_of(value), 'bytes': bytes_of(value)}
    if kind == 'table':
        frame = value if pd is not None and isinstance(value, pd.DataFrame) else (pd or __import__('pandas')).DataFrame(value)
        fact('Rows', frame.shape[0]); fact('Columns', frame.shape[1]); fact('Missing values', int(frame.isna().sum().sum()))
        out['table'] = table_page(frame, msg)
    elif kind == 'model' and hasattr(value, 'params') and hasattr(value, 'bse'):
        for label, attr in (('Model', 'model'), ('Observations', 'nobs'), ('R²', 'rsquared'), ('Adjusted R²', 'rsquared_adj'), ('AIC', 'aic'), ('BIC', 'bic'), ('Log-likelihood', 'llf')):
            v = getattr(value, attr, None)
            if v is not None: fact(label, type(v).__name__ if attr == 'model' else number(v))
        frame = (pd or __import__('pandas')).DataFrame({'coef': value.params, 'std err': value.bse, **({'t / z': value.tvalues} if hasattr(value, 'tvalues') else {}), **({'P>|t|': value.pvalues} if hasattr(value, 'pvalues') else {})})
        out['table'] = table_page(frame.astype(float).round(6), msg)
        try: out['text'] = {'label': 'As it prints its summary', 'text': str(value.summary())[:limits['maxText']], 'cut': False}
        except Exception: pass
    elif kind == 'model':
        fact('Model', type(value).__name__)
        # The settings it was made with that differ from the class's defaults; all are among its parts.
        try:
            defaults = {k: p.default for k, p in __import__('inspect').signature(type(value).__init__).parameters.items()}
            for key, v in sorted(value.get_params(deep=False).items()):
                if key not in defaults or repr(defaults[key]) != repr(v): fact(key, repr(v))
        except Exception: pass
        coef = getattr(value, 'coef_', None)
        if coef is not None and np is not None:
            coef = np.atleast_2d(coef)
            names = list(getattr(value, 'feature_names_in_', [f'x{i}' for i in range(coef.shape[1])]))
            frame = (pd or __import__('pandas')).DataFrame(coef.T, index=[str(n) for n in names], columns=[f'coef {c}' for c in getattr(value, 'classes_', [])][-coef.shape[0]:] if coef.shape[0] > 1 else ['coef'])
            out['table'] = table_page(frame.round(6), msg)
        intercept = getattr(value, 'intercept_', None)
        if intercept is not None: fact('Intercept', ' '.join(number(v) for v in np.atleast_1d(intercept)) if np is not None else str(intercept))
        if hasattr(value, 'classes_'): fact('Classes', ', '.join(map(str, value.classes_)))
        if hasattr(value, 'n_features_in_'): fact('Features', value.n_features_in_)
        if coef is None and not hasattr(value, 'n_features_in_'): fact('Fitted', 'no')
    elif kind == 'value':
        out['values'] = {'total': 1, 'offset': 0, 'items': [{'name': None, 'value': cell_text(value, limits['maxText'])}]}
    elif kind == 'vector':
        series = (pd or __import__('pandas')).Series(value) if not (pd is not None and isinstance(value, pd.Series)) else value
        total, missing = len(series), int(series.isna().sum())
        fact('Length', total)
        if missing: fact('Missing', missing)
        numeric = (pd or __import__('pandas')).api.types.is_numeric_dtype(series) and not (pd or __import__('pandas')).api.types.is_bool_dtype(series)
        if numeric and total > 1 and missing < total:
            fact('Min', number(series.min())); fact('Median', number(series.median())); fact('Mean', number(series.mean())); fact('Max', number(series.max()))
            if total > 2: fact('SD', number(series.std()))
        elif total > 1 and total <= limits['maxSortRows']:
            counts = series.astype(str).value_counts(dropna=False)
            fact('Distinct', len(counts))
            first = dict(msg, offset=0, sort=None)
            out['table'] = table_page((pd or __import__('pandas')).DataFrame({'value': counts.index.astype(str), 'count': counts.values}), first, [str(i + 1) for i in range(len(counts))])
        offset = min(msg['offset'], max(0, total - 1))
        labelled = not isinstance(series.index, (pd or __import__('pandas')).RangeIndex)
        out['values'] = {'total': total, 'offset': offset, 'items': [{'name': str(series.index[i]) if labelled else None, 'value': cell_text(series.iloc[i], limits['maxCellChars'])} for i in range(offset, min(total, offset + msg['limit']))]}
    elif kind == 'function':
        inspect = __import__('inspect')
        try: fact('Arguments', str(inspect.signature(value)))
        except Exception: pass
        try: text = inspect.getsource(value)
        except Exception: text = linecache.getlines(getattr(getattr(value, '__code__', None), 'co_filename', '')) and ''.join(linecache.getlines(value.__code__.co_filename)) or repr(value)
        cut = len(text.encode()) > limits['maxText']
        out['text'] = {'label': 'Code', 'text': text.encode()[:limits['maxText']].decode('utf-8', 'ignore') if cut else text, 'cut': cut}
    elif kind == 'other': out['text'] = printed(value, limits, 'As Python prints it')
    p = parts(value) if kind not in ('table', 'vector', 'value', 'function') else None
    if p and p[0]:
        names, get, reach = p
        total = len(names); offset = min(msg['offset'], max(0, total - 1)) if kind == 'list' else 0
        items = []
        for i in range(offset, min(total, offset + (msg['limit'] if kind == 'list' else limits['maxChildren']))):
            try: v = get(i)
            except Exception as error: v = error
            items.append({'index': i, 'name': names[i], 'type': type_name(v), 'size': size_of(v), 'summary': summary_of(v), 'expression': reach(code, i)})
        out['children'] = {'total': total, 'offset': offset, 'items': items}
    if kind == 'list' and 'children' not in out: out['text'] = printed(value, limits, 'As Python prints it')
    out['facts'] = facts
    return out

def inspect_value(msg):
    reply = lambda answer: emit({'id': msg['id'], 'kind': 'inspected', **answer})
    try:
        name = msg['name']
        if name not in namespace: return reply({'state': 'missing', 'problem': f'{name} is not in the session.'})
        value, code, trail = namespace[name], name, []
        for step in msg.get('path') or []:
            p = parts(value)
            if not p or step >= len(p[0]): return reply({'state': 'missing', 'problem': f'That part is no longer in {code}.'})
            value, code = p[1](step), p[2](code, step)
            trail.append({'index': step, 'name': p[0][step]})
        reply({'state': 'shown', 'object': describe_value(value, msg, name, code, trail)})
    except KeyboardInterrupt:
        reply({'state': 'timeout', 'problem': 'Reading the value took too long and was stopped.'})
    except Exception as error:
        reply({'state': 'failed', 'problem': f'{type(error).__name__}: {error}'})

emit({'kind': 'ready', 'version': 'Python ' + sys.version.split()[0], 'pid': os.getpid(), 'variables': variables(200)})
while True:
    try:
        line = requests.readline()
    except KeyboardInterrupt:
        continue
    if not line: break
    try:
        msg = json.loads(line)
        if msg.get('op') == 'run': run(msg)
        if msg.get('op') == 'inspect': inspect_value(msg)
    except KeyboardInterrupt:
        continue
