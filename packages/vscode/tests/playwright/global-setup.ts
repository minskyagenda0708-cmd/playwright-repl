/**
 * Global Setup for Playwright Mock Tests
 *
 * 1. Runs the test build (extension + webview scripts via esbuild)
 * 2. Initializes client-side coverage collection
 */

import * as path from 'path';
import { execFileSync } from 'child_process';
import { initCoverage, loadNextcovConfig } from 'nextcov/playwright';

const EXTENSION_DIR = path.resolve(__dirname, '../..');

export default async function globalSetup() {
  // Build extension + webview scripts for tests
  execFileSync(process.execPath, ['build-test.mjs'], { cwd: EXTENSION_DIR, stdio: 'inherit' });

  const config = await loadNextcovConfig(path.join(__dirname, 'playwright.config.ts'));
  await initCoverage(config);
}
