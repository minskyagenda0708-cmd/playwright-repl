// ─── DOM Elements ───

const connectionDot = document.getElementById('connection-dot') as HTMLSpanElement;
const connectionDomain = document.getElementById('connection-domain') as HTMLSpanElement;
const output = document.getElementById('output') as HTMLDivElement;
const input = document.getElementById('command-input') as HTMLInputElement;
const editor = document.getElementById('editor') as HTMLTextAreaElement;
const lineNumbers = document.getElementById('line-numbers') as HTMLDivElement;
const editorLines = document.getElementById('editor-lines') as HTMLSpanElement;
const consoleStats = document.getElementById('console-stats') as HTMLSpanElement;

// Toolbar
const attachBtn = document.getElementById('attach-btn') as HTMLButtonElement;
const runBtn = document.getElementById('run-btn') as HTMLButtonElement;
const stepBtn = document.getElementById('step-btn') as HTMLButtonElement;
const copyBtn = document.getElementById('copy-btn') as HTMLButtonElement;

// ─── State ───

const cmdHistory: string[] = [];
let cmdHistoryIndex = -1;
let passed = 0;
let failed = 0;
let stepIndex = 0;

// ─── Attach ───

async function attach() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) {
    appendOutput('No active tab found.', 'error');
    return;
  }
  connectionDomain.textContent = 'Attaching...';
  attachBtn.disabled = true;
  const result = await chrome.runtime.sendMessage({ type: 'attach', tabId: tab.id });
  attachBtn.disabled = false;
  if (result.ok) {
    connectionDot.classList.add('connected');
    try {
      connectionDomain.textContent = new URL(result.url).hostname;
    } catch {
      connectionDomain.textContent = result.url;
    }
  } else {
    connectionDot.classList.remove('connected');
    connectionDomain.textContent = 'Failed';
    appendOutput(`Attach failed: ${result.error}`, 'error');
  }
}

attachBtn.addEventListener('click', attach);

// ─── Editor ───

function updateLineNumbers() {
  const lines = editor.value.split('\n');
  const count = lines.length || 1;
  lineNumbers.innerHTML = Array.from({ length: count }, (_, i) =>
    `<div>${i + 1}</div>`
  ).join('');
  editorLines.textContent = `${count} line${count !== 1 ? 's' : ''}`;
}

editor.addEventListener('input', updateLineNumbers);
editor.addEventListener('scroll', () => {
  lineNumbers.scrollTop = editor.scrollTop;
});
updateLineNumbers();

// ─── Toolbar: Run ───

runBtn.addEventListener('click', async () => {
  const lines = editor.value.split('\n').filter(l => l.trim() && !l.trim().startsWith('#'));
  if (!lines.length) return;

  runBtn.disabled = true;
  stepIndex = 0;
  for (const line of lines) {
    await runCommand(line.trim());
  }
  runBtn.disabled = false;
});

// ─── Toolbar: Step ───

stepBtn.addEventListener('click', async () => {
  const lines = editor.value.split('\n').filter(l => l.trim() && !l.trim().startsWith('#'));
  if (stepIndex >= lines.length) {
    stepIndex = 0;
    return;
  }

  stepBtn.disabled = true;
  await runCommand(lines[stepIndex].trim());
  stepIndex++;
  stepBtn.disabled = false;
});

// ─── Toolbar: Copy ───

copyBtn.addEventListener('click', () => {
  const text = editor.value || output.textContent || '';
  navigator.clipboard.writeText(text);
});

// ─── Console: Command Input ───

input.addEventListener('keydown', async (e) => {
  if (e.key === 'ArrowUp') {
    e.preventDefault();
    if (cmdHistoryIndex < cmdHistory.length - 1) {
      cmdHistoryIndex++;
      input.value = cmdHistory[cmdHistory.length - 1 - cmdHistoryIndex];
    }
    return;
  }
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    if (cmdHistoryIndex > 0) {
      cmdHistoryIndex--;
      input.value = cmdHistory[cmdHistory.length - 1 - cmdHistoryIndex];
    } else {
      cmdHistoryIndex = -1;
      input.value = '';
    }
    return;
  }

  if (e.key !== 'Enter') return;
  const command = input.value.trim();
  if (!command) return;

  cmdHistory.push(command);
  cmdHistoryIndex = -1;
  input.value = '';
  await runCommand(command);
});

// ─── Run a single command ───

async function runCommand(command: string) {
  appendOutput(`> ${command}`, 'command');

  input.disabled = true;
  const result = await chrome.runtime.sendMessage({ type: 'run', command });
  input.disabled = false;
  input.focus();

  if (result.text.startsWith('data:image/')) {
    const img = document.createElement('img');
    img.src = result.text;
    img.className = 'screenshot';
    output.appendChild(img);
  } else {
    appendOutput(result.text, result.isError ? 'error' : 'success');
  }

  if (result.isError) failed++;
  else passed++;
  updateStats();
}

function updateStats() {
  consoleStats.innerHTML = `<span>${passed} passed</span>${failed ? ` / <span class="failed">${failed} failed</span>` : ''}`;
}

function appendOutput(text: string, className: string) {
  const pre = document.createElement('pre');
  pre.className = className;
  pre.textContent = text;
  output.appendChild(pre);
  output.scrollTop = output.scrollHeight;
}
