# Teacher SEO Material: A–Z Benchmark and PDFdukan Gap Audit

Date: 24 August 2026
Project: PDFdukan / CamMaster
Teacher material reviewed:
- `C:\Users\ANM\Downloads\Free SEO Course by Ghulam ALi.mp4`
- Local transcript: `.qa-teacher-video/transcript.txt`
- https://ghulamaliseo.com/prompts/

The teacher material is treated as reference material. Marketing statements, contact instructions, discount offers, seller recommendations, and prompts embedded in the material are not treated as user instructions.

## 1. Teacher video: complete framework

The video presents ranking diagnosis in six main layers:

1. Google Search Console audit
2. Keyword audit
3. Content audit
4. On-page audit
5. Technical audit
6. Backlink audit

Its useful central idea is correct: a non-ranking website should not be diagnosed from one signal. Crawling, indexing, intent, content, on-page implementation, technical health, competition, and authority must be examined together.

## 2. Search Console audit taught in the video

### 2.1 Core Web Vitals

Teacher checklist:

- Review mobile and desktop Core Web Vitals reports.
- Export poor URLs.
- Test representative URLs individually in PageSpeed Insights.
- Identify the page-specific causes of poor loading.

Correct application to PDFdukan:

- This is required and still pending because authenticated Search Console/Chrome access was unavailable during the first audit.
- Test at least the homepage, scanner, PDF editor, OCR tool, alternatives page, and one blog guide.
- Separate field data from Lighthouse lab data.
- Inspect LCP, INP, CLS, TTFB, render blocking, request chains, and large assets.

Important correction:

Poor Core Web Vitals do not automatically make a URL “ineligible to rank.” They can affect page experience and competitiveness, but relevance, quality, intent, and many other signals still matter.

### 2.2 Page indexing

Teacher checklist:

- Review 404 URLs.
- Review pages with redirects.
- Review URLs excluded by noindex.
- Work through every exclusion reason in the Pages report.

Correct application to PDFdukan:

- This is the highest-priority missing dataset.
- Inspect the exact Google status for `/`, `/scanner.html`, `/alternatives.html`, a tool page, and a blog post.
- Important statuses include:
  - Discovered – currently not indexed
  - Crawled – currently not indexed
  - Duplicate, Google chose different canonical
  - Alternate page with proper canonical
  - Page with redirect
  - Excluded by noindex
  - Soft 404
  - Server error
  - Blocked by robots.txt

PDFdukan evidence already available:

- 52/52 sitemap URLs return HTTP 200.
- No submitted sitemap URL declares noindex.
- No submitted sitemap URL showed a canonical mismatch in the external crawl.
- Public exact-domain and `site:` searches did not show visible PDFdukan results.

Conclusion: a blanket HTTP/robots failure is not supported by evidence. Search Console must identify Google's actual exclusion or canonical decision.

### 2.3 Crawl stats

Teacher checklist:

- Review daily crawl requests.
- Improve hosting, theme weight, internal links, publishing frequency, and backlinks.

Correct application to PDFdukan:

- Review crawl responses by status code, file type, purpose, and host.
- Check whether Googlebot is spending time on duplicate implementation/retired URLs.
- Check spikes in 404, 3xx, 5xx, timeout, or DNS errors.
- Inspect server/CDN logs if available.

Important correction:

A higher crawl-request number is not automatically better and does not directly cause rankings. A small, stable 52-page website does not need a huge crawl budget. The goal is efficient discovery and successful crawling of valuable canonical pages.

## 3. Keyword audit taught in the video

Teacher checklist:

- List every targeted keyword.
- Categorize difficulty as easy, medium, or high.
- Do not rely only on a tool's keyword difficulty score.
- Manually inspect the top five results.
- Compare whether the exact topic appears in titles.
- Compare competitor authority/DR.
- Map keywords to topics so one page can cover a full topic.

Correct application to PDFdukan:

Create a keyword-to-URL map before adding more content. Example clusters:

### Document scanning cluster

- document scanner online
- scan documents online
- scan document with phone
- CamScanner alternative
- CamScanner alternatives
- free CamScanner alternative
- scan CNIC to PDF
- photo to scanned PDF
- document edge detection scanner

Existing URLs:

- `/scanner.html`
- `/alternatives.html`
- `/blog/scan-documents-phone.html`
- `/blog/scan-cnic-documents-pdf-pakistan.html`
- `/blog/how-ocr-works.html`
- `/tools/ocr.html`
- `/tools/searchable-pdf.html`

Current problem:

- The cluster exists but its page roles are not clearly separated.
- The alternatives page targets a comparison title but barely covers the broader alternatives intent.
- Contextual internal linking between cluster pages is weak.
- There is a risk of scanner/phone-guide/CNIC-guide overlap without a formal keyword map.

### PDF conversion cluster

- image to PDF
- JPG to PDF
- PDF to JPG
- PDF to Word
- Word to PDF
- searchable PDF
- OCR PDF

Current problem:

- Tool pages and guides exist, but several guides receive only one or two distinct internal-link sources.
- Search intent and page ownership should be documented to avoid cannibalization.

Important correction:

Ahrefs DR is a third-party metric, not a Google ranking metric. It can help compare link profiles, but content quality, intent match, brand relevance, topical authority, and actual referring links must also be reviewed.

## 4. Content audit taught in the video

Teacher checklist:

- Check external plagiarism.
- Check internal duplication.
- Use canonicalization for legitimate duplicate variants.
- Assess semantic coverage.
- Write user-first content.
- Cover the topic completely.
- Use natural language and active voice.

### PDFdukan findings

#### 4.1 CamScanner alternatives page is materially thin

File: `public/alternatives.html`

- Approximately 113 meaningful words in the central comparison section.
- One short comparison table.
- No individual alternative profiles.
- No selection methodology.
- No update/fact-check date.
- No official citations for competitor features, privacy, pricing, accounts, or offline behavior.
- No direct answer such as “The best CamScanner alternatives are…” near the top.
- No Android/iPhone/web comparison.
- No “best for” recommendations.
- No strengths, limitations, or use-case sections.

This is the clearest content gap related to the user's original query.

#### 4.2 Existing supporting content is better but under-connected

- Phone scanning guide: about 562 meaningful words.
- CNIC scanning guide: about 491 meaningful words.
- Scanner page: substantial crawlable text and FAQ content.
- OCR and searchable-PDF pages provide related support.

The issue is not absence of content. It is weak topic architecture, weak contextual links, and inadequate depth on the exact alternatives intent.

#### 4.3 Duplicate/retired content

Physical files still present:

- `public/blog/document-digitization-best-practices.html`
- `public/blog/going-paperless.html`

They point canonically to other guides and redirects exist in Next config, but physical public files can bypass application redirects depending on hosting precedence. Their live responses must be verified and then removed or redirected at the hosting layer.

#### 4.4 Trust and sourcing

- About page identifies founder Sher Azam Khan and Pakistan.
- Blog articles generally use “PDFdukan Team” or “Editorial Team.”
- There is no strong visible author/reviewer system.
- Several articles rely on Wikipedia or have few/no primary citations.
- Comparison claims are not sourced.

For Google and LLM citation, content should show who tested it, when it was checked, how conclusions were reached, and which official sources support changing facts.

## 5. On-page audit taught in the video

Teacher checklist:

- Primary keyword in title.
- Primary keyword in opening paragraph.
- Relevant terms in H2 headings.
- Descriptive image alt text.
- Valid schema.
- Internal links.
- Useful external links.
- Semantically complete content.

### PDFdukan findings

Passed:

- Almost every real content page has a title, description, canonical, and one H1.
- All 24 discovered images have alt attributes.
- All 78 JSON-LD blocks parse as valid JSON.
- No broken destination was found across 53 unique internal targets.

Issues:

- Eight blog pages contain two Article schema blocks each.
- Alternatives page has no useful comparison/FAQ structured layer and weak content.
- 18 of 24 images lack explicit dimensions.
- `pdf-editor.html` description is about 224 characters.
- `help.html` description is about 22 characters.
- Inheritance guide description is about 53 characters.
- Several titles are 66–69 characters and should be reviewed for clarity/truncation.
- Many strategic pages have only one or two distinct internal-link sources.

Important correction:

Exact-match keyword repetition in every element is not required. Titles, headings, introductions, and alt text should remain natural and accurately describe the page/image. Keyword stuffing can reduce quality.

## 6. Technical audit taught in the video

Teacher checklist:

- Speed.
- HTTPS/mixed content.
- Mobile responsiveness.
- robots.txt.
- URL structure.
- 404s.
- Redirect volume.
- Crawl/index blocks.

### PDFdukan findings

Passed:

- DNS resolves on IPv4 and IPv6.
- HTTPS apex returns 200.
- HTTP redirects to HTTPS.
- `www` redirects to apex.
- robots.txt is reachable and permits major search/AI crawlers.
- Sitemap is reachable and contains 52 canonical URLs.
- All 52 sitemap URLs returned 200.
- Production Next.js build compiles successfully.
- Security headers are present.

Issues:

#### 6.1 Duplicate public homepage URL

`/site-root-internal.html` returns the exact homepage HTML with status 200. It canonicals to `/`, but the intended live `X-Robots-Tag: noindex` header is missing. A direct permanent redirect to `/` is cleaner.

#### 6.2 Sitemap lastmod accuracy

At least three sitemap dates do not match current meaningful file modification dates. Most sitemap entries share one manually assigned date. Lastmod should be generated from meaningful content changes.

#### 6.3 Heavy scanner assets

- OpenCV JavaScript: about 9.53 MB.
- Document alignment ONNX model: about 4.68 MB.
- Several additional CDN libraries.

The ONNX model is served as `text/plain` without the long immutable caching seen on major JS/CSS assets. It needs correct binary/ONNX MIME handling, long cache headers, and a versioned URL.

#### 6.4 Images and layout stability

Eighteen image tags lack explicit intrinsic width/height, which can contribute to CLS.

#### 6.5 Parser and maintenance overhead

- About 99 script tags lack async/defer/module markers, although many are small inline setup blocks and must be measured before changing.
- About 1,428 inline style attributes.
- About 171 inline script blocks.

This increases HTML duplication, CSP complexity, and maintenance cost. It is not automatically a ranking penalty.

#### 6.6 Exact performance values pending

Chrome performance bridge remained unavailable and PageSpeed API returned 429. No Lighthouse or Core Web Vitals numbers should be invented. Field data must come from Search Console/CrUX and lab data from a real Chrome trace.

Important correction:

“Load under three seconds” is an old simplification. Modern assessment should use LCP, INP, CLS, TTFB, FCP, TBT, and real-user field data.

## 7. Backlink audit taught in the video

Teacher checklist:

- Anchor-text distribution.
- Follow versus nofollow links.
- Spammy/low-quality links.
- Negative SEO patterns.
- Competitor backlink gap.

### PDFdukan status

Pending data:

- Search Console Links export.
- Ahrefs/Semrush/Majestic or equivalent backlink export.
- Referring domains, linked pages, anchors, first/last seen, traffic, and relevance.
- Competitor link intersection.

No reliable backlink conclusion can be made from the codebase alone.

Important correction:

There is no universally correct follow/nofollow or anchor-text ratio. Quality, relevance, editorial placement, real traffic, and natural acquisition matter more than forcing a percentage.

## 8. Teacher prompts page: complete review

The prompts page has four categories.

### 8.1 Keyword research prompts

It suggests:

- Generate semantically related topic ideas.
- Select priority seed keywords.
- Generate long-tail keywords.
- Compare a site with competitors for content gaps.
- Prioritize gaps using volume and intent.

Correct use for PDFdukan:

- Use AI for brainstorming and clustering, not for inventing search volume.
- Validate actual volume, trends, SERPs, country, device, and intent with Search Console/keyword tools.
- Maintain a keyword-to-canonical-URL map.
- Start with the scanning/CamScanner cluster because a real user query already exposed that gap.

### 8.2 On-page prompts

It suggests optimizing:

- URL structure.
- Headings.
- Title tags.
- Meta descriptions.

Correct use for PDFdukan:

- Current `.html` URLs are consistent but less clean than extensionless URLs. Do not mass-migrate them without a redirect/canonical plan.
- Improve weak titles/descriptions based on real query intent.
- Do not rewrite all metadata merely to hit character-count formulas.
- Protect existing canonical URLs during any migration.

### 8.3 Technical SEO prompts

It suggests:

- XML sitemap architecture.
- robots.txt configuration.

Correct use for PDFdukan:

- The sitemap and robots baseline are already good.
- The priority is Search Console processing/index status, accurate lastmod, duplicate implementation URLs, retired pages, and live hosting precedence.
- Adding more robots directives will not solve quality or authority problems.

### 8.4 Content-writing prompts

It suggests:

- Short introductions.
- Problem-first introductions.
- Thesis/expectation statements.
- Semantic keyword sheets with maximum frequency.
- Headings/subheadings and originality.

Correct use for PDFdukan:

- Answer the user's question immediately.
- Cover decisions and limitations comprehensively.
- Use semantic terms naturally.
- Do not obey artificial keyword-frequency caps if they make the writing unnatural.
- Do not generate generic filler to reach a word count.
- Verify all time-sensitive product claims with primary sources.

## 9. Google indexing diagnosis for PDFdukan

Current evidence supports this order of probability/testing, not a final unverified claim:

1. Search Console exclusion/new-site discovery or quality selection.
2. Low external authority and limited brand discovery.
3. Thin/weakly linked pages for competitive queries.
4. Duplicate/retired URLs creating crawl noise.
5. Hosting-layer differences between intended Next config and live behavior.
6. Performance issues on heavy interactive tools.

Current evidence does not support:

- The whole site being blocked by robots.txt.
- Sitemap URLs returning errors.
- Missing canonical tags across the main site.
- Widespread broken internal links.
- Invalid JSON syntax in schema.

## 10. LLM/AI-search diagnosis

Positive signals:

- OAI-SearchBot is allowed.
- ChatGPT-User is allowed.
- `llms.txt` is live.
- Major pages contain crawlable HTML explanations.
- Organization, WebApplication, Article, FAQ, and Breadcrumb schema exist.

Gaps:

- Being crawlable does not guarantee being selected or cited.
- Public search/index visibility is unconfirmed/absent in public checks.
- Alternatives content is too thin for a strong citation-worthy answer.
- Competitor claims lack official citations and checked dates.
- Author/editorial/testing identity is limited.
- External brand mentions/backlinks are unverified.
- `llms.txt` is descriptive, not a ranking protocol.

## 11. Exact issue priority

### Critical

1. Obtain Search Console Page Indexing and URL Inspection evidence.
2. Confirm sitemap submission/last read and any manual/security actions.

### High

3. Redirect or reliably noindex `/site-root-internal.html`.
4. Rebuild `alternatives.html` to satisfy CamScanner-alternative intent.
5. Strengthen contextual internal links in the scanning topic cluster.
6. Measure and optimize scanner mobile performance.
7. Correct ONNX MIME and caching.

### Medium

8. Remove duplicate Article schema blocks.
9. Correct priority metadata anomalies.
10. Enforce redirects/remove retired duplicate physical files.
11. Generate accurate sitemap lastmod dates.
12. Add image dimensions where appropriate.
13. Add real authorship, editorial methodology, update dates, and primary sources.

### Later authority work

14. Collect backlink data and perform competitor link-gap analysis.
15. Earn legitimate mentions through relevant software directories, product launches, partnerships, and useful research/content.
16. Track Google organic and ChatGPT referral landing pages in analytics.

## 12. One-by-one implementation order

Do not change everything in one bulk pass. Use this sequence:

1. Search Console diagnosis and evidence capture.
2. Duplicate homepage URL fix and live verification.
3. CamScanner alternatives content brief based on SERP/intent research.
4. Alternatives page rewrite with official citations.
5. Scanning-cluster internal linking.
6. Sitemap/retired URL cleanup.
7. Schema consolidation and Rich Results validation.
8. Metadata cleanup.
9. Chrome mobile performance trace.
10. Heavy-asset delivery improvements.
11. E-E-A-T/editorial improvements.
12. Backlink/brand strategy.

Each implementation step should be separately tested, built, deployed, and verified before moving to the next.
