// Optional plain display entry. It owns no model loop, document or feedback.
import { layeredSchemas } from './layered-contract.js';
export { ActivityFeed, type ActivityFeedProps } from './ui-activity.js';
export { SessionProgress } from './ui-session.js';
interface Props { view: { props: Record<string, any> }; active: boolean }
export function AgentNote({ view }: Props) {
  return <section aria-label="Agent note" style={{ padding: '16px 22px', fontSize: 13, lineHeight: '19px', height: '100%', overflow: 'auto', overflowWrap: 'anywhere' }}>
    <h2 style={{ fontSize: 13, fontWeight: 600, margin: '0 0 9px' }}>Agent note</h2>
    <p style={{ whiteSpace: 'pre-wrap', margin: '0 0 12px' }}>{view.props.text}</p>
    <details style={{ fontSize: 12, color: 'var(--color-muted,#545e63)' }}><summary>Author and basis</summary><p>Presentation binding: {view.props.authorBindingId}</p><p>Binding witness: {view.props.basisWitnessId}</p><p>This note is an Agent explanation. Its basis records file integrity and table shape; it does not establish domain correctness.</p></details>
  </section>;
}
export const agentNoteEntry = { component: 'rho.agent-note', componentVersion: '0.2.0', owner: 'rho-plugins.agent', package: '@rho-workspace/plugin-agent', propsSchema: layeredSchemas.AgentNoteProps, bindings: {}, requiredOperations: [], selection: [] };
