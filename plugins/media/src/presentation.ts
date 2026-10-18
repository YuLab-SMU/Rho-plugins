import type { EntryPresentation, PluginPresentation } from '@rho-workspace/plugin-contracts';

export const presentation: PluginPresentation = {
  categoryOrder: 20,
  order: 20,
  description: "Media reads the original image or PDF and its metadata. A region is checked against the selected image or page dimensions so a shared mark stays tied to that exact source.",
  icon: {"background": "#F3E9F2", "color": "#8A4A7C", "paths": ["M5.5 4.5h13a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2v-11a2 2 0 0 1 2-2z", "m4 18 5-5 4 4 3-3 4 4"]},
  dependencies: [{"pluginId": "files", "purpose": "to read registered images and PDFs"}],
  developer: "Rho",
  license: "AGPL-3.0-only",
  links: [{"label": "Source", "url": "https://github.com/YuLab-SMU/Rho-plugins/tree/main/plugins/media"}, {"label": "Privacy", "url": "https://github.com/YuLab-SMU/Rho-plugins/blob/main/PRIVACY.md"}],
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
  'media.describe': { order: 10, displayName: 'Describe an image or PDF and check regions', description: "Reads image or PDF metadata and validates a region on its source page.", readOnly: true, runsCode: false },
} satisfies Record<string, EntryPresentation>;
export const viewPresentation: EntryPresentation = { description: "Shows an image or PDF with its original source reference.", displayName: 'Media', readOnly: true, runsCode: false };

export const skillPresentation: EntryPresentation = {"displayName": "Media workspace", "description": "Teaches Claude Code to inspect original media metadata and validate coordinate regions."};
