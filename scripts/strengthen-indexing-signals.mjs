// Normalize trust and entity signals used by Google and other crawlers.
// The script is idempotent and only changes structured data/author blocks.

import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const publicRoot = join(process.cwd(), 'public');
const blogRoot = join(publicRoot, 'blog');
const siteUrl = 'https://pdfdukan.com';
const organizationId = `${siteUrl}/#organization`;
const organizationLogo = {
  '@type': 'ImageObject',
  url: `${siteUrl}/apple-touch-icon.png`,
  width: 180,
  height: 180,
};

function read(file) {
  return readFileSync(file, 'utf8');
}

function writeIfChanged(file, before, after) {
  if (after === before) return false;
  writeFileSync(file, after, 'utf8');
  console.log('updated', file.replace(`${process.cwd()}\\`, ''));
  return true;
}

function schemaBlocks(html) {
  return [...html.matchAll(/<script\s+type="application\/ld\+json">([\s\S]*?)<\/script>/gi)]
    .map(match => {
      try {
        return { match, value: JSON.parse(match[1]) };
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function graphItems(value) {
  return value['@graph'] || [value];
}

function updateEntitySchema(file) {
  const before = read(file);
  let after = before;
  const block = schemaBlocks(before).find(({ value }) =>
    graphItems(value).some(item => item?.['@type'] === 'Organization'));
  if (!block) throw new Error(`Organization schema not found in ${file}`);

  for (const item of graphItems(block.value)) {
    if (item?.['@type'] === 'Organization') {
      item.logo = organizationLogo;
      item.sameAs = ['https://github.com/mirzaaltafhussain97-art/pdfdukan'];
    }
    if (item?.['@type'] === 'AboutPage') {
      item.description = 'PDFdukan is a browser-based document scanning and PDF tools platform built in Pakistan and available to users globally.';
    }
    if (item?.['@type'] === 'WebSite') {
      item.alternateName = 'CamMaster by PDFdukan';
    }
  }

  const replacement = `<script type="application/ld+json">${JSON.stringify(block.value)}</script>`;
  after = after.slice(0, block.match.index) + replacement + after.slice(block.match.index + block.match[0].length);
  writeIfChanged(file, before, after);
}

function normalizeArticle(file) {
  const before = read(file);
  const canonical = (before.match(/<link\s+rel="canonical"\s+href="([^"]+)"/i) || [])[1];
  const modifiedMeta = (before.match(/<meta\s+property="article:modified_time"\s+content="([^"]+)"/i) || [])[1];
  if (!canonical) throw new Error(`Canonical missing in ${file}`);

  const blocks = schemaBlocks(before);
  const articleBlocks = blocks.filter(({ value }) =>
    graphItems(value).some(item => item?.['@type'] === 'Article'));
  if (!articleBlocks.length) return false;

  const primary = articleBlocks[0];
  const existingItems = graphItems(primary.value);
  const article = existingItems.find(item => item?.['@type'] === 'Article');
  article['@id'] = `${canonical}#article`;
  article.url = canonical;
  article.mainEntityOfPage = { '@type': 'WebPage', '@id': canonical };
  article.author = {
    '@type': 'Organization',
    name: 'PDFdukan Editorial Team',
    url: `${siteUrl}/about.html#editorial-standards`,
  };
  article.publisher = {
    '@type': 'Organization',
    '@id': organizationId,
    name: 'PDFdukan',
    url: siteUrl,
    logo: organizationLogo,
  };
  article.isPartOf = { '@id': `${siteUrl}/#website` };
  article.inLanguage = 'en';
  article.isAccessibleForFree = true;
  if (modifiedMeta) article.dateModified = modifiedMeta.slice(0, 10);

  const breadcrumb = existingItems.find(item => item?.['@type'] === 'BreadcrumbList') || {
    '@type': 'BreadcrumbList',
    '@id': `${canonical}#breadcrumb`,
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: `${siteUrl}/` },
      { '@type': 'ListItem', position: 2, name: 'Blog', item: `${siteUrl}/blog/index.html` },
      { '@type': 'ListItem', position: 3, name: article.headline, item: canonical },
    ],
  };
  breadcrumb['@id'] = `${canonical}#breadcrumb`;

  const normalized = {
    '@context': 'https://schema.org',
    '@graph': [article, breadcrumb],
  };
  const replacement = `<script type="application/ld+json">${JSON.stringify(normalized)}</script>`;
  let after = before.slice(0, primary.match.index) + replacement + before.slice(primary.match.index + primary.match[0].length);

  // Remove later Article blocks that duplicate or conflict with the canonical entity.
  for (const duplicate of articleBlocks.slice(1).reverse()) {
    const currentIndex = after.indexOf(duplicate.match[0]);
    if (currentIndex >= 0) {
      after = after.slice(0, currentIndex) + after.slice(currentIndex + duplicate.match[0].length);
    }
  }

  after = after
    .replace(/>PDFdukan Team<\/p>/g, '>PDFdukan Editorial Team</p>')
    .replace(/>Document Technology Specialists<\/p>/g, '>Product documentation and testing</p>')
    .replace(
      /The PDFdukan team builds and writes about free document tools\. We specialize in PDF workflows, OCR, and browser-based document processing\./g,
      'The PDFdukan Editorial Team documents browser-based tool behaviour, checks examples against the current interface, and records limitations users should verify.'
    )
    .replace(
      /(<p style="margin:0 0 4px;font-weight:700">)PDFdukan Editorial Team(<\/p>)/g,
      '$1<a href="../about.html#editorial-standards">PDFdukan Editorial Team</a>$2'
    );

  return writeIfChanged(file, before, after);
}

updateEntitySchema(join(publicRoot, 'site-root-internal.html'));
updateEntitySchema(join(publicRoot, 'about.html'));

let changed = 0;
const changedUrls = new Set([
  `${siteUrl}/`,
  `${siteUrl}/about.html`,
  `${siteUrl}/help.html`,
]);
for (const name of readdirSync(blogRoot).filter(name => name.endsWith('.html'))) {
  if (normalizeArticle(join(blogRoot, name))) {
    changed++;
    changedUrls.add(`${siteUrl}/blog/${name}`);
  }
}

console.log(`Normalized ${changed} article pages`);

// Google ignores sitemap priority/changefreq. Keep the file focused on
// canonical URLs and verifiable modification dates instead.
const sitemapFile = join(publicRoot, 'sitemap.xml');
const sitemapBefore = read(sitemapFile);
let sitemapAfter = sitemapBefore
  .replace(/<changefreq>[\s\S]*?<\/changefreq>/g, '')
  .replace(/<priority>[\s\S]*?<\/priority>/g, '');
for (const url of changedUrls) {
  const escaped = url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  sitemapAfter = sitemapAfter.replace(
    new RegExp(`(<loc>${escaped}<\\/loc><lastmod>)[^<]+`),
    (_match, prefix) => `${prefix}2026-08-25`
  );
}
writeIfChanged(sitemapFile, sitemapBefore, sitemapAfter);
