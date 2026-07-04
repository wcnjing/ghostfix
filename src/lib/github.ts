// GitHub PR publisher. Takes the three repair drafts, commits them to a new
// branch in a target repo, and opens a PR. The PR is review-gated — nothing is
// merged automatically.
//
// Two auth paths:
//   1. OAuth token (passed in by caller, sourced from the user's session cookie)
//   2. Operator env (GITHUB_TOKEN + GITHUB_REPO) — kept as a fallback for the
//      single-tenant / dev path.

import { Octokit } from '@octokit/rest';

import type { AnalysisResult, Fix } from '@/lib/types';

export interface PublishTarget {
  token: string;
  owner: string;
  repo: string;
  base?: string;
  pathPrefix?: string;
}

export interface PublishResult {
  prUrl: string;
  branch: string;
  files: string[];
  repo: string;
}

const FIX_FILENAME: Record<Fix['type'], string> = {
  faq: 'faq.md',
  comparison_page: 'comparison.md',
  schema: 'schema.jsonld',
  evidence_stats: 'evidence-stats.md',
  trust_signals: 'trust-signals.md',
  freshness_update: 'freshness-update.md',
  answer_content: 'answer-content.md',
};

const DEFAULT_PREFIX = 'content/ghostfix';

export function envPublishTarget(): PublishTarget | null {
  const token = process.env.GITHUB_TOKEN;
  const repoFull = process.env.GITHUB_REPO;
  if (!token || !repoFull) return null;
  const [owner, repo] = repoFull.split('/');
  if (!owner || !repo) return null;
  return {
    token,
    owner,
    repo,
    base: process.env.GITHUB_BASE_BRANCH || undefined,
    pathPrefix: process.env.GITHUB_PATH_PREFIX ?? DEFAULT_PREFIX,
  };
}

export function canPublishFromEnv(): boolean {
  return envPublishTarget() !== null;
}

function shortId(id: string): string {
  return id.replace(/[^a-z0-9]/gi, '').slice(0, 8).toLowerCase();
}

function host(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

function prBody(analysis: AnalysisResult, fixes: Fix[]): string {
  const issues = analysis.issues
    .map((i) => `- **[${i.severity}]** ${i.title} — ${i.why}`)
    .join('\n');
  const filesList = fixes
    .map((f) => `- \`${FIX_FILENAME[f.type]}\` — ${fixDescription(f.type)}`)
    .join('\n');
  return [
    `## GhostFix repair PR`,
    '',
    `Drafted from a GhostFix diagnosis of [${host(analysis.brandUrl)}](${analysis.brandUrl}) against [${host(analysis.competitorUrl)}](${analysis.competitorUrl}).`,
    '',
    `**Visibility score:** ${analysis.score}/100`,
    '',
    `### Issues targeted`,
    issues,
    '',
    `### What this PR adds`,
    filesList,
    '',
    `### Review checklist`,
    `- [ ] Replace bracketed placeholders (e.g. \`[X%]\`) with real numbers.`,
    `- [ ] Verify factual claims in all content drafts.`,
    `- [ ] Check competitor claims for fairness.`,
    `- [ ] Decide where each content piece should live in your site.`,
    `- [ ] Wire any JSON-LD into the relevant page \`<head>\`.`,
    '',
    `Drafts are auto-generated. Do not merge without review.`,
  ].join('\n');
}

function fixDescription(type: Fix['type']): string {
  const desc: Record<Fix['type'], string> = {
    faq: 'answer-ready FAQ block',
    comparison_page: 'Markdown comparison page',
    schema: 'JSON-LD structured data',
    evidence_stats: 'stats and proof points page',
    trust_signals: 'trust signals and social proof',
    freshness_update: 'freshness improvement guide',
    answer_content: 'answer-optimized content blocks',
  };
  return desc[type] ?? type;
}

export async function publishToGithub(
  target: PublishTarget,
  analysis: AnalysisResult,
  fixes: Fix[],
): Promise<PublishResult | { error: string }> {
  const octokit = new Octokit({ auth: target.token });
  const { owner, repo } = target;
  const pathPrefix = target.pathPrefix ?? DEFAULT_PREFIX;

  let baseBranch = target.base;
  try {
    if (!baseBranch) {
      const { data } = await octokit.repos.get({ owner, repo });
      baseBranch = data.default_branch;
    }
  } catch (e) {
    return { error: `repo_unreachable: ${(e as Error).message}` };
  }

  let baseSha: string;
  try {
    const { data } = await octokit.git.getRef({
      owner,
      repo,
      ref: `heads/${baseBranch}`,
    });
    baseSha = data.object.sha;
  } catch (e) {
    return { error: `base_branch_lookup_failed: ${(e as Error).message}` };
  }

  const branch = `ghostfix/repair-${shortId(analysis.id)}-${Date.now().toString(36)}`;
  try {
    await octokit.git.createRef({
      owner,
      repo,
      ref: `refs/heads/${branch}`,
      sha: baseSha,
    });
  } catch (e) {
    return { error: `branch_create_failed: ${(e as Error).message}` };
  }

  const files: string[] = [];
  for (const fix of fixes) {
    const filename = FIX_FILENAME[fix.type];
    const path = `${pathPrefix}/${filename}`;
    try {
      await octokit.repos.createOrUpdateFileContents({
        owner,
        repo,
        path,
        branch,
        message: `chore(ghostfix): add ${filename}`,
        content: Buffer.from(fix.content, 'utf-8').toString('base64'),
      });
      files.push(path);
    } catch (e) {
      return { error: `commit_failed (${path}): ${(e as Error).message}` };
    }
  }

  try {
    const { data } = await octokit.pulls.create({
      owner,
      repo,
      head: branch,
      base: baseBranch,
      title: `GhostFix: AI-visibility repair for ${host(analysis.brandUrl)}`,
      body: prBody(analysis, fixes),
      draft: false,
    });
    return { prUrl: data.html_url, branch, files, repo: `${owner}/${repo}` };
  } catch (e) {
    return { error: `pr_create_failed: ${(e as Error).message}` };
  }
}
