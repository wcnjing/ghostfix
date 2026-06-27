export function normalizeHttpUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    const url = new URL(trimmed);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return url.toString();
  } catch {
    return null;
  }
}

export function normalizePrompts(value: unknown, max: number): string[] | null {
  if (!Array.isArray(value)) return null;
  const prompts = value
    .map((prompt) => (typeof prompt === 'string' ? prompt.trim() : ''))
    .filter(Boolean);
  if (prompts.length === 0 || prompts.length > max) return null;
  return prompts;
}
