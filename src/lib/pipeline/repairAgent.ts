// repairAgent: call Claude with the analysis issues/prompts and generate
// reviewable drafts — but only the artifact types the diagnosis actually
// flagged (an FAQ gap yields an FAQ draft; no schema issue, no schema draft).
// Drafts are seeded with the brand's real crawled content so they contain
// facts, not placeholders. Never publishes anywhere. Falls back to a
// deterministic template per artifact when no LLM is reachable.

import Anthropic from '@anthropic-ai/sdk';
import { randomUUID } from 'node:crypto';

import { config } from '@/lib/config';
import { generateJson } from '@/lib/llm';
import type { AnalysisResult, Fix, FixType } from '@/lib/types';

function host(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

type DraftKey = 'faq_markdown' | 'comparison_markdown' | 'schema_jsonld';

const DRAFT_KEY: Record<FixType, DraftKey> = {
  faq: 'faq_markdown',
  comparison_page: 'comparison_markdown',
  schema: 'schema_jsonld',
};

type GeneratedDrafts = Partial<Record<DraftKey, string>>;

// Which artifacts to produce: unique fixTypes from the diagnosed issues,
// ordered by recoverable points. If the diagnosis flagged nothing (or came
// from an older payload without fixTypes), produce the full set.
function neededFixTypes(analysis: AnalysisResult): FixType[] {
  const seen = new Set<FixType>();
  const ordered: FixType[] = [];
  for (const issue of [...analysis.issues].sort((a, b) => (b.estPointGain ?? 0) - (a.estPointGain ?? 0))) {
    if (issue.fixType && !seen.has(issue.fixType)) {
      seen.add(issue.fixType);
      ordered.push(issue.fixType);
    }
  }
  return ordered.length > 0 ? ordered : ['faq', 'comparison_page', 'schema'];
}

function fallbackFaq(prompts: string[], brand: string): string {
  const lines = ['# Frequently Asked Questions', ''];
  for (const p of prompts.slice(0, 5)) {
    const q = p.endsWith('?') ? p : `${p}?`;
    lines.push(`## ${q[0].toUpperCase()}${q.slice(1)}`);
    lines.push(
      `${brand} answers ${q.toLowerCase()} with a short, citable response. Replace this paragraph with the specific facts, numbers, and proof points a reader needs to act.`,
    );
    lines.push('');
  }
  return lines.join('\n');
}

function fallbackComparison(brand: string, competitor: string): string {
  return [
    `# ${brand} vs ${competitor}: which one is right for you?`,
    '',
    `Both ${brand} and ${competitor} solve the same core problem, but they make different trade-offs. Here's a side-by-side comparison so you can pick the one that fits your team.`,
    '',
    '| Dimension | ' + brand + ' | ' + competitor + ' |',
    '|---|---|---|',
    '| Pricing | _add concrete numbers_ | _add concrete numbers_ |',
    '| Best for | _describe ideal user_ | _describe ideal user_ |',
    '| Setup time | _e.g. minutes_ | _e.g. hours_ |',
    '| Integrations | _list top 3_ | _list top 3_ |',
    '| Support | _e.g. 24/7 chat_ | _e.g. email only_ |',
    '',
    `## When to choose ${brand}`,
    `- Use case A where ${brand} wins`,
    '- Use case B where speed-to-value matters',
    '',
    `## When to choose ${competitor}`,
    '- Use case C where the competitor wins',
    '- Use case D where their integrations matter',
    '',
    '## The short version',
    `Pick ${brand} if you want X. Pick ${competitor} if you want Y.`,
    '',
  ].join('\n');
}

function fallbackSchema(prompts: string[], brandUrl: string): string {
  const mainEntity = prompts.slice(0, 5).map((p) => ({
    '@type': 'Question',
    name: p.endsWith('?') ? p : `${p}?`,
    acceptedAnswer: {
      '@type': 'Answer',
      text: `Concise answer about ${host(brandUrl)} addressing: ${p}`,
    },
  }));
  return JSON.stringify(
    { '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity },
    null,
    2,
  );
}

function fallbackFor(type: FixType, analysis: AnalysisResult): string {
  const brand = host(analysis.brandUrl);
  const competitor = host(analysis.competitorUrl);
  if (type === 'faq') return fallbackFaq(analysis.prompts, brand);
  if (type === 'comparison_page') return fallbackComparison(brand, competitor);
  return fallbackSchema(analysis.prompts, analysis.brandUrl);
}

const DRAFT_INSTRUCTIONS: Record<FixType, (brand: string, competitor: string) => string> = {
  faq: () =>
    `faq_markdown: An "answer-ready" FAQ in Markdown. One H2 per target prompt. Each answer must lead with the direct answer in the first sentence (AI engines extract leading sentences), then add 2–4 sentences with concrete facts. Pull real specifics (product names, features, pricing, claims) from the site content provided above wherever possible; only if a number is genuinely unknowable write it as a bracketed placeholder like [X%].`,
  comparison_page: (brand, competitor) =>
    `comparison_markdown: A "${brand} vs ${competitor}" Markdown page. Include a comparison table with at least 5 rows (pricing, ideal user, setup time, integrations, support). Fill the brand's column from the site content provided above; mark competitor cells you can't verify as [verify]. End with a one-paragraph "when to choose each" summary.`,
  schema: () =>
    `schema_jsonld: A valid JSON-LD FAQPage with one Question per target prompt. Use direct, factual answers grounded in the site content above, plain-text. Output as a JSON string (it will be embedded in a <script type="application/ld+json"> tag).`,
};

function buildPrompt(analysis: AnalysisResult, types: FixType[]): string {
  const brand = host(analysis.brandUrl);
  const competitor = host(analysis.competitorUrl);
  const issuesText = analysis.issues
    .map((i, n) => `${n + 1}. [${i.severity}] ${i.title} — ${i.why} Action: ${i.action}`)
    .join('\n');
  const promptsText = analysis.prompts.map((p, n) => `${n + 1}. ${p}`).join('\n');
  const brandSignals = analysis.signals?.brand;
  const siteContext = brandSignals?.fetched
    ? [
        `What we saw on ${brand} (crawled ${brandSignals.pagesCrawled.length} page(s)):`,
        brandSignals.textSample ? `Site content sample:\n"""\n${brandSignals.textSample}\n"""` : '',
        `Detected signals: FAQ ${brandSignals.hasFaq ? 'present' : 'missing'}, comparison page ${brandSignals.hasComparisonPage ? 'present' : 'missing'}, pricing ${brandSignals.pricingClarity}, JSON-LD [${brandSignals.jsonLdTypes.join(', ') || 'none'}].`,
      ]
        .filter(Boolean)
        .join('\n')
    : `We could not crawl ${brand}, so no site content is available — keep claims generic and use bracketed placeholders for specifics.`;

  const fields = types.map((t) => DRAFT_KEY[t]);
  const numbered = types.map(
    (t, i) => `${i + 1}. ${DRAFT_INSTRUCTIONS[t](brand, competitor)}`,
  );

  return [
    `You are a content strategist helping ${brand} earn citations from AI answer engines (Perplexity, ChatGPT, Google AI Overviews).`,
    `Competitor: ${competitor}`,
    '',
    siteContext,
    '',
    'Target prompts (these are queries users ask AI engines):',
    promptsText,
    '',
    'Diagnosed gaps:',
    issuesText,
    '',
    `Generate ${types.length} reviewable draft(s) that directly close these gaps:`,
    '',
    ...numbered,
    '',
    `Return ONLY a single JSON object with exactly these string fields: ${fields.join(', ')}. No prose, no markdown code fences around the JSON itself.`,
  ].join('\n');
}

function extractJsonObject(text: string): unknown {
  const trimmed = text.trim();
  // Strip markdown code fences if the model wrapped its JSON anyway.
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  const candidate = fenced ? fenced[1] : trimmed;
  try {
    return JSON.parse(candidate);
  } catch {
    // Last-ditch: find the first {...} block.
    const m = candidate.match(/\{[\s\S]*\}/);
    if (!m) return null;
    try {
      return JSON.parse(m[0]);
    } catch {
      return null;
    }
  }
}

// Accept the drafts if every requested field came back as a string.
function validateDrafts(parsed: unknown, types: FixType[]): GeneratedDrafts | null {
  if (!parsed || typeof parsed !== 'object') return null;
  const p = parsed as Record<string, unknown>;
  const out: GeneratedDrafts = {};
  for (const t of types) {
    const key = DRAFT_KEY[t];
    if (typeof p[key] !== 'string' || (p[key] as string).trim().length === 0) return null;
    out[key] = p[key] as string;
  }
  return out;
}

async function callAnthropic(analysis: AnalysisResult, types: FixType[]): Promise<GeneratedDrafts | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;

  const client = new Anthropic({ apiKey });
  try {
    const res = await client.messages.create({
      model: config.anthropicModel,
      max_tokens: config.anthropicMaxTokens,
      messages: [{ role: 'user', content: buildPrompt(analysis, types) }],
    });
    const text = res.content
      .map((b) => (b.type === 'text' ? b.text : ''))
      .join('')
      .trim();
    return validateDrafts(extractJsonObject(text), types);
  } catch {
    return null;
  }
}

async function callFreeLlm(analysis: AnalysisResult, types: FixType[]): Promise<GeneratedDrafts | null> {
  // Shared chain: Groq → Gemini. Both have free tiers; Groq is the unconditional
  // path so we hit it first inside generateJson().
  const schemaHint = `{${types.map((t) => `"${DRAFT_KEY[t]}": "..."`).join(', ')}}`;
  const parsed = await generateJson<GeneratedDrafts>(buildPrompt(analysis, types), schemaHint);
  return validateDrafts(parsed, types);
}

export async function repairAgent(analysis: AnalysisResult): Promise<Fix[]> {
  const types = neededFixTypes(analysis);

  // Anthropic first when configured (best quality), then the free Groq/Gemini
  // chain, then deterministic templates.
  const generated =
    (await callAnthropic(analysis, types)) ?? (await callFreeLlm(analysis, types));

  const now = new Date().toISOString();
  return types.map((type) => ({
    id: randomUUID(),
    analysisId: analysis.id,
    type,
    content: generated?.[DRAFT_KEY[type]] ?? fallbackFor(type, analysis),
    createdAt: now,
  }));
}
