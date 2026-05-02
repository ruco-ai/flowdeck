#!/usr/bin/env node
import { installServer } from 'mcpster'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execSync, spawnSync } from 'node:child_process'

const [,, subcmd, ...rest] = process.argv

// -- send command: stage, commit, ask claude to work --------------------------
async function sendCommand(args: string[]): Promise<void> {
  let message = ''
  let i = 0

  // Parse: send -m "message" or send --message "message"
  while (i < args.length) {
    if ((args[i] === '-m' || args[i] === '--message') && i + 1 < args.length) {
      message = args[i + 1]
      i += 2
      break
    }
    i++
  }

  if (!message) {
    console.error('Error: -m "message" is required')
    process.exit(1)
  }

  const cwd = process.env.FLOWDECK_ROOT ?? process.cwd()

  try {
    execSync('git add -A', { cwd, stdio: 'pipe' })
    execSync(`git commit -m "${message.replace(/"/g, '\\"')}"`, { cwd, stdio: 'pipe' })
    console.log(`✓ Committed: "${message}"`)
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e)
    if (!error.includes('nothing to commit')) {
      console.error(`Error: ${error}`)
      process.exit(1)
    }
  }

  // Detect which open issue was touched in the last commit
  let issuePath: string | undefined
  try {
    const files = execSync('git show --name-only --format="" HEAD', { cwd, encoding: 'utf8', stdio: 'pipe' })
      .trim().split('\n')
    const slug = files.filter(f => f.startsWith('open/')).map(f => f.split('/')[1]).filter(Boolean)[0]
    if (slug) issuePath = slug
  } catch {}

  if (!issuePath) {
    console.error('Could not detect an open issue in the last commit.')
    process.exit(1)
  }

  const __dirname = dirname(fileURLToPath(import.meta.url))
  const serverPath = join(__dirname, 'index.js')

  const mcpConfig = JSON.stringify({
    mcpServers: {
      flowdeck: { command: 'node', args: [serverPath], env: { FLOWDECK_ROOT: cwd } },
    },
  })

  const prompt =
    `Use the flowdeck MCP tool "flowdeck-do" on path "${issuePath}": ` +
    `call with action="context" to read what was asked, do the work by reading and editing files, ` +
    `then call with action="commit" and a concise summary message.`

  console.log(`→ Claude is handling issue: ${issuePath}\n`)
  const result = spawnSync('claude', ['-p', prompt, '--mcp-config', mcpConfig, '--dangerously-skip-permissions'], {
    cwd,
    stdio: 'inherit',
  })
  if (result.status !== 0) process.exit(result.status ?? 1)
}

// -- main =====================================================================
if (!subcmd || subcmd === '--help' || subcmd === '-h') {
  console.log(`Usage: flowdeck <command> [options]

Commands:
  open <title>           Create a new issue folder
  list                   Show all open issues
  send -m "<message>"    Stage changes, commit with message, prompt Claude via /flowdeck-do
  install                Register the MCP server in Claude

Examples:
  flowdeck open "Fix login bug"
  flowdeck list
  flowdeck send -m "implement the stripe webhook"
  flowdeck install
`)
  process.exit(0)
}

if (subcmd === 'install') {
  const __dirname = dirname(fileURLToPath(import.meta.url))
  const serverPath = join(__dirname, 'index.js')
  const root = process.env.FLOWDECK_ROOT ?? process.cwd()
  installServer('flowdeck', serverPath, { FLOWDECK_ROOT: root })
  console.log(`\nflowdeck installed — root: ${root}`)
  console.log('Restart Claude desktop / reload VS Code to apply.\n')
} else if (subcmd === 'send') {
  await sendCommand(rest)
} else if (subcmd === 'open') {
  const title = rest.join(' ')
  if (!title) {
    console.error('Error: title is required')
    process.exit(1)
  }

  const cwd = process.env.FLOWDECK_ROOT ?? process.cwd()
  const openDir = join(cwd, 'open')

  try {
    execSync(`test -d "${openDir}"`, { stdio: 'pipe' })
  } catch {
    execSync(`mkdir -p "${openDir}"`, { cwd })
  }

  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')

  const issueDir = join(openDir, slug)
  execSync(`mkdir -p "${issueDir}"`, { cwd })

  const readmePath = join(issueDir, 'README.md')
  execSync(`printf "# ${title}\\n\\n" > "${readmePath}"`, { cwd })

  console.log(`✓ Created open/${slug}/README.md`)
} else if (subcmd === 'list') {
  const cwd = process.env.FLOWDECK_ROOT ?? process.cwd()
  const openDir = join(cwd, 'open')

  function buildTree(dir: string, indent: string = ''): string {
    try {
      execSync(`test -d "${dir}"`, { stdio: 'pipe' })
    } catch {
      return 'No open issues.'
    }

    try {
      const entries = execSync(`ls -1 "${dir}"`, { encoding: 'utf8', stdio: 'pipe' })
        .trim()
        .split('\n')
        .filter(e => { if (!e) return false; try { execSync(`test -d "${dir}/${e}"`, { stdio: 'pipe' }); return true } catch { return false } })
        .sort()

      return entries
        .map(e => {
          const readmePath = join(dir, e, 'README.md')
          let title = e
          try {
            const content = execSync(`head -1 "${readmePath}"`, { encoding: 'utf8', stdio: 'pipe' })
            title = content.replace(/^#+ /, '').trim()
          } catch {}

          const subTree: string = buildTree(join(dir, e), indent + '  ')
          return [`${indent}- **${e}** — ${title}`, subTree].filter(Boolean).join('\n')
        })
        .join('\n')
    } catch {
      return 'No open issues.'
    }
  }

  const tree = buildTree(openDir)
  console.log('\n' + tree + '\n')
} else {
  console.error(`Unknown command: ${subcmd}`)
  process.exit(1)
}

