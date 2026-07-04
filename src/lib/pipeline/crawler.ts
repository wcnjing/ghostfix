// Crawler: fetch the homepage plus a handful of discovered key pages
// (FAQ / pricing / comparison) and extract the signals the rubric scores
// (brief §7), plus the extended 10-question diagnostic signals from the
// homepage. When nothing can be fetched we report fetched:false and let the
// scoring engine mark page-derived dimensions unavailable — we never invent
// signals for a site we couldn't read.

import * as cheerio from 'cheerio';
import { config } from '@/lib/config';
import type { CrawlSignals, PricingClarity } from '@/lib/types';

const MAX_EXTRA_PAGES = 4;
const TEXT_SAMPLE_CHARS = 2000;

async function fetchHtml(url: string): Promise<{ html: string; lastModified: string | null } | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.fetchTimeoutMs);
  try {
    const res = await fetch(url, {
      headers: { 'user-agent': config.userAgent, accept: 'text/html,application/xhtml+xml' },
      redirect: 'follow',
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const ct = res.headers.get('content-type') ?? '';
    if (!ct.includes('text/html') && !ct.includes('xml')) return null;
    return { html: await res.text(), lastModified: res.headers.get('last-modified') };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function extractJsonLdTypes($: cheerio.CheerioAPI): string[] {
  const types = new Set<string>();
  $('script[type="application/ld+json"]').each((_, el) => {
    const raw = $(el).contents().text();
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw) as unknown;
      const walk = (node: unknown) => {
        if (!node) return;
        if (Array.isArray(node)) {
          node.forEach(walk);
          return;
        }
        if (typeof node === 'object') {
          const obj = node as Record<string, unknown>;
          const t = obj['@type'];
          if (typeof t === 'string') types.add(t);
          else if (Array.isArray(t)) t.forEach((x) => typeof x === 'string' && types.add(x));
          if (Array.isArray(obj['@graph'])) walk(obj['@graph']);
        }
      };
      walk(parsed);
    } catch {
      // Malformed JSON-LD — skip silently.
    }
  });
  return Array.from(types);
}

function detectFaq($: cheerio.CheerioAPI, jsonLdTypes: string[]): boolean {
  if (jsonLdTypes.includes('FAQPage')) return true;
  const headingHit = $('h1, h2, h3')
    .toArray()
    .some((el) => /\b(faq|frequently asked|questions)\b/i.test($(el).text()));
  if (headingHit) return true;
  // <details> blocks are a common accordion-style FAQ pattern.
  return $('details summary').length >= 3;
}

function detectComparisonPage($: cheerio.CheerioAPI): boolean {
  const title = $('title').first().text();
  const h1 = $('h1').first().text();
  const pattern = /\b(vs\.?|versus|compare|comparison|alternative to)\b/i;
  if (pattern.test(title) || pattern.test(h1)) return true;
  const linkHit = $('a[href]')
    .toArray()
    .some((el) => {
      const href = ($(el).attr('href') ?? '').toLowerCase();
      return /(\/(vs|versus|compare|comparison|alternatives?)\/|-vs-|-versus-)/.test(href);
    });
  return linkHit;
}

function detectPricingClarity($: cheerio.CheerioAPI): PricingClarity {
  const text = $('body').text();
  const numericPricing = /\$\s?\d+(?:[,.]\d+)?\s?(?:\/|\s?per\s?)?\s?(mo|month|yr|year|user)?/i;
  const pricingKeyword = /\bpricing\b|\bplans?\b/i;
  if (numericPricing.test(text) && pricingKeyword.test(text)) return 'clear';
  if (pricingKeyword.test(text)) return 'partial';
  return 'missing';
}

function countEvidence($: cheerio.CheerioAPI): number {
  const text = $('body').text();
  let count = 0;
  // Percentage stats.
  count += (text.match(/\b\d+(?:\.\d+)?\s?%/g) ?? []).length;
  // Money stats.
  count += (text.match(/\$\s?\d[\d,]*(?:\.\d+)?\s?(?:k|m|bn|million|billion)?/gi) ?? []).length;
  // Citation-style references (footnotes, "according to", "study").
  count += (text.match(/\b(according to|study|report|survey|benchmark|research)\b/gi) ?? []).length;
  return count;
}

function extractLastUpdated($: cheerio.CheerioAPI, headerVal: string | null): string | null {
  const candidates: string[] = [];
  const ogUpdated = $('meta[property="article:modified_time"]').attr('content');
  const ogPublished = $('meta[property="article:published_time"]').attr('content');
  if (ogUpdated) candidates.push(ogUpdated);
  if (ogPublished) candidates.push(ogPublished);
  $('time[datetime]').each((_, el) => {
    const dt = $(el).attr('datetime');
    if (dt) candidates.push(dt);
  });
  if (headerVal) candidates.push(headerVal);
  for (const c of candidates) {
    const t = Date.parse(c);
    if (!Number.isNaN(t)) return new Date(t).toISOString();
  }
  return null;
}

function detectTrustSignals($: cheerio.CheerioAPI): string[] {
  const text = $('body').text().toLowerCase();
  const found: string[] = [];
  if (/testimonial|"[^"]{20,}"\s*[—–-]\s*\w+/.test(text) || /testimonial/.test(text)) {
    found.push('testimonials');
  }
  if (/case study|customer story/.test(text)) found.push('case_studies');
  if (
    /featured in|as seen in|press|forbes|techcrunch|bloomberg|wired|wall street/.test(text)
  ) {
    found.push('press_mentions');
  }
  if (/soc ?2|iso ?27001|gdpr|hipaa|pci/i.test(text)) found.push('security_badges');
  if (/g2|capterra|trustpilot|trusted by/.test(text)) found.push('review_badges');
  return found;
}

// ─── Extended diagnostic signals (10-question framework) ─────────────────────

function extractTitle($: cheerio.CheerioAPI): { titleLength: number; titleText: string } {
  const title = $('title').first().text().trim();
  return { titleLength: title.length, titleText: title };
}

function checkTitleHasKeyword($: cheerio.CheerioAPI, url: string): boolean {
  const title = $('title').first().text().toLowerCase();
  // Check if title contains product/brand-related keyword rather than being generic
  // A "good" title is specific — contains action words, product terms, or value props
  const domain = (() => { try { return new URL(url).hostname.replace(/^www\./, '').split('.')[0]; } catch { return ''; } })();
  const hasProductTerms = /\b(tool|platform|software|app|service|solution|product|pricing|compare|vs|how|guide|best)\b/i.test(title);
  const hasBrandName = domain.length > 2 && title.includes(domain.toLowerCase());
  return hasProductTerms || hasBrandName;
}

function extractMetaDescriptionLength($: cheerio.CheerioAPI): number {
  const desc = (
    $('meta[name="description"]').attr('content') ??
    $('meta[property="og:description"]').attr('content') ??
    ''
  ).trim();
  return desc.length;
}

function extractH1Info($: cheerio.CheerioAPI): { h1Count: number; h1Text: string } {
  const h1s = $('h1').toArray();
  const text = h1s.length > 0 ? $(h1s[0]).text().trim() : '';
  return { h1Count: h1s.length, h1Text: text.slice(0, 120) };
}

function computeReadability($: cheerio.CheerioAPI): { readabilityScore: number; avgSentenceLength: number; wordCount: number } {
  const text = $('body').text().replace(/\s+/g, ' ').trim();
  const words = text.split(/\s+/).filter(Boolean);
  const wordCount = words.length;
  // Split into sentences (rough heuristic)
  const sentences = text.split(/[.!?]+/).filter((s) => s.trim().length > 5);
  const sentenceCount = Math.max(sentences.length, 1);
  const avgSentenceLength = Math.round(wordCount / sentenceCount);

  // Simplified readability: penalize very long sentences and very long words
  // Score 0-100: shorter sentences & common words = higher score
  const longWordRatio = words.filter((w) => w.length > 12).length / Math.max(wordCount, 1);
  let score = 100;
  if (avgSentenceLength > 25) score -= 25;
  else if (avgSentenceLength > 20) score -= 15;
  else if (avgSentenceLength > 15) score -= 5;
  if (longWordRatio > 0.15) score -= 20;
  else if (longWordRatio > 0.08) score -= 10;
  if (wordCount < 300) score -= 15; // too thin
  score = Math.max(0, Math.min(100, score));

  return { readabilityScore: score, avgSentenceLength, wordCount };
}

function hasViewportMeta($: cheerio.CheerioAPI): boolean {
  return $('meta[name="viewport"]').length > 0;
}

function countLinks($: cheerio.CheerioAPI, pageUrl: string): { internalLinkCount: number; externalLinkCount: number } {
  let internal = 0;
  let external = 0;
  const pageDomain = (() => { try { return new URL(pageUrl).hostname.replace(/^www\./, ''); } catch { return ''; } })();

  $('a[href]').each((_, el) => {
    const href = $(el).attr('href') ?? '';
    if (href.startsWith('#') || href.startsWith('javascript:') || !href) return;
    if (href.startsWith('/') || href.startsWith('./') || href.startsWith('../')) {
      internal++;
    } else {
      try {
        const linkDomain = new URL(href).hostname.replace(/^www\./, '');
        if (linkDomain === pageDomain) internal++;
        else external++;
      } catch {
        internal++; // relative URL
      }
    }
  });

  return { internalLinkCount: internal, externalLinkCount: external };
}

function countImages($: cheerio.CheerioAPI): { imagesTotal: number; imagesWithAlt: number } {
  const imgs = $('img').toArray();
  const total = imgs.length;
  const withAlt = imgs.filter((el) => {
    const alt = $(el).attr('alt');
    return alt !== undefined && alt.trim().length > 0;
  }).length;
  return { imagesTotal: total, imagesWithAlt: withAlt };
}

// ─── Copywriting Quality Extractors ──────────────────────────────────────────

interface CopywritingSignals {
  hasCtaButton: boolean;
  ctaCount: number;
  hasSocialProofNearCta: boolean;
  headingCount: number;
  hasSubheadingHierarchy: boolean;
  bulletListCount: number;
  hasPowerWords: boolean;
  hasValueProposition: boolean;
  uniqueWordRatio: number;
  passiveVoiceRatio: number;
  hasNumbersInHeadings: boolean;
  paragraphAvgLength: number;
}

function extractCopywritingSignals($: cheerio.CheerioAPI): CopywritingSignals {
  const bodyText = $('body').text().toLowerCase();

  // CTA detection: buttons/links with action-oriented text
  const ctaPatterns = /\b(get started|sign up|start free|try free|buy now|subscribe|book a demo|request demo|contact us|learn more|download|claim|join|register|add to cart|checkout)\b/i;
  const buttons = $('button, a.btn, a.button, [class*="cta"], [class*="btn"], input[type="submit"]').toArray();
  const ctaButtons = buttons.filter((el) => ctaPatterns.test($(el).text()));
  const ctaLinks = $('a').toArray().filter((el) => ctaPatterns.test($(el).text()));
  const ctaCount = ctaButtons.length + ctaLinks.length;
  const hasCtaButton = ctaCount > 0;

  // Social proof near CTA (within same parent section)
  const hasSocialProofNearCta = (() => {
    if (!hasCtaButton) return false;
    const proofPattern = /\b(trusted by|used by|customers|companies|teams|ratings?|stars?|reviews?|\d+[k+]?\s*(users|customers|teams|companies))\b/i;
    // Check if proof text exists anywhere on the page (simplified heuristic)
    return proofPattern.test(bodyText);
  })();

  // Heading structure
  const allHeadings = $('h1, h2, h3, h4, h5, h6').toArray();
  const headingCount = allHeadings.length;
  const hasSubheadingHierarchy = (() => {
    const levels = allHeadings.map((el) => parseInt(el.tagName.replace('h', ''), 10));
    if (levels.length < 2) return false;
    // Check if there's a proper descending structure (H1 → H2 → H3)
    return levels.includes(1) && levels.includes(2);
  })();

  // Bullet lists for scanability
  const bulletListCount = $('ul, ol').length;

  // Power words (urgency, benefit-driven language)
  const powerWordPattern = /\b(free|instant|guaranteed|proven|exclusive|limited|save|boost|transform|unlock|effortless|powerful|fastest|easiest|simple|secure|trusted|ultimate|breakthrough|revolutionary)\b/i;
  const hasPowerWords = powerWordPattern.test(bodyText);

  // Value proposition: clear benefit statement in first 500 chars of body
  const firstSection = $('body').text().slice(0, 500).toLowerCase();
  const valueProps = /\b(help you|so you can|without|in minutes|faster|better|easier|save time|save money|increase|reduce|eliminate|automate|streamline)\b/i;
  const hasValueProposition = valueProps.test(firstSection);

  // Unique word ratio (vocabulary diversity)
  const words = bodyText.split(/\s+/).filter((w) => w.length > 2);
  const uniqueWords = new Set(words);
  const uniqueWordRatio = words.length > 0 ? Math.round((uniqueWords.size / words.length) * 100) / 100 : 0;

  // Passive voice detection (simplified)
  const sentences = bodyText.split(/[.!?]+/).filter((s) => s.trim().length > 10);
  const passivePattern = /\b(is|are|was|were|been|being|be)\s+(being\s+)?\w+ed\b/;
  const passiveSentences = sentences.filter((s) => passivePattern.test(s));
  const passiveVoiceRatio = sentences.length > 0 ? Math.round((passiveSentences.length / sentences.length) * 100) / 100 : 0;

  // Numbers in headings (specificity signal)
  const hasNumbersInHeadings = allHeadings.some((el) => /\d/.test($(el).text()));

  // Paragraph length
  const paragraphs = $('p').toArray().map((el) => {
    const pText = $(el).text().trim();
    return pText.split(/[.!?]+/).filter((s) => s.trim().length > 5).length;
  }).filter((len) => len > 0);
  const paragraphAvgLength = paragraphs.length > 0
    ? Math.round((paragraphs.reduce((s, l) => s + l, 0) / paragraphs.length) * 10) / 10
    : 0;

  return {
    hasCtaButton,
    ctaCount,
    hasSocialProofNearCta,
    headingCount,
    hasSubheadingHierarchy,
    bulletListCount,
    hasPowerWords,
    hasValueProposition,
    uniqueWordRatio,
    passiveVoiceRatio,
    hasNumbersInHeadings,
    paragraphAvgLength,
  };
}

// ─── AI-Readiness Extractors (5 extra diagnostic questions) ──────────────────

interface AiReadinessSignals {
  hasDirectAnswerNearTop: boolean;
  hasSpecificFacts: boolean;
  contentOriginalityScore: number;
  isCrawlableByAi: boolean;
  isBrandEntityClear: boolean;
}

function extractAiReadiness($: cheerio.CheerioAPI, url: string): AiReadinessSignals {
  const bodyText = $('body').text();
  const firstSection = bodyText.slice(0, 500);

  // Q11: Direct answer near the top — factual statement with specifics
  const directAnswerPattern = /\b(\d+[\s–-]+\d+\s*(days?|hours?|minutes?|weeks?)|\$\s?\d+|in\s+\d+\s+(step|minute|hour|day)|is\s+\d+|are\s+\d+|takes?\s+\d+|costs?\s+\$?\d+|deliver[ys]?\s.*\d+|ships?\s.*\d+)/i;
  const hasDirectAnswerNearTop = directAnswerPattern.test(firstSection);

  // Q12: Specific facts — prices, dates, steps, specs, comparison tables
  const text = bodyText.toLowerCase();
  let factCount = 0;
  // Prices
  if (/\$\s?\d+/.test(text) || /€\s?\d+/.test(text) || /£\s?\d+/.test(text)) factCount++;
  // Comparison tables
  if ($('table').length > 0) factCount++;
  // Numbered steps or processes
  if (/step\s?\d|phase\s?\d/i.test(text)) factCount++;
  // Specific dates or years
  if (/\b20(2[4-9]|3\d)\b/.test(text)) factCount++;
  // Policies or specs
  if (/\b(policy|specification|requirement|warranty|guarantee|SLA)\b/i.test(text)) factCount++;
  // Pros and cons
  if (/\b(pros?\s*(and|&)\s*cons?|advantages?\s*(and|&)\s*disadvantages?)\b/i.test(text)) factCount++;
  const hasSpecificFacts = factCount >= 2;

  // Q13: Content originality — penalize generic listicle patterns
  let originalityScore = 70; // start neutral
  const genericPatterns = /\b(top\s+\d+|best\s+\d+|\d+\s+ways?\s+to|\d+\s+tips?\s+for|ultimate guide|complete guide|everything you need to know)\b/i;
  if (genericPatterns.test(bodyText.slice(0, 1000))) originalityScore -= 25;
  // Reward signals of original content
  if (/\b(our\s+(data|research|analysis|study|findings|testing))\b/i.test(text)) originalityScore += 15;
  if (/\b(we\s+(tested|compared|reviewed|analyzed|measured|found))\b/i.test(text)) originalityScore += 15;
  if ($('table').length > 0) originalityScore += 10; // original comparison data
  if (/\b(case study|customer story|original research)\b/i.test(text)) originalityScore += 15;
  // Cap
  originalityScore = Math.max(0, Math.min(100, originalityScore));

  // Q14: Crawlable by AI bots — check for robots meta noindex or very restricted indicators
  const robotsMeta = $('meta[name="robots"]').attr('content') ?? '';
  const hasNoindex = /noindex/i.test(robotsMeta);
  // We can't fetch robots.txt in this context, but we can check meta tags
  const isCrawlableByAi = !hasNoindex;

  // Q15: Brand/entity clarity — can AI tell who you are, what you sell, where you operate
  let entityScore = 0;
  // Organization or brand name in title
  const domain = (() => { try { return new URL(url).hostname.replace(/^www\./, '').split('.')[0]; } catch { return ''; } })();
  const title = $('title').first().text().toLowerCase();
  if (domain && title.includes(domain)) entityScore++;
  // Clear "about" or "what we do" signal
  if (/\b(we\s+(are|help|provide|offer|build|make|deliver)|about\s+us|our\s+(mission|story|team))\b/i.test(firstSection.toLowerCase())) entityScore++;
  // Location or market signal
  if (/\b(based in|headquartered|serving|available in|operates in|worldwide|global)\b/i.test(text)) entityScore++;
  // Product/service clarity
  if (/\b(platform|software|tool|service|product|app|solution)\b/i.test(firstSection.toLowerCase())) entityScore++;
  // Trust/authority signal
  if (/\b(trusted by|used by|serving|since\s+\d{4})\b/i.test(text)) entityScore++;
  const isBrandEntityClear = entityScore >= 3;

  return {
    hasDirectAnswerNearTop,
    hasSpecificFacts,
    contentOriginalityScore: originalityScore,
    isCrawlableByAi,
    isBrandEntityClear,
  };
}

// ─── Multi-page crawl ────────────────────────────────────────────────────────

// Rubric signals we merge across every crawled page (extended diagnostics stay
// homepage-only — that's the page AI engines land on).
interface PageSignals {
  url: string;
  hasFaq: boolean;
  hasComparisonPage: boolean;
  pricingClarity: PricingClarity;
  jsonLdTypes: string[];
  evidenceCount: number;
  lastUpdated: string | null;
  trustSignals: string[];
}

function rubricSignals($: cheerio.CheerioAPI, url: string, headerLastModified: string | null): PageSignals {
  const jsonLdTypes = extractJsonLdTypes($);
  return {
    url,
    hasFaq: detectFaq($, jsonLdTypes),
    hasComparisonPage: detectComparisonPage($),
    pricingClarity: detectPricingClarity($),
    jsonLdTypes,
    evidenceCount: countEvidence($),
    lastUpdated: extractLastUpdated($, headerLastModified),
    trustSignals: detectTrustSignals($),
  };
}

// Pick internal links worth a follow-up crawl: FAQ, pricing, and
// comparison/alternatives pages are exactly what the rubric scores, and they
// rarely live on the homepage.
function keyPageLinks(baseUrl: string, $: cheerio.CheerioAPI): string[] {
  const base = new URL(baseUrl);
  const buckets: Record<'faq' | 'pricing' | 'compare', string | null> = {
    faq: null,
    pricing: null,
    compare: null,
  };
  $('a[href]').each((_, el) => {
    const href = $(el).attr('href') ?? '';
    let resolved: URL;
    try {
      resolved = new URL(href, base);
    } catch {
      return;
    }
    if (resolved.hostname !== base.hostname) return;
    const path = resolved.pathname.toLowerCase();
    if (!buckets.faq && /(^|\/)(faq|faqs|frequently-asked)/.test(path)) {
      buckets.faq = resolved.toString();
    } else if (!buckets.pricing && /(^|\/)(pricing|plans)(\/|$)/.test(path)) {
      buckets.pricing = resolved.toString();
    } else if (
      !buckets.compare &&
      /(\/(vs|versus|compare|comparison|alternatives?)(\/|$)|-vs-|-versus-)/.test(path)
    ) {
      buckets.compare = resolved.toString();
    }
  });
  return Object.values(buckets)
    .filter((u): u is string => u !== null)
    .slice(0, MAX_EXTRA_PAGES);
}

function pricingRank(p: PricingClarity): number {
  return p === 'clear' ? 2 : p === 'partial' ? 1 : 0;
}

// Honest failure: nothing fetched means nothing scored. The scoring engine
// marks page-derived dimensions unavailable and the UI says so.
function unfetched(url: string): CrawlSignals {
  return {
    url,
    fetched: false,
    pagesCrawled: [],
    hasFaq: false,
    hasComparisonPage: false,
    pricingClarity: 'missing',
    jsonLdTypes: [],
    evidenceCount: 0,
    lastUpdated: null,
    trustSignals: [],
    titleLength: 0,
    titleHasKeyword: false,
    metaDescriptionLength: 0,
    h1Count: 0,
    h1Text: '',
    readabilityScore: 0,
    hasViewportMeta: false,
    internalLinkCount: 0,
    externalLinkCount: 0,
    imagesTotal: 0,
    imagesWithAlt: 0,
    wordCount: 0,
    avgSentenceLength: 0,
    hasCtaButton: false,
    ctaCount: 0,
    hasSocialProofNearCta: false,
    headingCount: 0,
    hasSubheadingHierarchy: false,
    bulletListCount: 0,
    hasPowerWords: false,
    hasValueProposition: false,
    uniqueWordRatio: 0,
    passiveVoiceRatio: 0,
    hasNumbersInHeadings: false,
    paragraphAvgLength: 0,
    hasDirectAnswerNearTop: false,
    hasSpecificFacts: false,
    contentOriginalityScore: 0,
    isCrawlableByAi: false,
    isBrandEntityClear: false,
  };
}

export async function crawler(url: string, _role: 'brand' | 'competitor'): Promise<CrawlSignals> {
  const home = await fetchHtml(url);
  if (!home) return unfetched(url);

  const $ = cheerio.load(home.html);
  const homeSignals = rubricSignals($, url, home.lastModified);

  // Follow up to MAX_EXTRA_PAGES discovered FAQ/pricing/comparison pages so a
  // brand whose FAQ lives at /faq isn't scored as "missing FAQ".
  const extraUrls = keyPageLinks(url, $);
  const extraPages = (
    await Promise.all(
      extraUrls.map(async (u) => {
        const res = await fetchHtml(u);
        if (!res) return null;
        return rubricSignals(cheerio.load(res.html), u, res.lastModified);
      }),
    )
  ).filter((p): p is PageSignals => p !== null);

  const pages = [homeSignals, ...extraPages];
  const hasComparisonPage =
    pages.some((p) => p.hasComparisonPage) ||
    extraUrls.some((u) => /(\/(vs|versus|compare|comparison|alternatives?)(\/|$)|-vs-|-versus-)/.test(u));
  const jsonLdTypes = Array.from(new Set(pages.flatMap((p) => p.jsonLdTypes)));
  const trustSignals = Array.from(new Set(pages.flatMap((p) => p.trustSignals)));
  const lastUpdated =
    pages
      .map((p) => p.lastUpdated)
      .filter((d): d is string => d !== null)
      .sort()
      .pop() ?? null;

  // Extended diagnostics come from the homepage — the page AI engines land on.
  const { titleLength } = extractTitle($);
  const titleHasKeyword = checkTitleHasKeyword($, url);
  const metaDescriptionLength = extractMetaDescriptionLength($);
  const { h1Count, h1Text } = extractH1Info($);
  const { readabilityScore, avgSentenceLength, wordCount } = computeReadability($);
  const viewport = hasViewportMeta($);
  const { internalLinkCount, externalLinkCount } = countLinks($, url);
  const { imagesTotal, imagesWithAlt } = countImages($);
  const copy = extractCopywritingSignals($);
  const aiReady = extractAiReadiness($, url);

  return {
    url,
    fetched: true,
    pagesCrawled: pages.map((p) => p.url),
    hasFaq: pages.some((p) => p.hasFaq),
    hasComparisonPage,
    pricingClarity: pages.reduce<PricingClarity>(
      (best, p) => (pricingRank(p.pricingClarity) > pricingRank(best) ? p.pricingClarity : best),
      'missing',
    ),
    jsonLdTypes,
    // Max per page rather than sum, so crawling more pages doesn't inflate
    // the density comparison between brand and competitor.
    evidenceCount: Math.max(...pages.map((p) => p.evidenceCount)),
    lastUpdated,
    trustSignals,
    textSample: $('body').text().replace(/\s+/g, ' ').trim().slice(0, TEXT_SAMPLE_CHARS),
    titleLength,
    titleHasKeyword,
    metaDescriptionLength,
    h1Count,
    h1Text,
    readabilityScore,
    hasViewportMeta: viewport,
    internalLinkCount,
    externalLinkCount,
    imagesTotal,
    imagesWithAlt,
    wordCount,
    avgSentenceLength,
    ...copy,
    ...aiReady,
  };
}
