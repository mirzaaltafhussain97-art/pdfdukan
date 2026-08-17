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
  return NextResponse.next();
}

export const config = {
  matcher: ['/index.html', '/home.html'],
};
