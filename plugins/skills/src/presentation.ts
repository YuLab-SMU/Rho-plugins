import type { EntryPresentation, PluginPresentation } from '@rho-workspace/plugin-contracts';

export const presentation: PluginPresentation = {
  categoryOrder: 30,
  order: 28,
  description: "Skills are how work is done in this project: the methods you chose, the conventions you keep and the traps its work ran into, kept as SKILL.md files that every Agent here reads. Your Agent records what you decide and what it learns; each change says who made it, why and from what, and you can undo it.",
  icon: {"background": "#EEF0E4", "color": "#4F5A2E", "paths": ["M6.5 4.5h10a1.5 1.5 0 0 1 1.5 1.5v13.5h-10A1.5 1.5 0 0 1 6.5 18z", "M6.5 18a1.5 1.5 0 0 1 1.5-1.5h10", "M10 8.5h4.5", "M10 11.5h3"]},
  dependencies: [],
  developer: "Rho",
  license: "AGPL-3.0-only",
  links: [{"label": "Source", "url": "https://github.com/YuLab-SMU/Rho-plugins/tree/main/plugins/skills"}, {"label": "Privacy", "url": "https://github.com/YuLab-SMU/Rho-plugins/blob/main/PRIVACY.md"}],
  displayName: 'Skills',
  tagline: 'How work is done here, kept by your Agent and you',
  category: 'Working with your Agent',
  examplePrompts: [
    '“For this project we report proportions as percentages.”',
    '“What have you learned about how this project is done?”',
    '“Undo what you recorded about the frequency fits.”',
  ],
  viewNote: 'Its own page in each project',
  readOnly: false, runsCode: false,
};
export const operationPresentation = {
  'skills.list': { order: 10, displayName: 'List skills', description: "Lists the project's skills, what each is for and its newest change.", readOnly: true, runsCode: false },
  'skills.read': { order: 20, displayName: 'Read a skill', description: "Reads one skill and its changes, each with who made it, why and from what.", readOnly: true, runsCode: false },
  'skills.change': { order: 30, displayName: 'Record in a skill', description: "Writes a skill in the project: a new one, a change with its reason and evidence, or its removal.", readOnly: false, runsCode: false },
  'skills.undo': { order: 40, displayName: 'Undo a change', description: "Puts a skill back as it was before its newest change.", readOnly: false, runsCode: false },
} satisfies Record<string, EntryPresentation>;
