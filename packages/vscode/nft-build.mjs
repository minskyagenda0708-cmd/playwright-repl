#!/usr/bin/env node
/**
 * Assemble VS Code extension into .vsce-build/ using @vercel/nft.
 *
 * Copies dist/, traced node_modules/, and static assets into a single
 * self-contained folder ready for vsce package.
 *
 * Usage: node nft-build.mjs
 */

import { nodeFileTrace } from '@vercel/nft';
import fs from 'node:fs';
import path from 'node:path';

const VSCODE_PKG = import.meta.dirname;
const ROOT = path.resolve(VSCODE_PKG, '..', '..');
const BUILD = path.join(VSCODE_PKG, '.vsce-build');

// ─── 1. Clean target folder ─────────────────────────────────────────────
if (fs.existsSync(BUILD)) fs.rmSync(BUILD, { recursive: true, force: true });
fs.mkdirSync(BUILD, { recursive: true });

// ─── 2. Copy dist/ ──────────────────────────────────────────────────────
fs.cpSync(path.join(VSCODE_PKG, 'dist'), path.join(BUILD, 'dist'), { recursive: true });
console.log('Copied dist/');

// ─── 3. Trace and copy node_modules/ ─────────────────────────────────────
const distDir = path.join(VSCODE_PKG, 'dist');
const entryPoints = [
  'extension.js',
  'babelBundle.js',
  'debugTransform.js',
  'oopReporter.js',
  'playwrightFinder.js',
].map(f => path.join(distDir, f)).filter(f => fs.existsSync(f));


console.log(`\nTracing ${entryPoints.length} entry points...`);

const { fileList } = await nodeFileTrace(entryPoints, {
  base: ROOT,
  // pnpm uses symlinks for ALL deps (including dev). By telling nft there
  // are no symlinks, it won't scan symlinked directories for siblings.
  // It still reads file content through symlinks (Node resolves them),
  // but only follows actual require()/import() calls in the code.
  readlink: async () => null,
});
console.log(`Traced ${fileList.size} files`);

function toNodeModulesPath(absPath) {
  const rel = path.relative(ROOT, absPath).split(path.sep).join('/');
  // Inside packages/vscode/dist/ — skip (already copied)
  const vsRel = path.relative(VSCODE_PKG, absPath).split(path.sep).join('/');
  if (vsRel.startsWith('dist/') || vsRel === 'package.json') return null;
  // Inside packages/vscode/node_modules/ — keep the node_modules/ path
  if (vsRel.startsWith('node_modules/')) return vsRel;
  const pnpmMatch = rel.match(/node_modules\/\.pnpm\/[^/]+\/node_modules\/(.*)/);
  if (pnpmMatch) return `node_modules/${pnpmMatch[1]}`;
  const nmMatch = rel.match(/(node_modules\/.*)/);
  if (nmMatch) return nmMatch[1];
  const pkgMatch = rel.match(/packages\/([^/]+)\/(.*)/);
  if (pkgMatch) {
    const pkgJsonPath = path.join(ROOT, 'packages', pkgMatch[1], 'package.json');
    if (fs.existsSync(pkgJsonPath)) {
      const p = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf8'));
      return `node_modules/${p.name}/${pkgMatch[2]}`;
    }
  }
  return null;
}

let nmCopied = 0;
for (const relFile of fileList) {
  const absSource = path.join(ROOT, relFile);
  try {
    const realSource = fs.realpathSync(absSource);
    if (!fs.statSync(realSource).isFile()) continue;
    const dest = toNodeModulesPath(absSource);
    if (!dest) continue;
    const destAbs = path.join(BUILD, dest);
    fs.mkdirSync(path.dirname(destAbs), { recursive: true });
    fs.copyFileSync(realSource, destAbs);
    nmCopied++;
  } catch { /* skip */ }
}
console.log(`Copied ${nmCopied} files to node_modules/`);

// ─── 4. Copy static assets ──────────────────────────────────────────────
const staticItems = [
  'chrome-extension', 'images', 'media', 'l10n',
  'README.md', 'CHANGELOG.md', 'LICENSE', 'NOTICE',
  ...fs.readdirSync(VSCODE_PKG).filter(f => f.startsWith('package.nls')),
];
for (const item of staticItems) {
  const src = path.join(VSCODE_PKG, item);
  if (!fs.existsSync(src)) continue;
  fs.cpSync(src, path.join(BUILD, item), { recursive: true });
}
console.log('Copied static assets');

// ─── 5. Write package.json with traced deps ─────────────────────────────
const pkg = JSON.parse(fs.readFileSync(path.join(VSCODE_PKG, 'package.json'), 'utf8'));
// List traced packages as bundledDependencies so npm list is happy
const tracedDeps = {};
const nmDir = path.join(BUILD, 'node_modules');
if (fs.existsSync(nmDir)) {
  for (const entry of fs.readdirSync(nmDir)) {
    if (entry.startsWith('.')) continue;
    if (entry.startsWith('@')) {
      for (const sub of fs.readdirSync(path.join(nmDir, entry))) {
        const pPath = path.join(nmDir, entry, sub, 'package.json');
        const p = JSON.parse(fs.readFileSync(pPath, 'utf8'));
        tracedDeps[p.name] = p.version;
        // Strip deps so npm list doesn't complain about missing transitive deps
        delete p.devDependencies; delete p.peerDependencies;
        fs.writeFileSync(pPath, JSON.stringify(p, null, 2) + '\n');
      }
    } else {
      const pkgPath = path.join(nmDir, entry, 'package.json');
      if (fs.existsSync(pkgPath)) {
        const p = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
        tracedDeps[p.name] = p.version;
        delete p.devDependencies; delete p.peerDependencies;
        fs.writeFileSync(pkgPath, JSON.stringify(p, null, 2) + '\n');
      }
    }
  }
}
pkg.dependencies = tracedDeps;
pkg.bundledDependencies = Object.keys(tracedDeps);
delete pkg.devDependencies;
delete pkg.scripts;
fs.writeFileSync(path.join(BUILD, 'package.json'), JSON.stringify(pkg, null, 2) + '\n');

// ─── 6. Write .vscodeignore ─────────────────────────────────────────────
fs.writeFileSync(path.join(BUILD, '.vscodeignore'), '*.map\n');

// ─── 7. Report ──────────────────────────────────────────────────────────
let totalFiles = 0;
let totalSize = 0;
function walk(dir) {
  for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
    const fp = path.join(dir, f.name);
    if (f.isDirectory()) walk(fp);
    else { totalFiles++; totalSize += fs.statSync(fp).size; }
  }
}
walk(BUILD);
console.log(`\n.vsce-build/: ${totalFiles} files, ${(totalSize / 1024 / 1024).toFixed(1)} MB`);
