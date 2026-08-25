/* Browser smoke test for dedicated tool and informational-page visuals. */
const { chromium } = require('playwright');

const baseUrl = process.argv[2] || 'http://localhost:3000';
const toolPages = [
  'compress', 'compress-pdf', 'crop-pdf', 'fill-sign', 'html-to-pdf',
  'img-to-pdf', 'inheritance-calc-advanced', 'merge-pdf', 'ocr',
  'page-numbers', 'pdf-editor', 'pdf-metadata', 'pdf-organizer',
  'pdf-text-extractor', 'pdf-to-excel', 'pdf-to-img', 'pdf-to-ppt',
  'pdf-to-word', 'searchable-pdf', 'split-pdf', 'unlock-pdf', 'watermark',
  'word-to-pdf',
].map(name => `/tools/${name}.html`);
const informationPages = [
  '/about.html', '/contact.html', '/privacy.html', '/terms.html',
  '/cookies.html', '/disclaimer.html', '/help.html', '/press.html',
];
const requestedViewport = process.argv[3];
const viewports = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'mobile', width: 390, height: 844 },
].filter(viewport => !requestedViewport || viewport.name === requestedViewport);

if (!viewports.length) throw new Error(`Unknown viewport: ${requestedViewport}`);

(async () => {
  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.PDFDUKAN_CHROME || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  });
  const failures = [];
  let checked = 0;

  for (const viewport of viewports) {
    const context = await browser.newContext({ viewport });
    for (const pathname of [...toolPages, ...informationPages]) {
      const page = await context.newPage();
      const pageErrors = [];
      page.on('pageerror', error => pageErrors.push(error.message));
      await page.goto(baseUrl + pathname, { waitUntil: 'load', timeout: 60000 });
      const firstContentImage = page.locator('img[src*="images/"]').first();
      await firstContentImage.scrollIntoViewIfNeeded();
      await firstContentImage.evaluate(img => Promise.race([
        img.decode ? img.decode().catch(() => {}) : Promise.resolve(),
        new Promise(resolve => setTimeout(resolve, 5000)),
      ]));
      const result = await page.evaluate(() => {
        const contentImages = [...document.querySelectorAll('img[src]')]
          .filter(img => /(?:^|\/)images\//.test(img.getAttribute('src') || ''));
        return {
          contentImages: contentImages.map(img => ({
            src: img.getAttribute('src'),
            alt: img.getAttribute('alt') || '',
            naturalWidth: img.naturalWidth,
            width: img.getBoundingClientRect().width,
          })),
          overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          featureCount: document.querySelectorAll('[data-page-feature]').length,
        };
      });
      const validImages = result.contentImages.filter(img => img.naturalWidth > 0 && img.width > 0 && img.alt.trim());
      if (!validImages.length) failures.push(`${viewport.name} ${pathname}: no loaded, visible image with alt text`);
      if (informationPages.includes(pathname) && result.featureCount !== 1) {
        failures.push(`${viewport.name} ${pathname}: expected one dedicated feature visual, found ${result.featureCount}`);
      }
      if (result.overflow > 1) failures.push(`${viewport.name} ${pathname}: horizontal overflow ${result.overflow}px`);
      if (pageErrors.length) failures.push(`${viewport.name} ${pathname}: ${pageErrors.join(' | ')}`);
      checked++;
      await page.close();
    }
    await context.close();
  }

  await browser.close();
  console.log(JSON.stringify({ checked, failures }, null, 2));
  if (failures.length) process.exitCode = 1;
})().catch(error => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
