export interface ActivityEntry { cursor: number; received_at_ms?: number; event: { sequence: number; kind: string; data: Record<string, any> } }
export function summarizeActivity(entries: ActivityEntry[]) {
  const calls = new Map<string, any>(), turns: any[] = [];
  for (const {cursor, event: e} of entries) {
    const d = e.data;
    if (e.kind.startsWith('turn.')) { turns.push({cursor,kind:e.kind,reason:d.native_reason ?? null}); continue; }
    if (!d.call_id) continue;
    let c = calls.get(d.call_id);
    if (!c) { c = {call_id:d.call_id,tool:null,input:null,requested:false,returned:false,tool_error:null,exit_code:null,exit_basis:null,observation:'result-unknown',result_detail:null,denial_kind:null,truncated:false,redacted:false,evidence:[]}; calls.set(d.call_id,c); }
    c.evidence.push({cursor, native_id:d.native_id});
    c.truncated ||= d.truncated === true; c.redacted ||= d.redacted === true;
    if (e.kind === 'tool.requested') { c.requested = true; c.tool = d.tool; c.input = d.input; }
    if (e.kind === 'tool.returned' || e.kind === 'tool.rejected') {
      c.returned = true; c.tool_error = d.tool_error; c.observation = e.kind === 'tool.rejected' ? 'rejected' : 'tool-returned';
      c.result_detail = d.detail ?? null; c.denial_kind = d.denial_kind ?? null;
    }
    if (Number.isInteger(d.exit_code)) { c.exit_code = d.exit_code; c.exit_basis = d.exit_basis; }
  }
  return {parser: 'rho-agent-summary/1', calls:[...calls.values()], turns};
}
