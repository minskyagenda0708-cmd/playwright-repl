// ─── Video Capture (offscreen document) ─────────────────────────────────────
// Offscreen document for tabCapture video recording.
// Service workers can't access getUserMedia/MediaRecorder — this document provides that context.

let recorder: MediaRecorder | undefined;
let recordedChunks: Blob[] = [];
let lastBlobUrl: string | null = null;

function revokeLastBlob() {
  if (lastBlobUrl) {
    URL.revokeObjectURL(lastBlobUrl);
    lastBlobUrl = null;
  }
}

async function startVideoCapture(streamId: string) {
  if (recorder?.state === 'recording') {
    throw new Error('Already recording');
  }
  revokeLastBlob();

  const constraints = {
    audio: { mandatory: { chromeMediaSource: 'tab', chromeMediaSourceId: streamId } },
    video: { mandatory: { chromeMediaSource: 'tab', chromeMediaSourceId: streamId } },
  } as unknown as MediaStreamConstraints;
  const media = await navigator.mediaDevices.getUserMedia(constraints);

  // Continue playing captured audio to the user
  const output = new AudioContext();
  const source = output.createMediaStreamSource(media);
  source.connect(output.destination);

  recorder = new MediaRecorder(media, { mimeType: 'video/webm' });
  recorder.ondataavailable = (event) => recordedChunks.push(event.data);
  recorder.start();
}

async function stopVideoCapture(): Promise<{ blobUrl: string; size: number }> {
  if (!recorder || recorder.state !== 'recording') {
    throw new Error('Not recording');
  }

  return new Promise<{ blobUrl: string; size: number }>((resolve) => {
    recorder!.onstop = () => {
      const blob = new Blob(recordedChunks, { type: 'video/webm' });
      const blobUrl = URL.createObjectURL(blob);
      lastBlobUrl = blobUrl;
      const size = blob.size;

      recorder = undefined;
      recordedChunks = [];

      resolve({ blobUrl, size });
    };

    recorder!.stop();
    recorder!.stream.getTracks().forEach((t) => t.stop());
  });
}

// ─── CDP Relay WebSocket ────────────────────────────────────────────────────
// Connects to the CDPRelayServer started by CLI --connect or MCP --relay.
// Translates between the relay protocol and chrome.runtime messages.

let relayWs: WebSocket | null = null;
let relayPort = 9877;
let relayRetryCount = 0;
let relayReconnectTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleRelayReconnect() {
  if (relayReconnectTimer) clearTimeout(relayReconnectTimer);
  const delay = Math.min(3000 * Math.pow(2, relayRetryCount), 30000);
  relayReconnectTimer = setTimeout(() => connectRelay(relayPort), delay);
  relayRetryCount++;
}

function connectRelay(port: number) {
  if (relayWs && relayWs.readyState === WebSocket.OPEN) return;
  if (relayWs && relayWs.readyState === WebSocket.CONNECTING) {
    relayWs.onclose = null;
    relayWs.onerror = null;
    relayWs.close();
    relayWs = null;
  }

  const url = `ws://127.0.0.1:${port}/relay`;
  try {
    relayWs = new WebSocket(url);

    relayWs.onopen = () => {
      console.debug(`[pw-repl] CDP relay connected to ${url}`);
      relayRetryCount = 0;
    };

    relayWs.onmessage = async (e) => {
      const msg = JSON.parse(e.data as string) as { id: number; method: string; params: unknown };

      try {
        const result = await chrome.runtime.sendMessage({
          type: msg.method === 'attachToTab' ? 'cdp-attach-tab' : 'cdp-command',
          ...(msg.method === 'attachToTab' ? {} : (msg.params as Record<string, unknown>)),
        });

        if (relayWs?.readyState === WebSocket.OPEN) {
          if (result?.error) relayWs.send(JSON.stringify({ id: msg.id, error: result.error }));
          else relayWs.send(JSON.stringify({ id: msg.id, result: result?.result ?? {} }));
        }
      } catch (err) {
        if (relayWs?.readyState === WebSocket.OPEN) {
          relayWs.send(JSON.stringify({ id: msg.id, error: String(err) }));
        }
      }
    };

    relayWs.onclose = () => {
      console.debug('[pw-repl] CDP relay disconnected');
      relayWs = null;
      scheduleRelayReconnect();
    };

    relayWs.onerror = () => {};
  } catch {
    scheduleRelayReconnect();
  }
}

// Periodic health check — reconnect if relay WebSocket is not open
setInterval(() => {
  if (relayPort && (!relayWs || relayWs.readyState !== WebSocket.OPEN)) {
    connectRelay(relayPort);
  }
}, 10000);

// Auto-connect on load
chrome.runtime.sendMessage({ type: 'get-relay-port' }).then((port: number) => {
  relayPort = port || 9877;
  connectRelay(relayPort);
}).catch(() => {
  connectRelay(relayPort);
});

// ─── Message routing from background SW ─────────────────────────────────────

chrome.runtime.onMessage.addListener((msg: { type: string; streamId?: string }, _sender, sendResponse) => {
  if (msg.type === 'video-capture-start') {
    startVideoCapture(msg.streamId as string)
      .then(() => sendResponse({ ok: true }))
      .catch((e: Error) => sendResponse({ ok: false, error: e.message }));
    return true;
  }
  if (msg.type === 'video-capture-stop') {
    stopVideoCapture()
      .then(({ blobUrl, size }) => sendResponse({ ok: true, blobUrl, size }))
      .catch((e: Error) => sendResponse({ ok: false, error: e.message }));
    return true;
  }
  if (msg.type === 'video-revoke') {
    revokeLastBlob();
  }

  // Relay port changed — reconnect with new port
  if (msg.type === 'relay-port-changed') {
    relayPort = (msg as { type: string; port: number }).port;
    if (relayReconnectTimer) clearTimeout(relayReconnectTimer);
    relayRetryCount = 0;
    if (relayWs) { relayWs.onclose = null; relayWs.close(); relayWs = null; }
    connectRelay(relayPort);
  }

  // Forward chrome.debugger events from background → relay WebSocket
  if (msg.type === 'cdp-event') {
    const { method, params, sessionId } = msg as { type: string; method: string; params?: unknown; sessionId?: string };
    if (relayWs?.readyState === WebSocket.OPEN) {
      relayWs.send(JSON.stringify({ method: 'forwardCDPEvent', params: { method, params, sessionId } }));
    }
  }
});
