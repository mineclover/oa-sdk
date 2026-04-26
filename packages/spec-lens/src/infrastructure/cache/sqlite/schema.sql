-- Write Side: 정밀 데이터
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
  cache_key            TEXT PRIMARY KEY,
  revision_id          TEXT NOT NULL,
  fragments_dir        TEXT NOT NULL,
  target_path          TEXT NOT NULL,
  target_config_digest TEXT NOT NULL DEFAULT '',
  data                 TEXT NOT NULL,
  built_at             INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS snapshots_revision_idx
  ON snapshots (revision_id, fragments_dir, target_path);

CREATE TABLE IF NOT EXISTS diffs (
  base_revision_id TEXT NOT NULL,
  head_revision_id TEXT NOT NULL,
  fragments_dir    TEXT NOT NULL,
  target_path      TEXT NOT NULL,
  data             TEXT NOT NULL,
  PRIMARY KEY (base_revision_id, head_revision_id, fragments_dir, target_path)
);

-- Read Model: Sync Worker가 갱신, Query는 여기만 조회
CREATE TABLE IF NOT EXISTS timeline_entries (
  revision_id        TEXT NOT NULL,
  fragments_dir      TEXT NOT NULL,
  target_path        TEXT NOT NULL,
  short_id           TEXT NOT NULL,
  timestamp          INTEGER NOT NULL,
  message            TEXT NOT NULL,
  author             TEXT,
  source             TEXT NOT NULL,
  source_ref         TEXT,
  affected_files     TEXT NOT NULL DEFAULT '[]',
  snapshot_cached    INTEGER NOT NULL DEFAULT 0,
  paths_added        INTEGER NOT NULL DEFAULT 0,
  paths_removed      INTEGER NOT NULL DEFAULT 0,
  paths_changed      INTEGER NOT NULL DEFAULT 0,
  breaking_changes   INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (revision_id, fragments_dir, target_path)
);

CREATE INDEX IF NOT EXISTS timeline_entries_ts_idx
  ON timeline_entries (fragments_dir, target_path, timestamp DESC);

CREATE TABLE IF NOT EXISTS path_entries (
  fragments_dir           TEXT NOT NULL,
  target_path             TEXT NOT NULL,
  path                    TEXT NOT NULL,
  methods                 TEXT NOT NULL DEFAULT '[]',
  canonical_id            TEXT NOT NULL,
  scope                   TEXT NOT NULL,
  domain                  TEXT NOT NULL,
  source_file             TEXT NOT NULL,
  content_hash            TEXT NOT NULL,
  last_changed_revision   TEXT NOT NULL,
  last_changed_timestamp  INTEGER NOT NULL,
  PRIMARY KEY (fragments_dir, target_path, path)
);

CREATE INDEX IF NOT EXISTS path_entries_filter_idx
  ON path_entries (fragments_dir, target_path, scope, domain);
