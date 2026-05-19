#!/usr/bin/env node

/**
 * stagecraft CLI entry point.
 *
 * Usage:
 *   stagecraft list                       List available skills
 *   stagecraft run <skill-name>           Run a skill's .pw file or .js script
 *     --variable key=value                Set template variables (for .pw files)
 *     --http                              Connect to running playwright-repl --http server
 *     --http-port <port>                  HTTP server port (default: 9223)
 */

import path from 'node:path';
import fs from 'node:fs';
import { minimist, SessionPlayer, resolveCommand } from '@playwright-repl/core';
import { discoverSkills, findSkill } from './skills.js';

const args = minimist(process.argv.slice(2), {
  string: ['variable', 'http-port'],
  boolean: ['http'],
  alias: { v: 'variable' },
});

const command = args._[0];
const skillsDir = path.resolve(import.meta.dirname, '..', 'skills');

if (!command || command === 'help') {
  printHelp();
  process.exit(0);
}

if (command === 'list') {
  listSkills();
} else if (command === 'run') {
  await runSkill();
} else {
  console.error(`Unknown command: ${command}`);
  console.error(`Run 'stagecraft help' for usage.`);
  process.exit(1);
}

// ─── Commands ───────────────────────────────────────────────────────────────

function printHelp() {
  console.log(`
stagecraft — skill library for playwright-repl

Usage:
  stagecraft list                       List available skills
  stagecraft run <skill-name>           Run a skill's .pw file
    --variable key=value (-v)           Set template variables (repeatable)
    --http                              Connect to running playwright-repl --http server
    --http-port <port>                  HTTP server port (default: 9223)

Examples:
  stagecraft list
  stagecraft run download-rogers-bill -v billing_period="January 24, 2026"
  stagecraft run download-rogers-bill --http -v billing_period="January 24, 2026"
`.trim());
}

function listSkills(dir?: string) {
  const skills = discoverSkills(dir || skillsDir);
  if (skills.length === 0) {
    console.log('No skills found.');
    return;
  }

  console.log('Skills:');

  // Group by category
  const grouped = new Map<string, typeof skills>();
  for (const skill of skills) {
    const list = grouped.get(skill.category) || [];
    list.push(skill);
    grouped.set(skill.category, list);
  }

  for (const [category, items] of grouped) {
    console.log(`  ${category}`);
    for (const skill of items) {
      const name = skill.name.padEnd(24);
      console.log(`    ${name}${skill.description}`);
    }
  }
}

async function runSkill() {
  const skillName = args._[1];
  if (!skillName) {
    console.error('Usage: stagecraft run <skill-name>');
    process.exit(1);
  }

  const skills = discoverSkills(skillsDir);
  const skill = findSkill(skills, skillName);
  if (!skill) {
    console.error(`Skill not found: ${skillName}`);
    console.error(`Run 'stagecraft list' to see available skills.`);
    process.exit(1);
  }

  if (!skill.pwFile && !skill.jsFile) {
    console.error(`Skill '${skillName}' has no .pw or .js file to run.`);
    process.exit(1);
    return;
  }

  // Parse --variable args into a Record
  const variables = parseVariables(args.variable as string | string[] | undefined);

  console.log(`Running skill: ${skill.name}`);
  if (skill.preconditions) {
    console.log(`  Note: ${skill.preconditions}`);
  }

  const port = args['http-port'] ? parseInt(args['http-port'] as string, 10) : 9223;

  if (args.http as boolean) {
    // Prefer .js over .pw in HTTP mode — full Playwright API, handles downloads natively
    if (skill.jsFile) {
      await runSkillHttpJs(skill.jsFile, variables, port);
    } else {
      const commands = SessionPlayer.load(skill.pwFile!, variables);
      console.log(`  Commands: ${commands.length}`);
      console.log('');
      await runSkillHttpPw(commands, port);
    }
  } else {
    if (!skill.pwFile) {
      console.error(`Direct mode only supports .pw files. Use --http to run .js skills.`);
      process.exit(1);
      return;
    }
    const commands = SessionPlayer.load(skill.pwFile, variables);
    console.log(`  Commands: ${commands.length}`);
    console.log('');
    await runSkillDirect(commands);
  }
}

// ─── HTTP helpers ────────────────────────────────────────────────────────────

async function ensureHttpServer(base: string, port: number): Promise<void> {
  try {
    const res = await fetch(`${base}/health`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  } catch {
    console.error(`Cannot connect to playwright-repl server on port ${port}.`);
    console.error(`Start it with: playwright-repl --http --http-port ${port}`);
    process.exit(1);
  }
}

// ─── HTTP .js mode: send script via /run-script ──────────────────────────────
// Preferred for skills with complex logic (downloads, loops, conditionals).

async function runSkillHttpJs(jsFile: string, variables: Record<string, string> | undefined, port: number): Promise<void> {
  const base = `http://localhost:${port}`;
  await ensureHttpServer(base, port);

  let script = fs.readFileSync(jsFile, 'utf-8');
  // Substitute {{variable}} placeholders if present
  if (variables) {
    for (const [key, value] of Object.entries(variables)) {
      script = script.replaceAll(`{{${key}}}`, value);
    }
  }

  console.log(`  Running .js skill via /run-script`);
  console.log('');

  try {
    const res = await fetch(`${base}/run-script`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ script, language: 'javascript' }),
    });
    const result = await res.json() as { text: string; isError: boolean };
    if (result.isError) {
      console.error(`ERROR: ${result.text}`);
      process.exit(1);
    }
    if (result.text) console.log(result.text);
  } catch (err: unknown) {
    console.error(`ERROR: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
  console.log('\nDone.');
}

// ─── HTTP .pw mode: send keyword commands one by one via /run ─────────────────

async function runSkillHttpPw(commands: string[], port: number): Promise<void> {
  const base = `http://localhost:${port}`;
  await ensureHttpServer(base, port);

  for (let i = 0; i < commands.length; i++) {
    const cmd = commands[i];
    console.log(`  [${i + 1}/${commands.length}] ${cmd}`);

    try {
      const res = await fetch(`${base}/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command: cmd }),
      });
      const result = await res.json() as { text: string; isError: boolean };
      if (result.isError) {
        console.error(`  ERROR: ${result.text}`);
        process.exit(1);
      }
      if (result.text) console.log(`  → ${result.text}`);
    } catch (err: unknown) {
      console.error(`  ERROR: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    }
  }
  console.log('\nDone.');
}

// ─── Direct mode: launch fresh Playwright browser ────────────────────────────

async function runSkillDirect(commands: string[]): Promise<void> {
  // Dynamic import to avoid compile-time type dependency on playwright
  const dynamicImport = Function('m', 'return import(m)') as (m: string) => Promise<any>;
  const { chromium } = await dynamicImport('playwright');
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();

  const AsyncFn = Object.getPrototypeOf(async function () {}).constructor;

  try {
    for (let i = 0; i < commands.length; i++) {
      const cmd = commands[i];
      console.log(`  [${i + 1}/${commands.length}] ${cmd}`);

      const resolved = resolveCommand(cmd);
      if (!resolved) {
        console.error(`  ERROR: Unknown command: ${cmd}`);
        process.exit(1);
      }

      try {
        const fn = new AsyncFn('page', 'context', resolved.jsExpr);
        await fn(page, context);
      } catch (err: unknown) {
        console.error(`  ERROR: ${err instanceof Error ? err.message : String(err)}`);
        process.exit(1);
      }
    }
    console.log('\nDone.');
  } finally {
    await browser.close();
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function parseVariables(raw: string | string[] | undefined): Record<string, string> | undefined {
  if (!raw) return undefined;
  const items = Array.isArray(raw) ? raw : [raw];
  const vars: Record<string, string> = {};
  for (const item of items) {
    const eq = item.indexOf('=');
    if (eq === -1) {
      console.error(`Invalid variable format: ${item} (expected key=value)`);
      process.exit(1);
    }
    vars[item.slice(0, eq)] = item.slice(eq + 1);
  }
  return Object.keys(vars).length > 0 ? vars : undefined;
}
