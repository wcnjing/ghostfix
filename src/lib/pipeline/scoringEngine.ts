// Applies the brief §7 rubric to citation + crawl signals.
// Every dimension emits a numeric subscore, at least one reason string, and a
// provenance tag. Dimensions we couldn't measure are excluded from the total
// (score is reported out of availableMax) instead of being filled with
// invented values — explainability is non-negotiable (brief §2).

import {
  DIMENSION_MAX,
  type Citation,
  type CrawlSignals,
  type DimensionScore,
  type Issue,
  type IssueSeverity,
  type Provenance,
  type ScoreBreakdown,
} from '@/lib/types';

function unavailable(dimension: DimensionScore['dimension'], reason: string): DimensionScore {
  return {
    dimension,
    score: 0,
    max: DIMENSION_MAX[dimension],
    reasons: [reason],
    provenance: 'unavailable',
  };
}

function citationProvenance(citations: Citation[]): Provenance {
  if (citations.some((c) => c.provenance === 'measured')) return 'measured';
  if (citations.some((c) => c.provenance === 'estimated')) return 'estimated';
  return 'unavailable';
}

function shareOfAnswer(citations: Citation[]): DimensionScore {
  const max = DIMENSION_MAX.share_of_answer;
  const provenance = citationProvenance(citations);
  if (provenance === 'unavailable') {
    return unavailable('share_of_answer', 'No AI answer data could be collected for these prompts.');
  }

  const scored = citations.filter((c) => c.provenance !== 'unavailable');
  const promptCount = scored.length || 1;
  const brandPresentPrompts = scored.filter((c) => c.brandFrequency > 0).length;
  const competitorPresentPrompts = scored.filter((c) => c.competitorFrequency > 0).length;
  // Frequency-weighted: being named in 3/3 runs is worth more than 1/3.
  const avgFrequency = scored.reduce((s, c) => s + c.brandFrequency, 0) / promptCount;
  const score = Math.round(avgFrequency * max);

  return {
    dimension: 'share_of_answer',
    score,
    max,
    reasons: [
      `Named or cited in ${brandPresentPrompts} of ${promptCount} prompts (avg ${Math.round(avgFrequency * 100)}% of answer runs); competitor appeared in ${competitorPresentPrompts} of ${promptCount}.`,
    ],
    provenance,
  };
}

function contentCoverage(brand: CrawlSignals, competitor: CrawlSignals): DimensionScore {
  const max = DIMENSION_MAX.content_coverage;
  if (!brand.fetched) {
    return unavailable('content_coverage', `Could not crawl ${brand.url} — site unreachable or blocking bots.`);
  }
  const pagesNote = `${brand.pagesCrawled.length} page(s) checked`;
  const reasons: string[] = [];
  let score = max;
  if (!brand.hasFaq) {
    score -= 10;
    reasons.push(
      competitor.fetched && competitor.hasFaq
        ? `No FAQ found on brand (${pagesNote}); competitor has one.`
        : `No FAQ found on brand (${pagesNote}).`,
    );
  }
  if (!brand.hasComparisonPage) {
    score -= 10;
    reasons.push(
      competitor.fetched && competitor.hasComparisonPage
        ? `No comparison page found (${pagesNote}); competitor publishes one.`
        : `No comparison page found (${pagesNote}).`,
    );
  }
  if (reasons.length === 0) reasons.push(`FAQ and comparison page both present (${pagesNote}).`);
  return {
    dimension: 'content_coverage',
    score: Math.max(0, score),
    max,
    reasons,
    provenance: 'measured',
  };
}

function structuredData(brand: CrawlSignals, competitor: CrawlSignals): DimensionScore {
  const max = DIMENSION_MAX.structured_data;
  if (!brand.fetched) {
    return unavailable('structured_data', `Could not crawl ${brand.url} — site unreachable or blocking bots.`);
  }
  const reasons: string[] = [];
  let score = max;
  if (brand.jsonLdTypes.length === 0) {
    score = 0;
    reasons.push(
      competitor.fetched && competitor.jsonLdTypes.length > 0
        ? `No JSON-LD detected on brand; competitor ships ${competitor.jsonLdTypes.join(', ')}.`
        : 'No JSON-LD detected on crawled pages.',
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
  return {
    dimension: 'structured_data',
    score: Math.max(0, score),
    max,
    reasons,
    provenance: 'measured',
  };
}

// When the competitor couldn't be crawled we still score the brand's evidence
// on an absolute baseline instead of pretending we compared.
const EVIDENCE_BASELINE = 10;

function evidenceDensity(brand: CrawlSignals, competitor: CrawlSignals): DimensionScore {
  const max = DIMENSION_MAX.evidence_density;
  if (!brand.fetched) {
    return unavailable('evidence_density', `Could not crawl ${brand.url} — site unreachable or blocking bots.`);
  }
  if (!competitor.fetched) {
    const score = Math.round(Math.min(1, brand.evidenceCount / EVIDENCE_BASELINE) * max);
    return {
      dimension: 'evidence_density',
      score,
      max,
      reasons: [
        `Brand has ${brand.evidenceCount} stat/source/benchmark mentions (competitor site couldn't be crawled, so this is scored against a baseline of ${EVIDENCE_BASELINE}).`,
      ],
      provenance: 'measured',
    };
  }
  const ratio = competitor.evidenceCount === 0 ? 1 : brand.evidenceCount / competitor.evidenceCount;
  const score = Math.round(Math.min(1, ratio) * max);
  return {
    dimension: 'evidence_density',
    score,
    max,
    reasons: [
      `Brand has ${brand.evidenceCount} stat/source/benchmark mentions; competitor has ${competitor.evidenceCount}.`,
    ],
    provenance: 'measured',
  };
}

function freshnessTrust(brand: CrawlSignals): DimensionScore {
  const max = DIMENSION_MAX.freshness_trust;
  if (!brand.fetched) {
    return unavailable('freshness_trust', `Could not crawl ${brand.url} — site unreachable or blocking bots.`);
  }
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
  return {
    dimension: 'freshness_trust',
    score: Math.max(0, score),
    max,
    reasons,
    provenance: 'measured',
  };
}

function severityForGain(gain: number, max: number): IssueSeverity {
  const lostRatio = gain / max;
  if (lostRatio > 0.66) return 'high';
  if (lostRatio > 0.33) return 'medium';
  return 'low';
}

// Turn scored dimensions into concrete, single-action issues. One issue per
// discrete gap (an FAQ gap and a comparison-page gap are separate line items),
// each carrying the action, its location, and the rubric points it recovers.
function buildIssues(
  dims: DimensionScore[],
  brand: CrawlSignals,
  competitor: CrawlSignals,
  citations: Citation[],
): Issue[] {
  const issues: Issue[] = [];
  const dim = (name: DimensionScore['dimension']) => dims.find((d) => d.dimension === name);

  const soa = dim('share_of_answer');
  if (soa && soa.provenance !== 'unavailable' && soa.score < soa.max) {
    const scored = citations.filter((c) => c.provenance !== 'unavailable');
    const absent = scored.filter((c) => c.brandFrequency === 0);
    const gain = soa.max - soa.score;
    issues.push({
      title:
        absent.length > 0
          ? `Absent from AI answers for ${absent.length} of ${scored.length} buyer prompts`
          : 'Mentioned inconsistently across AI answer runs',
      severity: severityForGain(gain, soa.max),
      dimension: 'share_of_answer',
      why: soa.reasons.join(' '),
      action:
        absent.length > 0
          ? `Publish content that directly answers: ${absent
              .slice(0, 3)
              .map((c) => `“${c.prompt}”`)
              .join(', ')}${absent.length > 3 ? ` (+${absent.length - 3} more)` : ''}.`
          : 'Strengthen the pages AI already cites so you appear in every run, not some.',
      where: 'New FAQ entries and comparison page targeting the missed prompts.',
      estPointGain: gain,
      fixType: 'faq',
    });
  }

  if (brand.fetched) {
    if (!brand.hasFaq) {
      issues.push({
        title: 'No FAQ for AI engines to quote',
        severity: 'high',
        dimension: 'content_coverage',
        why: `Checked ${brand.pagesCrawled.length} page(s) — no FAQ heading, accordion, or FAQPage schema found.${
          competitor.fetched && competitor.hasFaq ? ' Your competitor has one.' : ''
        }`,
        action: 'Add an FAQ section with one question per buyer prompt, direct answer in the first sentence.',
        where: 'Near your pricing or product page (e.g. /faq).',
        estPointGain: 10,
        fixType: 'faq',
      });
    }
    if (!brand.hasComparisonPage) {
      issues.push({
        title: 'No comparison page — rivals control the “vs” narrative',
        severity: 'high',
        dimension: 'content_coverage',
        why: `No /vs, /compare, or alternatives page found on ${brand.pagesCrawled.length} crawled page(s).${
          competitor.fetched && competitor.hasComparisonPage ? ' Your competitor publishes one.' : ''
        }`,
        action: 'Publish a fair side-by-side comparison page against your main competitor.',
        where: '/compare or /vs/[competitor].',
        estPointGain: 10,
        fixType: 'comparison_page',
      });
    }

    const sd = dim('structured_data');
    if (sd && sd.provenance !== 'unavailable' && sd.score < sd.max) {
      const gain = sd.max - sd.score;
      issues.push({
        title:
          brand.jsonLdTypes.length === 0
            ? 'No structured data for AI parsers'
            : 'Structured data incomplete',
        severity: severityForGain(gain, sd.max),
        dimension: 'structured_data',
        why: sd.reasons.join(' '),
        action:
          brand.jsonLdTypes.length === 0
            ? 'Embed JSON-LD (FAQPage + Product) so answer engines can parse your pages.'
            : `Add the missing schema types (${['FAQPage', 'Product'].filter((t) => !brand.jsonLdTypes.includes(t)).join(', ')}).`,
        where: '<script type="application/ld+json"> in the head of the matching pages.',
        estPointGain: gain,
        fixType: 'schema',
      });
    }

    const ev = dim('evidence_density');
    if (ev && ev.provenance !== 'unavailable' && ev.score < ev.max) {
      const gain = ev.max - ev.score;
      issues.push({
        title: 'Thin on stats, sources, and benchmarks',
        severity: severityForGain(gain, ev.max),
        dimension: 'evidence_density',
        why: ev.reasons.join(' '),
        action:
          'Add concrete numbers (benchmarks, customer stats, pricing figures) to your key pages — AI engines preferentially quote specific claims.',
        where: 'Homepage, pricing page, and any FAQ answers.',
        estPointGain: gain,
      });
    }

    const ft = dim('freshness_trust');
    if (ft && ft.provenance !== 'unavailable' && ft.score < ft.max) {
      const gain = ft.max - ft.score;
      issues.push({
        title: 'Weak freshness and trust signals',
        severity: severityForGain(gain, ft.max),
        dimension: 'freshness_trust',
        why: ft.reasons.join(' '),
        action:
          'Show visible last-updated dates and add trust markers (testimonials, case studies, security badges, review-site scores).',
        where: 'Page metadata and footer/social-proof sections.',
        estPointGain: gain,
      });
    }
  }

  return issues.sort((a, b) => b.estPointGain - a.estPointGain);
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
  const scorable = dimensions.filter((d) => d.provenance !== 'unavailable');
  const total = scorable.reduce((sum, d) => sum + d.score, 0);
  const availableMax = scorable.reduce((sum, d) => sum + d.max, 0);
  return {
    score: total,
    breakdown: { total, availableMax, dimensions },
    issues: buildIssues(dimensions, brand, competitor, citations),
  };
}
