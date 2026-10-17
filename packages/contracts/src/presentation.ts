// Optional owner-authored copy, never an authorization or availability claim.
export interface EntryPresentation {
  displayName?: string;
  readOnly?: boolean;
  runsCode?: boolean;
}

export interface PluginPresentation extends EntryPresentation {
  tagline?: string;
  category?: string;
  examplePrompts?: string[];
  viewNote?: string;
}
