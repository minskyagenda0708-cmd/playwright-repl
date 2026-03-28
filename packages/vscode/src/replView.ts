/**
 * REPL Webview — interactive command panel for Playwright REPL.
 */

import { DisposableBase } from './disposableBase';
import { getNonce, html } from './utils';
import type { BrowserManager } from './browser';
import * as vscodeTypes from './vscodeTypes';

export class ReplView extends DisposableBase implements vscodeTypes.WebviewViewProvider {
  private _vscode: vscodeTypes.VSCode;
  private _view: vscodeTypes.WebviewView | undefined;
  private _extensionUri: vscodeTypes.Uri;
  private _browserManager: BrowserManager | undefined;
  private _history: string[] = [];

  constructor(vscode: vscodeTypes.VSCode, extensionUri: vscodeTypes.Uri) {
    super();
    this._vscode = vscode;
    this._extensionUri = extensionUri;
    this._disposables = [
      vscode.window.registerWebviewViewProvider('playwright-repl.replView', this, {
        webviewOptions: { retainContextWhenHidden: true },
      }),
    ];
  }

  setBrowserManager(browserManager: BrowserManager) {
    this._browserManager = browserManager;
  }

  resolveWebviewView(webviewView: vscodeTypes.WebviewView) {
    this._view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this._extensionUri],
    };

    webviewView.webview.html = htmlForWebview(this._vscode, this._extensionUri, webviewView.webview);

    this._disposables.push(webviewView.webview.onDidReceiveMessage(async data => {
      if (data.method === 'execute') {
        await this._execute(data.params.command);
      } else if (data.method === 'getHistory') {
        void this._view?.webview.postMessage({ method: 'history', params: { history: this._history } });
      }
    }));

    // Send welcome message
    this._appendOutput('Playwright REPL\nType commands. Use ↑↓ for history.\n', 'info');
  }

  private async _execute(command: string) {
    if (!command.trim()) return;

    // Add to history
    this._history.unshift(command);
    if (this._history.length > 100) this._history.pop();

    // Handle local commands
    if (this._handleLocal(command))
      return;

    if (!this._browserManager?.isRunning()) {
      this._appendOutput('Browser not running. Use Ctrl+Shift+P → "Playwright REPL: Launch Browser" first.', 'error');
      return;
    }

    this._setProcessing(true);
    try {
      const result = await this._browserManager.runCommand(command) as { text?: string; isError?: boolean; image?: string };
      if (result.image) {
        this._appendImage(result.image);
      }
      if (result.text) {
        // Strip markdown section headers
        const text = result.text.replace(/^### \w[\w ]*\n/gm, '');
        this._appendOutput(text, result.isError ? 'error' : 'output');
      }
      if (!result.text && !result.image) {
        this._appendOutput('Done.', 'info');
      }
    } catch (err: unknown) {
      this._appendOutput(`Error: ${(err as Error).message}`, 'error');
    }
    this._setProcessing(false);
  }

  private _handleLocal(command: string): boolean {
    if (command === 'help' || command === '.help') {
      this._appendOutput(
        'Keyword commands:\n  snapshot, goto, click, fill, press, hover, select, check, eval, ...\n' +
        'JavaScript:\n  await page.title(), page.locator("h1").textContent(), ...\n' +
        'Type "help <command>" for details. Use eval for browser-side JS.',
        'info',
      );
      return true;
    }
    if (command === '.clear') {
      void this._view?.webview.postMessage({ method: 'clear' });
      return true;
    }
    if (command === '.history') {
      this._appendOutput(this._history.length ? this._history.slice().reverse().join('\n') : '(no history)', 'info');
      return true;
    }
    if (command === '.history clear') {
      this._history.length = 0;
      this._appendOutput('History cleared.', 'info');
      return true;
    }
    return false;
  }

  private _appendOutput(text: string, type: 'output' | 'error' | 'info') {
    void this._view?.webview.postMessage({ method: 'output', params: { text, type } });
  }

  private _appendImage(dataUri: string) {
    void this._view?.webview.postMessage({ method: 'image', params: { dataUri } });
  }

  private _setProcessing(processing: boolean) {
    void this._view?.webview.postMessage({ method: 'processing', params: { processing } });
  }
}

function htmlForWebview(vscode: vscodeTypes.VSCode, extensionUri: vscodeTypes.Uri, webview: vscodeTypes.Webview) {
  const style = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', 'common.css'));
  const script = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'dist', 'replView.script.js'));
  const nonce = getNonce();

  return html`
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'; img-src data:;">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <link href="${style}" rel="stylesheet">
      <title>REPL</title>
      <style>
        body.repl-view {
          display: flex;
          flex-direction: column;
          height: 100vh;
          overflow: hidden;
          font-family: var(--vscode-editor-font-family, 'Consolas, monospace');
          font-size: var(--vscode-editor-font-size, 13px);
          user-select: text;
        }
        #output {
          flex: 1;
          overflow-y: auto;
          padding: 4px 8px;
          white-space: pre-wrap;
          word-break: break-word;
        }
        .line { line-height: 1.4; }
        .line-command { color: var(--vscode-terminal-ansiBrightWhite, var(--vscode-editor-foreground)); }
        .line-command::before { content: '> '; color: var(--vscode-terminal-ansiGreen); }
        .line-output { color: var(--vscode-editor-foreground); }
        .line-error { color: var(--vscode-terminal-ansiRed); }
        .line-info { color: var(--vscode-terminal-ansiCyan, var(--vscode-descriptionForeground)); }
        #input-row {
          display: flex;
          align-items: center;
          padding: 4px 8px;
          border-top: 1px solid var(--vscode-panelInput-border, var(--vscode-panel-border));
        }
        #prompt {
          color: var(--vscode-terminal-ansiGreen);
          margin-right: 4px;
          flex: none;
        }
        #command-input {
          flex: 1;
          border: none;
          outline: none;
          background: transparent;
          color: var(--vscode-editor-foreground);
          font-family: inherit;
          font-size: inherit;
          padding: 2px 0;
        }
        #command-input::placeholder {
          color: var(--vscode-input-placeholderForeground);
        }
        #command-input:disabled {
          opacity: 0.5;
        }
      </style>
    </head>
    <body class="repl-view">
      <div id="output"></div>
      <div id="input-row">
        <span id="prompt">&gt;</span>
        <input id="command-input" type="text" placeholder="Type a command..." autofocus>
      </div>
    </body>
    <script nonce="${nonce}" src="${script}"></script>
    </html>
  `;
}
