# Architecture Reference

## 1. Regular Playwright MCP

Playwright launches its own browser. Direct CDP connection.

```mermaid
sequenceDiagram
    participant LLM as LLM (Claude, etc.)
    participant MCP as Playwright MCP Server
    participant PW as Playwright
    participant BR as Browser (launched)

    LLM->>MCP: tool call: browser_click({ref:"e5"})
    MCP->>PW: execute tool
    PW->>BR: CDP: Input.dispatchMouseEvent
    BR-->>PW: done
    PW-->>MCP: result
    MCP-->>LLM: "Clicked"
```

Playwright owns the browser — talks to it directly via CDP WebSocket.

## 2. Playwright MCP with MCP Bridge Extension

Playwright can't launch the user's browser. Needs the bridge extension to relay CDP.

```mermaid
sequenceDiagram
    participant LLM as LLM (Claude, etc.)
    participant MCP as Playwright MCP Server
    participant PW as Playwright
    participant RELAY as CDPRelayServer
    participant BRIDGE as MCP Bridge Extension
    participant TAB as User's Browser Tab

    BRIDGE->>RELAY: WebSocket connect /extension
    PW->>RELAY: WebSocket connect /devtools/browser/{uuid}

    LLM->>MCP: tool call: browser_click({ref:"e5"})
    MCP->>PW: execute tool
    PW->>RELAY: CDP: Input.dispatchMouseEvent
    RELAY->>BRIDGE: forwardCDPCommand
    BRIDGE->>TAB: chrome.debugger.sendCommand
    TAB-->>BRIDGE: done
    BRIDGE-->>RELAY: result
    RELAY-->>PW: result
    PW-->>MCP: result
    MCP-->>LLM: "Clicked"
```

Same CDP messages, but relayed through the bridge because Playwright has no direct connection to the user's browser.

## 3. Our Extension (playwright-repl --extension)

Same as diagram 2, but our background.js replaces the MCP Bridge, and the user types commands instead of an LLM.

```mermaid
sequenceDiagram
    participant BG as background.js
    participant CS as CommandServer
    participant ENG as Engine
    participant PW as Playwright
    participant TAB as Browser Tab

    BG->>CS: POST /run "click e5"
    CS->>ENG: engine.run()
    ENG->>PW: callTool("browser_click")
    PW->>CS: CDP: dispatchMouseEvent
    CS->>BG: forwardCDPCommand
    BG->>TAB: chrome.debugger.sendCommand
    TAB-->>BG: done
    BG-->>CS: result
    CS-->>PW: result
    PW-->>ENG: "Clicked"
    ENG-->>CS: {text:"Clicked"}
    CS-->>BG: HTTP 200
```
