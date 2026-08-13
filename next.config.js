/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,

  // ── Architecture ─────────────────────────────────────────────────────────
  // This is a mostly-static site (homepage, scanner, all tool pages live in
  // /public as plain HTML/CSS/JS). Next.js owns only the /app routes:
  //   /forgot-password   (auth UI)
  //   /api/auth/*        (serverless auth routes)
  // Everything in /public is served by Next at its own path automatically:
  //   /scanner.html, /tools/merge-pdf.html, /css/style.css, /js/app.js, ...
  //
  // Local dev: a single `npm run dev` now serves the WHOLE site on :3000.

  // Serve /public/index.html at the site root "/" (the app router has no
  // root page, so without this "/" would 404 — that was the deploy bug).
  async rewrites() {
    return [
      { source: '/', destination: '/index.html' },
    ];
  },

  // Canonical host: every canonical/og:url/sitemap entry uses the bare apex
  // domain, so www must 301 to non-www or Google treats them as two sites.
  async redirects() {
    return [
      {
        source: '/:path*',
        has: [{ type: 'host', value: 'www.pdfdukan.com' }],
        destination: 'https://pdfdukan.com/:path*',
        permanent: true,
      },
      // Consolidate the duplicate public-file homepage on the canonical root.
      {
        source: '/index.html',
        destination: '/',
        permanent: true,
      },
      // Duplicate blog pages — canonical is the -guide version
      {
        source: '/blog/going-paperless.html',
        destination: '/blog/going-paperless-guide.html',
        permanent: true,
      },
      {
        source: '/blog/document-digitization-best-practices.html',
        destination: '/blog/document-digitization-guide.html',
        permanent: true,
      },
      {
        source: '/blog/image-compression-guide.html',
        destination: '/blog/compress-images-guide.html',
        permanent: true,
      },
      {
        source: '/blog/maximizing-pdf-workflows.html',
        destination: '/blog/pdf-workflows.html',
        permanent: true,
      },
      {
        source: '/blog/document-scanning-tips.html',
        destination: '/blog/scan-documents-phone.html',
        permanent: true,
      },
      // Closely overlapping page-management tools now live in one organizer.
      ...['rotate-pdf', 'reorder-pdf', 'delete-pages'].map(t => ({
        source: `/tools/${t}.html`,
        destination: '/tools/pdf-organizer.html',
        permanent: true,
      })),
      // Keep the more complete faraid implementation as the single calculator.
      {
        source: '/tools/inheritance-calc.html',
        destination: '/tools/inheritance-calc-advanced.html',
        permanent: true,
      },
      // Retired AI tools (API-dependent, removed 2026-06-16) -> tools hub.
      // Deleted files no longer exist on disk, so these paths reach Next.js
      // and these redirects fire (the static layer is bypassed once gone).
      ...[
        'ai-detector', 'ai-humanizer', 'ai-pdf-chat', 'ai-pdf-summarizer',
        'ai-summarize', 'assignment-writer', 'cover-letter-generator',
        'essay-writer', 'mcq-generator', 'notes-generator',
        'research-summarizer', 'resume-analyzer',
        // Off-topic tools and converters retired after the indexing audit.
        'age-calc', 'bmi-calc', 'discount-calc', 'qr-generator',
        'barcode-generator', 'excel-to-pdf', 'ppt-to-pdf',
      ].map(t => ({
        source: `/tools/${t}.html`,
        destination: '/tools.html',
        permanent: true,
      })),
    ];
  },

  // Security + caching headers.
  async headers() {
    // CSP shipped in Report-Only mode first: it does NOT block anything, it only
    // reports violations. The site has pervasive inline scripts/handlers, WASM
    // (OpenCV/Tesseract), blob workers, Google Drive + GA + (future) AdSense, so a
    // strict enforced CSP would risk breaking tools on a site that deploys straight
    // to live. Verify the browser console shows no real violations, then rename the
    // key to 'Content-Security-Policy' to enforce.
    const csp = [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://www.googletagmanager.com https://www.google-analytics.com https://pagead2.googlesyndication.com https://*.googlesyndication.com https://*.googleadservices.com https://adservice.google.com https://*.google.com https://cdnjs.cloudflare.com https://apis.google.com https://accounts.google.com blob:",
      "worker-src 'self' blob:",
      "child-src 'self' blob:",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://cdnjs.cloudflare.com",
      "font-src 'self' https://fonts.gstatic.com https://cdnjs.cloudflare.com data:",
      "img-src 'self' data: blob: https:",
      "media-src 'self' blob: data:",
      "connect-src 'self' https://www.google-analytics.com https://*.google-analytics.com https://*.googleapis.com https://*.google.com https://pagead2.googlesyndication.com blob: data:",
      "frame-src 'self' https://accounts.google.com https://*.google.com https://googleads.g.doubleclick.net https://*.googlesyndication.com",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "upgrade-insecure-requests",
    ].join('; ');

    const securityHeaders = [
      { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
      { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
      { key: 'Permissions-Policy', value: 'camera=(self), microphone=(), geolocation=(), interest-cohort=()' },
      { key: 'X-DNS-Prefetch-Control', value: 'on' },
      { key: 'Content-Security-Policy-Report-Only', value: csp },
    ];

    return [
      {
        // Apply security headers site-wide.
        source: '/:path*',
        headers: securityHeaders,
      },
      {
        // API routes must never be cached by the browser.
        source: '/api/:path*',
        headers: [
          { key: 'Cache-Control', value: 'no-store, no-cache, must-revalidate' },
          { key: 'Pragma', value: 'no-cache' },
        ],
      },
      // Versioned static assets — immutable 1-year cache.
      // All /js/*.js and /css/*.css files include ?v=... query strings,
      // so changing the version instantly busts the cache.
      {
        source: '/js/:path*',
        headers: [{ key: 'Cache-Control', value: 'public, max-age=31536000, immutable' }],
      },
      {
        source: '/css/:path*',
        headers: [{ key: 'Cache-Control', value: 'public, max-age=31536000, immutable' }],
      },
      {
        source: '/images/:path*',
        headers: [{ key: 'Cache-Control', value: 'public, max-age=31536000, immutable' }],
      },
      {
        source: '/favicon:path*',
        headers: [{ key: 'Cache-Control', value: 'public, max-age=31536000, immutable' }],
      },
      {
        source: '/apple-touch-icon:path*',
        headers: [{ key: 'Cache-Control', value: 'public, max-age=31536000, immutable' }],
      },
      {
        source: '/_next/static/:path*',
        headers: [{ key: 'Cache-Control', value: 'public, max-age=31536000, immutable' }],
      },
      // HTML pages — short cache so content updates reach users within an hour.
      {
        source: '/:path*.html',
        headers: [{ key: 'Cache-Control', value: 'public, max-age=3600, must-revalidate' }],
      },
    ];
  },
};

module.exports = nextConfig;
