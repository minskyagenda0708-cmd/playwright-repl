/**
 * Test Explorer
 *
 * Integrates with VS Code's Test Explorer API:
 * - Discovers .spec.ts / .test.ts files
 * - Parses test structure (test, describe, hooks)
 * - Builds a test tree (TestController + TestItems)
 * - Runs tests via bridge mode (bundle + send to playwright-crx)
 * - Maps results back to TestItems (pass/fail/duration)
 */

import * as vscode from 'vscode';
import path from 'node:path';
import fs from 'node:fs';
import { parseTestFile, type ParsedTest } from './test-parser.js';
import type { BrowserManager } from './browser.js';

// ─── Test Explorer ─────────────────────────────────────────────────────────

export class TestExplorer {
  private _controller: vscode.TestController;
  private _browserManager: BrowserManager;
  private _outputChannel: vscode.OutputChannel;
  private _watchers: vscode.FileSystemWatcher[] = [];
  private _watchMode = false;
  private _disposables: vscode.Disposable[] = [];

  constructor(browserManager: BrowserManager, outputChannel: vscode.OutputChannel) {
    this._browserManager = browserManager;
    this._outputChannel = outputChannel;
    this._controller = vscode.tests.createTestController('playwright-ide', 'Playwright IDE');

    // Run profile: executes tests via bridge
    const runProfile = this._controller.createRunProfile(
      'Run',
      vscode.TestRunProfileKind.Run,
      (request, token) => this._runTests(request, token),
      true, // isDefault
    );
    runProfile.supportsContinuousRun = true;

    // Debug profile: runs tests with debugger attached
    this._controller.createRunProfile(
      'Debug',
      vscode.TestRunProfileKind.Debug,
      (request, _token) => this._debugTests(request),
      true,
    );

    // Discover existing test files
    this._discoverTests();

    // Watch for file changes (discovery)
    const pattern = '**/*.{spec,test}.{ts,js,mjs}';
    const watcher = vscode.workspace.createFileSystemWatcher(pattern);
    watcher.onDidCreate(uri => this._parseFile(uri));
    watcher.onDidChange(uri => this._parseFile(uri));
    watcher.onDidDelete(uri => this._deleteFile(uri));
    this._watchers.push(watcher);

    // Watch mode: auto-run tests on save
    const config = vscode.workspace.getConfiguration('playwright-ide');
    this._watchMode = config.get('watchMode', false);
    this._disposables.push(
      vscode.workspace.onDidSaveTextDocument(doc => {
        if (this._watchMode && /\.(spec|test)\.(ts|js|mjs)$/.test(doc.uri.fsPath)) {
          this._runFileOnSave(doc.uri);
        }
      }),
      vscode.workspace.onDidChangeConfiguration(e => {
        if (e.affectsConfiguration('playwright-ide.watchMode')) {
          this._watchMode = vscode.workspace.getConfiguration('playwright-ide').get('watchMode', false);
          this._outputChannel.appendLine(`Watch mode: ${this._watchMode ? 'ON' : 'OFF'}`);
        }
      }),
    );
  }

  get controller() { return this._controller; }

  private _deleteFile(uri: vscode.Uri) {
    const remove = (items: vscode.TestItemCollection): boolean => {
      let found = false;
      items.forEach(item => {
        if (item.id === uri.toString()) {
          items.delete(item.id);
          found = true;
        } else if (item.children.size > 0) {
          if (remove(item.children)) {
            if (item.children.size === 0) items.delete(item.id);
            found = true;
          }
        }
      });
      return found;
    };
    remove(this._controller.items);
  }

  dispose() {
    this._controller.dispose();
    for (const w of this._watchers) w.dispose();
    for (const d of this._disposables) d.dispose();
  }

  // ─── Watch Mode ─────────────────────────────────────────────────────────

  private async _runFileOnSave(uri: vscode.Uri) {
    if (!this._browserManager.isRunning()) return;

    // Find all test items for this file
    const fileItems: vscode.TestItem[] = [];
    const findItems = (items: vscode.TestItemCollection) => {
      items.forEach(item => {
        if (item.uri?.toString() === uri.toString() && item.children.size === 0) {
          fileItems.push(item);
        }
        if (item.children.size > 0) findItems(item.children);
      });
    };
    findItems(this._controller.items);
    if (fileItems.length === 0) return;

    // Re-parse test structure (file may have changed)
    await this._parseFile(uri);

    // Run via the same path as clicking "Run" in Test Explorer
    const request = new vscode.TestRunRequest(fileItems);
    const token = new vscode.CancellationTokenSource().token;
    this._outputChannel.appendLine(`[watch] ${path.basename(uri.fsPath)}`);
    await this._runTests(request, token);
  }

  // ─── Discovery ───────────────────────────────────────────────────────────

  private async _discoverTests() {
    const folders = vscode.workspace.workspaceFolders;
    this._outputChannel.appendLine(`Workspace folders: ${folders?.map(f => f.uri.fsPath).join(', ') || 'NONE'}`);
    const files = await vscode.workspace.findFiles('**/*.spec.ts', '**/node_modules/**');
    this._outputChannel.appendLine(`Test discovery: found ${files.length} test files`);
    for (const uri of files) {
      this._outputChannel.appendLine(`  ${uri.fsPath}`);
      await this._parseFile(uri);
    }
  }

  private async _parseFile(uri: vscode.Uri) {
    try {
      const content = (await vscode.workspace.fs.readFile(uri)).toString();
      const parsed = parseTestFile(content);
      this._outputChannel.appendLine(`  Parsed ${uri.fsPath}: ${parsed.length} top-level items`);
      if (parsed.length === 0) return;

      // Build folder hierarchy from workspace-relative path
      const workspaceFolder = vscode.workspace.getWorkspaceFolder(uri);
      const relativePath = workspaceFolder
        ? path.relative(workspaceFolder.uri.fsPath, uri.fsPath).replace(/\\/g, '/')
        : path.basename(uri.fsPath);
      const parts = relativePath.split('/');
      const fileName = parts.pop()!;

      // Create or reuse folder items
      let parent = this._controller.items;
      let folderId = '';
      for (const folder of parts) {
        folderId += (folderId ? '/' : '') + folder;
        const id = `folder:${folderId}`;
        let folderItem = parent.get(id);
        if (!folderItem) {
          folderItem = this._controller.createTestItem(id, folder);
          parent.add(folderItem);
        }
        parent = folderItem.children;
      }

      const fileItem = this._controller.createTestItem(uri.toString(), fileName, uri);
      this._buildTree(fileItem, parsed, uri);
      parent.add(fileItem);
    } catch (err: unknown) {
      this._outputChannel.appendLine(`  Error parsing ${uri.fsPath}: ${(err as Error).message}`);
    }
  }

  private _buildTree(parent: vscode.TestItem, tests: ParsedTest[], uri: vscode.Uri) {
    for (const t of tests) {
      const id = `${parent.id}/${t.name}`;
      const item = this._controller.createTestItem(id, t.name, uri);
      item.range = new vscode.Range(t.line, 0, t.line, 0);

      if (t.type === 'describe' && t.children) {
        this._buildTree(item, t.children, uri);
      }

      parent.children.add(item);
    }
  }

  // ─── Run ─────────────────────────────────────────────────────────────────

  private async _runTests(request: vscode.TestRunRequest, token: vscode.CancellationToken) {
    // Continuous run (watch icon) — run now, then re-run on save
    if (request.continuous) {
      await this._runTestsOnce(request, token);
      const saveListener = vscode.workspace.onDidSaveTextDocument(async (doc) => {
        if (token.isCancellationRequested) return;
        if (/\.(spec|test)\.(ts|js|mjs)$/.test(doc.uri.fsPath)) {
          await this._parseFile(doc.uri);
          await this._runTestsOnce(request, token);
        }
      });
      token.onCancellationRequested(() => saveListener.dispose());
      return;
    }
    await this._runTestsOnce(request, token);
  }

  private async _runTestsOnce(request: vscode.TestRunRequest, token: vscode.CancellationToken) {
    const run = this._controller.createTestRun(request);

    // Collect test items to run
    const items: vscode.TestItem[] = [];
    if (request.include) {
      for (const item of request.include) {
        this._collectLeafTests(item, items);
      }
    } else {
      // Run all
      this._controller.items.forEach(item => this._collectLeafTests(item, items));
    }

    // Group by file
    const byFile = new Map<string, vscode.TestItem[]>();
    for (const item of items) {
      const fileUri = this._getFileUri(item);
      if (!fileUri) continue;
      const key = fileUri.toString();
      if (!byFile.has(key)) byFile.set(key, []);
      byFile.get(key)!.push(item);
    }

    // Auto-launch browser if needed
    if (!this._browserManager.isRunning()) {
      const config = vscode.workspace.getConfiguration('playwright-ide');
      try {
        this._outputChannel.appendLine('Auto-launching browser for test run...');
        await this._browserManager.launch({
          browser: config.get('browser', 'chromium'),
          headless: config.get('headless', false),
        });
      } catch (err: unknown) {
        for (const item of items) run.errored(item, new vscode.TestMessage((err as Error).message));
        run.end();
        return;
      }
    }

    // Run each file via runTestFile (in-process, reuses existing bridge + page)
    for (const [fileKey, fileItems] of byFile) {
      if (token.isCancellationRequested) break;

      // Clear previous results — show empty/enqueued state
      for (const item of fileItems) run.enqueued(item);

      const fileUri = vscode.Uri.parse(fileKey);
      try {
        const runTestPath = path.resolve(path.dirname(__filename), '..', '..', 'runner', 'dist', 'run-test.js');
        const { runTestFile, needsNodeMode, listTests } = await import(`file://${runTestPath.replace(/\\/g, '/')}`);
        const bridge = this._browserManager.bridge!;
        const page = this._browserManager.page;

        const isNode = needsNodeMode(fileUri.fsPath);

        // Node mode: use Playwright discovery to get real test names
        // (resolves template literals, expands parameterized tests)
        let activeItems = fileItems;
        if (isNode) {
          try {
            const discovered = await listTests(fileUri.fsPath);
            if (discovered.length > 0) {
              this._outputChannel.appendLine(`  Discovery: ${discovered.length} tests via --list`);
              activeItems = this._rebuildFileItems(fileUri, discovered);
              for (const item of activeItems) run.enqueued(item);
            }
          } catch (e: unknown) {
            this._outputChannel.appendLine(`  Discovery fallback to regex: ${(e as Error).message}`);
          }
        }

        // Build grep from requested test names
        const testNames = activeItems.map(i => i.label);
        const grep = testNames.length === 1 ? testNames[0] : undefined;

        this._outputChannel.appendLine(`Running: ${fileUri.fsPath}${grep ? ` (${grep})` : ''} [${isNode ? 'node' : 'bridge'}]`);

        // Bridge mode: mark all started upfront (results come back in batch)
        if (!isNode) {
          for (const item of activeItems) run.started(item);
        }

        // Stream results: update Test Explorer as each test completes
        const onResult = (r: any) => {
          const icon = r.skipped ? '-' : r.passed ? '✓' : '✗';
          this._outputChannel.appendLine(`  ${icon} ${r.name} (${r.duration}ms)${r.error ? ' — ' + r.error : ''}`);
          const item = this._matchItem(activeItems, r);
          if (!item) {
            this._outputChannel.appendLine(`  [no match] result="${r.name}" items=[${activeItems.map(i => `"${i.label}"`).slice(0, 5).join(', ')}...]`);
          }
          if (item) {
            run.started(item);
            if (r.skipped) run.skipped(item);
            else if (r.passed) run.passed(item, r.duration);
            else run.failed(item, new vscode.TestMessage(r.error || 'Test failed'), r.duration);
          }
        };

        const results = await runTestFile(fileUri.fsPath, bridge, page, { grep }, isNode ? onResult : undefined);
        this._outputChannel.appendLine(`Done: ${results.length} tests`);

        // Bridge mode: dispatch results after batch completes
        if (!isNode) {
          for (const r of results) {
            this._outputChannel.appendLine(`  ${r.skipped ? '-' : r.passed ? '✓' : '✗'} ${r.name} (${r.duration}ms)${r.error ? ' — ' + r.error : ''}`);
          }
          for (const item of activeItems) {
            const result = this._matchResult(results, item);
            if (!result || result.skipped) {
              run.skipped(item);
            } else if (result.passed) {
              run.passed(item, result.duration);
            } else {
              run.failed(item, new vscode.TestMessage(result.error || 'Test failed'), result.duration);
            }
          }
        }

        // Node mode: mark any items not matched by streaming as skipped
        if (isNode) {
          for (const item of activeItems) {
            const hasResult = results.some((r: any) => this._isMatch(item, r));
            if (!hasResult) {
              run.started(item);
              run.skipped(item);
            }
          }
        }
      } catch (err: unknown) {
        this._outputChannel.appendLine(`Error: ${(err as Error).message}`);
        for (const item of fileItems) {
          run.errored(item, new vscode.TestMessage((err as Error).message));
        }
      }
    }

    run.end();
  }

  private async _runViaPwCli(filePath: string, grep?: string): Promise<string> {
    const { spawn } = await import('node:child_process');
    const pwCliPath = path.resolve(path.dirname(__filename), '..', '..', 'runner', 'dist', 'pw-cli.js');
    const args = ['node', `"${pwCliPath}"`, 'test', `"${filePath}"`, '--workers', '1'];
    if (grep) {
      args.push('--grep', `"${grep}"`);
    }
    const cmd = args.join(' ');
    this._outputChannel.appendLine(`[pw-cli] ${cmd}`);

    return new Promise((resolve) => {
      let output = '';
      // Find project root (walk up from test file to find playwright.config.ts)
      let cwd = path.dirname(filePath);
      while (cwd !== path.dirname(cwd)) {
        if (fs.existsSync(path.join(cwd, 'playwright.config.ts'))) break;
        cwd = path.dirname(cwd);
      }
      const child = spawn(cmd, [], {
        cwd,
        shell: true,
        timeout: 60000,
      });
      child.stdout?.on('data', (data: Buffer) => { output += data.toString(); });
      child.stderr?.on('data', (data: Buffer) => { this._outputChannel.appendLine('[stderr] ' + data.toString()); });
      child.on('exit', (code) => {
        this._outputChannel.appendLine(`[pw-cli] exit code: ${code}`);
        this._outputChannel.appendLine(`[pw-cli] stdout:\n${output}`);
        resolve(output);
      });
    });
  }

  private _mapTextResults(run: vscode.TestRun, items: vscode.TestItem[], output: string): void {
    const results = new Map<string, { passed: boolean; duration: number; error?: string }>();
    const lines = output.split('\n');

    for (let i = 0; i < lines.length; i++) {
      // Playwright list reporter: "  ✓  N [chromium] › file:line › name (Nms)"
      // Or pw-run format: "  ✓ name (Nms)"
      const passMatch = lines[i].match(/[✓✔]\s+(?:\d+\s+\[.*?\]\s+›.*?›\s+)?(.+?)\s+\((\d+)ms\)/);
      if (passMatch) {
        results.set(passMatch[1].trim(), { passed: true, duration: parseInt(passMatch[2]) });
        continue;
      }
      const failMatch = lines[i].match(/[✗✘✕×]\s+(?:\d+\s+\[.*?\]\s+›.*?›\s+)?(.+?)\s+\((\d+)ms\)/);
      if (failMatch) {
        const error = lines[i + 1]?.trim() || 'Test failed';
        results.set(failMatch[1].trim(), { passed: false, duration: parseInt(failMatch[2]), error });
        continue;
      }
    }

    this._outputChannel.appendLine(`Parsed ${results.size} results from pw-cli output`);

    for (const item of items) {
      const fullName = this._getFullTestName(item);
      const result = results.get(fullName) || results.get(item.label);
      if (!result) {
        run.skipped(item);
      } else if (result.passed) {
        run.passed(item, result.duration);
      } else {
        run.failed(item, new vscode.TestMessage(result.error || 'Test failed'), result.duration);
      }
    }
  }

  private async _debugTests(request: vscode.TestRunRequest) {
    // Find the test file to debug
    const items: vscode.TestItem[] = [];
    if (request.include) {
      for (const item of request.include) this._collectLeafTests(item, items);
    }
    const fileUri = items[0] ? this._getFileUri(items[0]) : undefined;
    if (!fileUri) return;

    // Debug: standard npx playwright test with Node.js debugger attached
    try {
      const testDir = path.dirname(fileUri.fsPath);
      const testFileName = path.basename(fileUri.fsPath);

      const run = this._controller.createTestRun(request);
      for (const item of items) run.started(item);

      await vscode.debug.startDebugging(undefined, {
        type: 'node',
        request: 'launch',
        name: 'Debug Playwright Test',
        runtimeExecutable: 'npx',
        runtimeArgs: ['playwright', 'test', testFileName, '--headed'],
        cwd: testDir,
        sourceMaps: true,
        skipFiles: ['<node_internals>/**', '**/node_modules/**'],
      });

      // Mark tests as passed when debug session ends
      const disposable = vscode.debug.onDidTerminateDebugSession(() => {
        for (const item of items) run.passed(item);
        run.end();
        disposable.dispose();
      });
    } catch (err: unknown) {
      this._outputChannel.appendLine(`Debug error: ${(err as Error).message}`);
      vscode.window.showErrorMessage(`Debug failed: ${(err as Error).message}`);
    }
  }

  private _collectLeafTests(item: vscode.TestItem, out: vscode.TestItem[]) {
    if (item.children.size === 0) {
      out.push(item);
    } else {
      item.children.forEach(child => this._collectLeafTests(child, out));
    }
  }

  private _getFileUri(item: vscode.TestItem): vscode.Uri | undefined {
    if (item.uri) return item.uri;
    if (item.parent) return this._getFileUri(item.parent);
    return undefined;
  }

  private _getFullTestName(item: vscode.TestItem): string {
    const parts: string[] = [item.label];
    let parent = item.parent;
    while (parent && parent.uri) { // stop at folder items (no uri)
      parts.unshift(parent.label);
      parent = parent.parent;
    }
    // Remove the file name (first element after reversal)
    if (parts.length > 1) parts.shift();
    return parts.join(' > ');
  }

  // ─── Discovery helpers ──────────────────────────────────────────────────────

  /**
   * Rebuild TestItems for a file from Playwright discovery results.
   * Replaces regex-parsed items with accurate names from --list.
   */
  private _rebuildFileItems(fileUri: vscode.Uri, discovered: any[]): vscode.TestItem[] {
    // Find the existing file TestItem in the tree
    let fileItem: vscode.TestItem | undefined;
    const findFile = (items: vscode.TestItemCollection) => {
      items.forEach(item => {
        if (item.id === fileUri.toString()) fileItem = item;
        else if (item.children.size > 0) findFile(item.children);
      });
    };
    findFile(this._controller.items);
    if (!fileItem) return [];

    // Clear existing children and rebuild from discovery
    const oldChildren: string[] = [];
    fileItem.children.forEach(c => oldChildren.push(c.id));
    for (const id of oldChildren) fileItem.children.delete(id);

    // Group by describe path to rebuild hierarchy
    const items: vscode.TestItem[] = [];
    for (const test of discovered) {
      const parts = test.fullName.split(' > ');
      let parent = fileItem;

      // Create describe hierarchy (all parts except last)
      for (let i = 0; i < parts.length - 1; i++) {
        const suiteId = `${parent.id}/${parts[i]}`;
        let suite = parent.children.get(suiteId);
        if (!suite) {
          suite = this._controller.createTestItem(suiteId, parts[i], fileUri);
          suite.range = new vscode.Range(test.line - 1, 0, test.line - 1, 0);
          parent.children.add(suite);
        }
        parent = suite;
      }

      // Create the leaf test item
      const testId = `${parent.id}/${test.title}`;
      const item = this._controller.createTestItem(testId, test.title, fileUri);
      item.range = new vscode.Range(test.line - 1, 0, test.line - 1, 0);
      parent.children.add(item);
      items.push(item);
    }

    return items;
  }

  // ─── Matching helpers ───────────────────────────────────────────────────────

  /**
   * Match a test result to a TestItem. Tries line number first (most reliable),
   * then falls back to name matching.
   */
  private _matchItem(items: vscode.TestItem[], result: any): vscode.TestItem | undefined {
    // 1. Try exact name match (fast path — works when discovery is accurate)
    const byName = items.find(i => {
      const fullName = this._getFullTestName(i);
      return fullName === result.name || i.label === result.name;
    });
    if (byName) return byName;

    // 2. Try line number match (handles name mismatches from template literals)
    if (result.line) {
      const byLine = items.find(i =>
        i.range && i.range.start.line + 1 === result.line
      );
      if (byLine) return byLine;
    }

    // 3. Fuzzy: endsWith (handles describe-prefixed names)
    return items.find(i => {
      const fullName = this._getFullTestName(i);
      return result.name.endsWith(fullName) || result.name.endsWith(i.label);
    });
  }

  /** Match a result array against a TestItem (for batch mode). */
  private _matchResult(results: any[], item: vscode.TestItem): any | undefined {
    const fullName = this._getFullTestName(item);
    // 1. Exact name
    let r = results.find((r: any) => r.name === fullName || r.name === item.label);
    if (r) return r;
    // 2. Line number
    if (item.range) {
      r = results.find((r: any) => r.line && item.range!.start.line + 1 === r.line);
      if (r) return r;
    }
    // 3. Fuzzy
    return results.find((r: any) => r.name.endsWith(fullName) || r.name.endsWith(item.label));
  }

  /** Check if a result matches an item (for has-result checks). */
  private _isMatch(item: vscode.TestItem, result: any): boolean {
    const fullName = this._getFullTestName(item);
    if (fullName === result.name || item.label === result.name) return true;
    if (result.line && item.range && item.range.start.line + 1 === result.line) return true;
    if (result.name.endsWith(fullName) || result.name.endsWith(item.label)) return true;
    return false;
  }
}
