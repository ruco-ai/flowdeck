export function registerPrompt(sdk, def) {
    sdk.registerPrompt(def.name, { description: def.description }, async (args) => {
        try {
            const text = await def.handler(args);
            return {
                messages: [{ role: 'user', content: { type: 'text', text } }],
            };
        }
        catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            return {
                messages: [{ role: 'user', content: { type: 'text', text: message } }],
            };
        }
    });
}
