import { createServer } from 'mcpster';
import { z } from 'zod';
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, readdirSync, statSync, } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
// -- config -------------------------------------------------------------------
const __dirname = dirname(fileURLToPath(import.meta.url));
const config = JSON.parse(readFileSync(join(__dirname, '..', 'mcpster.config.json'), 'utf8'));
const { permissions = 'permissive', transport = 'stdio', http } = config;
// -- fs helpers ---------------------------------------------------------------
function root() {
    return process.env.FLOWDECK_ROOT ?? process.cwd();
}
function openDir() {
    const d = join(root(), 'open');
    if (!existsSync(d))
        mkdirSync(d, { recursive: true });
    return d;
}
function doneDir() {
    const d = join(root(), 'done');
    if (!existsSync(d))
        mkdirSync(d, { recursive: true });
    return d;
}
function toSlug(title) {
    return title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}
function uniqueSlug(base, dir) {
    if (!existsSync(join(dir, base)))
        return base;
    let i = 2;
    while (existsSync(join(dir, `${base}-${i}`)))
        i++;
    return `${base}-${i}`;
}
function tree(dir, indent = '') {
    if (!existsSync(dir))
        return '';
    const entries = readdirSync(dir).filter(e => statSync(join(dir, e)).isDirectory()).sort();
    return entries.map(e => {
        const readme = join(dir, e, 'README.md');
        const title = existsSync(readme)
            ? readFileSync(readme, 'utf8').split('\n')[0].replace(/^#+ /, '')
            : e;
        const sub = tree(join(dir, e), indent + '  ');
        return [`${indent}- **${e}** — ${title}`, sub].filter(Boolean).join('\n');
    }).join('\n');
}
// -- git helpers --------------------------------------------------------------
function gitExec(cmd, cwd) {
    try {
        return execSync(cmd, { cwd, encoding: 'utf8' }).trim();
    }
    catch {
        return '';
    }
}
function getLastCommitMessage(dir) {
    const msg = gitExec('git log -1 --pretty=%B', dir);
    return msg || '(no commits yet)';
}
function getFileDiff(dir) {
    const diff = gitExec('git diff HEAD', dir);
    return diff || '(no changes)';
}
function gitCommit(dir, message) {
    try {
        gitExec('git add -A', dir);
        const result = gitExec(`git commit -m "${message.replace(/"/g, '\\"')}"`, dir);
        return result || 'committed';
    }
    catch (e) {
        return `error: ${e instanceof Error ? e.message : String(e)}`;
    }
}
// -- server -------------------------------------------------------------------
const server = createServer({ name: 'flowdeck', version: '0.1.0', transport, http });
// -- tool: open ---------------------------------------------------------------
server.defineTool({
    name: 'open',
    description: 'Open a new issue — creates open/<slug>/README.md with the given title and body. ' +
        'Pass parent to nest it as a sub-issue under an existing open issue.',
    schema: z.object({
        title: z.string().describe('Issue title'),
        body: z.string().optional().describe('Initial markdown content'),
        parent: z.string().optional().describe('Slug of the parent issue (for sub-issues)'),
    }),
    handler: async ({ title, body, parent }) => {
        const od = openDir();
        const parentDir = parent ? join(od, parent) : od;
        if (parent && !existsSync(parentDir))
            throw new Error(`Parent "${parent}" not found in open/`);
        const slug = uniqueSlug(toSlug(title), parentDir);
        const issueDir = join(parentDir, slug);
        mkdirSync(issueDir, { recursive: true });
        writeFileSync(join(issueDir, 'README.md'), `# ${title}\n\n${body ?? ''}`.trimEnd() + '\n', 'utf8');
        const path = parent ? `open/${parent}/${slug}` : `open/${slug}`;
        return `Created ${path}/README.md`;
    },
});
// -- tool: close --------------------------------------------------------------
server.defineTool({
    name: 'close',
    description: 'Close an issue by moving it from open/ to done/. ' +
        'Pass the slug path relative to open/, e.g. "fix-login" or "fix-login/handle-oauth".',
    schema: z.object({
        path: z.string().describe('Issue slug path, e.g. "fix-login" or "add-payments/stripe-webhook"'),
    }),
    handler: async ({ path }) => {
        const src = join(openDir(), path);
        if (!existsSync(src))
            throw new Error(`Issue "${path}" not found in open/`);
        const dest = join(doneDir(), path);
        mkdirSync(dirname(dest), { recursive: true });
        renameSync(src, dest);
        return `Moved open/${path} → done/${path}`;
    },
});
// -- tool: note ---------------------------------------------------------------
server.defineTool({
    name: 'note',
    description: 'Append a markdown note to an open issue README.md.',
    schema: z.object({
        path: z.string().describe('Issue slug path, e.g. "fix-login"'),
        content: z.string().describe('Markdown content to append'),
    }),
    handler: async ({ path, content }) => {
        const readme = join(openDir(), path, 'README.md');
        if (!existsSync(readme))
            throw new Error(`Issue "${path}" not found in open/`);
        const existing = readFileSync(readme, 'utf8').trimEnd();
        writeFileSync(readme, `${existing}\n\n---\n\n${content.trimEnd()}\n`, 'utf8');
        return `Appended note to open/${path}/README.md`;
    },
});
// -- tool: list ---------------------------------------------------------------
server.defineTool({
    name: 'list',
    description: 'List all open issues as a tree. Each entry shows the slug and issue title.',
    schema: z.object({}),
    handler: async () => {
        const t = tree(openDir());
        return t || 'No open issues.';
    },
});
// -- tool: flowdeck-do --------------------------------------------------------
server.defineTool({
    name: 'flowdeck-do',
    description: 'Get context about what the human asked (reads last commit), or finalize work by committing. ' +
        'Phase 1: Call with action="context" to see what was asked and current file state. ' +
        'Phase 2: You make changes to files (using Claude\'s Read/Write tools). ' +
        'Phase 3: Call with action="commit" and a summary message to stage and commit all changes.',
    schema: z.object({
        path: z.string().describe('Issue path, e.g. "add-payments"'),
        action: z.enum(['context', 'commit']).optional().default('context').describe('What to do: get context, or commit changes'),
        message: z.string().optional().describe('Commit message (required if action="commit")'),
    }),
    handler: async ({ path, action, message }) => {
        const issueDir = join(openDir(), path);
        if (!existsSync(issueDir))
            throw new Error(`Issue "${path}" not found in open/`);
        if (action === 'context') {
            const asked = getLastCommitMessage(issueDir);
            const diff = getFileDiff(issueDir);
            const readmeFile = join(issueDir, 'README.md');
            const readme = existsSync(readmeFile) ? readFileSync(readmeFile, 'utf8') : '(no README yet)';
            return [
                '## What was asked',
                asked,
                '',
                '## Current README.md',
                '```markdown',
                readme,
                '```',
                '',
                '## Uncommitted changes',
                '```',
                diff,
                '```',
            ].join('\n');
        }
        if (action === 'commit') {
            if (!message)
                throw new Error('message is required for action="commit"');
            const result = gitCommit(issueDir, message);
            return `✓ Committed: ${message}\n${result}`;
        }
        throw new Error('Unknown action');
    },
});
// -- start --------------------------------------------------------------------
server.setup({ permissions }).then(s => s.start());
