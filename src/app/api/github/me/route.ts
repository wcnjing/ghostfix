import { NextResponse } from 'next/server';

import { readTokenFromRequest } from '@/lib/github-session';

interface GhUser {
  login: string;
  name: string | null;
  avatar_url: string;
}

export async function GET(req: Request) {
  const token = readTokenFromRequest(req);
  if (!token) return NextResponse.json({ connected: false }, { status: 200 });

  try {
    const res = await fetch('https://api.github.com/user', {
      headers: {
        authorization: `Bearer ${token}`,
        accept: 'application/vnd.github+json',
        'user-agent': 'GhostFix',
      },
    });
    if (!res.ok) {
      return NextResponse.json({ connected: false }, { status: 200 });
    }
    const data = (await res.json()) as GhUser;
    return NextResponse.json({
      connected: true,
      login: data.login,
      name: data.name,
      avatarUrl: data.avatar_url,
    });
  } catch {
    return NextResponse.json({ connected: false }, { status: 200 });
  }
}
