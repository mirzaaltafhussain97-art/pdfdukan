# PDFdukan — SEO / GEO / AEO Fix Summary (2026-06-04)

Changes made after cross-checking the 2026 Master Audit against the **actual code**
and mapping the new AI-search framework (AEO / GEO / Entity / Conversational SEO)
onto real gaps. Outdated audit claims (schema "zero", gmail exposed, ad-placeholder
text, canonical missing) were already fixed in the repo and were **not** re-touched.

## What was actually missing → fixed

| Area | Before | After |
|------|--------|-------|
| Open Graph + Twitter tags | only `index.html` | **all 72 HTML pages** |
| hreflang (`en` + `x-default`) | 4 pages | **all 72 pages** (self-referencing) |
| Canonical URL | 70 pages | **72 pages** (added to `settings.html`, `tools/pdf-editor.html`) |
| Entity SEO (Organization) | name/url/logo only | + `description`, `foundingDate`, `areaServed`, `knowsLanguage`, `alternateName`, support email |
| Pakistan geo targeting | none | `geo.region`, `geo.placename`, `geo.position`, `ICBM` on `index.html` |
| AEO "Quick Answer" boxes | none | top 5 tools (pdf-to-word, merge-pdf, ocr, compress-pdf, img-to-pdf) |

## Framework mapping (teacher's video)
- **AEO** → Quick Answer boxes (concise direct answers AI engines cite).
- **GEO** → OG/Twitter + og:image + existing structured data now complete sitewide.
- **Entity SEO** → Organization schema enriched with real data only.
- **Conversational** → FAQPage schema (already present) + Quick Answers.
- **Reputation SEO** → cannot be done in code; needs real Google/Trustpilot/LinkedIn reviews.

## Deliberately NOT done (would hurt, not help)
- **`hreflang="ur"`** — Urdu pages don't exist; pointing `ur` at English URLs sends
  Google a false signal. Add only when real Urdu pages ship.
- **`sameAs` social profiles** — no verified Twitter/LinkedIn/GitHub yet; injecting
  fake/empty URLs weakens entity trust. Add the real URLs to the Organization block
  in `index.html` once profiles exist.

## How the bulk change was applied
`scripts/seo-bulk.mjs` (idempotent Node script) — derives title/description/canonical
per page, injects OG/Twitter + hreflang only where absent. Safe to re-run for new pages.

## Recommended next steps (manual, content/off-site)
1. Create a real `og-image.jpg` (1200×630) at site root — currently referenced everywhere.
2. Expand blog to 20+ articles for AdSense (Pakistan/Urdu topics, comparison posts).
3. Per-tool unique 300+ word content to replace shared boilerplate.
4. Add real social profiles → fill `sameAs`.
5. Roll Quick Answer boxes out to the remaining tool pages.
