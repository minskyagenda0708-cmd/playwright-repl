import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { executeCommand, attachToTab, connectWithRetry } from '@/lib/bridge';

describe('bridge', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  // ─── executeCommand ────────────────────────────────────────────────────────

  it('executeCommand sends run message and returns result', async () => {
    const expected = { text: 'Navigated', isError: false };
    (chrome.runtime.sendMessage as ReturnType<typeof vi.fn>).mockResolvedValue(expected);

    const result = await executeCommand('goto https://example.com');

    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({ type: 'run', command: 'goto https://example.com' });
    expect(result).toEqual(expected);
  });

  it('executeCommand returns error result from background', async () => {
    const expected = { text: 'Element not found', isError: true };
    (chrome.runtime.sendMessage as ReturnType<typeof vi.fn>).mockResolvedValue(expected);

    const result = await executeCommand('click e99');
    expect(result).toEqual(expected);
  });

  // ─── attachToTab ──────────────────────────────────────────────────────────

  it('attachToTab sends attach message and returns result', async () => {
    const expected = { ok: true, url: 'https://example.com' };
    (chrome.runtime.sendMessage as ReturnType<typeof vi.fn>).mockResolvedValue(expected);

    const result = await attachToTab(42);

    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({ type: 'attach', tabId: 42 });
    expect(result).toEqual(expected);
  });

  it('attachToTab returns failure from background', async () => {
    const expected = { ok: false, error: 'Cannot attach to internal pages' };
    (chrome.runtime.sendMessage as ReturnType<typeof vi.fn>).mockResolvedValue(expected);

    const result = await attachToTab(1);
    expect(result.ok).toBe(false);
    expect(result.error).toContain('Cannot attach');
  });

  // ─── connectWithRetry ─────────────────────────────────────────────────────

  it('connectWithRetry resolves immediately when port stays connected', async () => {
    const port = {
      onDisconnect: { addListener: vi.fn() },
    };
    (chrome.runtime.connect as ReturnType<typeof vi.fn>).mockReturnValue(port);

    const promise = connectWithRetry();
    await vi.advanceTimersByTimeAsync(150);

    const result = await promise;
    expect(result).toBe(port);
  });

  it('connectWithRetry retries after immediate disconnect', async () => {
    const disconnectListeners: ((...args: unknown[]) => unknown)[] = [];
    const badPort = {
      onDisconnect: {
        addListener: vi.fn((fn: (...args: unknown[]) => unknown) => {
          disconnectListeners.push(fn);
          // Simulate immediate disconnect
          setTimeout(() => fn(), 0);
        }),
      },
    };
    const goodPort = {
      onDisconnect: { addListener: vi.fn() },
    };

    (chrome.runtime.connect as ReturnType<typeof vi.fn>)
      .mockReturnValueOnce(badPort)
      .mockReturnValue(goodPort);

    // Suppress lastError access
    Object.defineProperty(chrome.runtime, 'lastError', { get: () => undefined, configurable: true });

    const promise = connectWithRetry();

    // First attempt: bad port disconnects
    await vi.advanceTimersByTimeAsync(10);
    // Retry delay passes
    await vi.advanceTimersByTimeAsync(200);
    // Settle timeout for good port
    await vi.advanceTimersByTimeAsync(150);

    const result = await promise;
    expect(result).toBe(goodPort);
    expect(chrome.runtime.connect).toHaveBeenCalledTimes(2);
  });

  it('connectWithRetry rejects after max retries', async () => {
    const disconnectListeners: ((...args: unknown[]) => unknown)[] = [];
    const badPort = {
      onDisconnect: {
        addListener: vi.fn((fn: (...args: unknown[]) => unknown) => {
          disconnectListeners.push(fn);
          setTimeout(() => fn(), 0);
        }),
      },
    };

    (chrome.runtime.connect as ReturnType<typeof vi.fn>).mockReturnValue(badPort);
    Object.defineProperty(chrome.runtime, 'lastError', { get: () => undefined, configurable: true });

    const promise = connectWithRetry(3, 50);
    // Attach rejection handler immediately to avoid unhandled rejection warning
    const expectation = expect(promise).rejects.toThrow('Could not connect to recorder after retries');

    // Advance through all retries
    for (let i = 0; i < 5; i++) {
      await vi.advanceTimersByTimeAsync(200);
    }

    await expectation;
  });
});
