import { NextResponse } from 'next/server';

import {
  STATE_COOKIE,
  TOKEN_COOKIE,
  buildRedirectUri,
  exchangeCodeForToken,
  stateCookieOptions,
  tokenCookieOptions,
} from '@/lib/github-oauth';

export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const ghError = url.searchParams.get('error');

  const home = new URL('/', req.url);
  const isProd = process.env.NODE_ENV === 'production';

  if (ghError) {
    home.searchParams.set('gh_error', ghError);
    return NextResponse.redirect(home);
  }
  if (!code || !state) {
    home.searchParams.set('gh_error', 'missing_code_or_state');
    return NextResponse.redirect(home);
  }

  // Validate state against the cookie we set in /api/auth/github.
  const storedState = req.headers.get('cookie')?.match(
    new RegExp(`(?:^|;\\s*)${STATE_COOKIE}=([^;]+)`),
  )?.[1];
  if (!storedState || storedState !== state) {
    home.searchParams.set('gh_error', 'state_mismatch');
    return NextResponse.redirect(home);
  }

  const result = await exchangeCodeForToken(code, buildRedirectUri(req));
  if ('error' in result) {
    home.searchParams.set('gh_error', result.error);
    const errRes = NextResponse.redirect(home);
    errRes.cookies.set(STATE_COOKIE, '', { ...stateCookieOptions(isProd), maxAge: 0 });
    return errRes;
  }

  home.searchParams.set('gh', 'connected');
  const res = NextResponse.redirect(home);
  res.cookies.set(TOKEN_COOKIE, result.token, tokenCookieOptions(isProd));
  res.cookies.set(STATE_COOKIE, '', { ...stateCookieOptions(isProd), maxAge: 0 });
  return res;
}
