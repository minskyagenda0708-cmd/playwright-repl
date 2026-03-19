// TodoMVC — add items, complete one, verify filter
await page.goto('https://demo.playwright.dev/todomvc');
await page.evaluate(() => localStorage.clear());
await page.goto('https://demo.playwright.dev/todomvc');

// Add three todos
const todoInput = page.getByPlaceholder('What needs to be done?');
await todoInput.fill('Buy groceries');
await todoInput.press('Enter');
await todoInput.fill('Walk the dog');
await todoInput.press('Enter');
await todoInput.fill('Read a book');
await todoInput.press('Enter');

// Complete "Walk the dog"
const todos = page.getByTestId('todo-item');
await todos.nth(1).getByRole('checkbox').check();

// Filter to Active — completed item should disappear
await page.getByRole('link', { name: 'Active' }).click();
await expect(page.getByText('Buy groceries')).toBeVisible();
await expect(page.getByText('Read a book')).toBeVisible();
await expect(page.getByText('Walk the dog')).not.toBeVisible();
