// Applies the brief §7 rubric to citation + crawl signals.
// Every dimension emits a numeric subscore and at least one reason string —
// explainability is non-negotiable (brief §2).

import {
  DIMENSION_MAX,
  type Citation,
  type CrawlSignals,
  type DimensionScore,
  type Issue,
  type ScoreBreakdown,
  type ScoreDimension,
} from '@/lib/types';

function shareOfAnswer(citations: Citation[]): DimensionScore {
  const max = DIMENSION_MAX.share_of_answer;
  const promptCount = citations.length || 1;
  const brandCitedPrompts = citations.filter((c) => c.brandCitedCount > 0).length;
  const competitorCitedPrompts = citations.filter((c) => c.competitorCitedCount > 0).length;
  const score = Math.round((brandCitedPrompts / promptCount) * max);

  return {
    dimension: 'share_of_answer',
    score,
    max,
    reasons: [
      `Cited in ${brandCitedPrompts} of ${promptCount} prompts; competitor cited in ${competitorCitedPrompts} of ${promptCount}.`,
    ],
  };
}

function contentCoverage(brand: CrawlSignals, competitor: CrawlSignals): DimensionScore {
  const max = DIMENSION_MAX.content_coverage;
  const reasons: string[] = [];
  let score = max;
  if (!brand.hasFaq) {
    score -= 10;
    reasons.push(
      competitor.hasFaq
        ? 'No FAQ section found on brand; competitor has one.'
        : 'No FAQ section found on brand.',
    );
  }
  if (!brand.hasComparisonPage) {
    score -= 10;
    reasons.push(
      competitor.hasComparisonPage
        ? 'No comparison page found; competitor publishes one.'
        : 'No comparison page found.',
    );
  }
  if (reasons.length === 0) reasons.push('FAQ and comparison page both present.');
  return { dimension: 'content_coverage', score: Math.max(0, score), max, reasons };
}

function structuredData(brand: CrawlSignals, competitor: CrawlSignals): DimensionScore {
  const max = DIMENSION_MAX.structured_data;
  const reasons: string[] = [];
  let score = max;
  if (brand.jsonLdTypes.length === 0) {
    score = 0;
    reasons.push(
      competitor.jsonLdTypes.length > 0
        ? `No JSON-LD detected on brand; competitor ships ${competitor.jsonLdTypes.join(', ')}.`
        : 'No JSON-LD detected on key pages.',
    );
  } else {
    if (!brand.jsonLdTypes.includes('FAQPage')) {
      score -= 7;
      reasons.push('FAQPage schema missing.');
    }
    if (!brand.jsonLdTypes.includes('Product')) {
      score -= 4;
      reasons.push('Product schema missing.');
    }
    if (reasons.length === 0) reasons.push(`JSON-LD present: ${brand.jsonLdTypes.join(', ')}.`);
  }
  return { dimension: 'structured_data', score: Math.max(0, score), max, reasons };
}

function evidenceDensity(brand: CrawlSignals, competitor: CrawlSignals): DimensionScore {
  const max = DIMENSION_MAX.evidence_density;
  const ratio = competitor.evidenceCount === 0 ? 1 : brand.evidenceCount / competitor.evidenceCount;
  const score = Math.round(Math.min(1, ratio) * max);
  const reasons = [
    `Brand has ${brand.evidenceCount} stat/source/benchmark mentions; competitor has ${competitor.evidenceCount}.`,
  ];
  return { dimension: 'evidence_density', score, max, reasons };
}

function freshnessTrust(brand: CrawlSignals): DimensionScore {
  const max = DIMENSION_MAX.freshness_trust;
  const reasons: string[] = [];
  let score = max;
  if (!brand.lastUpdated) {
    score -= 6;
    reasons.push('No visible last-updated date.');
  }
  if (brand.trustSignals.length < 2) {
    score -= 4;
    reasons.push(`Thin trust signals (${brand.trustSignals.join(', ') || 'none'}).`);
  }
  if (reasons.length === 0) reasons.push('Fresh content and multiple trust signals present.');
  return { dimension: 'freshness_trust', score: Math.max(0, score), max, reasons };
}

function pickIssues(dims: DimensionScore[]): Issue[] {
  const severityFor = (d: DimensionScore): 'high' | 'medium' | 'low' => {
    const ratio = d.score / d.max;
    if (ratio < 0.34) return 'high';
    if (ratio < 0.67) return 'medium';
    return 'low';
  };
  const titleFor: Record<ScoreDimension, string> = {
    share_of_answer: 'Losing share of AI answers to competitor',
    content_coverage: 'Missing answer-ready content (FAQ / comparison)',
    structured_data: 'No structured data for AI parsers',
    evidence_density: 'Thin on stats, sources, and benchmarks',
    freshness_trust: 'Weak freshness and trust signals',
  };
  return dims
    .slice()
    .sort((a, b) => a.score / a.max - b.score / b.max)
    .slice(0, 5)
    .map((d) => ({
      title: titleFor[d.dimension],
      severity: severityFor(d),
      dimension: d.dimension,
      why: d.reasons.join(' '),
    }));
}

export async function scoringEngine(
  brand: CrawlSignals,
  competitor: CrawlSignals,
  citations: Citation[],
): Promise<{ score: number; breakdown: ScoreBreakdown; issues: Issue[] }> {
  const dimensions: DimensionScore[] = [
    shareOfAnswer(citations),
    contentCoverage(brand, competitor),
    structuredData(brand, competitor),
    evidenceDensity(brand, competitor),
    freshnessTrust(brand),
  ];
  const total = dimensions.reduce((sum, d) => sum + d.score, 0);
  return {
    score: total,
    breakdown: { total, dimensions },
    issues: pickIssues(dimensions),
  };
}
