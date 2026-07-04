# Product: GhostFix

GhostFix is a B2B tool that measures and repairs a brand's AI visibility ("SEO for AI" / GEO). Buyers increasingly ask ChatGPT, Gemini, and Perplexity what to buy instead of scrolling search results — and even Google now answers with AI Overviews. If AI engines don't name or cite a brand, it is invisible in the channel replacing traditional search.

## What it does

1. **Research** — from a single brand URL, discover the product category, the questions buyers actually ask AI engines, and the competitors AI consistently surfaces.
2. **Measure** — run those prompts against live answer engines (Perplexity Sonar) and record who gets named and cited: the brand or its rivals. Crawl both sites for on-page signals.
3. **Explain** — score the brand on a transparent 100-point rubric (answer share 40, content coverage 20, structured data 15, evidence density 15, freshness/trust 10), enriched by a 10-question diagnostic (titles, readability, links, mobile, AI-crawlability, copywriting quality). Every point lost has a stated reason.
4. **Repair** — turn each diagnosed gap into a generated fix: comparison pages, answer-ready content, stats/proof pages, trust-signal content, JSON-LD schema.
5. **Ship** — open a review-gated pull request with the fixes on the user's own GitHub repository, on the branch they choose. Nothing merges without human review.

## Product principles

- **Honesty over polish**: every number carries provenance — `measured` (real API/crawl observation), `estimated` (LLM guess, always labelled), or `unavailable` (excluded from the score, never faked). If a site can't be crawled, we say so instead of inventing signals.
- **Evidence, not vibes**: findings quote what the AI engines actually said and which sources they cited.
- **Concrete over comprehensive**: issues state what to do, where it goes, and what it recovers — not generic advice.
- **Review-gated shipping**: GhostFix drafts and proposes; humans approve and merge.

## Users

Marketing/growth owners and founders at B2B companies who suspect AI engines recommend competitors first, and developers who want the fix delivered as a PR instead of a PDF.
