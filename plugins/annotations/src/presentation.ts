import type { EntryPresentation, PluginPresentation } from '@rho-workspace/plugin-contracts';

export const presentation: PluginPresentation = {
  categoryOrder: 30,
  order: 20,
  description: "Comments attach to an exact code range or table entity and preserve the source version they refer to. Claude Code can read them and explicitly link a reply; making a comment available does not claim the Agent has read it.",
  icon: {"background": "#FBF2D8", "color": "#8A6A10", "paths": ["M5 5h14a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1h-8l-4 3v-3H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z"]},
  dependencies: [{"pluginId": "documents", "purpose": "to freeze comment and reply messages"}],
  developer: "Rho",
  license: "AGPL-3.0-only",
  links: [{"label": "Source", "url": "https://github.com/YuLab-SMU/Rho-plugins/tree/main/plugins/annotations"}, {"label": "Privacy", "url": "https://github.com/YuLab-SMU/Rho-plugins/blob/main/PRIVACY.md"}],
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
  'annotation.create': { order: 10, displayName: 'Create', description: "Submits a comment with its exact source anchor and message.", readOnly: false, runsCode: false },
  'annotation.list': { order: 20, displayName: 'List', description: "Lists comments and their reply state.", readOnly: true, runsCode: false },
  'annotation.read': { order: 30, displayName: 'Read', description: "Reads a comment and its retained source context.", readOnly: true, runsCode: false },
  'annotation.reply': { order: 40, displayName: 'Reply', description: "Links an explicit reply to a submitted comment.", readOnly: false, runsCode: false },
} satisfies Record<string, EntryPresentation>;

export const skillPresentation: EntryPresentation = {"displayName": "Annotation workspace", "description": "Teaches Claude Code to preserve versioned anchors and link replies to submitted comments."};
