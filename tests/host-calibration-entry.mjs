// TEST ONLY preliminary entry. No environment discovery, credential reads or live
// execution binding is installed. A missing binding is RED, never a skipped test.
import { pathToFileURL } from 'node:url';
import { preliminary } from './support/host-calibration.mjs';
export async function calibrationEntry(binding, exchange) {
  return preliminary(binding, exchange);
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  calibrationEntry().catch(() => {
    console.error('CALIBRATION_PREREQUISITE: protected isolated host binding missing; no host called');
    process.exitCode = 1;
  });
}
