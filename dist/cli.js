#!/usr/bin/env node
import { basename, dirname, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
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
    const invocationDir = process.cwd();
    // Derive project root (cwd) and which card to focus on, in priority order:
    // 1. invocationDir is inside .flowdeck/<col>/ → focusCard from path
    // 2. FLOWDECK_ROOT is set → use it, still check for .flowdeck in invocationDir
    // 3. Walk up from invocationDir to find .flowdeck/, match basename to a column
    // 4. No match → full deck scan
    let cwd;
    let focusCard = null;
    const partsForFd = invocationDir.split(sep);
    const fdIdx = partsForFd.lastIndexOf('.flowdeck');
    if (fdIdx !== -1) {
        cwd = process.env.FLOWDECK_ROOT ?? (partsForFd.slice(0, fdIdx).join(sep) || sep);
        focusCard = partsForFd.slice(fdIdx).concat('TODO.md').join(sep);
    }
    else if (process.env.FLOWDECK_ROOT) {
        cwd = process.env.FLOWDECK_ROOT;
    }
    else {
        cwd = invocationDir;
    }
    // Basename heuristic: walk up to find .flowdeck/, check if <basename(cwd)>/TODO.md exists
    if (!focusCard) {
        let searchDir = invocationDir;
        while (true) {
            if (existsSync(join(searchDir, '.flowdeck'))) {
                cwd = searchDir;
                const colName = basename(invocationDir);
                const cardPath = join(searchDir, '.flowdeck', colName, 'TODO.md');
                if (existsSync(cardPath))
                    focusCard = join('.flowdeck', colName, 'TODO.md');
                break;
            }
            const parent = dirname(searchDir);
            if (parent === searchDir)
                break;
            searchDir = parent;
        }
    }
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
    let claudeArgs;
    if (focusCard) {
        const cardPath = join(cwd, focusCard);
        const cardContent = existsSync(cardPath) ? readFileSync(cardPath, 'utf8').trim() : '';
        const userPrompt = `${commitLine}Do the following steps in order:
1. The human played the card at \`${cardPath}\`. Its current content is below — use it as the source of truth, do not re-read it from disk.
2. Find every unchecked \`- [ ]\` item under \`## BOT\` and complete it (read files, edit code, run commands as needed).
3. Edit \`${cardPath}\` to mark each completed item \`- [x]\` with a one-line note indented with \`>\`.
4. Run \`git add -A && git commit -m "<short description>"\` to commit.
Do not glob, search, or read any other TODO.md files.

--- card content ---
${cardContent}`;
        claudeArgs = [
            '-p', userPrompt,
            '--dangerously-skip-permissions',
            '--output-format', 'stream-json',
            '--verbose',
        ];
    }
    else {
        const prompt = agentMd
            ? `${agentMd}\n\n---\n\n${commitLine}Changed files:\n${diff || '(none)'}`
            : `${commitLine}Changed files:\n${diff || '(none)'}\n\nYou are a flowdeck agent. The deck is \`.flowdeck/\` — columns are folders, cards are \`TODO.md\` files. Pick the highest-priority card with unchecked \`- [ ]\` items under \`## BOT\`, complete those tasks, mark them done, and commit. Work one card at a time.`;
        claudeArgs = [
            '-p', prompt,
            '--dangerously-skip-permissions',
            '--output-format', 'stream-json',
            '--verbose',
        ];
    }
    const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
    let frame = 0;
    let label = 'thinking…';
    const spin = setInterval(() => {
        process.stdout.write(`\r${frames[frame++ % frames.length]} ${label}   `);
    }, 80);
    const clear = () => { clearInterval(spin); process.stdout.write('\r' + ' '.repeat(label.length + 4) + '\r'); };
    const child = spawn('claude', claudeArgs, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
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
// -- add command: create a new column + card ----------------------------------
function addCommand(args) {
    const column = args[0];
    if (!column) {
        console.error('Usage: flowdeck add <column> [title]');
        process.exit(1);
    }
    const cwd = process.env.FLOWDECK_ROOT ?? process.cwd();
    const columnDir = join(cwd, '.flowdeck', column);
    const cardPath = join(columnDir, 'TODO.md');
    if (existsSync(cardPath)) {
        console.error(`Error: card already exists at .flowdeck/${column}/TODO.md`);
        process.exit(1);
    }
    mkdirSync(columnDir, { recursive: true });
    const title = args.slice(1).join(' ') || column;
    writeFileSync(cardPath, `# ${title}\n\n## BOT\n\n- [ ] \n\n## HUMAN\n\n#### COMMENTS\n\n`);
    console.log(`✓ Created .flowdeck/${column}/TODO.md`);
}
// -- upgrade command: append a task to an existing card -----------------------
function upgradeCommand(args) {
    const column = args[0];
    const task = args.slice(1).join(' ');
    if (!column || !task) {
        console.error('Usage: flowdeck upgrade <column> <task>');
        process.exit(1);
    }
    const cwd = process.env.FLOWDECK_ROOT ?? process.cwd();
    const cardPath = join(cwd, '.flowdeck', column, 'TODO.md');
    if (!existsSync(cardPath)) {
        console.error(`Error: no card at .flowdeck/${column}/TODO.md`);
        process.exit(1);
    }
    const lines = readFileSync(cardPath, 'utf8').split('\n');
    const botIdx = lines.findIndex(l => l.trim() === '## BOT');
    if (botIdx === -1) {
        writeFileSync(cardPath, lines.join('\n').trimEnd() + `\n\n## BOT\n\n- [ ] ${task}\n`);
    }
    else {
        let insertAt = lines.length;
        for (let i = botIdx + 1; i < lines.length; i++) {
            if (/^## /.test(lines[i])) {
                insertAt = i;
                break;
            }
        }
        while (insertAt > botIdx + 1 && lines[insertAt - 1].trim() === '')
            insertAt--;
        lines.splice(insertAt, 0, `- [ ] ${task}`, '');
        writeFileSync(cardPath, lines.join('\n'));
    }
    console.log(`✓ Added task to .flowdeck/${column}/TODO.md`);
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
if (subcmd === '--version' || subcmd === '-v') {
    const pkg = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'package.json'), 'utf8'));
    console.log(pkg.version);
    process.exit(0);
}
if (!subcmd || subcmd === '--help' || subcmd === '-h') {
    console.log(`Usage: flowdeck <command> [options]

Commands:
  init                        Create .flowdeck/ scaffold with templates
  play [-m "<message>"]       Stage + commit (if -m given), then hand off to Claude
  send [-m "<message>"]       Alias for play
  add <column> [title]        Create a new column + card
  upgrade <column> <task>     Append a task to an existing card

Examples:
  flowdeck init
  flowdeck play -m "add stripe webhook"
  flowdeck play
  flowdeck add payments "Stripe integration"
  flowdeck upgrade payments "add refund flow"
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
    const scaffoldDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'scaffold');
    mkdirSync(join(fd, 'start'), { recursive: true });
    writeFileSync(join(fd, 'AGENT.md'), readFileSync(join(scaffoldDir, 'AGENT.md.flowdeck'), 'utf8'));
    writeFileSync(join(fd, 'TODO.md.template'), readFileSync(join(scaffoldDir, 'TODO.md.flowdeck'), 'utf8'));
    writeFileSync(join(fd, 'start', 'TODO.md'), readFileSync(join(scaffoldDir, 'start', 'TODO.md.flowdeck'), 'utf8'));
    writeFileSync(join(fd, '.flowdeckignore'), `\
node_modules/
dist/
.git/
*.log
.env
`);
    const scaffoldCommandsDir = join(scaffoldDir, '.claude', 'commands');
    const projectCommandsDir = join(cwd, '.claude', 'commands');
    mkdirSync(projectCommandsDir, { recursive: true });
    for (const f of readdirSync(scaffoldCommandsDir)) {
        writeFileSync(join(projectCommandsDir, f), readFileSync(join(scaffoldCommandsDir, f)));
    }
    process.stdout.write('  fetching mdblu templates…');
    const templateSource = await scaffoldTemplates(join(fd, 'templates'), cwd);
    process.stdout.write(`\r✓ templates — ${templateSource}\n`);
    console.log(`✓ .flowdeck/ initialized
  AGENT.md               — instructions for Claude
  TODO.md.template       — onboarding reference (not scanned by agents)
  start/TODO.md          — first work area
  templates/             — mdblu templates (source: ${templateSource})
  .flowdeckignore
  .claude/commands/      — slash commands (play-card, add-card, upgrade-card)
`);
}
else if (subcmd === 'play' || subcmd === 'send') {
    await sendCommand(rest);
}
else if (subcmd === 'add') {
    addCommand(rest);
}
else if (subcmd === 'upgrade') {
    upgradeCommand(rest);
}
else {
    console.error(`Unknown command: ${subcmd}`);
    process.exit(1);
}
