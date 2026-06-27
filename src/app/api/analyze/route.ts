import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';

import { answerCollector } from '@/lib/pipeline/answerCollector';
import { crawler } from '@/lib/pipeline/crawler';
import { discover, synthesizeFindings } from '@/lib/pipeline/research';
import { scoringEngine } from '@/lib/pipeline/scoringEngine';
import { persistAnalysis } from '@/lib/supabase';
import type { AnalysisResult, AnalyzeRequest } from '@/lib/types';

export async function POST(req: Request) {
  let body: AnalyzeRequest;
  try {
    body = (await req.json()) as AnalyzeRequest;
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }

  const { brandUrl, hint } = body;
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
    if (body.prompts!.length > 5) {
      return NextResponse.json({ error: 'too_many_prompts', max: 5 }, { status: 400 });
    }
    prompts = body.prompts!;
    competitorUrl = body.competitorUrl!;
  }

  const [brand, competitor, citations] = await Promise.all([
    crawler(brandUrl, 'brand'),
    crawler(competitorUrl, 'competitor'),
    answerCollector(prompts, brandUrl, competitorUrl),
  ]);

  const { score, breakdown, issues } = await scoringEngine(brand, competitor, citations);

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
  };

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
