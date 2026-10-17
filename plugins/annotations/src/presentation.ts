import type { EntryPresentation, PluginPresentation } from '@rho-workspace/plugin-contracts';

export const presentation: PluginPresentation = {
  displayName: 'Annotations',
  tagline: 'Comments the Agent can read and answer',
  category: 'Working with your Agent',
  examplePrompts: [
    '“Read my comments on clean.R and reply to each one.”',
    '“List the comments in this project that have no reply yet.”',
    '“Leave a note on line 42 of fit.R explaining the change.”',
  ],
  viewNote: 'Inside other views',
  readOnly: false, runsCode: false,
};
export const operationPresentation = {
  'annotation.create': { displayName: 'Create', readOnly: false, runsCode: false },
  'annotation.list': { displayName: 'List', readOnly: true, runsCode: false },
  'annotation.read': { displayName: 'Read', readOnly: true, runsCode: false },
  'annotation.reply': { displayName: 'Reply', readOnly: false, runsCode: false },
} satisfies Record<string, EntryPresentation>;
