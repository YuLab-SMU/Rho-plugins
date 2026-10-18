import type { EntryPresentation, PluginPresentation } from '@rho-workspace/plugin-contracts';

export const presentation: PluginPresentation = {
  categoryOrder: 10,
  order: 40,
  description: "Claude Code checks only the R packages explicitly declared for the selected work. Preparing missing packages is a separate action that uses the project library and does not silently change the system library.",
  icon: {"background": "#E1F1F2", "color": "#2F7480", "paths": ["M12 3 20 7.5v9L12 21l-8-4.5v-9z", "M4 7.5 12 12l8-4.5M12 12v9"]},
  uses: "The Rscript selected on this machine",
  developer: "Rho",
  license: "AGPL-3.0-only",
  links: [{"label": "Source", "url": "https://github.com/YuLab-SMU/Rho-plugins/tree/main/plugins/requirements"}, {"label": "Privacy", "url": "https://github.com/YuLab-SMU/Rho-plugins/blob/main/PRIVACY.md"}],
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
  'requirements.check': { order: 10, displayName: 'Check', description: "Checks the declared packages and reports the observed R environment.", readOnly: true, runsCode: false },
  'requirements.prepare': { order: 20, displayName: 'Install into the project', description: "Prepares missing declared packages in the project library.", readOnly: false, runsCode: true },
} satisfies Record<string, EntryPresentation>;

export const skillPresentation: EntryPresentation = {"displayName": "Requirements workspace", "description": "Teaches Claude Code to check declared dependencies and prepare missing packages explicitly."};
