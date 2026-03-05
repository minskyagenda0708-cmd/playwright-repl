import { describe, it, expect } from "vitest";
import { tokenize, pwToPlaywright, jsonlToRepl } from "@/lib/converter.js";

describe("tokenize", () => {
  it("tokenizes simple words", () => {
    expect(tokenize("click Submit")).toEqual(["click", "Submit"]);
  });

  it("tokenizes double-quoted strings", () => {
    expect(tokenize('fill "Email" "test@example.com"')).toEqual([
      "fill",
      "Email",
      "test@example.com",
    ]);
  });

  it("tokenizes single-quoted strings", () => {
    expect(tokenize("fill 'Username' 'alice'")).toEqual([
      "fill",
      "Username",
      "alice",
    ]);
  });

  it("returns empty array for empty string", () => {
    expect(tokenize("")).toEqual([]);
  });

  it("returns empty array for whitespace", () => {
    expect(tokenize("   ")).toEqual([]);
  });

  it("returns empty array for comments", () => {
    expect(tokenize("# a comment")).toEqual([]);
  });

  it("handles mixed quoted and unquoted", () => {
    expect(tokenize('click "destroy" costco')).toEqual([
      "click",
      "destroy",
      "costco",
    ]);
  });

  it("handles tabs as separators", () => {
    expect(tokenize("goto\thttps://example.com")).toEqual([
      "goto",
      "https://example.com",
    ]);
  });

  it("handles quoted string with spaces", () => {
    expect(tokenize('click "Sign In"')).toEqual(["click", "Sign In"]);
  });
});

describe("pwToPlaywright", () => {
  it("returns null for empty string", () => {
    expect(pwToPlaywright("")).toBeNull();
  });

  it("returns null for comments", () => {
    expect(pwToPlaywright("# comment")).toBeNull();
  });

  // goto / open
  it("converts goto with URL", () => {
    expect(pwToPlaywright("goto https://example.com")).toBe(
      'await page.goto("https://example.com");'
    );
  });

  it("converts goto without protocol", () => {
    expect(pwToPlaywright("goto example.com")).toBe(
      'await page.goto("https://example.com");'
    );
  });

  it("converts open alias", () => {
    expect(pwToPlaywright("open https://example.com")).toBe(
      'await page.goto("https://example.com");'
    );
  });

  it("returns null for goto without URL", () => {
    expect(pwToPlaywright("goto")).toBeNull();
  });

  // click
  it("converts click with text", () => {
    expect(pwToPlaywright('click "Submit"')).toBe(
      'await page.getByText("Submit").click();'
    );
  });

  it("converts click with scope (second arg)", () => {
    expect(pwToPlaywright('click "destroy" "costco"')).toBe(
      'await page.getByText("costco").getByText("destroy").click();'
    );
  });

  it("converts click with snapshot ref to comment", () => {
    expect(pwToPlaywright("click e5")).toContain("snapshot ref");
  });

  it("converts c alias", () => {
    expect(pwToPlaywright('c "Submit"')).toBe(
      'await page.getByText("Submit").click();'
    );
  });

  it("returns null for click without target", () => {
    expect(pwToPlaywright("click")).toBeNull();
  });

  // dblclick
  it("converts dblclick", () => {
    expect(pwToPlaywright('dblclick "Item"')).toBe(
      'await page.getByText("Item").dblclick();'
    );
  });

  // fill
  it("converts fill with label and value", () => {
    expect(pwToPlaywright('fill "Email" "test@example.com"')).toBe(
      'await page.getByLabel("Email").fill("test@example.com");'
    );
  });

  it("converts f alias", () => {
    expect(pwToPlaywright('f "Name" "Alice"')).toBe(
      'await page.getByLabel("Name").fill("Alice");'
    );
  });

  it("returns null for fill with missing value", () => {
    expect(pwToPlaywright('fill "Email"')).toBeNull();
  });

  // select
  it("converts select", () => {
    expect(pwToPlaywright('select "Country" "US"')).toBe(
      'await page.getByLabel("Country").selectOption("US");'
    );
  });

  // check / uncheck
  it("converts check", () => {
    expect(pwToPlaywright('check "Remember me"')).toBe(
      'await page.getByLabel("Remember me").check();'
    );
  });

  it("converts uncheck", () => {
    expect(pwToPlaywright('uncheck "Terms"')).toBe(
      'await page.getByLabel("Terms").uncheck();'
    );
  });

  // hover
  it("converts hover", () => {
    expect(pwToPlaywright('hover "Menu"')).toBe(
      'await page.getByText("Menu").hover();'
    );
  });

  // press
  it("converts press with capitalization", () => {
    expect(pwToPlaywright("press enter")).toBe(
      'await page.keyboard.press("Enter");'
    );
  });

  it("converts p alias", () => {
    expect(pwToPlaywright("p tab")).toBe(
      'await page.keyboard.press("Tab");'
    );
  });

  // screenshot
  it("converts screenshot", () => {
    expect(pwToPlaywright("screenshot")).toBe(
      "await page.screenshot({ path: 'screenshot.png' });"
    );
  });

  it("converts screenshot full", () => {
    expect(pwToPlaywright("screenshot full")).toBe(
      "await page.screenshot({ path: 'screenshot.png', fullPage: true });"
    );
  });

  // snapshot
  it("converts snapshot to comment", () => {
    expect(pwToPlaywright("snapshot")).toContain("// snapshot");
  });

  it("converts s alias to comment", () => {
    expect(pwToPlaywright("s")).toContain("// snapshot");
  });

  // eval
  it("converts eval", () => {
    expect(pwToPlaywright("eval document.title")).toBe(
      "await page.evaluate(() => document.title);"
    );
  });

  // navigation
  it("converts go-back", () => {
    expect(pwToPlaywright("go-back")).toBe("await page.goBack();");
  });

  it("converts back alias", () => {
    expect(pwToPlaywright("back")).toBe("await page.goBack();");
  });

  it("converts go-forward", () => {
    expect(pwToPlaywright("go-forward")).toBe("await page.goForward();");
  });

  it("converts forward alias", () => {
    expect(pwToPlaywright("forward")).toBe("await page.goForward();");
  });

  it("converts reload", () => {
    expect(pwToPlaywright("reload")).toBe("await page.reload();");
  });

  // unified verify command
  it("converts verify title", () => {
    expect(pwToPlaywright('verify title "My App"')).toBe(
      "await expect(page).toHaveTitle(/My App/);"
    );
  });

  it("converts verify url", () => {
    expect(pwToPlaywright('verify url "/about"')).toBe(
      "await expect(page).toHaveURL(/\\/about/);"
    );
  });

  it("converts verify text", () => {
    expect(pwToPlaywright('verify text "Welcome"')).toBe(
      'await expect(page.getByText("Welcome")).toBeVisible();'
    );
  });

  it("converts verify no-text", () => {
    expect(pwToPlaywright('verify no-text "Gone"')).toBe(
      'await expect(page.getByText("Gone")).not.toBeVisible();'
    );
  });

  it("converts verify element", () => {
    expect(pwToPlaywright('verify element button "Submit"')).toBe(
      'await expect(page.getByRole("button", { name: "Submit" })).toBeVisible();'
    );
  });

  it("converts verify no-element", () => {
    expect(pwToPlaywright('verify no-element link "Delete"')).toBe(
      'await expect(page.getByRole("link", { name: "Delete" })).not.toBeVisible();'
    );
  });

  it("converts verify value to comment", () => {
    expect(pwToPlaywright('verify value e5 "hello"')).toBe(
      "// verify value e5 — ref-based, use locator"
    );
  });

  it("converts verify list to comment", () => {
    expect(pwToPlaywright('verify list e3 "a" "b"')).toBe(
      "// verify list e3 — ref-based, use locator"
    );
  });

  it("returns null for verify without sub-type", () => {
    expect(pwToPlaywright("verify")).toBeNull();
  });

  it("returns null for verify with unknown sub-type", () => {
    expect(pwToPlaywright("verify unknown")).toBeNull();
  });

  // legacy verify-* commands
  it("converts verify-text", () => {
    expect(pwToPlaywright('verify-text "Hello"')).toBe(
      'await expect(page.getByText("Hello")).toBeVisible();'
    );
  });

  it("converts verify-no-text", () => {
    expect(pwToPlaywright('verify-no-text "Gone"')).toBe(
      'await expect(page.getByText("Gone")).not.toBeVisible();'
    );
  });

  it("converts verify-element", () => {
    expect(pwToPlaywright('verify-element button "Submit"')).toBe(
      'await expect(page.getByRole("button", { name: "Submit" })).toBeVisible();'
    );
  });

  it("converts verify-no-element", () => {
    expect(pwToPlaywright('verify-no-element button "Deleted"')).toBe(
      'await expect(page.getByRole("button", { name: "Deleted" })).not.toBeVisible();'
    );
  });

  it("converts verify-url", () => {
    expect(pwToPlaywright('verify-url "dashboard"')).toBe(
      "await expect(page).toHaveURL(/dashboard/);"
    );
  });

  it("converts verify-url with regex special chars", () => {
    expect(pwToPlaywright('verify-url "example.com/path"')).toBe(
      "await expect(page).toHaveURL(/example\\.com\\/path/);"
    );
  });

  it("converts verify-title", () => {
    expect(pwToPlaywright('verify-title "My App"')).toBe(
      "await expect(page).toHaveTitle(/My App/);"
    );
  });

  it("returns null for verify-text without arg", () => {
    expect(pwToPlaywright("verify-text")).toBeNull();
  });

  it("returns null for verify-url without arg", () => {
    expect(pwToPlaywright("verify-url")).toBeNull();
  });

  it("returns null for verify-title without arg", () => {
    expect(pwToPlaywright("verify-title")).toBeNull();
  });

  // verify-visible
  it("converts verify-visible to toBeVisible with role", () => {
    expect(pwToPlaywright('verify-visible button "Submit"')).toBe(
      'await expect(page.getByRole("button", { name: "Submit" })).toBeVisible();'
    );
  });

  it("converts verify-visible heading", () => {
    expect(pwToPlaywright('verify-visible heading "Dashboard"')).toBe(
      'await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();'
    );
  });

  it("returns null for verify-visible without args", () => {
    expect(pwToPlaywright("verify-visible")).toBeNull();
  });

  // verify-value
  it("converts verify-value to toHaveValue", () => {
    expect(pwToPlaywright('verify-value "Email" "user@example.com"')).toBe(
      'await expect(page.getByLabel("Email")).toHaveValue("user@example.com");'
    );
  });

  it("converts verify-value for numeric input", () => {
    expect(pwToPlaywright('verify-value "Quantity" "3"')).toBe(
      'await expect(page.getByLabel("Quantity")).toHaveValue("3");'
    );
  });

  it("returns null for verify-value without args", () => {
    expect(pwToPlaywright("verify-value")).toBeNull();
  });

  // unknown
  it("converts unknown command to comment", () => {
    expect(pwToPlaywright("foobar")).toBe("// unknown command: foobar");
  });
});

// ─── helpers ─────────────────────────────────────────────────────────────────

function jsonl(obj: object): string {
  return JSON.stringify(obj);
}

function roleLocator(role: string, name: string) {
  return { kind: "role", body: role, options: { name } };
}

function labelLocator(label: string) {
  return { kind: "label", body: label, options: {} };
}

function textLocator(text: string) {
  return { kind: "text", body: text, options: {} };
}

// ─── jsonlToRepl ─────────────────────────────────────────────────────────────

describe("jsonlToRepl", () => {
  // assertVisible
  it("converts assertVisible with role locator to verify-visible", () => {
    const action = jsonl({ name: "assertVisible", selector: "button", signals: [], locator: roleLocator("button", "Submit") });
    expect(jsonlToRepl(action, false)).toBe('verify-visible button "Submit"');
  });

  it("converts assertVisible with text locator to verify text", () => {
    const action = jsonl({ name: "assertVisible", selector: "text=Welcome", signals: [], locator: textLocator("Welcome") });
    expect(jsonlToRepl(action, false)).toBe('verify text "Welcome"');
  });

  it("returns null for assertVisible with no text", () => {
    const action = jsonl({ name: "assertVisible", selector: ".foo", signals: [], locator: { kind: "default", body: ".foo" } });
    expect(jsonlToRepl(action, false)).toBeNull();
  });

  // assertText
  it("converts assertText to verify text", () => {
    const action = jsonl({ name: "assertText", selector: "text=Hello", text: "Hello", substring: true, signals: [], locator: textLocator("Hello") });
    expect(jsonlToRepl(action, false)).toBe('verify text "Hello"');
  });

  it("returns null for assertText with no text field", () => {
    const action = jsonl({ name: "assertText", selector: "text=", text: "", substring: true, signals: [] });
    expect(jsonlToRepl(action, false)).toBeNull();
  });

  // assertValue
  it("converts assertValue with label locator to verify-value", () => {
    const action = jsonl({ name: "assertValue", selector: "input", value: "user@example.com", signals: [], locator: labelLocator("Email") });
    expect(jsonlToRepl(action, false)).toBe('verify-value "Email" "user@example.com"');
  });

  it("converts assertValue with role locator to verify-value", () => {
    const action = jsonl({ name: "assertValue", selector: "input", value: "5", signals: [], locator: roleLocator("spinbutton", "Quantity") });
    expect(jsonlToRepl(action, false)).toBe('verify-value "Quantity" "5"');
  });

  it("returns null for assertValue with no text", () => {
    const action = jsonl({ name: "assertValue", selector: "input", value: "5", signals: [], locator: { kind: "default", body: "input" } });
    expect(jsonlToRepl(action, false)).toBeNull();
  });

  // assertChecked
  it("converts assertChecked checked=true to verify-value checked", () => {
    const action = jsonl({ name: "assertChecked", selector: "input", checked: true, signals: [], locator: labelLocator("Accept terms") });
    expect(jsonlToRepl(action, false)).toBe('verify-value "Accept terms" "checked"');
  });

  it("converts assertChecked checked=false to verify-value unchecked", () => {
    const action = jsonl({ name: "assertChecked", selector: "input", checked: false, signals: [], locator: labelLocator("Newsletter") });
    expect(jsonlToRepl(action, false)).toBe('verify-value "Newsletter" "unchecked"');
  });

  it("returns null for assertChecked with no text", () => {
    const action = jsonl({ name: "assertChecked", selector: "input", checked: true, signals: [], locator: { kind: "default", body: "input" } });
    expect(jsonlToRepl(action, false)).toBeNull();
  });

  // other actions
  it("converts click with role locator", () => {
    const action = jsonl({ name: "click", selector: "button", button: "left", modifiers: 0, clickCount: 1, signals: [], locator: roleLocator("button", "Submit") });
    expect(jsonlToRepl(action, false)).toBe('click "Submit"');
  });

  it("converts navigate (not first) to goto", () => {
    const action = jsonl({ name: "navigate", url: "https://example.com", signals: [] });
    expect(jsonlToRepl(action, false)).toBe('goto "https://example.com"');
  });

  it("skips navigate when isFirst=true", () => {
    const action = jsonl({ name: "navigate", url: "https://example.com", signals: [] });
    expect(jsonlToRepl(action, true)).toBeNull();
  });

  it("returns null for invalid JSON", () => {
    expect(jsonlToRepl("not json", false)).toBeNull();
  });
});
