#!/usr/bin/env node

/**
 * stagecraft CLI entry point.
 *
 * Usage:
 *   stagecraft list                       List available skills
 *   stagecraft run <skill-name>           Run a skill's .pw file
 *     --variable key=value                Set template variables
 */

import path from 'node:path';
import { minimist, SessionPlayer, resolveCommand } from '@playwright-repl/core';
import { discoverSkills, findSkill } from './skills.js';

const args = minimist(process.argv.slice(2), {
  string: ['variable'],
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

Examples:
  stagecraft list
  stagecraft run download-rogers-bill -v billing_period="January 24, 2026"
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

  if (!skill.pwFile) {
    console.error(`Skill '${skillName}' has no .pw file to run.`);
    process.exit(1);
  }

  // Parse --variable args into a Record
  const variables = parseVariables(args.variable as string | string[] | undefined);

  // Load commands via SessionPlayer
  const commands = SessionPlayer.load(skill.pwFile, variables);

  console.log(`Running skill: ${skill.name}`);
  if (skill.preconditions) {
    console.log(`  Note: ${skill.preconditions}`);
  }
  console.log(`  Commands: ${commands.length}`);
  console.log('');

  // Launch browser via Playwright (dynamic import to avoid compile-time type dep)
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
