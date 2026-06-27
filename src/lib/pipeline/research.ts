// Research mode: starting from just a brand URL, auto-discover the prompts
// customers actually ask AI in that category and the competitors AI consistently
// recommends. Falls back to deterministic stubs when LLM keys are
// missing so the demo still produces a coherent dashboard.

import * as cheerio from 'cheerio';

import { config } from '@/lib/config';
import { generateJson, generateText } from '@/lib/llm';
import type {
  AnalysisResult,
  CrawlSignals,
  DiscoveredCompetitor,
  ResearchFindings,
} from '@/lib/types';

const PPLX_URL = 'https://api.perplexity.ai/chat/completions';

function domainOf(input: string): string {
  try {
    return new URL(input).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return input.replace(/^www\./, '').toLowerCase();
  }
}

interface BrandSummary {
  domain: string;
  title: string;
  description: string;
  rawText: string;
}

async function fetchBrandSummary(url: string): Promise<BrandSummary> {
  const domain = domainOf(url);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.fetchTimeoutMs);
  try {
    const res = await fetch(url, {
      headers: { 'user-agent': config.userAgent, accept: 'text/html,application/xhtml+xml' },
      redirect: 'follow',
      signal: controller.signal,
    });
    if (!res.ok) return { domain, title: domain, description: '', rawText: '' };
    const ct = res.headers.get('content-type') ?? '';
    if (!ct.includes('text/html') && !ct.includes('xml')) {
      return { domain, title: domain, description: '', rawText: '' };
    }
    const html = await res.text();
    const $ = cheerio.load(html);
    const title = ($('title').first().text() || $('h1').first().text() || domain).trim();
    const description = (
      $('meta[name="description"]').attr('content') ??
      $('meta[property="og:description"]').attr('content') ??
      ''
    ).trim();
    const rawText = $('body').text().replace(/\s+/g, ' ').slice(0, 2000).trim();
    return { domain, title, description, rawText };
  } catch {
    return { domain, title: domain, description: '', rawText: '' };
  } finally {
    clearTimeout(timer);
  }
}

// ─── Brand summary + category + prompts ──────────────────────────────────────

interface SummarizeOutput {
  category: string;
  summary: string;
  prompts: string[];
}

async function summarizeAndDiscoverPrompts(
  brand: BrandSummary,
  hint?: string,
): Promise<SummarizeOutput> {
  const fallback: SummarizeOutput = {
    category: brand.description.slice(0, 80) || 'B2B software',
    summary: brand.description || `Brand at ${brand.domain}.`,
    prompts: [
      `best ${brand.domain.split('.')[0]} alternative`,
      `${brand.domain.split('.')[0]} vs competitors`,
      `is ${brand.domain.split('.')[0]} worth it`,
      `pricing comparison for ${brand.domain.split('.')[0]} category`,
      `top tools like ${brand.domain.split('.')[0]}`,
    ],
  };

  const result = await generateJson<SummarizeOutput>(
    [
      `You're researching a brand for AI-visibility analysis.`,
      `Brand domain: ${brand.domain}`,
      `Page title: ${brand.title}`,
      `Meta description: ${brand.description || '(none)'}`,
      hint ? `User hint about the brand: ${hint}` : '',
      ``,
      `Page text (truncated):`,
      brand.rawText.slice(0, 1500),
      ``,
      `Produce three things:`,
      `1. category — a short phrase identifying the product category (e.g. "B2B project management software", "DTC men's skincare", "AI-powered coding assistant").`,
      `2. summary — one tight sentence describing what this brand does and who it's for.`,
      `3. prompts — exactly 5 distinct high-intent prompts that a potential customer might ask an AI engine (ChatGPT, Perplexity, etc.) before choosing a product in this category. Mix prompt types: "best X for Y", "X vs Y", "is X worth it", category-discovery, and comparison/alternative queries. Don't include the brand's name in every prompt — most should be category-level so we can see whether AI surfaces the brand or competitors.`,
    ].join('\n'),
    `Return JSON with this exact shape:\n{"category": "...", "summary": "...", "prompts": ["...", "...", "...", "...", "..."]}`,
  );

  if (
    result &&
    typeof result.category === 'string' &&
    typeof result.summary === 'string' &&
    Array.isArray(result.prompts) &&
    result.prompts.length >= 3
  ) {
    return {
      category: result.category,
      summary: result.summary,
      prompts: result.prompts.slice(0, 5).map((p) => String(p).trim()).filter(Boolean),
    };
  }
  return fallback;
}

// ─── Competitor discovery ────────────────────────────────────────────────────

interface PplxResp {
  search_results?: { url?: string; title?: string }[];
  citations?: (string | { url?: string; title?: string })[];
}

interface PromptCitations {
  prompt: string;
  domains: { domain: string; url: string; title?: string }[];
}

async function pplxOnePrompt(apiKey: string, prompt: string): Promise<PromptCitations | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const res = await fetch(PPLX_URL, {
      method: 'POST',
      headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        model: config.perplexityModel,
        messages: [{ role: 'user', content: prompt }],
        return_citations: true,
      }),
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const data = (await res.json()) as PplxResp;
    const out: PromptCitations = { prompt, domains: [] };
    const push = (url: string, title?: string) => {
      const d = domainOf(url);
      if (!d) return;
      out.domains.push({ domain: d, url, title });
    };
    if (Array.isArray(data.search_results)) {
      for (const r of data.search_results) if (r?.url) push(r.url, r.title);
    }
    if (out.domains.length === 0 && Array.isArray(data.citations)) {
      for (const c of data.citations) {
        if (typeof c === 'string') push(c);
        else if (c?.url) push(c.url, c.title);
      }
    }
    return out;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

const IGNORE_DOMAINS = new Set([
  'wikipedia.org',
  'reddit.com',
  'youtube.com',
  'youtu.be',
  'medium.com',
  'quora.com',
  'forbes.com',
  'techcrunch.com',
  'g2.com',
  'capterra.com',
  'trustpilot.com',
  'producthunt.com',
  'gartner.com',
  'crunchbase.com',
  'linkedin.com',
  'github.com',
  'stackoverflow.com',
]);

const FALLBACK_COMPETITORS_BY_CATEGORY: {
  match: RegExp;
  competitors: { domain: string; url: string; sampleTitle: string }[];
}[] = [
  {
    match:
      /\b(youtube|video|videos|streaming|creator|creators|content sharing|short-form|livestream|live streaming|music events)\b/i,
    competitors: [
      {
        domain: 'vimeo.com',
        url: 'https://vimeo.com',
        sampleTitle: 'Vimeo — video hosting and sharing for creators and businesses',
      },
      {
        domain: 'tiktok.com',
        url: 'https://www.tiktok.com',
        sampleTitle: 'TikTok — short-form video platform',
      },
      {
        domain: 'twitch.tv',
        url: 'https://www.twitch.tv',
        sampleTitle: 'Twitch — live streaming platform',
      },
      {
        domain: 'dailymotion.com',
        url: 'https://www.dailymotion.com',
        sampleTitle: 'Dailymotion — video sharing platform',
      },
    ],
  },
  {
    match: /\b(project|task|work management|workspace|sprint|issue tracker|planning)\b/i,
    competitors: [
      {
        domain: 'notion.so',
        url: 'https://www.notion.so',
        sampleTitle: 'Notion — your all-in-one workspace',
      },
      {
        domain: 'asana.com',
        url: 'https://asana.com',
        sampleTitle: 'Asana — work management for teams',
      },
      {
        domain: 'monday.com',
        url: 'https://monday.com',
        sampleTitle: 'monday.com — work OS',
      },
    ],
  },
  {
    match: /\b(crm|sales|pipeline|customer relationship)\b/i,
    competitors: [
      {
        domain: 'salesforce.com',
        url: 'https://www.salesforce.com',
        sampleTitle: 'Salesforce — CRM software',
      },
      {
        domain: 'hubspot.com',
        url: 'https://www.hubspot.com',
        sampleTitle: 'HubSpot — CRM platform',
      },
      {
        domain: 'zoho.com',
        url: 'https://www.zoho.com/crm',
        sampleTitle: 'Zoho CRM — sales CRM software',
      },
    ],
  },
  {
    match: /\b(email|newsletter|marketing automation|campaign)\b/i,
    competitors: [
      {
        domain: 'mailchimp.com',
        url: 'https://mailchimp.com',
        sampleTitle: 'Mailchimp — email marketing platform',
      },
      {
        domain: 'klaviyo.com',
        url: 'https://www.klaviyo.com',
        sampleTitle: 'Klaviyo — marketing automation',
      },
      {
        domain: 'constantcontact.com',
        url: 'https://www.constantcontact.com',
        sampleTitle: 'Constant Contact — email marketing',
      },
    ],
  },
];

const PROMPT_BRANDS: Record<string, { domain: string; url: string; sampleTitle: string }> = {
  vimeo: {
    domain: 'vimeo.com',
    url: 'https://vimeo.com',
    sampleTitle: 'Vimeo — video hosting and sharing',
  },
  tiktok: {
    domain: 'tiktok.com',
    url: 'https://www.tiktok.com',
    sampleTitle: 'TikTok — short-form video platform',
  },
  twitch: {
    domain: 'twitch.tv',
    url: 'https://www.twitch.tv',
    sampleTitle: 'Twitch — live streaming platform',
  },
  dailymotion: {
    domain: 'dailymotion.com',
    url: 'https://www.dailymotion.com',
    sampleTitle: 'Dailymotion — video sharing platform',
  },
  notion: {
    domain: 'notion.so',
    url: 'https://www.notion.so',
    sampleTitle: 'Notion — your all-in-one workspace',
  },
  asana: {
    domain: 'asana.com',
    url: 'https://asana.com',
    sampleTitle: 'Asana — work management for teams',
  },
  monday: {
    domain: 'monday.com',
    url: 'https://monday.com',
    sampleTitle: 'monday.com — work OS',
  },
  jira: {
    domain: 'atlassian.com',
    url: 'https://www.atlassian.com/software/jira',
    sampleTitle: 'Jira — issue and project tracking',
  },
  trello: {
    domain: 'trello.com',
    url: 'https://trello.com',
    sampleTitle: 'Trello — visual project management',
  },
};

const DOMAIN_COMPETITOR_FALLBACKS: {
  match: RegExp;
  competitors: { domain: string; url: string; sampleTitle: string }[];
}[] = [
  {
    match: /\b(youtube\.com|youtu\.be)\b/i,
    competitors: FALLBACK_COMPETITORS_BY_CATEGORY[0].competitors,
  },
  {
    match: /\b(vimeo\.com|tiktok\.com|twitch\.tv|dailymotion\.com)\b/i,
    competitors: FALLBACK_COMPETITORS_BY_CATEGORY[0].competitors,
  },
  {
    match: /\b(notion\.so|asana\.com|monday\.com|linear\.app|atlassian\.com|trello\.com)\b/i,
    competitors: FALLBACK_COMPETITORS_BY_CATEGORY[1].competitors,
  },
  {
    match: /\b(salesforce\.com|hubspot\.com|zoho\.com)\b/i,
    competitors: FALLBACK_COMPETITORS_BY_CATEGORY[2].competitors,
  },
  {
    match: /\b(mailchimp\.com|klaviyo\.com|constantcontact\.com|sendgrid\.com|mailgun\.com)\b/i,
    competitors: FALLBACK_COMPETITORS_BY_CATEGORY[3].competitors,
  },
];

function fallbackCompetitors(
  prompts: string[],
  brandDomain: string,
  category: string,
  brandTitle = '',
  summary = '',
): DiscoveredCompetitor[] {
  const promptText = prompts.join(' ').toLowerCase();
  const signalText = `${brandDomain} ${brandTitle} ${category} ${summary} ${promptText}`.toLowerCase();
  const byDomain = new Map<
    string,
    { domain: string; url: string; sampleTitle: string; promptHits: number }
  >();

  for (const [brand, competitor] of Object.entries(PROMPT_BRANDS)) {
    if (!signalText.includes(brand)) continue;
    if (competitor.domain === brandDomain) continue;
    byDomain.set(competitor.domain, {
      ...competitor,
      promptHits: prompts.filter((prompt) => prompt.toLowerCase().includes(brand)).length,
    });
  }

  const domainMatch = DOMAIN_COMPETITOR_FALLBACKS.find((entry) => entry.match.test(signalText));
  for (const competitor of domainMatch?.competitors ?? []) {
    if (competitor.domain === brandDomain || byDomain.has(competitor.domain)) continue;
    byDomain.set(competitor.domain, {
      ...competitor,
      promptHits: 0,
    });
  }

  const categoryMatch = FALLBACK_COMPETITORS_BY_CATEGORY.find((entry) =>
    entry.match.test(signalText),
  );
  for (const competitor of categoryMatch?.competitors ?? []) {
    if (competitor.domain === brandDomain || byDomain.has(competitor.domain)) continue;
    byDomain.set(competitor.domain, {
      ...competitor,
      promptHits: 0,
    });
  }

  if (byDomain.size === 0) {
    for (const competitor of FALLBACK_COMPETITORS_BY_CATEGORY[1].competitors) {
      if (competitor.domain === brandDomain || byDomain.has(competitor.domain)) continue;
      byDomain.set(competitor.domain, {
        ...competitor,
        promptHits: 0,
      });
    }
  }

  return Array.from(byDomain.values())
    .map((competitor, index) => ({
      domain: competitor.domain,
      url: competitor.url,
      citationCount: Math.max(1, prompts.length - index - (competitor.promptHits > 0 ? 0 : 1)),
      promptCount: prompts.length,
      sampleTitle: competitor.sampleTitle,
    }))
    .sort((a, b) => b.citationCount - a.citationCount)
    .slice(0, 5);
}

interface LlmCompetitor {
  domain: string;
  url: string;
  citationCount?: number;
  sampleTitle?: string;
}

interface LlmCompetitorOutput {
  competitors: LlmCompetitor[];
}

function normalizeCompetitorUrl(domain: string, url: unknown): string {
  if (typeof url === 'string') {
    try {
      const parsed = new URL(url);
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') return parsed.toString();
    } catch {
      // Fall through to domain URL.
    }
  }
  return `https://${domain}`;
}

async function discoverCompetitorsViaLlm(
  brand: BrandSummary,
  category: string,
  summary: string,
  prompts: string[],
): Promise<DiscoveredCompetitor[] | null> {
  const result = await generateJson<LlmCompetitorOutput>(
    [
      `You're choosing realistic competitors for an AI-visibility analysis.`,
      `Use your general market knowledge and the supplied prompts. Do not default to project-management brands unless this is actually a project-management category.`,
      ``,
      `Brand domain: ${brand.domain}`,
      `Brand title: ${brand.title}`,
      `Brand summary: ${summary}`,
      `Category: ${category}`,
      ``,
      `Customer prompts we will test:`,
      prompts.map((prompt, i) => `${i + 1}. ${prompt}`).join('\n'),
      ``,
      `Return 3-5 direct competitors or close substitutes that an AI answer engine would plausibly mention for these prompts.`,
      `Exclude the brand domain itself and broad publisher/community/reference domains.`,
      `citationCount should be an estimated count from 1 to ${prompts.length} for how many of these prompts would plausibly mention that competitor.`,
    ].join('\n'),
    `{"competitors":[{"domain":"example.com","url":"https://example.com","citationCount":3,"sampleTitle":"Example — short description"}]}`,
  );

  if (!result || !Array.isArray(result.competitors)) return null;

  const seen = new Set<string>();
  const competitors: DiscoveredCompetitor[] = [];
  for (const item of result.competitors) {
    if (!item || typeof item.domain !== 'string') continue;
    const domain = domainOf(item.domain);
    if (!domain || domain === brand.domain || IGNORE_DOMAINS.has(domain) || seen.has(domain)) {
      continue;
    }
    seen.add(domain);
    const citationCount =
      typeof item.citationCount === 'number'
        ? Math.min(prompts.length, Math.max(1, Math.round(item.citationCount)))
        : Math.max(1, prompts.length - competitors.length - 1);
    competitors.push({
      domain,
      url: normalizeCompetitorUrl(domain, item.url),
      citationCount,
      promptCount: prompts.length,
      sampleTitle: typeof item.sampleTitle === 'string' ? item.sampleTitle : undefined,
    });
  }

  return competitors
    .sort((a, b) => b.citationCount - a.citationCount)
    .slice(0, 5);
}

async function discoverCompetitorsViaPerplexity(
  prompts: string[],
  brandDomain: string,
): Promise<{ competitors: DiscoveredCompetitor[]; prompts: PromptCitations[] }> {
  const apiKey = process.env.PERPLEXITY_API_KEY;
  if (!apiKey) {
    return {
      competitors: [],
      prompts: [],
    };
  }

  const results = await Promise.all(prompts.map((p) => pplxOnePrompt(apiKey, p)));
  const valid = results.filter((r): r is PromptCitations => r !== null);

  // Aggregate by domain. Count how many distinct prompts cite each domain.
  const byDomain = new Map<
    string,
    { count: number; url: string; title?: string }
  >();
  for (const r of valid) {
    const seen = new Set<string>();
    for (const d of r.domains) {
      if (seen.has(d.domain)) continue;
      seen.add(d.domain);
      if (d.domain === brandDomain) continue;
      if (IGNORE_DOMAINS.has(d.domain)) continue;
      const cur = byDomain.get(d.domain);
      if (cur) cur.count += 1;
      else byDomain.set(d.domain, { count: 1, url: d.url, title: d.title });
    }
  }

  const competitors: DiscoveredCompetitor[] = Array.from(byDomain.entries())
    .map(([domain, v]) => ({
      domain,
      url: v.url,
      citationCount: v.count,
      promptCount: prompts.length,
      sampleTitle: v.title,
    }))
    .sort((a, b) => b.citationCount - a.citationCount)
    .slice(0, 5);

  return { competitors, prompts: valid };
}

// ─── Narrative synthesis ─────────────────────────────────────────────────────

async function synthesizeNarrative(
  brand: BrandSummary,
  category: string,
  selectedCompetitor: string,
  discoveredCompetitors: DiscoveredCompetitor[],
  signals: { brand: CrawlSignals; competitor: CrawlSignals },
  analysis: Pick<AnalysisResult, 'score' | 'scoreBreakdown' | 'issues' | 'citations'>,
): Promise<string> {
  const fallback = [
    `## What we found`,
    ``,
    `**Category:** ${category}`,
    `**Top AI-cited competitors:** ${discoveredCompetitors.map((c) => c.domain).join(', ') || 'none discovered'}`,
    `**Deepest gap is against:** ${selectedCompetitor}`,
    ``,
    `### Visibility score: ${analysis.score}/100`,
    ``,
    ...analysis.scoreBreakdown.dimensions.map(
      (d) => `- **${d.dimension.replace(/_/g, ' ')}:** ${d.score}/${d.max} — ${d.reasons[0] ?? ''}`,
    ),
    ``,
    `### Top issues`,
    ``,
    ...analysis.issues.slice(0, 5).map((i) => `- **[${i.severity}]** ${i.title} — ${i.why}`),
  ].join('\n');

  const llm = await generateText(
    [
      `You're writing a short, punchy "AI visibility research report" for a brand.`,
      ``,
      `Brand: ${brand.domain} — ${brand.description || brand.title}`,
      `Category: ${category}`,
      `Score: ${analysis.score}/100`,
      ``,
      `Competitors AI consistently surfaces in this category:`,
      discoveredCompetitors.map((c) => `- ${c.domain} (cited in ${c.citationCount}/${c.promptCount} discovery prompts)`).join('\n'),
      ``,
      `We did a deep-dive comparison against the strongest competitor: ${selectedCompetitor}.`,
      ``,
      `Crawl signals — brand vs competitor:`,
      `- FAQ section: ${signals.brand.hasFaq ? 'yes' : 'no'} vs ${signals.competitor.hasFaq ? 'yes' : 'no'}`,
      `- Comparison page: ${signals.brand.hasComparisonPage ? 'yes' : 'no'} vs ${signals.competitor.hasComparisonPage ? 'yes' : 'no'}`,
      `- JSON-LD types: [${signals.brand.jsonLdTypes.join(', ') || 'none'}] vs [${signals.competitor.jsonLdTypes.join(', ') || 'none'}]`,
      `- Evidence density: ${signals.brand.evidenceCount} vs ${signals.competitor.evidenceCount}`,
      ``,
      `Top diagnosed issues:`,
      analysis.issues.slice(0, 5).map((i) => `- [${i.severity}] ${i.title}: ${i.why}`).join('\n'),
      ``,
      `Write 250-400 words of Markdown. Structure:`,
      `1. One opening sentence stating the headline finding.`,
      `2. "## Why AI prefers ${selectedCompetitor}" — 2-3 specific, evidence-based reasons.`,
      `3. "## The biggest gaps" — bullet list of the top 3 things to fix, each one tied to a specific dimension.`,
      `4. "## What we'd ship first" — one short paragraph naming the highest-leverage fix.`,
      ``,
      `Be specific. Cite the numbers. No fluff, no marketing voice, no claims we can't back. If a signal is mocked or missing, say so plainly.`,
    ].join('\n'),
  );

  return llm ?? fallback;
}

// ─── Public entry points ─────────────────────────────────────────────────────

export interface ResearchDiscovery {
  brand: BrandSummary;
  category: string;
  summary: string;
  prompts: string[];
  competitors: DiscoveredCompetitor[];
}

/** Step 1: discover prompts + competitors from just a brand URL. */
export async function discover(brandUrl: string, hint?: string): Promise<ResearchDiscovery> {
  const brand = await fetchBrandSummary(brandUrl);
  const { category, summary, prompts } = await summarizeAndDiscoverPrompts(brand, hint);
  const llmCompetitors = await discoverCompetitorsViaLlm(brand, category, summary, prompts);
  const competitors =
    llmCompetitors && llmCompetitors.length > 0
      ? llmCompetitors
      : (await discoverCompetitorsViaPerplexity(prompts, brand.domain)).competitors;

  return {
    brand,
    category,
    summary,
    prompts,
    competitors:
      competitors.length > 0
        ? competitors
        : fallbackCompetitors(prompts, brand.domain, category, brand.title, summary),
  };
}

/** Step 2: given a finished analysis, build the narrative findings report. */
export async function synthesizeFindings(
  discovery: ResearchDiscovery,
  selectedCompetitorDomain: string,
  signals: { brand: CrawlSignals; competitor: CrawlSignals },
  analysis: Pick<AnalysisResult, 'score' | 'scoreBreakdown' | 'issues' | 'citations'>,
): Promise<ResearchFindings> {
  const narrative = await synthesizeNarrative(
    discovery.brand,
    discovery.category,
    selectedCompetitorDomain,
    discovery.competitors,
    signals,
    analysis,
  );
  return {
    brandSummary: discovery.summary,
    category: discovery.category,
    discoveredPrompts: discovery.prompts,
    discoveredCompetitors: discovery.competitors,
    selectedCompetitorDomain,
    narrative,
    source: 'auto',
  };
}
