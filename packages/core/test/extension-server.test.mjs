import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CommandServer } from '../src/extension-server.mjs';

// ─── Helper: create a mock engine ─────────────────────────────────────────────

function createMockEngine() {
  return {
    run: vi.fn().mockResolvedValue({ text: 'Clicked', isError: false }),
    connected: true,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('CommandServer', () => {
  let server;
  let engine;
  const TEST_PORT = 13579;

  beforeEach(() => {
    engine = createMockEngine();
    server = new CommandServer(engine);
  });

  afterEach(async () => {
    await server.close();
  });

  describe('lifecycle', () => {
    it('starts and listens on the given port', async () => {
      await server.start(TEST_PORT);
      expect(server.port).toBe(TEST_PORT);
    });

    it('close() is idempotent', async () => {
      await server.start(TEST_PORT);
      await server.close();
      await server.close(); // Should not throw
    });

    it('close() works when server was never started', async () => {
      await server.close(); // Should not throw
    });
  });

  describe('POST /run', () => {
    it('runs command through engine and returns result', async () => {
      await server.start(TEST_PORT);

      const res = await fetch(`http://localhost:${TEST_PORT}/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ raw: 'click e5' }),
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.text).toBe('Clicked');
      expect(data.isError).toBe(false);
      expect(engine.run).toHaveBeenCalled();
    });

    it('returns 400 for unknown commands', async () => {
      await server.start(TEST_PORT);

      const res = await fetch(`http://localhost:${TEST_PORT}/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ raw: '' }),
      });

      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.isError).toBe(true);
    });

    it('returns 500 when engine throws', async () => {
      engine.run.mockRejectedValueOnce(new Error('Engine exploded'));
      await server.start(TEST_PORT);

      const res = await fetch(`http://localhost:${TEST_PORT}/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ raw: 'click e5' }),
      });

      expect(res.status).toBe(500);
      const data = await res.json();
      expect(data.isError).toBe(true);
      expect(data.text).toContain('Engine exploded');
    });
  });

  describe('CORS', () => {
    it('responds to OPTIONS preflight with CORS headers', async () => {
      await server.start(TEST_PORT);

      const res = await fetch(`http://localhost:${TEST_PORT}/run`, {
        method: 'OPTIONS',
      });

      expect(res.status).toBe(204);
      expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
      expect(res.headers.get('Access-Control-Allow-Methods')).toBe('POST, GET');
    });

    it('includes CORS headers on POST responses', async () => {
      await server.start(TEST_PORT);

      const res = await fetch(`http://localhost:${TEST_PORT}/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ raw: 'click e5' }),
      });

      expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
    });
  });

  describe('other routes', () => {
    it('returns 404 for unknown paths', async () => {
      await server.start(TEST_PORT);

      const res = await fetch(`http://localhost:${TEST_PORT}/unknown`);
      expect(res.status).toBe(404);
    });

    it('returns 404 for GET /run', async () => {
      await server.start(TEST_PORT);

      const res = await fetch(`http://localhost:${TEST_PORT}/run`);
      expect(res.status).toBe(404);
    });
  });
});
