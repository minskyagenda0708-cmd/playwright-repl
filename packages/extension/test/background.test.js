import { describe, it, expect, vi, beforeEach } from "vitest";

describe("background.js recording handlers", () => {
  let startRecording, stopRecording, injectRecorder;

  beforeEach(async () => {
    vi.restoreAllMocks();
    vi.resetModules();

    // Mock chrome.scripting.executeScript
    chrome.scripting = {
      executeScript: vi.fn().mockResolvedValue([]),
    };

    // Mock chrome.tabs.onUpdated
    chrome.tabs.onUpdated = {
      addListener: vi.fn(),
      removeListener: vi.fn(),
    };

    // Mock chrome.tabs.onActivated
    chrome.tabs.onActivated = {
      addListener: vi.fn(),
    };

    // Mock chrome.tabs.get — must return a tab object with url
    chrome.tabs.get = vi.fn().mockResolvedValue({ id: 42, url: "https://example.com", title: "Example" });

    // Mock chrome.webNavigation.onCommitted
    chrome.webNavigation = {
      onCommitted: {
        addListener: vi.fn(),
        removeListener: vi.fn(),
      },
    };

    const bg = await import("../background.js");
    startRecording = bg.startRecording;
    stopRecording = bg.stopRecording;
    injectRecorder = bg.injectRecorder;
  });

  // ─── startRecording ─────────────────────────────────────────────────────

  it("injects recorder.js into the tab", async () => {
    const result = await startRecording(42);
    expect(result).toEqual({ ok: true });
    expect(chrome.scripting.executeScript).toHaveBeenCalledWith({
      target: { tabId: 42 },
      files: ["content/recorder.js"],
    });
  });

  it("adds tabs.onUpdated and webNavigation.onCommitted listeners", async () => {
    await startRecording(42);
    expect(chrome.tabs.onUpdated.addListener).toHaveBeenCalledWith(
      expect.any(Function),
    );
    expect(chrome.webNavigation.onCommitted.addListener).toHaveBeenCalledWith(
      expect.any(Function),
    );
  });

  it("returns error on injection failure", async () => {
    chrome.scripting.executeScript.mockRejectedValue(
      new Error("Cannot access chrome:// URLs"),
    );
    const result = await startRecording(42);
    expect(result).toEqual({ ok: false, error: "Cannot access chrome:// URLs" });
  });

  // ─── stopRecording ──────────────────────────────────────────────────────

  it("runs cleanup on the tab", async () => {
    await startRecording(42);
    const result = await stopRecording(42);
    expect(result).toEqual({ ok: true });
    // Second call to executeScript is the cleanup
    expect(chrome.scripting.executeScript).toHaveBeenCalledTimes(2);
    const cleanupCall = chrome.scripting.executeScript.mock.calls[1][0];
    expect(cleanupCall.target).toEqual({ tabId: 42 });
    expect(typeof cleanupCall.func).toBe("function");
  });

  it("removes tabs.onUpdated and webNavigation.onCommitted listeners", async () => {
    await startRecording(42);
    await stopRecording(42);
    expect(chrome.tabs.onUpdated.removeListener).toHaveBeenCalledWith(
      expect.any(Function),
    );
    expect(chrome.webNavigation.onCommitted.removeListener).toHaveBeenCalledWith(
      expect.any(Function),
    );
  });

  it("handles cleanup failure gracefully", async () => {
    await startRecording(42);
    // Make cleanup fail
    chrome.scripting.executeScript.mockRejectedValueOnce(
      new Error("Tab closed"),
    );
    const result = await stopRecording(42);
    // Should still return ok (non-fatal)
    expect(result).toEqual({ ok: true });
  });

  // ─── onTabUpdated re-injection ──────────────────────────────────────────

  it("re-injects recorder on tab navigation (status complete)", async () => {
    await startRecording(42);
    // Get the onUpdated listener that was registered
    const listener = chrome.tabs.onUpdated.addListener.mock.calls[0][0];
    chrome.scripting.executeScript.mockClear();
    // Simulate navigation complete
    listener(42, { status: "complete" });
    // Wait for the async injection
    await vi.waitFor(() => {
      expect(chrome.scripting.executeScript).toHaveBeenCalledWith({
        target: { tabId: 42 },
        files: ["content/recorder.js"],
      });
    });
  });

  it("does not re-inject for non-complete status", async () => {
    await startRecording(42);
    const listener = chrome.tabs.onUpdated.addListener.mock.calls[0][0];
    chrome.scripting.executeScript.mockClear();
    // Simulate loading status (not complete)
    listener(42, { status: "loading" });
    expect(chrome.scripting.executeScript).not.toHaveBeenCalled();
  });

  it("does not re-inject for a different tab", async () => {
    await startRecording(42);
    const listener = chrome.tabs.onUpdated.addListener.mock.calls[0][0];
    chrome.scripting.executeScript.mockClear();
    // Simulate navigation on a different tab
    listener(99, { status: "complete" });
    expect(chrome.scripting.executeScript).not.toHaveBeenCalled();
  });

  // ─── webNavigation.onCommitted — goto, go-back, go-forward ─────────

  it("emits goto when user types URL in address bar", async () => {
    chrome.runtime.sendMessage = vi.fn().mockResolvedValue(undefined);
    await startRecording(42);
    const navListener = chrome.webNavigation.onCommitted.addListener.mock.calls[0][0];

    navListener({
      tabId: 42, frameId: 0, url: "https://new-url.com",
      transitionType: "typed", transitionQualifiers: ["from_address_bar"],
    });

    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({
      type: "pw-recorded-command",
      command: "goto https://new-url.com",
    });
  });

  it("does not emit goto for link click navigations", async () => {
    chrome.runtime.sendMessage = vi.fn().mockResolvedValue(undefined);
    await startRecording(42);
    const navListener = chrome.webNavigation.onCommitted.addListener.mock.calls[0][0];

    navListener({
      tabId: 42, frameId: 0, url: "https://linked-page.com",
      transitionType: "link", transitionQualifiers: [],
    });

    expect(chrome.runtime.sendMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: "pw-recorded-command" }),
    );
  });

  it("does not emit for same URL", async () => {
    chrome.runtime.sendMessage = vi.fn().mockResolvedValue(undefined);
    await startRecording(42);
    const navListener = chrome.webNavigation.onCommitted.addListener.mock.calls[0][0];

    navListener({
      tabId: 42, frameId: 0, url: "https://example.com",
      transitionType: "typed", transitionQualifiers: [],
    });

    expect(chrome.runtime.sendMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: "pw-recorded-command" }),
    );
  });

  it("ignores navigations from a different tab", async () => {
    chrome.runtime.sendMessage = vi.fn().mockResolvedValue(undefined);
    await startRecording(42);
    const navListener = chrome.webNavigation.onCommitted.addListener.mock.calls[0][0];

    navListener({
      tabId: 99, frameId: 0, url: "https://other.com",
      transitionType: "typed", transitionQualifiers: [],
    });

    expect(chrome.runtime.sendMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: "pw-recorded-command" }),
    );
  });

  it("ignores subframe navigations", async () => {
    chrome.runtime.sendMessage = vi.fn().mockResolvedValue(undefined);
    await startRecording(42);
    const navListener = chrome.webNavigation.onCommitted.addListener.mock.calls[0][0];

    navListener({
      tabId: 42, frameId: 1, url: "https://iframe.com",
      transitionType: "typed", transitionQualifiers: [],
    });

    expect(chrome.runtime.sendMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: "pw-recorded-command" }),
    );
  });

  it("emits go-back on back button navigation", async () => {
    chrome.runtime.sendMessage = vi.fn().mockResolvedValue(undefined);
    await startRecording(42);
    const navListener = chrome.webNavigation.onCommitted.addListener.mock.calls[0][0];

    // First navigate somewhere via address bar
    navListener({
      tabId: 42, frameId: 0, url: "https://page2.com",
      transitionType: "typed", transitionQualifiers: ["from_address_bar"],
    });
    chrome.runtime.sendMessage.mockClear();

    // Then press back — URL goes back to example.com
    navListener({
      tabId: 42, frameId: 0, url: "https://example.com",
      transitionType: "link", transitionQualifiers: ["forward_back"],
    });

    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({
      type: "pw-recorded-command",
      command: "go-back",
    });
  });

  it("emits go-forward on forward button navigation", async () => {
    chrome.runtime.sendMessage = vi.fn().mockResolvedValue(undefined);
    await startRecording(42);
    const navListener = chrome.webNavigation.onCommitted.addListener.mock.calls[0][0];

    // Navigate somewhere
    navListener({
      tabId: 42, frameId: 0, url: "https://page2.com",
      transitionType: "typed", transitionQualifiers: ["from_address_bar"],
    });
    // Go back
    navListener({
      tabId: 42, frameId: 0, url: "https://example.com",
      transitionType: "link", transitionQualifiers: ["forward_back"],
    });
    chrome.runtime.sendMessage.mockClear();

    // Go forward — URL returns to page2.com
    navListener({
      tabId: 42, frameId: 0, url: "https://page2.com",
      transitionType: "link", transitionQualifiers: ["forward_back"],
    });

    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({
      type: "pw-recorded-command",
      command: "go-forward",
    });
  });

  // ─── injectRecorder ────────────────────────────────────────────────────

  it("calls chrome.scripting.executeScript with correct args", async () => {
    await injectRecorder(99);
    expect(chrome.scripting.executeScript).toHaveBeenCalledWith({
      target: { tabId: 99 },
      files: ["content/recorder.js"],
    });
  });
});
