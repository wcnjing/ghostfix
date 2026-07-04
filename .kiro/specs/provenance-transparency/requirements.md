# Requirements Document

## Introduction

The analysis pipeline now tags every data point with a provenance value — `measured` (real API/crawl observation), `estimated` (LLM guess), or `unavailable` (could not be collected) — and excludes unavailable dimensions from the score denominator (`availableMax`). The dashboard, however, still renders all numbers identically, so users cannot tell a measured citation rate from an estimated one, and a score of 9/40 (four dimensions unavailable) looks like a score out of 100. This feature surfaces provenance in the UI so users can calibrate trust in what they see.

## Glossary

- **Provenance**: The `'measured' | 'estimated' | 'unavailable'` tag carried by Citation, DimensionScore, and DiscoveredCompetitor values in `src/lib/types.ts`
- **Dashboard**: The Diagnosis step UI rendered by `page.tsx` after `/api/analyze` completes
- **Estimated_Badge**: A small visual label ("est.") rendered next to any number whose provenance is `estimated`
- **Data_Quality_Notice**: A dismissible callout listing what could not be measured in the current analysis and why
- **Available_Max**: The `scoreBreakdown.availableMax` field — the sum of dimension maxima that were actually scored

## Requirements

### Requirement 1: Label Estimated Values

**User Story:** As a brand owner, I want to see which numbers are estimates rather than measurements, so that I can decide how much weight to give them.

#### Acceptance Criteria

1. WHEN a Citation has provenance `estimated`, THE Dashboard SHALL render an Estimated_Badge adjacent to that prompt's citation result.
2. WHEN a DimensionScore has provenance `estimated`, THE Dashboard SHALL render an Estimated_Badge adjacent to that dimension's score in the breakdown.
3. WHEN a DiscoveredCompetitor has provenance `estimated`, THE Dashboard SHALL render an Estimated_Badge adjacent to that competitor's citation count in the leaderboard.
4. THE Dashboard SHALL NOT render any badge for values whose provenance is `measured`.

### Requirement 2: Report the Honest Score Denominator

**User Story:** As a brand owner, I want the score shown out of the points that were actually measurable, so that an uncrawlable site is not presented as scoring 9 out of 100.

#### Acceptance Criteria

1. THE Dashboard SHALL display the overall score as `total`/`availableMax` wherever a score denominator appears.
2. WHEN `availableMax` is less than the full rubric total, THE Dashboard SHALL indicate how many dimensions were excluded (e.g. "4 of 5 dimensions could not be measured").
3. WHEN a DimensionScore has provenance `unavailable`, THE Dashboard SHALL render "not measured" in place of a numeric score for that dimension and SHALL NOT render a progress bar fill for it.

### Requirement 3: Explain Missing Data

**User Story:** As a brand owner, I want to know why parts of my analysis are missing, so that I can fix the cause (e.g. my site blocks crawlers) instead of distrusting the tool.

#### Acceptance Criteria

1. WHEN any Citation or DimensionScore in the AnalysisResult has provenance `unavailable`, THE Dashboard SHALL render exactly one Data_Quality_Notice above the results.
2. THE Data_Quality_Notice SHALL state each distinct cause at most once, covering: brand site not crawlable, competitor site not crawlable, and answer-engine data unavailable.
3. WHEN every Citation has provenance `estimated`, THE Data_Quality_Notice SHALL state that answer-engine numbers are LLM estimates and name the configuration (PERPLEXITY_API_KEY) that enables measured data.
4. IF all values in the AnalysisResult have provenance `measured`, THEN THE Dashboard SHALL NOT render a Data_Quality_Notice.

### Requirement 4: Provenance in the Executive Summary

**User Story:** As an API consumer, I want the executive summary to reflect data quality, so that downstream consumers of the summary string are not misled.

#### Acceptance Criteria

1. WHEN the analysis contains any `estimated` citation data, THE Pipeline SHALL append " (estimated)" after the score in the `summary` field.
2. WHEN `availableMax` is less than the full rubric total, THE Pipeline SHALL express the score in the `summary` field as `score`/`availableMax` rather than out of 100.
