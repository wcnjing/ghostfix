// answerCollector: query Perplexity Sonar N=3 times per prompt, parse citations,
// mark brand/competitor presence by domain match. Falls back to a representative
// mock when PERPLEXITY_API_KEY is missing (brief §2: demo reliability beats live).

import type { Citation, CitationSource } from '@/lib/types';

const RUNS = 3;
const PPLX_URL = 'https://api.perplexity.ai/chat/completions';
const PPLX_MODEL = 'sonar';
const TIMEOUT_MS = 25000;

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
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(PPLX_URL, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: PPLX_MODEL,
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

  // First prompt: brand barely sneaks in once. Other prompts: brand absent.
  if (promptIndex === 0) {
    return [
      [competitorWin, g2],
      [competitorWin, brandHit, reddit],
      [g2, reddit],
    ];
  }
  return [
    [competitorWin, g2],
    [competitorWin, reddit],
    [g2, competitorWin],
  ];
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
    const cacheKey = `${PPLX_MODEL}::${prompt}`;
    let runs: RunCitation[][];

    if (apiKey) {
      const cached = cache.get(cacheKey);
      if (cached) {
        runs = cached;
      } else {
        runs = await Promise.all(
          Array.from({ length: RUNS }, () => callPerplexity(apiKey, prompt)),
        );
        cache.set(cacheKey, runs);
      }
    } else {
      runs = mockRuns(prompt, i, brandDomain, competitorDomain, brandUrl, competitorUrl);
    }

    let brandCitedCount = 0;
    let competitorCitedCount = 0;
    const sources = new Map<string, CitationSource>();

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
      runs: RUNS,
      brandCitedCount,
      competitorCitedCount,
      brandFrequency: brandCitedCount / RUNS,
      competitorFrequency: competitorCitedCount / RUNS,
      sources: Array.from(sources.values()).slice(0, 8),
      engine: 'perplexity',
    });
  }

  return out;
}
