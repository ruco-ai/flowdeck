import { readFileSync, writeFileSync } from 'node:fs'
import { basename } from 'node:path'

// -- Types --------------------------------------------------------------------

export interface CardFrontmatter {
  github_issue?: string
  github_labels?: string[]
  github_synced_at?: string
}

export interface ParsedCard {
  title: string
  overview: string
  frontmatter: CardFrontmatter
  botSection: string
  doneCriteria: Array<{ text: string; checked: boolean }>
  allBotItemsDone: boolean
}

export interface SyncOptions {
  cardPath: string
  phase?: 'created' | 'bot-done' | 'human-done'
  dryRun?: boolean
  token?: string
  noCreate?: boolean
  verbose?: boolean
}

export interface SyncResult {
  action: 'created' | 'commented' | 'labeled' | 'closed' | 'skipped'
  issueUrl?: string
  issueNumber?: number
}

// -- Frontmatter --------------------------------------------------------------

export function parseFrontmatter(content: string): { frontmatter: CardFrontmatter; rest: string } {
  const m = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/)
  if (!m) return { frontmatter: {}, rest: content }

  const fm: CardFrontmatter = {}
  for (const line of m[1].split('\n')) {
    const kv = line.match(/^([\w_]+):\s*(.*)$/)
    if (!kv) continue
    const [, k, v] = kv
    if (k === 'github_issue') fm.github_issue = v.trim()
    if (k === 'github_synced_at') fm.github_synced_at = v.trim()
    if (k === 'github_labels') {
      fm.github_labels = v.trim().replace(/^\[|\]$/g, '').split(',').map(s => s.trim()).filter(Boolean)
    }
  }
  return { frontmatter: fm, rest: m[2] }
}

// Targeted single-key update — never rewrites unrelated frontmatter fields.
export function writeFrontmatter(cardPath: string, key: string, value: string): void {
  const raw = readFileSync(cardPath, 'utf8')
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/)

  if (m) {
    const lines = m[1].split('\n')
    const idx = lines.findIndex(l => l.match(new RegExp(`^${key}:`)))
    if (idx !== -1) {
      lines[idx] = `${key}: ${value}`
    } else {
      lines.push(`${key}: ${value}`)
    }
    writeFileSync(cardPath, `---\n${lines.join('\n')}\n---\n${m[2]}`)
  } else {
    writeFileSync(cardPath, `---\n${key}: ${value}\n---\n${raw}`)
  }
}

// -- Card parsing -------------------------------------------------------------

function extractSection(body: string, heading: RegExp): string {
  const lines = body.split('\n')
  let inSection = false
  const out: string[] = []
  for (const line of lines) {
    if (heading.test(line)) { inSection = true; continue }
    if (inSection && /^## /.test(line)) break
    if (inSection) out.push(line)
  }
  return out.join('\n').trim()
}

export function parseCard(cardPath: string, content: string): ParsedCard {
  const { frontmatter, rest } = parseFrontmatter(content)
  const lines = rest.split('\n')

  const title = lines.find(l => /^# /.test(l))?.replace(/^# /, '').trim() ?? basename(cardPath)

  // First paragraph after the H1 heading, before the first ##
  const overviewLines: string[] = []
  let pastTitle = false
  for (const line of lines) {
    if (/^# /.test(line)) { pastTitle = true; continue }
    if (pastTitle && /^## /.test(line)) break
    if (pastTitle) overviewLines.push(line)
  }
  const overview = overviewLines.join('\n').trim()

  const botSection = extractSection(rest, /^## BOT/)
  const humanSection = extractSection(rest, /^## HUMAN/)

  const botItems = botSection.split('\n').filter(l => /^- \[[ x]\]/.test(l))
  const allBotItemsDone = botItems.length > 0 && botItems.every(l => /^- \[x\]/.test(l))

  const doneCriteria = humanSection
    .split('\n')
    .filter(l => /^- \[[ x]\]/.test(l))
    .map(l => ({ text: l.replace(/^- \[[ x]\] /, '').trim(), checked: /^- \[x\]/.test(l) }))

  return { title, overview, frontmatter, botSection, doneCriteria, allBotItemsDone }
}

// -- GitHub API ---------------------------------------------------------------

type JsonBody = Record<string, unknown> | Array<unknown>

interface GitHubIssue { number: number; html_url: string }

async function ghFetch(
  token: string,
  method: string,
  path: string,
  body?: JsonBody,
  verbose?: boolean,
): Promise<Response> {
  const url = `https://api.github.com${path}`
  if (verbose) process.stderr.write(`[gh] ${method} ${url}\n`)

  const opts: RequestInit = {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  }

  let delay = 1000
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(url, opts)
    const isRateLimit =
      res.status === 429 ||
      (res.status === 403 && res.headers.get('x-ratelimit-remaining') === '0')
    if (isRateLimit) {
      const reset = res.headers.get('x-ratelimit-reset')
      const wait = reset ? Math.max(1000, Number(reset) * 1000 - Date.now()) : delay
      process.stderr.write(`GitHub API rate limit hit. Retry in ${Math.ceil(wait / 1000)}s\n`)
      await new Promise(r => setTimeout(r, wait))
      delay *= 2
      continue
    }
    return res
  }
  throw new Error('GitHub API rate limit — exceeded 3 retries')
}

function getToken(opts: SyncOptions): string {
  const token = opts.token ?? process.env['GITHUB_TOKEN']
  if (!token) {
    process.stderr.write(
      'GITHUB_TOKEN not found. Set env var or use: op read "op://Personal/GitHub/flowdeck-token"\n',
    )
    process.exit(1)
  }
  return token
}

function parseIssueRef(ref: string): { owner: string; repo: string; number?: number } {
  const withNum = ref.match(/^([^/]+)\/([^#]+)#(\d+)$/)
  if (withNum) return { owner: withNum[1]!, repo: withNum[2]!, number: parseInt(withNum[3]!, 10) }
  const noNum = ref.match(/^([^/]+)\/([^#\s]+)$/)
  if (noNum) return { owner: noNum[1]!, repo: noNum[2]! }
  throw new Error(`Invalid github_issue format: "${ref}". Expected "owner/repo#123" or "owner/repo"`)
}

// -- Public actions -----------------------------------------------------------

export async function createIssue(
  owner: string,
  repo: string,
  card: ParsedCard,
  token: string,
  dryRun?: boolean,
  verbose?: boolean,
): Promise<number> {
  const labels = ['flowdeck:draft', ...(card.frontmatter.github_labels ?? [])]
  const body = [
    card.overview || '_(no overview)_',
    '',
    '---',
    '*Linked from a [flowdeck](https://github.com/ruco-ai/flowdeck) card.*',
  ].join('\n')

  if (dryRun) {
    console.log(`[dry-run] Would create issue: ${owner}/${repo} — "${card.title}"`)
    console.log(`[dry-run] Labels: ${labels.join(', ')}`)
    return 0
  }

  const res = await ghFetch(token, 'POST', `/repos/${owner}/${repo}/issues`, { title: card.title, body, labels }, verbose)

  if (res.status === 403) {
    process.stderr.write('GitHub token missing issues:write scope. Regenerate at github.com/settings/tokens\n')
    process.exit(1)
  }
  if (res.status === 404) {
    process.stderr.write(`Repo "${owner}/${repo}" not found or token has no access\n`)
    process.exit(1)
  }
  if (!res.ok) {
    process.stderr.write(`GitHub API error ${res.status}: ${await res.text()}\n`)
    process.exit(1)
  }

  const issue = await res.json() as GitHubIssue
  return issue.number
}

export async function postBotComment(
  owner: string,
  repo: string,
  issueNumber: number,
  card: ParsedCard,
  cardPath: string,
  token: string,
  dryRun?: boolean,
  verbose?: boolean,
): Promise<void> {
  if (!card.botSection.trim()) {
    process.stderr.write('No completion report found in BOT section — comment skipped\n')
    return
  }

  const allChecked = card.doneCriteria.length > 0 && card.doneCriteria.every(c => c.checked)
  const status = card.allBotItemsDone ? (allChecked ? 'done' : 'partial') : 'partial'

  const doneCriteriaBlock = card.doneCriteria.length > 0
    ? card.doneCriteria.map(c => `- [${c.checked ? 'x' : ' '}] ${c.text}`).join('\n')
    : '_(no done criteria found in HUMAN section)_'

  const body = [
    '### flowdeck bot phase complete',
    '',
    `**Card:** \`${basename(cardPath)}\``,
    `**Phase:** BOT`,
    `**Status:** ${status}`,
    '',
    '#### Completion report',
    '',
    card.botSection,
    '',
    '#### Done criteria',
    '',
    doneCriteriaBlock,
    '',
    '---',
    '*Posted by flowdeck gh-sync*',
  ].join('\n')

  if (dryRun) {
    console.log(`[dry-run] Would post comment on ${owner}/${repo}#${issueNumber}`)
    return
  }

  const res = await ghFetch(token, 'POST', `/repos/${owner}/${repo}/issues/${issueNumber}/comments`, { body }, verbose)
  if (!res.ok) {
    process.stderr.write(`Failed to post comment: ${res.status} ${await res.text()}\n`)
    process.exit(1)
  }
}

async function ensureLabel(owner: string, repo: string, label: string, token: string, verbose?: boolean): Promise<void> {
  const colors: Record<string, string> = {
    'flowdeck:draft': 'CCCCCC',
    'flowdeck:bot': '0075CA',
    'flowdeck:review': 'E4E669',
    'flowdeck:done': '0E8A16',
  }
  const res = await ghFetch(token, 'POST', `/repos/${owner}/${repo}/labels`,
    { name: label, color: colors[label] ?? 'EDEDED' }, verbose)
  if (!res.ok && res.status !== 422 && verbose) {
    process.stderr.write(`warn: could not create label "${label}": ${res.status}\n`)
  }
}

export async function transitionIssue(
  owner: string,
  repo: string,
  issueNumber: number,
  phase: 'created' | 'bot-done' | 'human-done',
  token: string,
  dryRun?: boolean,
  verbose?: boolean,
): Promise<void> {
  const addLabel: Record<string, string> = {
    created: 'flowdeck:draft',
    'bot-done': 'flowdeck:review',
    'human-done': 'flowdeck:done',
  }
  const removeLabels: Record<string, string[]> = {
    created: [],
    'bot-done': ['flowdeck:bot', 'flowdeck:draft'],
    'human-done': ['flowdeck:bot', 'flowdeck:draft', 'flowdeck:review'],
  }

  const add = addLabel[phase]!
  const toRemove = removeLabels[phase] ?? []

  if (dryRun) {
    console.log(`[dry-run] Would add label "${add}", remove [${toRemove.join(', ')}] on ${owner}/${repo}#${issueNumber}`)
    return
  }

  await ensureLabel(owner, repo, add, token, verbose)
  await ghFetch(token, 'POST', `/repos/${owner}/${repo}/issues/${issueNumber}/labels`, { labels: [add] }, verbose)

  for (const label of toRemove) {
    const res = await ghFetch(token, 'DELETE',
      `/repos/${owner}/${repo}/issues/${issueNumber}/labels/${encodeURIComponent(label)}`, undefined, verbose)
    if (!res.ok && res.status !== 404 && verbose) {
      process.stderr.write(`warn: could not remove label "${label}": ${res.status}\n`)
    }
  }
}

export async function closeIssue(
  owner: string,
  repo: string,
  issueNumber: number,
  token: string,
  dryRun?: boolean,
  verbose?: boolean,
): Promise<void> {
  if (dryRun) {
    console.log(`[dry-run] Would close ${owner}/${repo}#${issueNumber}`)
    return
  }
  const res = await ghFetch(token, 'PATCH', `/repos/${owner}/${repo}/issues/${issueNumber}`, { state: 'closed' }, verbose)
  if (!res.ok) {
    process.stderr.write(`Failed to close issue: ${res.status} ${await res.text()}\n`)
    process.exit(1)
  }
}

// -- Main entry point ---------------------------------------------------------

export async function syncCard(opts: SyncOptions): Promise<SyncResult> {
  const content = readFileSync(opts.cardPath, 'utf8')
  const card = parseCard(opts.cardPath, content)

  if (!card.frontmatter.github_issue) return { action: 'skipped' }

  const token = getToken(opts)

  let ref: { owner: string; repo: string; number?: number }
  try {
    ref = parseIssueRef(card.frontmatter.github_issue)
  } catch (e) {
    process.stderr.write((e as Error).message + '\n')
    process.exit(1)
  }

  // Auto-create if no issue number
  if (!ref.number) {
    if (opts.noCreate) {
      process.stderr.write('No github_issue in frontmatter and --no-create is set\n')
      process.exit(1)
    }
    const issueNumber = await createIssue(ref.owner, ref.repo, card, token, opts.dryRun, opts.verbose)
    if (!opts.dryRun) {
      try {
        writeFrontmatter(opts.cardPath, 'github_issue', `${ref.owner}/${ref.repo}#${issueNumber}`)
        writeFrontmatter(opts.cardPath, 'github_synced_at', new Date().toISOString())
      } catch {
        process.stderr.write(
          `Could not write issue number back to card. Add manually: github_issue: ${ref.owner}/${ref.repo}#${issueNumber}\n`,
        )
        process.exit(1)
      }
    }
    const issueUrl = `https://github.com/${ref.owner}/${ref.repo}/issues/${issueNumber}`
    console.log(issueUrl)
    return { action: 'created', issueUrl, issueNumber }
  }

  const issueUrl = `https://github.com/${ref.owner}/${ref.repo}/issues/${ref.number}`

  // Determine sync phase
  let phase = opts.phase
  if (!phase) {
    const allDoneCriteria = card.doneCriteria.length > 0 && card.doneCriteria.every(c => c.checked)
    phase = allDoneCriteria ? 'human-done' : 'bot-done'
  }

  if (phase === 'bot-done') {
    await postBotComment(ref.owner, ref.repo, ref.number, card, opts.cardPath, token, opts.dryRun, opts.verbose)
    await transitionIssue(ref.owner, ref.repo, ref.number, 'bot-done', token, opts.dryRun, opts.verbose)
    if (!opts.dryRun) writeFrontmatter(opts.cardPath, 'github_synced_at', new Date().toISOString())
    console.log(issueUrl)
    return { action: 'commented', issueUrl, issueNumber: ref.number }
  }

  if (phase === 'human-done') {
    await transitionIssue(ref.owner, ref.repo, ref.number, 'human-done', token, opts.dryRun, opts.verbose)
    await closeIssue(ref.owner, ref.repo, ref.number, token, opts.dryRun, opts.verbose)
    if (!opts.dryRun) writeFrontmatter(opts.cardPath, 'github_synced_at', new Date().toISOString())
    console.log(issueUrl)
    return { action: 'closed', issueUrl, issueNumber: ref.number }
  }

  return { action: 'skipped' }
}
