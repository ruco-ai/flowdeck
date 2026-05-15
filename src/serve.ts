import { createServer, IncomingMessage, ServerResponse } from 'node:http'
import { spawn, ChildProcess, execSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseCard } from './github.js'

// ── Types ─────────────────────────────────────────────────────────────────────

type CardState = 'idle' | 'bot-running' | 'bot-done' | 'human-pending' | 'human-done' | 'archived'
type EventType = 'bot:output' | 'bot:done' | 'state:change' | 'error'

interface CardInfo {
  id: string
  title: string
  file: string
  state: CardState
  github_issue?: string
  bot_progress: number
  last_run?: string
  human_checklist: { total: number; checked: number }
}

interface FlowdeckStatus {
  server_version: string
  project_dir: string
  deck_file: string
  active_card?: CardInfo
  agent: string
  git_branch: string
  git_dirty: boolean
  uptime_seconds: number
}

interface RingEvent {
  id: number
  type: EventType
  card_id?: string
  data: string
  timestamp: string
}

interface ActiveRun {
  cardId: string
  startedAt: string
  process: ChildProcess
}

// ── Module-level server state ─────────────────────────────────────────────────

let serverStartTime = 0
let activeRun: ActiveRun | null = null
let turnRunning = false
let eventCounter = 0
const ringBuffer: RingEvent[] = []
const sseClients = new Set<ServerResponse>()
const lastRunMap = new Map<string, string>()

// ── Filesystem helpers ────────────────────────────────────────────────────────

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

function buildPlayPrompt(agentMd: string, cardPath: string, cardContent: string, slug: string): string {
  return `${agentMd ? agentMd + '\n\n---\n\n' : ''}Play the card at \`${cardPath}\`. Its current content is below — use it as source of truth, do not re-read it from disk.

1. Complete every unchecked \`- [ ]\` item under \`## BOT\` — read files, edit code, run commands as needed
2. Mark each done \`- [x]\` with a one-line note indented with \`>\`
3. If you need the human to act, add \`- [ ]\` items under \`## HUMAN\`
4. Commit: \`git add -A && git commit -m "deck: <short description>"\`
5. Check if any project documents (README, AGENT.md, architecture notes, changelogs) need updating based on the changes you made. If so, update them and commit: \`git add -A && git commit -m "docs: <short description>"\`

Do not scan or read any other TODO.md files.

--- card: .flowdeck/${slug}/TODO.md ---
${cardContent}`
}

// ── Card ID / slug conversion ─────────────────────────────────────────────────

function idToSlug(id: string): string { return id.replace(/--/g, '/') }
function slugToId(slug: string): string { return slug.replace(/\//g, '--') }
function slugToCardPath(root: string, slug: string): string {
  return join(root, '.flowdeck', ...slug.split('/'), 'TODO.md')
}

// ── Card state detection ──────────────────────────────────────────────────────

function detectState(parsed: ReturnType<typeof parseCard>, cardId?: string): CardState {
  if (cardId && activeRun?.cardId === cardId) return 'bot-running'
  if (!parsed.allBotItemsDone) return 'idle'
  const total = parsed.doneCriteria.length
  const checked = parsed.doneCriteria.filter(c => c.checked).length
  if (total === 0) return 'bot-done'
  if (checked === total) return 'human-done'
  return 'human-pending'
}

const ALWAYS_SKIP = new Set(['templates', 'AGENT.md'])

function buildCardInfo(id: string, cardPath: string, forceArchived: boolean): CardInfo {
  const content = readFileSync(cardPath, 'utf8')
  const parsed = parseCard(cardPath, content)

  const state: CardState = forceArchived ? 'archived' : detectState(parsed, id)

  const botLines = parsed.botSection.split('\n').filter(l => /^- \[[ x]\]/.test(l))
  const botChecked = botLines.filter(l => /^- \[x\]/.test(l)).length
  const bot_progress = botLines.length > 0 ? botChecked / botLines.length : 0

  const human_checklist = {
    total: parsed.doneCriteria.length,
    checked: parsed.doneCriteria.filter(c => c.checked).length,
  }

  const info: CardInfo = {
    id,
    title: parsed.title,
    file: `${idToSlug(id)}/TODO.md`,
    state,
    bot_progress,
    last_run: lastRunMap.get(id),
    human_checklist,
  }
  if (parsed.frontmatter.github_issue) info.github_issue = parsed.frontmatter.github_issue
  return info
}

function collectAllCards(root: string): CardInfo[] {
  const fdDir = join(root, '.flowdeck')
  const ignore = loadIgnoreNames(root)
  const cards: CardInfo[] = []

  for (const entry of readdirSync(fdDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    if (ignore.has(entry.name) || ALWAYS_SKIP.has(entry.name)) continue

    const isDoneFolder = entry.name === 'done'

    if (!isDoneFolder) {
      const p = join(fdDir, entry.name, 'TODO.md')
      if (existsSync(p)) cards.push(buildCardInfo(entry.name, p, false))
    }

    for (const sub of readdirSync(join(fdDir, entry.name), { withFileTypes: true })) {
      if (!sub.isDirectory()) continue
      const p = join(fdDir, entry.name, sub.name, 'TODO.md')
      if (!existsSync(p)) continue
      const id = isDoneFolder ? sub.name : slugToId(`${entry.name}/${sub.name}`)
      cards.push(buildCardInfo(id, p, isDoneFolder))
    }
  }
  return cards
}

function collectOpenCardsForTurn(root: string): Array<{ slug: string; content: string }> {
  const fdDir = join(root, '.flowdeck')
  const ignore = loadIgnoreNames(root)
  const cards: Array<{ slug: string; content: string }> = []

  for (const entry of readdirSync(fdDir, { withFileTypes: true })) {
    if (!entry.isDirectory() || ignore.has(entry.name) || ALWAYS_SKIP.has(entry.name) || entry.name === 'done') continue
    const p = join(fdDir, entry.name, 'TODO.md')
    if (existsSync(p)) {
      const content = readFileSync(p, 'utf8')
      if (hasOpenBotItems(content)) cards.push({ slug: entry.name, content })
    }
    for (const sub of readdirSync(join(fdDir, entry.name), { withFileTypes: true })) {
      if (!sub.isDirectory()) continue
      const p2 = join(fdDir, entry.name, sub.name, 'TODO.md')
      if (!existsSync(p2)) continue
      const content = readFileSync(p2, 'utf8')
      if (hasOpenBotItems(content)) cards.push({ slug: `${entry.name}/${sub.name}`, content })
    }
  }
  return cards
}

// ── SSE ───────────────────────────────────────────────────────────────────────

function formatSSEEvent(evt: RingEvent): string {
  const payload = { card_id: evt.card_id, data: evt.data, timestamp: evt.timestamp }
  return `id: ${evt.id}\nevent: ${evt.type}\ndata: ${JSON.stringify(payload)}\n\n`
}

function emitEvent(type: EventType, data: string, cardId?: string): void {
  const evt: RingEvent = {
    id: ++eventCounter,
    type,
    card_id: cardId,
    data,
    timestamp: new Date().toISOString(),
  }
  ringBuffer.push(evt)
  if (ringBuffer.length > 100) ringBuffer.shift()

  const payload = formatSSEEvent(evt)
  for (const res of sseClients) {
    if (!res.destroyed) res.write(payload)
    else sseClients.delete(res)
  }
}

// ── HTTP helpers ──────────────────────────────────────────────────────────────

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  if (res.headersSent) return
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(body))
}

async function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let raw = ''
    req.on('data', chunk => { raw += chunk.toString() })
    req.on('end', () => {
      try { resolve(raw ? JSON.parse(raw) as Record<string, unknown> : {}) }
      catch { reject(new Error('invalid JSON')) }
    })
    req.on('error', reject)
  })
}

function checkAuth(req: IncomingMessage, res: ServerResponse, apiToken: string | null, path: string): boolean {
  if (!apiToken || path === '/flowdeck/health') return true
  const auth = req.headers['authorization']
  if (auth !== `Bearer ${apiToken}`) {
    sendJson(res, 401, { error: 'unauthorized' })
    return false
  }
  return true
}

// ── Route handlers ────────────────────────────────────────────────────────────

function handleHealth(res: ServerResponse, version: string): void {
  sendJson(res, 200, { status: 'ok', version })
}

function handleStatus(res: ServerResponse, root: string, version: string, agent: string): void {
  let git_branch = 'unknown'
  let git_dirty = false
  try {
    git_branch = execSync('git rev-parse --abbrev-ref HEAD', { cwd: root, stdio: 'pipe' }).toString().trim()
    git_dirty = execSync('git status --porcelain', { cwd: root, stdio: 'pipe' }).toString().trim().length > 0
  } catch {}

  const status: FlowdeckStatus = {
    server_version: version,
    project_dir: root,
    deck_file: join(root, '.flowdeck'),
    agent,
    git_branch,
    git_dirty,
    uptime_seconds: Math.floor((Date.now() - serverStartTime) / 1000),
  }

  if (activeRun) {
    try {
      const cardPath = slugToCardPath(root, idToSlug(activeRun.cardId))
      status.active_card = buildCardInfo(activeRun.cardId, cardPath, false)
    } catch {}
  }

  sendJson(res, 200, status)
}

function handleCards(res: ServerResponse, root: string): void {
  try {
    sendJson(res, 200, { cards: collectAllCards(root) })
  } catch (e) {
    sendJson(res, 500, { error: 'deck parse error', details: String(e) })
  }
}

function handleCard(res: ServerResponse, root: string, id: string): void {
  const slug = idToSlug(id)
  const cardPath = slugToCardPath(root, slug)
  if (!existsSync(cardPath)) {
    sendJson(res, 404, { error: 'card not found', id })
    return
  }
  try {
    sendJson(res, 200, buildCardInfo(id, cardPath, false))
  } catch (e) {
    sendJson(res, 500, { error: 'deck parse error', details: String(e) })
  }
}

async function handleRun(req: IncomingMessage, res: ServerResponse, root: string, defaultAgent: string): Promise<void> {
  let body: Record<string, unknown>
  try { body = await readBody(req) }
  catch { sendJson(res, 400, { error: 'invalid request', details: 'invalid JSON' }); return }

  const card_id = typeof body['card_id'] === 'string' ? body['card_id'] : undefined
  if (!card_id) {
    sendJson(res, 400, { error: 'invalid request', details: 'card_id required' })
    return
  }

  if (activeRun || turnRunning) {
    sendJson(res, 409, { error: 'another card is already running', active_card_id: activeRun?.cardId })
    return
  }

  const slug = idToSlug(card_id)
  const cardPath = slugToCardPath(root, slug)
  if (!existsSync(cardPath)) {
    sendJson(res, 404, { error: 'card not found', card_id })
    return
  }

  const content = readFileSync(cardPath, 'utf8')
  const parsed = parseCard(cardPath, content)
  const currentState = detectState(parsed)

  if (currentState !== 'idle' && currentState !== 'bot-done') {
    sendJson(res, 400, { error: 'card is not in idle or bot-done state', current_state: currentState })
    return
  }

  const agentName = typeof body['agent'] === 'string' ? body['agent'] : defaultAgent
  if (agentName !== 'claude-code' && agentName !== 'claude') {
    sendJson(res, 400, { error: 'invalid request', details: `unsupported agent: ${agentName}` })
    return
  }

  const agentMd = readAgentMd(root)
  const prompt = buildPlayPrompt(agentMd, cardPath, content.trim(), slug)
  const startedAt = new Date().toISOString()

  const child = spawn('claude', [
    '-p', prompt,
    '--dangerously-skip-permissions',
    '--output-format', 'stream-json',
    '--verbose',
  ], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] })

  activeRun = { cardId: card_id, startedAt, process: child }
  lastRunMap.set(card_id, startedAt)
  emitEvent('state:change', 'bot-running', card_id)

  let buf = ''
  child.stdout!.on('data', (chunk: Buffer) => {
    buf += chunk.toString()
    const lines = buf.split('\n')
    buf = lines.pop() ?? ''
    for (const line of lines) {
      if (!line.trim()) continue
      try {
        const evt = JSON.parse(line) as Record<string, unknown>
        if (evt['type'] === 'assistant') {
          const content = (evt['message'] as Record<string, unknown>)?.['content']
          for (const b of (Array.isArray(content) ? content : []) as Array<Record<string, unknown>>) {
            if (b['type'] === 'text' && typeof b['text'] === 'string' && b['text'].trim()) {
              emitEvent('bot:output', b['text'], card_id)
            }
          }
        }
      } catch {}
    }
  })

  child.stderr!.on('data', (chunk: Buffer) => {
    emitEvent('bot:output', chunk.toString(), card_id)
  })

  child.on('close', code => {
    activeRun = null
    if (code === 0) {
      emitEvent('bot:done', '', card_id)
      emitEvent('state:change', 'bot-done', card_id)
    } else {
      emitEvent('error', `Agent exited with code ${code}`, card_id)
      emitEvent('state:change', 'idle', card_id)
    }
  })

  sendJson(res, 202, { card_id, state: 'bot-running', events_url: '/flowdeck/events' })
}

function handleCancel(res: ServerResponse, root: string, id: string): void {
  const cardPath = slugToCardPath(root, idToSlug(id))
  if (!existsSync(cardPath)) {
    sendJson(res, 404, { error: 'card not found' })
    return
  }
  if (!activeRun || activeRun.cardId !== id) {
    sendJson(res, 409, { error: 'card is not currently running' })
    return
  }
  const cardId = activeRun.cardId
  activeRun.process.kill('SIGTERM')
  activeRun = null
  emitEvent('state:change', 'bot-done', cardId)
  sendJson(res, 200, { card_id: cardId, state: 'bot-done', cancelled: true })
}

async function handleTurn(req: IncomingMessage, res: ServerResponse, root: string): Promise<void> {
  if (activeRun || turnRunning) {
    sendJson(res, 409, { error: 'a card or turn is already running' })
    return
  }

  const openCards = collectOpenCardsForTurn(root)
  if (openCards.length === 0) {
    sendJson(res, 200, { state: 'idle', message: 'No open cards. The deck is clear.' })
    return
  }

  turnRunning = true
  emitEvent('state:change', 'turn-running' as EventType)

  const agentMd = readAgentMd(root)
  const hand = openCards.map(c => `--- card: .flowdeck/${c.slug}/TODO.md ---\n${c.content.trim()}`).join('\n\n')
  const prompt = `${agentMd ? agentMd + '\n\n---\n\n' : ''}You are playing a full turn. Your hand has ${openCards.length} card${openCards.length !== 1 ? 's' : ''} with open work.\n\n## Your hand\n\n${hand}`

  const child = spawn('claude', [
    '-p', prompt,
    '--dangerously-skip-permissions',
    '--output-format', 'stream-json',
    '--verbose',
  ], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] })

  let buf = ''
  child.stdout!.on('data', (chunk: Buffer) => {
    buf += chunk.toString()
    const lines = buf.split('\n')
    buf = lines.pop() ?? ''
    for (const line of lines) {
      if (!line.trim()) continue
      try {
        const evt = JSON.parse(line) as Record<string, unknown>
        if (evt['type'] === 'assistant') {
          const content = (evt['message'] as Record<string, unknown>)?.['content']
          for (const b of (Array.isArray(content) ? content : []) as Array<Record<string, unknown>>) {
            if (b['type'] === 'text' && typeof b['text'] === 'string' && b['text'].trim()) {
              emitEvent('bot:output', b['text'])
            }
          }
        }
      } catch {}
    }
  })

  child.on('close', code => {
    turnRunning = false
    if (code === 0) {
      emitEvent('bot:done', '')
      emitEvent('state:change', 'turn-done' as EventType)
    } else {
      emitEvent('error', `Turn agent exited with code ${code}`)
    }
  })

  sendJson(res, 202, { state: 'turn-running', events_url: '/flowdeck/events' })
}

function checkHumanItems(content: string): string {
  let inHuman = false
  return content.split('\n').map(line => {
    if (/^## HUMAN/.test(line)) { inHuman = true; return line }
    if (/^## /.test(line) && inHuman) { inHuman = false; return line }
    if (inHuman && /^- \[ \]/.test(line)) return line.replace('- [ ]', '- [x]')
    return line
  }).join('\n')
}

async function handleHumanDone(res: ServerResponse, root: string, id: string): Promise<void> {
  const slug = idToSlug(id)
  const cardPath = slugToCardPath(root, slug)
  if (!existsSync(cardPath)) {
    sendJson(res, 404, { error: 'card not found', id })
    return
  }

  const content = readFileSync(cardPath, 'utf8')
  const parsed = parseCard(cardPath, content)
  const currentState = detectState(parsed, id)

  if (currentState === 'idle' || currentState === 'bot-running' || currentState === 'archived') {
    sendJson(res, 409, { error: 'card BOT section is not complete', current_state: currentState })
    return
  }

  const newContent = checkHumanItems(content)
  if (newContent !== content) {
    writeFileSync(cardPath, newContent)
    try {
      execSync('git add -A', { cwd: root, stdio: 'pipe' })
      execSync(`git commit -m "flowdeck: human-done ${id}"`, { cwd: root, stdio: 'pipe' })
    } catch (e) {
      sendJson(res, 500, { error: 'git commit failed', details: String(e) })
      return
    }
  }

  emitEvent('state:change', 'human-done', id)
  sendJson(res, 200, buildCardInfo(id, cardPath, false))
}

function handleDeck(res: ServerResponse, root: string): void {
  try {
    const mainTodoPath = join(root, '.flowdeck', 'TODO.md')
    const raw = existsSync(mainTodoPath) ? readFileSync(mainTodoPath, 'utf8') : ''
    const agentContextPath = join(root, '.flowdeck', 'AGENT.md')
    const agent_context = existsSync(agentContextPath) ? readFileSync(agentContextPath, 'utf8') : ''
    sendJson(res, 200, { raw, cards: collectAllCards(root), agent_context })
  } catch (e) {
    sendJson(res, 500, { error: 'deck parse error', details: String(e) })
  }
}

async function handleSync(res: ServerResponse, root: string): Promise<void> {
  const before = new Map(collectAllCards(root).map(c => [c.id, c.state]))

  try {
    execSync('git pull --rebase', { cwd: root, stdio: 'pipe' })
  } catch (e) {
    sendJson(res, 500, { error: 'git sync failed', details: String(e) })
    return
  }

  let git_branch = 'unknown'
  let git_sha = 'unknown'
  try {
    git_branch = execSync('git rev-parse --abbrev-ref HEAD', { cwd: root, stdio: 'pipe' }).toString().trim()
    git_sha = execSync('git rev-parse HEAD', { cwd: root, stdio: 'pipe' }).toString().trim()
  } catch {}

  const after = collectAllCards(root)
  const cards_changed = after.filter(c => before.get(c.id) !== c.state).map(c => c.id)

  sendJson(res, 200, { pulled: true, cards_changed, git_branch, git_sha })
}

function handleEvents(req: IncomingMessage, res: ServerResponse): void {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  })

  const lastIdHeader = req.headers['last-event-id']
  const lastId = lastIdHeader ? parseInt(String(lastIdHeader), 10) : 0
  for (const evt of ringBuffer) {
    if (evt.id > lastId) res.write(formatSSEEvent(evt))
  }

  sseClients.add(res)
  const keepalive = setInterval(() => {
    if (res.destroyed) { clearInterval(keepalive); sseClients.delete(res) }
    else res.write(':\n\n')
  }, 15000)

  req.on('close', () => { clearInterval(keepalive); sseClients.delete(res) })
}

// ── Main server entry point ───────────────────────────────────────────────────

export async function serveCommand(args: string[]): Promise<void> {
  const portIdx = args.indexOf('--port')
  const port = parseInt(portIdx !== -1 ? (args[portIdx + 1] ?? '7331') : (process.env['FLOWDECK_PORT'] ?? '7331'), 10)
  const noAuth = args.includes('--no-auth')
  const agentIdx = args.indexOf('--agent')
  const agent = agentIdx !== -1 ? (args[agentIdx + 1] ?? 'claude-code') : (process.env['FLOWDECK_AGENT'] ?? 'claude-code')

  const root = findProjectRoot(process.cwd())
  if (!root) {
    console.error('Error: no .flowdeck/ found in this directory or any parent')
    process.exit(1)
  }

  const apiToken: string | null = noAuth ? null : (process.env['FLOWDECK_API_TOKEN'] ?? null)
  if (!apiToken) {
    process.stderr.write('warn: No FLOWDECK_API_TOKEN set — API is unauthenticated. Set the env var for multi-tool environments.\n')
  }

  const pkgPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'package.json')
  const version = (JSON.parse(readFileSync(pkgPath, 'utf8')) as { version: string }).version

  serverStartTime = Date.now()

  const server = createServer(async (req, res) => {
    const path = new URL(req.url ?? '/', `http://127.0.0.1:${port}`).pathname

    if (!checkAuth(req, res, apiToken, path)) return

    try {
      if (req.method === 'GET' && path === '/flowdeck/health') {
        handleHealth(res, version)
      } else if (req.method === 'GET' && path === '/flowdeck/status') {
        handleStatus(res, root, version, agent)
      } else if (req.method === 'GET' && path === '/flowdeck/cards') {
        handleCards(res, root)
      } else if (req.method === 'GET' && path === '/flowdeck/deck') {
        handleDeck(res, root)
      } else if (req.method === 'GET' && path === '/flowdeck/events') {
        handleEvents(req, res)
      } else if (req.method === 'GET' && path.startsWith('/flowdeck/cards/')) {
        handleCard(res, root, path.slice('/flowdeck/cards/'.length))
      } else if (req.method === 'POST' && path === '/flowdeck/run') {
        await handleRun(req, res, root, agent)
      } else if (req.method === 'POST' && path.startsWith('/flowdeck/run/') && path.endsWith('/cancel')) {
        const id = path.slice('/flowdeck/run/'.length, -'/cancel'.length)
        if (!id) sendJson(res, 404, { error: 'not found' })
        else handleCancel(res, root, id)
      } else if (req.method === 'POST' && path === '/flowdeck/turn') {
        await handleTurn(req, res, root)
      } else if (req.method === 'POST' && path.startsWith('/flowdeck/cards/') && path.endsWith('/human-done')) {
        const id = path.slice('/flowdeck/cards/'.length, -'/human-done'.length)
        if (!id) sendJson(res, 404, { error: 'not found' })
        else await handleHumanDone(res, root, id)
      } else if (req.method === 'POST' && path === '/flowdeck/deck/sync') {
        await handleSync(res, root)
      } else {
        sendJson(res, 404, { error: 'not found' })
      }
    } catch (e) {
      sendJson(res, 500, { error: 'internal server error', details: String(e) })
    }
  })

  process.on('SIGINT', () => { activeRun?.process.kill('SIGTERM'); process.exit(0) })
  process.on('SIGTERM', () => { activeRun?.process.kill('SIGTERM'); process.exit(0) })

  server.listen(port, '127.0.0.1', () => {
    console.log(`flowdeck serve — http://127.0.0.1:${port}`)
    if (!apiToken) console.log('  unauthenticated (set FLOWDECK_API_TOKEN to enable auth)')
    console.log(`  root: ${root}`)
    console.log(`  agent: ${agent}`)
  })
}
