import type { EntryPresentation, PluginPresentation } from '@rho-workspace/plugin-contracts';

export const presentation: PluginPresentation = {
  displayName: 'Media',
  tagline: 'Images and PDFs, with regions you can point to',
  category: 'Figures & media',
  examplePrompts: [
    '“How many pages does report.pdf have, and what size are they?”',
    '“Check that the box I drew is inside page 3 of report.pdf.”',
    '“Describe figures/umap.png: format and dimensions.”',
  ],
  readOnly: true, runsCode: false,
};
export const operationPresentation = {
  'media.describe': { displayName: 'Describe an image or PDF and check regions', readOnly: true, runsCode: false },
} satisfies Record<string, EntryPresentation>;
export const viewPresentation: EntryPresentation = { displayName: 'Media', readOnly: true, runsCode: false };
