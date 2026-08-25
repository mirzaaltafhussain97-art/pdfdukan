// Static crawl/indexability audit for every canonical URL in sitemap.xml.

import { existsSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const publicRoot = join(process.cwd(), 'public');
const siteOrigin = 'https://pdfdukan.com';
const sitemap = readFileSync(join(publicRoot, 'sitemap.xml'), 'utf8');
const urls = [...sitemap.matchAll(/<loc>(.*?)<\/loc>/g)].map(match => match[1]);
const failures = [];

function routeFile(url) {
  const pathname = new URL(url).pathname;
  return pathname === '/'
    ? join(publicRoot, 'site-root-internal.html')
    : join(publicRoot, pathname.replace(/^\//, ''));
}

function count(html, expression) {
  return [...html.matchAll(expression)].length;
}

function schemaItems(html, file) {
  const items = [];
  for (const match of html.matchAll(/<script\s+type="application\/ld\+json">([\s\S]*?)<\/script>/gi)) {
    try {
      const value = JSON.parse(match[1]);
      items.push(...(value['@graph'] || [value]));
    } catch (error) {
      failures.push(`${file}: invalid JSON-LD (${error.message})`);
    }
  }
  return items;
}

if (new Set(urls).size !== urls.length) failures.push('sitemap.xml: duplicate URLs');
if (/<(?:priority|changefreq)>/.test(sitemap)) failures.push('sitemap.xml: contains Google-ignored priority/changefreq tags');

const pages = [];
for (const url of urls) {
  const file = routeFile(url);
  if (!existsSync(file)) {
    failures.push(`${url}: local file missing`);
    continue;
  }
  const html = readFileSync(file, 'utf8');
  const displayFile = relative(process.cwd(), file);
  const title = (html.match(/<title>([\s\S]*?)<\/title>/i) || [])[1]?.trim();
  const description = (html.match(/<meta\s+name="description"\s+content="([^"]+)"/i) || [])[1]?.trim();
  const canonical = (html.match(/<link\s+rel="canonical"\s+href="([^"]+)"/i) || [])[1];
  const robots = (html.match(/<meta\s+name="robots"\s+content="([^"]+)"/i) || [])[1] || '';
  const h1Count = count(html, /<h1\b/gi);
  const missingAlt = [...html.matchAll(/<img\b[^>]*>/gi)]
    .filter(match => !/\balt="[^"]*"/i.test(match[0])).length;
  const schemas = schemaItems(html, displayFile);

  if (!title) failures.push(`${displayFile}: title missing`);
  if (!description) failures.push(`${displayFile}: meta description missing`);
  if (canonical !== url) failures.push(`${displayFile}: canonical ${canonical || 'missing'} does not match ${url}`);
  if (h1Count !== 1) failures.push(`${displayFile}: expected one H1, found ${h1Count}`);
  if (/noindex/i.test(robots)) failures.push(`${displayFile}: sitemap URL is noindex`);
  if (missingAlt) failures.push(`${displayFile}: ${missingAlt} image(s) missing alt attributes`);

  if (url.includes('/blog/') && url !== `${siteOrigin}/blog/index.html`) {
    const articles = schemas.filter(item => item?.['@type'] === 'Article');
    const breadcrumbs = schemas.filter(item => item?.['@type'] === 'BreadcrumbList');
    if (articles.length !== 1) failures.push(`${displayFile}: expected one Article entity, found ${articles.length}`);
    if (breadcrumbs.length !== 1) failures.push(`${displayFile}: expected one BreadcrumbList, found ${breadcrumbs.length}`);
    if (articles[0]?.author?.url !== `${siteOrigin}/about.html#editorial-standards`) {
      failures.push(`${displayFile}: Article author does not link to editorial standards`);
    }
  }

  pages.push({ url, file: displayFile, html, title, description });
}

for (const key of ['title', 'description']) {
  const groups = new Map();
  for (const page of pages) {
    const value = page[key];
    groups.set(value, [...(groups.get(value) || []), page]);
  }
  for (const [value, matches] of groups) {
    if (value && matches.length > 1) failures.push(`duplicate ${key}: ${matches.map(page => page.url).join(', ')}`);
  }
}

const inbound = new Map(urls.map(url => [new URL(url).pathname, 0]));
for (const page of pages) {
  for (const match of page.html.matchAll(/<a\b[^>]*href="([^"]+)"/gi)) {
    try {
      const target = new URL(match[1], page.url);
      if (target.origin === siteOrigin && inbound.has(target.pathname)) {
        inbound.set(target.pathname, inbound.get(target.pathname) + 1);
      }
    } catch {
      // Non-URL schemes and malformed optional links are outside this graph.
    }
  }
}
for (const [pathname, links] of inbound) {
  if (!links) failures.push(`${pathname}: orphaned sitemap URL`);
}

console.log(JSON.stringify({
  sitemapUrls: urls.length,
  canonicalPagesChecked: pages.length,
  minimumInboundLinks: Math.min(...inbound.values()),
  failures,
}, null, 2));

if (failures.length) process.exitCode = 1;
