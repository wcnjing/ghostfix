// Server-side Supabase client. Service-role key — never expose to the client.
// No-ops gracefully when SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are missing
// so the demo runs offline without losing the dashboard.

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import type { AnalysisResult, Fix } from '@/lib/types';

let cached: SupabaseClient | null | undefined;

function getClient(): SupabaseClient | null {
  if (cached !== undefined) return cached;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    cached = null;
    return null;
  }
  cached = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return cached;
}

export async function persistAnalysis(result: AnalysisResult): Promise<void> {
  const client = getClient();
  if (!client) return;
  const { error } = await client.from('analyses').insert({
    id: result.id,
    brand_url: result.brandUrl,
    competitor_url: result.competitorUrl,
    prompts: result.prompts,
    score: result.score,
    score_breakdown: result.scoreBreakdown,
    citations: result.citations,
    issues: result.issues,
    created_at: result.createdAt,
  });
  if (error) {
    console.error('[supabase] persistAnalysis failed:', error.message);
  }
}

export async function persistFixes(fixes: Fix[]): Promise<void> {
  if (fixes.length === 0) return;
  const client = getClient();
  if (!client) return;
  const { error } = await client.from('fixes').insert(
    fixes.map((f) => ({
      id: f.id,
      analysis_id: f.analysisId,
      type: f.type,
      content: f.content,
      created_at: f.createdAt,
    })),
  );
  if (error) {
    console.error('[supabase] persistFixes failed:', error.message);
  }
}
