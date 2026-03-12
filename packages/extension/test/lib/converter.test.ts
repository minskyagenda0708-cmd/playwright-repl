import { describe, it, expect } from "vitest";
import { jsonlToRepl } from "@/lib/converter.js";

// ─── helpers ─────────────────────────────────────────────────────────────────

function jsonl(obj: object): string {
  return JSON.stringify(obj);
}

// Selector helpers — build internal selector strings matching Playwright's format
function roleSelector(role: string, name?: string): string {
  return name ? `internal:role=${role}[name="${name}"s]` : `internal:role=${role}`;
}

function labelSelector(label: string): string {
  return `internal:label="${label}"s`;
}

function textSelector(text: string): string {
  return `internal:text="${text}"i`;
}

// ─── jsonlToRepl ─────────────────────────────────────────────────────────────

describe("jsonlToRepl", () => {
  // assertVisible
  it("converts assertVisible with role locator to verify-visible", () => {
    const action = jsonl({ name: "assertVisible", selector: roleSelector("button", "Submit") });
    expect(jsonlToRepl(action, false)).toBe('verify-visible button "Submit"');
  });

  it("converts assertVisible with text locator to verify text", () => {
    const action = jsonl({ name: "assertVisible", selector: textSelector("Welcome") });
    expect(jsonlToRepl(action, false)).toBe('verify text "Welcome"');
  });

  it("converts assertVisible with CSS selector to verify text", () => {
    const action = jsonl({ name: "assertVisible", selector: ".foo" });
    expect(jsonlToRepl(action, false)).toBe('verify text ".foo"');
  });

  it("returns null for assertVisible with no selector", () => {
    const action = jsonl({ name: "assertVisible" });
    expect(jsonlToRepl(action, false)).toBeNull();
  });

  // assertText
  it("converts assertText to verify text", () => {
    const action = jsonl({ name: "assertText", selector: textSelector("Hello"), text: "Hello", substring: true });
    expect(jsonlToRepl(action, false)).toBe('verify text "Hello"');
  });

  it("returns null for assertText with no text field", () => {
    const action = jsonl({ name: "assertText", selector: textSelector(""), text: "" });
    expect(jsonlToRepl(action, false)).toBeNull();
  });

  // assertValue
  it("converts assertValue with label locator to verify-value", () => {
    const action = jsonl({ name: "assertValue", selector: labelSelector("Email"), value: "user@example.com" });
    expect(jsonlToRepl(action, false)).toBe('verify-value "Email" "user@example.com"');
  });

  it("converts assertValue with role locator to verify-value", () => {
    const action = jsonl({ name: "assertValue", selector: roleSelector("spinbutton", "Quantity"), value: "5" });
    expect(jsonlToRepl(action, false)).toBe('verify-value "Quantity" "5"');
  });

  it("converts assertValue with CSS selector to verify-value", () => {
    const action = jsonl({ name: "assertValue", selector: ".input", value: "5" });
    expect(jsonlToRepl(action, false)).toBe('verify-value ".input" "5"');
  });

  it("returns null for assertValue with no selector", () => {
    const action = jsonl({ name: "assertValue", value: "5" });
    expect(jsonlToRepl(action, false)).toBeNull();
  });

  // assertChecked
  it("converts assertChecked checked=true to verify-value checked", () => {
    const action = jsonl({ name: "assertChecked", selector: labelSelector("Accept terms"), checked: true });
    expect(jsonlToRepl(action, false)).toBe('verify-value "Accept terms" "checked"');
  });

  it("converts assertChecked checked=false to verify-value unchecked", () => {
    const action = jsonl({ name: "assertChecked", selector: labelSelector("Newsletter"), checked: false });
    expect(jsonlToRepl(action, false)).toBe('verify-value "Newsletter" "unchecked"');
  });

  it("converts assertChecked with CSS selector to verify-value", () => {
    const action = jsonl({ name: "assertChecked", selector: ".input", checked: true });
    expect(jsonlToRepl(action, false)).toBe('verify-value ".input" "checked"');
  });

  it("returns null for assertChecked with no selector", () => {
    const action = jsonl({ name: "assertChecked", checked: true });
    expect(jsonlToRepl(action, false)).toBeNull();
  });

  // ─── openPage / closePage ───────────────────────────────────────────────

  it("converts openPage with URL to goto", () => {
    const action = jsonl({ name: "openPage", url: "https://example.com" });
    expect(jsonlToRepl(action, false)).toBe('goto "https://example.com"');
  });

  it("converts openPage with about:blank to comment", () => {
    const action = jsonl({ name: "openPage", url: "about:blank" });
    expect(jsonlToRepl(action, false)).toBe("# new tab opened");
  });

  it("converts openPage with chrome://newtab/ to comment", () => {
    const action = jsonl({ name: "openPage", url: "chrome://newtab/" });
    expect(jsonlToRepl(action, false)).toBe("# new tab opened");
  });

  it("converts openPage with no URL to comment", () => {
    const action = jsonl({ name: "openPage" });
    expect(jsonlToRepl(action, false)).toBe("# new tab opened");
  });

  it("converts closePage to comment", () => {
    const action = jsonl({ name: "closePage" });
    expect(jsonlToRepl(action, false)).toBe("# tab closed");
  });

  // ─── click ──────────────────────────────────────────────────────────────

  it("converts click with role locator", () => {
    const action = jsonl({ name: "click", selector: roleSelector("button", "Submit") });
    expect(jsonlToRepl(action, false)).toBe('click "Submit"');
  });

  it("skips click on textbox (focus-click noise)", () => {
    const action = jsonl({ name: "click", selector: roleSelector("textbox", "Name") });
    expect(jsonlToRepl(action, false)).toBeNull();
  });

  it("converts click with role locator but no name to CSS selector", () => {
    const action = jsonl({ name: "click", selector: "nav.main" });
    expect(jsonlToRepl(action, false)).toBe('click "nav.main"');
  });

  it("converts click with CSS selector", () => {
    const action = jsonl({ name: "click", selector: ".my-btn" });
    expect(jsonlToRepl(action, false)).toBe('click ".my-btn"');
  });

  it("skips click on html/body elements", () => {
    const action = jsonl({ name: "click", selector: "html" });
    expect(jsonlToRepl(action, false)).toBeNull();
  });

  it("returns null for click with no usable locator", () => {
    const action = jsonl({ name: "click", selector: "" });
    expect(jsonlToRepl(action, false)).toBeNull();
  });

  // ─── fill ──────────────────────────────────────────────────────────────

  it("converts fill with label locator", () => {
    const action = jsonl({ name: "fill", text: "Alice", selector: labelSelector("Name") });
    expect(jsonlToRepl(action, false)).toBe('fill "Name" "Alice"');
  });

  it("converts fill with role locator (no name) to CSS selector", () => {
    const action = jsonl({ name: "fill", text: "test", selector: "input.email" });
    expect(jsonlToRepl(action, false)).toBe('fill "input.email" "test"');
  });

  it("converts fill with CSS selector", () => {
    const action = jsonl({ name: "fill", text: "val", selector: "#input" });
    expect(jsonlToRepl(action, false)).toBe('fill "#input" "val"');
  });

  it("returns null for fill with no locator", () => {
    const action = jsonl({ name: "fill", text: "val" });
    expect(jsonlToRepl(action, false)).toBeNull();
  });

  // ─── press ─────────────────────────────────────────────────────────────

  it("converts press with label locator", () => {
    const action = jsonl({ name: "press", key: "Enter", selector: labelSelector("Search") });
    expect(jsonlToRepl(action, false)).toBe('press "Search" Enter');
  });

  it("converts press with role locator (no name) to global key press", () => {
    const action = jsonl({ name: "press", key: "Tab", selector: "input.email" });
    expect(jsonlToRepl(action, false)).toBe('press "input.email" Tab');
  });

  it("converts global key press (no locator)", () => {
    const action = jsonl({ name: "press", key: "Escape" });
    expect(jsonlToRepl(action, false)).toBe("press Escape");
  });

  it("returns null for press with no key and no locator", () => {
    const action = jsonl({ name: "press" });
    expect(jsonlToRepl(action, false)).toBeNull();
  });

  // ─── hover ─────────────────────────────────────────────────────────────

  it("converts hover with text locator", () => {
    const action = jsonl({ name: "hover", selector: textSelector("Menu") });
    expect(jsonlToRepl(action, false)).toBe('hover "Menu"');
  });

  it("converts hover with role locator (no name) to CSS selector", () => {
    const action = jsonl({ name: "hover", selector: "a.nav-link" });
    expect(jsonlToRepl(action, false)).toBe('hover "a.nav-link"');
  });

  it("converts hover with CSS selector", () => {
    const action = jsonl({ name: "hover", selector: ".tooltip" });
    expect(jsonlToRepl(action, false)).toBe('hover ".tooltip"');
  });

  it("returns null for hover with no locator", () => {
    const action = jsonl({ name: "hover" });
    expect(jsonlToRepl(action, false)).toBeNull();
  });

  // ─── check / uncheck ──────────────────────────────────────────────────

  it("converts check with label locator", () => {
    const action = jsonl({ name: "check", selector: labelSelector("Accept terms") });
    expect(jsonlToRepl(action, false)).toBe('check "Accept terms"');
  });

  it("converts check with role locator (no name) to selector", () => {
    const action = jsonl({ name: "check", selector: "input[type=checkbox]" });
    expect(jsonlToRepl(action, false)).toBe('check "input[type=checkbox]"');
  });

  it("converts check with selector fallback", () => {
    const action = jsonl({ name: "check", selector: "#terms" });
    expect(jsonlToRepl(action, false)).toBe('check "#terms"');
  });

  it("returns null for check with no locator or selector", () => {
    const action = jsonl({ name: "check" });
    expect(jsonlToRepl(action, false)).toBeNull();
  });

  it("converts uncheck with label locator", () => {
    const action = jsonl({ name: "uncheck", selector: labelSelector("Newsletter") });
    expect(jsonlToRepl(action, false)).toBe('uncheck "Newsletter"');
  });

  it("converts uncheck with role locator (no name) to selector", () => {
    const action = jsonl({ name: "uncheck", selector: "input[type=checkbox]" });
    expect(jsonlToRepl(action, false)).toBe('uncheck "input[type=checkbox]"');
  });

  it("converts uncheck with selector fallback", () => {
    const action = jsonl({ name: "uncheck", selector: "#newsletter" });
    expect(jsonlToRepl(action, false)).toBe('uncheck "#newsletter"');
  });

  it("returns null for uncheck with no locator or selector", () => {
    const action = jsonl({ name: "uncheck" });
    expect(jsonlToRepl(action, false)).toBeNull();
  });

  // ─── selectOption ─────────────────────────────────────────────────────

  it("converts selectOption with label locator", () => {
    const action = jsonl({ name: "selectOption", options: ["red"], selector: labelSelector("Color") });
    expect(jsonlToRepl(action, false)).toBe('select "Color" "red"');
  });

  it("converts select with role locator (no name) to selector", () => {
    const action = jsonl({ name: "select", options: ["sm"], selector: "select.size" });
    expect(jsonlToRepl(action, false)).toBe('select "select.size" "sm"');
  });

  it("converts selectOption with selector fallback", () => {
    const action = jsonl({ name: "selectOption", options: ["opt1"], selector: "#dropdown" });
    expect(jsonlToRepl(action, false)).toBe('select "#dropdown" "opt1"');
  });

  it("returns null for selectOption with no locator or selector", () => {
    const action = jsonl({ name: "selectOption", options: ["x"] });
    expect(jsonlToRepl(action, false)).toBeNull();
  });

  // ─── setInputFiles ────────────────────────────────────────────────────

  it("converts setInputFiles to unsupported comment", () => {
    const action = jsonl({ name: "setInputFiles", files: ["test.png"] });
    expect(jsonlToRepl(action, false)).toBe("# file upload (unsupported)");
  });

  // ─── unknown action ──────────────────────────────────────────────────

  it("converts unknown action to unsupported comment", () => {
    const action = jsonl({ name: "drag" });
    expect(jsonlToRepl(action, false)).toBe("# drag (unsupported)");
  });

  // ─── navigate ─────────────────────────────────────────────────────────

  it("converts navigate (not first) to goto", () => {
    const action = jsonl({ name: "navigate", url: "https://example.com" });
    expect(jsonlToRepl(action, false)).toBe('goto "https://example.com"');
  });

  it("skips navigate when isFirst=true", () => {
    const action = jsonl({ name: "navigate", url: "https://example.com" });
    expect(jsonlToRepl(action, true)).toBeNull();
  });

  // ─── nth extraction ──────────────────────────────────────────────────

  it("appends --nth from selector (nth)", () => {
    const action = jsonl({ name: "click", selector: `${roleSelector("button", "Item")} >> nth=2` });
    expect(jsonlToRepl(action, false)).toBe('click "Item" --nth 2');
  });

  it("appends --nth 0 from selector (first)", () => {
    const action = jsonl({ name: "click", selector: `${roleSelector("link", "More")} >> nth=0` });
    expect(jsonlToRepl(action, false)).toBe('click "More" --nth 0');
  });

  it("appends --nth -1 from selector (last)", () => {
    const action = jsonl({ name: "click", selector: `${roleSelector("link", "More")} >> nth=-1` });
    expect(jsonlToRepl(action, false)).toBe('click "More" --nth -1');
  });

  // ─── selector-string parsing ──────────────────────────────────────────

  it("parses internal:role selector", () => {
    const action = jsonl({ name: "click", selector: 'internal:role=button[name="Save"s]' });
    expect(jsonlToRepl(action, false)).toBe('click "Save"');
  });

  it("parses internal:text selector", () => {
    const action = jsonl({ name: "click", selector: 'internal:text="Hello world"i' });
    const result = jsonlToRepl(action, false);
    expect(result).toContain("click");
    expect(result).toContain("Hello world");
  });

  it("parses internal:label selector", () => {
    const action = jsonl({ name: "fill", text: "val", selector: 'internal:label="Email"s' });
    const result = jsonlToRepl(action, false);
    expect(result).toContain("fill");
    expect(result).toContain("Email");
    expect(result).toContain("val");
  });

  it("parses internal:testid selector", () => {
    const action = jsonl({ name: "click", selector: 'internal:testid=[data-testid="submit-btn"s]' });
    expect(jsonlToRepl(action, false)).toBe('click "submit-btn"');
  });

  // ─── locator kinds via selector ────────────────────────────────────────

  it("handles placeholder selector", () => {
    const action = jsonl({ name: "fill", text: "test", selector: 'internal:attr=[placeholder="Search..."s]' });
    expect(jsonlToRepl(action, false)).toBe('fill "Search..." "test"');
  });

  it("handles alt selector", () => {
    const action = jsonl({ name: "click", selector: 'internal:attr=[alt="Logo"s]' });
    expect(jsonlToRepl(action, false)).toBe('click "Logo"');
  });

  it("handles title selector", () => {
    const action = jsonl({ name: "hover", selector: 'internal:attr=[title="Close"s]' });
    expect(jsonlToRepl(action, false)).toBe('hover "Close"');
  });

  it("handles test-id selector", () => {
    const action = jsonl({ name: "click", selector: 'internal:testid=[data-testid="submit-btn"s]' });
    expect(jsonlToRepl(action, false)).toBe('click "submit-btn"');
  });

  // ─── locator chain format (production recorder output) ─────────────

  function roleLocator(role: string, name?: string, next?: object) {
    return { kind: "role", body: role, ...(name ? { options: { name } } : {}), ...(next ? { next } : {}) };
  }
  function labelLocator(label: string, next?: object) {
    return { kind: "label", body: label, ...(next ? { next } : {}) };
  }
  function textLocator(text: string, next?: object) {
    return { kind: "text", body: text, ...(next ? { next } : {}) };
  }

  it("locator chain: click with role + name", () => {
    const action = jsonl({ name: "click", locator: roleLocator("button", "Submit") });
    expect(jsonlToRepl(action, false)).toBe('click "Submit"');
  });

  it("locator chain: click with role, no name", () => {
    const action = jsonl({ name: "click", locator: roleLocator("navigation") });
    expect(jsonlToRepl(action, false)).toBe("click navigation");
  });

  it("locator chain: fill with label", () => {
    const action = jsonl({ name: "fill", text: "Alice", locator: labelLocator("Name") });
    expect(jsonlToRepl(action, false)).toBe('fill "Name" "Alice"');
  });

  it("locator chain: click with nth", () => {
    const action = jsonl({ name: "click", locator: roleLocator("tab", "npm", { kind: "nth", body: 0 }) });
    expect(jsonlToRepl(action, false)).toBe('click "npm" --nth 0');
  });

  it("locator chain: click with first (nth=0)", () => {
    const action = jsonl({ name: "click", locator: roleLocator("link", "More", { kind: "first" }) });
    expect(jsonlToRepl(action, false)).toBe('click "More" --nth 0');
  });

  it("locator chain: click with last (nth=-1)", () => {
    const action = jsonl({ name: "click", locator: roleLocator("link", "More", { kind: "last" }) });
    expect(jsonlToRepl(action, false)).toBe('click "More" --nth -1');
  });

  it("locator chain: skips click on textbox role", () => {
    const action = jsonl({ name: "click", locator: roleLocator("textbox", "Name") });
    expect(jsonlToRepl(action, false)).toBeNull();
  });

  it("locator chain: hover with text", () => {
    const action = jsonl({ name: "hover", locator: textLocator("Menu") });
    expect(jsonlToRepl(action, false)).toBe('hover "Menu"');
  });

  it("locator chain: verify-visible with role", () => {
    const action = jsonl({ name: "assertVisible", locator: roleLocator("button", "Submit") });
    expect(jsonlToRepl(action, false)).toBe('verify-visible button "Submit"');
  });

  it("locator chain: CSS fallback (default kind)", () => {
    const action = jsonl({ name: "click", locator: { kind: "default", body: ".my-btn" } });
    expect(jsonlToRepl(action, false)).toBe('click ".my-btn"');
  });

  it("locator chain preferred over selector field", () => {
    const action = jsonl({
      name: "click",
      locator: roleLocator("tab", "npm", { kind: "nth", body: 0 }),
      selector: ".tabs__item",
    });
    expect(jsonlToRepl(action, false)).toBe('click "npm" --nth 0');
  });

  // ─── edge cases ───────────────────────────────────────────────────────

  it("returns null for invalid JSON", () => {
    expect(jsonlToRepl("not json", false)).toBeNull();
  });
});
