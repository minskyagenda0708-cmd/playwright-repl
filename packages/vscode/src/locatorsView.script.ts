/**
 * Copyright (c) Microsoft Corporation.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { createAction, vscode } from './common';

// @ts-check
const pickBtn = document.getElementById('pickBtn') as HTMLButtonElement;
const locatorInput = document.getElementById('locator') as HTMLInputElement;
const assertionInput = document.getElementById('assertion') as HTMLInputElement;
const highlightSwitch = document.getElementById('highlightSwitch') as HTMLInputElement;
const verifyBtn = document.getElementById('verifyBtn') as HTMLButtonElement;
const ariaTextArea = document.getElementById('ariaSnapshot') as HTMLTextAreaElement;

locatorInput.addEventListener('input', () => {
  vscode.postMessage({ method: 'locatorChanged', params: { locator: locatorInput.value } });
});

ariaTextArea.addEventListener('input', () => {
  vscode.postMessage({ method: 'ariaSnapshotChanged', params: { ariaSnapshot: ariaTextArea.value } });
});

assertionInput.addEventListener('input', () => {
  vscode.postMessage({ method: 'assertionChanged', params: { assertion: assertionInput.value } });
});

pickBtn.addEventListener('click', () => {
  vscode.postMessage({ method: 'execute', params: { command: 'playwright-repl.pickLocator' } });
});

highlightSwitch.addEventListener('change', () => {
  vscode.postMessage({ method: 'highlight' });
});

verifyBtn.addEventListener('click', () => {
  vscode.postMessage({ method: 'verify' });
});

window.addEventListener('message', event => {
  const locatorError = document.getElementById('locatorError')!;
  const ariaSnapshotError = document.getElementById('ariaSnapshotError')!;
  const ariaSection = document.getElementById('ariaSection')!;
  const actionsElement = document.getElementById('actions')!;
  const actions2Element = document.getElementById('actions-2')!;

  const { method, params } = event.data;
  if (method === 'update') {
    locatorInput.value = params.locator.locator;
    locatorError.textContent = params.locator.error || '';
    locatorError.style.display = params.locator.error ? 'inherit' : 'none';
    assertionInput.value = params.assertion || '';
    const assertionSection = document.getElementById('assertionSection')!;
    assertionSection.style.display = params.assertion ? 'flex' : 'none';
    const verifyResult = document.getElementById('verifyResult')!;
    verifyResult.style.display = 'none';
    ariaTextArea.value = params.ariaSnapshot.yaml;
    ariaSnapshotError.textContent = params.ariaSnapshot.error || '';
    ariaSnapshotError.style.display = params.ariaSnapshot.error ? 'inherit' : 'none';
    ariaSection.style.display = params.hideAria ? 'none' : 'flex';
  } else if (method === 'actions') {
    actionsElement.textContent = '';
    actions2Element.textContent = '';
    for (const action of params.actions) {
      const actionElement = createAction(action, { omitText: true });
      if (actionElement)
        (action.location === 'actions-2' ? actions2Element : actionsElement).appendChild(actionElement);
    }
  } else if (method === 'highlightState') {
    highlightSwitch.checked = params.active;
  } else if (method === 'verifyProcessing') {
    verifyBtn.disabled = params.processing;
    verifyBtn.textContent = params.processing ? 'Verifying...' : 'Verify';
    const verifyResult = document.getElementById('verifyResult')!;
    if (params.processing) {
      verifyResult.style.display = 'inline';
      verifyResult.textContent = '...';
      verifyResult.style.color = 'var(--vscode-descriptionForeground)';
    }
  } else if (method === 'verifyResult') {
    const verifyResult = document.getElementById('verifyResult')!;
    verifyResult.style.display = 'inline';
    verifyResult.style.userSelect = 'text';
    if (params.passed) {
      verifyResult.textContent = '✓ Passed';
      verifyResult.style.color = 'var(--vscode-terminal-ansiGreen)';
      verifyResult.title = '';
    } else {
      const full = (params.error || 'Assertion failed').replace(/^### \w[\w ]*\n/gm, '').trim();
      // Extract Expected/Received — handles both "Expected: x" and "Expected string: x"
      const expectedMatch = full.match(/Expected\s*(?:string)?:\s*(.+)/);
      const receivedMatch = full.match(/Received\s*(?:string)?:\s*(.+)/);
      const timeoutMatch = full.match(/Timed out (\d+)ms/);
      let short: string;
      if (expectedMatch && receivedMatch) {
        short = `expected: ${expectedMatch[1].trim()}, received: ${receivedMatch[1].trim()}`;
      } else if (timeoutMatch && expectedMatch) {
        short = `Timed out (${timeoutMatch[1]}ms), expected: ${expectedMatch[1].trim()}`;
      } else if (timeoutMatch) {
        short = `Timed out (${timeoutMatch[1]}ms)`;
      } else {
        const msgMatch = full.match(/Error:\s*(.+?)(?:\n|$)/);
        short = msgMatch ? msgMatch[1].trim() : (full.split('\n')[0] || 'Assertion failed');
      }
      if (short.length > 80) short = short.slice(0, 80) + '...';
      verifyResult.textContent = '✗ ' + short;
      verifyResult.style.color = 'var(--vscode-terminal-ansiRed)';
      verifyResult.title = full;
    }
  }
});
