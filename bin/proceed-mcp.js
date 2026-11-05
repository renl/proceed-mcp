#!/usr/bin/env node
// Package executable entry point. Setup commands run to completion here; no
// background process, port listener, or outbound network call belongs on this
// path.
import { run } from '../src/cli/main.js';

process.exitCode = await run(process.argv.slice(2));
