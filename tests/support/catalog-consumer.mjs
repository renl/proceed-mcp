// TEST ONLY: strict bounded catalog consumer, never imported by production.
import assert from 'node:assert/strict';

const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
export function successful(outcome) {
  assert.equal(outcome.kind, 'response', 'matching protocol response required');
  const frame = outcome.frame;
  assert.equal(frame.jsonrpc, '2.0');
  assert.ok(Object.hasOwn(frame, 'result') && !Object.hasOwn(frame, 'error'),
    'success must contain result and no error');
  assert.ok(object(frame.result), 'result must be an object');
  return frame.result;
}

export function initializeResult(outcome) {
  const result = successful(outcome);
  assert.equal(result.protocolVersion, '2025-11-25');
  assert.ok(object(result.serverInfo));
  assert.equal(typeof result.serverInfo.name, 'string');
  assert.equal(typeof result.serverInfo.version, 'string');
  assert.ok(object(result.capabilities) && object(result.capabilities.tools),
    'tools capability must be an object');
  return result;
}

export async function allTools(peer) {
  const tools = [];
  const seen = new Set();
  let cursor;
  for (let page = 0; page < 32; page++) {
    const result = successful(await peer.call('tools/list', cursor === undefined ? {} : { cursor }).outcome);
    assert.ok(Array.isArray(result.tools), 'catalog tools must be an array');
    tools.push(...result.tools);
    assert.ok(tools.length <= 128, 'catalog tool limit');
    if (!Object.hasOwn(result, 'nextCursor')) return tools;
    assert.equal(typeof result.nextCursor, 'string', 'nextCursor must be a string');
    assert.ok(!seen.has(result.nextCursor), 'repeated catalog cursor');
    cursor = result.nextCursor;
    seen.add(cursor);
  }
  assert.fail('catalog page limit');
}

// Semantic concepts, not a required sentence/template. Alternate wording may be
// reviewed here without weakening design 3's prepare/wait/privacy requirements.
export function workflowInstructions(init, tools) {
  const text = [init.instructions ?? '', ...tools.map(tool => tool.description ?? '')].join('\n');
  const clauses = [
    [/prepare_approval[\s\S]*(?:before|then|first|follow)[\s\S]*request_approval|(?:first|before)[\s\S]*prepare_approval[\s\S]*request_approval/i, 'prepare before request'],
    [/request_approval[\s\S]*(?:wait|block)[\s\S]*(?:outcome|resolution|decision|result)/i, 'waiting outcome, not immediate receipt'],
    [/(?:capability|key)[\s\S]*(?:private|secret|confidential)/i, 'private capability'],
    [/(?:retain|keep|save|store)[\s\S]*(?:capability|key)[\s\S]*(?:handle|request_id|request ID)/i, 'retain authority with request identity'],
    [/(?:not|never|do not|don.t)[\s\S]*(?:echo|expose|print|disclose)[\s\S]*(?:capability|key)|(?:capability|key)[\s\S]*(?:not|never)[\s\S]*(?:echo|expose|print|disclos)/i, 'no capability echo'],
  ];
  for (const [pattern, label] of clauses) assert.match(text, pattern, label);
  if (/prepare_approval[^.\n]*(?:is available|is implemented|is enabled)/i.test(text)) {
    assert.match(text, /request_approval[^.\n]*ENHANCEMENT_UNAVAILABLE/i, 'partial execution discloses waiting unavailable');
    assert.match(text, /reserv(?:ed|ation)[^.\n]*(?:NOT_FOUND|404)/i, 'partial execution discloses reserved denials only');
  } else {
    assert.match(text, /(?:execution|tools?\/call|tool calls?|operations?)[\s\S]*(?:not (?:yet )?(?:implemented|available|supported)|unavailable|incomplete|disabled)|(?:not (?:yet )?(?:implemented|available|supported)|incomplete)[\s\S]*(?:execution|tools?\/call|tool calls?|operations?)/i,
      'honest catalog-only execution limitation');
  }
  for (const sentence of text.split(/[.\n]/)) {
    if (/\b(?:not|never|no|cannot|can't|doesn't|don't)\b/i.test(sentence)) continue;
    assert.doesNotMatch(sentence,
      /(?:returns?|provides?)[^.\n]*immediate[^.\n]*receipt|(?:injects?|sends?)[^.\n]*(?:OpenCode API|session prompt)|(?:OpenCode API)[^.\n]*(?:inject|send)/i,
      'no legacy receipt or host API injection claims');
  }
}

export function catalogPeer(child, { secrets = [], maxBytes = 65536, ms = 8000 } = {}) {
  let next = 1;
  let bytes = 0;
  let stdout = Buffer.alloc(0);
  let failure;
  let closed = false;
  const pending = new Map();
  const ended = new Set();
  const tails = new Map();
  const needles = secrets.map(value => Buffer.from(value)).filter(value => value.length);
  const overlap = Math.max(0, ...needles.map(value => value.length - 1));
  const finish = (id, value) => {
    const entry = pending.get(id);
    if (!entry) return;
    clearTimeout(entry.timer);
    pending.delete(id);
    entry.resolve(value);
  };
  const fail = label => {
    failure ??= new Error(label); // Never retain or print private output.
    for (const id of pending.keys()) finish(id, { kind: 'invalid-frame' });
    child.kill();
  };
  const line = value => {
    let frame;
    try { frame = JSON.parse(value.toString('utf8')); }
    catch { fail('malformed protocol stdout'); return; }
    if (!object(frame) || frame.jsonrpc !== '2.0' || !pending.has(frame.id) ||
        Object.hasOwn(frame, 'method') ||
        Object.hasOwn(frame, 'result') === Object.hasOwn(frame, 'error')) {
      fail('unexpected or invalid protocol frame');
      return;
    }
    finish(frame.id, { kind: 'response', frame });
  };
  for (const [name, stream] of [['stdout', child.stdout], ['stderr', child.stderr]]) {
    stream.on('data', chunk => {
      if (failure) return;
      bytes += chunk.length;
      if (bytes > maxBytes) { fail('protocol output limit'); return; }
      const combined = Buffer.concat([tails.get(name) ?? Buffer.alloc(0), chunk]);
      if (needles.some(secret => combined.includes(secret))) { fail('credential disclosure'); return; }
      tails.set(name, overlap ? Buffer.from(combined.subarray(-overlap)) : Buffer.alloc(0));
      if (name !== 'stdout') return;
      stdout = Buffer.concat([stdout, chunk]);
      let newline;
      while (!failure && (newline = stdout.indexOf(10)) >= 0) {
        line(stdout.subarray(0, newline));
        stdout = stdout.subarray(newline + 1);
      }
    });
    stream.on('end', () => {
      ended.add(name);
      if (name === 'stdout' && stdout.length && !failure) fail('unterminated protocol stdout');
    });
  }
  child.once('error', () => fail('protocol process error'));
  child.once('close', () => {
    closed = true;
    for (const id of pending.keys()) finish(id, { kind: 'transport-closed' });
  });
  return {
    call(method, params) {
      if (failure || closed) return { outcome: Promise.resolve({ kind: 'transport-closed' }) };
      const id = next++;
      const outcome = new Promise(resolve => {
        const timer = setTimeout(() => finish(id, { kind: 'timeout' }), ms);
        pending.set(id, { timer, resolve });
      });
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
      return { outcome };
    },
    assertComplete() {
      assert.ok(closed && ended.size === 2, 'inspect only after process closure and both output EOFs');
      assert.ifError(failure);
      assert.equal(pending.size, 0);
    },
  };
}
