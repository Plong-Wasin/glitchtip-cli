export interface ToolResult {
  content?: { type: string; text?: string }[];
  structuredContent?: unknown;
  isError?: boolean;
}

export interface ToolInfo {
  name: string;
  description?: string;
  inputSchema?: { properties?: Record<string, unknown>; required?: string[] };
}

export interface InitializeResult {
  protocolVersion: string;
  serverInfo: { name: string; version: string };
  instructions?: string;
}

export interface JsonRpcMessage {
  result?: unknown;
  error?: { code: number; message: string };
}
