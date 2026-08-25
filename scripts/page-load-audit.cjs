/* Cold-context browser timing smoke for representative public pages. */
const { chromium } = require('playwright');

const baseUrl = process.argv[2] || 'http://localhost:3000';
const pages = [
  '/',
  '/scanner.html',
  '/tools/ocr.html',
  '/tools/compress.html',
  '/tools/merge-pdf.html',
  '/tools/split-pdf.html',
  '/tools/compress-pdf.html',
  '/tools/pdf-to-img.html',
  '/tools/inheritance-calc-advanced.html',
];

(async () => {
  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.PDFDUKAN_CHROME || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  });
  const results = [];

  for (const pathname of pages) {
    const context = await browser.newContext();
    const page = await context.newPage();
    const requests = [];
    const errors = [];
    page.on('request', request => requests.push(request.url()));
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(baseUrl + pathname, { waitUntil: 'load', timeout: 60000 });
    const navigation = await page.evaluate(() => {
      const n = performance.getEntriesByType('navigation')[0];
      return {
        domContentLoadedMs: Math.round(n.domContentLoadedEventEnd),
        loadMs: Math.round(n.loadEventEnd),
        transferBytes: n.transferSize,
      };
    });
    results.push({
      pathname,
      ...navigation,
      requests: requests.length,
      thirdParty: requests.filter(url => !url.startsWith(baseUrl)).length,
      errors,
    });
    await context.close();
  }

  console.log(JSON.stringify(results, null, 2));
  await browser.close();
})().catch(error => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
