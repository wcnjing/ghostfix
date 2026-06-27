import { NextResponse } from 'next/server';

import { readTokenFromRequest } from '@/lib/github-session';

interface GhRepo {
  full_name: string;
  name: string;
  private: boolean;
  default_branch: string;
  owner: { login: string };
  pushed_at: string | null;
  permissions?: { push?: boolean };
}

export async function GET(req: Request) {
  const token = readTokenFromRequest(req);
  if (!token) return NextResponse.json({ error: 'not_connected' }, { status: 401 });

  try {
    const res = await fetch(
      'https://api.github.com/user/repos?sort=updated&per_page=100&affiliation=owner,collaborator,organization_member',
      {
        headers: {
          authorization: `Bearer ${token}`,
          accept: 'application/vnd.github+json',
          'user-agent': 'GhostFix',
        },
      },
    );
    if (!res.ok) {
      return NextResponse.json({ error: `github_${res.status}` }, { status: 502 });
    }
    const data = (await res.json()) as GhRepo[];
    const repos = data
      .filter((r) => r.permissions?.push !== false)
      .map((r) => ({
        fullName: r.full_name,
        name: r.name,
        owner: r.owner.login,
        private: r.private,
        defaultBranch: r.default_branch,
        pushedAt: r.pushed_at,
      }));
    return NextResponse.json({ repos });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
