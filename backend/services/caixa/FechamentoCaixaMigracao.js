/**
 * Diagnóstico estrutural do fechamento — não apaga dados.
 * Índice único só é criado quando não há duplicidade histórica.
 */
'use strict';

function promisifyAll(database, sql, params = []) {
  return new Promise((resolve, reject) => {
    database.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows || [])));
  });
}

function promisifyRun(database, sql, params = []) {
  return new Promise((resolve, reject) => {
    database.run(sql, params, function cb(err) {
      if (err) reject(err);
      else resolve(this);
    });
  });
}

async function diagnosticarFechamentos(database) {
  const diagnostico = {
    ok: true,
    pode_criar_indice_unico: true,
    duplicados: [],
    sessoes_sem_fechamento: [],
    fechamentos_sem_sessao: [],
    tipos_movimentacao: [],
    erros: []
  };

  try {
    diagnostico.duplicados = await promisifyAll(
      database,
      `
        SELECT sessao_id, COUNT(*) AS quantidade, GROUP_CONCAT(id) AS ids
        FROM caixa_fechamentos
        WHERE sessao_id IS NOT NULL
        GROUP BY sessao_id
        HAVING COUNT(*) > 1
      `
    );
  } catch (err) {
    diagnostico.erros.push(`duplicados: ${err.message}`);
  }

  try {
    diagnostico.sessoes_sem_fechamento = await promisifyAll(
      database,
      `
        SELECT s.id AS sessao_id, s.status
        FROM caixa_sessoes s
        LEFT JOIN caixa_fechamentos f ON f.sessao_id = s.id
        WHERE LOWER(TRIM(COALESCE(s.status, ''))) = 'fechado'
          AND f.id IS NULL
        LIMIT 50
      `
    );
  } catch (err) {
    diagnostico.erros.push(`sessoes_sem_fechamento: ${err.message}`);
  }

  try {
    diagnostico.fechamentos_sem_sessao = await promisifyAll(
      database,
      `
        SELECT id, sessao_id, caixa_id
        FROM caixa_fechamentos
        WHERE sessao_id IS NULL
        LIMIT 50
      `
    );
  } catch (err) {
    diagnostico.erros.push(`fechamentos_sem_sessao: ${err.message}`);
  }

  try {
    diagnostico.tipos_movimentacao = await promisifyAll(
      database,
      `SELECT DISTINCT tipo FROM caixa_movimentacoes ORDER BY tipo`
    );
  } catch (err) {
    diagnostico.erros.push(`tipos_movimentacao: ${err.message}`);
  }

  if (diagnostico.duplicados.length > 0) {
    diagnostico.ok = false;
    diagnostico.pode_criar_indice_unico = false;
    diagnostico.erros.push(
      `Existem ${diagnostico.duplicados.length} sessões com fechamento duplicado. Índice único NÃO será criado.`
    );
  }

  return diagnostico;
}

async function aplicarIndiceUnicoSeSeguro(database) {
  const diagnostico = await diagnosticarFechamentos(database);
  if (!diagnostico.pode_criar_indice_unico) {
    console.error('[FECHAMENTO V2] Migração de índice único bloqueada:', diagnostico.erros.join(' | '));
    return diagnostico;
  }
  try {
    await promisifyRun(
      database,
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_caixa_fechamentos_sessao_unica
       ON caixa_fechamentos(sessao_id)
       WHERE sessao_id IS NOT NULL`
    );
    diagnostico.indice_unico = true;
  } catch (err) {
    diagnostico.ok = false;
    diagnostico.indice_unico = false;
    diagnostico.erros.push(`indice: ${err.message}`);
    console.error('[FECHAMENTO V2] Falha ao criar índice único:', err.message);
  }
  return diagnostico;
}

module.exports = {
  diagnosticarFechamentos,
  aplicarIndiceUnicoSeSeguro
};
