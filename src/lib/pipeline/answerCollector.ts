// answerCollector: query Perplexity Sonar N=3 times per prompt when available,
// parse citations, and mark brand/competitor presence by domain match. Without
// Perplexity, uses the shared Groq-first LLM chain to estimate answer-engine
// mentions before falling back to deterministic demo data.

import type { Citation, CitationSource } from '@/lib/types';
import { config } from '@/lib/config';
import { generateJson } from '@/lib/llm';

const PPLX_URL = 'https://api.perplexity.ai/chat/completions';

interface PerplexityChoice {
  message?: { content?: string };
}

interface PerplexityResponse {
  choices?: PerplexityChoice[];
  citations?: (string | { url?: string; title?: string })[];
  search_results?: { url?: string; title?: string }[];
}

interface RunCitation {
  url: string;
  domain: string;
  title?: string;
}

interface LlmCitationOutput {
  brandCitedCount: number;
  competitorCitedCount: number;
  sources: { domain: string; url: string; title?: string }[];
}

function domainOf(input: string): string {
  try {
    return new URL(input).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return input.replace(/^www\./, '').toLowerCase();
  }
}

// Module-scoped cache so re-runs in the same dev process are cheap (brief §8).
const cache = new Map<string, RunCitation[][]>();

async function callPerplexity(apiKey: string, prompt: string): Promise<RunCitation[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.answerTimeoutMs);
  try {
    const res = await fetch(PPLX_URL, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: config.perplexityModel,
        messages: [{ role: 'user', content: prompt }],
        return_citations: true,
      }),
      signal: controller.signal,
    });
    if (!res.ok) return [];
    const data = (await res.json()) as PerplexityResponse;

    // Newer responses populate `search_results`, older ones `citations`.
    const out: RunCitation[] = [];
    if (Array.isArray(data.search_results)) {
      for (const r of data.search_results) {
        if (r?.url) out.push({ url: r.url, domain: domainOf(r.url), title: r.title });
      }
    }
    if (out.length === 0 && Array.isArray(data.citations)) {
      for (const c of data.citations) {
        if (typeof c === 'string') {
          out.push({ url: c, domain: domainOf(c) });
        } else if (c?.url) {
          out.push({ url: c.url, domain: domainOf(c.url), title: c.title });
        }
      }
    }
    return out;
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

function mockRuns(
  prompt: string,
  promptIndex: number,
  brandDomain: string,
  competitorDomain: string,
  brandUrl: string,
  competitorUrl: string,
  runCount: number,
): RunCitation[][] {
  // Pattern: competitor wins most of the time; brand barely shows up. This is
  // the gap the demo is designed to surface, and it stays deterministic.
  const competitorWin: RunCitation = {
    url: `${competitorUrl.replace(/\/$/, '')}/why-${competitorDomain.split('.')[0]}`,
    domain: competitorDomain,
    title: `Why ${competitorDomain} — feature breakdown`,
  };
  const g2: RunCitation = {
    url: `https://www.g2.com/compare/${brandDomain}-vs-${competitorDomain}`,
    domain: 'g2.com',
    title: `${brandDomain} vs ${competitorDomain} — G2 comparison`,
  };
  const brandHit: RunCitation = {
    url: `${brandUrl.replace(/\/$/, '')}/`,
    domain: brandDomain,
    title: `${brandDomain} — homepage`,
  };
  const reddit: RunCitation = {
    url: `https://www.reddit.com/r/SaaS/comments/abc/${prompt.replace(/\s+/g, '-').slice(0, 40)}`,
    domain: 'reddit.com',
    title: `Reddit thread: ${prompt}`,
  };

  const pattern =
    promptIndex === 0
      ? [
          [competitorWin, g2],
          [competitorWin, brandHit, reddit],
          [g2, reddit],
        ]
      : [
          [competitorWin, g2],
          [competitorWin, reddit],
          [g2, competitorWin],
        ];
  return Array.from({ length: runCount }, (_, i) => pattern[i % pattern.length]);
}

async function estimateCitationsWithLlm(
  prompt: string,
  runCount: number,
  brandDomain: string,
  competitorDomain: string,
  brandUrl: string,
  competitorUrl: string,
): Promise<LlmCitationOutput | null> {
  const result = await generateJson<LlmCitationOutput>(
    [
      `Estimate how an AI answer engine would answer this buyer-research prompt.`,
      `Prompt: ${prompt}`,
      ``,
      `Brand under analysis: ${brandDomain} (${brandUrl})`,
      `Selected competitor: ${competitorDomain} (${competitorUrl})`,
      ``,
      `For ${runCount} independent answer attempts, estimate how many would mention the brand and how many would mention the competitor.`,
      `Also include up to 6 plausible source domains/URLs that would support the answer.`,
      `Keep counts between 0 and ${runCount}.`,
    ].join('\n'),
    `{"brandCitedCount":1,"competitorCitedCount":2,"sources":[{"domain":"example.com","url":"https://example.com","title":"Example source"}]}`,
  );

  if (!result || typeof result !== 'object') return null;
  const brandCitedCount =
    typeof result.brandCitedCount === 'number'
      ? Math.min(runCount, Math.max(0, Math.round(result.brandCitedCount)))
      : 0;
  const competitorCitedCount =
    typeof result.competitorCitedCount === 'number'
      ? Math.min(runCount, Math.max(0, Math.round(result.competitorCitedCount)))
      : 0;
  const sources = Array.isArray(result.sources)
    ? result.sources
        .map((source) => {
          const url = typeof source.url === 'string' ? source.url : '';
          const domain = domainOf(typeof source.domain === 'string' ? source.domain : url);
          if (!domain || !url) return null;
          const out: CitationSource = { domain, url };
          if (typeof source.title === 'string') out.title = source.title;
          return out;
        })
        .filter((source): source is CitationSource => source !== null)
        .slice(0, 6)
    : [];

  return { brandCitedCount, competitorCitedCount, sources };
}

export async function answerCollector(
  prompts: string[],
  brandUrl: string,
  competitorUrl: string,
): Promise<Citation[]> {
  const brandDomain = domainOf(brandUrl);
  const competitorDomain = domainOf(competitorUrl);
  const apiKey = process.env.PERPLEXITY_API_KEY;

  const out: Citation[] = [];

  for (let i = 0; i < prompts.length; i++) {
    const prompt = prompts[i];
    const cacheKey = `${config.perplexityModel}::${prompt}`;
    let runs: RunCitation[][];
    let estimated: LlmCitationOutput | null = null;

    if (apiKey) {
      const cached = cache.get(cacheKey);
      if (cached) {
        runs = cached;
      } else {
        runs = await Promise.all(
          Array.from({ length: config.answerRuns }, () => callPerplexity(apiKey, prompt)),
        );
        cache.set(cacheKey, runs);
      }
    } else {
      estimated = await estimateCitationsWithLlm(
        prompt,
        config.answerRuns,
        brandDomain,
        competitorDomain,
        brandUrl,
        competitorUrl,
      );
      runs = estimated
        ? []
        : mockRuns(
            prompt,
            i,
            brandDomain,
            competitorDomain,
            brandUrl,
            competitorUrl,
            config.answerRuns,
          );
    }

    let brandCitedCount = estimated?.brandCitedCount ?? 0;
    let competitorCitedCount = estimated?.competitorCitedCount ?? 0;
    const sources = new Map<string, CitationSource>();
    for (const source of estimated?.sources ?? []) {
      sources.set(source.url, source);
    }

    for (const run of runs) {
      const runDomains = new Set(run.map((c) => c.domain));
      if (runDomains.has(brandDomain)) brandCitedCount++;
      if (runDomains.has(competitorDomain)) competitorCitedCount++;
      for (const c of run) {
        if (!sources.has(c.url)) {
          sources.set(c.url, { domain: c.domain, url: c.url, title: c.title });
        }
      }
    }

    out.push({
      prompt,
      runs: config.answerRuns,
      brandCitedCount,
      competitorCitedCount,
      brandFrequency: brandCitedCount / config.answerRuns,
      competitorFrequency: competitorCitedCount / config.answerRuns,
      sources: Array.from(sources.values()).slice(0, 8),
      engine: 'perplexity',
    });
  }

  return out;
}
