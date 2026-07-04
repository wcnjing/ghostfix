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
  provenance: Provenance;
}

export interface ScoreBreakdown {
  total: number;
  // Sum of `max` across dimensions we could actually score. The headline
  // score is reported as total/availableMax, never padded with fake data.
  availableMax: number;
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

export type FixType = 'faq' | 'comparison_page' | 'schema';

export interface Issue {
  title: string;
  severity: IssueSeverity;
  dimension: ScoreDimension;
  why: string;
  // Concrete next step: what to do, where it goes, and roughly how many
  // rubric points closing it recovers.
  action: string;
  where: string;
  estPointGain: number;
  fixType?: FixType;
}

export interface DiscoveredCompetitor {
  domain: string;
  url: string;
  citationCount: number;       // how many of the discovered prompts cited this domain
  promptCount: number;         // out of how many prompts
  sampleTitle?: string;
  provenance: Provenance;      // measured = real engine citations, estimated = LLM guess
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
  // Raw crawl signals for both sides — the dashboard shows what we actually
  // saw, and the repair agent seeds drafts with the brand's real content.
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
  // False when we couldn't fetch any HTML. Downstream scoring treats every
  // page-derived dimension as unavailable instead of inventing values.
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
}

export interface AnalyzeRequest {
  brandUrl: string;
  // Both optional now: when omitted, the pipeline auto-discovers via research.ts.
  competitorUrl?: string;
  prompts?: string[];
  // Optional hint to nudge discovery (e.g. "B2B SaaS for design teams").
  hint?: string;
}

export interface RepairRequest {
  analysis: AnalysisResult;
}
