#!/usr/bin/env node
/**
 * mcpster deploy CLI
 *
 * Usage:
 *   mcpster-deploy --target <railway|fly|cloudflare> [--name <name>] [--version <v>] [--port <port>] [--dry-run]
 */
import { parseArgs } from 'node:util';
const { values } = parseArgs({
    options: {
        target: { type: 'string', short: 't' },
        name: { type: 'string', short: 'n' },
        version: { type: 'string', short: 'v' },
        port: { type: 'string', short: 'p' },
        region: { type: 'string', short: 'r' },
        'dry-run': { type: 'boolean', short: 'd' },
        help: { type: 'boolean', short: 'h' },
    },
    allowPositionals: false,
});
if (values.help || !values.target) {
    console.log(`
mcpster deploy — push your MCP server to a hosted platform

Usage:
  mcpster-deploy --target <target> [options]

Targets:
  railway      Deploy to Railway (requires: railway CLI)
  fly          Deploy to Fly.io  (requires: flyctl)
  cloudflare   Deploy to Cloudflare Workers (requires: wrangler)

Options:
  -t, --target <target>    Deploy target (railway | fly | cloudflare)
  -n, --name <name>        Server name (default: read from package.json)
  -v, --version <version>  Server version (default: read from package.json)
  -p, --port <port>        HTTP port (default: 3000)
  -r, --region <region>    Preferred region (fly only, default: iad)
  -d, --dry-run            Print the generated manifest without deploying
  -h, --help               Show this help message
`);
    process.exit(values.help ? 0 : 1);
}
const target = values.target;
if (!['railway', 'fly', 'cloudflare'].includes(target)) {
    console.error(`Error: unknown target "${target}". Must be one of: railway, fly, cloudflare`);
    process.exit(1);
}
// Resolve name and version from package.json if not provided
async function resolvePackageMeta() {
    try {
        const { readFileSync } = await import('node:fs');
        const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
        return {
            name: pkg.name ?? 'mcp-server',
            version: pkg.version ?? '0.1.0',
        };
    }
    catch {
        return { name: 'mcp-server', version: '0.1.0' };
    }
}
const meta = await resolvePackageMeta();
const config = {
    name: values.name ?? meta.name,
    version: values.version ?? meta.version,
    port: values.port ? Number(values.port) : 3000,
    region: values.region,
};
const dryRun = values['dry-run'] ?? false;
if (target === 'railway') {
    const { generateManifest, deploy } = await import('./railway.js');
    if (dryRun) {
        console.log(JSON.stringify(generateManifest(config), null, 2));
    }
    else {
        const result = await deploy(config);
        console.log(`Deployed to Railway: ${result.url}`);
    }
}
else if (target === 'fly') {
    const { generateManifest, generateDockerfile, deploy } = await import('./fly.js');
    if (dryRun) {
        console.log('# fly.toml');
        console.log(JSON.stringify(generateManifest(config), null, 2));
        console.log('\n# Dockerfile');
        console.log(generateDockerfile());
    }
    else {
        const result = await deploy(config);
        console.log(`Deployed to Fly.io: ${result.url}`);
    }
}
else if (target === 'cloudflare') {
    const { generateManifest, manifestToToml, generateWorkerShim, deploy } = await import('./cloudflare.js');
    if (dryRun) {
        console.log('# wrangler.toml');
        console.log(manifestToToml(generateManifest(config)));
        console.log('\n# worker.js');
        console.log(generateWorkerShim(config));
    }
    else {
        const result = await deploy(config);
        console.log(`Deployed to Cloudflare Workers: ${result.url}`);
    }
}
