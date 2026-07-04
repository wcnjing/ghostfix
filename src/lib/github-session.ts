// Helper: read the user's OAuth token out of the cookie on a route handler.
// Returns null when the cookie isn't present, so callers can fall back to
// the env-based publish path or return 401.

import { TOKEN_COOKIE } from '@/lib/github-oauth';

export function readTokenFromCookieHeader(header: string | null): string | null {
  if (!header) return null;
  const m = header.match(new RegExp(`(?:^|;\\s*)${TOKEN_COOKIE}=([^;]+)`));
  return m ? decodeURIComponent(m[1]) : null;
}

export function readTokenFromRequest(req: Request): string | null {
  return readTokenFromCookieHeader(req.headers.get('cookie'));
}
