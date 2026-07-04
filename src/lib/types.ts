// Shared type contracts for the Ghostfix pipeline.
// Locked before implementation so stubs and real integrations stay interchangeable.
// Derived from brief §6 (data model) and §7 (rubric).

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
}

export interface ScoreBreakdown {
  total: number;
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
  brandCitedCount: number;
  competitorCitedCount: number;
  brandFrequency: number;
  competitorFrequency: number;
  sources: CitationSource[];
  engine: CitationEngine;
}

export type IssueSeverity = 'high' | 'medium' | 'low';

export interface Issue {
  title: string;
  severity: IssueSeverity;
  dimension: ScoreDimension;
  why: string;
}

export interface DiscoveredCompetitor {
  domain: string;
  url: string;
  citationCount: number;       // how many of the discovered prompts cited this domain
  promptCount: number;         // out of how many prompts
  sampleTitle?: string;
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
  /** Crawl signals for brand and competitor sites. */
  crawlSignals?: { brand: Partial<CrawlSignals>; competitor: Partial<CrawlSignals> };
}

export type FixType = 'faq' | 'comparison_page' | 'schema' | 'evidence_stats' | 'trust_signals' | 'freshness_update' | 'answer_content';

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
  hasFaq: boolean;
  hasComparisonPage: boolean;
  pricingClarity: PricingClarity;
  jsonLdTypes: string[];
  evidenceCount: number;
  lastUpdated: string | null;
  trustSignals: string[];
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
