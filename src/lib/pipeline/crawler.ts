// Crawler: fetch the homepage plus a handful of discovered key pages
// (FAQ / pricing / comparison) and extract the signals the rubric scores
// (brief §7). When nothing can be fetched we report fetched:false and let
// the scoring engine mark those dimensions unavailable — we never invent
// signals for a site we couldn't read.

import * as cheerio from 'cheerio';
import { config } from '@/lib/config';
import type { CrawlSignals, PricingClarity } from '@/lib/types';

const MAX_EXTRA_PAGES = 4;
const TEXT_SAMPLE_CHARS = 2000;

interface PageSignals {
  url: string;
  hasFaq: boolean;
  comparisonSignal: boolean;
  pricingClarity: PricingClarity;
  jsonLdTypes: string[];
  evidenceCount: number;
  lastUpdated: string | null;
  trustSignals: string[];
  bodyText: string;
  links: string[];
}

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

function detectComparisonSignal($: cheerio.CheerioAPI): boolean {
  const title = $('title').first().text();
  const h1 = $('h1').first().text();
  const pattern = /\b(vs\.?|versus|compare|comparison|alternative to)\b/i;
  return pattern.test(title) || pattern.test(h1);
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

function parsePage(url: string, html: string, headerLastModified: string | null): PageSignals {
  const $ = cheerio.load(html);
  const jsonLdTypes = extractJsonLdTypes($);
  const links = $('a[href]')
    .toArray()
    .map((el) => $(el).attr('href') ?? '')
    .filter(Boolean);
  return {
    url,
    hasFaq: detectFaq($, jsonLdTypes),
    comparisonSignal: detectComparisonSignal($),
    pricingClarity: detectPricingClarity($),
    jsonLdTypes,
    evidenceCount: countEvidence($),
    lastUpdated: extractLastUpdated($, headerLastModified),
    trustSignals: detectTrustSignals($),
    bodyText: $('body').text().replace(/\s+/g, ' ').trim(),
    links,
  };
}

// Pick internal links worth a follow-up crawl: FAQ, pricing, and
// comparison/alternatives pages are exactly what the rubric scores, and they
// rarely live on the homepage.
function keyPageLinks(baseUrl: string, links: string[]): string[] {
  const base = new URL(baseUrl);
  const buckets: Record<'faq' | 'pricing' | 'compare', string | null> = {
    faq: null,
    pricing: null,
    compare: null,
  };
  for (const href of links) {
    let resolved: URL;
    try {
      resolved = new URL(href, base);
    } catch {
      continue;
    }
    if (resolved.hostname !== base.hostname) continue;
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
  }
  return Object.values(buckets)
    .filter((u): u is string => u !== null)
    .slice(0, MAX_EXTRA_PAGES);
}

function pricingRank(p: PricingClarity): number {
  return p === 'clear' ? 2 : p === 'partial' ? 1 : 0;
}

export async function crawler(url: string, _role: 'brand' | 'competitor'): Promise<CrawlSignals> {
  const home = await fetchHtml(url);
  if (!home) {
    // Honest failure: nothing fetched means nothing scored. The scoring
    // engine marks page-derived dimensions unavailable and the UI says so.
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
    };
  }

  const homepage = parsePage(url, home.html, home.lastModified);
  const extraUrls = keyPageLinks(url, homepage.links);
  const extraPages = (
    await Promise.all(
      extraUrls.map(async (u) => {
        const res = await fetchHtml(u);
        return res ? parsePage(u, res.html, res.lastModified) : null;
      }),
    )
  ).filter((p): p is PageSignals => p !== null);

  const pages = [homepage, ...extraPages];

  // A comparison page counts if any crawled page *is* one (title/h1 signal)
  // or the homepage links to one (path signal caught in keyPageLinks).
  const hasComparisonPage =
    pages.some((p) => p.comparisonSignal) ||
    extraUrls.some((u) => /(\/(vs|versus|compare|comparison|alternatives?)(\/|$)|-vs-|-versus-)/.test(u));

  const jsonLdTypes = Array.from(new Set(pages.flatMap((p) => p.jsonLdTypes)));
  const trustSignals = Array.from(new Set(pages.flatMap((p) => p.trustSignals)));
  const lastUpdated = pages
    .map((p) => p.lastUpdated)
    .filter((d): d is string => d !== null)
    .sort()
    .pop() ?? null;

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
    textSample: homepage.bodyText.slice(0, TEXT_SAMPLE_CHARS),
  };
}
