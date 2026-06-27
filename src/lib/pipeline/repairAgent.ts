// repairAgent: call Claude with the analysis issues/prompts, generate three
// reviewable drafts (FAQ, comparison page, JSON-LD). Never publishes anywhere.
// Falls back to a deterministic template when ANTHROPIC_API_KEY is missing.

import Anthropic from '@anthropic-ai/sdk';
import { randomUUID } from 'node:crypto';

import type { AnalysisResult, Fix } from '@/lib/types';

const MODEL = 'claude-sonnet-4-6';
const MAX_TOKENS = 4000;

function host(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

interface GeneratedDrafts {
  faq_markdown: string;
  comparison_markdown: string;
  schema_jsonld: string;
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

function buildPrompt(analysis: AnalysisResult): string {
  const brand = host(analysis.brandUrl);
  const competitor = host(analysis.competitorUrl);
  const issuesText = analysis.issues
    .map((i, n) => `${n + 1}. [${i.severity}] ${i.title} — ${i.why}`)
    .join('\n');
  const promptsText = analysis.prompts.map((p, n) => `${n + 1}. ${p}`).join('\n');

  return [
    `You are a content strategist helping ${brand} earn citations from AI answer engines (Perplexity, ChatGPT, Google AI Overviews).`,
    `Competitor: ${competitor}`,
    '',
    'Target prompts (these are queries users ask AI engines):',
    promptsText,
    '',
    'Diagnosed gaps:',
    issuesText,
    '',
    'Generate three reviewable drafts that directly close these gaps:',
    '',
    `1. faq_markdown: An "answer-ready" FAQ in Markdown. One H2 per target prompt. Each answer must lead with the direct answer in the first sentence (AI engines extract leading sentences), then add 2–4 sentences with concrete facts. Include real-feeling specifics; if you have to invent numbers, write them as bracketed placeholders like [X%] so a human can fill them in.`,
    `2. comparison_markdown: A "${brand} vs ${competitor}" Markdown page. Include a comparison table with at least 5 rows (pricing, ideal user, setup time, integrations, support). End with a one-paragraph "when to choose each" summary.`,
    `3. schema_jsonld: A valid JSON-LD FAQPage with one Question per target prompt. Use the same answers as the FAQ markdown but plain-text. Output as a JSON string (it will be embedded in a <script type="application/ld+json"> tag).`,
    '',
    'Return ONLY a single JSON object with exactly these three string fields: faq_markdown, comparison_markdown, schema_jsonld. No prose, no markdown code fences around the JSON itself.',
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

function validateDrafts(parsed: unknown): GeneratedDrafts | null {
  if (!parsed || typeof parsed !== 'object') return null;
  const p = parsed as Partial<GeneratedDrafts>;
  if (
    typeof p.faq_markdown === 'string' &&
    typeof p.comparison_markdown === 'string' &&
    typeof p.schema_jsonld === 'string'
  ) {
    return {
      faq_markdown: p.faq_markdown,
      comparison_markdown: p.comparison_markdown,
      schema_jsonld: p.schema_jsonld,
    };
  }
  return null;
}

async function callAnthropic(analysis: AnalysisResult): Promise<GeneratedDrafts | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;

  const client = new Anthropic({ apiKey });
  try {
    const res = await client.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      messages: [{ role: 'user', content: buildPrompt(analysis) }],
    });
    const text = res.content
      .map((b) => (b.type === 'text' ? b.text : ''))
      .join('')
      .trim();
    return validateDrafts(extractJsonObject(text));
  } catch {
    return null;
  }
}

interface GeminiResponse {
  candidates?: { content?: { parts?: { text?: string }[] } }[];
}

async function callGemini(analysis: AnalysisResult): Promise<GeneratedDrafts | null> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;

  // gemini-2.0-flash is the current free-tier sweet spot: fast + structured-output capable.
  const model = process.env.GEMINI_MODEL ?? 'gemini-2.0-flash';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: buildPrompt(analysis) }] }],
        generationConfig: {
          responseMimeType: 'application/json',
          maxOutputTokens: MAX_TOKENS,
          temperature: 0.7,
        },
      }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as GeminiResponse;
    const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';
    return validateDrafts(extractJsonObject(text));
  } catch {
    return null;
  }
}

export async function repairAgent(analysis: AnalysisResult): Promise<Fix[]> {
  const brand = host(analysis.brandUrl);
  const competitor = host(analysis.competitorUrl);

  // Try paid Anthropic first (best quality), then free-tier Gemini, then templates.
  const generated = (await callAnthropic(analysis)) ?? (await callGemini(analysis));
  const drafts: GeneratedDrafts = generated ?? {
    faq_markdown: fallbackFaq(analysis.prompts, brand),
    comparison_markdown: fallbackComparison(brand, competitor),
    schema_jsonld: fallbackSchema(analysis.prompts, analysis.brandUrl),
  };

  const now = new Date().toISOString();
  return [
    {
      id: randomUUID(),
      analysisId: analysis.id,
      type: 'faq',
      content: drafts.faq_markdown,
      createdAt: now,
    },
    {
      id: randomUUID(),
      analysisId: analysis.id,
      type: 'comparison_page',
      content: drafts.comparison_markdown,
      createdAt: now,
    },
    {
      id: randomUUID(),
      analysisId: analysis.id,
      type: 'schema',
      content: drafts.schema_jsonld,
      createdAt: now,
    },
  ];
}
