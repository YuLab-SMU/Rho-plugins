import type { EntryPresentation, PluginPresentation } from '@rho-workspace/plugin-contracts';

export const presentation: PluginPresentation = {
  categoryOrder: 20,
  order: 10,
  description: "Charts binds two numeric columns from a table to a scatter plot. Every point traces to a stable row key at the selected table version, and any reduction in plotted points is reported.",
  icon: {"background": "#FBEEDF", "color": "#B0621C", "paths": ["M4 4v16h16"], "dots": [[9.5, 14.5], [13.5, 9], [17.5, 12.5]]},
  dependencies: [{"pluginId": "tables", "purpose": "to bind columns and row keys"}],
  developer: "Rho",
  license: "AGPL-3.0-only",
  links: [{"label": "Source", "url": "https://github.com/YuLab-SMU/Rho-plugins/tree/main/plugins/charts"}, {"label": "Privacy", "url": "https://github.com/YuLab-SMU/Rho-plugins/blob/main/PRIVACY.md"}],
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
  'data.plot': { order: 10, displayName: 'Plot two numeric columns', description: "Builds a scatter binding with explicit columns and point limits.", readOnly: true, runsCode: false },
} satisfies Record<string, EntryPresentation>;
export const viewPresentation: EntryPresentation = { description: "Shows a scatter plot whose points trace to their source rows.", displayName: 'Scatter', readOnly: true, runsCode: false };

export const skillPresentation: EntryPresentation = {"displayName": "Chart workspace", "description": "Teaches Claude Code to bind chart columns and keep point selections tied to stable rows."};
