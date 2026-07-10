-- spec-lens cache schema v2. Existing v1 data is intentionally invalidated
-- because it cannot prove project/compiler isolation.

-- Write Side: content-addressed source data
CREATE TABLE IF NOT EXISTS fragment_blobs (
  content_hash TEXT PRIMARY KEY,
  content      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS snapshot_entries (
  cache_key     TEXT NOT NULL,
  relative_path TEXT NOT NULL,
  content_hash  TEXT NOT NULL REFERENCES fragment_blobs(content_hash),
  PRIMARY KEY (cache_key, relative_path)
);

CREATE TABLE IF NOT EXISTS snapshots (
  cache_key   TEXT PRIMARY KEY,
  project_key TEXT NOT NULL,
  revision_id TEXT NOT NULL,
  data        TEXT NOT NULL,
  built_at    INTEGER NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS snapshots_project_revision_idx
  ON snapshots (project_key, revision_id);

CREATE TABLE IF NOT EXISTS diffs (
  project_key      TEXT NOT NULL,
  base_revision_id TEXT NOT NULL,
  head_revision_id TEXT NOT NULL,
  data             TEXT NOT NULL,
  PRIMARY KEY (project_key, base_revision_id, head_revision_id)
);

-- Read Model: Sync Worker writes, Query handlers read
CREATE TABLE IF NOT EXISTS timeline_entries (
  project_key       TEXT NOT NULL,
  revision_id       TEXT NOT NULL,
  short_id          TEXT NOT NULL,
  timestamp         INTEGER NOT NULL,
  message           TEXT NOT NULL,
  author            TEXT,
  source            TEXT NOT NULL,
  source_ref        TEXT,
  affected_files    TEXT NOT NULL DEFAULT '[]',
  snapshot_cached   INTEGER NOT NULL DEFAULT 0,
  paths_added       INTEGER NOT NULL DEFAULT 0,
  paths_removed     INTEGER NOT NULL DEFAULT 0,
  paths_changed     INTEGER NOT NULL DEFAULT 0,
  breaking_changes  INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (project_key, revision_id)
);

CREATE INDEX IF NOT EXISTS timeline_entries_ts_idx
  ON timeline_entries (project_key, timestamp DESC);

CREATE TABLE IF NOT EXISTS path_entries (
  project_key             TEXT NOT NULL,
  path                    TEXT NOT NULL,
  methods                 TEXT NOT NULL DEFAULT '[]',
  canonical_id            TEXT NOT NULL,
  scope                   TEXT NOT NULL,
  domain                  TEXT NOT NULL,
  source_file             TEXT NOT NULL,
  content_hash            TEXT NOT NULL,
  last_changed_revision   TEXT NOT NULL,
  last_changed_timestamp  INTEGER NOT NULL,
  PRIMARY KEY (project_key, path)
);

CREATE INDEX IF NOT EXISTS path_entries_filter_idx
  ON path_entries (project_key, scope, domain);

PRAGMA user_version = 2;
