/**
 * Recording wrapper for MCP runners.
 *
 * Wraps a Runner to intercept start-recording/stop-recording/pause-recording/
 * discard-recording commands and record all other commands with ref-to-locator
 * resolution using snapshot data from auto-snapshot results.
 */

import { SessionRecorder } from '@playwright-repl/core';
import type { EngineResult } from '@playwright-repl/core';
import type { Runner } from './types.js';

const RECORDING_COMMANDS = new Set([
  'start-recording', 'stop-recording', 'pause-recording', 'discard-recording',
]);

/** Extract the snapshot YAML from an auto-snapshot result (### Snapshot\n...) */
function extractSnapshot(text: string): string | null {
  const marker = '### Snapshot\n';
  const idx = text.indexOf(marker);
  if (idx === -1) return null;
  return text.slice(idx + marker.length);
}

/**
 * Wrap a runner with recording support.
 * Returns a new runner that handles recording commands locally and
 * records + resolves refs for all other commands.
 */
export function withRecording(inner: Runner): Runner {
  const recorder = new SessionRecorder();

  return {
    async runCommand(command: string): Promise<EngineResult> {
      const trimmed = command.trim();
      const cmdName = trimmed.split(/\s+/)[0].toLowerCase();

      // ── Recording commands — handled locally ──────────────────
      if (RECORDING_COMMANDS.has(cmdName)) {
        if (cmdName === 'start-recording') {
          if (recorder.recording) {
            return { text: 'Already recording. Use stop-recording or discard-recording first.', isError: true };
          }
          const filename = trimmed.split(/\s+/)[1] || undefined;
          const file = recorder.start(filename);
          return { text: `Recording started → ${file}`, isError: false };
        }

        if (cmdName === 'stop-recording') {
          if (!recorder.recording) {
            return { text: 'Not recording. Use start-recording first.', isError: true };
          }
          const { filename, count } = recorder.save();
          return { text: `Recording saved: ${filename} (${count} commands)`, isError: false };
        }

        if (cmdName === 'pause-recording') {
          if (!recorder.recording) {
            return { text: 'Not recording.', isError: true };
          }
          const paused = recorder.pause();
          return { text: paused ? 'Recording paused' : 'Recording resumed', isError: false };
        }

        if (cmdName === 'discard-recording') {
          if (!recorder.recording) {
            return { text: 'Not recording.', isError: true };
          }
          recorder.discard();
          return { text: 'Recording discarded', isError: false };
        }
      }

      // ── Regular command — execute, then record ────────────────
      const result = await inner.runCommand(command);

      if (recorder.recording && !result.isError) {
        // Feed snapshot to recorder for ref-to-locator resolution
        if (result.text) {
          // Explicit snapshot command
          if (cmdName === 'snapshot' || cmdName === 'snap' || cmdName === 's') {
            recorder.setSnapshot(result.text);
          }
          // Auto-snapshot from update commands (### Snapshot\n...)
          const snap = extractSnapshot(result.text);
          if (snap) {
            recorder.setSnapshot(snap);
          }
        }

        recorder.record(trimmed);
      }

      return result;
    },

    async runScript(script: string, language: 'pw' | 'javascript'): Promise<EngineResult> {
      return inner.runScript(script, language);
    },
  };
}
