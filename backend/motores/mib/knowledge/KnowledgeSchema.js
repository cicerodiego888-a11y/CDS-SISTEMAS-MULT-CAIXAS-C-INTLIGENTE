'use strict';

/**
 * Schema SQLite do Knowledge Graph (MIB-RC4.0).
 */
function garantirSchemaKnowledge(db) {
  return new Promise((resolve) => {
    const ddl = [
      `CREATE TABLE IF NOT EXISTS mib_kg_nodes (
        id TEXT PRIMARY KEY,
        tipo TEXT NOT NULL,
        ref_id INTEGER,
        label TEXT,
        meta TEXT,
        atualizado_em DATETIME DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE INDEX IF NOT EXISTS idx_mib_kg_nodes_tipo ON mib_kg_nodes(tipo)`,
      `CREATE INDEX IF NOT EXISTS idx_mib_kg_nodes_ref ON mib_kg_nodes(tipo, ref_id)`,
      `CREATE TABLE IF NOT EXISTS mib_kg_edges (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        from_id TEXT NOT NULL,
        to_id TEXT NOT NULL,
        relacao TEXT NOT NULL,
        peso REAL DEFAULT 1,
        origem TEXT DEFAULT 'auto',
        meta TEXT,
        atualizado_em DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(from_id, to_id, relacao)
      )`,
      `CREATE INDEX IF NOT EXISTS idx_mib_kg_edges_from ON mib_kg_edges(from_id, relacao)`,
      `CREATE INDEX IF NOT EXISTS idx_mib_kg_edges_to ON mib_kg_edges(to_id, relacao)`,
      `CREATE TABLE IF NOT EXISTS mib_kg_clusters (
        id TEXT PRIMARY KEY,
        nome TEXT,
        tamanho INTEGER DEFAULT 0,
        centroide_id TEXT,
        meta TEXT,
        atualizado_em DATETIME DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE TABLE IF NOT EXISTS mib_kg_rebuild_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        nos INTEGER,
        arestas INTEGER,
        clusters INTEGER,
        tempo_ms REAL,
        ok INTEGER DEFAULT 1,
        criado_em DATETIME DEFAULT CURRENT_TIMESTAMP
      )`
    ];
    let i = 0;
    const next = () => {
      if (i >= ddl.length) return resolve();
      db.run(ddl[i++], () => next());
    };
    next();
  });
}

module.exports = { garantirSchemaKnowledge };
