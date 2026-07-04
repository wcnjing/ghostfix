import { NextResponse } from 'next/server';

import { repairAgent } from '@/lib/pipeline/repairAgent';
import { persistFixes } from '@/lib/supabase';
import type { RepairRequest } from '@/lib/types';

export async function POST(req: Request) {
  let body: RepairRequest;
  try {
    body = (await req.json()) as RepairRequest;
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }

  if (!body.analysis || !body.analysis.id) {
    return NextResponse.json(
      { error: 'missing_fields', expected: ['analysis'] },
      { status: 400 },
    );
  }

  const fixes = await repairAgent(body.analysis);
  await persistFixes(fixes);
  return NextResponse.json({ fixes });
}
