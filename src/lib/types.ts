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
}

export type FixType = 'faq' | 'comparison_page' | 'schema';

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
}

export interface AnalyzeRequest {
  brandUrl: string;
  competitorUrl: string;
  prompts: string[];
}

export interface RepairRequest {
  analysis: AnalysisResult;
}
