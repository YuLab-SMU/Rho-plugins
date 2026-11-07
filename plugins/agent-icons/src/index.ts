import { icons } from './catalog.generated.js';
import type { AgentIcon } from './types.js';

export type { AgentIcon };
export { icons };

// A name is whatever an Agent or its client called itself (an ACP agentInfo, an MCP
// clientInfo, a session name it chose) or a model maker's name. Its words are its runs of
// letters and digits; an alias matches whole consecutive words, so `dsh` matches
// `dsh-deepseek-agent` but not `dshell`.
const words = (name: string) => '-' + name.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean).join('-') + '-';

/** The first entry, in the catalog's order, with an alias among the name's words. */
export function agentIcon(name: string): AgentIcon | null {
  const text = words(name);
  return icons.find(icon => icon.aliases.some(alias => text.includes('-' + alias + '-'))) ?? null;
}

export function agentIconById(id: string): AgentIcon | null {
  return icons.find(icon => icon.id === id) ?? null;
}

/** The Agent product's own name when the catalog knows it, otherwise the name as given. */
export function agentName(name: string): string {
  const icon = agentIcon(name);
  return icon?.agent ? icon.name : name;
}
