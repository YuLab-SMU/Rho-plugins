import type { EntryPresentation, PluginPresentation } from '@rho-workspace/plugin-contracts';

export const presentation: PluginPresentation = {
  displayName: 'Documents',
  tagline: 'Open, edit and save code and notes, with undo',
  category: 'Code & data',
  examplePrompts: [
    '“Open clean.R and add a comment above each step.”',
    '“Undo your last edit to notes.md.”',
    '“Save notes.md, unless someone changed it on disk.”',
  ],
  readOnly: false, runsCode: false,
};
export const operationPresentation = {
  'document.open': { displayName: 'Open', readOnly: false, runsCode: false },
  'document.read': { displayName: 'Read', readOnly: true, runsCode: false },
  'document.edit': { displayName: 'Edit', readOnly: false, runsCode: false },
  'document.undo': { displayName: 'Undo', readOnly: false, runsCode: false },
  'document.save': { displayName: 'Save', readOnly: false, runsCode: false },
} satisfies Record<string, EntryPresentation>;
export const viewPresentation: EntryPresentation = { displayName: 'Editor', readOnly: false, runsCode: false };
