// Optional owner-authored copy, never an authorization or availability claim.
export interface EntryPresentation {
  displayName?: string;
  description?: string;
  order?: number;
  readOnly?: boolean;
  runsCode?: boolean;
}

export interface PluginPresentation extends EntryPresentation {
  icon?: { background: string; color: string; paths?: string[]; dots?: [number, number][]; text?: string };
  tagline?: string;
  category?: string;
  categoryOrder?: number;
  examplePrompts?: string[];
  viewNote?: string;
  developer?: string;
  license?: string;
  links?: { label: string; url: string }[];
  dependencies?: { pluginId: string; purpose: string }[];
  uses?: string;
}
