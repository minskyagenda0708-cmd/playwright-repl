import * as vscode from 'vscode';
import type { BrowserManager } from './browser.js';

// ─── ANSI helpers ──────────────────────────────────────────────────────────

const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const DIM = '\x1b[2m';
const RESET = '\x1b[0m';

// ─── PlaywrightRepl ────────────────────────────────────────────────────────

export class PlaywrightRepl {
  private _terminal: vscode.Terminal | undefined;
  private _writeEmitter = new vscode.EventEmitter<string>();
  private _closeEmitter = new vscode.EventEmitter<number | void>();
  private _buffer = '';
  private _history: string[] = [];
  private _historyIndex = -1;
  private _browserManager: BrowserManager | undefined;
  private _processing = false;
  disposed = false;

  constructor(browserManager?: BrowserManager) {
    this._browserManager = browserManager;
  }

  setBrowserManager(browserManager: BrowserManager) {
    this._browserManager = browserManager;
  }

  show() {
    if (this._terminal) {
      this._terminal.show();
      return;
    }

    const pty: vscode.Pseudoterminal = {
      onDidWrite: this._writeEmitter.event,
      onDidClose: this._closeEmitter.event,
      open: () => this._onOpen(),
      close: () => this._onClose(),
      handleInput: (data: string) => this._onInput(data),
    };

    this._terminal = vscode.window.createTerminal({
      name: 'Playwright REPL',
      pty,
    });
    this._terminal.show();
  }

  private _onOpen() {
    this._writeEmitter.fire(`${GREEN}Playwright IDE REPL${RESET}\r\n`);
    this._writeEmitter.fire(`${DIM}Type Playwright commands. Use ↑↓ for history.${RESET}\r\n`);
    this._prompt();
  }

  private _onClose() {
    this.disposed = true;
    this._terminal = undefined;
  }

  private _prompt() {
    this._writeEmitter.fire(`${GREEN}>${RESET} `);
  }

  private async _onInput(data: string) {
    // Enter
    if (data === '\r') {
      this._writeEmitter.fire('\r\n');
      const command = this._buffer.trim();
      this._buffer = '';
      this._historyIndex = -1;

      if (command) {
        this._history.unshift(command);
        if (this._history.length > 100) this._history.pop();
        await this._execute(command);
      }
      this._prompt();
      return;
    }

    // Backspace
    if (data === '\x7f') {
      if (this._buffer.length > 0) {
        this._buffer = this._buffer.slice(0, -1);
        this._writeEmitter.fire('\b \b');
      }
      return;
    }

    // Escape sequences (arrows)
    if (data.startsWith('\x1b[')) {
      const code = data.slice(2);
      // Up arrow — history back
      if (code === 'A') {
        if (this._historyIndex < this._history.length - 1) {
          this._historyIndex++;
          this._replaceLine(this._history[this._historyIndex]!);
        }
        return;
      }
      // Down arrow — history forward
      if (code === 'B') {
        if (this._historyIndex > 0) {
          this._historyIndex--;
          this._replaceLine(this._history[this._historyIndex]!);
        } else if (this._historyIndex === 0) {
          this._historyIndex = -1;
          this._replaceLine('');
        }
        return;
      }
      // Ignore left/right for now
      return;
    }

    // Ctrl+C
    if (data === '\x03') {
      this._buffer = '';
      this._writeEmitter.fire('^C\r\n');
      this._prompt();
      return;
    }

    // Ctrl+D — close
    if (data === '\x04') {
      this._closeEmitter.fire();
      return;
    }

    // Regular character
    this._buffer += data;
    this._writeEmitter.fire(data);
  }

  private _replaceLine(text: string) {
    // Clear current line, rewrite
    const clearLen = this._buffer.length;
    this._writeEmitter.fire('\b'.repeat(clearLen) + ' '.repeat(clearLen) + '\b'.repeat(clearLen));
    this._buffer = text;
    this._writeEmitter.fire(text);
  }

  private _write(text: string) {
    const lines = text.split('\n');
    for (const line of lines) {
      this._writeEmitter.fire(`${line}\r\n`);
    }
  }

  private _handleLocal(command: string): boolean {
    if (command === 'help' || command === '.help') {
      this._write(`${DIM}Keyword commands:${RESET}`);
      this._write('  snapshot, goto, click, fill, press, hover, select, check, eval, ...');
      this._write(`${DIM}JavaScript:${RESET}`);
      this._write('  await page.title(), page.locator("h1").textContent(), ...');
      this._write(`${DIM}Type "help <command>" for details. Use eval for browser-side JS.${RESET}`);
      return true;
    }
    if (command === '.clear') {
      this._writeEmitter.fire('\x1b[2J\x1b[H');
      return true;
    }
    if (command === '.history') {
      this._write(this._history.length ? this._history.slice().reverse().join('\n') : '(no history)');
      return true;
    }
    if (command === '.history clear') {
      this._history.length = 0;
      this._write('History cleared.');
      return true;
    }
    return false;
  }

  private async _execute(command: string) {
    if (this._processing) return;
    this._processing = true;

    if (this._handleLocal(command)) {
      this._processing = false;
      return;
    }

    if (!this._browserManager?.isRunning()) {
      this._writeEmitter.fire(`${RED}Browser not running. Use Ctrl+Shift+P → "Playwright IDE: Launch Browser" first.${RESET}\r\n`);
      this._processing = false;
      return;
    }

    try {
      const result = await this._browserManager.runCommand(command);
      if (!result.text) {
        this._processing = false;
        return;
      }
      // Strip markdown section headers (### Result, ### Error, etc.)
      const text = result.text.replace(/^### \w[\w ]*\n/gm, '');
      const color = result.isError ? RED : '';
      const lines = text.split('\n');
      for (const line of lines) {
        this._writeEmitter.fire(`${color}${line}${color ? RESET : ''}\r\n`);
      }
    } catch (err: unknown) {
      this._writeEmitter.fire(`${RED}Error: ${(err as Error).message}${RESET}\r\n`);
    }

    this._processing = false;
  }
}
