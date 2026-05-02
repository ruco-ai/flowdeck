import { execSync } from 'node:child_process';
export function generateManifest(config) {
    return {
        name: config.name,
        main: 'worker.js',
        compatibility_date: '2024-01-01',
        vars: {
            MCP_TRANSPORT: 'http',
            SERVER_NAME: config.name,
            SERVER_VERSION: config.version,
        },
    };
}
export function generateWorkerShim(config) {
    const port = config.port ?? 3000;
    return [
        `// Worker entry shim for ${config.name} v${config.version}`,
        `// Forwards requests to the MCP HTTP handler`,
        `import { createServer } from './dist/index.js'`,
        ``,
        `const server = createServer({`,
        `  name: '${config.name}',`,
        `  version: '${config.version}',`,
        `  transport: 'http',`,
        `  http: { port: ${port}, path: '/mcp' },`,
        `})`,
        ``,
        `export default {`,
        `  async fetch(request, env, ctx) {`,
        `    return server.handleRequest(request, env, ctx)`,
        `  },`,
        `}`,
    ].join('\n');
}
export function manifestToToml(manifest) {
    const lines = [
        `name = "${manifest.name}"`,
        `main = "${manifest.main}"`,
        `compatibility_date = "${manifest.compatibility_date}"`,
        ``,
        `[vars]`,
    ];
    for (const [key, value] of Object.entries(manifest.vars)) {
        lines.push(`${key} = "${value}"`);
    }
    return lines.join('\n');
}
export async function deploy(config) {
    const manifest = generateManifest(config);
    const { writeFileSync } = await import('node:fs');
    writeFileSync('wrangler.toml', manifestToToml(manifest), 'utf8');
    writeFileSync('worker.js', generateWorkerShim(config), 'utf8');
    const output = execSync('wrangler deploy --json', { encoding: 'utf8' });
    const result = JSON.parse(output);
    const url = result.url ?? result.deployment_url ?? `https://${config.name}.workers.dev`;
    return { url, target: 'cloudflare', manifest };
}
