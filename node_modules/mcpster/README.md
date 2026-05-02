# mcpster

> A TypeScript SDK for building MCP servers — removes the boilerplate so you focus on what you expose, not how.

---

## Overview

mcpster is an agnostic TypeScript SDK for building Model Context Protocol (MCP) servers. It wraps `@modelcontextprotocol/sdk` behind a fluent, chainable API with Zod-first schema validation, URI template parsing, and consistent error handling. Servers built with mcpster start as local stdio processes and have a clear migration path to remote hosting and public npm distribution — without rewriting any business logic.

## Features

- `createServer()` + chainable `defineTool` / `defineResource` / `definePrompt` API
- Zod schema validation enforced at tool registration time
- URI template parameter extraction for resources (`templates://{name}`)
- Automatic error wrapping — handlers throw, mcpster returns MCP-compliant error responses
- Scope-aware server naming (project, user, or public scope)
- stdio and Streamable HTTP transports — switch with a single config field
- OAuth 2.1 (PKCE) support for protected remote servers — enable with `auth: true`
- Designed for progressive deployment: local stdio → remote Streamable HTTP → hosted → npm package

## Installation

```bash
npm install mcpster
```

## Usage

### stdio (default)

```typescript
import { createServer } from 'mcpster'
import { z } from 'zod'

createServer({ name: 'my-server', version: '1.0.0' })
  .defineTool({
    name: 'get_template',
    description: 'Retrieve a template by name',
    schema: z.object({ name: z.string() }),
    handler: async ({ name }) => { /* ... */ },
  })
  .defineResource({
    uri: 'templates://{name}',
    description: 'Template content by name',
    resolver: async ({ name }) => { /* ... */ },
  })
  .definePrompt({
    name: 'summarize',
    handler: async (args) => { /* ... */ },
  })
  .start() // stdio transport
```

Register the server per-project:

```bash
claude mcp add my-server -- npx mcpster start
```

### Streamable HTTP transport

```typescript
import { createServer } from 'mcpster'

createServer({
  name: 'my-server',
  version: '1.0.0',
  transport: 'http',
  http: { port: 3000, path: '/mcp' },
})
  .defineTool({ /* ... */ })
  .start() // listens on http://localhost:3000/mcp
```

Register with Claude Code:

```bash
claude mcp add --transport http my-server http://localhost:3000/mcp
```

### OAuth 2.1 (protected remote server)

Enable `auth: true` to require clients to complete an OAuth 2.1 PKCE flow before accessing the MCP endpoint. Set `baseUrl` to your public server URL so OAuth discovery metadata points to the right place.

```typescript
createServer({
  name: 'my-server',
  version: '1.0.0',
  transport: 'http',
  http: {
    port: 3000,
    path: '/mcp',
    auth: true,
    baseUrl: 'https://my-server.example.com',
  },
}).start()
```

mcpster handles the full OAuth flow: dynamic client registration (`/register`), authorization (`/authorize`), token issuance (`/token`), and bearer token verification on the MCP endpoint. All dynamically registered clients are treated as public PKCE clients — no pre-shared secrets required.

For persistence across restarts, point `clientsFile` at a file on a mounted volume:

```typescript
http: {
  auth: true,
  baseUrl: 'https://my-server.example.com',
  clientsFile: '/data/oauth-clients.json',
}
```

## Configuration

| Option | Default | Description |
|--------|---------|-------------|
| `name` | required | Server name, used for MCP registration |
| `version` | required | Semver string |
| `scope` | `process.cwd()` | Project root; determines scope for naming and resource resolution |
| `transport` | `'stdio'` | Transport to use: `'stdio'` or `'http'` |
| `http.port` | `3000` | Port to listen on (HTTP transport only) |
| `http.path` | `'/mcp'` | Request path to handle (HTTP transport only) |
| `http.auth` | `false` | Enable OAuth 2.1 PKCE protection on the MCP endpoint |
| `http.baseUrl` | `http://localhost:<port>` | Public base URL — used for OAuth metadata and token endpoints |
| `http.clientsFile` | *(in-memory)* | Path to persist registered OAuth clients across restarts |

## Project Structure

```
mcpster/
├── src/
│   ├── index.ts              # Public API — re-exports createServer and types
│   ├── server.ts             # McpsterServer class — core orchestrator
│   ├── tool.ts               # defineTool — schema validation + handler wiring
│   ├── resource.ts           # defineResource — URI template matching + resolver
│   ├── prompt.ts             # definePrompt — prompt template registration
│   ├── transport/
│   │   ├── stdio.ts          # stdio transport adapter
│   │   └── http.ts           # Streamable HTTP transport adapter
│   ├── deploy/
│   │   ├── types.ts          # Shared DeployConfig, DeployResult, DeployAdapter types
│   │   ├── railway.ts        # Railway adapter (generateManifest, deploy)
│   │   ├── fly.ts            # Fly.io adapter (generateManifest, generateDockerfile, deploy)
│   │   ├── cloudflare.ts     # Cloudflare Workers adapter (generateManifest, generateWorkerShim, deploy)
│   │   └── cli.ts            # mcpster-deploy CLI entry point
│   └── types.ts              # Shared TypeScript types and interfaces
├── tests/
│   ├── server.test.ts
│   ├── tool.test.ts
│   ├── resource.test.ts
│   ├── prompt.test.ts
│   ├── transport.test.ts
│   └── deploy.test.ts
├── examples/
│   └── minimal/              # hello-mcp — tool + resource + prompt, runnable reference
├── package.json
└── tsconfig.json
```

## Deploy (v3)

mcpster ships a deploy kit that pushes your Streamable HTTP server to Railway, Fly.io, or Cloudflare Workers with a single command. The Streamable HTTP transport must already be configured on your server before deploying — the deploy adapters wrap the existing `transport: 'http'` path.

### Prerequisites

| Target | Prerequisite |
|--------|-------------|
| Railway | `railway` CLI installed and authenticated (`railway login`) |
| Fly.io | `flyctl` installed and authenticated (`fly auth login`) |
| Cloudflare Workers | `wrangler` installed and authenticated (`wrangler login`) |

### Usage

```bash
# Dry-run: print the generated manifest without deploying
npx mcpster-deploy --target railway --dry-run
npx mcpster-deploy --target fly --dry-run
npx mcpster-deploy --target cloudflare --dry-run

# Deploy
npx mcpster-deploy --target railway
npx mcpster-deploy --target fly --region lhr
npx mcpster-deploy --target cloudflare
```

All options:

```
-t, --target <target>    Deploy target (railway | fly | cloudflare)
-n, --name <name>        Server name (default: read from package.json)
-v, --version <version>  Server version (default: read from package.json)
-p, --port <port>        HTTP port (default: 3000)
-r, --region <region>    Preferred region — Fly.io only (default: iad)
-d, --dry-run            Print the generated manifest without deploying
-h, --help               Show help
```

### Local → Hosted migration path

**Stage 1 — Local stdio** (no infrastructure)

```typescript
createServer({ name: 'my-server', version: '1.0.0' }).start()
```

**Stage 2 — Local Streamable HTTP** (same server, different transport)

```typescript
createServer({
  name: 'my-server',
  version: '1.0.0',
  transport: 'http',
  http: { port: 3000, path: '/mcp' },
}).start()
```

**Stage 3 — Hosted** (one command, no code changes)

```bash
npx mcpster-deploy --target railway
# → Deployed to Railway: https://my-server.up.railway.app
```

Then connect Claude Code to the deployed server:

```bash
claude mcp add --transport http my-server https://my-server.up.railway.app/mcp
```

The server code is identical across all three stages.

## License

MIT

---