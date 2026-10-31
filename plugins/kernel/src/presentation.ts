import type { EntryPresentation, PluginPresentation } from '@rho-workspace/plugin-contracts';

export const presentation: PluginPresentation = {
  categoryOrder: 30,
  order: 25,
  description: "A live R session and a live Python session for each project. The Agent runs code in them to look at data and try things, and so can you: each cell keeps its code, what it printed, its plots and who ran it, and the session's variables stay between cells. You can interrupt a cell or stop a session; the next cell starts a new one.",
  icon: {"background": "#E9EEF6", "color": "#33507A", "paths": ["M5 5.5h14a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-11a1 1 0 0 1 1-1z", "M8 9.5h3", "M8 12h6", "M8 14.5h4.5", "M16.5 9.25v1.5"]},
  dependencies: [],
  developer: "Rho",
  license: "AGPL-3.0-only",
  links: [{"label": "Source", "url": "https://github.com/YuLab-SMU/Rho-plugins/tree/main/plugins/kernel"}, {"label": "Privacy", "url": "https://github.com/YuLab-SMU/Rho-plugins/blob/main/PRIVACY.md"}],
  displayName: 'Notebook',
  tagline: 'Live R and Python the Agent and you share',
  category: 'Working with your Agent',
  examplePrompts: [
    '“Load the table in the R session and show me its columns.”',
    '“Fit the model in the session and keep it, so I can look at it.”',
    '“Which variables are in the Python session now?”',
  ],
  viewNote: 'Its own page in each project',
  readOnly: false, runsCode: true,
};
export const operationPresentation = {
  'kernel.run': { order: 10, displayName: 'Run a cell', description: "Runs code in the project's live R or Python session and keeps what it prints, its plots and the session's variables.", readOnly: false, runsCode: true },
  'kernel.read': { order: 20, displayName: 'Read the session', description: "Reads the sessions, their variables and the cells run in them.", readOnly: true, runsCode: false },
  'kernel.plot': { order: 30, displayName: 'Read a plot', description: "Reads one plot a cell drew, as a PNG image.", readOnly: true, runsCode: false },
  'kernel.inspect': { order: 35, displayName: 'Look at a value', description: "Describes one value of a live session: a table's rows and columns, a model's fit and coefficients, a list's parts, a vector's values, a function's code.", readOnly: true, runsCode: false },
  'kernel.interrupt': { order: 40, displayName: 'Interrupt a cell', description: "Stops the cell that is running; the session and its variables stay.", readOnly: false, runsCode: false },
  'kernel.stop': { order: 50, displayName: 'Stop a session', description: "Ends a session; its variables are gone.", readOnly: false, runsCode: false },
} satisfies Record<string, EntryPresentation>;
