// Protocol fault fixture. No model, user credentials or native Agent is involved.
import fs from 'node:fs';
import { createInterface } from 'node:readline';
const log = value => fs.appendFileSync(process.env.ACP_TEST_LOG, JSON.stringify(value) + '\n');
const send = value => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...value }) + '\n');
const update = (sessionId, value) => send({ method: 'session/update', params: { sessionId, update: value } });
let active, permission;
// Session settings in ACP form, only when a test asks for them.
let r_terminal = false;
let settings = process.env.ACP_CONFIG ? [
  { id: 'model', name: 'Model', category: 'model', type: 'select', currentValue: 'default', options: [{ group: 'gateway', name: 'Routing group', options: [{ value: 'default', name: 'Default (recommended)' }, { value: 'auto/deepseek-v4.1-flash', name: 'DeepSeek V4.1 Flash · routing group', description: 'via gateway' }] }, { group: 'hpc', name: 'WestlakeHPC', options: [{ value: 'westlakehpc/glm-5.3-flash', name: 'GLM-5.3-Flash · WestlakeHPC' }] }] },
  { id: 'effort', name: 'Effort', category: 'thought_level', type: 'select', currentValue: 'high', options: [{ value: 'low', name: 'Low' }, { value: 'high', name: 'High' }, { value: 'max', name: 'Max' }] },
  { id: 'fast', name: 'Fast mode', category: 'model_config', type: 'boolean', currentValue: false },
] : undefined;
log({ kind: 'spawn', pid: process.pid });
createInterface({ input: process.stdin }).on('line', line => {
  const r = JSON.parse(line), p = r.params;
  const reply = result => send({ id: r.id, result });
  if (!r.method) { if (permission) { log({ kind: 'choice', result: r.result }); permission(); permission = null; } return; }
  log({ kind: r.method, session: p?.sessionId, text: p?.prompt?.[0]?.text, ...(r.method === 'session/new' ? { claudeMetadata: !!p?._meta?.claudeCode, plugins: p?._meta?.claudeCode?.options?.plugins } : {}) });
  if (r.method === 'initialize') r_terminal = p?.clientCapabilities?._meta?.terminal_output === true;
  if (r.method === 'initialize') return reply({ protocolVersion: 1, agentInfo: { name: 'fault-fixture', version: '1' }, agentCapabilities: { loadSession: !process.env.ACP_NO_LOAD, ...(process.env.ACP_CAN_CLOSE ? { sessionCapabilities: { close: {}, delete: {} } } : {}) } });
  if (r.method === 'session/close' || r.method === 'session/delete') return reply({});
  if (r.method === 'session/new') return reply({ sessionId: 'original-session', ...(settings ? { configOptions: settings } : {}) });
  if (r.method === 'session/set_config_option') {
    log({ kind: 'set', configId: p.configId, value: p.value });
    const option = settings?.find(x => x.id === p.configId);
    if (!option) return send({ id: r.id, error: { code: -32602, message: 'Unknown setting' } });
    option.currentValue = p.value;
    return reply({ configOptions: settings });
  }
  if (r.method === 'session/load') { if (settings) { setTimeout(() => reply({ configOptions: settings }), 0); update(p.sessionId, { sessionUpdate: 'plan', entries: [] }); return; } update(p.sessionId, { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'replayed history' } }); update(p.sessionId, { sessionUpdate: 'plan', entries: [{ content: 'Historical plan', priority: 'medium', status: 'completed' }] }); return reply({}); }
  if (r.method === 'session/cancel') { if (active && !process.env.ACP_NO_CANCEL) { permission = null; send({ id: active, result: { stopReason: 'cancelled' } }); active = null; } return; }
  if (r.method === 'session/prompt') {
    active = r.id; const text = p.prompt[0].text;
    if (text === 'which model') { update(p.sessionId, { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'model ' + settings?.find(x => x.id === 'model')?.currentValue }, messageId: 'm' }); active = null; return reply({ stopReason: 'end_turn' }); }
    if (text === 'wrong-session') { update('different-session', { sessionUpdate: 'plan', entries: [] }); return; }
    if (text === 'observe') {
      update(p.sessionId, { sessionUpdate: 'plan', entries: [{ content: 'Read shared notes 你好', priority: 'high', status: 'in_progress' }] });
      update(p.sessionId, { sessionUpdate: 'usage_update', used: 128, size: 4096, cost: { amount: 0.125, currency: 'EUR' } });
      update(p.sessionId, { sessionUpdate: 'tool_call', toolCallId: 'read-notes', title: 'Read the shared notes', name: 'Read', kind: 'read', status: 'in_progress', rawInput: { file_path: process.cwd() + '/project-notes.md' }, locations: [{ path: process.cwd() + '/project-notes.md' }] });
      update(p.sessionId, { sessionUpdate: 'tool_call', toolCallId: 'run-analysis', title: 'Run the analysis', kind: 'execute', status: 'in_progress', rawInput: { command: 'Rscript analysis.R --input data.csv' } });
      setTimeout(() => {
        update(p.sessionId, { sessionUpdate: 'tool_call_update', toolCallId: 'read-notes', status: 'completed' });
        update(p.sessionId, { sessionUpdate: 'tool_call_update', toolCallId: 'run-analysis', status: 'failed' });
        update(p.sessionId, { sessionUpdate: 'plan', entries: [{ content: 'Idle replacement', priority: 'low', status: 'completed' }] });
        update(p.sessionId, { sessionUpdate: 'session_info_update', title: 'Idle title 你好' });
      }, 40);
    }
    update(p.sessionId, { sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: 'private reasoning fixture' } });
    update(p.sessionId, { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'retained ' }, messageId: 'one' });
    if (text === 'disconnect') { log({ kind: 'effect' }); process.exit(7); }
    if (text === 'oversize') { process.stdout.write('x'.repeat(8192)); return; }
    if (text === 'command' && r_terminal) {
      // Claude's adapter with the terminal extension: output, then exit and status.
      const run = (id, command, data, exit, status) => {
        update(p.sessionId, { sessionUpdate: 'tool_call', toolCallId: id, title: command, kind: 'execute', status: 'pending', rawInput: { command }, _meta: { terminal_info: { terminal_id: id }, claudeCode: { toolName: 'Bash' } } });
        update(p.sessionId, { sessionUpdate: 'tool_call_update', toolCallId: id, _meta: { terminal_output: { terminal_id: id, data } } });
        update(p.sessionId, { sessionUpdate: 'tool_call_update', toolCallId: id, status, content: [{ type: 'terminal', terminalId: id }], _meta: { claudeCode: { toolName: 'Bash' }, terminal_exit: { terminal_id: id, exit_code: exit, signal: null } } });
      };
      run('fit', 'rtk python3 analysis.py', Array.from({ length: 30 }, (_, i) => '\u001b[1mrow ' + i + '\u001b[0m 臭氧').join('\n') + '\n', 0, 'completed');
      run('bad', 'Rscript model.R', 'Error in lm(y ~ x): object not found\nExecution halted\n', 1, 'failed');
      run('lost', 'sleep 9', '', null, 'failed');
      run('script', "cd data && python3 - <<'PY'\r\nimport csv\nprint(len(list(csv.reader(open('a.csv')))))\nPY", '3\n', 0, 'completed');
    }
    if (text === 'wait') { update(p.sessionId, { sessionUpdate: 'tool_call', toolCallId: 'slow', title: 'Waiting', status: 'in_progress' }); return; }
    if (text === 'rho-permission') {
      update(p.sessionId,{sessionUpdate:'tool_call',toolCallId:'tool',title:'mcp.rho.rho_call',status:'pending',rawInput:{operation:'context.read'}});
      permission=()=>{update(p.sessionId,{sessionUpdate:'tool_call_update',toolCallId:'tool',status:'completed'});active=null;reply({stopReason:'end_turn'});};
      send({id:'permission-rho',method:'session/request_permission',params:{sessionId:p.sessionId,toolCall:{toolCallId:'tool',status:'pending'},options:[{optionId:'allow',name:'Allow once',kind:'allow_once'},{optionId:'deny',name:'Reject',kind:'reject_once'}]}});return;
    }
    if (text === 'permission') {
      permission = () => { update(p.sessionId, { sessionUpdate: 'tool_call_update', toolCallId: 'tool', status: 'completed' }); active = null; reply({ stopReason: 'end_turn' }); };
      send({ id: 'permission-1', method: 'session/request_permission', params: { sessionId: p.sessionId, toolCall: { toolCallId: 'tool', title: 'Write a test file', status: 'pending' }, options: [{ optionId: 'allow', name: 'Allow once', kind: 'allow_once' }, { optionId: 'deny', name: 'Reject', kind: 'reject_once' }] } }); return;
    }
    update(p.sessionId, { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text }, messageId: 'one' });
    active = null; reply({ stopReason: 'end_turn' });
  }
});
