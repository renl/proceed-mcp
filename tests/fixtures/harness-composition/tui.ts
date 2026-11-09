// TEST ONLY. Public plugin lifecycle wrapper, unchanged real host context/options.
// The exact packaged ./tui entry owns commands, key loading and private helper.
import * as Plugin from '@opencode/plugin/tui/plugin';
import product from '@meshimize/proceed-mcp/tui';
import { writeFile } from 'node:fs/promises';
import { readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { compositionHostAction } from '/payload/tests/support/harness-wrapper-invocation.mjs';
import { privateCaptureWriter } from '/payload/tests/support/harness-transparent-capture.mjs';
import {
  collectionAdmit,
  collectionLimits,
} from '/payload/tests/support/harness-renderer-observation.mjs';
import {
  observeCompositionSelectors,
  createCompositionSessionReader,
} from '/payload/tests/support/harness-composition-readiness.mjs';

export default Plugin.define({
  id: product.id,
  async setup(context) {
    const cleanupOrigin = performance.now();
    let phase = 'product-setup';
    const root = '/run/proceed/evidence/';
    const {
      run,
      captureOnly,
      navigationOnly = false,
      integratedScenario = false,
    } = JSON.parse(readFileSync(root + 'composition-binding.json', 'utf8'));
    const snapshot = () =>
      context.data.session.list().map((s, n) => ({
        id: s.id,
        title: typeof s.title === 'string' ? s.title : null,
        ordinal: `Session ${n + 1}`,
      }));
    const generation = randomUUID();
    let resizeSequence = 0;
    let live = true,
      timer;
    let actionSequence = 0;
    const actions = new Set();
    const actionTasks = new Set();
    const privateRoot = '/run/proceed/qualification-private/';
    let publicApiBytes = 0;
    const apiWriter = privateCaptureWriter();
    let serviceInventoryWritten = false;
    if (integratedScenario)
      writeFileSync(privateRoot + 'composition-public-api.jsonl', '', { flag: 'wx', mode: 0o600 });
    const actionResult = (request, value) =>
      writeFileSync(
        privateRoot + `composition-action-result-${request.request}.json`,
        JSON.stringify({ run, generation, request: request.request, ...value }),
      );
    const lifetime = () => ({
      run,
      generation,
      live,
      geometry: {
        width: context.renderer?.width,
        height: context.renderer?.height,
        resizeSequence,
      },
    });
    const readNavigation = createCompositionSessionReader(context, lifetime);
    const publish = () =>
      writeFileSync(
        root + 'composition-live.json',
        JSON.stringify({
          run,
          generation,
          live,
          snapshot: captureOnly || navigationOnly || integratedScenario ? snapshot() : undefined,
          geometry: {
            width: context.renderer?.width,
            height: context.renderer?.height,
            resizeSequence,
          },
        }),
      );
    const resized = () => {
      resizeSequence++;
      publish();
    };
    context.renderer?.on('resize', resized);
    publish();
    try {
      const cleanup = await product.setup(context);
      if (typeof cleanup !== 'function') throw new Error('Product setup refused');
      phase = 'public-session-create';
      const created = await context.client.session.create({
        title: 'Composition empty exchange',
      });
      const session = created.data ?? created;
      if (typeof session.id !== 'string') throw new Error('Public session creation refused');
      phase = 'host-session-sync';
      await context.data.session.sync(session.id);
      if (!context.data.session.get(session.id)) throw new Error('Host session unresolved');
      if (captureOnly || navigationOnly || integratedScenario) {
        const second = await context.client.session.create({ title: 'Composition empty exchange' });
        await context.data.session.sync((second.data ?? second).id);
      }
      if (integratedScenario) {
        for (const item of snapshot()) {
          const actual = await context.client.session.get({ sessionID: item.id });
          const info = actual.data ?? actual;
          if (!info.agent) {
            const listed = await context.client.agent.list();
            const agents = listed.data ?? listed;
            const candidates = Array.isArray(agents) ? agents : agents.items;
            const selected = candidates?.find((a) => a.mode !== 'subagent' && !a.hidden);
            if (!selected?.id) throw new Error('No selectable public host agent');
            await context.client.session.switchAgent({ sessionID: item.id, agent: selected.id });
            await context.data.session.sync(item.id);
          }
        }
      }
      publish();
      // Fixed-purpose evidence observation only. No command dispatch, callback,
      // decision, or product hook. Requests are written after a completed frame.
      phase = 'public-command-eligibility';
      let last;
      const deadline = Date.now() + (integratedScenario ? 150000 : 60000);
      timer = setInterval(() => {
        if (!live || Date.now() >= deadline) {
          clearInterval(timer);
          return;
        }
        try {
          if (captureOnly || navigationOnly || integratedScenario) publish();
          if (integratedScenario) {
            // Separate monotonically numbered files allow the two long-running
            // public commands to remain concurrent. No overwritten mailbox.
            let action;
            try {
              action = JSON.parse(
                readFileSync(privateRoot + `composition-action-${actionSequence + 1}.json`, 'utf8'),
              );
            } catch {}
            if (action) {
              if (
                action.run !== run ||
                action.generation !== generation ||
                action.request !== actionSequence + 1 ||
                actionSequence >= 64
              )
                throw new Error('Action binding refused');
              actionSequence++;
              if (action.kind === 'abort') {
                for (const c of actions) c.abort();
                actionResult(action, { state: 'COMPLETE' });
              } else {
                const controller = new AbortController();
                actions.add(controller);
                actionResult(action, { state: 'STARTED' });
                const task = compositionHostAction(
                  context,
                  action,
                  controller.signal,
                  async (event) => {
                    if (event.kind === 'service-inventory') {
                      writeFileSync(
                        privateRoot + 'composition-service-inventory.json',
                        JSON.stringify(event.value),
                      );
                      serviceInventoryWritten = true;
                    } else {
                      const line = JSON.stringify(event) + '\n';
                      publicApiBytes += Buffer.byteLength(line);
                      try {
                        collectionAdmit(publicApiBytes, collectionLimits.file);
                        appendFileSync(privateRoot + 'composition-public-api.jsonl', line, {
                          mode: 0o600,
                        });
                        apiWriter.written(Buffer.from(line));
                      } catch (error) {
                        apiWriter.failed();
                        throw error;
                      }
                    }
                  },
                )
                  .then(
                    (value) =>
                      actionResult(action, {
                        state: 'COMPLETE',
                        ...(action.kind === 'switch-foreground' ? value : {}),
                      }),
                    () => actionResult(action, { state: 'FAILED', error: 'PUBLIC_ACTION_REFUSED' }),
                  )
                  .finally(() => {
                    actions.delete(controller);
                    actionTasks.delete(task);
                  });
                actionTasks.add(task);
              }
            }
          }
          const request = JSON.parse(
            readFileSync(root + 'composition-selector-request.json', 'utf8'),
          );
          const token = `${request.kind ?? 'selector'}:${request.request}`;
          if (request.run !== run || request.generation !== generation || token === last) return;
          last = token;
          // Read-only public bridge. The separate driver owns its closed keys.
          if (!captureOnly && request.kind === 'navigation-observation') {
            const observation = readNavigation(request);
            if (!live) return;
            writeFileSync(root + 'composition-selector-response.json', JSON.stringify(observation));
            return;
          }
          const observation = observeCompositionSelectors(context, session.id);
          if (!live) return;
          writeFileSync(
            root + 'composition-selector-response.json',
            JSON.stringify({ run, generation, request: request.request, live, ...observation }),
          );
        } catch {
          /* Incomplete/missing evidence refuses readiness. */
        }
      }, 20);
      await writeFile(
        '/run/proceed/evidence/composition-ready.json',
        JSON.stringify({
          session: session.id,
          version: context.app.version,
          bun: process.versions.bun,
          node: process.versions.node,
          run,
          generation,
          // Public host identities only. This is not an agent selection setter
          // or authority claim. Registered invocation rereads the real agent.
          sessions: integratedScenario ? snapshot() : undefined,
        }),
      );
      return async () => {
        // Fence at Cleanup ENTRY before any asynchronous product cleanup.
        live = false;
        context.renderer?.off('resize', resized);
        clearInterval(timer);
        for (const c of actions) c.abort();
        await Promise.allSettled([...actionTasks]);
        if (integratedScenario)
          writeFileSync(
            privateRoot + 'composition-api-seal.json',
            JSON.stringify({ api: apiWriter.seal(), actionSequence, serviceInventoryWritten }),
            { flag: 'wx', mode: 0o600 },
          );
        publish();
        const entry = Math.floor(performance.now() - cleanupOrigin);
        writeFileSync(
          root + 'composition-cleanup-entry.json',
          JSON.stringify({
            clock: 'WRAPPER_MONOTONIC_MS',
            entry,
          }),
        );
        await cleanup();
        const returned = Math.floor(performance.now() - cleanupOrigin);
        writeFileSync(
          root + 'composition-cleanup-return.json',
          JSON.stringify({
            clock: 'WRAPPER_MONOTONIC_MS',
            entry,
            returned,
          }),
        );
        await writeFile(
          '/run/proceed/evidence/composition-cleanup.json',
          JSON.stringify({
            productCleanup: 'PASS',
            clock: 'WRAPPER_MONOTONIC_MS',
            entry,
            returned,
          }),
        );
      };
    } catch {
      live = false;
      context.renderer?.off('resize', resized);
      clearInterval(timer);
      publish();
      await writeFile(
        '/run/proceed/evidence/composition-fixture-failure.json',
        JSON.stringify({ phase }),
      );
      throw new Error('COMPOSITION_FIXTURE_FAILURE');
    }
  },
});
