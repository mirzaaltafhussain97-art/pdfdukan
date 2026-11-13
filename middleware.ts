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

  // Leftovers from the domain's old WordPress site: tell crawlers they are gone for good.
  if (/^\/(comments\/)?feed\/?$/.test(request.nextUrl.pathname) || request.nextUrl.pathname.startsWith('/category/')) {
    return new NextResponse(null, { status: 410 });
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/index.html', '/home.html', '/feed', '/feed/', '/comments/feed', '/comments/feed/', '/category/:path*'],
};
