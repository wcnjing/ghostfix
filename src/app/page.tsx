'use client';

import { useEffect, useMemo, useState } from 'react';

import type {
  AnalysisResult,
  Citation,
  DimensionScore,
  DiscoveredCompetitor,
  Fix,
  Issue,
  ResearchFindings,
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

const FIX_BLUEPRINT: Record<
  Fix['type'],
  {
    feature: string;
    placement: string;
    outcome: string;
    checklist: string[];
  }
> = {
  faq: {
    feature: 'Answer-ready FAQ module',
    placement: 'Add near pricing, product, or comparison pages.',
    outcome: 'Gives AI engines short, extractable answers to cite.',
    checklist: ['One question per target prompt', 'Direct answer first', 'Evidence or metric in every answer'],
  },
  comparison_page: {
    feature: 'Competitor comparison page',
    placement: 'Publish at /compare or /vs/[competitor].',
    outcome: 'Controls the side-by-side narrative before rivals do.',
    checklist: ['Clear table', 'When to choose you', 'Fair competitor positioning'],
  },
  schema: {
    feature: 'FAQPage structured data',
    placement: 'Embed in the page head with matching visible FAQ copy.',
    outcome: 'Makes the repair machine-readable for parsers and answer engines.',
    checklist: ['Valid JSON-LD', 'Matches visible page content', 'One Question per prompt'],
  },
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
    <div className="hidden items-center gap-2 rounded-full border border-pink-100 bg-white/70 px-3 py-2 shadow-sm sm:flex">
      {STEPS.map((label, i) => (
        <div key={label} className="flex items-center gap-2">
          <span
            className={`inline-flex h-6 items-center gap-1 rounded-full px-2 text-xs font-medium transition-all ${
              i <= active
                ? 'bg-[var(--ink-900)] text-white'
                : 'text-[var(--ink-500)]/60'
            }`}
          >
            <span className="font-mono text-[10px]">{i + 1}</span>
            {label}
          </span>
          {i < STEPS.length - 1 && (
            <div className={`h-px w-5 transition-colors ${i < active ? 'bg-[var(--ink-900)]' : 'bg-pink-200'}`} />
          )}
        </div>
      ))}
    </div>
  );
}

function Header({ step, ghUser, onLogout }: { step: Step; ghUser: GhUser | null; onLogout: () => void }) {
  return (
    <header className="sticky top-4 z-20 mb-14 flex items-center justify-between gap-4 rounded-full border border-pink-100 bg-white/75 px-4 py-3 shadow-sm backdrop-blur-xl">
      <span className="flex items-center gap-2 text-sm font-semibold tracking-tight text-[var(--ink-900)]">
        <span className="gf-pulse-ring h-2.5 w-2.5 rounded-full bg-[var(--pink-500)]" />
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
            <button
              onClick={onLogout}
              className="ml-1 text-[var(--ink-500)] hover:text-[var(--pink-600)]"
              title="Log out from GitHub"
            >
              ✕
            </button>
          </span>
        )}
      </div>
    </header>
  );
}

function Spinner({ label }: { label: string }) {
  return (
    <div className="flex min-h-[65vh] flex-col items-center justify-center gap-6">
      <div className="gf-glass relative h-40 w-72 overflow-hidden rounded-3xl p-5">
        <div className="mb-5 flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-full bg-pink-300" />
          <span className="h-2.5 w-2.5 rounded-full bg-pink-200" />
          <span className="h-2.5 w-2.5 rounded-full bg-pink-100" />
        </div>
        <div className="space-y-3">
          <div className="gf-shimmer h-4 w-44 rounded-full bg-pink-100" />
          <div className="gf-shimmer h-4 w-56 rounded-full bg-pink-50" />
          <div className="gf-shimmer h-10 w-full rounded-xl bg-white" />
        </div>
      </div>
      <p className="text-sm font-medium text-[var(--ink-500)]">{label}</p>
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
  hint: string;
  setHint: (v: string) => void;
  competitorUrl: string;
  setCompetitorUrl: (v: string) => void;
  promptsText: string;
  setPromptsText: (v: string) => void;
  manual: boolean;
  setManual: (v: boolean) => void;
  manualCount: number;
  onResearch: () => void;
  onManual: () => void;
  onDemo: () => void;
  onTestFixture: () => void;
}

function InputStep({
  brandUrl, setBrandUrl,
  hint, setHint,
  competitorUrl, setCompetitorUrl,
  promptsText, setPromptsText,
  manual, setManual,
  manualCount,
  onResearch, onManual, onDemo, onTestFixture,
}: InputProps) {
  return (
    <div className="grid min-h-[70vh] items-center gap-10 lg:grid-cols-[1.05fr_0.95fr]">
      <section className="gf-enter">
        <p className="mb-4 inline-flex rounded-full border border-pink-200 bg-pink-50 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-[var(--pink-600)]">
          AI visibility repair
        </p>
        <h1 className="text-5xl font-semibold tracking-tight text-[var(--ink-900)] sm:text-7xl">
          See why AI
          <br />
          <span className="bg-gradient-to-r from-pink-500 to-rose-400 bg-clip-text text-transparent">
            recommends rivals
          </span>
          <br />
          first.
        </h1>
        <p className="mt-5 max-w-lg text-base leading-relaxed text-[var(--ink-500)]">
          GhostFix researches your category, finds the prompts buyers ask, compares who gets
          cited, and turns gaps into review-ready website fixes.
        </p>

        <div className="mt-8 grid max-w-lg grid-cols-3 gap-3">
          {[
            ['01', 'Research'],
            ['02', 'Explain'],
            ['03', 'Deploy'],
          ].map(([n, label]) => (
            <div key={label} className="gf-card rounded-2xl px-4 py-3">
              <p className="font-mono text-[11px] text-[var(--pink-600)]">{n}</p>
              <p className="mt-1 text-sm font-semibold text-[var(--ink-900)]">{label}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="gf-enter-delay-1 gf-glass rounded-3xl p-5">
        <div className="mb-5 flex items-center justify-between">
          <div>
            <p className="text-sm font-semibold text-[var(--ink-900)]">Start a diagnosis</p>
            <p className="text-xs text-[var(--ink-500)]">
              {manual ? `${manualCount}/5 prompts ready` : 'Auto-discovers prompts and rivals'}
            </p>
          </div>
          <div className="rounded-full bg-pink-50 p-1 text-xs">
            <button
              onClick={() => setManual(false)}
              className={`rounded-full px-3 py-1.5 ${!manual ? 'bg-white text-[var(--ink-900)] shadow-sm' : 'text-[var(--ink-500)]'}`}
            >
              Auto
            </button>
            <button
              onClick={() => setManual(true)}
              className={`rounded-full px-3 py-1.5 ${manual ? 'bg-white text-[var(--ink-900)] shadow-sm' : 'text-[var(--ink-500)]'}`}
            >
              Manual
            </button>
          </div>
        </div>

        <div className="space-y-4">
          <input
            className="gf-input w-full px-4 py-3 text-sm"
            value={brandUrl}
            onChange={(e) => setBrandUrl(e.target.value)}
            placeholder="Your URL — e.g. https://yourbrand.com"
          />
          {!manual && (
            <input
              className="gf-input w-full px-4 py-3 text-sm"
              value={hint}
              onChange={(e) => setHint(e.target.value)}
              placeholder="Optional category hint"
            />
          )}

          {manual && (
            <>
              <input
                className="gf-input w-full px-4 py-3 text-sm"
                value={competitorUrl}
                onChange={(e) => setCompetitorUrl(e.target.value)}
                placeholder="Competitor URL"
              />
              <textarea
                className="gf-input h-24 w-full px-4 py-3 font-mono text-xs"
                value={promptsText}
                onChange={(e) => setPromptsText(e.target.value)}
                placeholder="Prompts — one per line, up to 5"
              />
            </>
          )}
        </div>

        <div className="mt-5 flex flex-wrap items-center gap-3">
          {manual ? (
            <button
              onClick={onManual}
              disabled={!brandUrl || !competitorUrl || manualCount === 0}
              className="gf-btn-primary px-6 py-3 text-sm font-semibold"
            >
              Run diagnosis
            </button>
          ) : (
            <button
              onClick={onResearch}
              disabled={!brandUrl}
              className="gf-btn-primary px-6 py-3 text-sm font-semibold"
            >
              Run research
            </button>
          )}
          <button onClick={onDemo} className="rounded-full px-3 py-2 text-sm text-[var(--ink-500)] hover:bg-pink-50 hover:text-[var(--pink-600)]">
            Try demo
          </button>
          <button
            onClick={onTestFixture}
            className="rounded-full px-3 py-2 text-sm text-[var(--ink-500)] hover:bg-pink-50 hover:text-[var(--pink-600)]"
            title="Loads two built-in fake landing pages so you can see the scoring + repair flow end-to-end"
          >
            Test fixture
          </button>
        </div>

        <div className="gf-float mt-6 rounded-2xl border border-pink-100 bg-white/70 p-4">
          <div className="mb-3 flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-full bg-pink-300" />
            <span className="h-2.5 w-2.5 rounded-full bg-pink-200" />
            <span className="h-2.5 w-2.5 rounded-full bg-pink-100" />
          </div>
          <div className="grid grid-cols-3 gap-2 text-xs">
            <div className="rounded-xl bg-pink-50 p-3">
              <p className="font-semibold">Prompts</p>
              <p className="mt-1 font-mono text-lg">5</p>
            </div>
            <div className="rounded-xl bg-white p-3">
              <p className="font-semibold">Rivals</p>
              <p className="mt-1 font-mono text-lg">3</p>
            </div>
            <div className="rounded-xl bg-[var(--ink-900)] p-3 text-white">
              <p className="font-semibold">Fixes</p>
              <p className="mt-1 font-mono text-lg">3</p>
            </div>
          </div>
        </div>
      </section>
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
    <div className="flex items-center gap-4 border-b border-[#f0f0f0] py-2.5 last:border-0">
      <p className="flex-1 text-sm text-[var(--ink-900)]">{c.prompt}</p>
      <div className="flex items-center gap-2 font-mono text-xs">
        <span className={bPct > 0 ? 'text-emerald-600' : 'text-rose-500'}>{bPct}%</span>
        <span className="text-[var(--ink-500)]">/</span>
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

function MetricTile({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  accent?: boolean;
}) {
  return (
    <div className={`gf-card rounded-2xl px-4 py-4 ${accent ? 'bg-pink-50' : ''}`}>
      <p className="text-[10px] uppercase tracking-wider text-[var(--ink-500)]">{label}</p>
      <p className="mt-1.5 font-mono text-2xl font-bold text-[var(--ink-900)]">{value}</p>
      {sub && <p className="mt-1 text-[11px] text-[var(--ink-500)]">{sub}</p>}
    </div>
  );
}

function ScoreDial({ score, max }: { score: number; max: number }) {
  const pct = Math.max(0, Math.min(100, Math.round((score / max) * 100)));
  return (
    <div className="gf-card gf-enter rounded-3xl p-6">
      <div className="flex flex-wrap items-center gap-6">
        <div
          className="grid h-36 w-36 place-items-center rounded-full"
          style={{
            background: `conic-gradient(var(--pink-500) ${pct}%, var(--pink-100) 0)`,
          }}
        >
          <div className="grid h-28 w-28 place-items-center rounded-full bg-white">
            <div className="text-center">
              <p className="font-mono text-4xl font-bold text-[var(--ink-900)]">{score}</p>
              <p className="text-xs text-[var(--ink-500)]">/{max}</p>
            </div>
          </div>
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--pink-600)]">
            Diagnosis summary
          </p>
          <h2 className="mt-2 text-3xl font-semibold tracking-tight text-[var(--ink-900)]">
            Your AI visibility gap is measurable.
          </h2>
          <p className="mt-3 max-w-xl text-sm leading-relaxed text-[var(--ink-500)]">
            GhostFix turns citation loss into a concrete repair plan: content to add, schema to ship,
            and a PR you can review before deploying.
          </p>
        </div>
      </div>
    </div>
  );
}

function CompetitorLeaderboardRow({
  c,
  selected,
}: {
  c: DiscoveredCompetitor;
  selected: boolean;
}) {
  const pct = c.promptCount > 0 ? Math.round((c.citationCount / c.promptCount) * 100) : 0;
  return (
    <div className="flex items-center justify-between gap-3 py-1.5">
      <div className="flex items-center gap-2">
        <span className="text-sm text-[var(--ink-900)]">{c.domain}</span>
        {selected && (
          <span className="rounded bg-[var(--ink-900)] px-1.5 py-0.5 text-[9px] font-semibold uppercase text-white">
            rival
          </span>
        )}
      </div>
      <span className="font-mono text-xs text-[var(--ink-500)]">{pct}%</span>
    </div>
  );
}

function renderMarkdownToReact(md: string) {
  // Very small renderer — handles headings, bullets, bold, and paragraph wraps.
  // Keeps the deps light. Anything fancier and we'd reach for react-markdown.
  const lines = md.split('\n');
  const out: React.ReactNode[] = [];
  let bulletBuf: string[] = [];
  const flushBullets = () => {
    if (bulletBuf.length === 0) return;
    out.push(
      <ul key={`ul-${out.length}`} className="my-3 space-y-1 pl-5 text-sm text-[var(--ink-700)]">
        {bulletBuf.map((b, i) => (
          <li key={i} className="list-disc">
            {inline(b)}
          </li>
        ))}
      </ul>,
    );
    bulletBuf = [];
  };
  const inline = (text: string): React.ReactNode => {
    const parts = text.split(/(\*\*[^*]+\*\*)/g);
    return parts.map((p, i) =>
      p.startsWith('**') && p.endsWith('**') ? (
        <strong key={i} className="text-[var(--ink-900)]">
          {p.slice(2, -2)}
        </strong>
      ) : (
        <span key={i}>{p}</span>
      ),
    );
  };
  for (const line of lines) {
    if (line.startsWith('## ')) {
      flushBullets();
      out.push(
        <h3
          key={`h-${out.length}`}
          className="mt-5 text-sm font-semibold text-[var(--ink-900)]"
        >
          {line.slice(3)}
        </h3>,
      );
    } else if (line.startsWith('# ')) {
      flushBullets();
      out.push(
        <h2
          key={`h-${out.length}`}
          className="mt-2 text-base font-semibold text-[var(--ink-900)]"
        >
          {line.slice(2)}
        </h2>,
      );
    } else if (/^[-*]\s/.test(line)) {
      bulletBuf.push(line.replace(/^[-*]\s/, ''));
    } else if (line.trim()) {
      flushBullets();
      out.push(
        <p key={`p-${out.length}`} className="my-2 text-sm leading-relaxed text-[var(--ink-700)]">
          {inline(line)}
        </p>,
      );
    } else {
      flushBullets();
    }
  }
  flushBullets();
  return <>{out}</>;
}

function FindingsDashboard({
  research,
  analysis,
}: {
  research: ResearchFindings;
  analysis: AnalysisResult;
}) {
  const totalMax = analysis.scoreBreakdown.dimensions.reduce((s, d) => s + d.max, 0);
  const promptsWithBrand = analysis.citations.filter((c) => c.brandCitedCount > 0).length;
  const citationShare =
    analysis.citations.length > 0
      ? Math.round((promptsWithBrand / analysis.citations.length) * 100)
      : 0;

  return (
    <div className="space-y-10">
      <ScoreDial score={analysis.score} max={totalMax} />

      {/* Hero metrics */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <MetricTile
          label="Score"
          value={<>{analysis.score}<span className="text-sm text-[var(--ink-500)]">/{totalMax}</span></>}
          accent
        />
        <MetricTile
          label="Citation share"
          value={`${citationShare}%`}
          sub={`${promptsWithBrand} of ${analysis.citations.length} prompts`}
        />
        <MetricTile
          label="Competitors"
          value={research.discoveredCompetitors.length}
        />
        <MetricTile
          label="Top rival"
          value={<span className="text-lg">{research.selectedCompetitorDomain}</span>}
        />
      </div>

      {/* Category + summary */}
      <div className="gf-card rounded-2xl px-5 py-4">
        <p className="text-[10px] uppercase tracking-wider text-[var(--ink-500)]">Category</p>
        <p className="mt-1 text-sm font-medium text-[var(--ink-900)]">{research.category}</p>
        <p className="mt-2 text-sm leading-relaxed text-[var(--ink-700)]">{research.brandSummary}</p>
      </div>

      {/* Prompts + leaderboard side by side */}
      <div className="grid gap-4 lg:grid-cols-5">
        <section className="gf-card rounded-2xl p-5 lg:col-span-3">
          <p className="mb-3 text-[10px] uppercase tracking-wider text-[var(--ink-500)]">Prompts tested</p>
          <div>
            {analysis.prompts.map((prompt, i) => {
              const cit = analysis.citations[i];
              const brandIn = cit && cit.brandCitedCount > 0;
              const compIn = cit && cit.competitorCitedCount > 0;
              return (
                <div key={i} className="flex items-center gap-3 border-b border-[#f0f0f0] py-2.5 last:border-0">
                  <span className="font-mono text-[11px] text-[var(--ink-500)]">{String(i + 1).padStart(2, '0')}</span>
                  <p className="flex-1 text-sm text-[var(--ink-900)]">{prompt}</p>
                  <span className={`text-[11px] font-medium ${brandIn ? 'text-emerald-600' : 'text-rose-500'}`}>
                    {brandIn ? 'cited' : 'absent'}
                  </span>
                  <span className={`text-[11px] ${compIn ? 'text-[var(--ink-700)]' : 'text-[var(--ink-500)]'}`}>
                    {compIn ? 'rival ✓' : '—'}
                  </span>
                </div>
              );
            })}
          </div>
        </section>

        <section className="gf-card rounded-2xl p-5 lg:col-span-2">
          <p className="mb-3 text-[10px] uppercase tracking-wider text-[var(--ink-500)]">Competitor leaderboard</p>
          <div className="divide-y divide-[#f0f0f0]">
            {research.discoveredCompetitors.map((c) => (
              <CompetitorLeaderboardRow key={c.domain} c={c} selected={c.domain === research.selectedCompetitorDomain} />
            ))}
          </div>
        </section>
      </div>

      {/* Narrative */}
      {research.narrative && (
        <section className="gf-card rounded-2xl p-5">
          <p className="mb-3 text-[10px] uppercase tracking-wider text-[var(--ink-500)]">Analysis</p>
          <div className="prose-tight">{renderMarkdownToReact(research.narrative)}</div>
        </section>
      )}
    </div>
  );
}

function DiagnosisStep({ analysis, onRepair, onBack }: DiagnosisProps) {
  const totalMax = analysis.scoreBreakdown.dimensions.reduce((s, d) => s + d.max, 0);
  const hasResearch = !!analysis.research;
  return (
    <div className="space-y-6">
      {hasResearch && analysis.research && (
        <FindingsDashboard research={analysis.research} analysis={analysis} />
      )}

      {/* Score — only in manual mode */}
      {!hasResearch && (
        <div className="gf-card rounded-2xl px-5 py-5">
          <p className="text-[10px] uppercase tracking-wider text-[var(--ink-500)]">AI visibility score</p>
          <p className="mt-2 font-mono text-7xl font-bold text-[var(--ink-900)]">
            {analysis.score}<span className="text-2xl text-[var(--ink-500)]">/{totalMax}</span>
          </p>
        </div>
      )}

      {/* Breakdown */}
      <section className="gf-card rounded-2xl p-5">
        <p className="mb-4 text-[10px] uppercase tracking-wider text-[var(--ink-500)]">Breakdown</p>
        <div className="space-y-3">
          {analysis.scoreBreakdown.dimensions.map((d) => (
            <Bar key={d.dimension} d={d} />
          ))}
        </div>
      </section>

      {/* Citations */}
      <section className="gf-card rounded-2xl p-5">
        <p className="mb-3 text-[10px] uppercase tracking-wider text-[var(--ink-500)]">
          Citations · {[...new Set(analysis.citations.map((c) => c.engine))].join(', ')}
        </p>
        <div>
          {analysis.citations.map((c, i) => (
            <CitationRow key={i} c={c} />
          ))}
        </div>
      </section>

      {/* Issues */}
      <section className="gf-card rounded-2xl p-5">
        <p className="mb-3 text-[10px] uppercase tracking-wider text-[var(--ink-500)]">Issues</p>
        <div>
          {analysis.issues.map((iss, i) => (
            <div key={i} className="flex items-start gap-3 border-b border-[#f0f0f0] py-2.5 last:border-0">
              <span className={`mt-0.5 text-[11px] font-semibold uppercase ${severity(iss.severity)}`}>
                {iss.severity}
              </span>
              <div>
                <p className="text-sm font-medium text-[var(--ink-900)]">{iss.title}</p>
                <p className="text-xs text-[var(--ink-500)]">{iss.why}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Actions */}
      <div className="flex items-center gap-4 pt-2">
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

// Descriptions of what each fix type does for the user.
const FIX_DESC: Record<Fix['type'], string> = {
  faq: 'Add an FAQ section so AI engines can cite direct answers from your site.',
  comparison_page: 'Publish a comparison page that positions you against the competitor.',
  schema: 'Embed structured data so search and AI engines parse your content correctly.',
};

function renderFixPreview(content: string, type: Fix['type']): React.ReactNode {
  if (type === 'schema') {
    // Parse JSON-LD and show it as a clean structured list
    try {
      const parsed = JSON.parse(content) as { mainEntity?: { name?: string; acceptedAnswer?: { text?: string } }[] };
      if (parsed.mainEntity && Array.isArray(parsed.mainEntity)) {
        return (
          <div className="space-y-3">
            <p className="text-[10px] uppercase tracking-wider text-[var(--ink-500)]">FAQPage schema preview</p>
            {parsed.mainEntity.map((q, i) => (
              <div key={i} className="rounded-lg bg-[#fafafa] px-4 py-3">
                <p className="text-sm font-medium text-[var(--ink-900)]">{q.name}</p>
                <p className="mt-1 text-xs leading-relaxed text-[var(--ink-700)]">{q.acceptedAnswer?.text}</p>
              </div>
            ))}
          </div>
        );
      }
    } catch { /* fall through to raw */ }
    return (
      <pre className="max-h-48 overflow-auto rounded-lg bg-[#fafafa] p-3 font-mono text-xs whitespace-pre-wrap text-[var(--ink-700)]">
        {content}
      </pre>
    );
  }

  // Markdown: render as styled HTML preview
  const lines = content.split('\n');
  const nodes: React.ReactNode[] = [];
  let bulletBuf: string[] = [];

  const flushBullets = () => {
    if (bulletBuf.length === 0) return;
    nodes.push(
      <ul key={`ul-${nodes.length}`} className="my-2 space-y-1 pl-4 text-sm text-[var(--ink-700)]">
        {bulletBuf.map((b, i) => <li key={i} className="list-disc">{b}</li>)}
      </ul>,
    );
    bulletBuf = [];
  };

  for (const line of lines) {
    if (line.startsWith('# ')) {
      flushBullets();
      nodes.push(<h2 key={`h-${nodes.length}`} className="mt-4 text-base font-semibold text-[var(--ink-900)]">{line.slice(2)}</h2>);
    } else if (line.startsWith('## ')) {
      flushBullets();
      nodes.push(<h3 key={`h-${nodes.length}`} className="mt-3 text-sm font-semibold text-[var(--ink-900)]">{line.slice(3)}</h3>);
    } else if (line.startsWith('| ')) {
      // Table row — collect into a simple table
      flushBullets();
      const cells = line.split('|').filter(Boolean).map((c) => c.trim());
      if (cells.every((c) => /^[-:]+$/.test(c))) continue; // skip separator
      nodes.push(
        <div key={`tr-${nodes.length}`} className="grid grid-cols-3 gap-2 border-b border-[#f0f0f0] py-1.5 text-xs text-[var(--ink-700)] first:font-medium first:text-[var(--ink-900)]">
          {cells.slice(0, 3).map((cell, ci) => <span key={ci}>{cell.replace(/_/g, '')}</span>)}
        </div>,
      );
    } else if (/^[-*]\s/.test(line)) {
      bulletBuf.push(line.replace(/^[-*]\s/, ''));
    } else if (line.trim()) {
      flushBullets();
      nodes.push(<p key={`p-${nodes.length}`} className="my-1.5 text-sm leading-relaxed text-[var(--ink-700)]">{line}</p>);
    } else {
      flushBullets();
    }
  }
  flushBullets();
  return <div className="rounded-lg bg-[#fafafa] px-4 py-4">{nodes}</div>;
}

function FeatureBlueprint({ type }: { type: Fix['type'] }) {
  const blueprint = FIX_BLUEPRINT[type];
  return (
    <div className="rounded-2xl border border-pink-100 bg-pink-50/60 p-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--pink-600)]">
            Recommended feature
          </p>
          <h4 className="mt-1 text-lg font-semibold text-[var(--ink-900)]">{blueprint.feature}</h4>
          <p className="mt-2 text-xs leading-relaxed text-[var(--ink-700)]">{blueprint.outcome}</p>
        </div>
        <div className="hidden h-16 w-20 shrink-0 rounded-xl border border-pink-200 bg-white p-2 sm:block">
          <div className="mb-1 h-2 w-10 rounded-full bg-pink-300" />
          <div className="mb-1 h-2 w-14 rounded-full bg-pink-100" />
          <div className="h-7 rounded-lg bg-[var(--ink-900)]" />
        </div>
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-[0.9fr_1.1fr]">
        <div className="rounded-xl bg-white/80 p-3">
          <p className="text-[10px] uppercase tracking-wider text-[var(--ink-500)]">Where it goes</p>
          <p className="mt-1 text-sm font-medium text-[var(--ink-900)]">{blueprint.placement}</p>
        </div>
        <div className="rounded-xl bg-white/80 p-3">
          <p className="text-[10px] uppercase tracking-wider text-[var(--ink-500)]">Implementation checklist</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {blueprint.checklist.map((item) => (
              <span key={item} className="rounded-full border border-pink-100 bg-white px-2.5 py-1 text-[11px] text-[var(--ink-700)]">
                {item}
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function FixCard({ fix }: { fix: Fix }) {
  const [copied, setCopied] = useState(false);
  const [showSource, setShowSource] = useState(false);

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
    <div className="gf-card gf-enter rounded-3xl p-5">
      <div className="mb-1 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-[var(--ink-900)]">{FIX_LABEL[fix.type]}</h3>
        <div className="flex gap-3 text-xs">
          <button onClick={() => setShowSource(!showSource)} className="text-[var(--ink-500)] hover:text-[var(--ink-900)]">
            {showSource ? 'Preview' : 'Source'}
          </button>
          <button onClick={copy} className="text-[var(--ink-500)] hover:text-[var(--ink-900)]">
            {copied ? 'Copied ✓' : 'Copy'}
          </button>
          <button onClick={download} className="text-[var(--ink-500)] hover:text-[var(--ink-900)]">
            Download
          </button>
        </div>
      </div>
      <p className="mb-3 text-xs text-[var(--ink-500)]">{FIX_DESC[fix.type]}</p>

      <FeatureBlueprint type={fix.type} />

      {showSource ? (
        <pre className="mt-4 max-h-56 overflow-auto rounded-2xl bg-[#fafafa] p-3 font-mono text-xs whitespace-pre-wrap text-[var(--ink-700)]">
          {fix.content}
        </pre>
      ) : (
        <div className="mt-4 max-h-80 overflow-auto rounded-2xl border border-[#eeeeee] bg-white p-2">
          {renderFixPreview(fix.content, fix.type)}
        </div>
      )}
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
  targetBranch: string;
  setTargetBranch: (v: string) => void;
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
  targetBranch,
  setTargetBranch,
  onConnect,
  onDisconnect,
  onPublish,
  onBack,
}: RepairProps) {
  const usingOauth = !!ghUser;
  const usingEnv = !usingOauth && caps.canPublishFromEnv;
  const publishReady = usingOauth ? !!selectedRepo : usingEnv;

  return (
    <div className="space-y-12">
      <div className="gf-enter">
        <p className="mb-3 inline-flex rounded-full border border-pink-200 bg-pink-50 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-[var(--pink-600)]">
          Repair plan
        </p>
        <h1 className="text-4xl font-semibold tracking-tight text-[var(--ink-900)] sm:text-5xl">
          Website features to ship next.
        </h1>
        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-[var(--ink-500)]">
          Each recommendation is shown as a product feature first, with the generated copy or schema
          underneath. Source is still available when you need it.
        </p>
      </div>

      <div className="space-y-5">
        {fixes.map((f) => (
          <FixCard key={f.id} fix={f} />
        ))}
      </div>

      {/* GitHub publish section */}
      <section className="gf-card rounded-3xl p-5 space-y-4">
        <p className="text-[10px] uppercase tracking-wider text-[var(--ink-500)]">Ship</p>

        {ghUser ? (
          <div>
            <div className="flex items-center justify-between">
              <p className="text-sm text-[var(--ink-900)]">Open PR against:</p>
              <button
                onClick={onDisconnect}
                className="text-xs text-[var(--ink-500)] hover:text-[var(--pink-600)]"
              >
                Disconnect
              </button>
            </div>
            <select
              className="gf-input mt-2 w-full px-4 py-3 text-sm"
              value={selectedRepo}
              onChange={(e) => setSelectedRepo(e.target.value)}
              disabled={loadingRepos || !repos}
            >
              <option value="">
                {loadingRepos
                  ? 'Loading repos…'
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
            <input
              className="gf-input mt-2 w-full px-4 py-3 text-sm"
              value={targetBranch}
              onChange={(e) => setTargetBranch(e.target.value)}
              placeholder="Target branch (leave empty for repo default)"
            />
          </div>
        ) : !usingEnv ? (
          <div className="flex items-center gap-4">
            <button
              onClick={onConnect}
              disabled={!caps.oauthConfigured}
              className="gf-btn-primary px-5 py-2 text-xs font-semibold"
            >
              {caps.oauthConfigured ? 'Connect GitHub' : 'OAuth not configured'}
            </button>
            <span className="text-xs text-[var(--ink-500)]">Connect to open a PR.</span>
          </div>
        ) : null}

        <div className="flex items-center gap-4 pt-2">
          <button
            onClick={onPublish}
            disabled={!publishReady}
            className="gf-btn-primary px-7 py-3 text-sm font-semibold"
          >
            {usingOauth && !selectedRepo ? 'Pick a repo' : 'Open PR'}
          </button>
          <button onClick={onBack} className="text-sm text-[var(--ink-500)] hover:text-[var(--pink-600)]">
            ← Back
          </button>
        </div>
      </section>
    </div>
  );
}

// ─── Step 4: Done ────────────────────────────────────────────────────────────

function DoneStep({ prUrl, branch, onRestart }: { prUrl: string; branch: string; onRestart: () => void }) {
  return (
    <div className="grid min-h-[65vh] items-center gap-8 lg:grid-cols-[1fr_0.8fr]">
      <section className="gf-enter">
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
      </section>
      <section className="gf-glass gf-float rounded-3xl p-6">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--pink-600)]">Review-gated PR</p>
        <div className="mt-5 space-y-3">
          {['FAQ module', 'Comparison page', 'JSON-LD schema'].map((item, i) => (
            <div key={item} className="flex items-center gap-3 rounded-2xl bg-white/80 p-3">
              <span className="grid h-7 w-7 place-items-center rounded-full bg-pink-50 font-mono text-xs text-[var(--pink-600)]">
                {i + 1}
              </span>
              <span className="text-sm font-medium text-[var(--ink-900)]">{item}</span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

// ─── Main ────────────────────────────────────────────────────────────────────

export default function HomePage() {
  const [step, setStep] = useState<Step>('connect');
  const [error, setError] = useState<string | null>(null);

  const [brandUrl, setBrandUrl] = useState(DEFAULT_BRAND);
  const [hint, setHint] = useState('');
  const [manual, setManual] = useState(false);
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
  const [targetBranch, setTargetBranch] = useState('');

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

  const analyze = async (
    mode: 'research' | 'manual' | 'demo',
    override?: { brandUrl?: string; competitorUrl?: string; prompts?: string[]; hint?: string },
  ) => {
    setError(null);
    setStep('analyzing');
    const body: Record<string, unknown> =
      mode === 'demo'
        ? {
            brandUrl: DEFAULT_BRAND,
            competitorUrl: DEFAULT_COMPETITOR,
            prompts: DEFAULT_PROMPTS.split('\n').filter(Boolean),
          }
        : mode === 'manual'
          ? {
              brandUrl: override?.brandUrl ?? brandUrl,
              competitorUrl: override?.competitorUrl ?? competitorUrl,
              prompts: override?.prompts ?? prompts,
            }
          : {
              brandUrl: override?.brandUrl ?? brandUrl,
              hint: (override?.hint ?? hint) || undefined,
            };
    try {
      const res = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const b = (await res.json().catch(() => null)) as { error?: string; detail?: string } | null;
        throw new Error(b?.detail ?? b?.error ?? `HTTP ${res.status}`);
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
      if (targetBranch.trim()) body.base = targetBranch.trim();
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
    void analyze('demo');
  };

  // Prefills the inputs with the built-in fake landing pages under
  // public/demo-sites/ so the full diagnose→repair→ship flow can be tested
  // end-to-end without depending on real third-party sites.
  const testFixture = () => {
    const origin = window.location.origin;
    const fixtureBrandUrl = `${origin}/demo-sites/weak/`;
    const fixtureCompetitorUrl = `${origin}/demo-sites/strong/`;
    const fixturePrompts = [
      'best project management for engineering teams',
      'vertex vs spectra',
      'cheapest sprint planning tool with git integration',
      'is spectra worth it for startups',
      'top alternatives to vertex',
    ];
    setManual(true);
    setBrandUrl(fixtureBrandUrl);
    setCompetitorUrl(fixtureCompetitorUrl);
    setPromptsText(fixturePrompts.join('\n'));
    setError(null);
    void analyze('manual', {
      brandUrl: fixtureBrandUrl,
      competitorUrl: fixtureCompetitorUrl,
      prompts: fixturePrompts,
    });
  };

  return (
    <main className="gf-shell mx-auto max-w-6xl px-6 py-6 sm:px-10 sm:py-10">
      <Header step={step} ghUser={ghUser} onLogout={disconnect} />

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
          hint={hint} setHint={setHint}
          competitorUrl={competitorUrl} setCompetitorUrl={setCompetitorUrl}
          promptsText={promptsText} setPromptsText={setPromptsText}
          manual={manual} setManual={setManual}
          manualCount={prompts.length}
          onResearch={() => analyze('research')}
          onManual={() => analyze('manual')}
          onDemo={demo}
          onTestFixture={testFixture}
        />
      )}

      {step === 'analyzing' && (
        <Spinner label={manual ? 'Querying AI engines…' : 'Researching your category — discovering prompts and competitors…'} />
      )}

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
          targetBranch={targetBranch}
          setTargetBranch={setTargetBranch}
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
