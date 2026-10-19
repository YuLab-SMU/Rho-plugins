import type { EntryPresentation, PluginPresentation } from '@rho-workspace/plugin-contracts';

export const presentation: PluginPresentation = {
  categoryOrder: 10,
  order: 10,
  description: "Claude Code and you work on the same code and notes. Edits keep their undo history, and saving checks whether the file changed on disk before replacing it.",
  icon: {"background": "#E8EEFD", "color": "#2F55C8", "paths": ["M6 3h8l4 4v14H6z", "M10.5 12 8.5 14l2 2M13.5 12l2 2-2 2"]},
  developer: "Rho",
  license: "AGPL-3.0-only",
  links: [{"label": "Source", "url": "https://github.com/YuLab-SMU/Rho-plugins/tree/main/plugins/documents"}, {"label": "Privacy", "url": "https://github.com/YuLab-SMU/Rho-plugins/blob/main/PRIVACY.md"}],
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
  'document.open': { order: 10, displayName: 'Open', description: "Opens a project file in its shared editing buffer.", readOnly: false, runsCode: false },
  'document.read': { order: 20, displayName: 'Read', description: "Reads the current buffer, including unsaved edits.", readOnly: true, runsCode: false },
  'document.edit': { order: 30, displayName: 'Edit', description: "Changes the shared buffer at the expected version.", readOnly: false, runsCode: false },
  'document.undo': { order: 40, displayName: 'Undo', description: "Reverses an edit group in the shared buffer.", readOnly: false, runsCode: false },
  'document.undoOwn': { order: 41, displayName: 'Undo my edits', description: "Reverses the caller's latest retained edit group while preserving other edits; overlapping later changes are refused.", readOnly: false, runsCode: false },
  'document.revert': { order: 42, displayName: 'Revert one change', description: "Reverses a specified retained edit without replacing the whole buffer.", readOnly: false, runsCode: false },
  'document.history': { order: 21, displayName: 'Read change history', description: "Lists retained document changes and their authenticated authors.", readOnly: true, runsCode: false },
  'document.change.read': { order: 22, displayName: 'Read a change', description: "Reads exact before and after text for a retained change.", readOnly: true, runsCode: false },
  'document.save': { order: 50, displayName: 'Save', description: "Saves the buffer after checking for changes on disk.", readOnly: false, runsCode: false },
  'document.abandonSave': { order: 60, displayName: 'Give up an interrupted save', description: "Drops an interrupted save that can no longer finish because the file changed on disk. The file and your edits stay as they are.", readOnly: false, runsCode: false },
} satisfies Record<string, EntryPresentation>;
export const viewPresentation: EntryPresentation = { description: "Shows the shared code or note buffer in a layout.", displayName: 'Editor', readOnly: false, runsCode: false };

export const skillPresentation: EntryPresentation = {"displayName": "Document workspace", "description": "Teaches Claude Code to use the shared buffer, preserve undo and check for changes before saving."};
