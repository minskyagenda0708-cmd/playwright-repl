/**
 * pageTest — fixture wrapper for Playwright's page tests.
 *
 * Provides a `server` fixture backed by a static HTTP server
 * serving ./assets/. Uses globalThis to pass the server to tests
 * (avoids test.extend fixture lifecycle issues in our shim).
 */

import { test as base, expect } from '@playwright/test';
import http from 'http';
import path from 'path';
import fs from 'fs';
// Can't use import.meta.url — after esbuild bundling, the code runs from a temp file.
// Use process.env or a known path relative to CWD.
const ASSETS_DIR = path.resolve(process.cwd(), 'assets');

interface Server {
  PREFIX: string;
  CROSS_PROCESS_PREFIX: string;
  EMPTY_PAGE: string;
  port: number;
}

function serveFile(filePath: string, res: http.ServerResponse) {
  const ext = path.extname(filePath).toLowerCase();
  const mimeTypes: Record<string, string> = {
    '.html': 'text/html',
    '.js': 'application/javascript',
    '.css': 'text/css',
    '.json': 'application/json',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
  };
  res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'application/octet-stream' });
  res.end(fs.readFileSync(filePath));
}

// Start server once, globally
let _server: Server | null = null;
let _httpServer: http.Server | null = null;

async function ensureServer(): Promise<Server> {
  if (_server) return _server;
  return new Promise((resolve) => {
    _httpServer = http.createServer((req, res) => {
      const url = new URL(req.url!, `http://localhost`);
      const filePath = path.join(ASSETS_DIR, decodeURIComponent(url.pathname));
      if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
        res.writeHead(404);
        res.end('Not found');
        return;
      }
      serveFile(filePath, res);
    });
    _httpServer.listen(0, '127.0.0.1', () => {
      const port = (_httpServer!.address() as any).port;
      _server = {
        PREFIX: `http://127.0.0.1:${port}`,
        CROSS_PROCESS_PREFIX: `http://127.0.0.1:${port}`,
        EMPTY_PAGE: `http://127.0.0.1:${port}/empty.html`,
        port,
      };
      resolve(_server);
    });
  });
}

// Wrap test to inject server fixture
function createTest() {
  const wrappedTest: any = (name: string, fn: (fixtures: any) => Promise<void>) => {
    base(name, async (fixtures: any) => {
      const server = await ensureServer();
      await fn({ ...fixtures, server });
    });
  };
  wrappedTest.only = base.only;
  wrappedTest.skip = base.skip;
  wrappedTest.describe = base.describe;
  wrappedTest.beforeAll = base.beforeAll;
  wrappedTest.afterAll = base.afterAll;
  wrappedTest.beforeEach = base.beforeEach;
  wrappedTest.afterEach = base.afterEach;
  wrappedTest.extend = base.extend;
  wrappedTest.fixme = base.skip; // treat fixme as skip
  wrappedTest.slow = () => {};   // no-op
  wrappedTest.info = () => ({ annotations: [] }); // no-op
  return wrappedTest;
}

const test = createTest();

function rafraf(page: any, count = 1): Promise<void> {
  return page.evaluate((c: number) => {
    return new Promise<void>(resolve => {
      function step() {
        if (--c <= 0) resolve();
        else requestAnimationFrame(() => requestAnimationFrame(step));
      }
      requestAnimationFrame(() => requestAnimationFrame(step));
    });
  }, count);
}

export { test, test as it, expect, rafraf };
