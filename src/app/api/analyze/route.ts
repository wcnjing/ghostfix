import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';

import { answerCollector } from '@/lib/pipeline/answerCollector';
import { crawler } from '@/lib/pipeline/crawler';
import { discover, synthesizeFindings } from '@/lib/pipeline/research';
import { scoringEngine } from '@/lib/pipeline/scoringEngine';
import { persistAnalysis } from '@/lib/supabase';
import type { AnalysisResult, AnalyzeRequest, CrawlSignals, Issue, Verbosity } from '@/lib/types';
import { DIMENSION_MAX, type ScoreDimension } from '@/lib/types';
import { normalizeHttpUrl, normalizePrompts } from '@/lib/validation';

// ─── Requirement 2: Executive Summary Generation ─────────────────────────────

const DIMENSION_ORDER: ScoreDimension[] = [
  'share_of_answer',
  'content_coverage',
  'structured_data',
  'evidence_density',
  'freshness_trust',
];

function generateSummary(
  score: number,
  issues: Issue[],
  competitorDomain: string,
): string {
  const totalMax = Object.values(DIMENSION_MAX).reduce((s, v) => s + v, 0);

  if (issues.length === 0) {
    const text = `Score: ${score}/${totalMax}. Compared against ${competitorDomain} — no critical issues found.`;
    return text.slice(0, 280);
  }

  // Pick highest-severity issue; if tied, use dimension order
  const severityRank: Record<string, number> = { high: 0, medium: 1, low: 2 };
  const sorted = [...issues].sort((a, b) => {
    const sevDiff = severityRank[a.severity] - severityRank[b.severity];
    if (sevDiff !== 0) return sevDiff;
    return DIMENSION_ORDER.indexOf(a.dimension) - DIMENSION_ORDER.indexOf(b.dimension);
  });
  const topIssue = sorted[0];

  const text = `Score: ${score}/${totalMax} against ${competitorDomain}. Top issue: ${topIssue.title}.`;
  return text.slice(0, 280);
}

// ─── Requirement 5: Remove Low-Signal Crawl Fields ───────────────────────────

function stripCrawlSignals(signals: CrawlSignals): Partial<CrawlSignals> {
  // Exclude pricingClarity always; exclude lastUpdated only when null
  const { pricingClarity, lastUpdated, ...rest } = signals;
  if (lastUpdated !== null) {
    return { ...rest, lastUpdated };
  }
  return rest;
}

// ─── Route Handler ───────────────────────────────────────────────────────────

export async function POST(req: Request) {
  let body: AnalyzeRequest;
  try {
    body = (await req.json()) as AnalyzeRequest;
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }

  // Requirement 6: validate verbosity parameter
  const rawVerbosity = body.verbosity ?? 'concise';
  if (rawVerbosity !== 'concise' && rawVerbosity !== 'detailed') {
    return NextResponse.json(
      { error: 'invalid_verbosity', detail: `Invalid verbosity value "${body.verbosity}". Accepted values: "concise", "detailed".` },
      { status: 400 },
    );
  }
  const verbosity: Verbosity = rawVerbosity;

  const brandUrl = normalizeHttpUrl(body.brandUrl);
  const { hint } = body;
  if (!brandUrl) {
    return NextResponse.json(
      { error: 'missing_fields', expected: ['brandUrl'] },
      { status: 400 },
    );
  }

  // Two modes:
  //   - Manual: caller supplies competitorUrl + prompts. We use them verbatim.
  //   - Research: caller supplies brandUrl only. We discover prompts + the top
  //     competitor automatically and attach a findings report.
  const isResearchMode =
    !body.competitorUrl || !Array.isArray(body.prompts) || body.prompts.length === 0;

  let prompts: string[];
  let competitorUrl: string;
  let research: Awaited<ReturnType<typeof discover>> | null = null;

  if (isResearchMode) {
    research = await discover(brandUrl, hint);
    if (research.prompts.length === 0) {
      return NextResponse.json(
        { error: 'research_failed', detail: 'Could not derive prompts from brand URL.' },
        { status: 422 },
      );
    }
    if (research.competitors.length === 0) {
      return NextResponse.json(
        { error: 'no_competitors_found', detail: 'No competitors surfaced for this category.' },
        { status: 422 },
      );
    }
    prompts = research.prompts;
    // Pick the top-cited competitor as the deep-dive target.
    const top = research.competitors[0];
    competitorUrl = top.url.startsWith('http') ? top.url : `https://${top.domain}`;
  } else {
    const manualPrompts = normalizePrompts(body.prompts, 8);
    const manualCompetitorUrl = normalizeHttpUrl(body.competitorUrl);
    if (!manualCompetitorUrl) {
      return NextResponse.json(
        { error: 'invalid_url', expected: ['competitorUrl'] },
        { status: 400 },
      );
    }
    if (!manualPrompts) {
      return NextResponse.json({ error: 'invalid_prompts', max: 8 }, { status: 400 });
    }
    prompts = manualPrompts;
    competitorUrl = manualCompetitorUrl;
  }

  const [brand, competitor, citations] = await Promise.all([
    crawler(brandUrl, 'brand'),
    crawler(competitorUrl, 'competitor'),
    answerCollector(prompts, brandUrl, competitorUrl),
  ]);

  // Requirement 5, AC4: pass complete unfiltered CrawlSignals to scoring engine
  const { score, breakdown, issues } = await scoringEngine(brand, competitor, citations, verbosity);

  // Requirement 2: generate executive summary
  const competitorDomain = (() => {
    try { return new URL(competitorUrl).hostname.replace(/^www\./, ''); }
    catch { return competitorUrl; }
  })();
  const summary = generateSummary(score, issues, competitorDomain);

  const result: AnalysisResult = {
    id: randomUUID(),
    brandUrl,
    competitorUrl,
    prompts,
    score,
    scoreBreakdown: breakdown,
    citations,
    issues,
    createdAt: new Date().toISOString(),
    signals: { brand, competitor },
  };

  // Requirement 2: add summary in concise mode
  if (verbosity === 'concise') {
    result.summary = summary;
  }

  // Requirement 5: include crawl signals in the response payload.
  // In concise mode, strip pricingClarity and null lastUpdated (AC1, AC2, AC3).
  // In detailed mode, include full unfiltered crawl signals.
  if (verbosity === 'concise') {
    result.crawlSignals = {
      brand: stripCrawlSignals(brand),
      competitor: stripCrawlSignals(competitor),
    };
  } else {
    result.crawlSignals = { brand, competitor };
  }

  if (research) {
    result.research = await synthesizeFindings(
      research,
      research.competitors[0].domain,
      { brand, competitor },
      { score, scoreBreakdown: breakdown, issues, citations },
    );
  }

  await persistAnalysis(result);
  return NextResponse.json(result);
}
