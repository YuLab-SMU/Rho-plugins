import type { EntryPresentation, PluginPresentation } from '@rho-workspace/plugin-contracts';

export const presentation: PluginPresentation = {
  displayName: 'R',
  tagline: 'Run R scripts and read the objects they export',
  category: 'Code & data',
  examplePrompts: [
    '“Run analysis.R and tell me which objects it exported.”',
    '“Rerun fit.R with alpha = 0.1 and compare the estimate with the last run.”',
    '“Run my unsaved edits to clean.R without saving the file first.”',
  ],
  readOnly: false, runsCode: true,
};
export const operationPresentation = {
  'object.read': { displayName: 'Read an exported object', readOnly: true, runsCode: false },
  'action.submit': { displayName: 'Run a script', readOnly: false, runsCode: true },
} satisfies Record<string, EntryPresentation>;
export const viewPresentation: EntryPresentation = { displayName: 'Object', readOnly: true, runsCode: false };
