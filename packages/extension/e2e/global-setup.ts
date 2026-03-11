/**
 * Global Setup for E2E Tests
 *
 * Initializes coverage collection before tests run.
 * Works for both client-only and full (client + server) coverage modes.
 */

import * as path from 'path'
import { initCoverage, loadNextcovConfig } from 'nextcov/playwright'

export default async function globalSetup() {
  const config = await loadNextcovConfig(path.join(process.cwd(), 'playwright.config.ts'))
  await initCoverage(config)
}
