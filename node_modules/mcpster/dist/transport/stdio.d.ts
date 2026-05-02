import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
export declare function connectStdio(server: McpServer): Promise<() => Promise<void>>;
