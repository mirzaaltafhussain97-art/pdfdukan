import './globals.css';

export const metadata = {
  title: {
    default: 'PDFdukan — Free Document Tools',
    template: '%s — PDFdukan',
  },
  description:
    'PDFdukan CamMaster: free browser-based PDF tools — scan, edit, merge, compress, sign, and more. No installation needed.',
  metadataBase: new URL(
    process.env.NEXT_PUBLIC_BASE_URL ?? 'http://localhost:3000'
  ),
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" data-theme="dark">
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      </head>
      <body>{children}</body>
    </html>
  );
}
