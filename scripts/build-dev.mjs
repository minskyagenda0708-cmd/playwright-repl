#!/usr/bin/env node
// Build with sourcemaps enabled for E2E test coverage.
import { execSync } from 'node:child_process';
import { resolve } from 'node:path';

execSync('pnpm run build', {
  cwd: resolve(import.meta.dirname, '..'),
  stdio: 'inherit',
  env: { ...process.env, SOURCEMAP: 'true' },
});
