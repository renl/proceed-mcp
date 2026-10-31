// 256-bit random local credentials (control and per-origin). Generated into
// protected files only: never command arguments, configuration, or logs.
import { randomBytes } from 'node:crypto';

export function generateCredentialToken() {
  return randomBytes(32).toString('hex');
}
