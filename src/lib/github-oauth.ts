// GitHub OAuth helpers. The operator registers a single OAuth App at
// github.com/settings/applications/new and sets CLIENT_ID + CLIENT_SECRET.
// End users never touch env — they click "Connect GitHub" in the UI.

import { randomBytes } from 'node:crypto';

export const TOKEN_COOKIE = 'gf_gh_token';
export const STATE_COOKIE = 'gf_gh_state';
export const TOKEN_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days
export const STATE_TTL_SECONDS = 60 * 10; // 10 minutes

export const OAUTH_SCOPE = 'repo';

export function oauthConfigured(): boolean {
  return Boolean(process.env.GITHUB_OAUTH_CLIENT_ID && process.env.GITHUB_OAUTH_CLIENT_SECRET);
}

export function buildRedirectUri(req: Request): string {
  // Prefer NEXT_PUBLIC_APP_URL when set so the redirect URI exactly matches
  // what's registered on the OAuth App. Fall back to the request's own origin.
  const configured = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, '');
  if (configured) return `${configured}/api/auth/github/callback`;
  const url = new URL(req.url);
  return `${url.origin}/api/auth/github/callback`;
}

export function makeState(): string {
  return randomBytes(16).toString('hex');
}

export function buildAuthorizeUrl(clientId: string, redirectUri: string, state: string): string {
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: OAUTH_SCOPE,
    state,
    allow_signup: 'true',
  });
  return `https://github.com/login/oauth/authorize?${params.toString()}`;
}

interface TokenExchangeResponse {
  access_token?: string;
  scope?: string;
  token_type?: string;
  error?: string;
  error_description?: string;
}

export async function exchangeCodeForToken(
  code: string,
  redirectUri: string,
): Promise<{ token: string } | { error: string }> {
  const clientId = process.env.GITHUB_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GITHUB_OAUTH_CLIENT_SECRET;
  if (!clientId || !clientSecret) return { error: 'oauth_not_configured' };

  try {
    const res = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: { accept: 'application/json', 'content-type': 'application/json' },
      body: JSON.stringify({
        client_id: clientId,
        client_secret: clientSecret,
        code,
        redirect_uri: redirectUri,
      }),
    });
    if (!res.ok) return { error: `exchange_failed_${res.status}` };
    const data = (await res.json()) as TokenExchangeResponse;
    if (data.access_token) return { token: data.access_token };
    return { error: data.error_description ?? data.error ?? 'no_token_in_response' };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export function tokenCookieOptions(isProd: boolean) {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: isProd,
    path: '/',
    maxAge: TOKEN_TTL_SECONDS,
  };
}

export function stateCookieOptions(isProd: boolean) {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: isProd,
    path: '/',
    maxAge: STATE_TTL_SECONDS,
  };
}
