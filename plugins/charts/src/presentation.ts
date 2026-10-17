import type { EntryPresentation, PluginPresentation } from '@rho-workspace/plugin-contracts';

export const presentation: PluginPresentation = {
  displayName: 'Charts',
  tagline: 'Plot columns; each point traces to its row',
  category: 'Figures & media',
  examplePrompts: [
    '“Plot score against age from results.csv.”',
    '“Which points have score above 2? List their rows.”',
    "“Plot the same columns from yesterday's version of results.csv.”",
  ],
  readOnly: true, runsCode: false,
};
export const operationPresentation = {
  'data.plot': { displayName: 'Plot two numeric columns', readOnly: true, runsCode: false },
} satisfies Record<string, EntryPresentation>;
export const viewPresentation: EntryPresentation = { displayName: 'Scatter', readOnly: true, runsCode: false };
