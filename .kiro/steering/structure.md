# Repository Structure

```
src/
  app/
    page.tsx                  # Entire UI: stepped wizard (Connect → Input → Diagnosis → Repair → Ship)
    api/
      analyze/route.ts        # POST: research/manual analysis → AnalysisResult (verbosity-aware)
      repair/route.ts         # POST: analysis → generated Fix[] drafts
      publish/route.ts        # POST: open review-gated GitHub PR with fixes
      auth/github/…           # OAuth begin/callback/logout
      github/…                # me/repos endpoints for the connected user
  lib/
    types.ts                  # Locked shared contracts (AnalysisResult, CrawlSignals, Citation, Issue, Fix…)
    config.ts                 # Env-backed tuning (timeouts, run counts, models, user agent)
    llm.ts                    # Shared Groq→Gemini LLM chain with failure logging
    validation.ts             # URL/prompt normalizers used by API routes
    supabase.ts               # Optional persistence (analyses, fixes)
    github.ts / github-oauth.ts / github-session.ts   # PR publishing + OAuth session
    pipeline/
      research.ts             # Category summary, buyer-prompt discovery, competitor discovery, narrative
      crawler.ts              # Multi-page crawl (homepage + discovered /faq, /pricing, /vs) → CrawlSignals
      answerCollector.ts      # Perplexity runs per prompt → citations, text mentions, snippets, provenance
      scoringEngine.ts        # 5-dimension rubric + 10-question diagnostics → score, breakdown, issues
      repairAgent.ts          # Issue-driven fix selection → Claude/Groq drafts (comparison, schema, stats…)
supabase/schema.sql           # analyses + fixes tables
public/demo-sites/            # weak/strong fixture landing pages for end-to-end testing
.kiro/                        # Specs and steering (this folder is committed — judging evidence)
```

## Pipeline flow

```
POST /api/analyze
  research.discover(brandUrl)          # research mode only: prompts + competitors
  ├─ crawler(brandUrl)                 # parallel
  ├─ crawler(competitorUrl)            # parallel
  └─ answerCollector(prompts, …)       # parallel
  → scoringEngine(brand, competitor, citations, verbosity)
  → synthesizeFindings(…)              # research mode narrative
  → AnalysisResult (+ executive summary, provenance-tagged)

POST /api/repair   → repairAgent(analysis) → Fix[]   (only fix types the issues call for)
POST /api/publish  → publishToGithub(target, analysis, fixes) → { prUrl, branch }
```

## Rules of the repo

- The four pipeline stages are body-swappable: keep signatures and `types.ts` contracts stable.
- `page.tsx` is intentionally a single file for hackathon velocity; sections are ordered by wizard step.
- `public/demo-sites/` fixtures must stay in sync with what the crawler detects (FAQ headings, JSON-LD, pricing text) — they are the offline test bed.
