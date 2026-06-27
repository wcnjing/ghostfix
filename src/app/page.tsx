'use client';

import { useEffect, useMemo, useState } from 'react';

import type {
  AnalysisResult,
  Citation,
  DimensionScore,
  Fix,
  Issue,
  ScoreDimension,
} from '@/lib/types';

// ─── Types & Constants ───────────────────────────────────────────────────────

interface PublishCaps {
  canPublishFromEnv: boolean;
  oauthConfigured: boolean;
  userConnected: boolean;
}

interface GhUser {
  login: string;
  name: string | null;
  avatarUrl: string;
}

interface GhRepo {
  fullName: string;
  name: string;
  owner: string;
  private: boolean;
  defaultBranch: string;
  pushedAt: string | null;
}

type Step = 'input' | 'analyzing' | 'diagnosis' | 'repairing' | 'repair' | 'publishing' | 'done';

const STEP_INDEX: Record<Step, number> = {
  input: 0,
  analyzing: 0,
  diagnosis: 1,
  repairing: 1,
  repair: 2,
  publishing: 2,
  done: 3,
};

const STEP_LABELS = ['Input', 'Diagnosis', 'Repair', 'Ship'];

const DIMENSION_LABEL: Record<ScoreDimension, string> = {
  share_of_answer: 'Share of answer',
  content_coverage: 'Content coverage',
  structured_data: 'Structured data',
  evidence_density: 'Evidence density',
  freshness_trust: 'Freshness & trust',
};

const FIX_LABEL: Record<Fix['type'], string> = {
  faq: 'FAQ block',
  comparison_page: 'Comparison page',
  schema: 'JSON-LD schema',
};

const FIX_EXT: Record<Fix['type'], string> = {
  faq: 'md',
  comparison_page: 'md',
  schema: 'json',
};

const DEFAULT_BRAND = 'https://linear.app';
const DEFAULT_COMPETITOR = 'https://www.atlassian.com/software/jira';
const DEFAULT_PROMPTS = [
  'best project management tool for engineers',
  'linear vs jira for fast moving startups',
  'simplest issue tracker with keyboard shortcuts',
].join('\n');

// ─── Shared Components ───────────────────────────────────────────────────────

function ProgressBar({ step }: { step: Step }) {
  const active = STEP_INDEX[step];
  return (
    <div className="flex items-center justify-center gap-1 sm:gap-2">
      {STEP_LABELS.map((label, i) => (
        <div key={label} className="flex items-center gap-1 sm:gap-2">
          <div className="flex items-center gap-1.5">
            <div
              className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold transition-all duration-300 ${
                i < active
                  ? 'bg-gradient-to-br from-pink-400 to-pink-600 text-white shadow-md'
                  : i === active
                    ? 'bg-gradient-to-br from-pink-400 to-pink-600 text-white shadow-md ring-4 ring-pink-200/50'
                    : 'border border-pink-200 bg-white/60 text-[var(--ink-500)]'
              }`}
            >
              {i < active ? '✓' : i + 1}
            </div>
            <span
              className={`hidden text-xs font-medium sm:inline ${
                i <= active ? 'text-[var(--pink-700)]' : 'text-[var(--ink-500)]'
              }`}
            >
              {label}
            </span>
          </div>
          {i < STEP_LABELS.length - 1 && (
            <div
              className={`h-px w-6 sm:w-10 transition-colors duration-300 ${
                i < active ? 'bg-pink-400' : 'bg-pink-200'
              }`}
            />
          )}
        </div>
      ))}
    </div>
  );
}

function Nav({ step }: { step: Step }) {
  return (
    <nav className="mb-8 flex flex-col items-center gap-4 sm:mb-12 sm:flex-row sm:justify-between">
      <div className="flex items-center gap-2">
        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-pink-300 to-pink-500 text-white shadow-md">
          <span className="text-base">✦</span>
        </div>
        <span className="text-lg font-semibold tracking-tight text-[var(--ink-900)]">
          GhostFix
        </span>
      </div>
      <ProgressBar step={step} />
    </nav>
  );
}

function LoadingInterstitial({ message }: { message: string }) {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-6">
      <div className="relative">
        <div className="h-16 w-16 animate-spin rounded-full border-4 border-pink-200 border-t-pink-500" />
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="text-lg">✦</span>
        </div>
      </div>
      <p className="text-sm font-medium text-[var(--ink-700)]">{message}</p>
    </div>
  );
}

// ─── Step 1: Input ───────────────────────────────────────────────────────────

interface InputStepProps {
  brandUrl: string;
  setBrandUrl: (v: string) => void;
  competitorUrl: string;
  setCompetitorUrl: (v: string) => void;
  promptsText: string;
  setPromptsText: (v: string) => void;
  parsedPrompts: string[];
  onAnalyze: () => void;
  onLoadDemo: () => void;
}

function InputStep({
  brandUrl,
  setBrandUrl,
  competitorUrl,
  setCompetitorUrl,
  promptsText,
  setPromptsText,
  parsedPrompts,
  onAnalyze,
  onLoadDemo,
}: InputStepProps) {
  return (
    <div className="flex min-h-[70vh] flex-col items-center justify-center">
      <section className="mb-10 text-center">
        <div className="mx-auto inline-flex items-center gap-2 rounded-full border border-pink-200 bg-white/60 px-3 py-1 text-xs text-[var(--pink-700)] backdrop-blur">
          <span className="h-1.5 w-1.5 rounded-full bg-pink-500" />
          AI visibility, made explainable
        </div>
        <h1 className="mt-6 text-4xl font-semibold tracking-tight text-[var(--ink-900)] sm:text-5xl">
          Don&rsquo;t just monitor
          <br />
          <span className="bg-gradient-to-r from-pink-500 to-rose-400 bg-clip-text text-transparent">
            AI visibility.
          </span>{' '}
          Repair it.
        </h1>
        <p className="mx-auto mt-4 max-w-lg text-sm text-[var(--ink-700)] sm:text-base">
          See how AI answer engines cite your site vs your competitor. Get a transparent score,
          the reasons you&rsquo;re losing, and content that closes the gap.
        </p>
      </section>

      <section className="gf-card w-full max-w-2xl p-6 sm:p-8">
        <h2 className="mb-1 text-lg font-semibold text-[var(--ink-900)]">
          Tell us what to check
        </h2>
        <p className="mb-5 text-sm text-[var(--ink-500)]">
          Your site, a competitor, and the prompts that matter.
        </p>
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="space-y-1.5 text-sm">
              <span className="font-medium text-[var(--ink-700)]">Your URL</span>
              <input
                className="gf-input w-full px-3 py-2.5 text-sm"
                value={brandUrl}
                onChange={(e) => setBrandUrl(e.target.value)}
                placeholder="https://yourbrand.com"
              />
            </label>
            <label className="space-y-1.5 text-sm">
              <span className="font-medium text-[var(--ink-700)]">Competitor URL</span>
              <input
                className="gf-input w-full px-3 py-2.5 text-sm"
                value={competitorUrl}
                onChange={(e) => setCompetitorUrl(e.target.value)}
                placeholder="https://competitor.com"
              />
            </label>
          </div>
          <label className="block space-y-1.5 text-sm">
            <span className="font-medium text-[var(--ink-700)]">
              Target prompts (one per line, up to 5)
            </span>
            <textarea
              className="gf-input h-28 w-full px-3 py-2.5 font-mono text-xs"
              value={promptsText}
              onChange={(e) => setPromptsText(e.target.value)}
            />
            <span className="text-xs text-[var(--ink-500)]">{parsedPrompts.length}/5 prompts</span>
          </label>
          <div className="flex flex-wrap gap-3 pt-2">
            <button
              onClick={onAnalyze}
              disabled={parsedPrompts.length === 0}
              className="gf-btn-primary px-6 py-2.5 text-sm font-semibold"
            >
              Run diagnosis →
            </button>
            <button
              onClick={onLoadDemo}
              className="gf-btn-secondary px-6 py-2.5 text-sm font-semibold"
            >
              Load demo example
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}

// ─── Step 2: Diagnosis ───────────────────────────────────────────────────────

function severityBadge(sev: Issue['severity']): string {
  if (sev === 'high') return 'bg-rose-100 text-rose-700 border border-rose-200';
  if (sev === 'medium') return 'bg-amber-100 text-amber-700 border border-amber-200';
  return 'bg-emerald-100 text-emerald-700 border border-emerald-200';
}

function ScoreBar({ d }: { d: DimensionScore }) {
  const pct = (d.score / d.max) * 100;
  const gradient =
    pct < 34
      ? 'linear-gradient(90deg, #f43f5e, #ec4899)'
      : pct < 67
        ? 'linear-gradient(90deg, #f59e0b, #ec4899)'
        : 'linear-gradient(90deg, #ec4899, #a855f7)';
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between">
        <span className="text-sm font-medium text-[var(--ink-900)]">
          {DIMENSION_LABEL[d.dimension]}
        </span>
        <span className="font-mono text-xs text-[var(--ink-500)]">
          {d.score} / {d.max}
        </span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-pink-50">
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{ width: `${pct}%`, background: gradient }}
        />
      </div>
      <ul className="space-y-0.5 text-xs text-[var(--ink-700)]">
        {d.reasons.map((r, i) => (
          <li key={i} className="flex gap-1.5">
            <span className="text-[var(--pink-500)]">·</span>
            <span>{r}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function CitationRow({ c }: { c: Citation }) {
  const bPct = Math.round(c.brandFrequency * 100);
  const cPct = Math.round(c.competitorFrequency * 100);
  return (
    <li className="space-y-3 rounded-2xl border border-pink-100 bg-white/60 p-4">
      <p className="text-sm font-medium text-[var(--ink-900)]">{c.prompt}</p>
      <div className="grid grid-cols-2 gap-4 text-xs">
        <div>
          <div className="flex justify-between text-[var(--ink-500)]">
            <span>You</span>
            <span className="font-mono">
              {c.brandCitedCount}/{c.runs} ({bPct}%)
            </span>
          </div>
          <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-pink-50">
            <div
              className="h-full rounded-full"
              style={{
                width: `${bPct}%`,
                background: 'linear-gradient(90deg, #ec4899, #a855f7)',
              }}
            />
          </div>
        </div>
        <div>
          <div className="flex justify-between text-[var(--ink-500)]">
            <span>Competitor</span>
            <span className="font-mono">
              {c.competitorCitedCount}/{c.runs} ({cPct}%)
            </span>
          </div>
          <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-pink-50">
            <div
              className="h-full rounded-full bg-[var(--ink-500)]/40"
              style={{ width: `${cPct}%` }}
            />
          </div>
        </div>
      </div>
      {c.sources.length > 0 && (
        <details className="text-xs text-[var(--ink-700)]">
          <summary className="cursor-pointer select-none text-[var(--pink-600)]">
            Sources cited ({c.sources.length})
          </summary>
          <ul className="mt-2 space-y-1 pl-3">
            {c.sources.slice(0, 5).map((s, i) => (
              <li key={i}>
                <a
                  className="underline decoration-pink-300 underline-offset-2 hover:text-[var(--pink-600)]"
                  href={s.url}
                  target="_blank"
                  rel="noreferrer"
                >
                  {s.title ?? s.domain}
                </a>{' '}
                <span className="font-mono text-[var(--ink-500)]">({s.domain})</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </li>
  );
}

interface DiagnosisStepProps {
  analysis: AnalysisResult;
  onRepair: () => void;
  onBack: () => void;
}

function DiagnosisStep({ analysis, onRepair, onBack }: DiagnosisStepProps) {
  const totalMax = analysis.scoreBreakdown.dimensions.reduce((s, d) => s + d.max, 0);
  return (
    <div className="space-y-6">
      {/* Score hero */}
      <section className="gf-card p-6 sm:p-8">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h2 className="text-xl font-semibold text-[var(--ink-900)]">
              AI visibility score
            </h2>
            <p className="mt-1 text-sm text-[var(--ink-500)]">
              Transparent rubric, one reason per row.
            </p>
          </div>
          <div className="text-right">
            <p className="bg-gradient-to-r from-pink-500 to-rose-400 bg-clip-text font-mono text-5xl font-bold text-transparent">
              {analysis.score}
            </p>
            <p className="font-mono text-xs text-[var(--ink-500)]">/ {totalMax}</p>
          </div>
        </div>
        <div className="mt-6 space-y-5">
          {analysis.scoreBreakdown.dimensions.map((d) => (
            <ScoreBar key={d.dimension} d={d} />
          ))}
        </div>
      </section>

      {/* Citations */}
      <section className="gf-card p-6 sm:p-8">
        <h2 className="text-xl font-semibold text-[var(--ink-900)]">
          Citations — you vs competitor
        </h2>
        <p className="mt-1 text-sm text-[var(--ink-500)]">
          Each prompt run {analysis.citations[0]?.runs ?? 3}× to smooth out non-determinism.
        </p>
        <ul className="mt-5 space-y-3">
          {analysis.citations.map((c, i) => (
            <CitationRow key={i} c={c} />
          ))}
        </ul>
      </section>

      {/* Issues */}
      <section className="gf-card p-6 sm:p-8">
        <h2 className="text-xl font-semibold text-[var(--ink-900)]">Top issues</h2>
        <p className="mt-1 text-sm text-[var(--ink-500)]">
          The most actionable findings from the rubric.
        </p>
        <ul className="mt-5 space-y-3">
          {analysis.issues.map((iss, i) => (
            <li
              key={i}
              className="flex items-start gap-3 rounded-2xl border border-pink-100 bg-white/60 p-4"
            >
              <span
                className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${severityBadge(iss.severity)}`}
              >
                {iss.severity}
              </span>
              <div className="space-y-1">
                <p className="text-sm font-medium text-[var(--ink-900)]">{iss.title}</p>
                <p className="text-xs text-[var(--ink-700)]">{iss.why}</p>
              </div>
            </li>
          ))}
        </ul>
      </section>

      {/* Bottom actions */}
      <div className="flex items-center justify-between pt-2">
        <button onClick={onBack} className="gf-btn-secondary px-5 py-2.5 text-sm font-medium">
          ← Back to input
        </button>
        <button onClick={onRepair} className="gf-btn-primary px-6 py-2.5 text-sm font-semibold">
          Generate fixes →
        </button>
      </div>
    </div>
  );
}

// ─── Step 3: Repair ──────────────────────────────────────────────────────────

function FixCard({ fix }: { fix: Fix }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    await navigator.clipboard.writeText(fix.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const download = () => {
    const blob = new Blob([fix.content], {
      type: fix.type === 'schema' ? 'application/json' : 'text/markdown',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ghostfix-${fix.type}.${FIX_EXT[fix.type]}`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-3 rounded-2xl border border-pink-100 bg-white/60 p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-[var(--ink-900)]">{FIX_LABEL[fix.type]}</h3>
        <div className="flex gap-2 text-xs">
          <button onClick={copy} className="gf-btn-secondary px-3 py-1.5 font-medium">
            {copied ? 'Copied' : 'Copy'}
          </button>
          <button onClick={download} className="gf-btn-secondary px-3 py-1.5 font-medium">
            Download
          </button>
        </div>
      </div>
      <pre className="max-h-72 overflow-auto rounded-xl bg-pink-50/60 p-3 font-mono text-xs whitespace-pre-wrap text-[var(--ink-900)]">
        {fix.content}
      </pre>
    </div>
  );
}

function BeforeAfter({ analysis }: { analysis: AnalysisResult }) {
  const gaps: { dim: ScoreDimension; before: string; after: string }[] = [];
  for (const d of analysis.scoreBreakdown.dimensions) {
    if (d.dimension === 'content_coverage' && d.score < d.max) {
      gaps.push({
        dim: d.dimension,
        before: 'No FAQ / comparison page',
        after: 'FAQ block + comparison page drafted',
      });
    }
    if (d.dimension === 'structured_data' && d.score < d.max) {
      gaps.push({
        dim: d.dimension,
        before: 'No JSON-LD on key pages',
        after: 'FAQPage JSON-LD drafted',
      });
    }
  }
  if (gaps.length === 0) return null;
  return (
    <div className="rounded-2xl border border-emerald-200 bg-emerald-50/60 p-4 text-xs">
      <p className="mb-2 font-semibold text-emerald-800">Before → after (content state)</p>
      <ul className="space-y-1">
        {gaps.map((g) => (
          <li key={g.dim} className="text-[var(--ink-700)]">
            <span className="text-[var(--ink-500)] line-through">{g.before}</span>{' '}
            <span aria-hidden className="text-[var(--pink-500)]">→</span>{' '}
            <span className="font-medium text-emerald-700">{g.after}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

interface RepairStepProps {
  analysis: AnalysisResult;
  fixes: Fix[];
  caps: PublishCaps;
  ghUser: GhUser | null;
  repos: GhRepo[] | null;
  loadingRepos: boolean;
  selectedRepo: string;
  setSelectedRepo: (v: string) => void;
  onDisconnect: () => void;
  onPublish: () => void;
  onBack: () => void;
}

function RepairStep({
  analysis,
  fixes,
  caps,
  ghUser,
  repos,
  loadingRepos,
  selectedRepo,
  setSelectedRepo,
  onDisconnect,
  onPublish,
  onBack,
}: RepairStepProps) {
  // Publish path:
  //   - User connected via OAuth → require a repo selection
  //   - Operator env configured → always allowed
  //   - Nothing → disabled with a "connect" CTA
  const usingOauth = !!ghUser;
  const usingEnv = !usingOauth && caps.canPublishFromEnv;
  const publishReady = usingOauth ? !!selectedRepo : usingEnv;

  return (
    <div className="space-y-6">
      <section className="gf-card p-6 sm:p-8">
        <h2 className="text-xl font-semibold text-[var(--ink-900)]">Your repair drafts</h2>
        <p className="mt-1 mb-5 text-sm text-[var(--ink-500)]">
          Review-ready FAQ, comparison page, and JSON-LD. Copy, download, or ship as a PR.
        </p>
        <BeforeAfter analysis={analysis} />
        <div className="mt-5 space-y-4">
          {fixes.map((f) => (
            <FixCard key={f.id} fix={f} />
          ))}
        </div>
      </section>

      <section className="gf-card p-6 sm:p-8">
        <h2 className="text-lg font-semibold text-[var(--ink-900)]">Ship as a PR</h2>
        <p className="mt-1 text-sm text-[var(--ink-500)]">
          Push the drafts to a new branch and open a pull request. Review-gated — nothing is
          merged automatically.
        </p>

        {!ghUser && !usingEnv && (
          <div className="mt-5 flex flex-col items-start gap-3 rounded-2xl border border-pink-100 bg-white/60 p-5">
            <p className="text-sm text-[var(--ink-700)]">
              Connect GitHub so we can open a PR against the repo of your choice.
            </p>
            {caps.oauthConfigured ? (
              <a
                href="/api/auth/github"
                className="gf-btn-primary inline-flex items-center gap-2 px-5 py-2.5 text-sm font-semibold"
              >
                <span aria-hidden>⎘</span> Connect GitHub
              </a>
            ) : (
              <p className="rounded-xl bg-pink-50/80 px-3 py-2 text-xs text-[var(--ink-700)]">
                GitHub OAuth isn&rsquo;t set up on this instance yet. Ask the operator to add{' '}
                <code className="font-mono">GITHUB_OAUTH_CLIENT_ID</code> and{' '}
                <code className="font-mono">GITHUB_OAUTH_CLIENT_SECRET</code>.
              </p>
            )}
          </div>
        )}

        {ghUser && (
          <div className="mt-5 space-y-4 rounded-2xl border border-pink-100 bg-white/60 p-5">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                {ghUser.avatarUrl && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={ghUser.avatarUrl}
                    alt=""
                    className="h-9 w-9 rounded-full ring-2 ring-pink-200"
                  />
                )}
                <div>
                  <p className="text-sm font-medium text-[var(--ink-900)]">
                    {ghUser.name ?? ghUser.login}
                  </p>
                  <p className="text-xs text-[var(--ink-500)]">
                    @{ghUser.login} · connected to GitHub
                  </p>
                </div>
              </div>
              <button
                onClick={onDisconnect}
                className="text-xs text-[var(--ink-500)] underline decoration-pink-200 underline-offset-2 hover:text-[var(--pink-700)]"
              >
                Disconnect
              </button>
            </div>

            <label className="block space-y-1.5">
              <span className="text-sm font-medium text-[var(--ink-700)]">
                Open the PR against
              </span>
              <select
                className="gf-input w-full px-3 py-2.5 text-sm"
                value={selectedRepo}
                onChange={(e) => setSelectedRepo(e.target.value)}
                disabled={loadingRepos || !repos}
              >
                <option value="">
                  {loadingRepos
                    ? 'Loading your repos…'
                    : repos && repos.length > 0
                      ? 'Choose a repository…'
                      : 'No writable repos found'}
                </option>
                {repos?.map((r) => (
                  <option key={r.fullName} value={r.fullName}>
                    {r.fullName}
                    {r.private ? ' · private' : ''}
                  </option>
                ))}
              </select>
              <span className="text-xs text-[var(--ink-500)]">
                Only repos you can push to are listed.
              </span>
            </label>
          </div>
        )}

        {usingEnv && !ghUser && (
          <p className="mt-4 rounded-xl bg-pink-50/80 px-3 py-2 text-xs text-[var(--ink-700)]">
            Publishing via operator-configured GitHub token.
          </p>
        )}
      </section>

      {/* Bottom actions */}
      <div className="flex items-center justify-between pt-2">
        <button onClick={onBack} className="gf-btn-secondary px-5 py-2.5 text-sm font-medium">
          ← Back to diagnosis
        </button>
        <button
          onClick={onPublish}
          disabled={!publishReady}
          className="gf-btn-primary px-6 py-2.5 text-sm font-semibold"
        >
          {usingOauth && !selectedRepo ? 'Pick a repo first' : 'Open PR →'}
        </button>
      </div>
    </div>
  );
}

// ─── Step 4: Done ────────────────────────────────────────────────────────────

interface DoneStepProps {
  prUrl: string;
  branch: string;
  onRestart: () => void;
}

function DoneStep({ prUrl, branch, onRestart }: DoneStepProps) {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-6">
      <div className="flex h-20 w-20 items-center justify-center rounded-full bg-gradient-to-br from-emerald-200 to-emerald-400 shadow-lg">
        <span className="text-3xl">✓</span>
      </div>
      <div className="text-center">
        <h2 className="text-2xl font-semibold text-[var(--ink-900)]">PR opened</h2>
        <p className="mt-2 text-sm text-[var(--ink-700)]">
          Branch <code className="rounded bg-pink-50 px-1.5 py-0.5 font-mono text-xs">{branch}</code> is ready for review.
        </p>
      </div>
      <a
        href={prUrl}
        target="_blank"
        rel="noreferrer"
        className="gf-btn-primary inline-block px-6 py-3 text-sm font-semibold"
      >
        View PR on GitHub ↗
      </a>
      <button
        onClick={onRestart}
        className="gf-btn-secondary px-5 py-2.5 text-sm font-medium"
      >
        Run another diagnosis
      </button>
    </div>
  );
}

// ─── Main Page ───────────────────────────────────────────────────────────────

export default function HomePage() {
  const [step, setStep] = useState<Step>('input');
  const [error, setError] = useState<string | null>(null);

  // Form state
  const [brandUrl, setBrandUrl] = useState(DEFAULT_BRAND);
  const [competitorUrl, setCompetitorUrl] = useState(DEFAULT_COMPETITOR);
  const [promptsText, setPromptsText] = useState(DEFAULT_PROMPTS);

  // Results state
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [fixes, setFixes] = useState<Fix[] | null>(null);
  const [prResult, setPrResult] = useState<{ prUrl: string; branch: string } | null>(null);

  // GitHub connection state
  const [publishCaps, setPublishCaps] = useState<PublishCaps>({
    canPublishFromEnv: false,
    oauthConfigured: false,
    userConnected: false,
  });
  const [ghUser, setGhUser] = useState<GhUser | null>(null);
  const [repos, setRepos] = useState<GhRepo[] | null>(null);
  const [loadingRepos, setLoadingRepos] = useState(false);
  const [selectedRepo, setSelectedRepo] = useState<string>('');

  // Initial GitHub state probe + handle OAuth redirect query params.
  useEffect(() => {
    const url = new URL(window.location.href);
    const ghError = url.searchParams.get('gh_error');
    const ghOk = url.searchParams.get('gh');
    if (ghError) setError(`GitHub: ${ghError}`);
    if (ghError || ghOk) {
      url.searchParams.delete('gh_error');
      url.searchParams.delete('gh');
      window.history.replaceState({}, '', url.toString());
    }

    void (async () => {
      try {
        const [capsRes, meRes] = await Promise.all([
          fetch('/api/publish'),
          fetch('/api/github/me'),
        ]);
        if (capsRes.ok) {
          const caps = (await capsRes.json()) as PublishCaps;
          setPublishCaps(caps);
        }
        if (meRes.ok) {
          const me = (await meRes.json()) as { connected: boolean } & Partial<GhUser>;
          if (me.connected && me.login) {
            setGhUser({
              login: me.login,
              name: me.name ?? null,
              avatarUrl: me.avatarUrl ?? '',
            });
          }
        }
      } catch {
        // ignore; UI shows "Connect" button
      }
    })();
  }, []);

  // Lazy-load repo list once the user is connected and we hit the repair step.
  useEffect(() => {
    if (!ghUser || repos !== null || step !== 'repair') return;
    setLoadingRepos(true);
    fetch('/api/github/repos')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d: { repos: GhRepo[] }) => setRepos(d.repos))
      .catch(() => setRepos([]))
      .finally(() => setLoadingRepos(false));
  }, [ghUser, repos, step]);

  const parsedPrompts = useMemo(
    () =>
      promptsText
        .split('\n')
        .map((p) => p.trim())
        .filter(Boolean)
        .slice(0, 5),
    [promptsText],
  );

  const runAnalyze = async (overrides?: { demo?: boolean }) => {
    setError(null);
    setStep('analyzing');
    try {
      const res = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          brandUrl: overrides?.demo ? DEFAULT_BRAND : brandUrl,
          competitorUrl: overrides?.demo ? DEFAULT_COMPETITOR : competitorUrl,
          prompts: overrides?.demo
            ? DEFAULT_PROMPTS.split('\n').filter(Boolean)
            : parsedPrompts,
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? `HTTP ${res.status}`);
      }
      const data = (await res.json()) as AnalysisResult;
      setAnalysis(data);
      setStep('diagnosis');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error');
      setStep('input');
    }
  };

  const runRepair = async () => {
    if (!analysis) return;
    setError(null);
    setStep('repairing');
    try {
      const res = await fetch('/api/repair', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ analysis }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? `HTTP ${res.status}`);
      }
      const data = (await res.json()) as { fixes: Fix[] };
      setFixes(data.fixes);
      setStep('repair');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error');
      setStep('diagnosis');
    }
  };

  const runPublish = async () => {
    if (!analysis || !fixes) return;
    setError(null);
    setStep('publishing');
    try {
      const body: Record<string, unknown> = { analysis, fixes };
      if (ghUser && selectedRepo) body.repo = selectedRepo;
      const res = await fetch('/api/publish', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = (await res.json().catch(() => null)) as
        | { prUrl: string; branch: string }
        | { error: string; hint?: string }
        | null;
      if (!res.ok || !data || 'error' in data) {
        const err = data as { error?: string; hint?: string } | null;
        throw new Error(err?.hint ?? err?.error ?? `HTTP ${res.status}`);
      }
      setPrResult(data);
      setStep('done');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error');
      setStep('repair');
    }
  };

  const disconnectGithub = async () => {
    await fetch('/api/auth/github/logout', { method: 'POST' });
    setGhUser(null);
    setRepos(null);
    setSelectedRepo('');
    setPublishCaps((p) => ({ ...p, userConnected: false }));
  };

  const loadDemo = () => {
    setBrandUrl(DEFAULT_BRAND);
    setCompetitorUrl(DEFAULT_COMPETITOR);
    setPromptsText(DEFAULT_PROMPTS);
    void runAnalyze({ demo: true });
  };

  const restart = () => {
    setStep('input');
    setAnalysis(null);
    setFixes(null);
    setPrResult(null);
    setError(null);
  };

  return (
    <main className="mx-auto max-w-5xl px-6 py-10 sm:py-14">
      <Nav step={step} />

      {error && (
        <div className="mb-6 rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-700">
          Error: {error}
        </div>
      )}

      {step === 'input' && (
        <InputStep
          brandUrl={brandUrl}
          setBrandUrl={setBrandUrl}
          competitorUrl={competitorUrl}
          setCompetitorUrl={setCompetitorUrl}
          promptsText={promptsText}
          setPromptsText={setPromptsText}
          parsedPrompts={parsedPrompts}
          onAnalyze={() => runAnalyze()}
          onLoadDemo={loadDemo}
        />
      )}

      {step === 'analyzing' && (
        <LoadingInterstitial message="Querying AI engines and crawling sites…" />
      )}

      {step === 'diagnosis' && analysis && (
        <DiagnosisStep
          analysis={analysis}
          onRepair={runRepair}
          onBack={() => setStep('input')}
        />
      )}

      {step === 'repairing' && (
        <LoadingInterstitial message="Generating repair drafts with Claude…" />
      )}

      {step === 'repair' && analysis && fixes && (
        <RepairStep
          analysis={analysis}
          fixes={fixes}
          caps={publishCaps}
          ghUser={ghUser}
          repos={repos}
          loadingRepos={loadingRepos}
          selectedRepo={selectedRepo}
          setSelectedRepo={setSelectedRepo}
          onDisconnect={disconnectGithub}
          onPublish={runPublish}
          onBack={() => setStep('diagnosis')}
        />
      )}

      {step === 'publishing' && (
        <LoadingInterstitial message="Opening PR on GitHub…" />
      )}

      {step === 'done' && prResult && (
        <DoneStep
          prUrl={prResult.prUrl}
          branch={prResult.branch}
          onRestart={restart}
        />
      )}

      <footer className="mt-16 text-center text-xs text-[var(--ink-500)]">
        GhostFix · Diagnose. Explain. Repair.
      </footer>
    </main>
  );
}
