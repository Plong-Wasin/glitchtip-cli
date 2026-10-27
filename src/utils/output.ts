import { toolText } from '../glitchtip/client.js';
import type { ToolResult } from '../glitchtip/types.js';
import type { Opts } from './options.js';

export function printToolResult(result: ToolResult, opts: Opts): void {
  if (opts.json) return printJson(result.structuredContent ?? result);
  console.log(toolText(result));
}

export function printJson(value: unknown): void {
  console.log(JSON.stringify(value, null, 2));
}
