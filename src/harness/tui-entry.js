// Packaged TUI entry, resolved by name as the documented `tui` export. The pinned
// host loads this module and calls the plugin definition's setup. Only this
// TUI-only entry imports the supported plugin SDK subpath; portable entry points
// never do, and nothing in the portable CLI or MCP adapter imports it.
import * as Plugin from '@opencode/plugin/tui/plugin';
import { harnessTuiDefinition } from './tui-plugin.js';

export default Plugin.define(harnessTuiDefinition);
