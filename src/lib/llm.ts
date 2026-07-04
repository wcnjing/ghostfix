// Shared LLM helper: tries Groq first, then Gemini. Both have free tiers;
// Groq's is unconditional (no Workspace gotcha) so it's our primary path.
// Returns null when both miss, and callers fall back to deterministic templates.

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_MODEL = process.env.GROQ_MODEL ?? 'llama-3.3-70b-versatile';
const GEMINI_MODEL = process.env.GEMINI_MODEL ?? 'gemini-2.0-flash';

interface CallOpts {
  json?: boolean;
  maxTokens?: number;
  temperature?: number;
}

interface GroqResp {
  choices?: { message?: { content?: string } }[];
}

interface GeminiResp {
  candidates?: { content?: { parts?: { text?: string }[] } }[];
}

// Log once per provider+status so a broken key doesn't spam the console on
// every pipeline call but the reason is never invisible.
const loggedFailures = new Set<string>();

async function logApiFailure(provider: string, res: Response): Promise<void> {
  const key = `${provider}:${res.status}`;
  if (loggedFailures.has(key)) return;
  loggedFailures.add(key);
  const body = await res.text().catch(() => '');
  let hint = '';
  if (res.status === 400 || res.status === 401 || res.status === 403) {
    hint = ' (key invalid, expired, or API not enabled for this project?)';
  } else if (res.status === 404) {
    hint = ` (model not found — it may be retired; override with ${provider === 'gemini' ? 'GEMINI_MODEL' : 'GROQ_MODEL'} in .env.local)`;
  } else if (res.status === 429) {
    hint = ' (rate limit / free-tier quota exhausted)';
  }
  console.error(`[llm] ${provider} request failed: HTTP ${res.status}${hint}\n${body.slice(0, 500)}`);
}

async function callGroqRaw(prompt: string, opts: CallOpts): Promise<string | null> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) return null;
  try {
    const res = await fetch(GROQ_URL, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: GROQ_MODEL,
        messages: [{ role: 'user', content: prompt }],
        max_tokens: opts.maxTokens ?? 2000,
        temperature: opts.temperature ?? 0.5,
        // Groq's JSON mode requires the prompt to mention "JSON" somewhere,
        // and the caller-supplied prompts (in generateJson) already do.
        ...(opts.json ? { response_format: { type: 'json_object' } } : {}),
      }),
    });
    if (!res.ok) {
      await logApiFailure('groq', res);
      return null;
    }
    const data = (await res.json()) as GroqResp;
    return data.choices?.[0]?.message?.content?.trim() ?? null;
  } catch (e) {
    console.error('[llm] groq request threw:', e instanceof Error ? e.message : e);
    return null;
  }
}

async function callGeminiRaw(prompt: string, opts: CallOpts): Promise<string | null> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${encodeURIComponent(apiKey)}`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          maxOutputTokens: opts.maxTokens ?? 2000,
          temperature: opts.temperature ?? 0.5,
          ...(opts.json ? { responseMimeType: 'application/json' } : {}),
        },
      }),
    });
    if (!res.ok) {
      await logApiFailure('gemini', res);
      return null;
    }
    const data = (await res.json()) as GeminiResp;
    return (
      data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('').trim() ?? null
    );
  } catch (e) {
    console.error('[llm] gemini request threw:', e instanceof Error ? e.message : e);
    return null;
  }
}

function extractJson<T>(text: string): T | null {
  try {
    return JSON.parse(text) as T;
  } catch {
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) return null;
    try {
      return JSON.parse(m[0]) as T;
    } catch {
      return null;
    }
  }
}

/**
 * Generate a JSON object. Tries Groq first, then Gemini. Returns parsed object
 * or null if both providers miss / fail to produce valid JSON.
 *
 * The schemaHint should describe the expected shape; the helper appends a
 * "Return JSON" instruction (Groq's JSON mode requires the word "JSON" in the
 * prompt).
 */
export async function generateJson<T>(prompt: string, schemaHint: string): Promise<T | null> {
  const fullPrompt = `${prompt}\n\nReturn JSON matching exactly this shape:\n${schemaHint}`;
  const opts: CallOpts = { json: true, maxTokens: 2000, temperature: 0.5 };

  const groq = await callGroqRaw(fullPrompt, opts);
  if (groq) {
    const parsed = extractJson<T>(groq);
    if (parsed) return parsed;
  }
  const gem = await callGeminiRaw(fullPrompt, opts);
  if (gem) {
    const parsed = extractJson<T>(gem);
    if (parsed) return parsed;
  }
  return null;
}

/**
 * Generate free-form text. Tries Groq, then Gemini.
 */
export async function generateText(
  prompt: string,
  opts: { maxTokens?: number; temperature?: number } = {},
): Promise<string | null> {
  const groq = await callGroqRaw(prompt, opts);
  if (groq) return groq;
  return callGeminiRaw(prompt, opts);
}
