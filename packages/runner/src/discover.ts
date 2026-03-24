/**
 * Discover test files in the test directory.
 */

import path from 'node:path';
import fs from 'node:fs';

export function discoverTests(testDir: string, filter?: string[]): string[] {
  const absDir = path.resolve(testDir);

  if (!fs.existsSync(absDir)) {
    return [];
  }

  // If filter specifies files or directories, use them
  if (filter && filter.length > 0) {
    const result: string[] = [];
    for (const f of filter) {
      const abs = path.resolve(f);
      if (!fs.existsSync(abs)) continue;
      if (fs.statSync(abs).isDirectory()) {
        walkDir(abs, result);
      } else {
        result.push(abs);
      }
    }
    return result.sort();
  }

  // Walk directory for .spec.ts / .test.ts files
  const files: string[] = [];
  walkDir(absDir, files);
  return files.sort();
}

function walkDir(dir: string, out: string[]) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name === 'playwright-tests' || entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkDir(full, out);
    } else if (/\.(spec|test)\.(ts|js|mjs)$/.test(entry.name)) {
      out.push(full);
    }
  }
}
