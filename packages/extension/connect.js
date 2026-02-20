const params = new URLSearchParams(window.location.search);
const mcpRelayUrl = params.get('mcpRelayUrl');
const clientRaw = params.get('client') || '{}';
const newTab = params.get('newTab') === 'true';
const token = params.get('token');

const statusEl = document.getElementById('status');
const buttonsEl = document.getElementById('buttons');
const tabSectionEl = document.getElementById('tab-section');

let clientInfo = 'unknown';
try {
  const client = JSON.parse(clientRaw);
  clientInfo = `${client.name}/${client.version}`;
} catch (e) {}

function showStatus(type, message) {
  statusEl.className = `status ${type}`;
  statusEl.textContent = message;
}

function showError(message) {
  showStatus('error', message);
  buttonsEl.innerHTML = '';
  tabSectionEl.innerHTML = '';
}

async function connectToMCPRelay() {
  const response = await chrome.runtime.sendMessage({ type: 'connectToMCPRelay', mcpRelayUrl });
  if (!response.success) {
    showError(response.error);
    return false;
  }
  return true;
}

async function connectToTab(tabId, windowId) {
  buttonsEl.innerHTML = '';
  tabSectionEl.innerHTML = '';

  try {
    const response = await chrome.runtime.sendMessage({
      type: 'connectToTab',
      mcpRelayUrl,
      tabId,
      windowId,
    });

    if (response?.success) {
      showStatus('connected', `MCP client "${clientInfo}" connected.`);
    } else {
      showError(response?.error || `MCP client "${clientInfo}" failed to connect.`);
    }
  } catch (e) {
    showError(`MCP client "${clientInfo}" failed to connect: ${e}`);
  }
}

async function loadTabs() {
  const response = await chrome.runtime.sendMessage({ type: 'getTabs' });
  if (!response.success) {
    showError('Failed to load tabs: ' + response.error);
    return;
  }

  tabSectionEl.innerHTML = '<h3>Select page to expose to MCP server:</h3>';
  for (const tab of response.tabs) {
    const item = document.createElement('div');
    item.className = 'tab-item';
    const titleDiv = document.createElement('div');
    titleDiv.style.cssText = 'flex:1;min-width:0';
    const titleText = document.createElement('div');
    titleText.className = 'tab-title';
    titleText.textContent = tab.title || '';
    const urlText = document.createElement('div');
    urlText.className = 'tab-url';
    urlText.textContent = tab.url || '';
    titleDiv.append(titleText, urlText);
    const btn = document.createElement('button');
    btn.className = 'btn-connect';
    btn.textContent = 'Connect';
    btn.onclick = () => connectToTab(tab.id, tab.windowId);
    item.append(titleDiv, btn);
    tabSectionEl.appendChild(item);
  }
}

// Listen for connection timeout
chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'connectionTimeout')
    showError('Connection timed out.');
});

// ── Main flow ──
async function main() {
  if (!mcpRelayUrl) {
    showError('Missing mcpRelayUrl parameter in URL.');
    return;
  }

  try {
    const host = new URL(mcpRelayUrl).hostname;
    if (host !== '127.0.0.1' && host !== '[::1]') {
      showError(`Only loopback connections allowed. Received host: ${host}`);
      return;
    }
  } catch (e) {
    showError(`Invalid mcpRelayUrl: ${mcpRelayUrl}`);
    return;
  }

  showStatus('connecting', `Playwright MCP started from "${clientInfo}" is trying to connect.`);

  const ok = await connectToMCPRelay();
  if (!ok) return;

  if (newTab) {
    const allowBtn = document.createElement('button');
    allowBtn.className = 'btn-allow';
    allowBtn.textContent = 'Allow';
    allowBtn.onclick = () => connectToTab();
    const rejectBtn = document.createElement('button');
    rejectBtn.className = 'btn-reject';
    rejectBtn.textContent = 'Reject';
    rejectBtn.onclick = () => showError('Connection rejected. This tab can be closed.');
    buttonsEl.append(allowBtn, rejectBtn);
  } else {
    const rejectBtn = document.createElement('button');
    rejectBtn.className = 'btn-reject';
    rejectBtn.textContent = 'Reject';
    rejectBtn.onclick = () => showError('Connection rejected. This tab can be closed.');
    buttonsEl.appendChild(rejectBtn);
    await loadTabs();
  }
}

main();
