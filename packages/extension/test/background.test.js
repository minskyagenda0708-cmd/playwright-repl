import { describe, it, expect, vi, beforeEach } from "vitest";
import { chrome } from "vitest-chrome/lib/index.esm.js";
import { readFileSync } from "fs";
import { resolve } from "path";
import { RelayConnection } from "../lib/relayConnection.js";

// Read the actual recorder.js file content for fetch mock
const recorderCode = readFileSync(
  resolve(import.meta.dirname, "..", "content", "recorder.js"),
  "utf-8"
);

// Mock WebSocket
class MockWebSocket {
  constructor(url) {
    this.url = url;
    this.readyState = 1; // OPEN
    this.send = vi.fn();
    this.close = vi.fn();
  }
}
MockWebSocket.OPEN = 1;
MockWebSocket.CLOSED = 3;
globalThis.WebSocket = MockWebSocket;

// Mock fetch
globalThis.fetch = vi.fn(() =>
  Promise.resolve({ text: () => Promise.resolve(recorderCode) })
);
chrome.runtime.getURL = vi.fn((path) => `chrome-extension://test/${path}`);

// ─── Import + reset helpers ─────────────────────────────────────────────────

let mod;
let getState, resetState;

beforeEach(async () => {
  vi.restoreAllMocks();

  globalThis.WebSocket = MockWebSocket;
  globalThis.fetch = vi.fn(() =>
    Promise.resolve({ text: () => Promise.resolve(recorderCode) })
  );
  globalThis.chrome = chrome;
  chrome.runtime.getURL = vi.fn((path) => `chrome-extension://test/${path}`);
  chrome.debugger.sendCommand.mockReset();
  chrome.debugger.attach.mockReset();
  chrome.debugger.detach.mockReset();
  chrome.debugger.onEvent.clearListeners();
  chrome.debugger.onDetach.clearListeners();
  chrome.runtime.onConnect.clearListeners();
  chrome.runtime.onMessage.clearListeners();

  vi.resetModules();
  mod = await import("../background.js");
  getState = mod._getState;
  resetState = mod._resetState;
});

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("handlePanelCommand", () => {
  it("sends HTTP POST to command server", async () => {
    globalThis.fetch = vi.fn(() =>
      Promise.resolve({
        json: () => Promise.resolve({ text: "Clicked", isError: false }),
      })
    );

    const result = await mod.handlePanelCommand("click e5");

    expect(globalThis.fetch).toHaveBeenCalledWith(
      "http://127.0.0.1:3000/run",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ raw: "click e5" }),
      }
    );
    expect(result.text).toBe("Clicked");
    expect(result.isError).toBe(false);
  });

  it("returns error when server is not reachable", async () => {
    globalThis.fetch = vi.fn(() =>
      Promise.reject(new Error("Connection refused"))
    );

    const result = await mod.handlePanelCommand("snapshot");

    expect(result.isError).toBe(true);
    expect(result.text).toContain("Not connected to server");
  });
});

describe("RelayConnection", () => {
  it("handles attachToTab by attaching debugger and returning real targetInfo", async () => {
    chrome.debugger.attach.mockResolvedValue(undefined);
    chrome.debugger.sendCommand.mockResolvedValue({
      targetInfo: {
        targetId: "ABC123",
        type: "page",
        title: "Example",
        url: "http://example.com",
        browserContextId: "CTX1",
      },
    });

    const mockWs = new MockWebSocket("ws://test");
    const relay = new RelayConnection(mockWs, 42);

    // Simulate server sending attachToTab
    await relay._onMessageAsync({
      data: JSON.stringify({ id: 1, method: "attachToTab", params: {} }),
    });

    // Should have attached to tab 42
    expect(chrome.debugger.attach).toHaveBeenCalledWith({ tabId: 42 }, "1.3");

    // Should have called Target.getTargetInfo via CDP
    expect(chrome.debugger.sendCommand).toHaveBeenCalledWith(
      { tabId: 42 },
      "Target.getTargetInfo"
    );

    // Should have sent response with real targetInfo
    expect(mockWs.send).toHaveBeenCalled();
    const response = JSON.parse(mockWs.send.mock.calls[0][0]);
    expect(response.id).toBe(1);
    expect(response.result.targetInfo.targetId).toBe("ABC123");
    expect(response.result.targetInfo.browserContextId).toBe("CTX1");
  });

  it("handles forwardCDPCommand with sessionId", async () => {
    chrome.debugger.sendCommand.mockResolvedValue({ result: { value: 42 } });

    const mockWs = new MockWebSocket("ws://test");
    const relay = new RelayConnection(mockWs, 10);

    await relay._onMessageAsync({
      data: JSON.stringify({
        id: 2,
        method: "forwardCDPCommand",
        params: {
          sessionId: "session-1",
          method: "Runtime.evaluate",
          params: { expression: "1+1" },
        },
      }),
    });

    // Should pass sessionId directly to chrome.debugger
    expect(chrome.debugger.sendCommand).toHaveBeenCalledWith(
      { tabId: 10, sessionId: "session-1" },
      "Runtime.evaluate",
      { expression: "1+1" }
    );

    const response = JSON.parse(mockWs.send.mock.calls[0][0]);
    expect(response.id).toBe(2);
    expect(response.result).toEqual({ result: { value: 42 } });
  });

  it("handles forwardCDPCommand without sessionId", async () => {
    chrome.debugger.sendCommand.mockResolvedValue({});

    const mockWs = new MockWebSocket("ws://test");
    const relay = new RelayConnection(mockWs, 10);

    await relay._onMessageAsync({
      data: JSON.stringify({
        id: 3,
        method: "forwardCDPCommand",
        params: { method: "Page.enable", params: {} },
      }),
    });

    expect(chrome.debugger.sendCommand).toHaveBeenCalledWith(
      { tabId: 10, sessionId: undefined },
      "Page.enable",
      {}
    );
  });

  it("forwards CDP events to server", () => {
    const mockWs = new MockWebSocket("ws://test");
    const relay = new RelayConnection(mockWs, 10);

    // Simulate chrome.debugger.onEvent
    chrome.debugger.onEvent.callListeners(
      { tabId: 10, sessionId: undefined },
      "Page.loadEventFired",
      { timestamp: 123 }
    );

    expect(mockWs.send).toHaveBeenCalled();
    const sent = JSON.parse(mockWs.send.mock.calls[0][0]);
    expect(sent.method).toBe("forwardCDPEvent");
    expect(sent.params.method).toBe("Page.loadEventFired");
    expect(sent.params.params.timestamp).toBe(123);
  });

  it("ignores CDP events from other tabs", () => {
    const mockWs = new MockWebSocket("ws://test");
    const relay = new RelayConnection(mockWs, 10);

    chrome.debugger.onEvent.callListeners(
      { tabId: 99 },
      "Page.loadEventFired",
      {}
    );

    expect(mockWs.send).not.toHaveBeenCalled();
  });

  it("handles command errors", async () => {
    chrome.debugger.attach.mockRejectedValue(new Error("Cannot attach"));

    const mockWs = new MockWebSocket("ws://test");
    const relay = new RelayConnection(mockWs, 10);

    await relay._onMessageAsync({
      data: JSON.stringify({ id: 1, method: "attachToTab", params: {} }),
    });

    const response = JSON.parse(mockWs.send.mock.calls[0][0]);
    expect(response.id).toBe(1);
    expect(response.error).toContain("Cannot attach");
  });

  it("cleans up on close", () => {
    chrome.debugger.detach.mockResolvedValue(undefined);
    const mockWs = new MockWebSocket("ws://test");
    const relay = new RelayConnection(mockWs, 10);
    mod._setActiveRelay(relay);
    relay.onclose = () => { mod._setActiveRelay(null); };

    relay.close("test");

    expect(mockWs.close).toHaveBeenCalledWith(1000, "test");
    expect(chrome.debugger.detach).toHaveBeenCalledWith({ tabId: 10 });
    expect(getState().activeRelay).toBeNull();
  });
});

describe("ensureAttached (recording)", () => {
  it("attaches debugger", async () => {
    chrome.debugger.attach.mockResolvedValue(undefined);

    await mod.ensureAttached(1);

    expect(chrome.debugger.attach).toHaveBeenCalledWith({ tabId: 1 }, "1.3");
  });

  it("skips attach if already attached to same tab", async () => {
    chrome.debugger.attach.mockResolvedValue(undefined);

    await mod.ensureAttached(1);
    chrome.debugger.attach.mockClear();

    await mod.ensureAttached(1);
    expect(chrome.debugger.attach).not.toHaveBeenCalled();
  });

  it("detaches previous tab before attaching new one", async () => {
    chrome.debugger.attach.mockResolvedValue(undefined);
    chrome.debugger.detach.mockResolvedValue(undefined);

    await mod.ensureAttached(1);
    await mod.ensureAttached(2);

    expect(chrome.debugger.detach).toHaveBeenCalledWith({ tabId: 1 });
    expect(chrome.debugger.attach).toHaveBeenCalledWith({ tabId: 2 }, "1.3");
  });
});

describe("startRecording", () => {
  it("returns success when recording starts", async () => {
    chrome.debugger.attach.mockResolvedValue(undefined);
    chrome.debugger.sendCommand.mockResolvedValue({ identifier: "script-1" });

    const result = await mod.startRecording(1);

    expect(result.success).toBe(true);
    expect(getState().recording[1]).toBe(true);
  });

  it("injects recorder.js via CDP", async () => {
    chrome.debugger.attach.mockResolvedValue(undefined);
    chrome.debugger.sendCommand.mockResolvedValue({ identifier: "script-1" });

    await mod.startRecording(1);

    const methods = chrome.debugger.sendCommand.mock.calls.map((c) => c[1]);
    expect(methods).toContain("Page.enable");
    expect(methods).toContain("Page.addScriptToEvaluateOnNewDocument");
    expect(methods).toContain("Runtime.evaluate");
  });

  it("returns error when attach fails", async () => {
    chrome.debugger.attach.mockRejectedValue(new Error("Cannot attach"));

    const result = await mod.startRecording(1);

    expect(result.success).toBe(false);
    expect(result.error).toContain("Cannot attach");
  });
});

describe("stopRecording", () => {
  it("returns success and clears recording state", async () => {
    chrome.debugger.attach.mockResolvedValue(undefined);
    chrome.debugger.sendCommand.mockResolvedValue(undefined);

    await mod.startRecording(1);
    expect(getState().recording[1]).toBe(true);

    const result = await mod.stopRecording(1);

    expect(result.success).toBe(true);
    expect(getState().recording[1]).toBe(false);
  });

  it("handles cleanup failure gracefully", async () => {
    chrome.debugger.sendCommand.mockRejectedValue(
      new Error("Context destroyed")
    );

    const result = await mod.stopRecording(1);
    expect(result.success).toBe(true);
  });
});

describe("panel port management", () => {
  it("registers panel port on connect", () => {
    const mockPort = {
      name: "pw-panel-42",
      onDisconnect: { addListener: vi.fn() },
    };

    chrome.runtime.onConnect.callListeners(mockPort);

    expect(getState().panelPorts[42]).toBe(mockPort);
  });

  it("removes panel port on disconnect", () => {
    const disconnectCallbacks = [];
    const mockPort = {
      name: "pw-panel-42",
      onDisconnect: {
        addListener: (cb) => disconnectCallbacks.push(cb),
      },
    };

    chrome.runtime.onConnect.callListeners(mockPort);
    expect(getState().panelPorts[42]).toBe(mockPort);

    disconnectCallbacks[0]();
    expect(getState().panelPorts[42]).toBeUndefined();
  });

  it("ignores non-panel ports", () => {
    const mockPort = {
      name: "other-port",
      onDisconnect: { addListener: vi.fn() },
    };

    chrome.runtime.onConnect.callListeners(mockPort);
    expect(Object.keys(getState().panelPorts)).toHaveLength(0);
  });
});
