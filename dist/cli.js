#!/usr/bin/env node
import { installServer } from 'mcpster';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
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
    if (!message) {
        console.error('Error: -m "message" is required');
        process.exit(1);
    }
    const cwd = process.env.FLOWDECK_ROOT ?? process.cwd();
    try {
        // Stage and commit human's message
        execSync('git add -A', { cwd, stdio: 'pipe' });
        execSync(`git commit -m "${message.replace(/"/g, '\\"')}"`, { cwd, stdio: 'pipe' });
        console.log(`\n✓ Committed: "${message}"`);
        console.log('\nNow use the /flowdeck-do tool in Claude Code or Claude Desktop.');
        console.log('Claude will see what you asked and can read/edit files.');
        console.log('\nWhen Claude is done, they will commit their work.');
    }
    catch (e) {
        const error = e instanceof Error ? e.message : String(e);
        if (error.includes('nothing to commit')) {
            console.log('\nNo changes to commit. Skipping to Claude...');
            console.log('Use the /flowdeck-do tool in Claude Code or Claude Desktop.');
        }
        else {
            console.error(`Error: ${error}`);
            process.exit(1);
        }
    }
}
// -- main =====================================================================
if (!subcmd || subcmd === '--help' || subcmd === '-h') {
    console.log(`Usage: flowdeck <command> [options]

Commands:
  send -m "<message>"    Stage changes, commit with message, prompt Claude via /flowdeck-do
  install                Register the MCP server in Claude

Examples:
  flowdeck send -m "implement the stripe webhook"
  flowdeck install
`);
    process.exit(0);
}
if (subcmd === 'install') {
    const __dirname = dirname(fileURLToPath(import.meta.url));
    const serverPath = join(__dirname, 'index.js');
    const root = process.env.FLOWDECK_ROOT ?? process.cwd();
    installServer('flowdeck', serverPath, { FLOWDECK_ROOT: root });
    console.log(`\nflowdeck installed — root: ${root}`);
    console.log('Restart Claude desktop / reload VS Code to apply.\n');
}
else if (subcmd === 'send') {
    await sendCommand(rest);
}
else {
    console.error(`Unknown command: ${subcmd}`);
    process.exit(1);
}
