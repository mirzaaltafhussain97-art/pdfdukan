/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,

  // The existing static HTML/CSS/JS files live at the project root.
  // Next.js takes ownership of /app routes (auth pages + API routes).
  // All other paths fall through to the static files if you place them
  // in /public, or you can keep a separate static server for the tools.
  //
  // For local development: run `npm run dev` on port 3000 for auth/API,
  // and `python -m http.server 7722` for the static tools — exactly as before.

  // Ensure the API routes are never cached by the browser.
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

  // If you move the static tools into /public and want them routable
  // from the same origin, add rewrites here. Example:
  //   { source: '/scanner', destination: '/scanner.html' }
  // For now this is left empty — add as needed.
  async rewrites() {
    return [];
  },
};

module.exports = nextConfig;
