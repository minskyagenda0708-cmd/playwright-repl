#!/usr/bin/env node
/**
 * Package/publish VS Code extension using @vercel/nft.
 *
 * 1. Build: esbuild + nft → copy dist/ and traced node_modules/ to .vsce-build/
 * 2. Package: vsce package from .vsce-build/ (includes static assets)
 *
 * Usage:
 *   node publish.mjs          # package only (creates .vsix)
 *   node publish.mjs publish  # package + publish to marketplace
 */

import { nodeFileTrace } from '@vercel/nft';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const VSCODE_PKG = import.meta.dirname;
const ROOT = path.resolve(VSCODE_PKG, '..', '..');
const BUILD = path.join(VSCODE_PKG, '.vsce-build');
const doPublish = process.argv.includes('publish');

function run(cmd, opts = {}) {
  console.log(`\n> ${cmd}`);
  execSync(cmd, { stdio: 'inherit', ...opts });
}

// ─── 1. Build monorepo + extension ───────────────────────────────────────
console.log('=== Step 1: Build ===');
run('pnpm run build', { cwd: ROOT });
run('node build.mjs', { cwd: VSCODE_PKG });

// ─── 2. Trace runtime dependencies ──────────────────────────────────────
console.log('\n=== Step 2: Trace dependencies ===');
const distDir = path.join(VSCODE_PKG, 'dist');
const entryPoints = [
  'extension.js',
  'babelBundle.js',
  'debugTransform.js',
  'oopReporter.js',
  'playwrightFinder.js',
].map(f => path.join(distDir, f)).filter(f => fs.existsSync(f));

const { fileList } = await nodeFileTrace(entryPoints, {
  base: ROOT,
  readFile: async (filePath) => {
    const content = await fs.promises.readFile(filePath, 'utf8').catch(() => null);
    if (!content) return null;
    // Strip devDependencies so nft only traces production deps
    if (filePath.endsWith('package.json')) {
      try {
        const pkg = JSON.parse(content);
        delete pkg.devDependencies;
        return JSON.stringify(pkg);
      } catch { return content; }
    }
    return content;
  },
});
console.log(`Traced ${fileList.size} files`);

// ─── 3. Assemble build folder ───────────────────────────────────────────
console.log('\n=== Step 3: Assemble .vsce-build/ ===');
if (fs.existsSync(BUILD)) fs.rmSync(BUILD, { recursive: true, force: true });
fs.mkdirSync(BUILD, { recursive: true });

// 3a. Copy dist/
fs.cpSync(path.join(VSCODE_PKG, 'dist'), path.join(BUILD, 'dist'), { recursive: true });

// 3b. Copy traced node_modules (resolve pnpm symlinks)
function toNodeModulesPath(absPath) {
  const rel = path.relative(ROOT, absPath).split(path.sep).join('/');
  if (!path.relative(VSCODE_PKG, absPath).startsWith('..')) return null;
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

let copied = 0;
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
    copied++;
  } catch { /* skip */ }
}
console.log(`Copied ${copied} files to node_modules/`);

// 3c. Copy static assets
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

// 3d. Write package.json (no deps — everything is pre-assembled)
const pkg = JSON.parse(fs.readFileSync(path.join(VSCODE_PKG, 'package.json'), 'utf8'));
delete pkg.dependencies;
delete pkg.devDependencies;
delete pkg.scripts;
fs.writeFileSync(path.join(BUILD, 'package.json'), JSON.stringify(pkg, null, 2) + '\n');

// 3e. Write .vscodeignore
fs.writeFileSync(path.join(BUILD, '.vscodeignore'), [
  '*.map', '.gitignore',
].join('\n') + '\n');

// ─── 4. Package / Publish ────────────────────────────────────────────────
console.log('\n=== Step 4: Package ===');
if (doPublish) {
  run('npx @vscode/vsce publish --no-dependencies', { cwd: BUILD });
} else {
  run('npx @vscode/vsce package --no-dependencies', { cwd: BUILD });
  const vsix = fs.readdirSync(BUILD).find(f => f.endsWith('.vsix'));
  if (vsix) {
    fs.cpSync(path.join(BUILD, vsix), path.join(VSCODE_PKG, vsix));
    const size = fs.statSync(path.join(VSCODE_PKG, vsix)).size;
    console.log(`\nVSIX: packages/vscode/${vsix} (${(size / 1024 / 1024).toFixed(1)} MB)`);
  }
}

console.log('\nDone!');
