import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { HttpConfig } from '../types.js';
export declare function connectHttp(server: McpServer, config?: HttpConfig): Promise<() => Promise<void>>;
