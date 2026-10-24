ALTER TABLE import_metadata ADD COLUMN parser_version TEXT NOT NULL DEFAULT 'legacy';
CREATE TABLE entry_compatibility (
    entry_id INTEGER PRIMARY KEY REFERENCES entries(id) ON DELETE CASCADE,
    data_json TEXT NOT NULL CHECK(json_valid(data_json))
);
CREATE TABLE dictionary_repairs (
    repair_id TEXT PRIMARY KEY,
    source_sha256 TEXT NOT NULL,
    manifest_sha256 TEXT NOT NULL,
    applied_at TEXT NOT NULL
);
