#!/usr/bin/env node
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execSync, spawn } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'

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

  const cwd = process.env.FLOWDECK_ROOT ?? process.cwd()

  if (message) {
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
  }

  const agentPath = join(cwd, '.flowdeck', 'AGENT.md')
  const agentMd = existsSync(agentPath) ? readFileSync(agentPath, 'utf8').trim() : ''

  let diff = ''
  try { diff = execSync('git show HEAD --stat', { cwd, encoding: 'utf8', stdio: 'pipe' }).trim() } catch {}

  const commitLine = message ? `The human just committed: "${message}"\n\n` : ''
  const prompt = agentMd
    ? `${agentMd}\n\n---\n\n${commitLine}Changed files:\n${diff || '(none)'}`
    : `${commitLine}Changed files:\n${diff || '(none)'}\n\nProcess any unchecked BOT tasks in .flowdeck/ TODO.md files, mark done, commit.`

  const frames = ['⠋','⠙','⠹','⠸','⠼','⠴','⠦','⠧','⠇','⠏']
  let frame = 0
  let label = 'thinking…'
  const spin = setInterval(() => {
    process.stdout.write(`\r${frames[frame++ % frames.length]} ${label}   `)
  }, 80)
  const clear = () => { clearInterval(spin); process.stdout.write('\r' + ' '.repeat(label.length + 4) + '\r') }

  const child = spawn('claude', [
    '-p', prompt,
    '--dangerously-skip-permissions',
    '--output-format', 'stream-json',
    '--verbose',
  ], { cwd, stdio: ['ignore', 'pipe', 'pipe'] })

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

  const code = await new Promise<number>(res => child.on('close', c => res(c ?? 0)))
  clear()
  if (code !== 0) process.exit(code)
}

// -- mdblu template resolution ------------------------------------------------
const MDBLU_GH_RAW = 'https://raw.githubusercontent.com/ruco-ai/mdblu/master/templates'

// Curated subset — run `mdblu get --all` or add files manually for more
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

  // 1. local .mdblu/templates/
  const localDir = join(cwd, '.mdblu', 'templates')
  if (existsSync(localDir)) {
    const files = readdirSync(localDir).filter(f => FLOWDECK_TEMPLATES.includes(f))
    for (const f of files) writeFileSync(join(destDir, f), readFileSync(join(localDir, f)))
    return `local .mdblu/ (${files.length} templates)`
  }

  // 2. GitHub
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
  init                   Create .flowdeck/ scaffold with templates
  send [-m "<message>"]  Stage + commit (if -m given), then hand off to Claude

Examples:
  flowdeck init
  flowdeck send -m "add stripe webhook"
  flowdeck send
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

  process.stdout.write('  fetching mdblu templates…')
  const templateSource = await scaffoldTemplates(join(fd, 'templates'), cwd)
  process.stdout.write(`\r✓ templates — ${templateSource}\n`)

  console.log(`✓ .flowdeck/ initialized
  AGENT.md           — instructions for Claude
  TODO.md.template   — onboarding reference (not scanned by agents)
  start/TODO.md      — first work area
  templates/         — mdblu templates (source: ${templateSource})
  .flowdeckignore
`)
} else if (subcmd === 'send') {
  await sendCommand(rest)
} else {
  console.error(`Unknown command: ${subcmd}`)
  process.exit(1)
}

