import type { EntryPresentation, PluginPresentation } from '@rho-workspace/plugin-contracts';

export const presentation: PluginPresentation = {
  categoryOrder: 10,
  order: 30,
  description: "Tables reads CSV and JSON using declared column types, null values and stable row keys. Claude Code can page, sort and filter rows or compare two tables while keeping their source versions.",
  icon: {"background": "#E5F2EA", "color": "#2F7A55", "paths": ["M5.5 4.5h13a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2v-11a2 2 0 0 1 2-2z", "M3.5 10h17M3.5 15h17M9.5 4.5v15"]},
  dependencies: [{"pluginId": "files", "purpose": "to read registered tables"}],
  developer: "Rho",
  license: "AGPL-3.0-only",
  links: [{"label": "Source", "url": "https://github.com/YuLab-SMU/Rho-plugins/tree/main/plugins/tables"}, {"label": "Privacy", "url": "https://github.com/YuLab-SMU/Rho-plugins/blob/main/PRIVACY.md"}],
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
  'data.page': { order: 10, displayName: 'Page, sort and filter', description: "Reads a bounded page with the selected sort and filter.", readOnly: true, runsCode: false },
  'data.compare': { order: 20, displayName: 'Compare two tables', description: "Joins two table versions on declared keys and reports unmatched rows.", readOnly: false, runsCode: false },
} satisfies Record<string, EntryPresentation>;
export const viewPresentation: EntryPresentation = { description: "Shows table rows with their declared types and stable keys.", displayName: 'Table', readOnly: true, runsCode: false };

export const skillPresentation: EntryPresentation = {"displayName": "Table workspace", "description": "Teaches Claude Code to use declared types, stable keys and exact table versions."};
