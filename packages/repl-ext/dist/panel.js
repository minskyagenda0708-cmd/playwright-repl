(function polyfill() {
  const relList = document.createElement("link").relList;
  if (relList && relList.supports && relList.supports("modulepreload")) {
    return;
  }
  for (const link of document.querySelectorAll('link[rel="modulepreload"]')) {
    processPreload(link);
  }
  new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (mutation.type !== "childList") {
        continue;
      }
      for (const node of mutation.addedNodes) {
        if (node.tagName === "LINK" && node.rel === "modulepreload")
          processPreload(node);
      }
    }
  }).observe(document, { childList: true, subtree: true });
  function getFetchOpts(link) {
    const fetchOpts = {};
    if (link.integrity) fetchOpts.integrity = link.integrity;
    if (link.referrerPolicy) fetchOpts.referrerPolicy = link.referrerPolicy;
    if (link.crossOrigin === "use-credentials")
      fetchOpts.credentials = "include";
    else if (link.crossOrigin === "anonymous") fetchOpts.credentials = "omit";
    else fetchOpts.credentials = "same-origin";
    return fetchOpts;
  }
  function processPreload(link) {
    if (link.ep)
      return;
    link.ep = true;
    const fetchOpts = getFetchOpts(link);
    fetch(link.href, fetchOpts);
  }
})();
const connectionDot = document.getElementById("connection-dot");
const connectionDomain = document.getElementById("connection-domain");
const output = document.getElementById("output");
const input = document.getElementById("command-input");
const editor = document.getElementById("editor");
const lineNumbers = document.getElementById("line-numbers");
const editorLines = document.getElementById("editor-lines");
const consoleStats = document.getElementById("console-stats");
const attachBtn = document.getElementById("attach-btn");
const runBtn = document.getElementById("run-btn");
const stepBtn = document.getElementById("step-btn");
const copyBtn = document.getElementById("copy-btn");
const cmdHistory = [];
let cmdHistoryIndex = -1;
let passed = 0;
let failed = 0;
let stepIndex = 0;
async function attach() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!(tab == null ? void 0 : tab.id)) {
    appendOutput("No active tab found.", "error");
    return;
  }
  connectionDomain.textContent = "Attaching...";
  attachBtn.disabled = true;
  const result = await chrome.runtime.sendMessage({ type: "attach", tabId: tab.id });
  attachBtn.disabled = false;
  if (result.ok) {
    connectionDot.classList.add("connected");
    try {
      connectionDomain.textContent = new URL(result.url).hostname;
    } catch {
      connectionDomain.textContent = result.url;
    }
  } else {
    connectionDot.classList.remove("connected");
    connectionDomain.textContent = "Failed";
    appendOutput(`Attach failed: ${result.error}`, "error");
  }
}
attachBtn.addEventListener("click", attach);
function updateLineNumbers() {
  const lines = editor.value.split("\n");
  const count = lines.length || 1;
  lineNumbers.innerHTML = Array.from(
    { length: count },
    (_, i) => `<div>${i + 1}</div>`
  ).join("");
  editorLines.textContent = `${count} line${count !== 1 ? "s" : ""}`;
}
editor.addEventListener("input", updateLineNumbers);
editor.addEventListener("scroll", () => {
  lineNumbers.scrollTop = editor.scrollTop;
});
updateLineNumbers();
runBtn.addEventListener("click", async () => {
  const lines = editor.value.split("\n").filter((l) => l.trim() && !l.trim().startsWith("#"));
  if (!lines.length) return;
  runBtn.disabled = true;
  stepIndex = 0;
  for (const line of lines) {
    await runCommand(line.trim());
  }
  runBtn.disabled = false;
});
stepBtn.addEventListener("click", async () => {
  const lines = editor.value.split("\n").filter((l) => l.trim() && !l.trim().startsWith("#"));
  if (stepIndex >= lines.length) {
    stepIndex = 0;
    return;
  }
  stepBtn.disabled = true;
  await runCommand(lines[stepIndex].trim());
  stepIndex++;
  stepBtn.disabled = false;
});
copyBtn.addEventListener("click", () => {
  const text = editor.value || output.textContent || "";
  navigator.clipboard.writeText(text);
});
input.addEventListener("keydown", async (e) => {
  if (e.key === "ArrowUp") {
    e.preventDefault();
    if (cmdHistoryIndex < cmdHistory.length - 1) {
      cmdHistoryIndex++;
      input.value = cmdHistory[cmdHistory.length - 1 - cmdHistoryIndex];
    }
    return;
  }
  if (e.key === "ArrowDown") {
    e.preventDefault();
    if (cmdHistoryIndex > 0) {
      cmdHistoryIndex--;
      input.value = cmdHistory[cmdHistory.length - 1 - cmdHistoryIndex];
    } else {
      cmdHistoryIndex = -1;
      input.value = "";
    }
    return;
  }
  if (e.key !== "Enter") return;
  const command = input.value.trim();
  if (!command) return;
  cmdHistory.push(command);
  cmdHistoryIndex = -1;
  input.value = "";
  await runCommand(command);
});
async function runCommand(command) {
  appendOutput(`> ${command}`, "command");
  input.disabled = true;
  const result = await chrome.runtime.sendMessage({ type: "run", command });
  input.disabled = false;
  input.focus();
  if (result.text.startsWith("data:image/")) {
    const img = document.createElement("img");
    img.src = result.text;
    img.className = "screenshot";
    output.appendChild(img);
  } else {
    appendOutput(result.text, result.isError ? "error" : "success");
  }
  if (result.isError) failed++;
  else passed++;
  updateStats();
}
function updateStats() {
  consoleStats.innerHTML = `<span>${passed} passed</span>${failed ? ` / <span class="failed">${failed} failed</span>` : ""}`;
}
function appendOutput(text, className) {
  const pre = document.createElement("pre");
  pre.className = className;
  pre.textContent = text;
  output.appendChild(pre);
  output.scrollTop = output.scrollHeight;
}
//# sourceMappingURL=panel.js.map
