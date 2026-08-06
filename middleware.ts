import { NextRequest, NextResponse } from 'next/server';

// Password gate for hosted deployments. Set APP_PASSWORD in the host's
// environment variables to enable it; with no APP_PASSWORD set (e.g. running
// locally), the app is open.
export function middleware(req: NextRequest) {
  const password = process.env.APP_PASSWORD;
  if (!password) return NextResponse.next();

  const { pathname } = req.nextUrl;
  if (pathname === '/login' || pathname === '/api/login') return NextResponse.next();

  // Scheduled jobs authenticate with CRON_SECRET instead of the login cookie.
  // The route itself re-checks the header — this only lets it through.
  if (pathname.startsWith('/api/cron/')) {
    const secret = process.env.CRON_SECRET;
    if (secret && req.headers.get('authorization') === `Bearer ${secret}`) {
      return NextResponse.next();
    }
  }

  if (req.cookies.get('app_auth')?.value === password) return NextResponse.next();

  if (pathname.startsWith('/api/')) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const url = req.nextUrl.clone();
  url.pathname = '/login';
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
