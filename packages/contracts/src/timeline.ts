import { objectSchema as obj, text } from './common.js';

// What a plugin's records say someone did, handed to the application's timeline: who did it,
// what, when it began and ended, and how it ended as the plugin observed it. The plugin keeps
// the record and its meaning; the timeline draws the events beside what Agents' conversations
// record. `by` is the caller as the host named it; `where` says, in the plugin's words, where it
// was done.
export const timelineActions = ['run'] as const;
export const timelineOutcomes = ['running', 'done', 'failed', 'stopped', 'unknown'] as const;
export interface TimelineEvent {
  id: string; by: string; action: typeof timelineActions[number]; label: string; where: string | null;
  startedAt: string; endedAt: string | null; outcome: typeof timelineOutcomes[number];
}
export const timelineLabelChars = 200;
export const timelineEventSchema = obj({
  id: text, by: text, action: { enum: [...timelineActions] }, label: { type: 'string', maxLength: timelineLabelChars },
  where: { anyOf: [{ type: 'string', maxLength: 120 }, { type: 'null' }] },
  startedAt: text, endedAt: { anyOf: [text, { type: 'null' }] }, outcome: { enum: [...timelineOutcomes] },
});
// A plugin's events read: the newest events first, at most limit, with how many older ones it
// left out. Reading starts nothing.
export const timelineContract = {
  inputSchema: obj({ limit: { type: 'integer', minimum: 1, maximum: 500 } }, []),
  outputSchema: obj({ events: { type: 'array', items: timelineEventSchema }, omitted: { type: 'integer', minimum: 0 } }),
  requires: [] as string[], effect: 'read' as const,
};
// A line of text as a label: its first line that says something, cut to the label's length.
export function timelineLabel(text: string, fallback: string) {
  const line = text.split('\n').map(l => l.trim()).find(l => l && !l.startsWith('#')) ?? fallback;
  return line.length > timelineLabelChars ? line.slice(0, timelineLabelChars - 1).trimEnd() + '…' : line;
}
