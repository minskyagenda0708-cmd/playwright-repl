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
});
