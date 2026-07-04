'use client';

import { useEffect, useMemo, useState } from 'react';

import type {
  AnalysisResult,
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
  evidence_stats: 'Stats & Proof',
  trust_signals: 'Trust Signals',
  freshness_update: 'Freshness',
  answer_content: 'Answer Content',
};

const FIX_EXT: Record<Fix['type'], string> = {
  faq: 'md',
  comparison_page: 'md',
  schema: 'json',
  evidence_stats: 'md',
  trust_signals: 'md',
  freshness_update: 'md',
  answer_content: 'md',
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
    feature: 'Answer-ready content module',
    placement: 'Add to product, pricing, or resource pages.',
    outcome: 'Gives AI engines short, extractable answers to cite.',
    checklist: ['One answer per target prompt', 'Direct answer first sentence', 'Evidence or metric in every answer'],
  },
  comparison_page: {
    feature: 'Competitor comparison page',
    placement: 'Publish at /compare or /vs/[competitor].',
    outcome: 'Controls the side-by-side narrative before rivals do.',
    checklist: ['Clear table', 'When to choose you', 'Fair competitor positioning'],
  },
  schema: {
    feature: 'Structured data (JSON-LD)',
    placement: 'Embed in the page head with matching visible content.',
    outcome: 'Makes your content machine-readable for AI parsers.',
    checklist: ['Valid JSON-LD', 'Matches visible page content', 'Includes Product/Organization types'],
  },
  evidence_stats: {
    feature: 'Stats & proof points page',
    placement: 'Add to product pages, case studies, or a dedicated /results page.',
    outcome: 'AI engines strongly prefer content with concrete, citable numbers.',
    checklist: ['Specific numbers (not vague claims)', 'Customer results with metrics', 'Third-party validation'],
  },
  trust_signals: {
    feature: 'Trust signals & social proof',
    placement: 'Homepage, pricing page, and key landing pages.',
    outcome: 'Multiple trust indicators boost AI confidence in citing you.',
    checklist: ['Named customer testimonials', 'Case study summaries', 'Security/compliance badges', 'Review platform scores'],
  },
  freshness_update: {
    feature: 'Content freshness improvements',
    placement: 'All major landing pages and blog posts.',
    outcome: 'AI engines deprioritize undated or stale content.',
    checklist: ['Visible last-updated dates', 'Recent timestamps', 'Current year references'],
  },
  answer_content: {
    feature: 'Answer-optimized content blocks',
    placement: 'Product pages, feature pages, or dedicated guides.',
    outcome: 'Directly targets the prompts where AI currently cites your competitor.',
    checklist: ['Direct answer in first sentence', 'Supporting evidence bullets', 'Citable customer quote per prompt'],
  },
};

// A "properly formatted" link: parses as a URL, uses http(s), and has a real
// hostname (dotted domain, or localhost for local testing).
function isValidHttpUrl(value: string): boolean {
  try {
    const url = new URL(value.trim());
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
    return url.hostname.includes('.') || url.hostname === 'localhost';
  } catch {
    return false;
  }
}

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
}

function InputStep({
  brandUrl, setBrandUrl,
  hint, setHint,
  competitorUrl, setCompetitorUrl,
  promptsText, setPromptsText,
  manual, setManual,
  manualCount,
  onResearch, onManual,
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
              {manual ? `${manualCount}/8 prompts ready` : 'Auto-discovers prompts and rivals'}
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
                placeholder="Prompts — one per line, up to 8"
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

const DIM_TOOLTIP: Record<ScoreDimension, { what: string; improve: string }> = {
  share_of_answer: {
    what: 'How often AI engines cite your brand vs competitors when users ask buyer-intent prompts.',
    improve: 'Publish answer-ready content that directly answers the prompts where you are absent. Lead with a clear, extractable sentence.',
  },
  content_coverage: {
    what: 'Whether your site has the content types AI engines need: comparison pages, clear pricing, detailed product info, and sufficient depth.',
    improve: 'Fill the specific gaps — if pricing is vague, add exact numbers. If no comparison page exists, publish one. Ensure enough text depth for AI to extract answers.',
  },
  structured_data: {
    what: 'Whether your pages include machine-readable schema (Product, Organization, HowTo, Article) that AI parsers can extract.',
    improve: 'Add JSON-LD matching your content type: Product schema for products, Organization for your brand, HowTo or Article for guides.',
  },
  evidence_density: {
    what: 'The number of concrete stats, benchmarks, customer results, and third-party citations on your pages.',
    improve: 'Add specific numbers: customer metrics, benchmark results, growth stats, analyst quotes. AI engines cite pages with hard evidence.',
  },
  freshness_trust: {
    what: 'Whether your content shows recent update dates, customer testimonials, press mentions, and compliance badges.',
    improve: 'Display last-updated timestamps, add named testimonials with titles, link to press coverage, and show security/review badges.',
  },
};

function Bar({ d }: { d: DimensionScore }) {
  const pct = (d.score / d.max) * 100;
  const tip = DIM_TOOLTIP[d.dimension];
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-xs">
        <span className="flex items-center gap-1.5 font-medium text-[var(--ink-900)]">
          {DIM_LABEL[d.dimension]}
          <span className="group relative cursor-help">
            <svg className="h-3.5 w-3.5 text-[var(--ink-500)] transition-colors group-hover:text-[var(--pink-600)]" viewBox="0 0 16 16" fill="currentColor">
              <path fillRule="evenodd" d="M8 1.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13ZM0 8a8 8 0 1 1 16 0A8 8 0 0 1 0 8Zm8-2.5a.75.75 0 0 1 .75.75v4.5a.75.75 0 0 1-1.5 0v-4.5A.75.75 0 0 1 8 5.5ZM8 3.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Z" clipRule="evenodd" />
            </svg>
            <div className="pointer-events-none absolute bottom-full left-1/2 z-30 mb-2 w-64 -translate-x-1/2 rounded-xl border border-pink-100 bg-white p-3 opacity-0 shadow-lg transition-opacity duration-200 group-hover:pointer-events-auto group-hover:opacity-100">
              <p className="text-[11px] font-semibold text-[var(--ink-900)]">What this measures</p>
              <p className="mt-1 text-[11px] leading-relaxed text-[var(--ink-700)]">{tip.what}</p>
              <p className="mt-2 text-[11px] font-semibold text-[var(--pink-600)]">How to improve</p>
              <p className="mt-1 text-[11px] leading-relaxed text-[var(--ink-700)]">{tip.improve}</p>
            </div>
          </span>
        </span>
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
            AI visibility score
          </p>
          <p className="mt-2 text-sm leading-relaxed text-[var(--ink-500)]">
            {pct >= 67
              ? 'Solid foundation — minor gaps to address.'
              : pct >= 34
                ? 'Moderate gaps — competitor is outperforming you on key signals.'
                : 'Critical gaps — AI engines strongly favor your competitor.'}
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
  // Enhanced renderer: sections get distinct backgrounds, severity keywords get colored.
  const lines = md.split('\n');
  const sections: { heading: string; content: React.ReactNode[] }[] = [];
  let currentSection: { heading: string; content: React.ReactNode[] } = { heading: '', content: [] };
  let bulletBuf: string[] = [];

  const severityColor = (text: string): string => {
    const lower = text.toLowerCase();
    if (/critical|high severity/.test(lower)) return 'text-rose-600';
    if (/important|medium severity/.test(lower)) return 'text-amber-600';
    if (/minor|low severity/.test(lower)) return 'text-lime-600';
    return 'text-[var(--ink-900)]';
  };

  const inline = (text: string): React.ReactNode => {
    // Split on bold markers, then apply severity coloring to bold text
    const parts = text.split(/(\*\*[^*]+\*\*)/g);
    return parts.map((p, i) => {
      if (p.startsWith('**') && p.endsWith('**')) {
        const inner = p.slice(2, -2);
        const color = severityColor(inner);
        return (
          <strong key={i} className={color}>
            {inner}
          </strong>
        );
      }
      return <span key={i}>{p}</span>;
    });
  };

  const flushBullets = () => {
    if (bulletBuf.length === 0) return;
    currentSection.content.push(
      <ul key={`ul-${currentSection.content.length}`} className="my-2 space-y-2 pl-5 text-[13px] leading-relaxed text-[var(--ink-700)]">
        {bulletBuf.map((b, i) => {
          // Color entire bullet based on severity keywords at the start
          const lower = b.toLowerCase();
          let dotColor = 'text-[var(--ink-500)]';
          if (/^\*\*.*critical|^\*\*.*high/i.test(b)) dotColor = 'text-rose-500';
          else if (/^\*\*.*important|^\*\*.*medium/i.test(b)) dotColor = 'text-amber-500';
          else if (/^\*\*.*minor|^\*\*.*low/i.test(b)) dotColor = 'text-lime-600';
          // Also detect severity from content like "[high]" or issue titles
          else if (/missing|no |not cited|zero|lacks|weak|thin|poor|too (long|short|much|many|few)|extremely/i.test(lower)) dotColor = 'text-rose-400';

          return (
            <li key={i} className={`list-disc ${dotColor}`}>
              <span className="text-[var(--ink-700)]">{inline(b)}</span>
            </li>
          );
        })}
      </ul>,
    );
    bulletBuf = [];
  };

  const flushSection = () => {
    flushBullets();
    if (currentSection.heading || currentSection.content.length > 0) {
      sections.push(currentSection);
    }
  };

  for (const line of lines) {
    if (line.startsWith('## ')) {
      flushSection();
      currentSection = { heading: line.slice(3), content: [] };
    } else if (line.startsWith('# ')) {
      flushSection();
      currentSection = { heading: line.slice(2), content: [] };
    } else if (/^\d+\.\s/.test(line)) {
      // Numbered list items (recommendations)
      flushBullets();
      currentSection.content.push(
        <div key={`num-${currentSection.content.length}`} className="my-2 flex gap-2 text-[13px] leading-relaxed text-[var(--ink-700)]">
          <span className="shrink-0 font-mono text-sm font-bold text-[var(--pink-600)]">{line.match(/^\d+/)?.[0]}.</span>
          <span>{inline(line.replace(/^\d+\.\s*/, ''))}</span>
        </div>,
      );
    } else if (/^[-*]\s/.test(line)) {
      bulletBuf.push(line.replace(/^[-*]\s/, ''));
    } else if (line.trim()) {
      flushBullets();
      // Detect severity label paragraphs and color them
      const lower = line.toLowerCase();
      let pClass = 'my-2 text-sm leading-relaxed text-[var(--ink-700)]';
      if (/critical.*high severity/i.test(lower)) pClass = 'my-4 text-sm font-bold uppercase tracking-wide text-rose-600';
      else if (/important.*medium severity/i.test(lower)) pClass = 'my-4 text-sm font-bold uppercase tracking-wide text-amber-600';
      else if (/minor.*low severity/i.test(lower)) pClass = 'my-4 text-sm font-bold uppercase tracking-wide text-lime-600';

      currentSection.content.push(
        <p key={`p-${currentSection.content.length}`} className={pClass}>
          {inline(line)}
        </p>,
      );
    } else {
      flushBullets();
    }
  }
  flushSection();

  // Render sections as distinct visual blocks
  const sectionStyle = (heading: string): string => {
    const lower = heading.toLowerCase();
    if (lower.includes('overview')) return 'border-l-4 border-[var(--pink-400)] bg-pink-50/50';
    if (lower.includes('critical')) return 'border-l-4 border-rose-400 bg-rose-50/40';
    if (lower.includes('recommended') || lower.includes('action')) return 'border-l-4 border-emerald-400 bg-emerald-50/40';
    return 'border-l-4 border-[var(--ink-200)] bg-[#fafafa]';
  };

  const headingColor = (heading: string): string => {
    const lower = heading.toLowerCase();
    if (lower.includes('overview')) return 'text-[var(--pink-600)]';
    if (lower.includes('critical')) return 'text-rose-600';
    if (lower.includes('recommended') || lower.includes('action')) return 'text-emerald-700';
    return 'text-[var(--ink-900)]';
  };

  return (
    <div className="space-y-4">
      {sections.map((section, i) => (
        <div key={i} className={`rounded-xl px-4 py-3 ${section.heading ? sectionStyle(section.heading) : ''}`}>
          {section.heading && (
            <h3 className={`mb-3 text-base font-bold uppercase tracking-wider ${headingColor(section.heading)}`}>
              {section.heading}
            </h3>
          )}
          {section.content}
        </div>
      ))}
    </div>
  );
}

function ExpandableSection({ title, children }: { title: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <section className="gf-card rounded-2xl p-5">
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between"
      >
        <p className="text-[10px] uppercase tracking-wider text-[var(--ink-500)]">{title}</p>
        <span className={`text-xs text-[var(--ink-500)] transition-transform duration-200 ${open ? 'rotate-180' : ''}`}>▾</span>
      </button>
      {open && <div className="mt-4">{children}</div>}
    </section>
  );
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

  // Determine the priority fix suggestion from the top issue
  const FIX_HINT: Record<ScoreDimension, string> = {
    share_of_answer: 'Write content that directly answers the exact queries where AI currently cites your competitor instead of you.',
    content_coverage: 'Fill your specific content gaps — add clear pricing, comparison pages, or detailed product info where you\'re thin.',
    structured_data: 'Add JSON-LD schema matching your content (Product, Organization, HowTo) so AI parsers can read your pages programmatically.',
    evidence_density: 'Add hard numbers: customer metrics, benchmark results, case study stats. AI engines cite pages with concrete, verifiable data.',
    freshness_trust: 'Show recency with updated timestamps, add named testimonials, press logos, and compliance badges to build AI confidence.',
  };
  const topIssue = analysis.issues[0];

  return (
    <div className="space-y-6">
      {/* Score dial — compact, no marketing copy */}
      <ScoreDial score={analysis.score} max={totalMax} />

      {/* TL;DR narrative — immediately after score */}
      {research.narrative && (
        <section className="gf-card gf-enter rounded-2xl p-5">
          <p className="mb-3 text-[10px] uppercase tracking-wider text-[var(--pink-600)]">Key findings</p>
          <div className="prose-tight">{renderMarkdownToReact(research.narrative)}</div>
        </section>
      )}

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

      {/* Issues — the star of the page */}
      <section className="gf-card rounded-2xl p-5">
        <p className="mb-3 text-[10px] uppercase tracking-wider text-[var(--ink-500)]">Issues to fix</p>
        <div>
          {analysis.issues.map((iss, i) => (
            <div key={i} className="flex items-start gap-3 border-b border-[#f0f0f0] py-3 last:border-0">
              <span className={`mt-0.5 inline-flex h-5 items-center rounded px-1.5 text-[10px] font-semibold uppercase ${
                iss.severity === 'high' ? 'bg-rose-100 text-rose-600' :
                iss.severity === 'medium' ? 'bg-amber-100 text-amber-600' :
                'bg-emerald-100 text-emerald-600'
              }`}>
                {iss.severity}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-[var(--ink-900)]">{iss.title}</p>
                <p className="mt-0.5 text-xs text-[var(--ink-500)]">{iss.why}</p>
                <p className="mt-1 text-xs font-medium text-[var(--pink-600)]">{FIX_HINT[iss.dimension]}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Unified prompts & citations table */}
      <section className="gf-card rounded-2xl p-5">
        <p className="mb-3 text-[10px] uppercase tracking-wider text-[var(--ink-500)]">Prompts & citations</p>
        <div>
          {analysis.prompts.map((prompt, i) => {
            const cit = analysis.citations[i];
            const brandIn = cit && cit.brandCitedCount > 0;
            const compIn = cit && cit.competitorCitedCount > 0;
            const bPct = cit ? Math.round(cit.brandFrequency * 100) : 0;
            const cPct = cit ? Math.round(cit.competitorFrequency * 100) : 0;
            return (
              <div key={i} className="flex items-center gap-3 border-b border-[#f0f0f0] py-2.5 last:border-0">
                <span className="font-mono text-[11px] text-[var(--ink-500)]">{String(i + 1).padStart(2, '0')}</span>
                <p className="min-w-0 flex-1 text-sm text-[var(--ink-900)]">{prompt}</p>
                <span className={`shrink-0 text-[11px] font-medium ${brandIn ? 'text-emerald-600' : 'text-rose-500'}`}>
                  {brandIn ? `you ${bPct}%` : 'absent'}
                </span>
                <span className={`shrink-0 text-[11px] ${compIn ? 'text-[var(--ink-700)]' : 'text-[var(--ink-500)]'}`}>
                  {compIn ? `rival ${cPct}%` : '—'}
                </span>
              </div>
            );
          })}
        </div>
      </section>

      {/* Breakdown — collapsible for power users */}
      <ExpandableSection title="Score breakdown">
        <div className="space-y-3">
          {analysis.scoreBreakdown.dimensions.map((d) => (
            <Bar key={d.dimension} d={d} />
          ))}
        </div>
      </ExpandableSection>

      {/* Category context — compact */}
      <ExpandableSection title="Category & competitors">
        <div className="space-y-4">
          <div>
            <p className="text-[10px] uppercase tracking-wider text-[var(--ink-500)]">Category</p>
            <p className="mt-1 text-sm font-medium text-[var(--ink-900)]">{research.category}</p>
            <p className="mt-1 text-xs text-[var(--ink-700)]">{research.brandSummary}</p>
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-wider text-[var(--ink-500)]">Competitors discovered</p>
            <div className="mt-2 divide-y divide-[#f0f0f0]">
              {research.discoveredCompetitors.map((c) => (
                <CompetitorLeaderboardRow key={c.domain} c={c} selected={c.domain === research.selectedCompetitorDomain} />
              ))}
            </div>
          </div>
        </div>
      </ExpandableSection>
    </div>
  );
}

function DiagnosisStep({ analysis, onRepair, onBack }: DiagnosisProps) {
  const totalMax = analysis.scoreBreakdown.dimensions.reduce((s, d) => s + d.max, 0);
  const hasResearch = !!analysis.research;

  // Determine priority fix hint
  const FIX_HINT_MANUAL: Record<ScoreDimension, string> = {
    share_of_answer: 'Write content that directly answers the exact queries where AI currently cites your competitor instead of you.',
    content_coverage: 'Fill your specific content gaps — add clear pricing, comparison pages, or detailed product info where you\'re thin.',
    structured_data: 'Add JSON-LD schema matching your content (Product, Organization, HowTo) so AI parsers can read your pages programmatically.',
    evidence_density: 'Add hard numbers: customer metrics, benchmark results, case study stats. AI engines cite pages with concrete, verifiable data.',
    freshness_trust: 'Show recency with updated timestamps, add named testimonials, press logos, and compliance badges to build AI confidence.',
  };
  const topIssue = analysis.issues[0];

  return (
    <div className="space-y-6">
      {hasResearch && analysis.research && (
        <FindingsDashboard research={analysis.research} analysis={analysis} />
      )}

      {/* Manual mode layout */}
      {!hasResearch && (
        <>
          {/* Score dial */}
          <ScoreDial score={analysis.score} max={totalMax} />

          {/* Issues */}
          <section className="gf-card rounded-2xl p-5">
            <p className="mb-3 text-[10px] uppercase tracking-wider text-[var(--ink-500)]">Issues to fix</p>
            <div>
              {analysis.issues.map((iss, i) => (
                <div key={i} className="flex items-start gap-3 border-b border-[#f0f0f0] py-3 last:border-0">
                  <span className={`mt-0.5 inline-flex h-5 items-center rounded px-1.5 text-[10px] font-semibold uppercase ${
                    iss.severity === 'high' ? 'bg-rose-100 text-rose-600' :
                    iss.severity === 'medium' ? 'bg-amber-100 text-amber-600' :
                    'bg-emerald-100 text-emerald-600'
                  }`}>
                    {iss.severity}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-[var(--ink-900)]">{iss.title}</p>
                    <p className="mt-0.5 text-xs text-[var(--ink-500)]">{iss.why}</p>
                    <p className="mt-1 text-xs font-medium text-[var(--pink-600)]">{FIX_HINT_MANUAL[iss.dimension]}</p>
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* Unified prompts & citations */}
          <section className="gf-card rounded-2xl p-5">
            <p className="mb-3 text-[10px] uppercase tracking-wider text-[var(--ink-500)]">Prompts & citations</p>
            <div>
              {analysis.prompts.map((prompt, i) => {
                const cit = analysis.citations[i];
                const brandIn = cit && cit.brandCitedCount > 0;
                const compIn = cit && cit.competitorCitedCount > 0;
                const bPct = cit ? Math.round(cit.brandFrequency * 100) : 0;
                const cPct = cit ? Math.round(cit.competitorFrequency * 100) : 0;
                return (
                  <div key={i} className="flex items-center gap-3 border-b border-[#f0f0f0] py-2.5 last:border-0">
                    <span className="font-mono text-[11px] text-[var(--ink-500)]">{String(i + 1).padStart(2, '0')}</span>
                    <p className="min-w-0 flex-1 text-sm text-[var(--ink-900)]">{prompt}</p>
                    <span className={`shrink-0 text-[11px] font-medium ${brandIn ? 'text-emerald-600' : 'text-rose-500'}`}>
                      {brandIn ? `you ${bPct}%` : 'absent'}
                    </span>
                    <span className={`shrink-0 text-[11px] ${compIn ? 'text-[var(--ink-700)]' : 'text-[var(--ink-500)]'}`}>
                      {compIn ? `rival ${cPct}%` : '—'}
                    </span>
                  </div>
                );
              })}
            </div>
          </section>

          {/* Breakdown — collapsible */}
          <ExpandableSection title="Score breakdown">
            <div className="space-y-3">
              {analysis.scoreBreakdown.dimensions.map((d) => (
                <Bar key={d.dimension} d={d} />
              ))}
            </div>
          </ExpandableSection>
        </>
      )}

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
  faq: 'Answer-ready content so AI engines can cite direct responses from your site.',
  comparison_page: 'Publish a comparison page that positions you against the competitor.',
  schema: 'Embed structured data so search and AI engines parse your content correctly.',
  evidence_stats: 'Add concrete stats and proof points that AI engines prefer to cite.',
  trust_signals: 'Build credibility with testimonials, case studies, and badges.',
  freshness_update: 'Show AI engines your content is current and actively maintained.',
  answer_content: 'Target-specific content blocks optimized for the prompts where you\'re absent.',
};

function renderFixPreview(content: string, type: Fix['type']): React.ReactNode {
  if (type === 'schema') {
    // Parse JSON-LD and show it as a clean structured preview
    try {
      const parsed = JSON.parse(content) as Record<string, unknown>;
      const schemaType = parsed['@type'] as string | undefined;
      if (parsed.mainEntity && Array.isArray(parsed.mainEntity)) {
        return (
          <div className="space-y-3">
            <p className="text-[10px] uppercase tracking-wider text-[var(--ink-500)]">{schemaType ?? 'Schema'} preview</p>
            {(parsed.mainEntity as { name?: string; acceptedAnswer?: { text?: string } }[]).map((q, i) => (
              <div key={i} className="rounded-lg bg-[#fafafa] px-4 py-3">
                <p className="text-sm font-medium text-[var(--ink-900)]">{q.name}</p>
                <p className="mt-1 text-xs leading-relaxed text-[var(--ink-700)]">{q.acceptedAnswer?.text}</p>
              </div>
            ))}
          </div>
        );
      }
      // Generic JSON-LD preview
      return (
        <div className="space-y-2">
          <p className="text-[10px] uppercase tracking-wider text-[var(--ink-500)]">{schemaType ?? 'JSON-LD'} schema</p>
          <pre className="max-h-48 overflow-auto rounded-lg bg-[#fafafa] p-3 font-mono text-xs whitespace-pre-wrap text-[var(--ink-700)]">
            {JSON.stringify(parsed, null, 2)}
          </pre>
        </div>
      );
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

function buildVisualPreviewHtml(content: string, type: Fix['type']): string {
  // Build a complete HTML page that renders the fix content as it would look on a real website.
  const baseStyles = `
    <style>
      * { margin: 0; padding: 0; box-sizing: border-box; }
      body {
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        line-height: 1.6;
        color: #1a1a2e;
        background: #ffffff;
        padding: 32px 40px;
        font-size: 15px;
      }
      h1 { font-size: 28px; font-weight: 700; margin-bottom: 16px; color: #0f0f1a; }
      h2 { font-size: 20px; font-weight: 600; margin-top: 28px; margin-bottom: 12px; color: #1a1a2e; }
      h3 { font-size: 16px; font-weight: 600; margin-top: 20px; margin-bottom: 8px; color: #2d2d44; }
      p { margin-bottom: 12px; color: #4a4a6a; }
      ul, ol { margin: 12px 0; padding-left: 24px; }
      li { margin-bottom: 6px; color: #4a4a6a; }
      strong { color: #1a1a2e; font-weight: 600; }
      blockquote {
        border-left: 3px solid #e91e63;
        margin: 16px 0;
        padding: 12px 20px;
        background: #fef4f7;
        border-radius: 0 8px 8px 0;
        font-style: italic;
        color: #555;
      }
      table { width: 100%; border-collapse: collapse; margin: 16px 0; border-radius: 8px; overflow: hidden; }
      th { background: #f8f9fa; text-align: left; padding: 12px 16px; font-weight: 600; font-size: 13px; text-transform: uppercase; letter-spacing: 0.5px; color: #666; border-bottom: 2px solid #e0e0e0; }
      td { padding: 12px 16px; border-bottom: 1px solid #f0f0f0; font-size: 14px; }
      tr:hover td { background: #fafafa; }
      code { background: #f5f5f5; padding: 2px 6px; border-radius: 4px; font-size: 13px; }
      pre { background: #f8f9fa; padding: 16px; border-radius: 8px; overflow-x: auto; margin: 16px 0; font-size: 13px; }
      .badge { display: inline-block; background: #e8f5e9; color: #2e7d32; padding: 4px 10px; border-radius: 12px; font-size: 12px; font-weight: 500; margin: 4px 4px 4px 0; }
      .section { margin-bottom: 32px; padding-bottom: 24px; border-bottom: 1px solid #f0f0f0; }
      .section:last-child { border-bottom: none; }
      .hero { background: linear-gradient(135deg, #fef4f7 0%, #fff 100%); padding: 24px; border-radius: 12px; margin-bottom: 24px; }
      .hero h1 { margin-bottom: 8px; }
      .metric { display: inline-flex; align-items: baseline; gap: 4px; background: #f8f9fa; padding: 6px 12px; border-radius: 8px; margin: 4px; font-size: 14px; }
      .metric strong { color: #e91e63; }
      .cta { display: inline-block; background: #1a1a2e; color: white; padding: 10px 20px; border-radius: 8px; font-size: 14px; font-weight: 500; text-decoration: none; margin-top: 12px; }
      .card { border: 1px solid #eee; border-radius: 12px; padding: 20px; margin: 12px 0; }
      .testimonial { background: #fafafa; border-radius: 12px; padding: 20px; margin: 12px 0; }
      .testimonial .name { font-weight: 600; font-size: 13px; color: #1a1a2e; margin-top: 8px; }
    </style>
  `;

  if (type === 'schema') {
    // Render JSON-LD as a structured preview showing how it appears to AI parsers
    let schemaHtml = '';
    try {
      const parsed = JSON.parse(content);
      const schemaType = parsed['@type'] || 'Schema';
      schemaHtml = `<div class="hero"><h1>📋 ${schemaType}</h1><p style="color:#666">How AI parsers see your structured data</p></div>`;
      if (parsed.mainEntity && Array.isArray(parsed.mainEntity)) {
        schemaHtml += '<div class="section">';
        for (const item of parsed.mainEntity) {
          schemaHtml += `<div class="card"><h3>${item.name || 'Question'}</h3><p>${item.acceptedAnswer?.text || ''}</p></div>`;
        }
        schemaHtml += '</div>';
      } else {
        schemaHtml += `<pre>${JSON.stringify(parsed, null, 2)}</pre>`;
      }
    } catch {
      schemaHtml = `<pre>${content}</pre>`;
    }
    return `<!DOCTYPE html><html><head><meta charset="utf-8">${baseStyles}</head><body>${schemaHtml}</body></html>`;
  }

  // Convert markdown to HTML for all other types
  let html = '';
  const lines = content.split('\n');
  let inList = false;
  let inTable = false;
  let tableHeaders: string[] = [];

  for (const line of lines) {
    // Close open list if needed
    if (inList && !/^[-*]\s/.test(line) && !/^\d+\.\s/.test(line)) {
      html += '</ul>';
      inList = false;
    }
    if (inTable && !line.startsWith('|')) {
      html += '</tbody></table>';
      inTable = false;
    }

    if (line.startsWith('# ')) {
      html += `<div class="hero"><h1>${escapeHtml(line.slice(2))}</h1></div>`;
    } else if (line.startsWith('## ')) {
      html += `<h2>${escapeHtml(line.slice(3))}</h2>`;
    } else if (line.startsWith('### ')) {
      html += `<h3>${escapeHtml(line.slice(4))}</h3>`;
    } else if (line.startsWith('> ')) {
      html += `<blockquote>${inlineMarkdown(line.slice(2))}</blockquote>`;
    } else if (line.startsWith('| ')) {
      const cells = line.split('|').filter(Boolean).map(c => c.trim());
      if (cells.every(c => /^[-:]+$/.test(c))) continue; // separator row
      if (!inTable) {
        inTable = true;
        tableHeaders = cells;
        html += '<table><thead><tr>';
        for (const cell of cells) html += `<th>${escapeHtml(cell)}</th>`;
        html += '</tr></thead><tbody>';
      } else {
        html += '<tr>';
        for (const cell of cells) html += `<td>${inlineMarkdown(cell)}</td>`;
        html += '</tr>';
      }
    } else if (/^[-*]\s/.test(line)) {
      if (!inList) { html += '<ul>'; inList = true; }
      html += `<li>${inlineMarkdown(line.replace(/^[-*]\s/, ''))}</li>`;
    } else if (/^\d+\.\s/.test(line)) {
      if (!inList) { html += '<ul>'; inList = true; }
      html += `<li>${inlineMarkdown(line.replace(/^\d+\.\s/, ''))}</li>`;
    } else if (line.trim() === '') {
      // skip blank lines
    } else {
      html += `<p>${inlineMarkdown(line)}</p>`;
    }
  }
  if (inList) html += '</ul>';
  if (inTable) html += '</tbody></table>';

  return `<!DOCTYPE html><html><head><meta charset="utf-8">${baseStyles}</head><body>${html}</body></html>`;
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function inlineMarkdown(text: string): string {
  let result = escapeHtml(text);
  // Bold
  result = result.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  // Italic
  result = result.replace(/\*([^*]+)\*/g, '<em>$1</em>');
  // Inline code
  result = result.replace(/`([^`]+)`/g, '<code>$1</code>');
  // Placeholders like [X%] get highlighted
  result = result.replace(/\[([^\]]+)\]/g, '<span class="badge">$1</span>');
  return result;
}

function FixCard({ fix }: { fix: Fix }) {
  const [copied, setCopied] = useState(false);
  const [showSource, setShowSource] = useState(false);
  const [showVisualPreview, setShowVisualPreview] = useState(false);

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

  const previewHtml = useMemo(() => buildVisualPreviewHtml(fix.content, fix.type), [fix.content, fix.type]);

  return (
    <div className="gf-card gf-enter rounded-3xl p-5">
      <div className="mb-1 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-[var(--ink-900)]">{FIX_LABEL[fix.type]}</h3>
        <div className="flex gap-3 text-xs">
          <button
            onClick={() => { setShowVisualPreview(!showVisualPreview); if (!showVisualPreview) setShowSource(false); }}
            className={`rounded-full px-2.5 py-1 transition-colors ${showVisualPreview ? 'bg-pink-50 text-[var(--pink-600)] font-medium' : 'text-[var(--ink-500)] hover:text-[var(--ink-900)]'}`}
          >
            {showVisualPreview ? 'Hide Preview' : 'Show Preview'}
          </button>
          <button onClick={() => { setShowSource(!showSource); if (!showSource) setShowVisualPreview(false); }} className="text-[var(--ink-500)] hover:text-[var(--ink-900)]">
            {showSource ? 'Content' : 'Source'}
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

      {showVisualPreview ? (
        <div className="mt-4 overflow-hidden rounded-2xl border border-pink-200 shadow-sm">
          <div className="flex items-center gap-2 border-b border-pink-100 bg-pink-50/60 px-4 py-2">
            <span className="h-2.5 w-2.5 rounded-full bg-rose-300" />
            <span className="h-2.5 w-2.5 rounded-full bg-amber-300" />
            <span className="h-2.5 w-2.5 rounded-full bg-emerald-300" />
            <span className="ml-2 text-[11px] text-[var(--ink-500)]">Visual preview — how this looks on your site</span>
          </div>
          <iframe
            srcDoc={previewHtml}
            title={`Visual preview of ${FIX_LABEL[fix.type]}`}
            className="w-full border-0"
            style={{ height: '420px' }}
            sandbox="allow-same-origin"
          />
        </div>
      ) : showSource ? (
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
  analysis: AnalysisResult;
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

/** Map an issue's dimension to the fix types it corresponds to. */
function issueToFixTypes(dimension: ScoreDimension): Fix['type'][] {
  switch (dimension) {
    case 'share_of_answer': return ['answer_content'];
    case 'content_coverage': return ['comparison_page', 'answer_content'];
    case 'structured_data': return ['schema'];
    case 'evidence_density': return ['evidence_stats'];
    case 'freshness_trust': return ['trust_signals', 'freshness_update'];
    default: return [];
  }
}

function IssueFixCard({ issue, fix, index }: { issue: Issue; fix: Fix | null; index: number }) {
  const [showPreview, setShowPreview] = useState(false);
  const previewHtml = useMemo(
    () => (fix ? buildVisualPreviewHtml(fix.content, fix.type) : ''),
    [fix],
  );

  return (
    <div className="gf-card gf-enter rounded-3xl p-5">
      {/* Issue header */}
      <div className="flex items-start gap-3">
        <span className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full bg-[var(--ink-900)] font-mono text-[11px] font-bold text-white">
          {index}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className={`inline-flex h-5 items-center rounded px-1.5 text-[10px] font-semibold uppercase ${
              issue.severity === 'high' ? 'bg-rose-100 text-rose-600' :
              issue.severity === 'medium' ? 'bg-amber-100 text-amber-600' :
              'bg-emerald-100 text-emerald-600'
            }`}>
              {issue.severity}
            </span>
            <p className="text-[10px] uppercase tracking-wider text-[var(--ink-500)]">Issue</p>
          </div>
          <h3 className="mt-1.5 text-base font-semibold text-[var(--ink-900)]">{issue.title}</h3>
          <p className="mt-1 text-sm leading-relaxed text-[var(--ink-500)]">{issue.why}</p>
        </div>
      </div>

      {/* Suggestion */}
      {fix && (
        <div className="mt-5 rounded-2xl border border-pink-100 bg-pink-50/60 p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--pink-600)]">
                Suggestion
              </p>
              <p className="mt-1 text-sm font-medium text-[var(--ink-900)]">
                {FIX_LABEL[fix.type]}: {FIX_DESC[fix.type]}
              </p>
            </div>
            <button
              onClick={() => setShowPreview(!showPreview)}
              className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
                showPreview
                  ? 'bg-[var(--ink-900)] text-white'
                  : 'border border-pink-200 bg-white text-[var(--pink-600)] hover:bg-pink-50'
              }`}
            >
              {showPreview ? 'Hide Preview' : 'Show Preview'}
            </button>
          </div>
        </div>
      )}

      {/* Visual preview */}
      {showPreview && fix && (
        <div className="mt-4 overflow-hidden rounded-2xl border border-pink-200 shadow-sm">
          <div className="flex items-center gap-2 border-b border-pink-100 bg-pink-50/60 px-4 py-2">
            <span className="h-2.5 w-2.5 rounded-full bg-rose-300" />
            <span className="h-2.5 w-2.5 rounded-full bg-amber-300" />
            <span className="h-2.5 w-2.5 rounded-full bg-emerald-300" />
            <span className="ml-2 text-[11px] text-[var(--ink-500)]">Preview — how this fix looks on your site</span>
          </div>
          <iframe
            srcDoc={previewHtml}
            title={`Preview of fix for: ${issue.title}`}
            className="w-full border-0"
            style={{ height: '420px' }}
            sandbox="allow-same-origin"
          />
        </div>
      )}
    </div>
  );
}

function RepairStep({
  fixes,
  analysis,
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

  // Pair each issue with its most relevant fix
  const issueFixes = useMemo(() => {
    return analysis.issues.map((issue) => {
      const relevantTypes = issueToFixTypes(issue.dimension);
      const matchingFix = fixes.find((f) => relevantTypes.includes(f.type)) ?? null;
      return { issue, fix: matchingFix };
    });
  }, [analysis.issues, fixes]);

  // Collect any fixes not mapped to an issue (extra suggestions)
  const mappedFixIds = new Set(issueFixes.map((pair) => pair.fix?.id).filter(Boolean));
  const unmappedFixes = fixes.filter((f) => !mappedFixIds.has(f.id));

  return (
    <div className="space-y-12">
      <div className="gf-enter">
        <p className="mb-3 inline-flex rounded-full border border-pink-200 bg-pink-50 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-[var(--pink-600)]">
          Repair plan
        </p>
        <h1 className="text-4xl font-semibold tracking-tight text-[var(--ink-900)] sm:text-5xl">
          Issues & suggested fixes.
        </h1>
        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-[var(--ink-500)]">
          Each issue from your diagnosis is paired with a suggested code change. Click &ldquo;Show Preview&rdquo; to see how the fix renders on a real page.
        </p>
      </div>

      {/* Issue → Suggestion → Preview cards */}
      <div className="space-y-5">
        {issueFixes.map(({ issue, fix }, i) => (
          <IssueFixCard key={i} issue={issue} fix={fix} index={i + 1} />
        ))}
      </div>

      {/* Any extra fix suggestions not tied to a specific issue */}
      {unmappedFixes.length > 0 && (
        <div className="space-y-5">
          <p className="text-[10px] uppercase tracking-wider text-[var(--ink-500)]">Additional suggestions</p>
          {unmappedFixes.map((f) => (
            <FixCard key={f.id} fix={f} />
          ))}
        </div>
      )}

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
          {['Answer content', 'Comparison page', 'Evidence & stats', 'Trust signals', 'JSON-LD schema'].map((item, i) => (
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

  const [brandUrl, setBrandUrl] = useState('');
  const [hint, setHint] = useState('');
  const [manual, setManual] = useState(false);
  const [competitorUrl, setCompetitorUrl] = useState('');
  const [promptsText, setPromptsText] = useState('');

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
        // If they're already connected, skip the Connect screen.
        // Otherwise always show it so users link GitHub first.
        if (connected) {
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
    () => promptsText.split('\n').map((p) => p.trim()).filter(Boolean).slice(0, 8),
    [promptsText],
  );

  const analyze = async (
    mode: 'research' | 'manual',
    override?: { brandUrl?: string; competitorUrl?: string; prompts?: string[]; hint?: string },
  ) => {
    setError(null);

    // Reject malformed links before hitting the API, with an example of what
    // a valid one looks like.
    const targetBrandUrl = override?.brandUrl ?? brandUrl;
    if (!isValidHttpUrl(targetBrandUrl)) {
      setError('That doesn’t look like a valid website URL. Use a full link like https://yourbrand.com');
      setStep('input');
      return;
    }
    const targetCompetitorUrl = override?.competitorUrl ?? competitorUrl;
    if (mode === 'manual' && !isValidHttpUrl(targetCompetitorUrl)) {
      setError('The competitor URL isn’t a valid link. Use a full link like https://competitor.com');
      setStep('input');
      return;
    }

    setStep('analyzing');
    const body: Record<string, unknown> =
      mode === 'manual'
        ? {
            brandUrl: targetBrandUrl,
            competitorUrl: targetCompetitorUrl,
            prompts: override?.prompts ?? prompts,
          }
        : {
            brandUrl: targetBrandUrl,
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
          analysis={analysis!}
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
