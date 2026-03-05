import { describe, it, expect, vi, beforeAll } from "vitest";

// ─── Mock page-scripts so we can assert which fn was resolved ─────────────────

const verifyVisibleMock = vi.fn();
const verifyInputValueMock = vi.fn();
const verifyValueMock = vi.fn();
const verifyTextMock = vi.fn();
const verifyElementMock = vi.fn();
const verifyNoTextMock = vi.fn();
const verifyNoElementMock = vi.fn();
const verifyTitleMock = vi.fn();
const verifyUrlMock = vi.fn();
const verifyListMock = vi.fn();
const gotoUrlMock = vi.fn();
const actionByTextMock = vi.fn();
const fillByTextMock = vi.fn();
const takeSnapshotMock = vi.fn();

vi.mock("../../src/page-scripts", () => ({
  verifyVisible: verifyVisibleMock,
  verifyInputValue: verifyInputValueMock,
  verifyValue: verifyValueMock,
  verifyText: verifyTextMock,
  verifyElement: verifyElementMock,
  verifyNoText: verifyNoTextMock,
  verifyNoElement: verifyNoElementMock,
  verifyTitle: verifyTitleMock,
  verifyUrl: verifyUrlMock,
  verifyList: verifyListMock,
  gotoUrl: gotoUrlMock,
  actionByText: actionByTextMock,
  fillByText: fillByTextMock,
  takeSnapshot: takeSnapshotMock,
  selectByText: vi.fn(),
  checkByText: vi.fn(),
  uncheckByText: vi.fn(),
  highlightByText: vi.fn(),
  highlightBySelector: vi.fn(),
  chainAction: vi.fn(),
  goBack: vi.fn(),
  goForward: vi.fn(),
  reloadPage: vi.fn(),
  waitMs: vi.fn(),
  getTitle: vi.fn(),
  getUrl: vi.fn(),
  evalCode: vi.fn(),
  runCode: vi.fn(),
  takeScreenshot: vi.fn(),
  refAction: vi.fn(),
  pressKey: vi.fn(),
  typeText: vi.fn(),
  localStorageGet: vi.fn(), localStorageSet: vi.fn(), localStorageDelete: vi.fn(),
  localStorageClear: vi.fn(), localStorageList: vi.fn(),
  sessionStorageGet: vi.fn(), sessionStorageSet: vi.fn(), sessionStorageDelete: vi.fn(),
  sessionStorageClear: vi.fn(), sessionStorageList: vi.fn(),
  cookieList: vi.fn(), cookieGet: vi.fn(), cookieClear: vi.fn(),
}));

let parseReplCommand: (input: string) => any;

beforeAll(async () => {
  const mod = await import("../../src/commands");
  parseReplCommand = mod.parseReplCommand;
});

// ─── helpers ──────────────────────────────────────────────────────────────────

function direct(input: string) {
  const result = parseReplCommand(input);
  expect(result).toHaveProperty("fn");
  expect(result).toHaveProperty("fnArgs");
  return result as { fn: unknown; fnArgs: unknown[] };
}

function isError(input: string) {
  const result = parseReplCommand(input);
  expect(result).toHaveProperty("error");
  return result as { error: string };
}

// ─── verify-visible ───────────────────────────────────────────────────────────

describe("verify-visible", () => {
  it("resolves to verifyVisible with role and name", () => {
    const { fn, fnArgs } = direct('verify-visible button "Submit"');
    expect(fn).toBe(verifyVisibleMock);
    expect(fnArgs).toEqual(["button", "Submit"]);
  });

  it("resolves multi-word name", () => {
    const { fn, fnArgs } = direct('verify-visible heading "Getting Started"');
    expect(fn).toBe(verifyVisibleMock);
    expect(fnArgs).toEqual(["heading", "Getting Started"]);
  });

  it("vvis alias resolves to verifyVisible", () => {
    const { fn, fnArgs } = direct('vvis link "Learn more"');
    expect(fn).toBe(verifyVisibleMock);
    expect(fnArgs).toEqual(["link", "Learn more"]);
  });

  it("returns error when missing name arg", () => {
    isError("verify-visible button");
  });

  it("returns error when empty", () => {
    isError("verify-visible");
  });
});

// ─── verify-value (label-based) ───────────────────────────────────────────────

describe("verify-value — label-based", () => {
  it("resolves to verifyInputValue for plain label", () => {
    const { fn, fnArgs } = direct('verify-value "Email" "user@example.com"');
    expect(fn).toBe(verifyInputValueMock);
    expect(fnArgs).toEqual(["Email", "user@example.com"]);
  });

  it("resolves to verifyInputValue for checkbox checked", () => {
    const { fn, fnArgs } = direct('verify-value "Accept terms" "checked"');
    expect(fn).toBe(verifyInputValueMock);
    expect(fnArgs).toEqual(["Accept terms", "checked"]);
  });

  it("resolves to verifyInputValue for checkbox unchecked", () => {
    const { fn, fnArgs } = direct('verify-value "Newsletter" "unchecked"');
    expect(fn).toBe(verifyInputValueMock);
    expect(fnArgs).toEqual(["Newsletter", "unchecked"]);
  });

  it("resolves to verifyInputValue for radio group", () => {
    const { fn, fnArgs } = direct('verify-value "Gender" "Female"');
    expect(fn).toBe(verifyInputValueMock);
    expect(fnArgs).toEqual(["Gender", "Female"]);
  });
});

// ─── verify-value (ref-based) ─────────────────────────────────────────────────

describe("verify-value — ref-based", () => {
  it("resolves to verifyValue when first arg is a ref", () => {
    const { fn, fnArgs } = direct('verify-value e5 "hello"');
    expect(fn).toBe(verifyValueMock);
    expect(fnArgs).toEqual(["e5", "hello"]);
  });

  it("resolves to verifyValue for ref e12", () => {
    const { fn, fnArgs } = direct('verify-value e12 "world"');
    expect(fn).toBe(verifyValueMock);
    expect(fnArgs).toEqual(["e12", "world"]);
  });
});

// ─── verify-visible vs verify-element distinction ─────────────────────────────

describe("verify-visible vs verify-element", () => {
  it("verify-element resolves to verifyElement (count-based)", () => {
    const { fn } = direct('verify-element button "Submit"');
    expect(fn).toBe(verifyElementMock);
  });

  it("verify-visible resolves to verifyVisible (isVisible-based)", () => {
    const { fn } = direct('verify-visible button "Submit"');
    expect(fn).toBe(verifyVisibleMock);
  });
});

// ─── existing verify commands unaffected ─────────────────────────────────────

describe("existing verify commands", () => {
  it("verify-text resolves to verifyText", () => {
    const { fn, fnArgs } = direct('verify-text "Hello"');
    expect(fn).toBe(verifyTextMock);
    expect(fnArgs).toEqual(["Hello"]);
  });

  it("verify-no-text resolves to verifyNoText", () => {
    const { fn, fnArgs } = direct('verify-no-text "Gone"');
    expect(fn).toBe(verifyNoTextMock);
    expect(fnArgs).toEqual(["Gone"]);
  });

  it("verify text (unified) resolves to verifyText", () => {
    const { fn, fnArgs } = direct('verify text "Welcome"');
    expect(fn).toBe(verifyTextMock);
    expect(fnArgs).toEqual(["Welcome"]);
  });

  it("verify-url resolves to verifyUrl", () => {
    const { fn, fnArgs } = direct('verify-url "dashboard"');
    expect(fn).toBe(verifyUrlMock);
    expect(fnArgs).toEqual(["dashboard"]);
  });
});
