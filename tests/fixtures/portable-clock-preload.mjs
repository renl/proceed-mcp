// TEST ONLY: broker process clock, not a production clock knob or decision API.
// Timers remain real. Frozen Date.now proves deadline ordering, not cadence.
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const path = new URL(import.meta.url).searchParams.get('clock');
const state = process.argv[process.argv.indexOf('--state-dir') + 1];
if (!path || dirname(resolve(path)) !== dirname(resolve(state))) {
  throw Error('clock must belong to the isolated runner namespace');
}
let now = JSON.parse(readFileSync(path, 'utf8'));
Date.now = () => {
  // A concurrent test-only file replacement may briefly be empty. Keep the last
  // complete sample rather than invent a new instant or affect production IO.
  try {
    const next = JSON.parse(readFileSync(path, 'utf8'));
    if (!Number.isSafeInteger(next) || next < now) throw Error('invalid test clock');
    now = next;
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
  }
  return now;
};
