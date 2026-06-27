import { NextResponse } from 'next/server';

import {
  STATE_COOKIE,
  buildAuthorizeUrl,
  buildRedirectUri,
  makeState,
  oauthConfigured,
  stateCookieOptions,
} from '@/lib/github-oauth';

export async function GET(req: Request) {
  if (!oauthConfigured()) {
    return NextResponse.redirect(new URL('/?gh_error=not_configured', req.url));
  }
  const clientId = process.env.GITHUB_OAUTH_CLIENT_ID!;
  const state = makeState();
  const redirectUri = buildRedirectUri(req);
  const authorizeUrl = buildAuthorizeUrl(clientId, redirectUri, state);

  const res = NextResponse.redirect(authorizeUrl);
  res.cookies.set(STATE_COOKIE, state, stateCookieOptions(process.env.NODE_ENV === 'production'));
  return res;
}
