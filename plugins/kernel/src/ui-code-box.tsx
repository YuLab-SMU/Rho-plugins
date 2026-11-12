import { useEffect, useImperativeHandle, useLayoutEffect, useRef, useState, type Ref, type RefObject } from 'react';
import { useShell, type CodeBox as PageBox, type Completions } from './ui-base.js';

type Language = 'r' | 'python';
// What the notebook asks of the box code is written in: the keyboard, at a point of the page when
// the person pressed there, and its place in view.
export interface CodeBoxHandle { focus(at?: { x: number; y: number }): void; scrollIntoView(): void }

// The page's highlighting drawn under a plain text box, in its font, wrapping and scroll, with the
// box's own letters clear. What is typed shows at once in plain ink and takes its colours when
// they are ready.
function Inked({ code, language, box }: { code: string; language: Language; box: RefObject<HTMLTextAreaElement | null> }) {
  const text = useRef<HTMLElement>(null), ink = useRef<HTMLPreElement>(null), { highlight } = useShell();
  useLayoutEffect(() => {
    let live = true;
    // A last line break is a line in the box; here it takes one more to be drawn as one.
    if (text.current) text.current.textContent = code + '\n';
    highlight?.(code, language).then(fragment => { if (live && fragment && text.current) text.current.replaceChildren(fragment, '\n'); }, () => {});
    return () => { live = false; };
  }, [code, language, highlight]);
  useEffect(() => {
    const element = box.current;
    if (!element) return;
    const follow = () => { if (ink.current) { ink.current.scrollTop = element.scrollTop; ink.current.scrollLeft = element.scrollLeft; } };
    follow(); element.addEventListener('scroll', follow, { passive: true });
    return () => element.removeEventListener('scroll', follow);
  });
  return <pre className="nb-ink" ref={ink} aria-hidden="true"><code ref={text} /></pre>;
}

// The box a cell's code is written in. Where the page that shows the notebook has an editor
// (`codeBox`), it is that editor: the language's colours, matching brackets, indentation, undo and
// the names the live session offers as they are typed. Elsewhere, and if that editor cannot be
// made, it is a plain text box with the page's highlighting under it. Shift+Enter, or Enter with
// Ctrl or Cmd, runs what is written; Escape leaves it where the notebook gives a way to.
export function CodeBox({ handle, value, onChange, language, label, placeholder, wrap, lines, onRun, onCancel, complete, onReady, focusAt }: {
  handle?: Ref<CodeBoxHandle>; value: string; onChange: (text: string) => void; language: Language; label: string; placeholder?: string; wrap?: boolean; lines?: number;
  onRun?: () => void; onCancel?: () => void; complete?: (line: string) => Promise<Completions | null>;
  // Told once the box can be typed in; focusAt takes the keyboard then, at that point of the page.
  onReady?: () => void; focusAt?: { x: number; y: number } | true;
}) {
  const shell = useShell(), editor = shell.codeBox;
  const host = useRef<HTMLDivElement>(null), box = useRef<PageBox | null>(null), area = useRef<HTMLTextAreaElement>(null);
  const [ready, setReady] = useState(false), [plain, setPlain] = useState(!editor);
  // What the editor calls is read when it calls, so the editor is made once.
  const now = useRef({ onChange, onRun, onCancel, complete, onReady }); now.current = { onChange, onRun, onCancel, complete, onReady };
  const written = useRef(value), wanted = useRef<{ x: number; y: number } | true | null>(focusAt ?? null);
  useImperativeHandle(handle, () => ({
    focus(at) { if (box.current) box.current.focus(at); else if (area.current) area.current.focus(); else wanted.current = at ?? true; },
    scrollIntoView() { (host.current ?? area.current)?.scrollIntoView({ block: 'nearest' }); },
  }), []);
  useEffect(() => {
    if (!editor || plain || !host.current) return;
    let gone = false, made: PageBox | null = null;
    editor(host.current, { language, value: written.current, label, placeholder, wrap: !!wrap,
      onChange: text => { written.current = text; now.current.onChange(text); },
      onRun: () => now.current.onRun?.(), ...(onCancel ? { onCancel: () => now.current.onCancel?.() } : {}),
      complete: line => now.current.complete?.(line) ?? Promise.resolve(null),
    }).then(b => {
      if (gone) { b.destroy(); return; }
      made = b; box.current = b; setReady(true);
      now.current.onReady?.();
      // The keyboard is taken once the box stands where it will be read: a point of the page
      // names a place in the code only then.
      requestAnimationFrame(() => { if (!gone && wanted.current) { b.focus(wanted.current === true ? undefined : wanted.current); wanted.current = null; } });
    }, () => { if (!gone) setPlain(true); });
    return () => { gone = true; made?.destroy(); box.current = null; setReady(false); };
  }, [editor, plain]);
  // The language, its example and the box's name follow the notebook.
  useEffect(() => { box.current?.update({ language, label, placeholder }); }, [ready, language, label, placeholder]);
  // Text set from outside (the box cleared after a run, code another view put here) replaces
  // what is written; what the person types is already there.
  useEffect(() => { if (box.current && value !== written.current) box.current.setValue(value); written.current = value; }, [ready, value]);
  useEffect(() => { if (!plain) return; if (wanted.current) { area.current?.focus(); wanted.current = null; } now.current.onReady?.(); }, [plain]);
  if (!plain) return <div className={'nb-editor cm' + (wrap ? ' wrap' : '')} ref={host} />;
  return <div className={'nb-editor' + (shell.highlight ? ' inked' : '') + (wrap ? ' wrap' : '')}>
    {shell.highlight && <Inked code={value} language={language} box={area} />}
    <textarea ref={area} rows={Math.max(1, lines ?? value.split('\n').length)} value={value} spellCheck={false} autoComplete="off" autoCapitalize="off" wrap={wrap ? 'soft' : 'off'}
      aria-label={label} placeholder={placeholder}
      onChange={event => { written.current = event.target.value; onChange(event.target.value); }}
      onKeyDown={event => {
        if (event.nativeEvent.isComposing) return;
        if (event.key === 'Enter' && (event.metaKey || event.ctrlKey || event.shiftKey)) { event.preventDefault(); onRun?.(); }
        else if (event.key === 'Escape' && onCancel) { event.preventDefault(); onCancel(); }
      }} />
  </div>;
}
