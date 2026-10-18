import type { EntryPresentation, PluginPresentation } from '@rho-workspace/plugin-contracts';

export const presentation: PluginPresentation = {
  categoryOrder: 30,
  order: 10,
  description: "Agent connects an external Claude Code session to the project. It shares exact resource context and records view bindings and observed activity; conversation and the model loop stay in Claude Code.",
  icon: {"background": "#EEEAFB", "color": "#5B47C2", "paths": ["M9 3v4M15 3v4M7 7h10v3.5a5 5 0 0 1-10 0zM12 15.5V21"]},
  dependencies: [{"pluginId": "documents", "purpose": "to share the current document buffer"}, {"pluginId": "files", "purpose": "to share registered resource versions"}],
  uses: "Claude Code through project-scoped MCP",
  developer: "Rho",
  license: "AGPL-3.0-only",
  links: [{"label": "Source", "url": "https://github.com/YuLab-SMU/Rho-plugins/tree/main/plugins/agent"}, {"label": "Privacy", "url": "https://github.com/YuLab-SMU/Rho-plugins/blob/main/PRIVACY.md"}],
  displayName: 'Agent',
  tagline: 'Connect Claude Code and hand it exact context',
  category: 'Working with your Agent',
  examplePrompts: [
    '“Use the rows I shared from results.csv as context.”',
    '“Which views have you opened in this project?”',
    "“Show what you've done in this project since this morning.”",
  ],
  viewNote: 'No view',
  readOnly: false, runsCode: false,
};
export const operationPresentation = {
  'context.create': { order: 10, displayName: 'Share and read context', description: "Prepares exact resource context for the bound Agent.", readOnly: false, runsCode: false },
  'context.read': { order: 20, displayName: 'Share and read context', description: "Reads shared context and records the fetch separately from a reply.", readOnly: true, runsCode: false },
  'binding.list': { order: 30, displayName: 'Open and close views', description: "Lists views bound to the Agent session.", readOnly: true, runsCode: false },
  'binding.open': { order: 40, displayName: 'Open and close views', description: "Opens a registered view on its resource context.", readOnly: false, runsCode: false },
  'binding.close': { order: 50, displayName: 'Open and close views', description: "Releases a view binding without cancelling its work.", readOnly: false, runsCode: false },
  'binding.activity': { order: 60, displayName: 'Activity', description: "Reads observed activity for the bound session.", readOnly: true, runsCode: false },
} satisfies Record<string, EntryPresentation>;

export const skillPresentation: EntryPresentation = {"displayName": "Agent workspace", "description": "Teaches Claude Code to fetch explicit context and preserve the original identity of changes."};
