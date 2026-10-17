import type { EntryPresentation, PluginPresentation } from '@rho-workspace/plugin-contracts';

export const presentation: PluginPresentation = {
  displayName: 'Tables',
  tagline: 'Browse and compare CSV or JSON tables',
  category: 'Code & data',
  examplePrompts: [
    '“Show rows of results.csv where p < 0.05, largest effect first.”',
    "“Join samples.csv and scores.csv on sample_id and list what didn't match.”",
    '“How many rows in results.csv have no score?”',
  ],
  readOnly: false, runsCode: false,
};
export const operationPresentation = {
  'data.page': { displayName: 'Page, sort and filter', readOnly: true, runsCode: false },
  'data.compare': { displayName: 'Compare two tables', readOnly: false, runsCode: false },
} satisfies Record<string, EntryPresentation>;
export const viewPresentation: EntryPresentation = { displayName: 'Table', readOnly: true, runsCode: false };
