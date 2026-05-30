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

  // API routes must never be cached by the browser.
  async headers() {
    return [
      {
        source: '/api/:path*',
        headers: [
          { key: 'Cache-Control', value: 'no-store, no-cache, must-revalidate' },
          { key: 'Pragma', value: 'no-cache' },
        ],
      },
    ];
  },
};

module.exports = nextConfig;
