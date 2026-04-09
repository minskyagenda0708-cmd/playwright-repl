#!/usr/bin/env node
/**
 * Publish VS Code extension to marketplace.
 *
 * Why a temp directory?  vsce uses npm internally and follows workspace
 * symlinks, pulling the entire monorepo into the VSIX.  Copying to a
 * standalone directory gives npm a clean install with no symlinks.
 *
 * Usage:
 *   node publish.mjs          # package only (creates .vsix)
 *   node publish.mjs publish  # package + publish to marketplace
 */

import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const VSCODE_PKG = import.meta.dirname;
const ROOT = path.resolve(VSCODE_PKG, '..', '..');
const publish = process.argv.includes('publish');

function run(cmd, opts = {}) {
  console.log(`\n> ${cmd}`);
  execSync(cmd, { stdio: 'inherit', ...opts });
}

// ─── 1. Build monorepo ────────────────────────────────────────────────────
console.log('=== Building monorepo ===');
run('pnpm run build', { cwd: ROOT });
run('node build.mjs', { cwd: VSCODE_PKG });

// ─── 2. Copy to temp directory ────────────────────────────────────────────
const tmpDir = path.join(os.tmpdir(), 'vscode-publish');
if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true });
fs.mkdirSync(tmpDir, { recursive: true });

const items = [
  'dist', 'images', 'media', 'l10n',
  'package.json', 'README.md', 'CHANGELOG.md', 'LICENSE', 'NOTICE',
  '.vscodeignore',
  // localization files
  ...fs.readdirSync(VSCODE_PKG).filter(f => f.startsWith('package.nls')),
];

for (const item of items) {
  const src = path.join(VSCODE_PKG, item);
  if (!fs.existsSync(src)) continue;
  const dest = path.join(tmpDir, item);
  fs.cpSync(src, dest, { recursive: true });
}

// ─── 3. Resolve workspace:* refs to real versions ────────────────────────
const pkg = JSON.parse(fs.readFileSync(path.join(tmpDir, 'package.json'), 'utf8'));
delete pkg.devDependencies;
delete pkg.scripts;
for (const [name, ver] of Object.entries(pkg.dependencies || {})) {
  if (ver.startsWith('workspace:')) {
    // Find the workspace package by scanning packages/ for a matching name
    const pkgsDir = path.join(ROOT, 'packages');
    const match = fs.readdirSync(pkgsDir).find(dir => {
      const p = path.join(pkgsDir, dir, 'package.json');
      return fs.existsSync(p) && JSON.parse(fs.readFileSync(p, 'utf8')).name === name;
    });
    if (!match) throw new Error(`Could not find workspace package for ${name}`);
    const depPkg = JSON.parse(fs.readFileSync(path.join(pkgsDir, match, 'package.json'), 'utf8'));
    pkg.dependencies[name] = depPkg.version;
  }
}
fs.writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify(pkg, null, 2) + '\n');

console.log(`\n=== Copied to ${tmpDir} ===`);

// ─── 4. npm install (clean, no symlinks) ──────────────────────────────────
console.log('\n=== Installing dependencies ===');
run('npm install --production', { cwd: tmpDir });

// ─── 5. Package / Publish ─────────────────────────────────────────────────
if (publish) {
  console.log('\n=== Publishing to VS Code Marketplace ===');
  run('npx @vscode/vsce publish', { cwd: tmpDir });
} else {
  console.log('\n=== Packaging VSIX ===');
  run('npx @vscode/vsce package', { cwd: tmpDir });
  // Copy VSIX back to packages/vscode
  const vsix = fs.readdirSync(tmpDir).find(f => f.endsWith('.vsix'));
  if (vsix) {
    fs.cpSync(path.join(tmpDir, vsix), path.join(VSCODE_PKG, vsix));
    console.log(`\nVSIX: packages/vscode/${vsix}`);
  }
}

console.log('\nDone!');
