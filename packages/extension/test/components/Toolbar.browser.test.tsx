/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render } from 'vitest-browser-react';
import { userEvent } from 'vitest/browser';

import Toolbar from '@/components/Toolbar';

// ─── Bridge mock ──────────────────────────────────────────────────────────────

vi.mock('@/lib/bridge', () => ({
  executeCommand: vi.fn(),
  attachToTab: vi.fn().mockResolvedValue({ ok: true, url: 'https://example.com' }),
  connectWithRetry: vi.fn().mockResolvedValue({
    onMessage: { addListener: vi.fn() },
    onDisconnect: { addListener: vi.fn() },
    disconnect: vi.fn(),
  }),
}));

import { executeCommand, attachToTab, connectWithRetry } from '@/lib/bridge';

// ─── Helper to render Toolbar with default required props ─────────────────────

function renderToolbar(overrides: Partial<Parameters<typeof Toolbar>[0]> = {}) {
  return render(<Toolbar
    editorContent=''
    fileName=''
    stepLine={-1}
    attachedUrl={null}
    isAttaching={false}
    dispatch={vi.fn()}
    {...overrides}
  />);
}

describe('Toolbar component tests', () => {
  beforeEach(() => {
    Object.assign(window, {
      chrome: {
        tabs: {
          query: vi.fn().mockResolvedValue([{ id: 1, url: 'https://example.com' }]),
        },
        runtime: {
          sendMessage: vi.fn().mockResolvedValue({ ok: true, url: 'https://example.com' }),
          connect: vi.fn().mockReturnValue({
            onMessage: { addListener: vi.fn() },
            onDisconnect: { addListener: vi.fn() },
            disconnect: vi.fn(),
          }),
        },
      },
    });
    vi.mocked(executeCommand).mockResolvedValue({ text: 'Done', isError: false });
    vi.mocked(attachToTab).mockResolvedValue({ ok: true, url: 'https://example.com' });
    vi.mocked(connectWithRetry).mockResolvedValue({
      onMessage: { addListener: vi.fn() },
      onDisconnect: { addListener: vi.fn() },
      disconnect: vi.fn(),
    } as unknown as chrome.runtime.Port);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it('should render the Toolbar component', async () => {
    const screen = await renderToolbar();
    await expect.element(screen.getByTitle('Open .pw file')).toBeInTheDocument();
  });

  // ─── File operations ───────────────────────────────────────────────────────

  it('should open a file dialog when click open button', async () => {
    const dispatch = vi.fn();
    const screen = await renderToolbar({ dispatch });

    const file = new File(['go to https://example.com\nclick e5'], 'test.pw', { type: 'text/plain' });
    const fileInput = screen.container.querySelector('input[type="file"]') as HTMLInputElement;
    await userEvent.upload(fileInput, file);

    await vi.waitFor(() => {
      expect(dispatch).toHaveBeenCalledWith({
        type: 'EDIT_EDITOR_CONTENT',
        content: 'go to https://example.com\nclick e5'
      });
      expect(dispatch).toHaveBeenCalledWith({
        type: 'SET_FILENAME',
        fileName: 'test.pw'
      });
    });
  });

  it('should handle open a file dialog when no file selected', async () => {
    const dispatch = vi.fn();
    const screen = await renderToolbar({ dispatch });

    const fileInput = screen.container.querySelector('input[type="file"]') as HTMLInputElement;
    dispatch.mockClear();
    fileInput.dispatchEvent(new Event('change', { bubbles: true }));

    await new Promise(r => setTimeout(r, 50));
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('should dispatch error when file read fails', async () => {
    const dispatch = vi.fn();
    const screen = await renderToolbar({ dispatch });

    vi.spyOn(FileReader.prototype, 'readAsText').mockImplementation(function (this: FileReader) {
      this.onerror?.(new ProgressEvent('error') as ProgressEvent<FileReader>);
    });

    const file = new File(['content'], 'test.pw', { type: 'text/plain' });
    const fileInput = screen.container.querySelector('input[type="file"]') as HTMLInputElement;
    await userEvent.upload(fileInput, file);

    await vi.waitFor(() => {
      expect(dispatch).toHaveBeenCalledWith({
        type: 'ADD_LINE',
        line: { text: 'Failed to read file', type: 'error' }
      });
    });
  });

  it('should trigger file input click when Open button clicked', async () => {
    const screen = await renderToolbar();

    const fileInput = screen.container.querySelector('input[type="file"]') as HTMLInputElement;
    let inputClicked = false;
    fileInput.addEventListener('click', (e) => {
      e.preventDefault();
      inputClicked = true;
    });

    const openBtn = screen.container.querySelector('#open-btn') as HTMLButtonElement;
    openBtn.click();
    expect(inputClicked).toBe(true);
  });

  it('should save file and dispatch SET_FILENAME', async () => {
    const dispatch = vi.fn();
    const screen = await renderToolbar({ editorContent: 'goto https://example.com', dispatch });

    const mockWritable = { write: vi.fn(), close: vi.fn() };
    const mockFileHandle = {
      name: 'saved.pw',
      createWritable: vi.fn().mockResolvedValue(mockWritable),
    };
    window.showSaveFilePicker = vi.fn().mockResolvedValue(mockFileHandle) as any;

    const saveBtn = screen.container.querySelector('#save-btn') as HTMLButtonElement;
    saveBtn.click();

    await vi.waitFor(() => {
      expect(mockWritable.write).toHaveBeenCalledWith('goto https://example.com');
      expect(mockWritable.close).toHaveBeenCalled();
      expect(dispatch).toHaveBeenCalledWith({ type: 'SET_FILENAME', fileName: 'saved.pw' });
    });
  });

  it('should dispatch error when save fails', async () => {
    const dispatch = vi.fn();
    const screen = await renderToolbar({ editorContent: 'some content', dispatch });

    window.showSaveFilePicker = vi.fn().mockRejectedValue(new Error('Disk full')) as any;

    const saveBtn = screen.container.querySelector('#save-btn') as HTMLButtonElement;
    saveBtn.click();

    await vi.waitFor(() => {
      expect(dispatch).toHaveBeenCalledWith({
        type: 'ADD_LINE',
        line: { text: 'Save failed: Disk full', type: 'error' }
      });
    });
  });

  it('should not dispatch error when user cancels save', async () => {
    const dispatch = vi.fn();
    const screen = await renderToolbar({ editorContent: 'some content', dispatch });

    const abortError = new Error('User cancelled');
    abortError.name = 'AbortError';
    window.showSaveFilePicker = vi.fn().mockRejectedValue(abortError) as any;

    dispatch.mockClear();
    const saveBtn = screen.container.querySelector('#save-btn') as HTMLButtonElement;
    saveBtn.click();

    await new Promise(r => setTimeout(r, 50));
    expect(dispatch).not.toHaveBeenCalled();
  });

  // ─── Run / Step ────────────────────────────────────────────────────────────

  it('should run all commands and dispatch results', async () => {
    const dispatch = vi.fn();
    const screen = await renderToolbar({
      editorContent: 'goto https://example.com\nclick e5',
      dispatch,
    });

    vi.mocked(executeCommand).mockResolvedValue({ text: 'Done', isError: false });

    await screen.getByText('▶').click();

    await vi.waitFor(() => {
      expect(dispatch).toHaveBeenCalledWith({ type: 'RUN_START' });
      expect(dispatch).toHaveBeenCalledWith({ type: 'SET_RUN_LINE', currentRunLine: 0 });
      expect(dispatch).toHaveBeenCalledWith({ type: 'COMMAND_SUBMITTED', line: { text: 'goto https://example.com', type: 'command' } });
      expect(dispatch).toHaveBeenCalledWith({ type: 'COMMAND_SUCCESS', line: { text: 'Done', type: 'success' } });
      expect(dispatch).toHaveBeenCalledWith({ type: 'SET_LINE_RESULT', index: 0, result: 'pass' });
      expect(dispatch).toHaveBeenCalledWith({ type: 'SET_RUN_LINE', currentRunLine: 1 });
      expect(dispatch).toHaveBeenCalledWith({ type: 'COMMAND_SUBMITTED', line: { text: 'click e5', type: 'command' } });
      expect(dispatch).toHaveBeenCalledWith({ type: 'SET_LINE_RESULT', index: 1, result: 'pass' });
      expect(dispatch).toHaveBeenCalledWith({ type: 'RUN_STOP' });
    });
  });

  it('should run all commands and dispatch results with error type', async () => {
    const dispatch = vi.fn();
    const screen = await renderToolbar({
      editorContent: 'goto https://example.com\nclick e5',
      dispatch,
    });

    vi.mocked(executeCommand).mockResolvedValue({ text: 'Done', isError: true });

    await screen.getByText('▶').click();

    await vi.waitFor(() => {
      expect(dispatch).toHaveBeenCalledWith({ type: 'SET_LINE_RESULT', index: 0, result: 'fail' });
      expect(dispatch).toHaveBeenCalledWith({ type: 'COMMAND_SUCCESS', line: { text: 'Done', type: 'error' } });
    });
  });

  it('should dispatch error message when run command fails', async () => {
    const dispatch = vi.fn();
    const screen = await renderToolbar({
      editorContent: 'goto https://example.com\nclick e5',
      dispatch,
    });

    vi.mocked(executeCommand).mockRejectedValue(new Error('bridge error'));

    await screen.getByText('▶').click();

    await vi.waitFor(() => {
      expect(dispatch).toHaveBeenCalledWith({ type: 'RUN_START' });
      expect(dispatch).toHaveBeenCalledWith({
        type: 'COMMAND_ERROR',
        line: { text: 'Command failed. Try clicking Attach first.', type: 'error' }
      });
    });
  });

  it('should skip comments and empty lines when running', async () => {
    const screen = await renderToolbar({
      editorContent: '# comment\ngoto https://example.com\n\nclick e5',
    });

    vi.mocked(executeCommand).mockResolvedValue({ text: 'Done', isError: false });

    await screen.getByText('▶').click();

    await vi.waitFor(() => {
      expect(executeCommand).toHaveBeenCalledTimes(2);
      expect(executeCommand).toHaveBeenCalledWith('goto https://example.com');
      expect(executeCommand).toHaveBeenCalledWith('click e5');
    });
  });

  it('should highlight the first line when click the step button', async () => {
    const dispatch = vi.fn();
    const screen = await renderToolbar({
      editorContent: 'goto https://example.com\nclick e5',
      dispatch,
    });

    await screen.getByText('▷').click();

    await vi.waitFor(() => {
      expect(dispatch).toHaveBeenCalledWith({ type: 'STEP_INIT', stepLine: 0 });
    });
  });

  it('should execute current line and advance when stepping', async () => {
    const dispatch = vi.fn();
    const screen = await renderToolbar({
      editorContent: 'goto https://example.com\nclick e5',
      stepLine: 0,
      dispatch,
    });

    vi.mocked(executeCommand).mockResolvedValue({ text: 'Done', isError: false });

    await screen.getByText('▷').click();

    await vi.waitFor(() => {
      expect(executeCommand).toHaveBeenCalledWith('goto https://example.com');
      expect(dispatch).toHaveBeenCalledWith({ type: 'STEP_ADVANCE', stepLine: 1 });
    });
  });

  it('should skip comments on step init', async () => {
    const dispatch = vi.fn();
    const screen = await renderToolbar({
      editorContent: '# comment\n\ngoto https://example.com',
      dispatch,
    });

    await screen.getByText('▷').click();

    await vi.waitFor(() => {
      expect(dispatch).toHaveBeenCalledWith({ type: 'STEP_INIT', stepLine: 2 });
    });
  });

  it('should skip comments when advancing step', async () => {
    const dispatch = vi.fn();
    const screen = await renderToolbar({
      editorContent: 'goto https://example.com\n# comment\nclick e5',
      stepLine: 0,
      dispatch,
    });

    vi.mocked(executeCommand).mockResolvedValue({ text: 'Done', isError: false });

    await screen.getByText('▷').click();

    await vi.waitFor(() => {
      expect(dispatch).toHaveBeenCalledWith({ type: 'STEP_ADVANCE', stepLine: 2 });
    });
  });

  it('should set stepLine to -1 when no more lines', async () => {
    const dispatch = vi.fn();
    const screen = await renderToolbar({
      editorContent: 'goto https://example.com',
      stepLine: 0,
      dispatch,
    });

    vi.mocked(executeCommand).mockResolvedValue({ text: 'Done', isError: false });

    await screen.getByText('▷').click();

    await vi.waitFor(() => {
      expect(dispatch).toHaveBeenCalledWith({ type: 'STEP_ADVANCE', stepLine: -1 });
    });
  });

  it('should not dispatch step init when no executable lines', async () => {
    const dispatch = vi.fn();
    const screen = await renderToolbar({
      editorContent: '# comment\n\n# another comment',
      dispatch,
    });

    dispatch.mockClear();
    await screen.getByText('▷').click();

    await new Promise(r => setTimeout(r, 50));
    expect(dispatch).not.toHaveBeenCalled();
  });

  // ─── Recording ─────────────────────────────────────────────────────────────

  it('should toggle to stop when record button is clicked', async () => {
    const screen = await renderToolbar();

    await screen.getByRole('button', { name: 'Record' }).click();
    await expect.element(screen.getByRole('button', { name: 'Stop' })).toBeInTheDocument();
  });

  it('should toggle to record when stop button is clicked', async () => {
    const screen = await renderToolbar();

    await screen.getByRole('button', { name: 'Record' }).click();
    await screen.getByRole('button', { name: 'Stop' }).click();

    await expect.element(screen.getByRole('button', { name: 'Record' })).toBeInTheDocument();
  });

  it('should send record-start message when record button clicked', async () => {
    const screen = await renderToolbar();
    await screen.getByRole('button', { name: 'Record' }).click();
    await vi.waitFor(() => {
      expect(window.chrome.runtime.sendMessage).toHaveBeenCalledWith({ type: 'record-start' });
    });
  });

  it('should send record-stop and disconnect port when stop clicked', async () => {
    const mockPort = {
      onMessage: { addListener: vi.fn() },
      onDisconnect: { addListener: vi.fn() },
      disconnect: vi.fn(),
    } as unknown as chrome.runtime.Port;
    vi.mocked(connectWithRetry).mockResolvedValue(mockPort);

    const screen = await renderToolbar();

    await screen.getByRole('button', { name: 'Record' }).click();
    await vi.waitFor(() => expect(connectWithRetry).toHaveBeenCalled());

    await screen.getByRole('button', { name: 'Stop' }).click();
    await vi.waitFor(() => {
      expect(window.chrome.runtime.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'record-stop' })
      );
    });
  });

  it('should not record when chrome.tabs.query is unavailable', async () => {
    window.chrome.tabs.query = null as any;

    const screen = await renderToolbar();
    await screen.getByRole('button', { name: 'Record' }).click();

    expect(window.chrome.runtime.sendMessage).not.toHaveBeenCalled();
  });

  it('should dispatch error when record-start fails', async () => {
    window.chrome.runtime.sendMessage = vi.fn().mockResolvedValue({ ok: false, error: 'connection failed' });

    const dispatch = vi.fn();
    const screen = await renderToolbar({ dispatch });

    await screen.getByRole('button', { name: 'Record' }).click();

    await vi.waitFor(() => {
      expect(dispatch).toHaveBeenCalledWith({
        type: 'ADD_LINE',
        line: { text: 'Recording failed: connection failed', type: 'error' }
      });
    });
  });

  it('should dispatch error when connectWithRetry fails', async () => {
    vi.mocked(connectWithRetry).mockRejectedValue(new Error('port error'));

    const dispatch = vi.fn();
    const screen = await renderToolbar({ dispatch });

    await screen.getByRole('button', { name: 'Record' }).click();

    await vi.waitFor(() => {
      expect(dispatch).toHaveBeenCalledWith({
        type: 'ADD_LINE',
        line: { text: 'Recording failed: could not connect to recorder.', type: 'error' }
      });
    });
  });

  it('should dispatch EDIT_EDITOR_CONTENT when port receives setSources', async () => {
    let portMessageListener: ((...args: unknown[]) => unknown) | null = null;
    const mockPort = {
      onMessage: {
        addListener: vi.fn((fn: (...args: unknown[]) => unknown) => { portMessageListener = fn; }),
      },
      onDisconnect: { addListener: vi.fn() },
      disconnect: vi.fn(),
    } as unknown as chrome.runtime.Port;
    vi.mocked(connectWithRetry).mockResolvedValue(mockPort);

    const dispatch = vi.fn();
    const screen = await renderToolbar({ dispatch });

    await screen.getByRole('button', { name: 'Record' }).click();
    await vi.waitFor(() => expect(portMessageListener).not.toBeNull());

    // Simulate JSONL source message from playwright-crx recorder
    portMessageListener!({
      type: 'recorder',
      method: 'setSources',
      sources: [{
        id: 'jsonl',
        actions: [
          JSON.stringify({ action: { type: 'navigate', url: 'https://example.com' } }),
        ],
      }],
    });

    await vi.waitFor(() => {
      expect(dispatch).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'EDIT_EDITOR_CONTENT' })
      );
    });
  });

  // ─── Export ────────────────────────────────────────────────────────────────

  it('should support export function', async () => {
    const pwCommands = `
    # command list
    goto https://example.com
    click "Learn more"
    verify-text "As described in RFC 2606 and RFC 6761"
    `;

    const dispatch = vi.fn();
    const screen = await renderToolbar({ editorContent: pwCommands, dispatch });

    await screen.getByRole('button', { name: 'Export' }).click();
    const expected_code = `
import { test, expect } from '@playwright/test';

test('recorded session', async ({ page }) => {
  // command list
  await page.goto("https://example.com");
  await page.getByText("Learn more").click();
  await expect(page.getByText("As described in RFC 2606 and RFC 6761")).toBeVisible();
});`.trim();
    expect(dispatch).toHaveBeenCalledWith({
      type: 'ADD_LINE',
      line: { text: expected_code, type: 'code-block' }
    });
  });

  // ─── Attach status indicator ───────────────────────────────────────────────

  it('shows disconnected status dot when not attached', async () => {
    const screen = await renderToolbar({ attachedUrl: null, isAttaching: false });
    const dot = screen.container.querySelector('[data-testid="status-dot"]') as HTMLElement;
    expect(dot.dataset.status).toBe('disconnected');
  });

  it('shows attaching status dot when isAttaching is true', async () => {
    const screen = await renderToolbar({ attachedUrl: null, isAttaching: true });
    const dot = screen.container.querySelector('[data-testid="status-dot"]') as HTMLElement;
    expect(dot.dataset.status).toBe('attaching');
  });

  it('shows connected status dot with attachedUrl', async () => {
    const screen = await renderToolbar({ attachedUrl: 'https://example.com', isAttaching: false });
    const dot = screen.container.querySelector('[data-testid="status-dot"]') as HTMLElement;
    expect(dot.dataset.status).toBe('connected');
  });

  it('shows hostname when attached', async () => {
    const screen = await renderToolbar({ attachedUrl: 'https://example.com', isAttaching: false });
    const statusIndicator = screen.container.querySelector('[data-testid="status-indicator"]');
    expect(statusIndicator?.textContent).toContain('example.com');
  });

  it('shows Not attached text when disconnected', async () => {
    const screen = await renderToolbar({ attachedUrl: null, isAttaching: false });
    await expect.element(screen.getByText('Not attached')).toBeInTheDocument();
  });

  it('shows Connecting text when isAttaching', async () => {
    const screen = await renderToolbar({ attachedUrl: null, isAttaching: true });
    await expect.element(screen.getByText('Connecting...')).toBeInTheDocument();
  });

  // ─── Tab switcher ──────────────────────────────────────────────────────────

  describe('tab switcher', () => {
    const mockTabs = [
      { id: 1, url: 'https://example.com', title: 'Example' },
      { id: 2, url: 'https://google.com', title: 'Google' },
    ];

    beforeEach(() => {
      (window.chrome.tabs.query as ReturnType<typeof vi.fn>).mockResolvedValue(mockTabs);
    });

    it('renders a tab select element', async () => {
      const screen = await renderToolbar();
      const select = screen.container.querySelector('select[title="Switch tab"]');
      expect(select).not.toBeNull();
    });

    it('shows attachedUrl as the selected value', async () => {
      const screen = await renderToolbar({ attachedUrl: 'https://example.com' });

      // Load tabs first
      const select = screen.container.querySelector('select[title="Switch tab"]') as HTMLSelectElement;
      select.dispatchEvent(new FocusEvent('focus', { bubbles: true }));

      await vi.waitFor(() => {
        expect(select.querySelectorAll('option').length).toBe(2);
      });

      expect(select.value).toBe('https://example.com');
    });

    it('loads tabs from chrome.tabs.query on focus', async () => {
      const screen = await renderToolbar();
      const select = screen.container.querySelector('select[title="Switch tab"]') as HTMLSelectElement;
      select.dispatchEvent(new FocusEvent('focus', { bubbles: true }));

      await vi.waitFor(() => {
        expect(window.chrome.tabs.query).toHaveBeenCalled();
        const options = select.querySelectorAll('option');
        expect(options.length).toBe(2);
      });
    });

    it('dispatches ATTACH_START and calls attachToTab when tab changed', async () => {
      vi.mocked(attachToTab).mockResolvedValue({ ok: true, url: 'https://google.com' });

      const dispatch = vi.fn();
      const screen = await renderToolbar({ attachedUrl: 'https://example.com', dispatch });

      const select = screen.container.querySelector('select[title="Switch tab"]') as HTMLSelectElement;
      select.dispatchEvent(new FocusEvent('focus', { bubbles: true }));

      await vi.waitFor(() => {
        expect(select.querySelectorAll('option').length).toBe(2);
      });

      await userEvent.selectOptions(select, 'https://google.com');

      await vi.waitFor(() => {
        expect(dispatch).toHaveBeenCalledWith({ type: 'ATTACH_START' });
        expect(attachToTab).toHaveBeenCalledWith(2);
        expect(dispatch).toHaveBeenCalledWith({ type: 'ATTACH_SUCCESS', url: 'https://google.com' });
      });
    });

    it('dispatches ATTACH_FAIL when attachToTab returns error', async () => {
      vi.mocked(attachToTab).mockResolvedValue({ ok: false, error: 'Cannot attach' });

      const dispatch = vi.fn();
      const screen = await renderToolbar({ attachedUrl: 'https://example.com', dispatch });

      const select = screen.container.querySelector('select[title="Switch tab"]') as HTMLSelectElement;
      select.dispatchEvent(new FocusEvent('focus', { bubbles: true }));

      await vi.waitFor(() => expect(select.querySelectorAll('option').length).toBe(2));

      await userEvent.selectOptions(select, 'https://google.com');

      await vi.waitFor(() => {
        expect(dispatch).toHaveBeenCalledWith({ type: 'ATTACH_FAIL' });
      });
    });

    it('filters out chrome:// and chrome-extension:// tabs', async () => {
      (window.chrome.tabs.query as ReturnType<typeof vi.fn>).mockResolvedValue([
        { id: 1, url: 'https://example.com', title: 'Example' },
        { id: 2, url: 'chrome://newtab/', title: 'New Tab' },
        { id: 3, url: 'chrome-extension://abc/panel.html', title: 'Panel' },
        { id: 4, url: 'about:blank', title: 'Blank' },
      ]);

      const screen = await renderToolbar();
      const select = screen.container.querySelector('select[title="Switch tab"]') as HTMLSelectElement;
      select.dispatchEvent(new FocusEvent('focus', { bubbles: true }));

      await vi.waitFor(() => {
        const options = select.querySelectorAll('option');
        expect(options.length).toBe(1);
        expect((options[0] as HTMLOptionElement).value).toBe('https://example.com');
      });
    });
  });
});
