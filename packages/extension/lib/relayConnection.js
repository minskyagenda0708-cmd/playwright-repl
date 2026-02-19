/**
 * RelayConnection — CDP relay over WebSocket, matching Playwright's MCP Bridge pattern.
 *
 * Bridges chrome.debugger ↔ WebSocket so Playwright can control a browser tab
 * via connectOverCDP through the CommandServer relay.
 *
 * Protocol (3 message types):
 *   Server → Extension:
 *     { id, method: "attachToTab", params: {} }
 *       → attach chrome.debugger, return real targetInfo from CDP
 *     { id, method: "forwardCDPCommand", params: { sessionId, method, params } }
 *       → forward to chrome.debugger with sessionId support
 *   Extension → Server:
 *     { method: "forwardCDPEvent", params: { sessionId, method, params } }
 *       → forward chrome.debugger.onEvent back to server
 */

export class RelayConnection {
  constructor(ws, tabId) {
    this._ws = ws;
    this._debuggee = { tabId };
    this._closed = false;

    this._eventListener = (source, method, params) => this._onDebuggerEvent(source, method, params);
    this._detachListener = (source, reason) => this._onDebuggerDetach(source, reason);
    chrome.debugger.onEvent.addListener(this._eventListener);
    chrome.debugger.onDetach.addListener(this._detachListener);

    this._ws.onmessage = (event) => this._onMessage(event);
    this._ws.onclose = () => this._onClose();

    this.onclose = null;
  }

  close(message) {
    this._ws.close(1000, message);
    this._onClose();
  }

  _onClose() {
    if (this._closed) return;
    this._closed = true;
    chrome.debugger.onEvent.removeListener(this._eventListener);
    chrome.debugger.onDetach.removeListener(this._detachListener);
    chrome.debugger.detach(this._debuggee).catch(() => {});
    this.onclose?.();
  }

  // ─── CDP events from browser → server ─────────────────────────────────

  _onDebuggerEvent(source, method, params) {
    if (source.tabId !== this._debuggee.tabId) return;
    this._sendMessage({
      method: 'forwardCDPEvent',
      params: {
        sessionId: source.sessionId,
        method,
        params,
      },
    });
  }

  _onDebuggerDetach(source, reason) {
    if (source.tabId !== this._debuggee.tabId) return;
    this.close(`Debugger detached: ${reason}`);
  }

  // ─── Messages from server → extension ─────────────────────────────────

  _onMessage(event) {
    this._onMessageAsync(event).catch(e => console.error('[relay] Error:', e));
  }

  async _onMessageAsync(event) {
    let message;
    try {
      message = JSON.parse(event.data);
    } catch (e) {
      this._sendMessage({ error: `Parse error: ${e.message}` });
      return;
    }

    const response = { id: message.id };
    try {
      response.result = await this._handleCommand(message);
    } catch (e) {
      response.error = e.message;
    }
    this._sendMessage(response);
  }

  async _handleCommand(message) {
    if (message.method === 'attachToTab') {
      // Attach chrome.debugger and get REAL targetInfo from CDP
      await chrome.debugger.attach(this._debuggee, '1.3');
      const result = await chrome.debugger.sendCommand(this._debuggee, 'Target.getTargetInfo');
      return { targetInfo: result?.targetInfo };
    }

    if (message.method === 'forwardCDPCommand') {
      const { sessionId, method, params } = message.params;
      // Pass sessionId directly to chrome.debugger (key fix from MCP Bridge)
      const debuggerSession = { ...this._debuggee, sessionId };
      return await chrome.debugger.sendCommand(debuggerSession, method, params || {});
    }
  }

  _sendMessage(message) {
    if (this._ws.readyState === WebSocket.OPEN)
      this._ws.send(JSON.stringify(message));
  }
}
