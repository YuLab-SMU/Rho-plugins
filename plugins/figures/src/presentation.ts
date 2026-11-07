import type { EntryPresentation, PluginPresentation } from '@rho-workspace/plugin-contracts';

export const presentation: PluginPresentation = {
  categoryOrder: 20,
  order: 15,
  description: "A ggplot drawn in the project's live R session, by you or the Agent, is kept with every point, bar, box, line and label bound to the row of data it was drawn from. It works for any plot built on ggplot2 (ggtree, enrichplot, Seurat, patchwork and the rest) with no setup. Point at a mark to read its row, select marks by clicking or dragging, and ask the Agent about them: your message carries the exact rows. The Agent reads what a plot actually drew and can mark points for you with a note.",
  icon: {"background": "#E8F2EE", "color": "#2F6B57", "paths": ["M4.5 19.5h15", "M4.5 19.5v-15", "M8 15.5a1.25 1.25 0 1 0 0-.01", "M12 10.5a1.25 1.25 0 1 0 0-.01", "M16.5 13a1.25 1.25 0 1 0 0-.01", "M14.5 6.5h5v5h-5z"]},
  dependencies: [{"pluginId": "kernel", "purpose": "to describe the plots its live R session draws"}],
  developer: "Rho",
  license: "AGPL-3.0-only",
  links: [{"label": "Source", "url": "https://github.com/YuLab-SMU/Rho-plugins/tree/main/plugins/figures"}, {"label": "Privacy", "url": "https://github.com/YuLab-SMU/Rho-plugins/blob/main/PRIVACY.md"}],
  displayName: 'Figures',
  tagline: 'Plots whose marks know their data',
  category: 'Figures & media',
  examplePrompts: [
    '“Draw the volcano plot in the notebook; I will select the genes I care about.”',
    '“What do the points I selected have in common?”',
    '“Mark the genes in this plot with padj below 0.01 and say why they stand out.”',
    '“Did the last plot drop any rows? Check what it actually drew.”',
  ],
  viewNote: 'In the Notebook and Plots, on every ggplot',
  readOnly: false, runsCode: false,
};
export const operationPresentation = {
  'figure.read': { order: 10, displayName: 'Read a figure', description: "Reads what a plot drew: its layers, mappings, panels and data, the rows behind marks, and the marks people selected.", readOnly: true, runsCode: false },
  'figure.select': { order: 20, displayName: 'Mark points in a figure', description: "Keeps a set of marks with a note, shown highlighted in the plot. It changes neither the plot nor its data.", readOnly: false, runsCode: false },
} satisfies Record<string, EntryPresentation>;
export const skillPresentation: EntryPresentation = { displayName: 'Figures', description: 'Teaches the Agent to read what a plot drew, the rows behind its marks and the person\'s selections, and to point at marks.' };
