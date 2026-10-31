// argv parsing for the public CLI. Options take a value; positionals and
// options may appear in any order, because setup commands accept trailing
// options. Unknown options are invalid arguments, never ignored.
import { invalidArgument } from '../errors.js';

export function parseArguments(argv, { valueOptions = [] } = {}) {
  const positionals = [];
  const options = new Map();

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];

    if (argument === '--') {
      positionals.push(...argv.slice(index + 1));
      break;
    }

    if (argument.startsWith('--') && argument.length > 2) {
      const name = argument.slice(2);
      if (!valueOptions.includes(name)) {
        throw invalidArgument(`unknown option --${name}`);
      }
      if (options.has(name)) {
        throw invalidArgument(`--${name} may be given only once`);
      }
      const value = argv[index + 1];
      if (value === undefined || value.startsWith('--')) {
        throw invalidArgument(`--${name} requires a value`);
      }
      options.set(name, value);
      index += 1;
      continue;
    }

    positionals.push(argument);
  }

  return { positionals, options };
}

export function requireOptions(options, names) {
  for (const name of names) {
    if (!options.has(name)) {
      throw invalidArgument(`--${name} is required`);
    }
  }
}
