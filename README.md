# Ghostfix

Explainable AI-visibility (GEO/AEO) diagnosis and repair. Hackathon MVP.

## Status

Build-order **steps 1 & 2** complete: Next.js + TS + Tailwind v4 scaffold, Supabase schema, locked type contracts, and the four pipeline functions stubbed with realistic typed mock data. Steps 3+ (real Perplexity / Firecrawl / Anthropic / Supabase wiring, input form, dashboard, export) are deliberately not started.

## Setup

```sh
pnpm install
cp .env.local.example .env.local   # fill in when wiring real integrations
pnpm dev                            # http://localhost:3000
```

Run the Supabase schema once against your project:

```sh
psql "$SUPABASE_URL" -f supabase/schema.sql
# or paste supabase/schema.sql into the Supabase SQL editor
```

## Pipeline shape

```
POST /api/analyze   →  crawler(brand) ∥ crawler(competitor) ∥ answerCollector()
                       → scoringEngine()
                       → AnalysisResult

POST /api/repair    →  repairAgent(analysis) → Fix[]
```

All four pipeline functions live in `src/lib/pipeline/` and currently return mock data shaped exactly like the real return types in `src/lib/types.ts`. Swapping a stub for a real implementation is a body-only change.

## Smoke test the stubs

```sh
curl -X POST http://localhost:3000/api/analyze \
  -H 'content-type: application/json' \
  -d '{"brandUrl":"https://acme.com","competitorUrl":"https://globex.com","prompts":["best crm for smb","cheapest crm"]}'
```
