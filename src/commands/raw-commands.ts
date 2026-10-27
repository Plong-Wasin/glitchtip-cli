// Raw MCP access for tools that have no shortcut yet.

import { rpc, toolText } from '../glitchtip/client.js';
import { resolveProfile } from '../utils/config.js';
import { CliError } from '../utils/errors.js';
import { PROTOCOL_VERSION, VERSION } from '../utils/version.js';
import { parseKeyValues, requireArg } from '../utils/args.js';
import { printJson } from '../utils/output.js';
import type { Opts } from '../utils/options.js';
import type { InitializeResult, ToolInfo, ToolResult } from '../glitchtip/types.js';

export async function cmdTools(opts: Opts): Promise<void> {
  const result = await rpc<{ tools: ToolInfo[] }>(resolveProfile(opts.profile), 'tools/list', {});
  if (opts.json) return printJson(result.tools);
  for (const tool of result.tools) {
    const props = tool.inputSchema?.properties ?? {};
    const required = new Set(tool.inputSchema?.required ?? []);
    const params = Object.keys(props).map((p) => (required.has(p) ? p : `[${p}]`)).join(' ');
    console.log(`${tool.name}${params ? ' ' + params : ''}`);
    if (tool.description) console.log(`    ${tool.description.split('\n')[0]}`);
  }
}

export async function cmdCall(tool: string | undefined, pairs: string[], opts: Opts): Promise<void> {
  requireArg(tool, 'glitchtip call <tool> [key=value ...] [--args JSON]');
  let base: Record<string, unknown> = {};
  if (opts.args) {
    try {
      base = JSON.parse(opts.args);
    } catch {
      throw new CliError('--args must be a JSON object, e.g. --args \'{"organization_slug":"acme"}\'.', 2);
    }
  }
  const args = { ...base, ...parseKeyValues(pairs) };
  const result = await rpc<ToolResult>(resolveProfile(opts.profile), 'tools/call', { name: tool, arguments: args });
  if (opts.json) printJson(result);
  else console.log(toolText(result));
  if (result.isError) process.exitCode = 1;
}

export async function cmdInfo(opts: Opts): Promise<void> {
  const result = await rpc<InitializeResult>(resolveProfile(opts.profile), 'initialize', {
    protocolVersion: PROTOCOL_VERSION,
    capabilities: {},
    clientInfo: { name: 'glitchtip-cli', version: VERSION },
  });
  if (opts.json) return printJson(result);
  console.log(`${result.serverInfo.name} ${result.serverInfo.version} (protocol ${result.protocolVersion})\n`);
  console.log(result.instructions ?? '');
}
