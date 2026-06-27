function numberFromEnv(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.round(value)));
}

export const config = {
  fetchTimeoutMs: numberFromEnv('GHOSTFIX_FETCH_TIMEOUT_MS', 8000, 1000, 30000),
  answerRuns: numberFromEnv('GHOSTFIX_ANSWER_RUNS', 3, 1, 10),
  answerTimeoutMs: numberFromEnv('GHOSTFIX_ANSWER_TIMEOUT_MS', 25000, 5000, 60000),
  perplexityModel: process.env.PERPLEXITY_MODEL ?? 'sonar',
  anthropicModel: process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-4-6',
  anthropicMaxTokens: numberFromEnv('ANTHROPIC_MAX_TOKENS', 4000, 500, 8000),
  userAgent:
    process.env.GHOSTFIX_USER_AGENT ??
    'Mozilla/5.0 (compatible; GhostfixBot/0.1; +https://ghostfix.local) Chrome/120 Safari/537.36',
};
