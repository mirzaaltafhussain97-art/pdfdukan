export const metadata = {
  title: 'Page Not Found | PDFdukan',
  robots: { index: false, follow: true },
};

export default function NotFound() {
  return (
    <main style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 24, background: '#fff8f5', color: '#24201f', fontFamily: 'Arial, sans-serif' }}>
      <section style={{ width: '100%', maxWidth: 560, padding: '48px 32px', textAlign: 'center', background: '#fff', border: '1px solid #f0d8cf', borderRadius: 20, boxShadow: '0 16px 45px rgba(90,45,25,.08)' }}>
        <a href="/" style={{ display: 'inline-block', marginBottom: 22, color: '#ef5b2a', fontSize: 24, fontWeight: 800, textDecoration: 'none' }}>PDFdukan</a>
        <div style={{ fontSize: 72, fontWeight: 900, lineHeight: 1, color: '#ef5b2a' }}>404</div>
        <h1 style={{ margin: '18px 0 10px', fontSize: 28 }}>Page not found</h1>
        <p style={{ margin: '0 auto 28px', maxWidth: 420, color: '#655d59', lineHeight: 1.6 }}>The page may have moved or no longer exists. Use one of the links below to continue.</p>
        <nav style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: 12 }} aria-label="Helpful links">
          <a href="/" style={{ padding: '12px 20px', borderRadius: 10, background: '#ef5b2a', color: '#fff', fontWeight: 700, textDecoration: 'none' }}>Go Home</a>
          <a href="/tools.html" style={{ padding: '12px 20px', borderRadius: 10, border: '1px solid #ef5b2a', color: '#d94718', fontWeight: 700, textDecoration: 'none' }}>Browse Tools</a>
        </nav>
      </section>
    </main>
  );
}
