// answerCollector: query Perplexity Sonar N times per prompt when available,
// keep the actual answer text, and detect brand/competitor presence two ways:
// citation-link hits (domain in the source list) and text mentions (named in
// the answer). Without Perplexity we fall back to a clearly-labelled LLM
// estimate ('estimated') or report the prompt as 'unavailable' — never
// fabricated demo data.

import type { Citation, CitationSource, Provenance } from '@/lib/types';
import { config } from '@/lib/config';
import { generateJson } from '@/lib/llm';

const PPLX_URL = 'https://api.perplexity.ai/chat/completions';
const SNIPPET_MAX_CHARS = 280;

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

interface AnswerRun {
  citations: RunCitation[];
  answerText: string;
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

// "linear.app" → "linear"; used for text-mention matching. Single-word brand
// tokens can collide with common English words, so matching is word-boundary
// and case-insensitive but we also accept the full domain string.
function brandTokenOf(domain: string): string {
  return domain.split('.')[0];
}

function mentionCount(answerText: string, domain: string, token: string): boolean {
  if (!answerText) return false;
  const lower = answerText.toLowerCase();
  if (domain && lower.includes(domain)) return true;
  if (token.length < 3) return false;
  const re = new RegExp(`\\b${token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
  return re.test(answerText);
}

function citedInRun(run: RunCitation[], domain: string): boolean {
  return run.some((c) => c.domain === domain || c.domain.endsWith(`.${domain}`));
}

// Pull the most informative excerpt: prefer a sentence that names the brand
// or the competitor, fall back to the answer's opening.
function extractSnippet(answers: string[], brandToken: string, competitorToken: string): string | undefined {
  const texts = answers.filter((a) => a.trim().length > 0);
  if (texts.length === 0) return undefined;
  const sentences = texts[0].split(/(?<=[.!?])\s+/);
  const hit =
    sentences.find((s) => mentionCount(s, '', brandToken)) ??
    sentences.find((s) => mentionCount(s, '', competitorToken));
  const raw = (hit ?? texts[0]).replace(/\s+/g, ' ').trim();
  return raw.length > SNIPPET_MAX_CHARS ? `${raw.slice(0, SNIPPET_MAX_CHARS - 1)}…` : raw;
}

// Module-scoped cache so re-runs in the same dev process are cheap (brief §8).
const cache = new Map<string, AnswerRun[]>();

async function callPerplexity(apiKey: string, prompt: string): Promise<AnswerRun> {
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
    if (!res.ok) return { citations: [], answerText: '' };
    const data = (await res.json()) as PerplexityResponse;

    const answerText = data.choices?.[0]?.message?.content?.trim() ?? '';

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
    return { citations: out, answerText };
  } catch {
    return { citations: [], answerText: '' };
  } finally {
    clearTimeout(timer);
  }
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
  const brandToken = brandTokenOf(brandDomain);
  const competitorToken = brandTokenOf(competitorDomain);
  const apiKey = process.env.PERPLEXITY_API_KEY;

  const out: Citation[] = [];

  for (const prompt of prompts) {
    if (apiKey) {
      const cacheKey = `${config.perplexityModel}::${prompt}`;
      let runs = cache.get(cacheKey);
      if (!runs) {
        runs = await Promise.all(
          Array.from({ length: config.answerRuns }, () => callPerplexity(apiKey, prompt)),
        );
        cache.set(cacheKey, runs);
      }

      const okRuns = runs.filter((r) => r.answerText || r.citations.length > 0);
      const provenance: Provenance = okRuns.length > 0 ? 'measured' : 'unavailable';

      let brandCitedCount = 0;
      let competitorCitedCount = 0;
      let brandMentionedCount = 0;
      let competitorMentionedCount = 0;
      const sources = new Map<string, CitationSource>();

      for (const run of okRuns) {
        if (citedInRun(run.citations, brandDomain)) brandCitedCount++;
        if (citedInRun(run.citations, competitorDomain)) competitorCitedCount++;
        if (mentionCount(run.answerText, brandDomain, brandToken)) brandMentionedCount++;
        if (mentionCount(run.answerText, competitorDomain, competitorToken)) {
          competitorMentionedCount++;
        }
        for (const c of run.citations) {
          if (!sources.has(c.url)) {
            sources.set(c.url, { domain: c.domain, url: c.url, title: c.title });
          }
        }
      }

      const denom = okRuns.length || 1;
      const brandPresent = Math.max(brandCitedCount, brandMentionedCount);
      const competitorPresent = Math.max(competitorCitedCount, competitorMentionedCount);

      out.push({
        prompt,
        runs: okRuns.length,
        brandCitedCount,
        competitorCitedCount,
        brandMentionedCount,
        competitorMentionedCount,
        brandFrequency: brandPresent / denom,
        competitorFrequency: competitorPresent / denom,
        answerSnippet: extractSnippet(
          okRuns.map((r) => r.answerText),
          brandToken,
          competitorToken,
        ),
        sources: Array.from(sources.values()).slice(0, 8),
        engine: 'perplexity',
        provenance,
      });
      continue;
    }

    // No Perplexity key: an LLM estimate is better than nothing, but it is a
    // guess and gets labelled as such all the way to the UI.
    const estimated = await estimateCitationsWithLlm(
      prompt,
      config.answerRuns,
      brandDomain,
      competitorDomain,
      brandUrl,
      competitorUrl,
    );

    if (estimated) {
      out.push({
        prompt,
        runs: config.answerRuns,
        brandCitedCount: estimated.brandCitedCount,
        competitorCitedCount: estimated.competitorCitedCount,
        brandMentionedCount: estimated.brandCitedCount,
        competitorMentionedCount: estimated.competitorCitedCount,
        brandFrequency: estimated.brandCitedCount / config.answerRuns,
        competitorFrequency: estimated.competitorCitedCount / config.answerRuns,
        sources: estimated.sources,
        engine: 'perplexity',
        provenance: 'estimated',
      });
    } else {
      out.push({
        prompt,
        runs: 0,
        brandCitedCount: 0,
        competitorCitedCount: 0,
        brandMentionedCount: 0,
        competitorMentionedCount: 0,
        brandFrequency: 0,
        competitorFrequency: 0,
        sources: [],
        engine: 'perplexity',
        provenance: 'unavailable',
      });
    }
  }

  return out;
}
