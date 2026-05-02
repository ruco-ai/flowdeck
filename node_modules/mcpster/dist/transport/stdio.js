import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
export async function connectStdio(server) {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    return () => Promise.resolve();
}
