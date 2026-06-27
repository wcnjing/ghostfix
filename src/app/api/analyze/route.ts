import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';

import { answerCollector } from '@/lib/pipeline/answerCollector';
import { crawler } from '@/lib/pipeline/crawler';
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

  const { brandUrl, competitorUrl, prompts } = body;
  if (!brandUrl || !competitorUrl || !Array.isArray(prompts) || prompts.length === 0) {
    return NextResponse.json(
      { error: 'missing_fields', expected: ['brandUrl', 'competitorUrl', 'prompts[]'] },
      { status: 400 },
    );
  }
  if (prompts.length > 5) {
    return NextResponse.json({ error: 'too_many_prompts', max: 5 }, { status: 400 });
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

  await persistAnalysis(result);
  return NextResponse.json(result);
}
