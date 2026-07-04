# Tech Stack & Conventions

## Stack

- **TypeScript** end to end, strict mode. **Next.js 15** (App Router, serverless API routes) with **React 19** and **Tailwind CSS v4**.
- **Package manager**: pnpm (`pnpm install`, `pnpm dev`, `pnpm build`, `pnpm typecheck`).
- **HTML parsing**: cheerio (crawler signal extraction).
- **Persistence**: Supabase (Postgres) via `@supabase/supabase-js`; no-ops gracefully when env keys are missing.
- **GitHub publishing**: `@octokit/rest` with GitHub OAuth (user flow) or an operator token (env flow).

## AI providers

- **Perplexity Sonar** (`PERPLEXITY_API_KEY`) — the only source of *measured* answer-engine citations. Without it, citation data is LLM-estimated and labelled `estimated`.
- **Anthropic Claude** (`ANTHROPIC_API_KEY`, default `claude-sonnet-4-6`) — highest-quality repair draft generation.
- **Groq** (`GROQ_API_KEY`, Llama 3.3 70B) — primary free-tier LLM for research, prompt discovery, and estimation. **Gemini** (`GEMINI_API_KEY`) is the fallback. The shared chain lives in `src/lib/llm.ts` (`generateJson` / `generateText`); it logs one console error per provider+status on failure — never swallow API errors silently.

## Conventions

- All configuration and tuning knobs go through `src/lib/config.ts` (env-var backed, clamped). No magic numbers in pipeline code.
- Shared type contracts live in `src/lib/types.ts` and are locked before implementation — pipeline stages are interchangeable behind those types.
- Every pipeline output that reaches the UI must carry `Provenance` (`measured` / `estimated` / `unavailable`). New data sources must never present guesses as measurements.
- Fallback chains are ordered: measured API → labelled LLM estimate → honest `unavailable`. Deterministic mock data must not masquerade as analysis output.
- API routes validate input and return typed JSON errors (`{ error, detail? }`) with correct status codes.
- Run `pnpm typecheck` before committing; the repo has no ESLint config — TypeScript is the gate.
