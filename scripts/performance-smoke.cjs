/* Real-browser smoke test for the scanner's on-demand engines.
   Run against a local server with:
   node scripts/performance-smoke.cjs http://localhost:3000 */

const { chromium } = require('playwright');
const path = require('path');

const baseUrl = process.argv[2] || 'http://localhost:3000';

(async () => {
  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.PDFDUKAN_CHROME || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  });
  const context = await browser.newContext({ acceptDownloads: true });
  const page = await context.newPage();
  const requests = [];
  const errors = [];
  const httpErrors = [];

  page.on('request', request => requests.push(request.url()));
  page.on('console', message => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', error => errors.push(error.message));
  page.on('response', response => {
    if (response.status() >= 400) httpErrors.push(`${response.status()} ${response.url()}`);
  });

  await page.goto(baseUrl + '/scanner.html?performance-smoke=20260825g', { waitUntil: 'load' });
  await page.waitForTimeout(750);

  const initialRequestCount = requests.length;
  const initialRequests = requests.slice();
  const forbiddenAtStartup = [
    'opencv.js', 'docaligner.onnx', 'ort.min.js', 'pdf.min.js',
    'jspdf.umd.min.js', 'jszip.min.js', 'Sortable.min.js', 'i18n.js',
  ];
  const unexpectedStartupEngines = initialRequests.filter(url =>
    forbiddenAtStartup.some(name => url.includes(name)),
  );
  if (unexpectedStartupEngines.length) {
    throw new Error('Heavy engines loaded at startup: ' + unexpectedStartupEngines.join(', '));
  }

  const navigation = await page.evaluate(() => {
    const entry = performance.getEntriesByType('navigation')[0];
    return entry ? {
      domContentLoadedMs: Math.round(entry.domContentLoadedEventEnd),
      loadMs: Math.round(entry.loadEventEnd),
      transferBytes: entry.transferSize,
    } : null;
  });

  const analyticsRequest = page.waitForRequest(
    request => request.url().includes('googletagmanager.com/gtag/js'),
    { timeout: 5000 },
  ).then(() => true).catch(() => false);
  await page.click('#cmCookieBanner .ccb-accept');
  const analyticsObserved = await analyticsRequest;

  const languageRequest = page.waitForRequest(
    request => request.url().includes('/js/i18n.js'),
    { timeout: 10000 },
  );
  await page.evaluate(() => window.setLanguage('ur'));
  await languageRequest;
  await page.waitForFunction(() => !!window.I18N && document.documentElement.lang === 'ur');
  await page.evaluate(() => window.I18N.setLanguage('en'));

  const fixture = path.resolve(process.cwd(), 'public/images/hero-scanner.svg');
  await page.setInputFiles('#fileInputScanner', fixture);
  await page.waitForSelector('#screen-crop.active', { timeout: 60000 });

  const scanEngineRequests = requests.slice(initialRequestCount).filter(url =>
    /docaligner\.onnx|ort\.min\.js|opencv\.js/.test(url),
  );
  if (!scanEngineRequests.some(url => /docaligner\.onnx|ort\.min\.js/.test(url))) {
    throw new Error('The scan engine did not load after selecting an image');
  }

  await page.click('#btnSkipCrop');
  await page.waitForSelector('#screen-filter.active', { timeout: 30000 });
  await page.click('#btnAddPageMain');
  await page.waitForSelector('#screen-pages.active', { timeout: 30000 });
  await page.waitForTimeout(1000);
  if (!requests.some(url => url.includes('Sortable.min.js'))) {
    throw new Error('Page reorder engine did not load on the pages screen');
  }

  await page.click('#btnGoExport');
  await page.waitForSelector('#screen-export.active');
  const downloadPromise = page.waitForEvent('download', { timeout: 30000 });
  await page.click('#btnDownloadPDF');
  const download = await downloadPromise;
  if (!requests.some(url => url.includes('jspdf.umd.min.js'))) {
    throw new Error('PDF export engine did not load on export');
  }

  const meaningfulErrors = errors.filter(message =>
    !/google|analytics|favicon|ERR_BLOCKED_BY_CLIENT|Failed to load resource/i.test(message),
  );
  const meaningfulHttpErrors = httpErrors.filter(message =>
    !/google|analytics|googletagmanager/i.test(message),
  );
  if (meaningfulErrors.length || meaningfulHttpErrors.length) {
    throw new Error('Browser errors: ' + meaningfulErrors.concat(meaningfulHttpErrors).join(' | '));
  }

  console.log(JSON.stringify({
    navigation,
    initialRequests: initialRequestCount,
    unexpectedStartupEngines,
    scanEngineRequests,
    exportedFile: download.suggestedFilename(),
    totalRequests: requests.length,
    analyticsObserved,
    browserErrors: meaningfulErrors,
    httpErrors: meaningfulHttpErrors,
  }, null, 2));

  await browser.close();
})().catch(async error => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
