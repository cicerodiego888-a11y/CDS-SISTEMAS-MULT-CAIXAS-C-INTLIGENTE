'use strict';

const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const { resolverCaminhoBanco } = require('../../backend/diagnostics/databasePath');

const COLUNAS_ESPERADAS = Object.freeze({
  tef_logs: ['id', 'transacao_id', 'tipo', 'payload', 'criado_em'],
  tef_transacoes: ['id', 'status', 'idempotency_key', 'codigo_transacao', 'payload_retorno']
});
const TIPOS_EVIDENCIA = [
  'RECONCILIACAO_RESULTADO_TARDIO',
  'TEF_RECONCILIACAO_LIBERADA',
  'TEF_RECONCILIACAO_COMMIT_CONFIRMADO'
];

function caminhoSolicitado() {
  const index = process.argv.indexOf('--db-path');
  if (index === -1) return resolverCaminhoBanco();
  const value = process.argv[index + 1];
  if (!value || value.startsWith('--')) {
    throw new Error('Uso: node mrt-50-3-db-compat-readonly.js [--db-path <caminho>]');
  }
  return path.resolve(value);
}

function executar(db, sql, parametros = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, parametros, (error, rows) =>
      (error ? reject(error) : resolve(rows || [])));
  });
}

async function verificar() {
  const dbPath = caminhoSolicitado();
  const caminhoResolvido = path.resolve(resolverCaminhoBanco());
  if (dbPath !== caminhoResolvido) {
    throw new Error(`Caminho solicitado diverge do caminho efetivo resolvido: ${caminhoResolvido}`);
  }
  if (!fs.existsSync(dbPath) || !fs.statSync(dbPath).isFile()) {
    throw new Error(`Arquivo SQLite inexistente ou inválido: ${dbPath}`);
  }

  const db = new sqlite3.Database(dbPath, sqlite3.OPEN_READONLY);
  try {
    await new Promise((resolve, reject) => {
      db.run('PRAGMA query_only = ON', (error) => (error ? reject(error) : resolve()));
    });

    const integridade = await executar(db, 'PRAGMA integrity_check');
    const colunas = {};
    for (const [tabela, esperadas] of Object.entries(COLUNAS_ESPERADAS)) {
      const info = await executar(db, `PRAGMA table_info(${tabela})`);
      const presentes = new Set(info.map((item) => item.name));
      colunas[tabela] = {
        presentes: [...presentes].sort(),
        ausentes: esperadas.filter((coluna) => !presentes.has(coluna))
      };
    }

    const tipos = await executar(
      db,
      `SELECT tipo, COUNT(*) AS total
       FROM tef_logs
       WHERE tipo IN (?, ?, ?)
       GROUP BY tipo
       ORDER BY tipo`,
      TIPOS_EVIDENCIA
    );
    const infoLogs = await executar(db, 'PRAGMA table_info(tef_logs)');
    const relatorio = {
      effectiveDatabasePath: dbPath,
      pathMatchesResolver: true,
      readOnly: true,
      integrityCheck: integridade.length === 1 && integridade[0].integrity_check === 'ok'
        ? 'ok'
        : integridade,
      columns: colunas,
      hashIntegridadeColumnPresent: infoLogs.some((item) => item.name === 'hash_integridade'),
      reconciliationEventCounts: tipos
    };
    relatorio.compatible = relatorio.integrityCheck === 'ok'
      && Object.values(colunas).every((item) => item.ausentes.length === 0);
    if (!relatorio.compatible) process.exitCode = 1;
    console.log(JSON.stringify(relatorio, null, 2));
  } finally {
    await new Promise((resolve) => db.close(() => resolve()));
  }
}

verificar().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
