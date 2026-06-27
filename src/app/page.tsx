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

type Step =
  | 'connect'
  | 'input'
  | 'analyzing'
  | 'diagnosis'
  | 'repairing'
  | 'repair'
  | 'publishing'
  | 'done';

const STEP_INDEX: Record<Step, number> = {
  connect: 0,
  input: 0,
  analyzing: 0,
  diagnosis: 1,
  repairing: 1,
  repair: 2,
  publishing: 2,
  done: 3,
};

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

const STEPS = ['Input', 'Diagnosis', 'Repair', 'Ship'];

const DIM_LABEL: Record<ScoreDimension, string> = {
  share_of_answer: 'Answer share',
  content_coverage: 'Content',
  structured_data: 'Structured data',
  evidence_density: 'Evidence',
  freshness_trust: 'Freshness',
};

const FIX_LABEL: Record<Fix['type'], string> = {
  faq: 'FAQ',
  comparison_page: 'Comparison',
  schema: 'JSON-LD',
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

// ─── Shared ──────────────────────────────────────────────────────────────────

function StepIndicator({ step }: { step: Step }) {
  const active = STEP_INDEX[step];
  return (
    <div className="flex items-center gap-2">
      {STEPS.map((label, i) => (
        <div key={label} className="flex items-center gap-2">
          <span
            className={`text-xs font-medium transition-colors ${
              i <= active ? 'text-[var(--ink-900)]' : 'text-[var(--ink-500)]/50'
            }`}
          >
            {label}
          </span>
          {i < STEPS.length - 1 && (
            <div className={`h-px w-5 ${i < active ? 'bg-[var(--ink-900)]' : 'bg-pink-200'}`} />
          )}
        </div>
      ))}
    </div>
  );
}

function Header({ step, ghUser }: { step: Step; ghUser: GhUser | null }) {
  return (
    <header className="mb-16 flex items-center justify-between gap-4">
      <span className="text-sm font-semibold tracking-tight text-[var(--ink-900)]">
        GhostFix
      </span>
      <div className="flex items-center gap-4">
        {step !== 'connect' && <StepIndicator step={step} />}
        {ghUser && (
          <span className="flex items-center gap-2 text-xs text-[var(--ink-500)]">
            {ghUser.avatarUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={ghUser.avatarUrl}
                alt=""
                className="h-5 w-5 rounded-full ring-1 ring-pink-200"
              />
            )}
            @{ghUser.login}
          </span>
        )}
      </div>
    </header>
  );
}

function Spinner({ label }: { label: string }) {
  return (
    <div className="flex min-h-[65vh] flex-col items-center justify-center gap-5">
      <div className="h-10 w-10 animate-spin rounded-full border-2 border-pink-200 border-t-pink-500" />
      <p className="text-sm text-[var(--ink-500)]">{label}</p>
    </div>
  );
}

// ─── Step 0: Connect ─────────────────────────────────────────────────────────

interface ConnectProps {
  oauthConfigured: boolean;
  onSkip: () => void;
}

function ConnectStep({ oauthConfigured, onSkip }: ConnectProps) {
  return (
    <div className="flex min-h-[70vh] flex-col justify-center">
      <h1 className="text-5xl font-semibold tracking-tight text-[var(--ink-900)] sm:text-7xl">
        Connect GitHub
        <br />
        <span className="bg-gradient-to-r from-pink-500 to-rose-400 bg-clip-text text-transparent">
          to ship fixes
        </span>{' '}
        in one click.
      </h1>
      <p className="mt-5 max-w-md text-base text-[var(--ink-500)]">
        We&rsquo;ll open a PR with your repair drafts on the repo of your choice. Review-gated —
        nothing merges automatically.
      </p>

      <div className="mt-12 flex items-center gap-5">
        {oauthConfigured ? (
          <a
            href="/api/auth/github"
            className="gf-btn-primary inline-flex items-center gap-2 px-7 py-3 text-sm font-semibold"
          >
            <svg
              aria-hidden
              viewBox="0 0 24 24"
              width="16"
              height="16"
              fill="currentColor"
            >
              <path d="M12 .5C5.65.5.5 5.65.5 12c0 5.08 3.29 9.39 7.86 10.91.58.1.79-.25.79-.56v-2c-3.2.7-3.88-1.37-3.88-1.37-.52-1.32-1.27-1.67-1.27-1.67-1.04-.71.08-.7.08-.7 1.15.08 1.76 1.18 1.76 1.18 1.02 1.75 2.69 1.25 3.34.95.1-.74.4-1.25.72-1.54-2.55-.29-5.24-1.28-5.24-5.7 0-1.26.45-2.29 1.18-3.1-.12-.29-.51-1.46.11-3.05 0 0 .97-.31 3.18 1.18.92-.25 1.91-.38 2.9-.39.98.01 1.98.14 2.9.39 2.21-1.49 3.18-1.18 3.18-1.18.62 1.59.23 2.76.11 3.05.74.81 1.18 1.84 1.18 3.1 0 4.43-2.7 5.4-5.27 5.69.41.36.78 1.06.78 2.13v3.16c0 .31.21.67.8.56C20.21 21.39 23.5 17.08 23.5 12 23.5 5.65 18.35.5 12 .5z" />
            </svg>
            Connect GitHub
          </a>
        ) : (
          <div className="max-w-md rounded-xl border border-pink-100 bg-white/50 px-4 py-3 text-xs text-[var(--ink-700)]">
            GitHub OAuth isn&rsquo;t set up on this instance. Add{' '}
            <code className="font-mono">GITHUB_OAUTH_CLIENT_ID</code> and{' '}
            <code className="font-mono">GITHUB_OAUTH_CLIENT_SECRET</code> to{' '}
            <code className="font-mono">.env.local</code> to enable.
          </div>
        )}
        <button
          onClick={onSkip}
          className="text-sm text-[var(--ink-500)] hover:text-[var(--pink-600)]"
        >
          Skip for now
        </button>
      </div>
      <p className="mt-6 max-w-md text-xs text-[var(--ink-500)]">
        Skip if you just want to see the diagnosis. You can copy or download the fixes either way.
      </p>
    </div>
  );
}

// ─── Step 1: Input ───────────────────────────────────────────────────────────

interface InputProps {
  brandUrl: string;
  setBrandUrl: (v: string) => void;
  competitorUrl: string;
  setCompetitorUrl: (v: string) => void;
  promptsText: string;
  setPromptsText: (v: string) => void;
  count: number;
  onGo: () => void;
  onDemo: () => void;
}

function InputStep({
  brandUrl, setBrandUrl,
  competitorUrl, setCompetitorUrl,
  promptsText, setPromptsText,
  count, onGo, onDemo,
}: InputProps) {
  return (
    <div className="flex min-h-[70vh] flex-col justify-center">
      <h1 className="text-5xl font-semibold tracking-tight text-[var(--ink-900)] sm:text-7xl">
        See why AI
        <br />
        <span className="bg-gradient-to-r from-pink-500 to-rose-400 bg-clip-text text-transparent">
          recommends them
        </span>
        <br />
        over you.
      </h1>
      <p className="mt-5 max-w-md text-base text-[var(--ink-500)]">
        Transparent scoring. Actionable fixes. One click to ship.
      </p>

      <div className="mt-12 grid max-w-2xl gap-4 sm:grid-cols-2">
        <input
          className="gf-input px-4 py-3 text-sm"
          value={brandUrl}
          onChange={(e) => setBrandUrl(e.target.value)}
          placeholder="Your URL"
        />
        <input
          className="gf-input px-4 py-3 text-sm"
          value={competitorUrl}
          onChange={(e) => setCompetitorUrl(e.target.value)}
          placeholder="Competitor URL"
        />
      </div>
      <textarea
        className="gf-input mt-4 h-24 max-w-2xl px-4 py-3 font-mono text-xs"
        value={promptsText}
        onChange={(e) => setPromptsText(e.target.value)}
        placeholder="Prompts — one per line, up to 5"
      />
      <div className="mt-6 flex items-center gap-4">
        <button
          onClick={onGo}
          disabled={count === 0}
          className="gf-btn-primary px-7 py-3 text-sm font-semibold"
        >
          Diagnose
        </button>
        <button onClick={onDemo} className="text-sm text-[var(--ink-500)] hover:text-[var(--pink-600)]">
          Try demo
        </button>
      </div>
    </div>
  );
}

// ─── Step 2: Diagnosis ───────────────────────────────────────────────────────

function Bar({ d }: { d: DimensionScore }) {
  const pct = (d.score / d.max) * 100;
  return (
    <div className="space-y-1">
      <div className="flex items-baseline justify-between text-xs">
        <span className="font-medium text-[var(--ink-900)]">{DIM_LABEL[d.dimension]}</span>
        <span className="font-mono text-[var(--ink-500)]">{d.score}/{d.max}</span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-pink-100">
        <div
          className="h-full rounded-full bg-gradient-to-r from-pink-500 to-rose-400 transition-all duration-500"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

function CitationRow({ c }: { c: Citation }) {
  const bPct = Math.round(c.brandFrequency * 100);
  const cPct = Math.round(c.competitorFrequency * 100);
  return (
    <div className="flex items-center gap-4 rounded-xl border border-pink-100 bg-white/50 px-4 py-3">
      <p className="flex-1 text-sm text-[var(--ink-900)]">{c.prompt}</p>
      <div className="flex items-center gap-3 text-xs font-mono">
        <span className="text-[var(--pink-600)]">{bPct}%</span>
        <span className="text-[var(--ink-500)]">vs</span>
        <span className="text-[var(--ink-700)]">{cPct}%</span>
      </div>
    </div>
  );
}

function severity(sev: Issue['severity']): string {
  if (sev === 'high') return 'text-rose-600';
  if (sev === 'medium') return 'text-amber-600';
  return 'text-emerald-600';
}

interface DiagnosisProps {
  analysis: AnalysisResult;
  onRepair: () => void;
  onBack: () => void;
}

function DiagnosisStep({ analysis, onRepair, onBack }: DiagnosisProps) {
  const totalMax = analysis.scoreBreakdown.dimensions.reduce((s, d) => s + d.max, 0);
  return (
    <div className="space-y-12">
      {/* Score hero */}
      <div className="flex flex-col items-start gap-2">
        <p className="font-mono text-7xl font-bold text-[var(--ink-900)] sm:text-8xl">
          {analysis.score}
          <span className="text-3xl text-[var(--ink-500)]">/{totalMax}</span>
        </p>
        <p className="text-sm text-[var(--ink-500)]">AI visibility score</p>
      </div>

      {/* Breakdown */}
      <section className="max-w-xl space-y-4">
        {analysis.scoreBreakdown.dimensions.map((d) => (
          <Bar key={d.dimension} d={d} />
        ))}
      </section>

      {/* Citations */}
      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-[var(--ink-900)]">Citations</h2>
        <div className="space-y-2">
          {analysis.citations.map((c, i) => (
            <CitationRow key={i} c={c} />
          ))}
        </div>
        <p className="text-xs text-[var(--ink-500)]">
          Each prompt run {analysis.citations[0]?.runs ?? 3}× · Engine: {[...new Set(analysis.citations.map((c) => c.engine))].join(', ')}
        </p>
      </section>

      {/* Issues */}
      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-[var(--ink-900)]">Issues</h2>
        <ul className="space-y-2">
          {analysis.issues.map((iss, i) => (
            <li key={i} className="flex items-start gap-3 text-sm">
              <span className={`mt-0.5 text-xs font-semibold uppercase ${severity(iss.severity)}`}>
                {iss.severity}
              </span>
              <span className="text-[var(--ink-700)]">{iss.title}</span>
            </li>
          ))}
        </ul>
      </section>

      {/* Actions */}
      <div className="flex items-center gap-4 pt-4">
        <button onClick={onRepair} className="gf-btn-primary px-7 py-3 text-sm font-semibold">
          Generate fixes
        </button>
        <button onClick={onBack} className="text-sm text-[var(--ink-500)] hover:text-[var(--pink-600)]">
          ← Back
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
    <div className="rounded-xl border border-pink-100 bg-white/50 p-5">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-[var(--ink-900)]">{FIX_LABEL[fix.type]}</h3>
        <div className="flex gap-2 text-xs">
          <button onClick={copy} className="text-[var(--pink-600)] hover:underline">
            {copied ? 'Copied' : 'Copy'}
          </button>
          <button onClick={download} className="text-[var(--ink-500)] hover:underline">
            Download
          </button>
        </div>
      </div>
      <pre className="max-h-64 overflow-auto rounded-lg bg-pink-50/50 p-3 font-mono text-xs whitespace-pre-wrap text-[var(--ink-700)]">
        {fix.content}
      </pre>
    </div>
  );
}

interface RepairProps {
  fixes: Fix[];
  caps: PublishCaps;
  ghUser: GhUser | null;
  repos: GhRepo[] | null;
  loadingRepos: boolean;
  selectedRepo: string;
  setSelectedRepo: (v: string) => void;
  onConnect: () => void;
  onDisconnect: () => void;
  onPublish: () => void;
  onBack: () => void;
}

function RepairStep({
  fixes,
  caps,
  ghUser,
  repos,
  loadingRepos,
  selectedRepo,
  setSelectedRepo,
  onConnect,
  onDisconnect,
  onPublish,
  onBack,
}: RepairProps) {
  const usingOauth = !!ghUser;
  const usingEnv = !usingOauth && caps.canPublishFromEnv;
  const publishReady = usingOauth ? !!selectedRepo : usingEnv;

  return (
    <div className="space-y-10">
      <div>
        <h1 className="text-4xl font-semibold tracking-tight text-[var(--ink-900)] sm:text-5xl">
          Your fixes
        </h1>
        <p className="mt-2 text-sm text-[var(--ink-500)]">
          Review, copy, or ship as a PR. Nothing publishes without your approval.
        </p>
      </div>

      <div className="space-y-4">
        {fixes.map((f) => (
          <FixCard key={f.id} fix={f} />
        ))}
      </div>

      {/* GitHub block */}
      {ghUser ? (
        <div className="rounded-xl border border-pink-100 bg-white/50 p-5">
          <div className="mb-3 flex items-center justify-between">
            <p className="text-sm font-medium text-[var(--ink-900)]">
              Open a PR against
            </p>
            <button
              onClick={onDisconnect}
              className="text-xs text-[var(--ink-500)] hover:text-[var(--pink-600)]"
            >
              Disconnect
            </button>
          </div>
          <select
            className="gf-input w-full px-4 py-3 text-sm"
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
          <p className="mt-2 text-xs text-[var(--ink-500)]">
            Only repos you can push to are listed.
          </p>
        </div>
      ) : !usingEnv ? (
        <div className="rounded-xl border border-pink-100 bg-white/50 p-5">
          <p className="text-sm text-[var(--ink-700)]">
            Not connected to GitHub yet. Connect now to open a PR with these fixes.
          </p>
          <button
            onClick={onConnect}
            disabled={!caps.oauthConfigured}
            className="gf-btn-primary mt-3 px-5 py-2 text-xs font-semibold"
          >
            {caps.oauthConfigured ? 'Connect GitHub' : 'OAuth not configured'}
          </button>
        </div>
      ) : null}

      <div className="flex items-center gap-4">
        <button
          onClick={onPublish}
          disabled={!publishReady}
          className="gf-btn-primary px-7 py-3 text-sm font-semibold"
        >
          {usingOauth && !selectedRepo ? 'Pick a repo first' : 'Open PR'}
        </button>
        <button onClick={onBack} className="text-sm text-[var(--ink-500)] hover:text-[var(--pink-600)]">
          ← Back
        </button>
      </div>
    </div>
  );
}

// ─── Step 4: Done ────────────────────────────────────────────────────────────

function DoneStep({ prUrl, branch, onRestart }: { prUrl: string; branch: string; onRestart: () => void }) {
  return (
    <div className="flex min-h-[65vh] flex-col justify-center">
      <h1 className="text-5xl font-semibold tracking-tight text-[var(--ink-900)] sm:text-7xl">
        Shipped.
      </h1>
      <p className="mt-4 text-sm text-[var(--ink-500)]">
        Branch <code className="font-mono">{branch}</code> is ready for review.
      </p>
      <div className="mt-8 flex items-center gap-4">
        <a
          href={prUrl}
          target="_blank"
          rel="noreferrer"
          className="gf-btn-primary inline-block px-7 py-3 text-sm font-semibold"
        >
          View PR ↗
        </a>
        <button onClick={onRestart} className="text-sm text-[var(--ink-500)] hover:text-[var(--pink-600)]">
          Start over
        </button>
      </div>
    </div>
  );
}

// ─── Main ────────────────────────────────────────────────────────────────────

export default function HomePage() {
  const [step, setStep] = useState<Step>('connect');
  const [error, setError] = useState<string | null>(null);

  const [brandUrl, setBrandUrl] = useState(DEFAULT_BRAND);
  const [competitorUrl, setCompetitorUrl] = useState(DEFAULT_COMPETITOR);
  const [promptsText, setPromptsText] = useState(DEFAULT_PROMPTS);

  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [fixes, setFixes] = useState<Fix[] | null>(null);
  const [pr, setPr] = useState<{ prUrl: string; branch: string } | null>(null);

  const [caps, setCaps] = useState<PublishCaps>({
    canPublishFromEnv: false,
    oauthConfigured: false,
    userConnected: false,
  });
  const [ghUser, setGhUser] = useState<GhUser | null>(null);
  const [repos, setRepos] = useState<GhRepo[] | null>(null);
  const [loadingRepos, setLoadingRepos] = useState(false);
  const [selectedRepo, setSelectedRepo] = useState('');

  // Initial probe + handle the OAuth redirect query params.
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
        let nextCaps: PublishCaps = caps;
        if (capsRes.ok) {
          nextCaps = (await capsRes.json()) as PublishCaps;
          setCaps(nextCaps);
        }
        let connected = false;
        if (meRes.ok) {
          const me = (await meRes.json()) as { connected: boolean } & Partial<GhUser>;
          if (me.connected && me.login) {
            connected = true;
            setGhUser({
              login: me.login,
              name: me.name ?? null,
              avatarUrl: me.avatarUrl ?? '',
            });
          }
        }
        // If they're already connected (or there's no OAuth at all), skip the
        // Connect screen and drop them straight into the input form.
        if (connected || !nextCaps.oauthConfigured) {
          setStep('input');
        }
      } catch {
        // ignore; UI will show Connect step with whatever caps we have
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Lazy-load the repo list once we hit the repair step.
  useEffect(() => {
    if (!ghUser || repos !== null || step !== 'repair') return;
    setLoadingRepos(true);
    fetch('/api/github/repos')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d: { repos: GhRepo[] }) => setRepos(d.repos))
      .catch(() => setRepos([]))
      .finally(() => setLoadingRepos(false));
  }, [ghUser, repos, step]);

  const disconnect = async () => {
    await fetch('/api/auth/github/logout', { method: 'POST' });
    setGhUser(null);
    setRepos(null);
    setSelectedRepo('');
    setCaps((c) => ({ ...c, userConnected: false }));
  };

  const prompts = useMemo(
    () => promptsText.split('\n').map((p) => p.trim()).filter(Boolean).slice(0, 5),
    [promptsText],
  );

  const analyze = async (demo?: boolean) => {
    setError(null);
    setStep('analyzing');
    try {
      const res = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          brandUrl: demo ? DEFAULT_BRAND : brandUrl,
          competitorUrl: demo ? DEFAULT_COMPETITOR : competitorUrl,
          prompts: demo ? DEFAULT_PROMPTS.split('\n').filter(Boolean) : prompts,
        }),
      });
      if (!res.ok) {
        const b = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(b?.error ?? `HTTP ${res.status}`);
      }
      setAnalysis((await res.json()) as AnalysisResult);
      setStep('diagnosis');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error');
      setStep('input');
    }
  };

  const repair = async () => {
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
        const b = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(b?.error ?? `HTTP ${res.status}`);
      }
      const data = (await res.json()) as { fixes: Fix[] };
      setFixes(data.fixes);
      setStep('repair');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error');
      setStep('diagnosis');
    }
  };

  const publish = async () => {
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
      setPr(data);
      setStep('done');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error');
      setStep('repair');
    }
  };

  const restart = () => {
    setStep('input');
    setAnalysis(null);
    setFixes(null);
    setPr(null);
    setError(null);
  };

  const demo = () => {
    setBrandUrl(DEFAULT_BRAND);
    setCompetitorUrl(DEFAULT_COMPETITOR);
    setPromptsText(DEFAULT_PROMPTS);
    void analyze(true);
  };

  return (
    <main className="mx-auto max-w-4xl px-6 py-10 sm:px-10 sm:py-14">
      <Header step={step} ghUser={ghUser} />

      {error && (
        <p className="mb-8 text-sm text-rose-600">{error}</p>
      )}

      {step === 'connect' && (
        <ConnectStep
          oauthConfigured={caps.oauthConfigured}
          onSkip={() => setStep('input')}
        />
      )}

      {step === 'input' && (
        <InputStep
          brandUrl={brandUrl} setBrandUrl={setBrandUrl}
          competitorUrl={competitorUrl} setCompetitorUrl={setCompetitorUrl}
          promptsText={promptsText} setPromptsText={setPromptsText}
          count={prompts.length}
          onGo={() => analyze()}
          onDemo={demo}
        />
      )}

      {step === 'analyzing' && <Spinner label="Querying AI engines…" />}

      {step === 'diagnosis' && analysis && (
        <DiagnosisStep analysis={analysis} onRepair={repair} onBack={() => setStep('input')} />
      )}

      {step === 'repairing' && <Spinner label="Generating fixes…" />}

      {step === 'repair' && fixes && (
        <RepairStep
          fixes={fixes}
          caps={caps}
          ghUser={ghUser}
          repos={repos}
          loadingRepos={loadingRepos}
          selectedRepo={selectedRepo}
          setSelectedRepo={setSelectedRepo}
          onConnect={() => {
            window.location.href = '/api/auth/github';
          }}
          onDisconnect={disconnect}
          onPublish={publish}
          onBack={() => setStep('diagnosis')}
        />
      )}

      {step === 'publishing' && <Spinner label="Opening PR…" />}

      {step === 'done' && pr && (
        <DoneStep prUrl={pr.prUrl} branch={pr.branch} onRestart={restart} />
      )}
    </main>
  );
}
