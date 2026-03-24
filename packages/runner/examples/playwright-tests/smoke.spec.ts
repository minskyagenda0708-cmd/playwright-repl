import { test as it, expect } from './pageTest';

it('should click button via setContent', async ({ page }) => {
  await page.setContent(`
    <button>Click target</button>
    <script>
      window.result = 'Was not clicked';
      document.querySelector('button').addEventListener('click', () => { window.result = 'Clicked'; });
    </script>
  `);
  await page.click('button');
  const result = await page.evaluate('result');
  console.log('[smoke] click result:', result);
  expect(result).toBe('Clicked');
});

it('should click button from server', async ({ page, server }) => {
  await page.goto(server.PREFIX + '/input/button.html');
  const content = await page.content();
  console.log('[smoke] page content length:', content?.length);
  console.log('[smoke] page content snippet:', typeof content === 'string' ? content.substring(0, 100) : content);
  await page.locator('button').click({ timeout: 5000 });
  const result = await page.evaluate('result');
  console.log('[smoke] server click result:', result);
  expect(result).toBe('Clicked');
});

it('should set content inline', async ({ page }) => {
  await page.setContent('<div id="test">Hello</div>');
  const text = await page.locator('#test').textContent();
  console.log('[smoke] text:', text);
  expect(text).toBe('Hello');
});
