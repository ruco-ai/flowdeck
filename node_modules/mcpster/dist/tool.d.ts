import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ZodSchema } from 'zod';
import type { ToolDefinition } from './types.js';
export declare function registerTool<T extends ZodSchema>(sdk: McpServer, def: ToolDefinition<T>): void;
