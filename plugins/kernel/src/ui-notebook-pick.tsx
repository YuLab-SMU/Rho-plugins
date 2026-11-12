import { showNotebook } from './ui-notebook-target.js';
import type { NotebookNames, Session } from './ui-notebook.js';

// A notebook by the name its view has on the page. The project's own sessions, which no notebook
// names, are the Project notebook: an Agent's cells run there unless it names a notebook. A
// notebook whose view was closed keeps its sessions until they are stopped, and is named for that.
export const notebookName = (notebook: string | null | undefined, names?: NotebookNames) => !notebook ? 'Project notebook' : names?.[notebook] ?? 'A closed notebook';
// The notebooks with a live session, and the one shown, to choose among. With one there is
// nothing to choose and nothing is drawn.
export function NotebookPick({ sessions, shown, names }: { sessions: readonly Session[]; shown: string | null; names?: NotebookNames }) {
  const ids = [...new Set([null, shown, ...sessions.filter(s => s.state !== 'ended').map(s => s.notebook ?? null)])];
  if (ids.length < 2) return null;
  return <select className="nb-notebook-pick" aria-label="Notebook" title="The notebook whose sessions are shown" value={shown ?? ''} onChange={event => showNotebook(event.target.value || null)}>
    {ids.map(id => <option key={id ?? ''} value={id ?? ''}>{notebookName(id, names)}</option>)}
  </select>;
}
