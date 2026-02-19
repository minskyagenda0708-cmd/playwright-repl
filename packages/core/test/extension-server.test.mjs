import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { WebSocket } from 'ws';
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

  describe('GET /json/version', () => {
    it('returns webSocketDebuggerUrl for CDP discovery', async () => {
      await server.start(TEST_PORT);

      const res = await fetch(`http://localhost:${TEST_PORT}/json/version`);
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.webSocketDebuggerUrl).toContain(`ws://127.0.0.1:${TEST_PORT}/devtools/browser/`);
      expect(data['Protocol-Version']).toBe('1.3');
    });

    it('also works with trailing slash', async () => {
      await server.start(TEST_PORT);

      const res = await fetch(`http://localhost:${TEST_PORT}/json/version/`);
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.webSocketDebuggerUrl).toBeDefined();
    });
  });

  describe('WebSocket /extension', () => {
    it('accepts extension connection and resolves waitForExtension', async () => {
      await server.start(TEST_PORT);

      const waitPromise = server.waitForExtension();
      const ws = new WebSocket(`ws://127.0.0.1:${TEST_PORT}/extension`);
      await new Promise((resolve) => ws.on('open', resolve));

      await waitPromise; // Should resolve when extension connects
      ws.close();
    });

    it('rejects second extension connection', async () => {
      await server.start(TEST_PORT);

      const ws1 = new WebSocket(`ws://127.0.0.1:${TEST_PORT}/extension`);
      await new Promise((resolve) => ws1.on('open', resolve));

      const ws2 = new WebSocket(`ws://127.0.0.1:${TEST_PORT}/extension`);
      const closeCode = await new Promise((resolve) => ws2.on('close', resolve));
      expect(closeCode).toBe(1000);

      ws1.close();
    });

    it('waitForExtension resolves immediately if already connected', async () => {
      await server.start(TEST_PORT);

      const ws = new WebSocket(`ws://127.0.0.1:${TEST_PORT}/extension`);
      await new Promise((resolve) => ws.on('open', resolve));

      await server.waitForExtension(); // Should resolve immediately
      ws.close();
    });
  });

  describe('CDP relay', () => {
    let extWs;
    let pwWs;
    let pwMessages;  // Collected messages from Playwright WebSocket
    let extMessages; // Collected messages from Extension WebSocket

    async function connectExtension() {
      extWs = new WebSocket(`ws://127.0.0.1:${TEST_PORT}/extension`);
      extMessages = [];
      await new Promise((resolve) => extWs.on('open', resolve));
      extWs.on('message', (data) => extMessages.push(JSON.parse(data.toString())));
    }

    async function connectPlaywright() {
      const res = await fetch(`http://localhost:${TEST_PORT}/json/version`);
      const { webSocketDebuggerUrl } = await res.json();
      pwWs = new WebSocket(webSocketDebuggerUrl);
      pwMessages = [];
      await new Promise((resolve) => pwWs.on('open', resolve));
      pwWs.on('message', (data) => pwMessages.push(JSON.parse(data.toString())));
    }

    function sendFromPlaywright(msg) {
      pwWs.send(JSON.stringify(msg));
    }

    /** Wait until pw message array has at least `count` entries. */
    async function waitForPwMessages(count) {
      while (pwMessages.length < count) {
        await new Promise((r) => setTimeout(r, 20));
      }
    }

    /** Wait until ext message array has at least `count` entries. */
    async function waitForExtMessages(count) {
      while (extMessages.length < count) {
        await new Promise((r) => setTimeout(r, 20));
      }
    }

    /** Auto-attach helper: sends Target.setAutoAttach, responds with target info, drains responses. */
    async function doAutoAttach() {
      const baseCount = extMessages.length;
      sendFromPlaywright({ id: 1, method: 'Target.setAutoAttach', params: {} });
      await waitForExtMessages(baseCount + 1);
      const attachMsg = extMessages[baseCount];
      expect(attachMsg.method).toBe('attachToTab');

      const pwBaseCount = pwMessages.length;
      extWs.send(JSON.stringify({
        id: attachMsg.id,
        result: { targetInfo: { targetId: 'tab-1', type: 'page', title: 'Test', url: 'http://test.com' } },
      }));
      await waitForPwMessages(pwBaseCount + 2); // event + response
    }

    afterEach(() => {
      extWs?.close();
      pwWs?.close();
    });

    it('handles Browser.getVersion locally', async () => {
      await server.start(TEST_PORT);
      await connectExtension();
      await connectPlaywright();

      sendFromPlaywright({ id: 1, method: 'Browser.getVersion', params: {} });
      await waitForPwMessages(1);

      expect(pwMessages[0].id).toBe(1);
      expect(pwMessages[0].result.protocolVersion).toBe('1.3');
      expect(pwMessages[0].result.product).toContain('Chrome');
    });

    it('handles Browser.setDownloadBehavior locally', async () => {
      await server.start(TEST_PORT);
      await connectExtension();
      await connectPlaywright();

      sendFromPlaywright({ id: 2, method: 'Browser.setDownloadBehavior', params: {} });
      await waitForPwMessages(1);

      expect(pwMessages[0].id).toBe(2);
      expect(pwMessages[0].result).toEqual({});
    });

    it('handles Target.setAutoAttach by sending attachToTab to extension', async () => {
      await server.start(TEST_PORT);
      await connectExtension();
      await connectPlaywright();

      await doAutoAttach();

      const attachedEvent = pwMessages.find(m => m.method === 'Target.attachedToTarget');
      const autoAttachResponse = pwMessages.find(m => m.id === 1);

      expect(autoAttachResponse.result).toEqual({});
      expect(attachedEvent.params.targetInfo.targetId).toBe('tab-1');
      expect(attachedEvent.params.sessionId).toMatch(/^pw-tab-/);
    });

    it('forwards CDP commands to extension via forwardCDPCommand', async () => {
      await server.start(TEST_PORT);
      await connectExtension();
      await connectPlaywright();

      await doAutoAttach();

      // Now send a CDP command with the session ID
      const extBaseCount = extMessages.length;
      sendFromPlaywright({
        id: 10,
        sessionId: 'pw-tab-1',
        method: 'Page.navigate',
        params: { url: 'http://example.com' },
      });
      await waitForExtMessages(extBaseCount + 1);

      const fwdMsg = extMessages[extBaseCount];
      expect(fwdMsg.method).toBe('forwardCDPCommand');
      expect(fwdMsg.params.method).toBe('Page.navigate');
      // Session ID should be stripped (maps to main tab)
      expect(fwdMsg.params.sessionId).toBeUndefined();

      // Extension responds
      const pwBaseCount = pwMessages.length;
      extWs.send(JSON.stringify({ id: fwdMsg.id, result: { frameId: 'f1' } }));
      await waitForPwMessages(pwBaseCount + 1);

      const response = pwMessages[pwBaseCount];
      expect(response.id).toBe(10);
      expect(response.result.frameId).toBe('f1');
    });

    it('forwards CDP events from extension to Playwright', async () => {
      await server.start(TEST_PORT);
      await connectExtension();
      await connectPlaywright();

      await doAutoAttach();

      // Send CDP event from extension
      const pwBaseCount = pwMessages.length;
      extWs.send(JSON.stringify({
        method: 'forwardCDPEvent',
        params: { method: 'Page.loadEventFired', params: { timestamp: 123 } },
      }));
      await waitForPwMessages(pwBaseCount + 1);

      const event = pwMessages[pwBaseCount];
      expect(event.method).toBe('Page.loadEventFired');
      expect(event.params.timestamp).toBe(123);
      expect(event.sessionId).toMatch(/^pw-tab-/);
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

    it('rejects WebSocket on invalid path', async () => {
      await server.start(TEST_PORT);

      const ws = new WebSocket(`ws://127.0.0.1:${TEST_PORT}/invalid`);
      const code = await new Promise((resolve) => ws.on('close', resolve));
      expect(code).toBe(4004);
    });
  });
});
