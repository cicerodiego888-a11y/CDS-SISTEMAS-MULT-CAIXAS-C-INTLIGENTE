/**
 * RC3.7.1 — Migração de status legados → canônicos (idempotente).
 * @module motores/central-entradas/services/CentralStatusMigracaoService
 */

'use strict';

const { MAPA_MIGRACAO_STATUS } = require('../core/DocumentoFiscalStatus');

/**
 * @param {import('sqlite3').Database} db
 * @returns {Promise<{ atualizados: number }>}
 */
function migrarStatusDocumentos(db) {
  return new Promise((resolve, reject) => {
    if (!db || typeof db.run !== 'function') {
      resolve({ atualizados: 0 });
      return;
    }

    const pares = Object.entries(MAPA_MIGRACAO_STATUS)
      .filter(([legado, canonico]) => legado !== canonico);

    let pendentes = pares.length;
    let atualizados = 0;
    if (!pendentes) {
      resolve({ atualizados: 0 });
      return;
    }

    pares.forEach(([legado, canonico]) => {
      db.run(
        `UPDATE central_entradas_documentos
         SET status = ?, updated_at = CURRENT_TIMESTAMP
         WHERE status = ?`,
        [canonico, legado],
        function onRun(err) {
          if (err) {
            console.error(`[RC3.7.1] falha migração status ${legado}→${canonico}:`, err.message);
          } else {
            atualizados += this.changes || 0;
            if (this.changes > 0) {
              console.log(`[RC3.7.1] status migrados ${legado} → ${canonico}: ${this.changes}`);
            }
          }
          pendentes -= 1;
          if (pendentes <= 0) resolve({ atualizados });
        }
      );
    });
  });
}

module.exports = {
  migrarStatusDocumentos
};
