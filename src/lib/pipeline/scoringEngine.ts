// Applies the brief §7 rubric to citation + crawl signals.
// Every dimension emits a numeric subscore and at least one reason string —
// explainability is non-negotiable (brief §2).
//
// Internally, the engine evaluates 10 diagnostic questions before scoring:
//  1. Is the keyword clear?
//  2. Is the title specific?
//  3. Does the page answer what users are searching for?
//  4. Is it easy to read?
//  5. Is it mobile-friendly?
//  6. Does it load fast? (proxy: page weight / content ratio)
//  7. Are there useful internal links?
//  8. Are images named and described properly?
//  9. Is the content better than competitors' pages?
// 10. Is it genuinely useful, not just written for Google?
//
// These questions produce granular, varied issues — NO cap on issue count.
// FAQ-related suggestions are intentionally omitted.

import {
  DIMENSION_MAX,
  type Citation,
  type CrawlSignals,
  type DimensionScore,
  type Issue,
  type ScoreBreakdown,
  type ScoreDimension,
} from '@/lib/types';

// ─── 10-Question Diagnostic Framework ────────────────────────────────────────

interface DiagnosticResult {
  pass: boolean;
  title: string;
  detail: string;
  severity: 'high' | 'medium' | 'low';
  dimension: ScoreDimension;
}

function runDiagnostics(brand: CrawlSignals, competitor: CrawlSignals, citations: Citation[]): DiagnosticResult[] {
  const results: DiagnosticResult[] = [];

  // Q1: Is the keyword clear?
  if (!brand.titleHasKeyword) {
    results.push({
      pass: false,
      title: 'Page title lacks product/category keywords',
      detail: 'Title is generic — missing product or category keywords that tell AI engines what the page is about. AI can\'t cite you for a topic your title doesn\'t mention.',
      severity: 'high',
      dimension: 'content_coverage',
    });
  }

  // Q2: Is the title specific?
  if (brand.titleLength < 30) {
    results.push({
      pass: false,
      title: 'Title is too short and vague',
      detail: `Title is only ${brand.titleLength} characters. Specific titles (30-65 chars) with clear value props help AI engines understand and cite your page.`,
      severity: 'medium',
      dimension: 'content_coverage',
    });
  } else if (brand.titleLength > 65) {
    results.push({
      pass: false,
      title: 'Title is too long — gets truncated',
      detail: `Title is ${brand.titleLength} chars — search engines and AI truncate after ~65. The key message may be cut off.`,
      severity: 'low',
      dimension: 'content_coverage',
    });
  }

  // Q3: Does the page answer what users are searching for?
  const brandCited = citations.filter((c) => c.brandCitedCount > 0).length;
  const promptCount = citations.length || 1;
  if (brandCited === 0) {
    results.push({
      pass: false,
      title: 'Not cited in any AI answer',
      detail: 'AI engines answered all tested prompts without mentioning your brand — your content doesn\'t address what buyers are actually asking.',
      severity: 'high',
      dimension: 'share_of_answer',
    });
  } else if (brandCited < promptCount * 0.5) {
    results.push({
      pass: false,
      title: 'Low citation rate across buyer prompts',
      detail: `Only cited in ${brandCited} of ${promptCount} prompts. Your content partially addresses search intent but misses key queries.`,
      severity: 'high',
      dimension: 'share_of_answer',
    });
  }

  // Q4: Is it easy to read?
  if (brand.readabilityScore < 50) {
    results.push({
      pass: false,
      title: 'Content is hard to read and scan',
      detail: `Readability score is ${brand.readabilityScore}/100. Dense, complex writing hurts AI extraction — engines prefer clear, concise sentences they can quote directly.`,
      severity: 'medium',
      dimension: 'content_coverage',
    });
  } else if (brand.avgSentenceLength > 22) {
    results.push({
      pass: false,
      title: 'Sentences are too long for AI extraction',
      detail: `Average sentence is ${brand.avgSentenceLength} words. AI engines extract and quote short sentences (under 20 words). Break up complex sentences into citable chunks.`,
      severity: 'medium',
      dimension: 'content_coverage',
    });
  }

  // Q5: Is it mobile-friendly?
  if (!brand.hasViewportMeta) {
    results.push({
      pass: false,
      title: 'Page is not mobile-responsive',
      detail: 'No viewport meta tag detected. Google and AI engines deprioritize non-responsive pages. Over 60% of queries come from mobile.',
      severity: 'medium',
      dimension: 'freshness_trust',
    });
  }

  // Q6: Does it load fast?
  if (brand.imagesTotal > 20) {
    results.push({
      pass: false,
      title: 'Too many images — likely slow load',
      detail: `${brand.imagesTotal} images detected. Heavy pages load slowly and lose priority in AI citation rankings. Optimize images or lazy-load them.`,
      severity: 'medium',
      dimension: 'freshness_trust',
    });
  }
  if (brand.wordCount < 300 && brand.imagesTotal > 5) {
    results.push({
      pass: false,
      title: 'High image-to-text ratio — thin content',
      detail: `Only ${brand.wordCount} words but ${brand.imagesTotal} images. The page is image-heavy with little extractable text for AI engines to cite.`,
      severity: 'medium',
      dimension: 'content_coverage',
    });
  }

  // Q7: Are there useful internal links?
  if (brand.internalLinkCount < 3) {
    results.push({
      pass: false,
      title: 'Almost no internal links',
      detail: `Only ${brand.internalLinkCount} internal links found. AI engines use link structure to understand topic depth and authority — link to your related content pages.`,
      severity: 'medium',
      dimension: 'freshness_trust',
    });
  } else if (brand.internalLinkCount < 5 && competitor.internalLinkCount > 10) {
    results.push({
      pass: false,
      title: 'Weak internal link structure vs competitor',
      detail: `Your page has ${brand.internalLinkCount} internal links; competitor has ${competitor.internalLinkCount}. A strong link structure signals content depth to AI parsers.`,
      severity: 'low',
      dimension: 'freshness_trust',
    });
  }

  // Q8: Are images named and described properly?
  if (brand.imagesTotal > 0) {
    const altRatio = brand.imagesWithAlt / brand.imagesTotal;
    if (altRatio < 0.5) {
      results.push({
        pass: false,
        title: 'Most images lack alt text',
        detail: `Only ${brand.imagesWithAlt} of ${brand.imagesTotal} images have alt descriptions. Missing alt text hurts accessibility and prevents AI from understanding visual content.`,
        severity: 'medium',
        dimension: 'structured_data',
      });
    } else if (altRatio < 0.8) {
      results.push({
        pass: false,
        title: 'Some images missing alt descriptions',
        detail: `${brand.imagesTotal - brand.imagesWithAlt} images lack alt text. Every image should describe its content for accessibility and AI comprehension.`,
        severity: 'low',
        dimension: 'structured_data',
      });
    }
  }

  // Q9: Is the content better than competitors' pages?
  const competitorWins: string[] = [];
  if (competitor.evidenceCount > brand.evidenceCount + 3) {
    competitorWins.push(`more evidence (${competitor.evidenceCount} vs your ${brand.evidenceCount})`);
  }
  if (competitor.wordCount > brand.wordCount * 1.5) {
    competitorWins.push(`deeper content (${competitor.wordCount} vs your ${brand.wordCount} words)`);
  }
  if (competitor.trustSignals.length > brand.trustSignals.length + 1) {
    competitorWins.push(`more trust signals (${competitor.trustSignals.join(', ')})`);
  }
  if (competitor.internalLinkCount > brand.internalLinkCount * 2) {
    competitorWins.push(`stronger link structure (${competitor.internalLinkCount} vs your ${brand.internalLinkCount} internal links)`);
  }
  if (competitorWins.length >= 2) {
    results.push({
      pass: false,
      title: 'Competitor content is significantly stronger',
      detail: `Competitor outperforms with: ${competitorWins.join('; ')}. AI engines will prefer their page.`,
      severity: 'high',
      dimension: 'evidence_density',
    });
  } else if (competitorWins.length === 1) {
    results.push({
      pass: false,
      title: 'Competitor has a content advantage',
      detail: `Competitor has ${competitorWins[0]}. Close this gap to compete for AI citations.`,
      severity: 'medium',
      dimension: 'evidence_density',
    });
  }

  // Q10: Is it genuinely useful, not just written for Google?
  const usefulChecks: string[] = [];
  if (brand.wordCount < 500) usefulChecks.push('thin content (under 500 words)');
  if (brand.evidenceCount < 3) usefulChecks.push('no concrete evidence or data');
  if (brand.h1Count === 0) usefulChecks.push('no H1 heading — unclear page topic');
  if (brand.h1Count > 1) usefulChecks.push(`${brand.h1Count} H1 headings — confuses topic hierarchy`);
  if (brand.readabilityScore < 55 && brand.wordCount > 100) usefulChecks.push('poor readability makes content hard to use');

  if (usefulChecks.length >= 2) {
    results.push({
      pass: false,
      title: 'Content doesn\'t appear genuinely useful',
      detail: `Multiple quality issues: ${usefulChecks.join('; ')}. AI engines prioritize content that genuinely helps users over pages written for SEO.`,
      severity: 'high',
      dimension: 'content_coverage',
    });
  } else if (usefulChecks.length === 1) {
    results.push({
      pass: false,
      title: 'Content quality concern',
      detail: `Issue detected: ${usefulChecks[0]}. Fix this to improve your chances of AI citation.`,
      severity: 'medium',
      dimension: 'content_coverage',
    });
  }

  // Additional granular checks not tied to the 10 Qs but important for depth:

  // Meta description
  if (brand.metaDescriptionLength === 0) {
    results.push({
      pass: false,
      title: 'No meta description',
      detail: 'Missing meta description. AI engines and search results use this as a summary. Write a compelling 120-160 char description.',
      severity: 'medium',
      dimension: 'content_coverage',
    });
  } else if (brand.metaDescriptionLength < 70) {
    results.push({
      pass: false,
      title: 'Meta description too short',
      detail: `Meta description is only ${brand.metaDescriptionLength} chars. Expand to 120-160 chars with a clear value proposition.`,
      severity: 'low',
      dimension: 'content_coverage',
    });
  }

  // No comparison page
  if (!brand.hasComparisonPage && competitor.hasComparisonPage) {
    results.push({
      pass: false,
      title: 'No comparison page — competitor has one',
      detail: 'Competitor publishes a comparison/versus page. When users ask AI "X vs Y", the competitor controls the narrative because you have no comparison content.',
      severity: 'high',
      dimension: 'content_coverage',
    });
  } else if (!brand.hasComparisonPage) {
    results.push({
      pass: false,
      title: 'No comparison or "vs" content',
      detail: 'No comparison page found. AI engines frequently answer "X vs Y" queries — publish comparison content to control how you\'re positioned.',
      severity: 'medium',
      dimension: 'content_coverage',
    });
  }

  // Pricing clarity
  if (brand.pricingClarity === 'missing') {
    results.push({
      pass: false,
      title: 'No pricing information visible',
      detail: competitor.pricingClarity !== 'missing'
        ? 'No pricing found on your page but competitor shows clear pricing. AI engines can\'t cite your cost details when users ask about pricing.'
        : 'No visible pricing information. Users frequently ask AI about pricing — make yours extractable.',
      severity: 'high',
      dimension: 'content_coverage',
    });
  } else if (brand.pricingClarity === 'partial' && competitor.pricingClarity === 'clear') {
    results.push({
      pass: false,
      title: 'Pricing is vague — competitor shows exact numbers',
      detail: 'Your pricing mentions plans but lacks concrete dollar amounts. Competitor shows exact figures that AI can extract and cite.',
      severity: 'medium',
      dimension: 'content_coverage',
    });
  }

  // Trust signals
  if (brand.trustSignals.length === 0) {
    results.push({
      pass: false,
      title: 'Zero trust signals detected',
      detail: 'No testimonials, case studies, press mentions, security badges, or review scores found. AI engines weigh trust signals heavily when choosing which source to cite.',
      severity: 'high',
      dimension: 'freshness_trust',
    });
  } else if (brand.trustSignals.length < 2) {
    results.push({
      pass: false,
      title: 'Minimal trust signals',
      detail: `Only found: ${brand.trustSignals.join(', ')}. Add more forms of social proof (testimonials, case studies, press, badges, reviews) to build AI confidence.`,
      severity: 'medium',
      dimension: 'freshness_trust',
    });
  }

  // Freshness
  if (!brand.lastUpdated) {
    results.push({
      pass: false,
      title: 'No published or updated date visible',
      detail: 'AI engines can\'t determine when this content was last updated. Undated content is treated as potentially stale and deprioritized.',
      severity: 'medium',
      dimension: 'freshness_trust',
    });
  } else {
    const updated = new Date(brand.lastUpdated);
    const monthsAgo = (Date.now() - updated.getTime()) / (1000 * 60 * 60 * 24 * 30);
    if (monthsAgo > 12) {
      results.push({
        pass: false,
        title: 'Content is over a year old',
        detail: `Last updated ${Math.round(monthsAgo)} months ago. AI engines strongly prefer recent content — update with current data.`,
        severity: 'high',
        dimension: 'freshness_trust',
      });
    } else if (monthsAgo > 6) {
      results.push({
        pass: false,
        title: 'Content is getting stale',
        detail: `Last updated ${Math.round(monthsAgo)} months ago. Refresh with current stats and recent examples to maintain AI citation priority.`,
        severity: 'medium',
        dimension: 'freshness_trust',
      });
    }
  }

  // Structured data
  if (brand.jsonLdTypes.length === 0) {
    results.push({
      pass: false,
      title: 'No structured data (JSON-LD) at all',
      detail: competitor.jsonLdTypes.length > 0
        ? `No JSON-LD schema found. Competitor has: ${competitor.jsonLdTypes.join(', ')}. AI parsers can\'t programmatically extract your content.`
        : 'No JSON-LD schema found. Add Product, Organization, or Article schema so AI parsers can read your page.',
      severity: 'high',
      dimension: 'structured_data',
    });
  } else {
    if (!brand.jsonLdTypes.includes('Product') && !brand.jsonLdTypes.includes('Organization')) {
      results.push({
        pass: false,
        title: 'Missing Product/Organization schema',
        detail: 'No Product or Organization JSON-LD found. AI engines use this to identify what you sell and who you are.',
        severity: 'medium',
        dimension: 'structured_data',
      });
    }
    if (!brand.jsonLdTypes.includes('HowTo') && !brand.jsonLdTypes.includes('Article') && !brand.jsonLdTypes.includes('TechArticle')) {
      results.push({
        pass: false,
        title: 'No content-type schema for AI extraction',
        detail: 'Missing HowTo or Article schema. These help AI engines identify extractable instructional or informational content.',
        severity: 'low',
        dimension: 'structured_data',
      });
    }
  }

  // Evidence density
  if (brand.evidenceCount === 0) {
    results.push({
      pass: false,
      title: 'No stats, numbers, or evidence on the page',
      detail: 'Zero quantifiable data points found — no percentages, dollar amounts, benchmarks, or third-party citations. AI engines need concrete data to cite.',
      severity: 'high',
      dimension: 'evidence_density',
    });
  } else if (brand.evidenceCount < 5) {
    results.push({
      pass: false,
      title: 'Very few citable data points',
      detail: `Only ${brand.evidenceCount} stats/evidence mentions found. Pages with 10+ concrete data points get cited significantly more by AI engines.`,
      severity: 'medium',
      dimension: 'evidence_density',
    });
  }

  // Word count / thin content
  if (brand.wordCount < 200) {
    results.push({
      pass: false,
      title: 'Extremely thin page — almost no text',
      detail: `Only ${brand.wordCount} words. This is too little content for AI engines to extract meaningful answers from. Aim for 500+ words minimum.`,
      severity: 'high',
      dimension: 'content_coverage',
    });
  } else if (brand.wordCount < 500) {
    results.push({
      pass: false,
      title: 'Page content is shallow',
      detail: `Only ${brand.wordCount} words. Competitor likely has deeper coverage. AI engines prefer comprehensive pages they can cite multiple answers from.`,
      severity: 'medium',
      dimension: 'content_coverage',
    });
  }

  // ─── Copywriting Quality Diagnostics ─────────────────────────────────────

  // No CTA — visitors can't act
  if (!brand.hasCtaButton) {
    results.push({
      pass: false,
      title: 'No clear call-to-action on the page',
      detail: 'No CTA button or action link detected (e.g., "Get started", "Try free", "Book a demo"). Without a clear next step, visitors bounce and AI engines see no conversion intent.',
      severity: 'high',
      dimension: 'content_coverage',
    });
  } else if (brand.ctaCount < 2 && brand.wordCount > 500) {
    results.push({
      pass: false,
      title: 'Only one CTA for a long page',
      detail: `Only ${brand.ctaCount} call-to-action on a ${brand.wordCount}-word page. Best practice: repeat your CTA after each major section so readers can act when convinced.`,
      severity: 'low',
      dimension: 'content_coverage',
    });
  }

  // No value proposition in the opening
  if (!brand.hasValueProposition) {
    results.push({
      pass: false,
      title: 'No clear value proposition in the opening',
      detail: 'The first section doesn\'t communicate what the user gets or how their life improves. Lead with a benefit statement (e.g., "Save X hours", "Without Y hassle") — AI engines and humans both need to understand value in seconds.',
      severity: 'high',
      dimension: 'content_coverage',
    });
  }

  // No power words / urgency language
  if (!brand.hasPowerWords) {
    results.push({
      pass: false,
      title: 'Copy lacks persuasive language',
      detail: 'No benefit-driven or urgency words detected (free, proven, instant, guaranteed, effortless). The copy reads flat — it doesn\'t motivate action or differentiate from generic competitor pages.',
      severity: 'medium',
      dimension: 'content_coverage',
    });
  }

  // Poor scanability — no bullet lists
  if (brand.bulletListCount === 0 && brand.wordCount > 300) {
    results.push({
      pass: false,
      title: 'No bullet lists — poor scanability',
      detail: 'Zero bullet or numbered lists on a page with 300+ words. Most visitors scan rather than read — break key points into bullets for faster comprehension and AI extraction.',
      severity: 'medium',
      dimension: 'content_coverage',
    });
  }

  // Weak heading structure
  if (!brand.hasSubheadingHierarchy && brand.wordCount > 400) {
    results.push({
      pass: false,
      title: 'No heading hierarchy — wall of text',
      detail: 'Missing proper H1 → H2 → H3 structure. Without subheadings, the page reads as a wall of text. Headings help both readers and AI parsers navigate and extract specific answers.',
      severity: 'medium',
      dimension: 'structured_data',
    });
  }

  if (brand.headingCount < 3 && brand.wordCount > 500) {
    results.push({
      pass: false,
      title: 'Too few headings for the content length',
      detail: `Only ${brand.headingCount} headings for ${brand.wordCount} words. Add a subheading every 150-200 words to improve scanability and AI extraction.`,
      severity: 'low',
      dimension: 'structured_data',
    });
  }

  // High passive voice — weak, indirect copy
  if (brand.passiveVoiceRatio > 0.2) {
    results.push({
      pass: false,
      title: 'Too much passive voice — copy lacks directness',
      detail: `${Math.round(brand.passiveVoiceRatio * 100)}% of sentences use passive voice. Active voice ("We help you X" not "You are helped by X") is more persuasive, clearer, and easier for AI to extract as a direct answer.`,
      severity: 'medium',
      dimension: 'content_coverage',
    });
  }

  // Low vocabulary diversity — repetitive copy
  if (brand.uniqueWordRatio < 0.35 && brand.wordCount > 200) {
    results.push({
      pass: false,
      title: 'Repetitive vocabulary — low word diversity',
      detail: `Unique word ratio is only ${Math.round(brand.uniqueWordRatio * 100)}%. The copy reuses the same words excessively. Varied vocabulary signals depth and expertise to AI engines.`,
      severity: 'low',
      dimension: 'content_coverage',
    });
  }

  // No numbers in headings — generic headlines
  if (!brand.hasNumbersInHeadings && brand.headingCount > 2) {
    results.push({
      pass: false,
      title: 'Headlines lack specificity — no numbers or data',
      detail: 'No headings contain specific numbers (e.g., "3x faster", "5 ways to...", "10,000+ customers"). Numbered headlines increase click-through and signal concrete value to AI engines.',
      severity: 'low',
      dimension: 'evidence_density',
    });
  }

  // Long paragraphs — hard to scan
  if (brand.paragraphAvgLength > 4) {
    results.push({
      pass: false,
      title: 'Paragraphs are too long — readers skip them',
      detail: `Average paragraph is ${brand.paragraphAvgLength} sentences. Web readers skip paragraphs longer than 3 sentences. Break them up for better engagement and AI extractability.`,
      severity: 'medium',
      dimension: 'content_coverage',
    });
  }

  // No social proof near CTA
  if (brand.hasCtaButton && !brand.hasSocialProofNearCta) {
    results.push({
      pass: false,
      title: 'CTA has no supporting social proof',
      detail: 'Your call-to-action exists but isn\'t backed by nearby trust indicators (user counts, ratings, testimonials). Adding "Trusted by X teams" or a star rating near the CTA increases conversion and signals authority to AI.',
      severity: 'low',
      dimension: 'freshness_trust',
    });
  }

  // ─── AI-Readiness Diagnostics (5 extra questions) ────────────────────────

  // Q11: Does the page give a direct answer near the top?
  if (!brand.hasDirectAnswerNearTop) {
    results.push({
      pass: false,
      title: 'No direct answer near the top of the page',
      detail: 'The opening section lacks a concrete, factual statement AI can extract (e.g., "Our delivery time is 2–4 working days"). AI engines cite the first direct answer they find — if yours is buried, the competitor gets cited instead.',
      severity: 'high',
      dimension: 'share_of_answer',
    });
  }

  // Q12: Does the page include specific facts?
  if (!brand.hasSpecificFacts) {
    results.push({
      pass: false,
      title: 'Page lacks specific facts AI can cite',
      detail: 'No concrete specifics found — prices, comparison tables, dated information, numbered steps, or product specs. AI engines need extractable facts, not vague marketing prose.',
      severity: 'high',
      dimension: 'evidence_density',
    });
  }

  // Q13: Is the content original?
  if (brand.contentOriginalityScore < 40) {
    results.push({
      pass: false,
      title: 'Content looks generic — low originality',
      detail: `Originality score: ${brand.contentOriginalityScore}/100. The page uses generic listicle patterns ("Top 10...", "Ultimate guide...") without original data, comparisons, or first-hand analysis. AI engines skip generic content in favor of original research and expert insights.`,
      severity: 'high',
      dimension: 'content_coverage',
    });
  } else if (brand.contentOriginalityScore < 60) {
    results.push({
      pass: false,
      title: 'Content could be more original',
      detail: `Originality score: ${brand.contentOriginalityScore}/100. Add original comparisons, proprietary data, case studies, or expert analysis to differentiate from the hundreds of generic pages AI already has in its training data.`,
      severity: 'medium',
      dimension: 'content_coverage',
    });
  }

  // Q14: Is the site crawlable by AI/search bots?
  if (!brand.isCrawlableByAi) {
    results.push({
      pass: false,
      title: 'Page blocks AI crawlers (noindex detected)',
      detail: 'A robots meta tag with "noindex" was found. This prevents AI search bots (including ChatGPT\'s OAI-SearchBot, Google, and Perplexity) from indexing and citing your content. Remove noindex if you want AI visibility.',
      severity: 'high',
      dimension: 'share_of_answer',
    });
  }

  // Q15: Is the brand/entity clear?
  if (!brand.isBrandEntityClear) {
    results.push({
      pass: false,
      title: 'Brand identity is unclear to AI',
      detail: 'AI cannot easily determine who you are, what you sell, where you operate, or why you\'re trustworthy. Make your brand name, product category, target market, and credentials explicit in the first section of the page.',
      severity: 'high',
      dimension: 'freshness_trust',
    });
  }

  return results;
}

// ─── Dimension Scoring ───────────────────────────────────────────────────────

function shareOfAnswer(citations: Citation[]): DimensionScore {
  const max = DIMENSION_MAX.share_of_answer;
  const promptCount = citations.length || 1;
  const brandCitedPrompts = citations.filter((c) => c.brandCitedCount > 0).length;
  const competitorCitedPrompts = citations.filter((c) => c.competitorCitedCount > 0).length;
  const score = Math.round((brandCitedPrompts / promptCount) * max);
  const reasons: string[] = [
    `Cited in ${brandCitedPrompts} of ${promptCount} prompts; competitor cited in ${competitorCitedPrompts} of ${promptCount}.`,
  ];
  return { dimension: 'share_of_answer', score, max, reasons };
}

function contentCoverage(brand: CrawlSignals, competitor: CrawlSignals): DimensionScore {
  const max = DIMENSION_MAX.content_coverage;
  const reasons: string[] = [];
  let score = max;

  // Comparison page presence (no FAQ penalty)
  if (!brand.hasComparisonPage) {
    score -= 5;
    reasons.push(
      competitor.hasComparisonPage
        ? 'No comparison page found; competitor publishes one.'
        : 'No comparison page found.',
    );
  }

  // Pricing clarity
  if (brand.pricingClarity === 'missing') {
    score -= 5;
    reasons.push('No visible pricing information.');
  } else if (brand.pricingClarity === 'partial' && competitor.pricingClarity === 'clear') {
    score -= 3;
    reasons.push('Pricing info is vague; competitor shows exact numbers.');
  }

  // Content depth
  if (brand.wordCount < 300) {
    score -= 5;
    reasons.push(`Very thin content (${brand.wordCount} words).`);
  } else if (brand.wordCount < 500) {
    score -= 3;
    reasons.push(`Shallow content (${brand.wordCount} words).`);
  }

  // Title and keyword
  if (!brand.titleHasKeyword) {
    score -= 3;
    reasons.push('Title lacks product/category keywords.');
  }

  // Readability
  if (brand.readabilityScore < 50) {
    score -= 2;
    reasons.push(`Poor readability (score: ${brand.readabilityScore}/100).`);
  }

  if (reasons.length === 0) reasons.push('Strong answer-ready content present.');
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
        ? `No JSON-LD detected; competitor ships ${competitor.jsonLdTypes.join(', ')}.`
        : 'No JSON-LD detected on key pages.',
    );
  } else {
    const hasProduct = brand.jsonLdTypes.includes('Product');
    const hasOrg = brand.jsonLdTypes.includes('Organization');
    const hasHowTo = brand.jsonLdTypes.includes('HowTo');
    const hasArticle = brand.jsonLdTypes.includes('Article') || brand.jsonLdTypes.includes('TechArticle');

    if (!hasProduct && !hasOrg) {
      score -= 5;
      reasons.push('Missing Product or Organization schema.');
    }
    if (!hasHowTo && !hasArticle) {
      score -= 5;
      reasons.push('No content-type schema (HowTo or Article).');
    }
    if (competitor.jsonLdTypes.length > brand.jsonLdTypes.length + 2) {
      score -= 3;
      reasons.push(`Competitor has richer structured data (${competitor.jsonLdTypes.length} types vs ${brand.jsonLdTypes.length}).`);
    }
    if (reasons.length === 0) reasons.push(`Good structured data: ${brand.jsonLdTypes.join(', ')}.`);
  }

  // Image alt text
  if (brand.imagesTotal > 0 && brand.imagesWithAlt / brand.imagesTotal < 0.5) {
    score -= 2;
    reasons.push(`${brand.imagesTotal - brand.imagesWithAlt} images lack alt text.`);
  }

  return { dimension: 'structured_data', score: Math.max(0, score), max, reasons };
}

function evidenceDensity(brand: CrawlSignals, competitor: CrawlSignals): DimensionScore {
  const max = DIMENSION_MAX.evidence_density;
  const ratio = competitor.evidenceCount === 0 ? 1 : brand.evidenceCount / competitor.evidenceCount;
  const score = Math.round(Math.min(1, ratio) * max);
  const reasons: string[] = [];

  if (brand.evidenceCount === 0) {
    reasons.push('Zero evidence points found.');
  } else if (brand.evidenceCount < 5) {
    reasons.push(`Only ${brand.evidenceCount} evidence points.`);
  } else if (ratio < 0.5) {
    reasons.push(`Brand: ${brand.evidenceCount} evidence points vs competitor: ${competitor.evidenceCount}.`);
  } else {
    reasons.push(`${brand.evidenceCount} evidence mentions; competitor has ${competitor.evidenceCount}.`);
  }

  return { dimension: 'evidence_density', score, max, reasons };
}

function freshnessTrust(brand: CrawlSignals, competitor: CrawlSignals): DimensionScore {
  const max = DIMENSION_MAX.freshness_trust;
  const reasons: string[] = [];
  let score = max;

  if (!brand.lastUpdated) {
    score -= 4;
    reasons.push('No visible date.');
  } else {
    const updated = new Date(brand.lastUpdated);
    const monthsAgo = (Date.now() - updated.getTime()) / (1000 * 60 * 60 * 24 * 30);
    if (monthsAgo > 6) {
      score -= 3;
      reasons.push(`Content ${Math.round(monthsAgo)} months old.`);
    }
  }

  if (brand.trustSignals.length === 0) {
    score -= 4;
    reasons.push('No trust signals.');
  } else if (brand.trustSignals.length < 2) {
    score -= 2;
    reasons.push(`Only 1 trust signal (${brand.trustSignals[0]}).`);
  }

  if (competitor.trustSignals.length > brand.trustSignals.length + 1) {
    score -= 2;
    reasons.push(`Competitor has stronger trust: ${competitor.trustSignals.join(', ')}.`);
  }

  if (!brand.hasViewportMeta) {
    score -= 1;
    reasons.push('Not mobile-responsive.');
  }

  if (brand.internalLinkCount < 3) {
    score -= 1;
    reasons.push(`Only ${brand.internalLinkCount} internal links.`);
  }

  if (reasons.length === 0) reasons.push('Fresh content with strong trust signals.');
  return { dimension: 'freshness_trust', score: Math.max(0, score), max, reasons };
}

// ─── Issue Generation (NO cap — all failing diagnostics become issues) ───────

function severityRank(s: 'high' | 'medium' | 'low'): number {
  return s === 'high' ? 0 : s === 'medium' ? 1 : 2;
}

function buildIssues(diagnostics: DiagnosticResult[]): Issue[] {
  // Every failing diagnostic becomes an issue — no limit
  const failing = diagnostics.filter((d) => !d.pass);

  // Sort by severity (high first), then by dimension priority
  const dimOrder: ScoreDimension[] = [
    'share_of_answer',
    'content_coverage',
    'structured_data',
    'evidence_density',
    'freshness_trust',
  ];

  failing.sort((a, b) => {
    const sevDiff = severityRank(a.severity) - severityRank(b.severity);
    if (sevDiff !== 0) return sevDiff;
    return dimOrder.indexOf(a.dimension) - dimOrder.indexOf(b.dimension);
  });

  return failing.map((d) => ({
    title: d.title,
    severity: d.severity,
    dimension: d.dimension,
    why: d.detail,
  }));
}

// ─── Main Export ─────────────────────────────────────────────────────────────

export async function scoringEngine(
  brand: CrawlSignals,
  competitor: CrawlSignals,
  citations: Citation[],
  verbosity: 'concise' | 'detailed' = 'concise',
): Promise<{ score: number; breakdown: ScoreBreakdown; issues: Issue[] }> {
  // Run the 10-question diagnostic framework
  const diagnostics = runDiagnostics(brand, competitor, citations);

  const dimensions: DimensionScore[] = [
    shareOfAnswer(citations),
    contentCoverage(brand, competitor),
    structuredData(brand, competitor),
    evidenceDensity(brand, competitor),
    freshnessTrust(brand, competitor),
  ];
  const total = dimensions.reduce((sum, d) => sum + d.score, 0);

  // All diagnostics produce issues — no cap regardless of verbosity
  const issues = buildIssues(diagnostics);

  return {
    score: total,
    breakdown: { total, dimensions },
    issues,
  };
}
