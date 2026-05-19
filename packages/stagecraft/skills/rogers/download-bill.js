/**
 * Download Rogers bill PDFs for specified billing periods.
 * Runs via playwright-repl --http /run-script endpoint (relay mode).
 *
 * Variables (substituted by stagecraft before sending):
 *   {{periods}}  - JSON array of billing period labels, e.g. ["January 24, 2026"]
 *   {{savePath}} - Absolute path to save the PDF, e.g. "/home/user/tax/rogers-2026-03.pdf"
 *
 * Usage:
 *   stagecraft run download-rogers-bill --http \
 *     --variable periods='["January 24, 2026"]' \
 *     --variable savePath="/home/user/tax/rogers-2026-03.pdf"
 */

const periods = JSON.parse('{{periods}}');
const savePath = '{{savePath}}';

await page.goto('https://www.rogers.com/consumer/self-serve/overview', { waitUntil: 'domcontentloaded' });
await page.getByText('View your bill').filter({ visible: true }).first().click();
await page.getByText('Save PDF').click();
await page.getByText('Download one or more bills').waitFor();

for (const period of periods) {
  await page.getByRole('checkbox', { name: period }).check();
}

const [download] = await Promise.all([
  page.waitForEvent('download'),
  page.getByText('Download bills').click(),
]);

if (savePath && savePath !== '{{savePath}}') {
  await download.saveAs(savePath);
  savePath;
} else {
  download.suggestedFilename();
}
