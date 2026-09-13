'use strict';

/**
 * Adaptadores CIP — apenas consomem motores/dados existentes (não duplicam lógica MIB/MIIP/MUC).
 */

function all(db, sql, params = []) {
  return new Promise((resolve) => {
    db.all(sql, params, (err, rows) => resolve(err ? [] : (rows || [])));
  });
}

function get(db, sql, params = []) {
  return new Promise((resolve) => {
    db.get(sql, params, (err, row) => resolve(err ? null : row));
  });
}

async function coletarMib(db) {
  try {
    const { obterKnowledge, obterSearchService, obterMib } = require('../../mib');
    const mib = obterMib(db);
    if (typeof mib._ensure === 'function') await mib._ensure();
    let knowledge = null;
    try {
      knowledge = await obterKnowledge(db).dashboard();
    } catch (_) { /* grafo pode estar vazio */ }
    let search = null;
    try {
      const svc = obterSearchService(db);
      if (!svc._pronto) await svc.iniciar();
      const st = svc.statistics();
      search = {
        tempoMedio: st.tempoMedio,
        providers: st.providersAtivos,
        cacheHits: st.cacheHits
      };
    } catch (_) { /* ignore */ }
    return { motor: 'MIB', ok: true, knowledge, search };
  } catch (err) {
    return { motor: 'MIB', ok: false, erro: err.message };
  }
}

async function coletarMiip() {
  try {
    const { getMiipService } = require('../../miip/getMiipService');
    const miip = getMiipService();
    const habilitado = typeof miip.estaHabilitado === 'function' ? miip.estaHabilitado() : null;
    return {
      motor: 'MIIP',
      ok: true,
      habilitado,
      nota: 'CIP consome MIIP sob demanda; não duplica DecisionEngine MIIP'
    };
  } catch (err) {
    return { motor: 'MIIP', ok: false, erro: err.message };
  }
}

async function coletarMuc() {
  try {
    const ver = require('../../muc/version');
    return {
      motor: 'MUC',
      ok: true,
      versao: ver.VERSAO || ver.CODIGO || 'MUC',
      tag: ver.TAG || null,
      nota: 'CIP não reimplementa conversão de unidades'
    };
  } catch (err) {
    return { motor: 'MUC', ok: false, erro: err.message };
  }
}

async function coletarEstoque(db) {
  let criticos = await all(
    db,
    `SELECT id, nome, codigo, estoque_atual, estoque_minimo
     FROM produtos
     WHERE COALESCE(ativo, 1) = 1
       AND COALESCE(controla_estoque, 1) = 1
       AND COALESCE(estoque_minimo, 0) > 0
       AND COALESCE(estoque_atual, 0) <= COALESCE(estoque_minimo, 0)
     ORDER BY (estoque_minimo - estoque_atual) DESC
     LIMIT 30`
  );
  if (!criticos.length) {
    // schema mínimo sem controla_estoque
    criticos = await all(
      db,
      `SELECT id, nome, codigo, estoque_atual, estoque_minimo
       FROM produtos
       WHERE COALESCE(ativo, 1) = 1
         AND COALESCE(estoque_minimo, 0) > 0
         AND COALESCE(estoque_atual, 0) <= COALESCE(estoque_minimo, 0)
       LIMIT 30`
    );
  }
  let zerados = await get(
    db,
    `SELECT COUNT(*) AS n FROM produtos
     WHERE COALESCE(ativo, 1) = 1 AND COALESCE(estoque_atual, 0) <= 0`
  );
  return {
    motor: 'Estoque',
    ok: true,
    criticos,
    produtosZerados: Number(zerados?.n) || 0
  };
}

async function coletarFinanceiro(db) {
  const vencidas = await get(
    db,
    `SELECT COUNT(*) AS n, COALESCE(SUM(valor_restante), 0) AS total
     FROM contas_receber
     WHERE LOWER(COALESCE(status, '')) IN ('aberto', 'parcial', '')
       AND date(data_vencimento) < date('now')`
  );
  const aVencer = await get(
    db,
    `SELECT COUNT(*) AS n, COALESCE(SUM(valor_restante), 0) AS total
     FROM contas_receber
     WHERE LOWER(COALESCE(status, '')) IN ('aberto', 'parcial', '')
       AND date(data_vencimento) BETWEEN date('now') AND date('now', '+7 day')`
  );
  return {
    motor: 'Financeiro',
    ok: true,
    contasVencidas: Number(vencidas?.n) || 0,
    valorVencido: Number(vencidas?.total) || 0,
    contasAVencer7d: Number(aVencer?.n) || 0,
    valorAVencer7d: Number(aVencer?.total) || 0
  };
}

async function coletarFiscal(db) {
  const row = await get(
    db,
    `SELECT COUNT(*) AS n FROM produtos
     WHERE COALESCE(ativo, 1) = 1
       AND COALESCE(item_fiscal, 1) = 1
       AND (ncm IS NULL OR TRIM(ncm) = '')`
  );
  return { motor: 'Fiscal', ok: true, produtosSemNcm: Number(row?.n) || 0 };
}

async function coletarVendas(db) {
  // total pode não existir em todos os schemas — fallback sem SUM
  let dias = await all(
    db,
    `SELECT date(data_venda) AS dia, COUNT(*) AS vendas
     FROM vendas
     WHERE COALESCE(cancelada, 0) = 0
       AND date(data_venda) >= date('now', '-30 day')
     GROUP BY date(data_venda)
     ORDER BY dia ASC`
  );
  return { motor: 'Vendas', ok: true, serie30d: dias };
}

async function coletarSinais(db) {
  const [mib, miip, muc, estoque, financeiro, fiscal, vendas] = await Promise.all([
    coletarMib(db),
    coletarMiip(),
    coletarMuc(),
    coletarEstoque(db),
    coletarFinanceiro(db),
    coletarFiscal(db),
    coletarVendas(db)
  ]);
  return { mib, miip, muc, estoque, financeiro, fiscal, vendas, coletadoEm: new Date().toISOString() };
}

module.exports = {
  coletarSinais,
  coletarMib,
  coletarMiip,
  coletarMuc,
  coletarEstoque,
  coletarFinanceiro,
  coletarFiscal,
  coletarVendas
};
