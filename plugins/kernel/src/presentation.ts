import type { EntryPresentation, PluginPresentation } from '@rho-workspace/plugin-contracts';

export const presentation: PluginPresentation = {
  categoryOrder: 30,
  order: 25,
  description: "A live R session and a live Python session for each project, on this machine or on one of your servers. The Agent runs code in them to look at data and try things, and so can you: each cell keeps its code, what it printed, its plots and who ran it, and the session's variables stay between cells. You can interrupt a cell or stop a session; the next cell starts a new one.",
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
    '“Run R on the lab server, in ~/projects/rnaseq, and load the counts there.”',
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
  'kernel.places': { order: 60, displayName: 'Read the places', description: "Reads the servers sessions can run on, where each language's next session starts, and the files copied from them.", readOnly: true, runsCode: false },
  'kernel.place.set': { order: 62, displayName: 'Name a place', description: "Names a folder on a server as a place sessions can run in, removes one, or chooses where R or Python runs next.", readOnly: false, runsCode: false },
  'kernel.place.check': { order: 64, displayName: 'Check a place', description: "Connects to a place and reports its system, its folder, and R and Python there.", readOnly: true, runsCode: false },
  'kernel.place.list': { order: 66, displayName: 'List files on a server', description: "Lists a folder within a place's folder on its server.", readOnly: true, runsCode: false },
  'kernel.place.copy': { order: 68, displayName: 'Copy a file from a server', description: "Copies one file from a place's folder into the project, under remote/<place>/, with its size, time and digest.", readOnly: false, runsCode: false },
  'kernel.servers': { order: 70, displayName: 'Read your servers', description: "Reads the servers you manage with serverctl and the skills bound to each.", readOnly: true, runsCode: false },
  'kernel.server.skill': { order: 72, displayName: "Read a server's skill", description: "Reads one skill bound to a server: how that server is used.", readOnly: true, runsCode: false },
} satisfies Record<string, EntryPresentation>;
