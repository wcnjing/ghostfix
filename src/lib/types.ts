// Shared type contracts for the Ghostfix pipeline.
// Locked before implementation so stubs and real integrations stay interchangeable.
// Derived from brief §6 (data model) and §7 (rubric).

// Where a number came from. 'measured' = real API/crawl observation,
// 'estimated' = LLM guess (shown with a label, never as a bare number),
// 'unavailable' = we couldn't get it — excluded from scoring, never faked.
export type Provenance = 'measured' | 'estimated' | 'unavailable';

export type ScoreDimension =
  | 'share_of_answer'
  | 'content_coverage'
  | 'structured_data'
  | 'evidence_density'
  | 'freshness_trust';

export const DIMENSION_MAX: Record<ScoreDimension, number> = {
  share_of_answer: 40,
  content_coverage: 20,
  structured_data: 15,
  evidence_density: 15,
  freshness_trust: 10,
};

export interface DimensionScore {
  dimension: ScoreDimension;
  score: number;
  max: number;
  reasons: string[];
  provenance?: Provenance;
}

export interface ScoreBreakdown {
  total: number;
  // Sum of `max` across dimensions we could actually score. When a site can't
  // be crawled the page-derived dimensions are excluded rather than zeroed.
  availableMax?: number;
  dimensions: DimensionScore[];
}

export interface CitationSource {
  domain: string;
  url: string;
  title?: string;
}

export type CitationEngine = 'perplexity' | 'gemini';

export interface Citation {
  prompt: string;
  runs: number;
  // Citation-link hits: the domain appeared in the engine's source list.
  brandCitedCount: number;
  competitorCitedCount: number;
  // Text mentions: the brand/competitor was named in the answer itself,
  // regardless of whether its domain was cited as a source.
  brandMentionedCount: number;
  competitorMentionedCount: number;
  // Frequency of mention-or-citation across runs (0..1).
  brandFrequency: number;
  competitorFrequency: number;
  // A short excerpt of what the engine actually answered, for evidence.
  answerSnippet?: string;
  sources: CitationSource[];
  engine: CitationEngine;
  provenance: Provenance;
}

export type IssueSeverity = 'high' | 'medium' | 'low';

export type FixType = 'faq' | 'comparison_page' | 'schema' | 'evidence_stats' | 'trust_signals' | 'freshness_update' | 'answer_content';

export interface Issue {
  title: string;
  severity: IssueSeverity;
  dimension: ScoreDimension;
  why: string;
  // Optional concrete next step: what to do, where it goes, and roughly how
  // many rubric points closing it recovers.
  action?: string;
  where?: string;
  estPointGain?: number;
  fixType?: FixType;
}

export interface DiscoveredCompetitor {
  domain: string;
  url: string;
  citationCount: number;       // how many of the discovered prompts cited this domain
  promptCount: number;         // out of how many prompts
  sampleTitle?: string;
  provenance?: Provenance;     // measured = real engine citations, estimated = LLM guess
}

export interface ResearchFindings {
  brandSummary: string;        // 1-2 sentence description of what the brand does
  category: string;            // e.g. "B2B project management software"
  discoveredPrompts: string[]; // prompts derived from the brand's category
  discoveredCompetitors: DiscoveredCompetitor[];
  selectedCompetitorDomain: string; // which one we deep-dove against
  narrative: string;           // markdown report of findings
  source: 'auto' | 'manual';   // auto = we discovered, manual = user provided
}

export interface AnalysisResult {
  id: string;
  brandUrl: string;
  competitorUrl: string;
  prompts: string[];
  score: number;
  scoreBreakdown: ScoreBreakdown;
  citations: Citation[];
  issues: Issue[];
  createdAt: string;
  research?: ResearchFindings;
  /** Executive summary: 1-3 sentences, max 280 chars. Present in concise mode. */
  summary?: string;
  /** Crawl signals for brand and competitor sites (verbosity-filtered copy). */
  crawlSignals?: { brand: Partial<CrawlSignals>; competitor: Partial<CrawlSignals> };
  /** Raw crawl signals for both sides — used by the repair agent to seed drafts. */
  signals?: { brand: CrawlSignals; competitor: CrawlSignals };
}

export interface Fix {
  id: string;
  analysisId: string;
  type: FixType;
  content: string;
  createdAt: string;
}

export type PricingClarity = 'clear' | 'partial' | 'missing';

export interface CrawlSignals {
  url: string;
  // False when we couldn't fetch any HTML. Downstream scoring treats
  // page-derived dimensions as unavailable instead of inventing values.
  fetched: boolean;
  // Every URL we actually parsed (homepage + discovered FAQ/pricing/compare pages).
  pagesCrawled: string[];
  hasFaq: boolean;
  hasComparisonPage: boolean;
  pricingClarity: PricingClarity;
  jsonLdTypes: string[];
  evidenceCount: number;
  lastUpdated: string | null;
  trustSignals: string[];
  // Plain-text sample of the homepage, used to seed repair drafts with real
  // facts instead of placeholders. Never shown raw in the UI.
  textSample?: string;
  // Extended diagnostic signals (10-question framework)
  titleLength: number;
  titleHasKeyword: boolean;
  metaDescriptionLength: number;
  h1Count: number;
  h1Text: string;
  readabilityScore: number;       // 0-100, based on sentence/word complexity
  hasViewportMeta: boolean;       // proxy for mobile-friendliness
  internalLinkCount: number;
  externalLinkCount: number;
  imagesTotal: number;
  imagesWithAlt: number;
  wordCount: number;
  avgSentenceLength: number;
  // Copywriting quality signals
  hasCtaButton: boolean;          // clear call-to-action button detected
  ctaCount: number;               // number of CTAs on page
  hasSocialProofNearCta: boolean; // testimonials/badges near action areas
  headingCount: number;           // total number of headings (H1-H6)
  hasSubheadingHierarchy: boolean;// proper H1 → H2 → H3 structure
  bulletListCount: number;        // number of <ul>/<ol> lists (scanability)
  hasPowerWords: boolean;         // presence of urgency/benefit-driven language
  hasValueProposition: boolean;   // clear "what you get" statement in first viewport
  uniqueWordRatio: number;        // vocabulary diversity (0-1)
  passiveVoiceRatio: number;      // percentage of passive constructions (0-1)
  hasNumbersInHeadings: boolean;  // specificity signal in headlines
  paragraphAvgLength: number;     // avg sentences per paragraph
  // AI-readiness signals (5 extra diagnostic questions)
  hasDirectAnswerNearTop: boolean;  // direct factual answer in first 300 chars
  hasSpecificFacts: boolean;        // prices, dates, steps, specs, comparisons
  contentOriginalityScore: number;  // 0-100, penalizes generic listicle patterns
  isCrawlableByAi: boolean;        // no blocking of AI bots detected
  isBrandEntityClear: boolean;     // clear who/what/where/why on the page
}

export type Verbosity = 'concise' | 'detailed';

export interface AnalyzeRequest {
  brandUrl: string;
  // Both optional now: when omitted, the pipeline auto-discovers via research.ts.
  competitorUrl?: string;
  prompts?: string[];
  // Optional hint to nudge discovery (e.g. "B2B SaaS for design teams").
  hint?: string;
  // Optional verbosity level: "concise" (default) applies refinement constraints,
  // "detailed" returns raw unfiltered output.
  verbosity?: string;
}

export interface RepairRequest {
  analysis: AnalysisResult;
}
