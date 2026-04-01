#!/usr/bin/env node
/**
 * Build .vsce-build/ with nft-traced node_modules.
 * Then run: cd .vsce-build && npx @vscode/vsce package --no-dependencies
 */

import { nodeFileTrace } from '@vercel/nft';
import fs from 'node:fs';
import path from 'node:path';

const VSCODE_PKG = import.meta.dirname;
const ROOT = path.resolve(VSCODE_PKG, '..', '..');
const BUILD = path.join(VSCODE_PKG, '.vsce-build');
const distDir = path.join(VSCODE_PKG, 'dist');

// ─── 1. Clean & copy dist/ ──────────────────────────────────────────────
if (fs.existsSync(BUILD)) fs.rmSync(BUILD, { recursive: true, force: true });
fs.mkdirSync(BUILD, { recursive: true });
fs.cpSync(path.join(VSCODE_PKG, 'dist'), path.join(BUILD, 'dist'), { recursive: true });

// ─── 2. Trace runtime deps ──────────────────────────────────────────────
const entryPoints = [
  'extension.js', 'babelBundle.js', 'debugTransform.js',
  'oopReporter.js', 'playwrightFinder.js',
].map(f => path.join(distDir, f)).filter(f => fs.existsSync(f));

console.log(`Tracing ${entryPoints.length} entry points...`);
const { fileList } = await nodeFileTrace(entryPoints, {
  base: ROOT,
  readlink: async () => null,
});
console.log(`Traced ${fileList.size} files`);

// ─── 3. Copy traced files to node_modules/ ───────────────────────────────
let copied = 0;
for (const relFile of fileList) {
  const absSource = path.join(ROOT, relFile);
  try {
    const realSource = fs.realpathSync(absSource);
    if (!fs.statSync(realSource).isFile()) continue;
    const vsRel = path.relative(VSCODE_PKG, absSource).split(path.sep).join('/');
    if (vsRel.startsWith('dist/') || vsRel === 'package.json') continue;
    if (!vsRel.startsWith('node_modules/')) continue;
    const destAbs = path.join(BUILD, vsRel);
    fs.mkdirSync(path.dirname(destAbs), { recursive: true });
    fs.copyFileSync(realSource, destAbs);
    copied++;
  } catch { /* skip */ }
}
console.log(`Copied ${copied} files to node_modules/`);

// ─── 4. Copy static assets ──────────────────────────────────────────────
const statics = [
  'chrome-extension', 'images', 'media', 'l10n',
  'README.md', 'CHANGELOG.md', 'LICENSE', 'NOTICE',
  ...fs.readdirSync(VSCODE_PKG).filter(f => f.startsWith('package.nls')),
];
for (const item of statics) {
  const src = path.join(VSCODE_PKG, item);
  if (!fs.existsSync(src)) continue;
  fs.cpSync(src, path.join(BUILD, item), { recursive: true });
}

// ─── 5. Write package.json (no deps needed for --no-dependencies) ────────
const pkg = JSON.parse(fs.readFileSync(path.join(VSCODE_PKG, 'package.json'), 'utf8'));
delete pkg.dependencies;
delete pkg.devDependencies;
delete pkg.scripts;
fs.writeFileSync(path.join(BUILD, 'package.json'), JSON.stringify(pkg, null, 2) + '\n');

// ─── 6. Write .vscodeignore (NO node_modules exclusion) ─────────────────
fs.writeFileSync(path.join(BUILD, '.vscodeignore'), '*.map\n');

// ─── 7. Report ───────────────────────────────────────────────────────────
let total = 0;
(function walk(dir) {
  for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
    if (f.isDirectory()) walk(path.join(dir, f.name));
    else total++;
  }
})(BUILD);
console.log(`\n.vsce-build/: ${total} files`);
