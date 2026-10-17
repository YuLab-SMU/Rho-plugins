import type { EntryPresentation, PluginPresentation } from '@rho-workspace/plugin-contracts';

export const presentation: PluginPresentation = {
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
  'resource.list': { displayName: 'List', readOnly: true, runsCode: false },
  'resource.read': { displayName: 'Read', readOnly: true, runsCode: false },
  'resource.register': { displayName: 'Register', readOnly: false, runsCode: false },
  'artifact.check': { displayName: 'Check outputs', readOnly: false, runsCode: false },
} satisfies Record<string, EntryPresentation>;
