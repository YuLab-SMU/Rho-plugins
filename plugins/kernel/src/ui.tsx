// The browser entry for the live sessions' views: the Notebook, the sessions' variables and
// plots, the data flow, the servers and one value's view. The page that shows them supplies the
// scoped client, the project's facts and, optionally, its code highlighting and Markdown.
import { ensureStyles } from './ui-styles.js';
import { viewPresentations } from './presentation.js';

ensureStyles();

export { SessionPane, NotebookPage, PlotsPane, Code, FormSwitch, languages, languageName, notebookViewLimits, plotsPaneLimits, type NotebookForm, type NotebookNames, type Prepared, type Beside, type Linked, type Cell, type Session } from './ui-notebook.js';
export { VariablesPane, variablesPaneLimits } from './ui-variables.js';
export { SessionsPane, sessionsPaneLimits } from './ui-sessions.js';
export { savedForm, saveForm } from './ui-notebook-form.js';
export { askCell, askPlot, showNotebook } from './ui-notebook-target.js';
export { notebookName } from './ui-notebook-pick.js';
export { ServersPane, showOnServer } from './ui-servers.js';
export { FlowPane, ScriptFlowView, lineageViewLimits, innerFlowLimits } from './ui-flow.js';
export { ObjectView, objectViewLimits } from './ui-object.js';
export { NotebookWorkSection, useNotebookWork, notebookWorkLimits, type NotebookWork } from './ui-notebook-work.js';
export { useLiveValues, liveValueLimits, type LiveSession, type LiveValues, type ValueLanguage } from './ui-values.js';
export type { KernelShell, SessionScope, UiClient, UiSnapshot } from './ui-base.js';

// What a page needs to place each view: its identity, what it calls to be readable, and its name.
// Running a cell, stopping a session or naming a place are checked when the person does them.
const reads: Record<keyof typeof viewPresentations, string[]> = {
  'rho.notebook': ['kernel.read'], 'rho.sessions': ['kernel.read'], 'rho.variables': ['kernel.read'], 'rho.plots': ['kernel.read', 'kernel.plot'],
  'rho.flow': ['kernel.read'], 'rho.servers': ['kernel.places'], 'rho.object': ['kernel.inspect'],
};
export const kernelEntries = Object.fromEntries(Object.entries(viewPresentations).map(([component, presentation]) => [component, {
  component, componentVersion: '1', owner: 'rho-plugins.kernel', package: '@rho-workspace/plugin-kernel',
  bindings: {}, requiredOperations: reads[component as keyof typeof viewPresentations], selection: [], displayName: presentation.displayName,
}])) as Record<keyof typeof viewPresentations, { component: string; componentVersion: string; owner: string; package: string; bindings: Record<string, never>; requiredOperations: string[]; selection: never[]; displayName: string }>;
