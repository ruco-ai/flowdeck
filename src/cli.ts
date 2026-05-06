#!/usr/bin/env node
import { basename, dirname, join, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execSync, spawn } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'

const [,, subcmd, ...rest] = process.argv

// -- helpers ------------------------------------------------------------------

function findProjectRoot(from: string): string | null {
  let dir = from
  while (true) {
    if (existsSync(join(dir, '.flowdeck'))) return dir
    const parent = dirname(dir)
    if (parent === dir) return null
    dir = parent
  }
}

function readAgentMd(root: string): string {
  const p = join(root, '.flowdeck', 'AGENT.md')
  return existsSync(p) ? readFileSync(p, 'utf8').trim() : ''
}

function loadIgnoreNames(root: string): Set<string> {
  const p = join(root, '.flowdeck', '.flowdeckignore')
  if (!existsSync(p)) return new Set()
  return new Set(
    readFileSync(p, 'utf8').split('\n')
      .map(l => l.trim().replace(/\/$/, ''))
      .filter(l => l && !l.startsWith('#'))
  )
}

function hasOpenBotItems(content: string): boolean {
  let inBot = false
  for (const line of content.split('\n')) {
    if (/^## BOT/.test(line)) { inBot = true; continue }
    if (/^## /.test(line) && inBot) inBot = false
    if (inBot && /^- \[ \]/.test(line)) return true
  }
  return false
}

function collectOpenCards(root: string): Array<{ slug: string; path: string; content: string }> {
  const fdDir = join(root, '.flowdeck')
  const ignore = loadIgnoreNames(root)
  const cards: Array<{ slug: string; path: string; content: string }> = []

  for (const entry of readdirSync(fdDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    if (ignore.has(entry.name)) continue
    const cardPath = join(fdDir, entry.name, 'TODO.md')
    if (!existsSync(cardPath)) continue
    const content = readFileSync(cardPath, 'utf8')
    if (hasOpenBotItems(content)) cards.push({ slug: entry.name, path: cardPath, content })
  }

  return cards
}

function spawnClaude(args: string[], cwd: string): Promise<number> {
  const frames = ['⠋','⠙','⠹','⠸','⠼','⠴','⠦','⠧','⠇','⠏']
  let frame = 0
  let label = 'thinking…'
  const spin = setInterval(() => {
    process.stdout.write(`\r${frames[frame++ % frames.length]} ${label}   `)
  }, 80)
  const clear = () => { clearInterval(spin); process.stdout.write('\r' + ' '.repeat(label.length + 4) + '\r') }

  const child = spawn('claude', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] })

  let buf = ''
  child.stdout!.on('data', (chunk: Buffer) => {
    buf += chunk.toString()
    const lines = buf.split('\n')
    buf = lines.pop() ?? ''
    for (const line of lines) {
      if (!line.trim()) continue
      try {
        const evt = JSON.parse(line)
        if (evt.type === 'assistant') {
          for (const b of (evt.message?.content ?? [])) {
            if (b.type === 'tool_use') {
              const name = String(b.name).replace(/^mcp__[^_]+__/, '')
              label = `${name}(${JSON.stringify(b.input).slice(0, 50)})`
            } else if (b.type === 'text' && b.text?.trim()) {
              clear(); console.log(b.text)
            }
          }
        } else if (evt.type === 'result' && evt.result?.trim()) {
          clear(); console.log(evt.result)
        }
      } catch {}
    }
  })
  child.stderr!.on('data', (chunk: Buffer) => {
    clear(); process.stderr.write(chunk)
  })

  return new Promise<number>(res => child.on('close', c => res(c ?? 0)))
}

// -- play command: play a single named card -----------------------------------
async function playCommand(args: string[]): Promise<void> {
  const slug = args[0]
  if (!slug) {
    console.error('Usage: flowdeck play <card-slug>')
    process.exit(1)
  }

  const root = findProjectRoot(process.cwd())
  if (!root) {
    console.error('Error: no .flowdeck/ found in this directory or any parent')
    process.exit(1)
  }

  const cardPath = join(root, '.flowdeck', slug, 'TODO.md')
  if (!existsSync(cardPath)) {
    console.error(`Error: no card at .flowdeck/${slug}/TODO.md`)
    process.exit(1)
  }

  const cardContent = readFileSync(cardPath, 'utf8').trim()
  const agentMd = readAgentMd(root)

  const prompt = `${agentMd ? agentMd + '\n\n---\n\n' : ''}Play the card at \`${cardPath}\`. Its current content is below — use it as source of truth, do not re-read it from disk.

1. Complete every unchecked \`- [ ]\` item under \`## BOT\` — read files, edit code, run commands as needed
2. Mark each done \`- [x]\` with a one-line note indented with \`>\`
3. If you need the human to act, add \`- [ ]\` items under \`## HUMAN\`
4. Commit: \`git add -A && git commit -m "deck: <short description>"\`

Do not scan or read any other TODO.md files.

--- card: .flowdeck/${slug}/TODO.md ---
${cardContent}`

  const code = await spawnClaude([
    '-p', prompt,
    '--dangerously-skip-permissions',
    '--output-format', 'stream-json',
    '--verbose',
  ], root)

  if (code !== 0) process.exit(code)
}

// -- turn command: pass the full hand to Claude -------------------------------
async function turnCommand(): Promise<void> {
  const root = findProjectRoot(process.cwd())
  if (!root) {
    console.error('Error: no .flowdeck/ found in this directory or any parent')
    process.exit(1)
  }

  const cards = collectOpenCards(root)
  if (cards.length === 0) {
    console.log('No open cards. The deck is clear.')
    return
  }

  const agentMd = readAgentMd(root)

  const hand = cards
    .map(c => `--- card: .flowdeck/${c.slug}/TODO.md ---\n${c.content.trim()}`)
    .join('\n\n')

  const prompt = `${agentMd ? agentMd + '\n\n---\n\n' : ''}You are playing a full turn. Your hand has ${cards.length} card${cards.length > 1 ? 's' : ''} with open work.

## Assess the hand first

Before executing, read all cards and state your plan (a few lines):

1. **Prioritize** — decide play order. Most blocking or highest-leverage first.
2. **Discard** — identify cards that are duplicated or obsolete. For each, move unchecked BOT items to a \`## DISCARDED\` section with a one-line reason. Do not delete the card file.
3. **Combine** — identify cards with complementary tasks that are more efficient to execute together. Note the combination and work them in a single pass.

## Execute

For each card (or combined set), in your chosen order:
1. Complete every unchecked \`- [ ]\` item under \`## BOT\`
2. Mark each \`- [x]\` with a one-line note indented with \`>\`
3. If something needs the human, add \`- [ ]\` items under \`## HUMAN\`
4. Commit: \`git add -A && git commit -m "deck: <short description>"\`

## After the hand

Once all cards are played, do a holistic documentation pass:
- Update any project docs, architecture notes, or cross-card insights that changed across this turn
- If \`.flowdeck/AGENT.md\` needs updating based on what you learned, update it
- Final commit: \`git add -A && git commit -m "deck: post-turn docs"\`

## Your hand

${hand}`

  const code = await spawnClaude([
    '-p', prompt,
    '--dangerously-skip-permissions',
    '--output-format', 'stream-json',
    '--verbose',
  ], root)

  if (code !== 0) process.exit(code)
}

// -- add command: create a new column + card ----------------------------------
function addCommand(args: string[]): void {
  const column = args[0]
  if (!column) {
    console.error('Usage: flowdeck add <column> [title]')
    process.exit(1)
  }

  const root = findProjectRoot(process.cwd()) ?? (process.env.FLOWDECK_ROOT ?? process.cwd())
  const columnDir = join(root, '.flowdeck', column)
  const cardPath = join(columnDir, 'TODO.md')

  if (existsSync(cardPath)) {
    console.error(`Error: card already exists at .flowdeck/${column}/TODO.md`)
    process.exit(1)
  }

  mkdirSync(columnDir, { recursive: true })

  const title = args.slice(1).join(' ') || column
  writeFileSync(cardPath, `# ${title}\n\n## BOT\n\n- [ ] \n\n## HUMAN\n\n#### COMMENTS\n\n`)
  console.log(`✓ Created .flowdeck/${column}/TODO.md`)
}

// -- upgrade command: append a task to an existing card -----------------------
function upgradeCommand(args: string[]): void {
  const column = args[0]
  const task = args.slice(1).join(' ')

  if (!column || !task) {
    console.error('Usage: flowdeck upgrade <column> <task>')
    process.exit(1)
  }

  const root = findProjectRoot(process.cwd()) ?? (process.env.FLOWDECK_ROOT ?? process.cwd())
  const cardPath = join(root, '.flowdeck', column, 'TODO.md')

  if (!existsSync(cardPath)) {
    console.error(`Error: no card at .flowdeck/${column}/TODO.md`)
    process.exit(1)
  }

  const lines = readFileSync(cardPath, 'utf8').split('\n')
  const botIdx = lines.findIndex(l => l.trim() === '## BOT')

  if (botIdx === -1) {
    writeFileSync(cardPath, lines.join('\n').trimEnd() + `\n\n## BOT\n\n- [ ] ${task}\n`)
  } else {
    let insertAt = lines.length
    for (let i = botIdx + 1; i < lines.length; i++) {
      if (/^## /.test(lines[i])) { insertAt = i; break }
    }
    while (insertAt > botIdx + 1 && lines[insertAt - 1].trim() === '') insertAt--
    lines.splice(insertAt, 0, `- [ ] ${task}`, '')
    writeFileSync(cardPath, lines.join('\n'))
  }

  console.log(`✓ Added task to .flowdeck/${column}/TODO.md`)
}

// -- mdblu template resolution ------------------------------------------------
const MDBLU_GH_RAW = 'https://raw.githubusercontent.com/ruco-ai/mdblu/master/templates'

const FLOWDECK_TEMPLATES = [
  'SPEC.md.template',
  'MISSION.md.template',
  'OPEN-QUESTIONS.md.template',
  'ADR.md.template',
  'GENERALINSIGHTS.md.template',
  'PROJECTINSIGHTS.md.template',
  'CLAUDE.md.template',
]

async function scaffoldTemplates(destDir: string, cwd: string): Promise<string> {
  mkdirSync(destDir, { recursive: true })

  const localDir = join(cwd, '.mdblu', 'templates')
  if (existsSync(localDir)) {
    const files = readdirSync(localDir).filter(f => FLOWDECK_TEMPLATES.includes(f))
    for (const f of files) writeFileSync(join(destDir, f), readFileSync(join(localDir, f)))
    return `local .mdblu/ (${files.length} templates)`
  }

  const results = await Promise.all(FLOWDECK_TEMPLATES.map(async name => {
    try {
      const r = await fetch(`${MDBLU_GH_RAW}/${name}`, { signal: AbortSignal.timeout(5000) })
      if (!r.ok) return false
      writeFileSync(join(destDir, name), await r.text())
      return true
    } catch { return false }
  }))
  const n = results.filter(Boolean).length
  return `GitHub (${n}/${FLOWDECK_TEMPLATES.length} templates)`
}

// -- main =====================================================================
if (subcmd === '--version' || subcmd === '-v') {
  const pkg = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'package.json'), 'utf8'))
  console.log(pkg.version)
  process.exit(0)
}

if (!subcmd || subcmd === '--help' || subcmd === '-h') {
  console.log(`Usage: flowdeck <command> [options]

Commands:
  init                        Create .flowdeck/ scaffold with templates
  play <card-slug>            Play a single card by name
  turn                        Pass the full deck hand to Claude (prioritize, discard, combine, execute)
  add <column> [title]        Create a new column + card
  upgrade <column> <task>     Append a task to an existing card

Examples:
  flowdeck init
  flowdeck play payments
  flowdeck turn
  flowdeck add payments "Stripe integration"
  flowdeck upgrade payments "add refund flow"
`)
  process.exit(0)
}

if (subcmd === 'init') {
  const cwd = process.env.FLOWDECK_ROOT ?? process.cwd()
  const fd = join(cwd, '.flowdeck')

  if (existsSync(fd)) {
    console.error('Error: .flowdeck/ already exists')
    process.exit(1)
  }

  const scaffoldDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'scaffold')

  mkdirSync(join(fd, 'start'), { recursive: true })

  writeFileSync(join(fd, 'AGENT.md'), readFileSync(join(scaffoldDir, 'AGENT.md.flowdeck'), 'utf8'))
  writeFileSync(join(fd, 'TODO.md.template'), readFileSync(join(scaffoldDir, 'TODO.md.flowdeck'), 'utf8'))
  writeFileSync(join(fd, 'start', 'TODO.md'), readFileSync(join(scaffoldDir, 'start', 'TODO.md.flowdeck'), 'utf8'))

  writeFileSync(join(fd, '.flowdeckignore'), `\
node_modules/
dist/
.git/
*.log
.env
`)

  const scaffoldCommandsDir = join(scaffoldDir, '.claude', 'commands')
  const projectCommandsDir = join(cwd, '.claude', 'commands')
  mkdirSync(projectCommandsDir, { recursive: true })
  for (const f of readdirSync(scaffoldCommandsDir)) {
    writeFileSync(join(projectCommandsDir, f), readFileSync(join(scaffoldCommandsDir, f)))
  }

  process.stdout.write('  fetching mdblu templates…')
  const templateSource = await scaffoldTemplates(join(fd, 'templates'), cwd)
  process.stdout.write(`\r✓ templates — ${templateSource}\n`)

  console.log(`✓ .flowdeck/ initialized
  AGENT.md               — project context for Claude (edit this)
  TODO.md.template       — card format reference
  start/TODO.md          — first work area
  templates/             — mdblu templates (source: ${templateSource})
  .flowdeckignore
  .claude/commands/      — slash commands (play-card, turn, add-card, upgrade-card)
`)
} else if (subcmd === 'play') {
  await playCommand(rest)
} else if (subcmd === 'turn') {
  await turnCommand()
} else if (subcmd === 'add') {
  addCommand(rest)
} else if (subcmd === 'upgrade') {
  upgradeCommand(rest)
} else {
  console.error(`Unknown command: ${subcmd}`)
  process.exit(1)
}
