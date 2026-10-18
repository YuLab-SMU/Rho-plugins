import type { EntryPresentation, PluginPresentation } from '@rho-workspace/plugin-contracts';

export const presentation: PluginPresentation = {
  categoryOrder: 10,
  order: 20,
  description: "Claude Code can run an R script you've saved, or the version you're still editing, with the inputs and outputs you name. Each run keeps the exact code and arguments it used, so you can see what ran and find the same run again after a reconnect. Objects a script exports can be opened later without running anything again.",
  icon: {"background": "#E2ECF7", "color": "#2766B0", "text": "R"},
  dependencies: [{"pluginId": "files", "purpose": "always"}, {"pluginId": "requirements", "purpose": "to run scripts"}],
  uses: "The Rscript selected on this machine",
  developer: "Rho",
  license: "AGPL-3.0-only",
  links: [{"label": "Source", "url": "https://github.com/YuLab-SMU/Rho-plugins/tree/main/plugins/r"}, {"label": "Privacy", "url": "https://github.com/YuLab-SMU/Rho-plugins/blob/main/PRIVACY.md"}],
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
  'object.read': { order: 10, displayName: 'Read an exported object', description: "Opens a result a script saved earlier. Nothing runs.", readOnly: true, runsCode: false },
  'action.submit': { order: 20, displayName: 'Run a script', description: "Runs a saved script or your unsaved edits, with the inputs it names.", readOnly: false, runsCode: true },
} satisfies Record<string, EntryPresentation>;
export const viewPresentation: EntryPresentation = { description: "Shows an exported object in a layout, next to the code and data.", displayName: 'Object', readOnly: true, runsCode: false };

export const skillPresentation: EntryPresentation = {"displayName": "R workspace", "description": "Teaches Claude Code to read exported objects and to start runs it can find again later."};
