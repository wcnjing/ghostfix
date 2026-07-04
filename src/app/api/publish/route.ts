import { NextResponse } from 'next/server';

import { canPublishFromEnv, envPublishTarget, publishToGithub } from '@/lib/github';
import { oauthConfigured } from '@/lib/github-oauth';
import { readTokenFromRequest } from '@/lib/github-session';
import type { AnalysisResult, Fix } from '@/lib/types';

export async function GET(req: Request) {
  const userToken = readTokenFromRequest(req);
  return NextResponse.json({
    canPublishFromEnv: canPublishFromEnv(),
    oauthConfigured: oauthConfigured(),
    userConnected: Boolean(userToken),
  });
}

interface PublishRequest {
  analysis: AnalysisResult;
  fixes: Fix[];
  repo?: string; // "owner/name" — required when publishing via user OAuth
  base?: string;
  pathPrefix?: string;
}

export async function POST(req: Request) {
  let body: PublishRequest;
  try {
    body = (await req.json()) as PublishRequest;
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }

  if (!body.analysis || !Array.isArray(body.fixes) || body.fixes.length === 0) {
    return NextResponse.json(
      { error: 'missing_fields', expected: ['analysis', 'fixes[]'] },
      { status: 400 },
    );
  }

  const userToken = readTokenFromRequest(req);
  let target;
  if (userToken && body.repo) {
    const [owner, repo] = body.repo.split('/');
    if (!owner || !repo) {
      return NextResponse.json({ error: 'invalid_repo' }, { status: 400 });
    }
    target = {
      token: userToken,
      owner,
      repo,
      base: body.base || undefined,
      pathPrefix: body.pathPrefix || undefined,
    };
  } else {
    const envTarget = envPublishTarget();
    if (!envTarget) {
      return NextResponse.json(
        {
          error: userToken ? 'repo_required' : 'not_connected',
          hint: userToken
            ? 'Pick a repo from the list and resend.'
            : 'Connect GitHub or set GITHUB_TOKEN + GITHUB_REPO in .env.local.',
        },
        { status: 503 },
      );
    }
    target = envTarget;
  }

  const result = await publishToGithub(target, body.analysis, body.fixes);
  if ('error' in result) {
    return NextResponse.json(result, { status: 502 });
  }
  return NextResponse.json(result);
}
