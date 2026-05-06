// @ts-nocheck
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { withRecording } from '../src/recording.js';
import type { Runner } from '../src/types.js';

const SAMPLE_SNAPSHOT = `\
- document [ref=e1]:
  - heading "Welcome" [level=2] [ref=e2]
  - navigation "Main":
    - link "Home" [ref=e3]
    - link "About" [ref=e4]
  - main:
    - textbox "Email" [ref=e5]
    - button "Sign in" [ref=e6]
`;

function createMockRunner(): Runner {
  return {
    async runCommand(command: string) {
      const cmd = command.trim().split(/\s+/)[0].toLowerCase();
      if (cmd === 'snapshot') {
        return { text: SAMPLE_SNAPSHOT, isError: false };
      }
      if (cmd === 'click' || cmd === 'fill' || cmd === 'goto') {
        // Simulate auto-snapshot appended to update commands
        return {
          text: `### Result\nDone\n### Snapshot\n${SAMPLE_SNAPSHOT}`,
          isError: false,
        };
      }
      return { text: 'Done', isError: false };
    },
    async runScript(script: string, language: 'pw' | 'javascript') {
      return { text: 'Script done', isError: false };
    },
  };
}

describe('withRecording', () => {
  let tmpDir: string;
  let runner: Runner;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-rec-test-'));
    runner = withRecording(createMockRunner());
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // ── Recording lifecycle ───────────────────────────────────────

  it('start-recording returns success', async () => {
    const result = await runner.runCommand(`start-recording ${path.join(tmpDir, 'test.pw')}`);
    expect(result.isError).toBe(false);
    expect(result.text).toContain('Recording started');
    expect(result.text).toContain('test.pw');
  });

  it('stop-recording saves file', async () => {
    const file = path.join(tmpDir, 'test.pw');
    await runner.runCommand(`start-recording ${file}`);
    await runner.runCommand('snapshot');
    await runner.runCommand('click e6');
    const result = await runner.runCommand('stop-recording');
    expect(result.isError).toBe(false);
    expect(result.text).toContain('Recording saved');
    expect(result.text).toContain('2 commands');

    const content = fs.readFileSync(file, 'utf-8');
    expect(content).toContain('snapshot');
    expect(content).toContain('click button "Sign in"');
  });

  it('pause-recording toggles pause', async () => {
    await runner.runCommand(`start-recording ${path.join(tmpDir, 'test.pw')}`);
    const r1 = await runner.runCommand('pause-recording');
    expect(r1.text).toBe('Recording paused');
    const r2 = await runner.runCommand('pause-recording');
    expect(r2.text).toBe('Recording resumed');
  });

  it('discard-recording clears state', async () => {
    const file = path.join(tmpDir, 'test.pw');
    await runner.runCommand(`start-recording ${file}`);
    await runner.runCommand('snapshot');
    const result = await runner.runCommand('discard-recording');
    expect(result.isError).toBe(false);
    expect(result.text).toBe('Recording discarded');
    expect(fs.existsSync(file)).toBe(false);
  });

  // ── Error cases ───────────────────────────────────────────────

  it('stop-recording errors when not recording', async () => {
    const result = await runner.runCommand('stop-recording');
    expect(result.isError).toBe(true);
    expect(result.text).toContain('Not recording');
  });

  it('start-recording errors when already recording', async () => {
    await runner.runCommand(`start-recording ${path.join(tmpDir, 'a.pw')}`);
    const result = await runner.runCommand(`start-recording ${path.join(tmpDir, 'b.pw')}`);
    expect(result.isError).toBe(true);
    expect(result.text).toContain('Already recording');
  });

  it('pause-recording errors when not recording', async () => {
    const result = await runner.runCommand('pause-recording');
    expect(result.isError).toBe(true);
  });

  it('discard-recording errors when not recording', async () => {
    const result = await runner.runCommand('discard-recording');
    expect(result.isError).toBe(true);
  });

  // ── Ref resolution from auto-snapshot ─────────────────────────

  it('resolves refs using auto-snapshot from update commands', async () => {
    const file = path.join(tmpDir, 'test.pw');
    await runner.runCommand(`start-recording ${file}`);
    // First command is an update command — auto-snapshot is appended
    await runner.runCommand('goto https://example.com');
    // Now refs from the auto-snapshot should be available
    await runner.runCommand('click e6');
    await runner.runCommand('fill e5 hello');
    await runner.runCommand('stop-recording');

    const content = fs.readFileSync(file, 'utf-8');
    expect(content).toContain('goto https://example.com');
    expect(content).toContain('click button "Sign in"');
    expect(content).toContain('fill textbox "Email" hello');
  });

  it('resolves refs using explicit snapshot', async () => {
    const file = path.join(tmpDir, 'test.pw');
    await runner.runCommand(`start-recording ${file}`);
    await runner.runCommand('snapshot');
    await runner.runCommand('click e6');
    await runner.runCommand('stop-recording');

    const content = fs.readFileSync(file, 'utf-8');
    expect(content).toContain('click button "Sign in"');
  });

  // ── Recording commands are not recorded ───────────────────────

  it('recording commands are not included in output', async () => {
    const file = path.join(tmpDir, 'test.pw');
    await runner.runCommand(`start-recording ${file}`);
    await runner.runCommand('snapshot');
    await runner.runCommand('pause-recording');
    await runner.runCommand('pause-recording');
    await runner.runCommand('click e6');
    await runner.runCommand('stop-recording');

    const content = fs.readFileSync(file, 'utf-8');
    expect(content).not.toContain('start-recording');
    expect(content).not.toContain('stop-recording');
    expect(content).not.toContain('pause-recording');
    expect(content).toContain('snapshot');
    expect(content).toContain('click button "Sign in"');
  });

  // ── Failed commands are not recorded ──────────────────────────

  it('does not record failed commands', async () => {
    const mockRunner = createMockRunner();
    const origRunCommand = mockRunner.runCommand;
    mockRunner.runCommand = async (cmd) => {
      if (cmd.includes('bad-command')) return { text: 'Unknown', isError: true };
      return origRunCommand(cmd);
    };
    const r = withRecording(mockRunner);

    const file = path.join(tmpDir, 'test.pw');
    await r.runCommand(`start-recording ${file}`);
    await r.runCommand('snapshot');
    await r.runCommand('bad-command');
    await r.runCommand('click e6');
    await r.runCommand('stop-recording');

    const content = fs.readFileSync(file, 'utf-8');
    expect(content).not.toContain('bad-command');
    expect(content).toContain('click button "Sign in"');
  });

  // ── runScript passes through ──────────────────────────────────

  it('runScript delegates to inner runner', async () => {
    const result = await runner.runScript('snapshot\nclick e5', 'pw');
    expect(result.text).toBe('Script done');
  });
});
