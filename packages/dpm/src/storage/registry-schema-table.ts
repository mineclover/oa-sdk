export const DPM_REGISTRY_STORAGE_TABLE_SQL = `create schema if not exists dpm;

create table if not exists dpm.relationship_registry (
  id bigint generated always as identity primary key,
  dataset_id text not null,
  registry_version text not null,
  relationship_name text not null,
  relationship_version text not null,
  status text not null,
  relationship_type text not null,
  parent_table text not null,
  parent_columns text[] not null,
  child_table text not null,
  child_columns text[] not null,
  namespace text not null,
  transform_strategy text not null,
  orphan_policy text not null,
  context_columns text[] not null default '{}',
  condition_sql text,
  temporal_condition text,
  confidence_score double precision,
  evidence jsonb not null default '[]'::jsonb,
  approval jsonb not null,
  supersedes text,
  superseded_by text,
  source jsonb,
  source_freshness_hash text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint dpm_relationship_registry_status_check check (
    status in ('candidate', 'proposed', 'approved', 'rejected', 'deprecated', 'superseded')
  ),
  constraint dpm_relationship_registry_type_check check (
    relationship_type in (
      'one_to_one',
      'one_to_many',
      'many_to_one',
      'many_to_many_edge',
      'self_reference',
      'polymorphic',
      'temporal',
      'code_lookup'
    )
  ),
  constraint dpm_relationship_registry_transform_strategy_check check (
    transform_strategy in ('entity_token', 'relationship_token', 'keep_code')
  ),
  constraint dpm_relationship_registry_orphan_policy_check check (
    orphan_policy in ('block', 'warn', 'tolerate', 'tolerate_null', 'create_placeholder_parent', 'lookup_archive')
  ),
  constraint dpm_relationship_registry_parent_columns_check check (cardinality(parent_columns) > 0),
  constraint dpm_relationship_registry_child_columns_check check (cardinality(child_columns) > 0),
  constraint dpm_relationship_registry_confidence_score_check check (
    confidence_score is null or (confidence_score >= 0 and confidence_score <= 1)
  )
);`
