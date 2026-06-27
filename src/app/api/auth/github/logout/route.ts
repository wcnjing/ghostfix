import { NextResponse } from 'next/server';

import { TOKEN_COOKIE, tokenCookieOptions } from '@/lib/github-oauth';

export async function POST() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(TOKEN_COOKIE, '', {
    ...tokenCookieOptions(process.env.NODE_ENV === 'production'),
    maxAge: 0,
  });
  return res;
}
