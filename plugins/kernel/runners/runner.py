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

def variables(most):
    # Modules, and classes and functions imported from elsewhere, are where values come from,
    # not values; what a cell defines itself is listed.
    imported = lambda v: (isinstance(v, type) or callable(v)) and getattr(v, '__module__', '__main__') != '__main__'
    names = [k for k, v in namespace.items() if not k.startswith('_') and not isinstance(v, types.ModuleType) and not imported(v)]
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

def run(msg):
    cell, ok, interrupted = msg['id'], True, False
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
    emit({'id': cell, 'kind': 'done', 'ok': ok, 'interrupted': interrupted, 'variables': variables(msg['maxVariables'])})

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
    except KeyboardInterrupt:
        continue
