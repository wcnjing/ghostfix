// repairAgent: generate targeted, actionable repair drafts based on the specific
// gaps diagnosed in the analysis. Produces only the fixes relevant to the actual
// issues found. FAQ suggestions are omitted. Supports: comparison page, JSON-LD
// schema, evidence/stats content, trust signal content, freshness improvements,
// and answer-ready content targeting specific prompts.

import Anthropic from '@anthropic-ai/sdk';
import { randomUUID } from 'node:crypto';

import { config } from '@/lib/config';
import { generateJson } from '@/lib/llm';
import type { AnalysisResult, Fix, FixType, Issue } from '@/lib/types';

function host(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

interface GeneratedDrafts {
  faq_markdown?: string;
  comparison_markdown?: string;
  schema_jsonld?: string;
  evidence_stats_markdown?: string;
  trust_signals_markdown?: string;
  freshness_update_markdown?: string;
  answer_content_markdown?: string;
}

/** Determine which fix types to generate based on diagnosed issues. FAQ is omitted. */
function selectFixTypes(analysis: AnalysisResult): FixType[] {
  const types: FixType[] = [];
  const issues = analysis.issues;
  const dimensions = new Set(issues.map((i) => i.dimension));

  // For share_of_answer issues: generate answer-ready content targeting specific prompts
  if (dimensions.has('share_of_answer')) {
    types.push('answer_content');
  }

  // For content_coverage: check which specific content is missing
  if (dimensions.has('content_coverage')) {
    const why = issues.filter((i) => i.dimension === 'content_coverage').map((i) => i.why).join(' ');
    if (/comparison|vs\b|versus/i.test(why)) {
      types.push('comparison_page');
    }
    // Always add answer_content for content gaps (replaces FAQ)
    if (!types.includes('answer_content')) {
      types.push('answer_content');
    }
  }

  // For structured_data: generate schema
  if (dimensions.has('structured_data')) {
    types.push('schema');
  }

  // For evidence_density: generate a stats/proof page
  if (dimensions.has('evidence_density')) {
    types.push('evidence_stats');
  }

  // For freshness_trust: generate trust signal and freshness recommendations
  if (dimensions.has('freshness_trust')) {
    types.push('trust_signals');
  }

  // If no issues found (unlikely), provide answer_content as a general improvement
  if (types.length === 0) {
    types.push('answer_content');
  }

  // Deduplicate
  return [...new Set(types)];
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

function fallbackEvidenceStats(brand: string, prompts: string[]): string {
  return [
    `# ${brand} — Key Facts, Stats & Proof Points`,
    '',
    'AI answer engines strongly prefer pages with concrete, citable data. This page consolidates the quantifiable evidence that makes your brand citable.',
    '',
    '## Performance Metrics',
    '- [X]% faster than industry average at [key task]',
    '- [X] customers served / [X] transactions processed',
    '- [X]% uptime SLA guarantee',
    '',
    '## Customer Results',
    '- "[Customer name] achieved [X]% improvement in [metric] within [timeframe]"',
    '- "Teams using [brand] report [X]% reduction in [pain point]"',
    '- Average ROI of [X]x within the first [timeframe]',
    '',
    '## Third-Party Validation',
    '- Rated [X]/5 on G2 with [X]+ reviews',
    '- Named a Leader in [analyst report] [year]',
    '- Featured in [publication]: "[brief quote about the brand]"',
    '',
    '## Benchmarks vs Alternatives',
    ...prompts.slice(0, 3).map((p) => `- For "${p}": [specific stat showing your advantage]`),
    '',
    '## How to use this page',
    'Replace every [X] placeholder with real numbers from your analytics, customer surveys, or public reviews. AI engines extract sentences containing specific numbers and cite the source page.',
    '',
  ].join('\n');
}

function fallbackTrustSignals(brand: string): string {
  return [
    `# ${brand} — Trust Signals & Social Proof`,
    '',
    'AI engines weight pages higher when they contain multiple independent trust indicators. Add these to your key landing pages.',
    '',
    '## Customer Testimonials',
    'Add 3-5 direct quotes from real customers with their name, title, and company:',
    '',
    '> "[Specific, measurable outcome from using the product]"',
    '> — [Full Name], [Title] at [Company]',
    '',
    '## Case Studies',
    'Summarize 2-3 case studies with concrete before/after metrics:',
    '',
    '### [Customer Company]',
    '- **Challenge:** [specific problem]',
    '- **Solution:** How they used [brand]',
    '- **Result:** [X]% improvement in [metric] over [timeframe]',
    '',
    '## Press & Recognition',
    '- Featured in: [Publication 1], [Publication 2], [Publication 3]',
    '- Awards: [Award name] ([Year])',
    '- "[Direct press quote about the brand]" — [Publication]',
    '',
    '## Security & Compliance',
    '- List relevant certifications: SOC 2, ISO 27001, GDPR, HIPAA, PCI DSS',
    '- "Your data is encrypted at rest and in transit with [standard]"',
    '',
    '## Review Platform Presence',
    '- G2: [X]/5 stars ([X]+ reviews)',
    '- Capterra: [X]/5 stars',
    '- TrustPilot: [X]/5 rating',
    '',
    '## Implementation Checklist',
    '- [ ] Add testimonial quotes with attribution to homepage',
    '- [ ] Publish at least 2 full case studies with metrics',
    '- [ ] Display security badges in footer',
    '- [ ] Add review platform widgets or scores to landing pages',
    '- [ ] Include "As seen in" press logo section',
    '',
  ].join('\n');
}

function fallbackAnswerContent(prompts: string[], brand: string): string {
  return [
    `# ${brand} — Answer-Ready Content for AI Engines`,
    '',
    'These content blocks are optimized for AI extraction. Each targets a specific query that AI engines are answering today. Place them on your product, features, or resources pages.',
    '',
    ...prompts.slice(0, 5).flatMap((p) => [
      `## ${p}`,
      '',
      `**Direct answer (first sentence — this is what AI engines extract):**`,
      `[Brand] is [one-sentence direct answer to the query with a specific claim].`,
      '',
      `**Supporting detail:**`,
      `- [Specific feature or capability relevant to this query]`,
      `- [Concrete number: "processes X per second" or "used by X teams"]`,
      `- [Differentiator from alternatives for this specific use case]`,
      '',
      `**Citable quote:**`,
      `> "[A real customer quote relevant to this query with measurable outcome]"`,
      '',
    ]),
    '## Why this format works',
    '- AI engines (Perplexity, ChatGPT, Gemini) extract the first 1-2 sentences as the answer',
    '- Supporting bullets provide the evidence that earns citation over competitors',
    '- Quotes add third-party validation that AI engines weigh as trustworthy',
    '',
  ].join('\n');
}

function buildPrompt(analysis: AnalysisResult, fixTypes: FixType[]): string {
  const brand = host(analysis.brandUrl);
  const competitor = host(analysis.competitorUrl);
  const issuesText = analysis.issues
    .map((i, n) => `${n + 1}. [${i.severity}] ${i.title} — ${i.why}`)
    .join('\n');
  const promptsText = analysis.prompts.map((p, n) => `${n + 1}. ${p}`).join('\n');

  const sections: string[] = [
    `You are a content strategist helping ${brand} earn citations from AI answer engines (Perplexity, ChatGPT, Google AI Overviews).`,
    `Competitor: ${competitor}`,
    '',
    'Target prompts (these are queries users ask AI engines):',
    promptsText,
    '',
    'Diagnosed gaps:',
    issuesText,
    '',
    'Based on the specific gaps diagnosed above, generate ONLY the following repair drafts:',
    '',
  ];

  const fieldDescriptions: string[] = [];

  if (fixTypes.includes('faq')) {
    fieldDescriptions.push(
      `- faq_markdown: An "answer-ready" FAQ in Markdown. One H2 per target prompt. Each answer must lead with the direct answer in the first sentence (AI engines extract leading sentences), then add 2–4 sentences with concrete facts.`,
    );
  }
  if (fixTypes.includes('comparison_page')) {
    fieldDescriptions.push(
      `- comparison_markdown: A "${brand} vs ${competitor}" Markdown page. Include a comparison table with at least 5 rows (pricing, ideal user, setup time, integrations, support). End with a one-paragraph "when to choose each" summary.`,
    );
  }
  if (fixTypes.includes('schema')) {
    fieldDescriptions.push(
      `- schema_jsonld: A valid JSON-LD string. Use Product + Organization schema if the issue is about missing product/org identity, or FAQPage if FAQ content is present. Output as a JSON string.`,
    );
  }
  if (fixTypes.includes('evidence_stats')) {
    fieldDescriptions.push(
      `- evidence_stats_markdown: A "Proof Points & Stats" page in Markdown. Include sections for: Performance Metrics (3+ stats with placeholders like [X]%), Customer Results (3+ case study summaries), Third-Party Validation (analyst reports, awards, review scores), and Benchmarks vs Alternatives. Use bracketed placeholders for numbers the team needs to fill in.`,
    );
  }
  if (fixTypes.includes('trust_signals')) {
    fieldDescriptions.push(
      `- trust_signals_markdown: A trust-building content module in Markdown. Include: 3-5 customer testimonial templates with name/title/company attribution, 2-3 case study summaries with before/after metrics, press mention section, security/compliance badges to display, and review platform scores.`,
    );
  }
  if (fixTypes.includes('answer_content')) {
    fieldDescriptions.push(
      `- answer_content_markdown: Answer-optimized content blocks targeting the specific prompts where the brand is absent. For each prompt: start with a direct 1-sentence answer (this is what AI extracts), follow with 3 bullet points of supporting evidence, and include a citable customer quote. This content is designed to be embedded on product/feature pages.`,
    );
  }

  sections.push(...fieldDescriptions);
  sections.push('');
  sections.push('Return ONLY a single JSON object with the fields listed above (string values). No prose, no markdown code fences around the JSON itself. Include placeholders like [X%] where the team needs to fill in real numbers.');

  return sections.join('\n');
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

function validateDrafts(parsed: unknown, fixTypes: FixType[]): GeneratedDrafts | null {
  if (!parsed || typeof parsed !== 'object') return null;
  const p = parsed as Record<string, unknown>;
  const result: GeneratedDrafts = {};

  // Map fix types to their expected JSON field names
  const typeToField: Record<FixType, keyof GeneratedDrafts> = {
    faq: 'faq_markdown',
    comparison_page: 'comparison_markdown',
    schema: 'schema_jsonld',
    evidence_stats: 'evidence_stats_markdown',
    trust_signals: 'trust_signals_markdown',
    freshness_update: 'freshness_update_markdown',
    answer_content: 'answer_content_markdown',
  };

  let foundAny = false;
  for (const ft of fixTypes) {
    const field = typeToField[ft];
    if (field && typeof p[field] === 'string' && (p[field] as string).length > 10) {
      result[field] = p[field] as string;
      foundAny = true;
    }
  }

  return foundAny ? result : null;
}

async function callAnthropic(analysis: AnalysisResult, fixTypes: FixType[]): Promise<GeneratedDrafts | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;

  const client = new Anthropic({ apiKey });
  try {
    const res = await client.messages.create({
      model: config.anthropicModel,
      max_tokens: config.anthropicMaxTokens,
      messages: [{ role: 'user', content: buildPrompt(analysis, fixTypes) }],
    });
    const text = res.content
      .map((b) => (b.type === 'text' ? b.text : ''))
      .join('')
      .trim();
    return validateDrafts(extractJsonObject(text), fixTypes);
  } catch {
    return null;
  }
}

async function callFreeLlm(analysis: AnalysisResult, fixTypes: FixType[]): Promise<GeneratedDrafts | null> {
  // Shared chain: Groq → Gemini. Both have free tiers; Groq is the unconditional
  // path so we hit it first inside generateJson().
  const parsed = await generateJson<GeneratedDrafts>(
    buildPrompt(analysis, fixTypes),
    `Return a JSON object with string fields for each requested draft type.`,
  );
  return validateDrafts(parsed, fixTypes);
}

export async function repairAgent(analysis: AnalysisResult): Promise<Fix[]> {
  const brand = host(analysis.brandUrl);
  const competitor = host(analysis.competitorUrl);

  // Determine which fixes to generate based on actual issues
  const fixTypes = selectFixTypes(analysis);

  // Anthropic first when configured (best quality), then the free Groq/Gemini
  // chain, then deterministic templates.
  const generated = (await callAnthropic(analysis, fixTypes)) ?? (await callFreeLlm(analysis, fixTypes));

  // Build fallback drafts for each requested fix type
  const fallbackDrafts: GeneratedDrafts = {};
  for (const ft of fixTypes) {
    switch (ft) {
      case 'faq':
        fallbackDrafts.faq_markdown = fallbackFaq(analysis.prompts, brand);
        break;
      case 'comparison_page':
        fallbackDrafts.comparison_markdown = fallbackComparison(brand, competitor);
        break;
      case 'schema':
        fallbackDrafts.schema_jsonld = fallbackSchema(analysis.prompts, analysis.brandUrl);
        break;
      case 'evidence_stats':
        fallbackDrafts.evidence_stats_markdown = fallbackEvidenceStats(brand, analysis.prompts);
        break;
      case 'trust_signals':
        fallbackDrafts.trust_signals_markdown = fallbackTrustSignals(brand);
        break;
      case 'answer_content':
        fallbackDrafts.answer_content_markdown = fallbackAnswerContent(analysis.prompts, brand);
        break;
      // freshness_update is handled within trust_signals
      default:
        break;
    }
  }

  const drafts: GeneratedDrafts = generated ?? fallbackDrafts;
  // Merge: use generated content where available, fall back per-field
  const merged: GeneratedDrafts = {};
  for (const ft of fixTypes) {
    const fieldMap: Record<FixType, keyof GeneratedDrafts> = {
      faq: 'faq_markdown',
      comparison_page: 'comparison_markdown',
      schema: 'schema_jsonld',
      evidence_stats: 'evidence_stats_markdown',
      trust_signals: 'trust_signals_markdown',
      freshness_update: 'freshness_update_markdown',
      answer_content: 'answer_content_markdown',
    };
    const field = fieldMap[ft];
    merged[field] = drafts[field] || fallbackDrafts[field];
  }

  const now = new Date().toISOString();
  const fixes: Fix[] = [];

  if (merged.faq_markdown) {
    fixes.push({ id: randomUUID(), analysisId: analysis.id, type: 'faq', content: merged.faq_markdown, createdAt: now });
  }
  if (merged.comparison_markdown) {
    fixes.push({ id: randomUUID(), analysisId: analysis.id, type: 'comparison_page', content: merged.comparison_markdown, createdAt: now });
  }
  if (merged.schema_jsonld) {
    fixes.push({ id: randomUUID(), analysisId: analysis.id, type: 'schema', content: merged.schema_jsonld, createdAt: now });
  }
  if (merged.evidence_stats_markdown) {
    fixes.push({ id: randomUUID(), analysisId: analysis.id, type: 'evidence_stats', content: merged.evidence_stats_markdown, createdAt: now });
  }
  if (merged.trust_signals_markdown) {
    fixes.push({ id: randomUUID(), analysisId: analysis.id, type: 'trust_signals', content: merged.trust_signals_markdown, createdAt: now });
  }
  if (merged.answer_content_markdown) {
    fixes.push({ id: randomUUID(), analysisId: analysis.id, type: 'answer_content', content: merged.answer_content_markdown, createdAt: now });
  }

  return fixes;
}
