// TEST ONLY. Embedded-runtime capability controls, not the product operator UI.
import * as Plugin from '@opencode/plugin/tui/plugin';
import { readFile, writeFile } from 'node:fs/promises';
import {
  exerciseRuntimeTransport,
  exerciseProductTransport,
  transportDiagnostic,
} from '/payload/tests/support/harness-runtime-transport.mjs';

export default Plugin.define({
  id: 'proceed-transport-qualification',
  async setup(context) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 90000);
    // Test-only options. Never add these options/endpoints to the product plugin.
    const { cases_file, evidence_directory } = context.options;
    const firstOnly = context.options.first_exchange_only === true;
    let state = { case: 'unknown', phase: 'setup', elapsed_ms: 0 };
    let exchangeFailure;
    const observe = (next, error) => {
      state = { ...next };
      if (
        ['key-protection', 'key-load', 'client-create', 'response-assertion'].includes(next.phase)
      )
        exchangeFailure = undefined;
      if (error) exchangeFailure = transportDiagnostic(error, state);
    };
    if (context.app.version !== '2.2.5') throw new Error('Unqualified host runtime');
    if (cases_file !== '/run/proceed/qualification-private/cases.json')
      throw new Error('Unexpected transport plan path');
    if (evidence_directory !== '/run/proceed/evidence') throw new Error('Unexpected evidence root');
    try {
      const { roles, product } = JSON.parse(await readFile(cases_file, 'utf8'));
      const observations = [
        ...(await exerciseRuntimeTransport(roles, controller.signal, observe, firstOnly)),
        ...(firstOnly
          ? []
          : await (async () => {
              state = { case: 'product-controls', phase: 'product-controls', elapsed_ms: 0 };
              exchangeFailure = undefined;
              return exerciseProductTransport(product, controller.signal, observe);
            })()),
      ];
      await writeFile(
        `${evidence_directory}/runtime-transport.json`,
        JSON.stringify({
          scope: 'actual embedded secure-client capability only',
          observations,
          diagnostic: transportDiagnostic(null, state),
        }),
      );
      context.ui.toast.show({ message: 'Proceed transport controls complete', duration: 60000 });
    } catch (error) {
      // Never serialize runtime assertion values, which can contain credentials.
      await writeFile(
        `${evidence_directory}/runtime-transport.json`,
        JSON.stringify({
          status: 'FAIL',
          diagnostic: exchangeFailure ?? transportDiagnostic(error, state),
        }),
      );
    } finally {
      clearTimeout(timer);
    }
    return async () => {
      controller.abort();
      await writeFile(
        `${evidence_directory}/transport-cleanup.json`,
        JSON.stringify({ aborted: controller.signal.aborted, timerCleared: true }),
      );
    };
  },
});
