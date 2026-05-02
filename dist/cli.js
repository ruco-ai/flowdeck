#!/usr/bin/env node
import { join } from 'node:path';
import { execSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs';
const [, , subcmd, ...rest] = process.argv;
// -- send command: stage, commit, ask claude to work --------------------------
async function sendCommand(args) {
    let message = '';
    let i = 0;
    // Parse: send -m "message" or send --message "message"
    while (i < args.length) {
        if ((args[i] === '-m' || args[i] === '--message') && i + 1 < args.length) {
            message = args[i + 1];
            i += 2;
            break;
        }
        i++;
    }
    const cwd = process.env.FLOWDECK_ROOT ?? process.cwd();
    if (message) {
        try {
            execSync('git add -A', { cwd, stdio: 'pipe' });
            execSync(`git commit -m "${message.replace(/"/g, '\\"')}"`, { cwd, stdio: 'pipe' });
            console.log(`✓ Committed: "${message}"`);
        }
        catch (e) {
            const error = e instanceof Error ? e.message : String(e);
            if (!error.includes('nothing to commit')) {
                console.error(`Error: ${error}`);
                process.exit(1);
            }
        }
    }
    const agentPath = join(cwd, '.flowdeck', 'AGENT.md');
    const agentMd = existsSync(agentPath) ? readFileSync(agentPath, 'utf8').trim() : '';
    let diff = '';
    try {
        diff = execSync('git show HEAD --stat', { cwd, encoding: 'utf8', stdio: 'pipe' }).trim();
    }
    catch { }
    const commitLine = message ? `The human just committed: "${message}"\n\n` : '';
    const prompt = agentMd
        ? `${agentMd}\n\n---\n\n${commitLine}Changed files:\n${diff || '(none)'}`
        : `${commitLine}Changed files:\n${diff || '(none)'}\n\nProcess any unchecked BOT tasks in .flowdeck/ TODO.md files, mark done, commit.`;
    const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
    let frame = 0;
    let label = 'thinking…';
    const spin = setInterval(() => {
        process.stdout.write(`\r${frames[frame++ % frames.length]} ${label}   `);
    }, 80);
    const clear = () => { clearInterval(spin); process.stdout.write('\r' + ' '.repeat(label.length + 4) + '\r'); };
    const child = spawn('claude', [
        '-p', prompt,
        '--dangerously-skip-permissions',
        '--output-format', 'stream-json',
        '--verbose',
    ], { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let buf = '';
    child.stdout.on('data', (chunk) => {
        buf += chunk.toString();
        const lines = buf.split('\n');
        buf = lines.pop() ?? '';
        for (const line of lines) {
            if (!line.trim())
                continue;
            try {
                const evt = JSON.parse(line);
                if (evt.type === 'assistant') {
                    for (const b of (evt.message?.content ?? [])) {
                        if (b.type === 'tool_use') {
                            const name = String(b.name).replace(/^mcp__[^_]+__/, '');
                            label = `${name}(${JSON.stringify(b.input).slice(0, 50)})`;
                        }
                        else if (b.type === 'text' && b.text?.trim()) {
                            clear();
                            console.log(b.text);
                        }
                    }
                }
                else if (evt.type === 'result' && evt.result?.trim()) {
                    clear();
                    console.log(evt.result);
                }
            }
            catch { }
        }
    });
    child.stderr.on('data', (chunk) => {
        clear();
        process.stderr.write(chunk);
    });
    const code = await new Promise(res => child.on('close', c => res(c ?? 0)));
    clear();
    if (code !== 0)
        process.exit(code);
}
// -- mdblu template resolution ------------------------------------------------
const MDBLU_GH_RAW = 'https://raw.githubusercontent.com/ruco-ai/mdblu/master/templates';
// Curated subset — run `mdblu get --all` or add files manually for more
const FLOWDECK_TEMPLATES = [
    'SPEC.md.template',
    'MISSION.md.template',
    'OPEN-QUESTIONS.md.template',
    'ADR.md.template',
    'GENERALINSIGHTS.md.template',
    'PROJECTINSIGHTS.md.template',
    'CLAUDE.md.template',
];
async function scaffoldTemplates(destDir, cwd) {
    mkdirSync(destDir, { recursive: true });
    // 1. local .mdblu/templates/
    const localDir = join(cwd, '.mdblu', 'templates');
    if (existsSync(localDir)) {
        const files = readdirSync(localDir).filter(f => FLOWDECK_TEMPLATES.includes(f));
        for (const f of files)
            writeFileSync(join(destDir, f), readFileSync(join(localDir, f)));
        return `local .mdblu/ (${files.length} templates)`;
    }
    // 2. GitHub
    const results = await Promise.all(FLOWDECK_TEMPLATES.map(async (name) => {
        try {
            const r = await fetch(`${MDBLU_GH_RAW}/${name}`, { signal: AbortSignal.timeout(5000) });
            if (!r.ok)
                return false;
            writeFileSync(join(destDir, name), await r.text());
            return true;
        }
        catch {
            return false;
        }
    }));
    const n = results.filter(Boolean).length;
    return `GitHub (${n}/${FLOWDECK_TEMPLATES.length} templates)`;
}
// -- main =====================================================================
if (!subcmd || subcmd === '--help' || subcmd === '-h') {
    console.log(`Usage: flowdeck <command> [options]

Commands:
  init                   Create .flowdeck/ scaffold with templates
  send [-m "<message>"]  Stage + commit (if -m given), then hand off to Claude

Examples:
  flowdeck init
  flowdeck send -m "add stripe webhook"
  flowdeck send
`);
    process.exit(0);
}
if (subcmd === 'init') {
    const cwd = process.env.FLOWDECK_ROOT ?? process.cwd();
    const fd = join(cwd, '.flowdeck');
    if (existsSync(fd)) {
        console.error('Error: .flowdeck/ already exists');
        process.exit(1);
    }
    mkdirSync(join(fd, 'start'), { recursive: true });
    writeFileSync(join(fd, 'AGENT.md'), `\
# Agent Instructions

You are working in a flowdeck project. Human↔AI collaboration happens through \`TODO.md\` files.
Each folder under \`.flowdeck/\` is a work area. Each has its own \`TODO.md\`.

## What to do on every \`flowdeck send\`

1. Read the diff in this prompt to understand what the human just changed
2. Scan all \`TODO.md\` files under \`.flowdeck/\` for unchecked \`- [ ]\` items in \`## BOT\` sections
3. Complete each task — read files, edit code, whatever the task requires
4. Mark each done task \`- [x]\` and add a short note on the line below (indented with \`>\`)
5. If you need the human to do something, add \`- [ ]\` items to \`## HUMAN\`
6. Commit all changes with a short, factual message

## TODO.md format

\`\`\`markdown
# <topic>

## BOT
- [x] Completed task
  > short note on what was done
- [ ] Pending task
  > optional context or clarification

## HUMAN
- [ ] Something that needs human action
  > why it's needed
\`\`\`

## Folder structure

- \`.flowdeck/<topic>/\` — a work area or subject
- \`.flowdeck/<topic>/<subtask>/\` — a subtask within a topic
- New topic → \`flowdeck open "<name>"\`
- New subtask → create the subfolder manually or ask the human to

## Rules

- Complete tasks before committing — never commit a half-done task as done
- Keep notes brief and factual, not conversational
- Never modify \`## HUMAN\` items already written by the human
- When in doubt, ask in \`## HUMAN\` rather than assuming
`);
    writeFileSync(join(fd, 'TODO.md'), `\
# flowdeck

> Human↔AI collaboration via \`TODO.md\` files.
> \`## BOT\` is Claude's inbox — tasks Claude should complete.
> \`## HUMAN\` is your inbox — things Claude needs from you.
> Run \`flowdeck send -m "<what you did>"\` to commit and hand off to Claude, or \`flowdeck send\` to hand off without a new commit.

## BOT
- [ ] Read \`AGENT.md\` and confirm you're ready
  > Leave a short note here, then check \`start/TODO.md\`

## HUMAN
- [ ] Run \`flowdeck send -m "init"\` to start
  > Claude will read this file, check \`start/TODO.md\`, and get to work
`);
    writeFileSync(join(fd, 'start', 'TODO.md'), `\
# start

> Your first work area. Add tasks for Claude under \`## BOT\`, tasks for yourself under \`## HUMAN\`.
> Notes on a task go on the line below, indented with \`>\`.
> For a new subject, create a new folder under \`.flowdeck/\`. For a subtask, create a subfolder here.

## BOT

## HUMAN
`);
    writeFileSync(join(fd, '.flowdeckignore'), `\
node_modules/
dist/
.git/
*.log
.env
`);
    process.stdout.write('  fetching mdblu templates…');
    const templateSource = await scaffoldTemplates(join(fd, 'templates'), cwd);
    process.stdout.write(`\r✓ templates — ${templateSource}\n`);
    console.log(`✓ .flowdeck/ initialized
  AGENT.md           — instructions for Claude
  TODO.md            — onboarding and project-level tasks
  start/TODO.md      — first work area
  templates/         — mdblu templates (source: ${templateSource})
  .flowdeckignore
`);
}
else if (subcmd === 'send') {
    await sendCommand(rest);
}
else {
    console.error(`Unknown command: ${subcmd}`);
    process.exit(1);
}
