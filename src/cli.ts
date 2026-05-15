#!/usr/bin/env node
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execSync, spawn } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync, readFileSync, readdirSync, createWriteStream } from 'node:fs'

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

    const level1Path = join(fdDir, entry.name, 'TODO.md')
    if (existsSync(level1Path)) {
      const content = readFileSync(level1Path, 'utf8')
      if (hasOpenBotItems(content)) cards.push({ slug: entry.name, path: level1Path, content })
    }

    for (const sub of readdirSync(join(fdDir, entry.name), { withFileTypes: true })) {
      if (!sub.isDirectory()) continue
      const level2Path = join(fdDir, entry.name, sub.name, 'TODO.md')
      if (!existsSync(level2Path)) continue
      const content = readFileSync(level2Path, 'utf8')
      if (hasOpenBotItems(content)) cards.push({ slug: `${entry.name}/${sub.name}`, path: level2Path, content })
    }
  }

  return cards
}

// -- parseDepends -------------------------------------------------------------

function parseDepends(content: string): string[] {
  const preamble = content.split(/^#/m)[0]
  const match = preamble.match(/^depends:\s*(.+)$/im)
  if (!match) return []
  return match[1].split(',').map(s => s.trim()).filter(Boolean)
}

// -- worktree lifecycle -------------------------------------------------------

const activeWorktreeSlugs = new Set<string>()

function worktreePath(root: string, slug: string): string {
  return join(root, '.git', 'flowdeck-tmp', ...slug.split('/'))
}

async function createWorktree(slug: string, root: string): Promise<string> {
  const wtPath = worktreePath(root, slug)
  mkdirSync(dirname(wtPath), { recursive: true })
  execSync(`git worktree add "${wtPath}" -b "deck/${slug}"`, { cwd: root })
  activeWorktreeSlugs.add(slug)
  return wtPath
}

async function removeWorktree(slug: string, root: string): Promise<void> {
  try {
    const wtPath = worktreePath(root, slug)
    execSync(`git worktree remove "${wtPath}" --force`, { cwd: root, stdio: 'ignore' })
    execSync(`git branch -D "deck/${slug}"`, { cwd: root, stdio: 'ignore' })
  } catch {}
  activeWorktreeSlugs.delete(slug)
}

function cleanupAllWorktrees(root: string): void {
  for (const slug of [...activeWorktreeSlugs]) {
    try {
      const wtPath = worktreePath(root, slug)
      execSync(`git worktree remove "${wtPath}" --force`, { cwd: root, stdio: 'ignore' })
      execSync(`git branch -D "deck/${slug}"`, { cwd: root, stdio: 'ignore' })
    } catch {}
    activeWorktreeSlugs.delete(slug)
  }
}

// -- parallel display ---------------------------------------------------------

class ParallelDisplay {
  private statuses: Map<string, string>
  private slugs: string[]
  private interval: ReturnType<typeof setInterval> | null = null
  private rendered = false

  constructor(slugs: string[]) {
    this.slugs = slugs
    this.statuses = new Map(slugs.map(s => [s, 'starting…']))
  }

  update(slug: string, status: string): void {
    this.statuses.set(slug, status)
  }

  start(): void {
    this.interval = setInterval(() => this.render(), 100)
  }

  stop(): void {
    if (this.interval) { clearInterval(this.interval); this.interval = null }
    this.render()
    process.stdout.write('\n')
  }

  private render(): void {
    if (this.rendered) process.stdout.write(`\x1b[${this.slugs.length}A`)
    for (const slug of this.slugs) {
      const status = this.statuses.get(slug) ?? ''
      process.stdout.write(`\x1b[2K\x1b[2m[${slug}]\x1b[0m ${status}\n`)
    }
    this.rendered = true
  }
}

// -- spawnClaude --------------------------------------------------------------

function spawnClaude(args: string[], cwd: string): Promise<{ code: number; result: string }> {
  const frames = ['⠋','⠙','⠹','⠸','⠼','⠴','⠦','⠧','⠇','⠏']
  let frame = 0
  let label = 'thinking…'
  const spin = setInterval(() => {
    process.stdout.write(`\r${frames[frame++ % frames.length]} ${label}   `)
  }, 80)
  const clear = () => { clearInterval(spin); process.stdout.write('\r' + ' '.repeat(label.length + 4) + '\r') }

  const child = spawn('claude', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] })
  let capturedResult = ''
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
          capturedResult = evt.result.trim()
          clear(); console.log(evt.result)
        }
      } catch {}
    }
  })

  child.stderr!.on('data', (chunk: Buffer) => {
    clear(); process.stderr.write(chunk)
  })

  return new Promise(res => child.on('close', c => { clear(); res({ code: c ?? 0, result: capturedResult }) }))
}

function spawnClaudeExecutor(
  slug: string,
  args: string[],
  cwd: string,
  display: ParallelDisplay,
  logPath: string,
): Promise<number> {
  mkdirSync(dirname(logPath), { recursive: true })
  const logStream = createWriteStream(logPath, { flags: 'w' })

  const child = spawn('claude', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] })
  let buf = ''

  child.stdout!.on('data', (chunk: Buffer) => {
    const text = chunk.toString()
    logStream.write(text)
    buf += text
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
              display.update(slug, `${name}(${JSON.stringify(b.input).slice(0, 40)})`)
            }
          }
        } else if (evt.type === 'result') {
          display.update(slug, '✓ done')
        }
      } catch {}
    }
  })

  child.stderr!.on('data', (chunk: Buffer) => { logStream.write(chunk) })

  return new Promise(res => child.on('close', c => { logStream.end(); res(c ?? 0) }))
}

// -- prompts ------------------------------------------------------------------

function buildPlayPrompt(agentMd: string, cardPath: string, cardContent: string, slug: string): string {
  return `${agentMd ? agentMd + '\n\n---\n\n' : ''}Play the card at \`${cardPath}\`. Its current content is below — use it as source of truth, do not re-read it from disk.

1. Complete every unchecked \`- [ ]\` item under \`## BOT\` — read files, edit code, run commands as needed
2. Mark each done \`- [x]\` with a one-line note indented with \`>\`
3. If you need the human to act, add \`- [ ]\` items under \`## HUMAN\`
4. Commit: \`git add -A && git commit -m "deck: <short description>"\`

Do not scan or read any other TODO.md files.

--- card: .flowdeck/${slug}/TODO.md ---
${cardContent}`
}

function buildTurnPrompt(agentMd: string, cardCount: number, hand: string): string {
  return `${agentMd ? agentMd + '\n\n---\n\n' : ''}You are playing a full turn. Your hand has ${cardCount} card${cardCount > 1 ? 's' : ''} with open work.

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
}

// -- orchestrator + parallel execution ----------------------------------------

async function runOrchestrator(
  root: string,
  cards: Array<{ slug: string; content: string }>,
  deps: Record<string, string[]>,
): Promise<string[][]> {
  const templatePath = join(dirname(fileURLToPath(import.meta.url)), '..', 'scaffold', 'orchestrator.md.flowdeck')
  const DEFAULT = `Given the following cards and their declared dependencies, produce a parallel execution plan.

Emit ONLY a JSON object as your final response:
{"groups":[["slug1","slug2"],["slug3"]],"reason":"one-line explanation"}

Rules:
- Each inner array runs in parallel. Groups run sequentially.
- A card must appear in a later group than all of its declared dependencies.
- If a card has no dependencies and nothing depends on it, it can go in group 0.

Cards:
{{CARDS}}

Declared dependencies:
{{DEPS}}`

  const template = existsSync(templatePath) ? readFileSync(templatePath, 'utf8') : DEFAULT
  const cardsBlock = cards.map(c => `slug: ${c.slug}\n---\n${c.content.trim()}`).join('\n\n===\n\n')
  const depsBlock = Object.entries(deps)
    .filter(([, d]) => d.length > 0)
    .map(([s, d]) => `- ${s}: [${d.join(', ')}]`)
    .join('\n') || '(none declared)'

  const prompt = template.replace('{{CARDS}}', cardsBlock).replace('{{DEPS}}', depsBlock)

  const { result } = await spawnClaude([
    '-p', prompt,
    '--dangerously-skip-permissions',
    '--output-format', 'stream-json',
    '--verbose',
  ], root)

  try {
    const jsonMatch = result.match(/\{[\s\S]*\}/)
    if (!jsonMatch) throw new Error('no JSON found')
    const parsed = JSON.parse(jsonMatch[0])
    if (!Array.isArray(parsed.groups)) throw new Error('no groups array')
    return parsed.groups as string[][]
  } catch {
    process.stderr.write('warn: orchestrator output unparseable — falling back to serial execution\n')
    return [cards.map(c => c.slug)]
  }
}

async function executeParallelGroup(
  root: string,
  slugs: string[],
  cards: Array<{ slug: string; path: string; content: string }>,
  agentMd: string,
): Promise<void> {
  const wtPaths = await Promise.all(slugs.map(s => createWorktree(s, root)))

  const display = new ParallelDisplay(slugs)
  display.start()

  await Promise.all(slugs.map((slug, i) => {
    const card = cards.find(c => c.slug === slug)!
    const cardPath = join(wtPaths[i], '.flowdeck', ...slug.split('/'), 'TODO.md')
    const logPath = join(root, '.flowdeck', ...slug.split('/'), 'turn.log')
    const prompt = buildPlayPrompt(agentMd, cardPath, card.content, slug)

    return spawnClaudeExecutor(slug, [
      '-p', prompt,
      '--dangerously-skip-permissions',
      '--output-format', 'stream-json',
      '--verbose',
    ], wtPaths[i], display, logPath)
  }))

  display.stop()
}

function mergeBranch(slug: string, root: string): void {
  const branch = `deck/${slug}`
  try {
    execSync(`git merge --no-ff "${branch}"`, { cwd: root, stdio: 'pipe' })
    removeWorktree(slug, root)
  } catch {
    let conflicting = ''
    try { conflicting = execSync('git diff --name-only --diff-filter=U', { cwd: root }).toString().trim() } catch {}
    process.stderr.write(`Merge conflict in ${branch}:\n${conflicting || '(unknown files)'}\n`)
    process.stderr.write(`Run \`git merge --abort\` to cancel, or resolve then \`git merge ${branch}\`\n`)
    try { execSync('git merge --abort', { cwd: root, stdio: 'ignore' }) } catch {}
    process.exit(1)
  }
}

// -- play command: play a single named card -----------------------------------
async function playCommand(args: string[]): Promise<void> {
  const slug = args.find(a => !a.startsWith('-'))
  if (!slug) {
    console.error('Usage: flowdeck play <card-slug> [--no-dep-check]')
    process.exit(1)
  }

  const root = findProjectRoot(process.cwd())
  if (!root) {
    console.error('Error: no .flowdeck/ found in this directory or any parent')
    process.exit(1)
  }

  const cardPath = join(root, '.flowdeck', ...slug.split('/'), 'TODO.md')
  if (!existsSync(cardPath)) {
    console.error(`Error: no card at .flowdeck/${slug}/TODO.md`)
    process.exit(1)
  }

  const cardContent = readFileSync(cardPath, 'utf8').trim()

  if (!args.includes('--no-dep-check')) {
    const openDeps = parseDepends(cardContent).filter(dep => {
      const depPath = join(root, '.flowdeck', ...dep.split('/'), 'TODO.md')
      return existsSync(depPath) && hasOpenBotItems(readFileSync(depPath, 'utf8'))
    })
    if (openDeps.length > 0) {
      process.stderr.write(`Warning: "${slug}" depends on cards with open items: ${openDeps.join(', ')}\n`)
      process.stderr.write(`Complete those first, or pass --no-dep-check to skip.\n`)
      process.exit(1)
    }
  }

  const agentMd = readAgentMd(root)
  const prompt = buildPlayPrompt(agentMd, cardPath, cardContent, slug)

  const { code } = await spawnClaude([
    '-p', prompt,
    '--dangerously-skip-permissions',
    '--output-format', 'stream-json',
    '--verbose',
  ], root)

  if (code !== 0) process.exit(code)
}

// -- turn command: pass the full hand to Claude -------------------------------
async function turnCommand(args: string[]): Promise<void> {
  const serial = args.includes('--serial')

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

  if (serial) {
    const hand = cards.map(c => `--- card: .flowdeck/${c.slug}/TODO.md ---\n${c.content.trim()}`).join('\n\n')
    const prompt = buildTurnPrompt(agentMd, cards.length, hand)
    const { code } = await spawnClaude([
      '-p', prompt,
      '--dangerously-skip-permissions',
      '--output-format', 'stream-json',
      '--verbose',
    ], root)
    if (code !== 0) process.exit(code)
    return
  }

  // Parse declared dependencies
  const cardDeps: Record<string, string[]> = {}
  for (const card of cards) {
    const deps = parseDepends(card.content)
    cardDeps[card.slug] = deps
    if (deps.length > 0) process.stderr.write(`deps: ${card.slug} → ${deps.join(', ')}\n`)
  }

  // Register cleanup handlers for worktrees
  process.on('SIGINT', () => { cleanupAllWorktrees(root); process.exit(1) })
  process.on('exit', () => { cleanupAllWorktrees(root) })

  // Orchestrator determines execution groups
  const groups = await runOrchestrator(root, cards, cardDeps)

  // Execute each group, then merge
  for (const slugGroup of groups) {
    const validSlugs = slugGroup.filter(s => cards.some(c => c.slug === s))
    if (validSlugs.length === 0) continue

    await executeParallelGroup(root, validSlugs, cards, agentMd)

    for (const slug of validSlugs) {
      mergeBranch(slug, root)
    }
  }

  // Holistic docs pass (sequential, with spinner)
  const docHand = cards.map(c => {
    const p = join(root, '.flowdeck', ...c.slug.split('/'), 'TODO.md')
    const content = existsSync(p) ? readFileSync(p, 'utf8').trim() : c.content.trim()
    return `--- card: .flowdeck/${c.slug}/TODO.md ---\n${content}`
  }).join('\n\n')

  const docPrompt = `${agentMd ? agentMd + '\n\n---\n\n' : ''}All cards have been played. Perform the post-turn documentation pass:
- Update any project docs, architecture notes, or cross-card insights that changed across this turn
- If \`.flowdeck/AGENT.md\` needs updating based on what you learned, update it
- Final commit: \`git add -A && git commit -m "deck: post-turn docs"\`

## Cards played this turn

${docHand}`

  const { code } = await spawnClaude([
    '-p', docPrompt,
    '--dangerously-skip-permissions',
    '--output-format', 'stream-json',
    '--verbose',
  ], root)
  if (code !== 0) process.exit(code)
}

// -- flash command: review a card and add comments without executing ----------
async function flashCommand(args: string[]): Promise<void> {
  const slug = args[0]
  if (!slug) {
    console.error('Usage: flowdeck flash <card-slug>')
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

  const prompt = `${agentMd ? agentMd + '\n\n---\n\n' : ''}You are in FLASH mode. Review the card at \`${cardPath}\`. Its current content is below — use it as source of truth, do not re-read it from disk.

DO NOT execute any tasks. Your job is to annotate the card with observations.

1. Under \`## HUMAN\` → \`#### COMMENTS\`, write your analysis — what each BOT task involves, dependencies, risks, open questions
2. For anything that needs a human decision before work can start, add \`- [ ] <question>?\` items under \`## HUMAN\` (each followed by \`  > _answer:_\`)
3. Leave all \`- [ ]\` BOT items untouched — do not execute, do not check off
4. Commit: \`git add -A && git commit -m "deck: flash ${slug}"\`

--- card: .flowdeck/${slug}/TODO.md ---
${cardContent}`

  const { code } = await spawnClaude([
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
    console.log(`Card already exists at .flowdeck/${column}/TODO.md — nothing to do.`)
    return
  }

  mkdirSync(columnDir, { recursive: true })

  const title = args.slice(1).join(' ') || column
  writeFileSync(cardPath, `# ${title}\n\n## BOT\n\n- [ ] \n\n## HUMAN\n\n#### COMMENTS\n\n`)
  console.log(`✓ Created .flowdeck/${column}/TODO.md`)
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

// -- append command: append a task to an existing card ------------------------
function appendCommand(args: string[]): void {
  const column = args[0]
  const task = args.slice(1).join(' ')

  if (!column || !task) {
    console.error('Usage: flowdeck append <column> <task>')
    process.exit(1)
  }

  const root = findProjectRoot(process.cwd()) ?? (process.env.FLOWDECK_ROOT ?? process.cwd())
  const cardPath = join(root, '.flowdeck', column, 'TODO.md')

  if (!existsSync(cardPath)) {
    console.error(`Error: no card at .flowdeck/${column}/TODO.md`)
    process.exit(1)
  }

  const isQuestion = task.trimEnd().endsWith('?')
  const lines = readFileSync(cardPath, 'utf8').split('\n')

  if (isQuestion) {
    const humanIdx = lines.findIndex(l => l.trim() === '## HUMAN')
    const entry = [`- [ ] ${task}`, `  > _answer:_`, '']
    if (humanIdx === -1) {
      const content = lines.join('\n').trimEnd()
      writeFileSync(cardPath, content + `\n\n## HUMAN\n\n${entry.join('\n')}`)
    } else {
      let insertAt = humanIdx + 1
      while (insertAt < lines.length && lines[insertAt].trim() === '') insertAt++
      lines.splice(insertAt, 0, ...entry)
      writeFileSync(cardPath, lines.join('\n'))
    }
  } else {
    const botIdx = lines.findIndex(l => l.trim() === '## BOT')
    if (botIdx === -1) {
      writeFileSync(cardPath, lines.join('\n').trimEnd() + `\n\n## BOT\n\n- [ ] ${task}\n`)
    } else {
      let sectionEnd = lines.length
      for (let i = botIdx + 1; i < lines.length; i++) {
        if (/^## /.test(lines[i])) { sectionEnd = i; break }
      }
      const emptyIdx = lines.slice(botIdx + 1, sectionEnd).findIndex(l => /^- \[ \]\s*$/.test(l))
      if (emptyIdx !== -1) {
        lines[botIdx + 1 + emptyIdx] = `- [ ] ${task}`
        writeFileSync(cardPath, lines.join('\n'))
      } else {
        let insertAt = sectionEnd
        while (insertAt > botIdx + 1 && lines[insertAt - 1].trim() === '') insertAt--
        lines.splice(insertAt, 0, `- [ ] ${task}`, '')
        writeFileSync(cardPath, lines.join('\n'))
      }
    }
  }

  console.log(`✓ Added task to .flowdeck/${column}/TODO.md`)
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
  flash <card-slug>           Review a card and add comments without executing tasks
  turn                        Pass the full deck hand to Claude (orchestrate, parallelize, execute, document)
  turn --serial               Run cards sequentially using the legacy single-agent path
  add <column> [title]        Create a new column + card
  append <column> <task>      Append a task to an existing card

Examples:
  flowdeck init
  flowdeck play payments
  flowdeck play payments --no-dep-check
  flowdeck flash payments
  flowdeck turn
  flowdeck turn --serial
  flowdeck add payments "Stripe integration"
  flowdeck append payments "add refund flow"
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
} else if (subcmd === 'flash') {
  await flashCommand(rest)
} else if (subcmd === 'turn') {
  await turnCommand(rest)
} else if (subcmd === 'add') {
  addCommand(rest)
} else if (subcmd === 'append' || subcmd === 'upgrade') {
  appendCommand(rest)
} else {
  console.error(`Unknown command: ${subcmd}`)
  process.exit(1)
}
