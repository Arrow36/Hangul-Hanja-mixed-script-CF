CREATE TABLE IF NOT EXISTS entry_raw_chunks (entry_id INTEGER NOT NULL, chunk_index INTEGER NOT NULL, content TEXT NOT NULL, PRIMARY KEY(entry_id, chunk_index));
