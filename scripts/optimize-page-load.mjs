// Mechanical page-load cleanup for public HTML files.
//
// 1. app.js now loads i18n.js only for a saved non-English language or when
//    the visitor selects one, so eager duplicate tags are unnecessary.
// 2. Remove preconnect hints whose host is not otherwise referenced by that
//    page. Each unused hint opens DNS/TCP/TLS work on mobile for no benefit.

import { readdirSync, readFileSync, statSync, writeFileSync } from 'fs';
import { join, relative } from 'path';

const root = join(process.cwd(), 'public');

function* htmlFiles(directory) {
  for (const name of readdirSync(directory)) {
    const file = join(directory, name);
    if (statSync(file).isDirectory()) yield* htmlFiles(file);
    else if (name.endsWith('.html')) yield file;
  }
}

let changedFiles = 0;
let removedI18nTags = 0;
let removedPreconnects = 0;
let removedAnalyticsBlocks = 0;

for (const file of htmlFiles(root)) {
  const before = readFileSync(file, 'utf8');
  let html = before;

  html = html.replace(
    /^\s*<script\s+src="(?:\.\.\/)?js\/i18n\.js(?:\?v=[^"]+)?"><\/script>\s*$/gmi,
    () => { removedI18nTags++; return ''; },
  );

  // app.js schedules GA after page load and after cookie acceptance. Remove
  // the old eager duplicate from each page so it cannot compete with CSS and
  // tool libraries during the critical loading window.
  html = html.replace(
    /\s*(?:<!--\s*Google Analytics 4[^>]*-->\s*)?<script\s+(?:async|defer)\s+src="https:\/\/www\.googletagmanager\.com\/gtag\/js\?id=G-0RWPHD8MHR"><\/script>\s*<script>\s*window\.dataLayer\s*=\s*window\.dataLayer\s*\|\|\s*\[\];\s*function gtag\(\)\{dataLayer\.push\(arguments\);\}\s*gtag\('js',\s*new Date\(\)\);\s*gtag\('config',\s*'G-0RWPHD8MHR',\s*\{\s*anonymize_ip:\s*true,\s*cookie_flags:\s*'SameSite=None;Secure'\s*\}\);\s*<\/script>/gi,
    () => { removedAnalyticsBlocks++; return ''; },
  );

  const preconnectPattern = /\s*<link\s+rel="preconnect"\s+href="(https:\/\/[^"/]+)[^"]*"(?:\s+crossorigin)?\s*>/gi;
  const pageWithoutHints = html.replace(preconnectPattern, '');
  html = html.replace(preconnectPattern, (tag, origin) => {
    const hostname = new URL(origin).hostname;
    if (pageWithoutHints.includes(hostname)) return tag;
    removedPreconnects++;
    return '';
  });

  // Avoid accumulating large blank runs after line removals.
  html = html.replace(/(?:\r?\n){3,}/g, '\n\n');

  if (html !== before) {
    writeFileSync(file, html, 'utf8');
    changedFiles++;
    console.log('optimized', relative(root, file));
  }
}

console.log(`\n${changedFiles} files changed`);
console.log(`${removedI18nTags} eager i18n tags removed`);
console.log(`${removedPreconnects} unused preconnects removed`);
console.log(`${removedAnalyticsBlocks} eager analytics blocks removed`);
