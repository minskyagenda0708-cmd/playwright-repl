# Workflow Plan: playwright.dev

## Overview

playwright.dev is the official documentation site for the Playwright browser automation framework. It is a Docusaurus-based static site with a top navigation bar, a left sidebar for section navigation, a right table-of-contents panel for in-page anchors, and a bottom "Previous / Next" page navigator. The site supports multiple programming languages (Node.js, Python, Java, .NET) via a language switcher in the top navbar. A search modal (Algolia DocSearch) is accessible from the navbar. The site has five top-level nav entries: Docs, API, Community, a GitHub icon link, and a language selector.

Key URL patterns:
- Home: https://playwright.dev
- Node.js docs: https://playwright.dev/docs/<slug>
- Python docs: https://playwright.dev/python/docs/<slug>
- Java docs: https://playwright.dev/java/docs/<slug>
- .NET docs: https://playwright.dev/dotnet/docs/<slug>
- API reference: https://playwright.dev/docs/api/class-<classname>

---

## Workflows

### 1. Home Page — Verify Key Content and Navigation Links

**URL:** https://playwright.dev
**Preconditions:** None — fresh page load.

**Steps:**
1. Navigate to https://playwright.dev.
2. Verify the heading "Playwright enables reliable end-to-end testing for modern web apps." is visible.
3. Verify the "Get started" button is present.
4. Verify the "Docs" link is visible in the top navigation bar.
5. Verify the "API" link is visible in the top navigation bar.
6. Verify the "Community" link is visible in the top navigation bar.
7. Verify the "Node.js" language selector is visible in the top navigation bar.
8. Click the "Get started" button.
9. Verify the URL changes to https://playwright.dev/docs/intro.
10. Verify the heading "Installation" is visible on the resulting page.

**Expected outcome:** Clicking "Get started" from the home page lands the user on the Installation docs page.

**Notes:** The home page hero section describes cross-browser support (Chromium, Firefox, WebKit) and key features. The "Get started" button is the primary call-to-action.

---

### 2. Docs — Browse the Installation Page

**URL:** https://playwright.dev/docs/intro
**Preconditions:** None.

**Steps:**
1. Navigate to https://playwright.dev/docs/intro.
2. Verify "Installation" heading is visible.
3. Verify the left sidebar is present with navigation links.
4. Scroll down to verify the code block for `npm init playwright@latest` is visible.
5. Scroll down further and verify the "What's installed" section heading is visible.
6. Scroll to the bottom of the page.
7. Verify the "Next" navigation link pointing to the next doc page is visible (the link text begins with "Next").
8. Click the "Next" page navigation link at the bottom of the page.
9. Verify the URL changes to a new docs page.
10. Verify the new page has a heading visible.

**Expected outcome:** The user can navigate forward through docs pages using the bottom "Next" pagination link.

**Notes:** The installation page is the entry point for all docs. Code blocks are not interactive. The left sidebar shows "Getting Started", "Writing Tests", "Running and Debugging Tests", and other sections.

---

### 3. Docs — Left Sidebar Navigation to a Specific Section

**URL:** https://playwright.dev/docs/intro
**Preconditions:** None.

**Steps:**
1. Navigate to https://playwright.dev/docs/intro.
2. Verify the left sidebar is present.
3. In the left sidebar, click the "Writing tests" link.
4. Verify the URL changes to https://playwright.dev/docs/writing-tests.
5. Verify the heading "Writing tests" is visible on the page.
6. Scroll down and verify that the page contains content describing assertions and locators.

**Expected outcome:** Clicking a sidebar link takes the user directly to that documentation section.

**Notes:** The sidebar collapses into a hamburger menu on mobile viewports. On desktop, all sections are expanded by default.

---

### 4. Search — Open Modal and Query for a Topic

**URL:** https://playwright.dev
**Preconditions:** None.

**Steps:**
1. Navigate to https://playwright.dev.
2. Click the "Search" button in the top navigation bar.
3. Verify the search modal opens and a text input field is focused/visible.
4. Type "locator" into the search input field.
5. Verify that search result items appear below the input (the results list becomes populated).
6. Press the Escape key to close the search modal.
7. Verify the search modal is no longer visible.

**Expected outcome:** The Algolia DocSearch modal opens, accepts keyboard input, and displays matching results for "locator". Pressing Escape dismisses the modal.

**Notes:** The search keyboard shortcut is Ctrl+K (Windows/Linux) or Cmd+K (Mac). The modal can also be closed by clicking outside it. Search results include page titles and excerpt snippets.

---

### 5. Search — Navigate to a Search Result

**URL:** https://playwright.dev
**Preconditions:** None.

**Steps:**
1. Navigate to https://playwright.dev.
2. Click the "Search" button in the top navigation bar.
3. Verify the search modal is open.
4. Type "page object model" into the search input field.
5. Verify at least one search result item appears.
6. Click the first search result that appears.
7. Verify the URL changes to a docs page (URL contains /docs/).
8. Verify the page heading is visible and the page has loaded successfully.

**Expected outcome:** Selecting a search result navigates the user to the corresponding documentation page.

**Notes:** Results are ranked by relevance. The first result for "page object model" is typically the Page Object Models guide.

---

### 6. Language Switcher — Switch from Node.js to Python

**URL:** https://playwright.dev
**Preconditions:** None (default language is Node.js).

**Steps:**
1. Navigate to https://playwright.dev.
2. Verify "Node.js" is shown in the language selector in the top navigation bar.
3. Click "Node.js" to open the language dropdown.
4. Verify a dropdown/popover appears showing language options.
5. Click "Python" from the dropdown list.
6. Verify the URL changes to https://playwright.dev/python/docs/intro or similar Python URL.
7. Verify "Python" now appears in the language selector in the top navigation bar.
8. Verify the page heading "Installation" is visible.

**Expected outcome:** Selecting a different language from the switcher reloads the documentation in that language's URL namespace. The language selector reflects the active choice.

**Notes:** Language options observed: Node.js, Python, Java, .NET. Each language has its own URL prefix (/python/, /java/, /dotnet/). The default (no prefix) is Node.js.

---

### 7. Language Switcher — Switch from Node.js to Java

**URL:** https://playwright.dev/docs/intro
**Preconditions:** None.

**Steps:**
1. Navigate to https://playwright.dev/docs/intro.
2. Click "Node.js" in the top navigation bar to open the language dropdown.
3. Click "Java" from the dropdown list.
4. Verify the URL changes to https://playwright.dev/java/docs/intro.
5. Verify the heading "Installation" is visible.
6. Verify the code examples on the page show Java syntax (Maven/Gradle dependency snippets).

**Expected outcome:** Switching to Java takes the user to the Java variant of the same documentation page.

**Notes:** The language switcher preserves the current page slug when switching between languages, so the user lands on the equivalent page in the new language.

---

### 8. API Reference — Browse the Playwright Class

**URL:** https://playwright.dev/docs/api/class-playwright
**Preconditions:** None.

**Steps:**
1. Navigate to https://playwright.dev.
2. Click the "API" link in the top navigation bar.
3. Verify the URL changes to an API reference page (URL contains /docs/api/).
4. Verify the heading "API reference" or a class name heading is visible.
5. Scroll down to verify method listings are visible.
6. In the left sidebar, locate and click "Locator".
7. Verify the URL changes to the Locator class API page.
8. Verify the heading "Locator" is visible.
9. Scroll down and verify method entries such as "locator.click()" are visible.

**Expected outcome:** The API reference section lists all Playwright classes and their methods. Clicking a class in the sidebar navigates to that class's full API documentation.

**Notes:** The API reference sidebar lists classes alphabetically. Each method entry includes a signature, parameter table, and return type.

---

### 9. API Reference — Expand a Method Entry

**URL:** https://playwright.dev/docs/api/class-locator
**Preconditions:** None.

**Steps:**
1. Navigate to https://playwright.dev/docs/api/class-locator.
2. Verify the heading "Locator" is visible.
3. Scroll down to find the "locator.click()" method entry.
4. Verify the method signature "locator.click()" is visible.
5. Scroll down further and verify that "options" parameter description is visible.

**Expected outcome:** The Locator API page displays all available methods with their full parameter documentation inline (no accordion — all content is expanded by default on Docusaurus API pages).

**Notes:** Each method has an anchor link (e.g., #locator-click) which can be linked to directly. The right-side table of contents lists all methods on the page.

---

### 10. Community Page — Verify Content and External Links

**URL:** https://playwright.dev
**Preconditions:** None.

**Steps:**
1. Navigate to https://playwright.dev.
2. Click "Community" in the top navigation bar.
3. Verify the URL changes to https://playwright.dev/community/welcome.
4. Verify a page heading related to the community is visible.
5. Verify links to external community resources are visible on the page (e.g., Discord, Stack Overflow, GitHub).

**Expected outcome:** The Community page loads and lists links to external resources where users can get help and engage with the Playwright community.

**Notes:** The community page is a simple content page. External links open in a new tab.

---

### 11. Docs — Right-Side Table of Contents Navigation

**URL:** https://playwright.dev/docs/writing-tests
**Preconditions:** None.

**Steps:**
1. Navigate to https://playwright.dev/docs/writing-tests.
2. Verify the heading "Writing tests" is visible.
3. Verify the right-side table of contents panel is visible, listing in-page sections.
4. In the right-side table of contents, click one of the section anchor links (e.g., "Assertions").
5. Verify the page scrolls to the corresponding heading on the page.
6. Verify the clicked item in the right-side table of contents becomes visually highlighted/active.

**Expected outcome:** Clicking a table-of-contents entry scrolls the main content to that section and highlights the active item in the TOC panel.

**Notes:** The right-side TOC updates its highlighted item as the user scrolls through the page (scroll-spy behavior).

---

### 12. Docs — Keyboard Search Shortcut

**URL:** https://playwright.dev/docs/intro
**Preconditions:** None.

**Steps:**
1. Navigate to https://playwright.dev/docs/intro.
2. Press Ctrl+K (or Cmd+K on Mac) on the keyboard.
3. Verify the search modal opens.
4. Verify a text input field is focused.
5. Type "assertions" into the input.
6. Verify search results appear.
7. Press Escape to close the modal.
8. Verify the search modal is no longer visible and the docs page is still visible.

**Expected outcome:** The keyboard shortcut Ctrl+K opens the search modal from any page on the site.

**Notes:** This is a standard Algolia DocSearch keyboard shortcut. The hint "Ctrl+K" or "Cmd+K" is typically shown in the Search button label.

---

### 13. Docs — Version Indicator Check

**URL:** https://playwright.dev/docs/intro
**Preconditions:** None.

**Steps:**
1. Navigate to https://playwright.dev/docs/intro.
2. Verify the page loads successfully and shows the "Installation" heading.
3. Locate the version number displayed in the page or navbar (the version label, e.g., "v1.x.x" or "Next").
4. Verify a version indicator is visible somewhere on the page.

**Expected outcome:** The current stable version of Playwright is shown on the documentation page, confirming the user is on the latest stable docs.

**Notes:** Older versions of the docs may be accessible via a version dropdown. The default URL serves the latest stable version.

---

### 14. Home Page — Feature Sections Visibility

**URL:** https://playwright.dev
**Preconditions:** None.

**Steps:**
1. Navigate to https://playwright.dev.
2. Verify "Playwright enables reliable end-to-end testing for modern web apps." heading is visible.
3. Scroll down past the hero section.
4. Verify a section about "Any browser" or cross-browser testing is visible.
5. Scroll down further.
6. Verify a section about "Any platform" is visible.
7. Scroll down further.
8. Verify a section about "One API" is visible.
9. Continue scrolling and verify a "Resilient" or "No flaky tests" feature section is visible.
10. Continue scrolling and verify a section about "Full isolation" or "Fast and reliable execution" is visible.
11. Scroll to the bottom of the page.
12. Verify the footer is visible with links to "Docs", "API", and "Community".

**Expected outcome:** All major feature-highlight sections load and are visible as the user scrolls through the home page. The footer is present at the bottom.

**Notes:** The home page uses a single-column layout for feature cards on mobile and a multi-column layout on desktop.

---

### 15. Docs — Navigate Using Previous / Next Links at Page Bottom

**URL:** https://playwright.dev/docs/writing-tests
**Preconditions:** None.

**Steps:**
1. Navigate to https://playwright.dev/docs/writing-tests.
2. Scroll to the bottom of the page.
3. Verify a "Previous" navigation link is visible (text contains "Previous") pointing to the previous page in the sequence.
4. Verify a "Next" navigation link is visible (text contains "Next") pointing to the next page in the sequence.
5. Click the "Next" link at the bottom.
6. Verify the URL changes to the next docs page in sequence.
7. Verify the new page has a main heading visible.
8. Scroll to the bottom of the new page.
9. Verify a "Previous" link is visible that points back to the "Writing tests" page.

**Expected outcome:** The Previous / Next pagination at the bottom of each docs page allows sequential navigation through the documentation without using the sidebar.

**Notes:** Not all pages have both a Previous and a Next link — the first page in a section only has Next, and the last page only has Previous.
