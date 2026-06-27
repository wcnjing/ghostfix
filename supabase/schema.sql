-- Ghostfix Supabase schema (brief §6).
-- Run against your Supabase Postgres via the SQL editor or `psql`.

create extension if not exists "pgcrypto";

create table if not exists analyses (
  id uuid primary key default gen_random_uuid(),
  brand_url text not null,
  competitor_url text not null,
  prompts text[] not null,
  score int not null,
  score_breakdown jsonb not null,
  citations jsonb not null,
  issues jsonb not null,
  created_at timestamptz not null default now()
);

create table if not exists fixes (
  id uuid primary key default gen_random_uuid(),
  analysis_id uuid not null references analyses(id) on delete cascade,
  type text not null check (type in ('faq', 'comparison_page', 'schema')),
  content text not null,
  created_at timestamptz not null default now()
);

create index if not exists fixes_analysis_id_idx on fixes(analysis_id);
create index if not exists analyses_created_at_idx on analyses(created_at desc);
