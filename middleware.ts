import { NextRequest, NextResponse } from 'next/server';

export function middleware(request: NextRequest) {
  if (
    request.nextUrl.pathname === '/index.html' ||
    request.nextUrl.pathname === '/home.html'
  ) {
    const url = request.nextUrl.clone();
    url.pathname = '/';
    return NextResponse.redirect(url, 308);
  }

  if (request.nextUrl.pathname.startsWith('/models/')) {
    const response = NextResponse.next();
    response.headers.set('Content-Type', 'application/octet-stream');
    response.headers.set(
      'Cache-Control',
      'public, max-age=604800, stale-while-revalidate=86400',
    );
    return response;
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/index.html', '/home.html', '/models/:path*'],
};
