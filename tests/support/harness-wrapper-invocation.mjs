// TEST ONLY. Registered MCP Tool.Info.execute, NOT the outer assistant pipeline.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

export const wrapperCommand = 'proceed-qualification-request';
export const qualificationLabel = 'Equal qualification label';

export async function invokeRegisteredProceed(context, invocation, signal, record) {
  // Command text/attachments cannot supply a decision, route or agent identity.
  assert.deepEqual(
    Object.keys(invocation.prompt).filter((k) => invocation.prompt[k] !== undefined),
    ['text'],
  );
  assert.equal(invocation.prompt.text, '');
  signal.throwIfAborted();
  const session = await context.session.get({ sessionID: invocation.sessionID });
  assert.equal(session.id, invocation.sessionID);
  assert.ok(
    session.agent,
    'GAP: host session has no selected agent. Select one through the public host interface, never fabricate one',
  );
  const agent = await context.agent.get({ agentID: session.agent });
  assert.equal(agent.data.id, session.agent);
  const tools = await context.tool.list();
  const find = (name) => {
    const found = tools.filter((t) => t.name === name && t.options?.namespace === 'proceed');
    assert.equal(found.length, 1, `expected one registered proceed/${name}`);
    return found[0];
  };
  const prepare = find('prepare_approval');
  const wait = find('request_approval');
  const synthetic = randomUUID();
  const call = async (tool, input, phase) => {
    signal.throwIfAborted();
    const coreCallID = `qualification-synthetic-${synthetic}-${phase}`;
    await record({
      phase: `${phase}-started`,
      sessionID: session.id,
      coreCallID,
      identity: 'synthetic-not-assistant',
    });
    // Unmodified registered executor retains its own permission.assert. There is
    // deliberately no permission hook, MCP client call, _meta or route injection.
    const value = await tool.execute(input, {
      sessionID: session.id,
      agent: agent.data.id,
      messageID: `qualification-synthetic-${synthetic}`,
      id: coreCallID,
      signal,
      progress: async () => {},
    });
    signal.throwIfAborted();
    // Private callback capture is Tool.Result, not JSON-RPC or HTTP command output.
    await record({ phase: `${phase}-returned`, sessionID: session.id, coreCallID, value });
    return value.output;
  };
  const prepared = await call(prepare, { session_label: qualificationLabel }, 'prepare');
  for (const name of ['request_handle', 'request_capability', 'request_id'])
    assert.ok(
      typeof prepared?.[name] === 'string' && prepared[name].length > 0,
      `missing preparation ${name}`,
    );
  await call(
    wait,
    {
      request_handle: prepared.request_handle,
      request_capability: prepared.request_capability,
      client_request_id: `qualification-${synthetic}`,
      action: 'Qualification action',
      context: `Distinct synthetic request ${synthetic}`,
      expires_in_seconds: 120,
    },
    'wait',
  );
}
