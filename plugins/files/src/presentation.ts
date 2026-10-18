import type { EntryPresentation, PluginPresentation } from '@rho-workspace/plugin-contracts';

export const presentation: PluginPresentation = {
  categoryOrder: 40,
  order: 10,
  description: "Files keeps references to project files and the exact bytes registered as outputs. Claude Code can read bounded parts of a file and check a run against its declared outputs.",
  icon: {"background": "#ECEFF2", "color": "#4F5B63", "paths": ["M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"]},
  developer: "Rho",
  license: "AGPL-3.0-only",
  links: [{"label": "Source", "url": "https://github.com/YuLab-SMU/Rho-plugins/tree/main/plugins/files"}, {"label": "Privacy", "url": "https://github.com/YuLab-SMU/Rho-plugins/blob/main/PRIVACY.md"}],
  displayName: 'Files',
  tagline: "Keep each file's versions and check run outputs",
  category: 'Project files',
  examplePrompts: [
    "“List the files in data/ and which version of each you're using.”",
    '“Check that the last run produced every output it declared.”',
    "“Add figures/umap.png to this project's outputs.”",
  ],
  viewNote: 'No view',
  readOnly: false, runsCode: false,
};
export const operationPresentation = {
  'resource.list': { order: 10, displayName: 'List', description: "Lists the project files and versions registered with Rho.", readOnly: true, runsCode: false },
  'resource.read': { order: 20, displayName: 'Read', description: "Reads a bounded part of a registered file.", readOnly: true, runsCode: false },
  'resource.register': { order: 30, displayName: 'Register', description: "Registers a project file with its version and provenance.", readOnly: false, runsCode: false },
  'artifact.check': { order: 40, displayName: 'Check outputs', description: "Checks declared outputs for completeness and byte integrity.", readOnly: false, runsCode: false },
} satisfies Record<string, EntryPresentation>;

export const skillPresentation: EntryPresentation = {"displayName": "File workspace", "description": "Teaches Claude Code to register versioned files, read bounded bytes and check declared outputs."};
