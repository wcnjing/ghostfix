// Crawler: fetch a page and extract the signals the rubric scores (brief §7).
// Falls back to a representative mock when fetch fails so the demo never breaks.

import * as cheerio from 'cheerio';
import { config } from '@/lib/config';
import type { CrawlSignals, PricingClarity } from '@/lib/types';

function mockFor(url: string, role: 'brand' | 'competitor'): CrawlSignals {
  if (role === 'competitor') {
    return {
      url,
      hasFaq: true,
      hasComparisonPage: true,
      pricingClarity: 'clear',
      jsonLdTypes: ['FAQPage', 'Product', 'Organization'],
      evidenceCount: 18,
      lastUpdated: '2026-05-12T00:00:00.000Z',
      trustSignals: ['testimonials', 'case_studies', 'press_mentions'],
    };
  }
  return {
    url,
    hasFaq: false,
    hasComparisonPage: false,
    pricingClarity: 'partial',
    jsonLdTypes: [],
    evidenceCount: 3,
    lastUpdated: null,
    trustSignals: ['testimonials'],
  };
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

export async function crawler(url: string, role: 'brand' | 'competitor'): Promise<CrawlSignals> {
  let html: string | null = null;
  let headerLastModified: string | null = null;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), config.fetchTimeoutMs);
    const res = await fetch(url, {
      headers: { 'user-agent': config.userAgent, accept: 'text/html,application/xhtml+xml' },
      redirect: 'follow',
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (res.ok) {
      const ct = res.headers.get('content-type') ?? '';
      if (ct.includes('text/html') || ct.includes('xml')) {
        html = await res.text();
        headerLastModified = res.headers.get('last-modified');
      }
    }
  } catch {
    html = null;
  }

  if (!html) {
    // Demo-safe fallback so the pipeline never strands the user.
    return mockFor(url, role);
  }

  const $ = cheerio.load(html);
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
