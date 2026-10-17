import type { EntryPresentation, PluginPresentation } from '@rho-workspace/plugin-contracts';

export const presentation: PluginPresentation = {
  displayName: 'Requirements',
  tagline: 'Check the R packages a script needs',
  category: 'Code & data',
  examplePrompts: [
    '“Check whether this project has the packages fit.R declares.”',
    "“Install the missing ones into this project's library.”",
    '“Which version of ggplot2 does this project use?”',
  ],
  viewNote: 'No view',
  readOnly: false, runsCode: true,
};
export const operationPresentation = {
  'requirements.check': { displayName: 'Check', readOnly: true, runsCode: false },
  'requirements.prepare': { displayName: 'Install into the project', readOnly: false, runsCode: true },
} satisfies Record<string, EntryPresentation>;
