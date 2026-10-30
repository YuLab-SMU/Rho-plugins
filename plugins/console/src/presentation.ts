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
  'console.output': { order: 30, displayName: 'Read output', description: "Reads what a command printed, page by page.", readOnly: true, runsCode: false },
  'console.stop': { order: 40, displayName: 'Stop a command', description: "Asks a running command and the processes it started to stop.", readOnly: false, runsCode: false },
} satisfies Record<string, EntryPresentation>;
