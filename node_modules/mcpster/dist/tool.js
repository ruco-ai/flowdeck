export function registerTool(sdk, def) {
    const shape = def.schema.shape;
    sdk.registerTool(def.name, {
        description: def.description,
        inputSchema: shape,
    }, async (args) => {
        try {
            const result = await def.handler(args);
            const text = typeof result === 'string' ? result : JSON.stringify(result);
            return { content: [{ type: 'text', text }] };
        }
        catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            return { content: [{ type: 'text', text: message }], isError: true };
        }
    });
}
