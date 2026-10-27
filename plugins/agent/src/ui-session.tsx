import type { SessionObservation } from './session-observation.js';

/** Agent-owned interpretation; the application supplies navigation and layout. */
export function SessionProgress({ observation }: { observation: SessionObservation }) {
  const { plan, usage, info } = observation;
  return <div className="session-progress">
    {info?.title && <p className="session-title">{info.title}</p>}
    {plan && <div className="session-plan">
      <p className="session-caption">Agent plan · {new Date(plan.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}{plan.origin === 'history' ? ' · loaded history' : ''}</p>
      {plan.entries.length ? <ol>{plan.entries.map((e, i) => <li key={i} data-status={e.status}><span aria-label={e.status.replace('_', ' ')}>{e.status === 'completed' ? '✓' : e.status === 'in_progress' ? '◉' : '○'}</span><span>{e.content}</span></li>)}</ol> : <p>No entries in the latest plan.</p>}
      {plan.omitted > 0 && <p>{plan.omitted} plan entries were not kept.</p>}
    </div>}
    {usage && <p className="session-usage">Context: {usage.used.toLocaleString()} / {usage.size.toLocaleString()} tokens{usage.cost ? ` · ${usage.cost.amount.toLocaleString(undefined, { maximumFractionDigits: 4 })} ${usage.cost.currency}` : ''}{usage.origin === 'history' ? ' · loaded history' : ''}</p>}
    <details className="session-basis"><summary>Observation details</summary>
      <p>{observation.connected ? 'Connected. Session updates remain visible between messages.' : 'Disconnected. Retained observations are shown; no message is sent by reading this view.'}</p>
      <p>Plans and tool outcomes are Agent reports. File observations and managed run results are checked separately.</p>
      <p>{observation.updates} updates observed · {observation.historyUpdates} from loaded history · {observation.omitted} items cut or omitted · {observation.unrepresented} updates without a display here.</p>
      <p>Reasoning and raw tool content are not retained. Mode, command, configuration, notice and compaction updates have no display here.</p>
    </details>
  </div>;
}
