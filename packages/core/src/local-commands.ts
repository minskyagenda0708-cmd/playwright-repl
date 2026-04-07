/**
 * Local command handlers — commands that run in Node.js instead of the
 * extension service worker. Used by CLI, MCP, and VS Code.
 */

import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { parseInput } from './parser.js';

// ─── Types ──────────────────────────────────────────────────────────────────

/* eslint-disable @typescript-eslint/no-explicit-any */
type BrowserContext = any;
type Page = any;
/* eslint-enable @typescript-eslint/no-explicit-any */

export interface LocalCommandResult {
  text: string;
  isError?: boolean;
}

// ─── Video commands ─────────────────────────────────────────────────────────

export function isVideoCommand(cmd: string): boolean {
  const trimmed = cmd.trim();
  return trimmed.startsWith('video-start') || trimmed === 'video-stop'
    || trimmed.startsWith('video-chapter ') || trimmed === 'video-chapter';
}

let videoPath: string | null = null;

export async function handleVideoCommand(cmd: string, context: BrowserContext): Promise<LocalCommandResult> {
  const pages = context.pages();
  const page: Page = pages[pages.length - 1];
  if (!page) return { text: 'No page available.', isError: true };

  const trimmed = cmd.trim();

  if (trimmed.startsWith('video-start')) {
    const args = parseInput(trimmed);
    const sizeStr = args?.size as string | undefined;
    const size = sizeStr ? { width: parseInt(sizeStr.split('x')[0]), height: parseInt(sizeStr.split('x')[1]) } : undefined;
    const outDir = path.join(os.homedir(), 'pw-videos');
    fs.mkdirSync(outDir, { recursive: true });
    const outPath = path.join(outDir, `pw-video-${Date.now()}.webm`);
    videoPath = outPath;
    await page.screencast.start({ path: outPath, size });
    return { text: `Recording started → ${outPath}` };
  }

  if (trimmed === 'video-stop') {
    await page.screencast.stop();
    const msg = videoPath ? `Recording stopped → ${videoPath}` : 'Recording stopped.';
    videoPath = null;
    return { text: msg };
  }

  if (trimmed.startsWith('video-chapter')) {
    const args = parseInput(trimmed);
    const title = args?._?.slice(1).join(' ') || '';
    const description = args?.description as string | undefined;
    const duration = args?.duration ? parseInt(String(args.duration)) : undefined;
    await page.screencast.showChapter(title, { description, duration });
    return { text: `Chapter "${title}" added.` };
  }

  return { text: `Unknown video command: ${trimmed}`, isError: true };
}

// ─── Tracing commands ──────────────────────────────────────────────────────

export function isTracingCommand(cmd: string): boolean {
  const trimmed = cmd.trim();
  return trimmed === 'tracing-start' || trimmed === 'tracing-stop';
}

let tracingActive = false;

export async function handleTracingCommand(cmd: string, context: BrowserContext): Promise<LocalCommandResult> {
  const trimmed = cmd.trim();

  if (trimmed === 'tracing-start') {
    if (tracingActive) return { text: 'Tracing is already active.', isError: true };
    await context.tracing.start({ screenshots: true, snapshots: true });
    tracingActive = true;
    return { text: 'Tracing started' };
  }

  if (trimmed === 'tracing-stop') {
    if (!tracingActive) return { text: 'No active tracing session.', isError: true };
    const outDir = path.join(os.homedir(), 'pw-traces');
    fs.mkdirSync(outDir, { recursive: true });
    const d = new Date();
    const timestamp = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}T${String(d.getHours()).padStart(2, '0')}-${String(d.getMinutes()).padStart(2, '0')}-${String(d.getSeconds()).padStart(2, '0')}`;
    const outPath = path.join(outDir, `trace-${timestamp}.zip`);
    await context.tracing.stop({ path: outPath });
    tracingActive = false;
    const size = fs.statSync(outPath).size;
    const sizeStr = size < 1024 * 1024 ? `${(size / 1024).toFixed(0)} KB` : `${(size / (1024 * 1024)).toFixed(1)} MB`;
    return { text: `Trace saved to ${outPath} (${sizeStr})` };
  }

  return { text: `Unknown tracing command: ${trimmed}`, isError: true };
}

// ─── Local command dispatcher ───────────────────────────────────────────────

export function isLocalCommand(cmd: string): boolean {
  return isVideoCommand(cmd) || isTracingCommand(cmd);
}

/**
 * Try to handle a command locally. Returns null if not a local command.
 * Requires a BrowserContext (from EvaluateConnection.context).
 */
export async function handleLocalCommand(cmd: string, context: BrowserContext | null): Promise<LocalCommandResult | null> {
  if (!isLocalCommand(cmd)) return null;
  // No context → let the command fall through to the bridge (extension handles video via tabCapture)
  if (!context) return null;

  if (isVideoCommand(cmd)) return handleVideoCommand(cmd, context);
  if (isTracingCommand(cmd)) return handleTracingCommand(cmd, context);

  return null;
}
