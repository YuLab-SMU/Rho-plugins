import type { EntryPresentation, PluginPresentation } from '@rho-workspace/plugin-contracts';

export const presentation: PluginPresentation = {
  categoryOrder: 30,
  order: 30,
  description: "The Console lists the commands run in a project — the Agent's, from its own reports, and yours — with how each ended, how long it took and what it printed. You can run a command in the project folder yourself, run one again or stop it. It runs only for the person at this machine.",
  icon: {"background": "#E8ECEF", "color": "#3E4C57", "paths": ["M4.5 5.5h15a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1h-15a1 1 0 0 1-1-1v-11a1 1 0 0 1 1-1z", "m7.5 9.5 2.5 2.5-2.5 2.5", "M12 14.5h4.5"]},
  dependencies: [],
  developer: "Rho",
  license: "AGPL-3.0-only",
  links: [{"label": "Source", "url": "https://github.com/YuLab-SMU/Rho-plugins/tree/main/plugins/console"}, {"label": "Privacy", "url": "https://github.com/YuLab-SMU/Rho-plugins/blob/main/PRIVACY.md"}],
  displayName: 'Console',
  tagline: 'Every command run in the project, and yours',
  category: 'Working with your Agent',
  examplePrompts: [
    '“Run the analysis script again and show me what it printed.”',
    '“Which command wrote results/summary.csv?”',
    '“Why did the last command fail?”',
  ],
  viewNote: 'Its own page in each project',
  readOnly: false, runsCode: true,
};
export const operationPresentation = {
  'console.run': { order: 10, displayName: 'Run a command', description: "Runs a command you typed in the project folder and keeps what it prints.", readOnly: false, runsCode: true },
  'console.list': { order: 20, displayName: 'List commands', description: "Lists the commands run here, newest first, with how each ended.", readOnly: true, runsCode: false },
  'console.events': { order: 25, displayName: 'Read who ran what', description: "Lists the commands run here, newest first: who ran each, when, in which folder and how it ended.", readOnly: true, runsCode: false },
  'console.output': { order: 30, displayName: 'Read output', description: "Reads what a command printed, page by page.", readOnly: true, runsCode: false },
  'console.stop': { order: 40, displayName: 'Stop a command', description: "Asks a running command and the processes it started to stop.", readOnly: false, runsCode: false },
  'console.terminal.open': { order: 50, displayName: 'Open a terminal', description: "Starts a shell on a terminal in the project folder. You and the Agent can both read and type in it.", readOnly: false, runsCode: true },
  'console.terminal.list': { order: 52, displayName: 'List terminals', description: "Lists the open terminals, with who opened each and who last typed there.", readOnly: true, runsCode: false },
  'console.terminal.screen': { order: 53, displayName: 'Read a terminal\'s screen', description: "Reads what a terminal shows now as text, after waiting for a command's output to settle.", readOnly: true, runsCode: false },
  'console.terminal.commands': { order: 55, displayName: 'List terminal commands', description: "Lists the commands run in the terminals, newest first: who typed each, where, how it ended and what it printed.", readOnly: true, runsCode: false },
  'console.terminal.output': { order: 56, displayName: 'Read a terminal command\'s output', description: "Reads all a terminal command printed that is kept, in pages, and the screens a full-screen program drew.", readOnly: true, runsCode: false },
  'console.terminal.read': { order: 54, displayName: 'Read a terminal', description: "Reads what a terminal printed since the last read, for the page that draws it.", readOnly: true, runsCode: false },
  'console.terminal.write': { order: 56, displayName: 'Type in a terminal', description: "Sends typed text to the terminal's shell, as if typed there.", readOnly: false, runsCode: true },
  'console.terminal.resize': { order: 57, displayName: 'Size a terminal', description: "Tells the terminal how many columns and rows the page shows.", readOnly: false, runsCode: false },
  'console.terminal.close': { order: 58, displayName: 'Close a terminal', description: "Hangs up the terminal's shell, as closing a terminal window does.", readOnly: false, runsCode: false },
} satisfies Record<string, EntryPresentation>;
