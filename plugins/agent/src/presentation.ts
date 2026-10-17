import type { EntryPresentation, PluginPresentation } from '@rho-workspace/plugin-contracts';

export const presentation: PluginPresentation = {
  displayName: 'Agent',
  tagline: 'Connect Claude Code and hand it exact context',
  category: 'Working with your Agent',
  examplePrompts: [
    '“Use the rows I shared from results.csv as context.”',
    '“Which views have you opened in this project?”',
    "“Show what you've done in this project since this morning.”",
  ],
  viewNote: 'No view',
  readOnly: false, runsCode: false,
};
export const operationPresentation = {
  'context.create': { displayName: 'Share and read context', readOnly: false, runsCode: false },
  'context.read': { displayName: 'Share and read context', readOnly: true, runsCode: false },
  'binding.list': { displayName: 'Open and close views', readOnly: true, runsCode: false },
  'binding.open': { displayName: 'Open and close views', readOnly: false, runsCode: false },
  'binding.close': { displayName: 'Open and close views', readOnly: false, runsCode: false },
  'binding.activity': { displayName: 'Activity', readOnly: true, runsCode: false },
} satisfies Record<string, EntryPresentation>;
