import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

describe("content/recorder.js", () => {
  let debugSpy;

  beforeEach(() => {
    // Reset the recorder state
    delete window.__pwRecorderActive;
    delete window.__pwRecorderCleanup;

    // Spy on console.debug (the recorder uses it to send commands)
    debugSpy = vi.spyOn(console, "debug").mockImplementation(() => {});
  });

  afterEach(() => {
    // Clean up if recorder is active
    if (window.__pwRecorderCleanup) {
      window.__pwRecorderCleanup();
    }
    debugSpy.mockRestore();
  });

  it("sets __pwRecorderActive on load", async () => {
    await import("../content/recorder.js");
    expect(window.__pwRecorderActive).toBe(true);
  });

  it("provides a cleanup function", async () => {
    vi.resetModules();
    delete window.__pwRecorderActive;
    delete window.__pwRecorderCleanup;
    await import("../content/recorder.js");
    expect(typeof window.__pwRecorderCleanup).toBe("function");
  });

  it("does not run twice when __pwRecorderActive is set", async () => {
    window.__pwRecorderActive = true;
    const cleanupBefore = window.__pwRecorderCleanup;
    await import("../content/recorder.js");
    // Cleanup should not be set (skipped due to guard)
    expect(window.__pwRecorderCleanup).toBe(cleanupBefore);
  });

  it("cleanup resets __pwRecorderActive", async () => {
    vi.resetModules();
    delete window.__pwRecorderActive;
    delete window.__pwRecorderCleanup;
    await import("../content/recorder.js");
    expect(window.__pwRecorderActive).toBe(true);
    window.__pwRecorderCleanup();
    expect(window.__pwRecorderActive).toBe(false);
  });

  it("cleanup removes __pwRecorderCleanup", async () => {
    vi.resetModules();
    delete window.__pwRecorderActive;
    delete window.__pwRecorderCleanup;
    await import("../content/recorder.js");
    window.__pwRecorderCleanup();
    expect(window.__pwRecorderCleanup).toBeUndefined();
  });

  it("records click events", async () => {
    vi.resetModules();
    delete window.__pwRecorderActive;
    delete window.__pwRecorderCleanup;

    document.body.innerHTML = '<button id="test-btn">Submit</button>';

    await import("../content/recorder.js");

    const btn = document.getElementById("test-btn");
    btn.click();

    expect(debugSpy).toHaveBeenCalledWith("__pw:click \"Submit\"");
  });

  it("records checkbox check/uncheck", async () => {
    vi.resetModules();
    delete window.__pwRecorderActive;
    delete window.__pwRecorderCleanup;

    document.body.innerHTML = '<input type="checkbox" id="test-cb" aria-label="Accept">';

    await import("../content/recorder.js");

    const cb = document.getElementById("test-cb");
    cb.checked = true;
    cb.dispatchEvent(new Event("click", { bubbles: true }));

    expect(debugSpy).toHaveBeenCalledWith(
      expect.stringContaining("__pw:check")
    );
  });

  it("records special key presses", async () => {
    vi.resetModules();
    delete window.__pwRecorderActive;
    delete window.__pwRecorderCleanup;

    await import("../content/recorder.js");

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));

    expect(debugSpy).toHaveBeenCalledWith("__pw:press Enter");
  });

  it("records Tab key press", async () => {
    vi.resetModules();
    delete window.__pwRecorderActive;
    delete window.__pwRecorderCleanup;

    await import("../content/recorder.js");

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true }));

    expect(debugSpy).toHaveBeenCalledWith("__pw:press Tab");
  });

  it("records Escape key press", async () => {
    vi.resetModules();
    delete window.__pwRecorderActive;
    delete window.__pwRecorderCleanup;

    await import("../content/recorder.js");

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));

    expect(debugSpy).toHaveBeenCalledWith("__pw:press Escape");
  });

  it("does not record non-special key presses", async () => {
    vi.resetModules();
    delete window.__pwRecorderActive;
    delete window.__pwRecorderCleanup;

    await import("../content/recorder.js");

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "a", bubbles: true }));

    const pwCalls = debugSpy.mock.calls.filter(c => String(c[0]).startsWith("__pw:"));
    expect(pwCalls).toHaveLength(0);
  });

  it("skips clicks on text input elements", async () => {
    vi.resetModules();
    delete window.__pwRecorderActive;
    delete window.__pwRecorderCleanup;

    document.body.innerHTML = '<input type="text" id="test-input">';

    await import("../content/recorder.js");

    const input = document.getElementById("test-input");
    input.click();

    const pwCalls = debugSpy.mock.calls.filter(c => String(c[0]).startsWith("__pw:"));
    expect(pwCalls).toHaveLength(0);
  });

  it("skips clicks on textarea elements", async () => {
    vi.resetModules();
    delete window.__pwRecorderActive;
    delete window.__pwRecorderCleanup;

    document.body.innerHTML = '<textarea id="test-ta"></textarea>';

    await import("../content/recorder.js");

    document.getElementById("test-ta").click();

    const pwCalls = debugSpy.mock.calls.filter(c => String(c[0]).startsWith("__pw:"));
    expect(pwCalls).toHaveLength(0);
  });

  it("records input events as debounced fill commands", async () => {
    vi.resetModules();
    vi.useFakeTimers();
    delete window.__pwRecorderActive;
    delete window.__pwRecorderCleanup;

    document.body.innerHTML = '<input type="text" id="test-input" aria-label="Username">';

    await import("../content/recorder.js");

    const input = document.getElementById("test-input");
    input.value = "alice";
    input.dispatchEvent(new Event("input", { bubbles: true }));

    // Should not send immediately (debounced at 1500ms)
    const pwCallsBefore = debugSpy.mock.calls.filter(c => String(c[0]).startsWith("__pw:"));
    expect(pwCallsBefore).toHaveLength(0);

    // After debounce timer fires
    vi.advanceTimersByTime(1500);

    expect(debugSpy).toHaveBeenCalledWith(
      expect.stringContaining("__pw:fill")
    );
    expect(debugSpy).toHaveBeenCalledWith(
      expect.stringContaining("alice")
    );

    vi.useRealTimers();
  });

  it("records select changes", async () => {
    vi.resetModules();
    delete window.__pwRecorderActive;
    delete window.__pwRecorderCleanup;

    document.body.innerHTML = `
      <select id="test-sel" aria-label="Color">
        <option value="r">Red</option>
        <option value="b">Blue</option>
      </select>
    `;

    await import("../content/recorder.js");

    const sel = document.getElementById("test-sel");
    sel.value = "b";
    sel.dispatchEvent(new Event("change", { bubbles: true }));

    expect(debugSpy).toHaveBeenCalledWith(
      expect.stringContaining("__pw:select")
    );
  });

  it("records link clicks with text content", async () => {
    vi.resetModules();
    delete window.__pwRecorderActive;
    delete window.__pwRecorderCleanup;

    document.body.innerHTML = '<a href="#" id="test-link">About Us</a>';

    await import("../content/recorder.js");

    document.getElementById("test-link").click();

    expect(debugSpy).toHaveBeenCalledWith('__pw:click "About Us"');
  });

  it("uses aria-label for locator", async () => {
    vi.resetModules();
    delete window.__pwRecorderActive;
    delete window.__pwRecorderCleanup;

    document.body.innerHTML = '<button aria-label="Close dialog">X</button>';

    await import("../content/recorder.js");

    document.querySelector("button").click();

    expect(debugSpy).toHaveBeenCalledWith(
      expect.stringContaining('__pw:click "Close dialog"')
    );
  });

  // ─── getLocator: parent label ─────────────────────────────────────────────

  it("uses parent label text for locator", async () => {
    vi.resetModules();
    delete window.__pwRecorderActive;
    delete window.__pwRecorderCleanup;

    document.body.innerHTML = '<label>Full Name <input type="checkbox" id="cb"></label>';

    await import("../content/recorder.js");

    const cb = document.getElementById("cb");
    cb.checked = true;
    cb.dispatchEvent(new Event("click", { bubbles: true }));

    expect(debugSpy).toHaveBeenCalledWith(
      expect.stringContaining("Full Name")
    );
  });

  // ─── getLocator: button/link text, title, tag fallbacks ────────────────────

  it("uses title attribute as locator fallback", async () => {
    vi.resetModules();
    delete window.__pwRecorderActive;
    delete window.__pwRecorderCleanup;

    document.body.innerHTML = '<button title="Delete item"><svg></svg></button>';

    await import("../content/recorder.js");

    document.querySelector("button").click();

    expect(debugSpy).toHaveBeenCalledWith('__pw:click "Delete item"');
  });

  it("falls back to tag name when no other locator available", async () => {
    vi.resetModules();
    delete window.__pwRecorderActive;
    delete window.__pwRecorderCleanup;

    // Element with no text, no aria-label, no title, no id
    document.body.innerHTML = '<button id="test-empty"></button>';

    await import("../content/recorder.js");

    // Remove the id so getLocator falls through all branches
    const btn = document.getElementById("test-empty");
    btn.removeAttribute("id");
    btn.click();

    expect(debugSpy).toHaveBeenCalledWith('__pw:click "button"');
  });

  it("uses placeholder for input locator", async () => {
    vi.resetModules();
    vi.useFakeTimers();
    delete window.__pwRecorderActive;
    delete window.__pwRecorderCleanup;

    document.body.innerHTML = '<input type="text" placeholder="Search..." id="search">';

    await import("../content/recorder.js");

    const input = document.getElementById("search");
    input.value = "hello";
    input.dispatchEvent(new Event("input", { bubbles: true }));

    vi.advanceTimersByTime(1500);

    expect(debugSpy).toHaveBeenCalledWith(
      expect.stringContaining("Search...")
    );

    vi.useRealTimers();
  });

  // ─── getItemContext: scoped clicks ─────────────────────────────────────────

  it("records action button with item context", async () => {
    vi.resetModules();
    delete window.__pwRecorderActive;
    delete window.__pwRecorderCleanup;

    document.body.innerHTML = `
      <ul>
        <li>
          <span>Buy milk</span>
          <button id="del-btn">delete</button>
        </li>
      </ul>
    `;

    await import("../content/recorder.js");

    document.getElementById("del-btn").click();

    expect(debugSpy).toHaveBeenCalledWith(
      expect.stringContaining("Buy milk")
    );
  });

  // ─── findCheckbox: label with htmlFor ──────────────────────────────────────

  it("finds checkbox via label htmlFor", async () => {
    vi.resetModules();
    delete window.__pwRecorderActive;
    delete window.__pwRecorderCleanup;

    document.body.innerHTML = `
      <label for="terms-cb">Accept terms</label>
      <input type="checkbox" id="terms-cb">
    `;

    await import("../content/recorder.js");

    const label = document.querySelector("label");
    const cb = document.getElementById("terms-cb");
    cb.checked = true;
    label.click();

    expect(debugSpy).toHaveBeenCalledWith(
      expect.stringContaining("__pw:check")
    );
  });

  it("finds checkbox in parent label", async () => {
    vi.resetModules();
    delete window.__pwRecorderActive;
    delete window.__pwRecorderCleanup;

    document.body.innerHTML = `
      <label>
        <input type="checkbox" id="nested-cb">
        <span id="label-text">Enable notifications</span>
      </label>
    `;

    await import("../content/recorder.js");

    const cb = document.getElementById("nested-cb");
    cb.checked = true;
    // Click the span, which is inside the label
    document.getElementById("label-text").click();

    expect(debugSpy).toHaveBeenCalledWith(
      expect.stringContaining("__pw:check")
    );
  });

  // ─── checkbox with item context ────────────────────────────────────────────

  it("records checkbox with item context label", async () => {
    vi.resetModules();
    delete window.__pwRecorderActive;
    delete window.__pwRecorderCleanup;

    document.body.innerHTML = `
      <ul>
        <li>
          <label>Buy groceries</label>
          <input type="checkbox" id="task-cb">
        </li>
      </ul>
    `;

    await import("../content/recorder.js");

    const cb = document.getElementById("task-cb");
    cb.checked = true;
    cb.dispatchEvent(new Event("click", { bubbles: true }));

    expect(debugSpy).toHaveBeenCalledWith(
      expect.stringContaining("Buy groceries")
    );
  });

  // ─── skips non-interactive containers ──────────────────────────────────────

  it("skips clicks on non-interactive containers like div", async () => {
    vi.resetModules();
    delete window.__pwRecorderActive;
    delete window.__pwRecorderCleanup;

    document.body.innerHTML = '<div id="container">Some content</div>';

    await import("../content/recorder.js");

    document.getElementById("container").click();

    const pwCalls = debugSpy.mock.calls.filter(c => String(c[0]).startsWith("__pw:click"));
    expect(pwCalls).toHaveLength(0);
  });

  // ─── click flushes pending fill ────────────────────────────────────────────

  it("click flushes pending fill before recording click", async () => {
    vi.resetModules();
    vi.useFakeTimers();
    delete window.__pwRecorderActive;
    delete window.__pwRecorderCleanup;

    document.body.innerHTML = `
      <input type="text" id="name-input" aria-label="Name">
      <button id="submit-btn">Submit</button>
    `;

    await import("../content/recorder.js");

    const input = document.getElementById("name-input");
    input.value = "Alice";
    input.dispatchEvent(new Event("input", { bubbles: true }));

    // Click before debounce fires — should flush fill first
    document.getElementById("submit-btn").click();

    const pwCalls = debugSpy.mock.calls.filter(c => String(c[0]).startsWith("__pw:"));
    expect(pwCalls[0][0]).toContain("__pw:fill");
    expect(pwCalls[1][0]).toContain("__pw:click");

    vi.useRealTimers();
  });

  // ─── label[for] locator ────────────────────────────────────────────────────

  it("uses associated label text for locator via for attribute", async () => {
    vi.resetModules();
    vi.useFakeTimers();
    delete window.__pwRecorderActive;
    delete window.__pwRecorderCleanup;

    document.body.innerHTML = `
      <label for="email-input">Email Address</label>
      <input type="text" id="email-input">
    `;

    await import("../content/recorder.js");

    const input = document.getElementById("email-input");
    input.value = "test@test.com";
    input.dispatchEvent(new Event("input", { bubbles: true }));

    vi.advanceTimersByTime(1500);

    expect(debugSpy).toHaveBeenCalledWith(
      expect.stringContaining("Email Address")
    );

    vi.useRealTimers();
  });

  it("cleanup flushes pending fill", async () => {
    vi.resetModules();
    vi.useFakeTimers();
    delete window.__pwRecorderActive;
    delete window.__pwRecorderCleanup;

    document.body.innerHTML = '<input type="text" id="test-input" aria-label="Email">';

    await import("../content/recorder.js");

    const input = document.getElementById("test-input");
    input.value = "test@test.com";
    input.dispatchEvent(new Event("input", { bubbles: true }));

    // Cleanup should flush pending fill
    window.__pwRecorderCleanup();

    expect(debugSpy).toHaveBeenCalledWith(
      expect.stringContaining("__pw:fill")
    );

    vi.useRealTimers();
  });
});
