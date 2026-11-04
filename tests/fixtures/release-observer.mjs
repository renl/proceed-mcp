// TEST ONLY. Observes readiness and forwards existing SIGTERM shutdown.
// No transport substitution, credentials, journal mutation or application API.
import { dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { registerHooks } from 'node:module';
// Prevent the worktree's devDependencies from rescuing a broken installation.
const installedModules = dirname(dirname(dirname(resolve(process.argv[1])))) + sep;
registerHooks({ resolve(specifier, context, nextResolve) {
  const result = nextResolve(specifier, context);
  if (result.url.startsWith('file:') && !fileURLToPath(result.url).startsWith(installedModules)) {
    throw new Error('installed package attempted repository module fallback');
  }
  return result;
} });
const state = process.argv[process.argv.indexOf('--state-dir') + 1];
for (const key of ['TEMP', 'TMP', 'TMPDIR']) process.env[key] = dirname(state);
if (process.platform === 'win32') process.env.PATHEXT = '.EXE';
const write = process.stdout.write.bind(process.stdout);
process.stdout.write = (chunk, ...args) => {
  if (String(chunk).includes('broker ready on')) process.send?.({ kind: 'broker-ready' });
  return write(chunk, ...args);
};
process.on('message', (message) => {
  if (message.kind === 'stop') process.emit('SIGTERM');
});
process.channel?.unref();
process.send?.({ kind: 'ready' });
