import { execSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
export function generateManifest(config) {
    const port = config.port ?? 3000;
    return {
        app: config.name,
        primary_region: config.region ?? 'iad',
        build: { dockerfile: 'Dockerfile' },
        http_service: {
            internal_port: port,
            force_https: true,
            auto_stop_machines: true,
            auto_start_machines: true,
        },
        vm: [
            {
                memory: config.memory ?? '256mb',
                cpu_kind: 'shared',
                cpus: 1,
            },
        ],
        env: {
            PORT: String(port),
            MCP_TRANSPORT: 'http',
            SERVER_NAME: config.name,
            SERVER_VERSION: config.version,
        },
    };
}
export function generateDockerfile() {
    let tgzFiles = [];
    try {
        tgzFiles = readdirSync('.').filter((f) => f.endsWith('.tgz'));
    }
    catch {
        // ignore
    }
    const lines = [
        'FROM node:20-alpine',
        'WORKDIR /app',
        'COPY package*.json ./',
        ...(tgzFiles.length > 0 ? [`COPY ${tgzFiles.join(' ')} ./`] : []),
        'RUN npm ci --omit=dev',
        'COPY dist ./dist',
        'COPY mcpster.config.json ./',
        'EXPOSE 3000',
        'CMD ["node", "dist/index.js"]',
    ];
    return lines.join('\n');
}
export async function deploy(config) {
    const manifest = generateManifest(config);
    const { writeFileSync } = await import('node:fs');
    writeFileSync('fly.toml', toToml(manifest), 'utf8');
    writeFileSync('Dockerfile', generateDockerfile(), 'utf8');
    execSync('fly deploy', { encoding: 'utf8', stdio: 'inherit' });
    const infoOutput = execSync(`fly status --app ${config.name} --json`, { encoding: 'utf8' });
    const info = JSON.parse(infoOutput);
    const url = info.Hostname ? `https://${info.Hostname}` : '';
    return { url, target: 'fly', manifest };
}
function toToml(obj, indent = 0) {
    const lines = [];
    const pad = ' '.repeat(indent);
    for (const [key, value] of Object.entries(obj)) {
        if (value === null || value === undefined)
            continue;
        if (Array.isArray(value)) {
            for (const item of value) {
                lines.push(`${pad}[[${key}]]`);
                lines.push(toToml(item, indent + 2));
            }
        }
        else if (typeof value === 'object') {
            lines.push(`${pad}[${key}]`);
            lines.push(toToml(value, indent + 2));
        }
        else if (typeof value === 'string') {
            lines.push(`${pad}${key} = "${value}"`);
        }
        else {
            lines.push(`${pad}${key} = ${String(value)}`);
        }
    }
    return lines.join('\n');
}
