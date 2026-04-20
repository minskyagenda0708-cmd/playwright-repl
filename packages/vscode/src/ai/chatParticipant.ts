/**
 * Chat Participant — registers @playwright-repl in Copilot Chat.
 *
 * Reuses the existing aiAssist() agent loop and tools. The Chat Participant
 * API handles streaming, markdown, code blocks, follow-ups, and history.
 */

import type * as vscodeTypes from '../vscodeTypes';
import type { IBrowserManager } from '../browser';
import { aiAssist, type AgentEvent, type AiAssistOptions } from './agent';

/** Strip ANSI escape codes from terminal output. */
function stripAnsi(text: string): string {
  return text.replace(/\x1b\[[0-9;]*[a-zA-Z]|\[[\d;]*[A-Za-z]/g, '');
}

export function registerChatParticipant(
  vscode: vscodeTypes.VSCode,
  extensionUri: vscodeTypes.Uri,
  getBrowserManager: () => IBrowserManager | undefined,
  logger?: vscodeTypes.LogOutputChannel,
): vscodeTypes.Disposable {
  // Chat Participant API may not be available (e.g. in mock tests, older VS Code)
  if (!(vscode as any).chat?.createChatParticipant) {
    logger?.info('[Chat Participant] vscode.chat API not available — skipping registration');
    return { dispose() {} } as vscodeTypes.Disposable;
  }

  const participant = (vscode as any).chat.createChatParticipant(
    'playwright-repl.assistant',
    async (
      request: any,
      context: any,
      stream: any,
      token: vscodeTypes.CancellationToken,
    ) => {
      const log = (msg: string) => logger?.info(`[Chat Participant] ${msg}`);
      const command = request.command as string | undefined;
      log(`Command: ${command || '(none)'}, Prompt: ${request.prompt}`);

      // Get the active editor — may be undefined if no file is open
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        stream.markdown('No active editor. Open a test file first.');
        return;
      }

      const browserManager = getBrowserManager();
      if (browserManager)
        log('Browser running — will reuse for snapshot/run_command');
      else
        log('No browser — running headless (run_test only)');

      // Map slash commands to specific prompts
      const commandPrompts: Record<string, string> = {
        fix: 'Fix this test until it passes. Run the test, diagnose failures, fix the code, and verify it passes.',
        improve: 'Polish this test: improve locators, assertions, and readability. Follow Playwright best practices.',
        verify: 'Run the test and lint. Report the results — do not modify the code.',
        review: 'Review this test for anti-patterns, flaky patterns, missing assertions, and issues. Report findings.',
      };

      const isGenerate = command === 'generate';
      const userPrompt = isGenerate
        ? (request.prompt?.trim() || 'the current page')
        : command
          ? (commandPrompts[command] + (request.prompt ? ` ${request.prompt}` : ''))
          : (request.prompt?.trim() || undefined);
      const assistOptions: AiAssistOptions | undefined = isGenerate ? { generate: true } : undefined;

      // Map AgentEvent to Chat stream
      const onEvent = (event: AgentEvent) => {
        switch (event.type) {
          case 'text':
            stream.markdown(event.value);
            break;
          case 'toolCallStart':
            stream.progress(`Running ${event.name}...`);
            break;
          case 'toolCallEnd':
            stream.markdown(`\n\n**${event.name}** result:\n\`\`\`\n${stripAnsi(event.result)}\n\`\`\`\n\n`);
            break;
          case 'iteration':
            stream.progress(`Iteration ${event.current}/${event.max}`);
            break;
          case 'verifyStart':
            stream.progress(`Verifying: "${event.testName}"...`);
            break;
          case 'verifyEnd':
            stream.markdown(event.passed
              ? `\n\n✓ Test passed: "${event.testName}"\n\n`
              : `\n\n✗ Test failed: "${event.testName}"\n\`\`\`\n${stripAnsi(event.output)}\n\`\`\`\n\n`,
            );
            break;
          case 'codeApplied':
            stream.markdown('\n\n✓ Code applied to editor.\n');
            break;
          case 'done':
            if (event.summary && event.summary !== 'Done.')
              stream.markdown(`\n\n${event.summary}\n`);
            break;
          case 'error':
            stream.markdown(`\n\n**Error:** ${event.message}\n`);
            break;
        }
      };

      try {
        await aiAssist(
          vscode, editor, browserManager,
          logger, userPrompt,
          onEvent, token, assistOptions,
        );
      } catch (e: unknown) {
        const msg = (e as Error).message || '';
        if (msg.includes('Cancelled') || msg.includes('canceled') || msg.includes('no choices'))
          return;
        stream.markdown(`\n\n**Error:** ${msg}\n`);
      }
    },
  );

  // Follow-up suggestions after each response
  participant.followupProvider = {
    provideFollowups(_result: any, _context: any, _token: vscodeTypes.CancellationToken) {
      return [
        { prompt: 'Run lint and show me the results', label: 'Lint' },
        { prompt: 'Run the test and fix if it fails', label: 'Fix test' },
        { prompt: 'Polish this test with better locators and assertions', label: 'Polish' },
      ];
    },
  };

  participant.iconPath = vscode.Uri.joinPath(extensionUri, 'images', 'dramaturg-icon.png');

  return participant;
}
