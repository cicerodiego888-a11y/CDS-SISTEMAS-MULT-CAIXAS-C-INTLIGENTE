/**
 * Numeração NF-e modelo 55: não reutiliza nNF comprovadamente ocupado na SEFAZ (rejeição 539).
 * Não altera XML, chave ou número de documentos já emitidos.
 */

'use strict';

const db = require('../../database');
const { onlyDigits } = require('./utils');

function parseChaveNfe(chave) {
  const c = onlyDigits(chave);
  if (c.length !== 44) return null;
  return {
    uf: c.slice(0, 2),
    aamm: c.slice(2, 6),
    cnpj: c.slice(6, 20),
    modelo: c.slice(20, 22),
    serie: Number(c.slice(22, 25)),
    numero: Number(c.slice(25, 34)),
    tpEmis: c.slice(34, 35),
    cNF: c.slice(35, 43),
    chave: c
  };
}

const ocupadosMemoria = new Set();
let tabelaOk = false;
let hidratado = false;

function chaveOcupacao(ambiente, serie, numero) {
  return `${Number(ambiente)}|${Number(serie)}|${Number(numero)}`;
}

function extrairChaveConflito539(xMotivo, xmlRetorno) {
  const texto = `${xMotivo || ''}\n${xmlRetorno || ''}`;
  const m = texto.match(/chNFe[:\s]*([0-9]{44})/i) || texto.match(/\[chNFe:([0-9]{44})\]/i);
  return m ? m[1] : null;
}

function proximoNumeroLivre(inicio, ocupados) {
  const set = ocupados instanceof Set
    ? ocupados
    : new Set((ocupados || []).map((n) => Number(n)));
  let n = Math.max(1, Number(inicio) || 1);
  while (set.has(n)) n += 1;
  return n;
}

function dbRun(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(err) {
      if (err) return reject(err);
      resolve({ lastID: this.lastID, changes: this.changes });
    });
  });
}

function dbGet(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row || null)));
  });
}

function dbAll(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows || [])));
  });
}

async function garantirTabelaNumerosOcupados() {
  if (tabelaOk) return;
  await dbRun(`
    CREATE TABLE IF NOT EXISTS nfe_numeros_ocupados_sefaz (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      cnpj TEXT,
      modelo TEXT DEFAULT '55',
      serie INTEGER NOT NULL,
      numero INTEGER NOT NULL,
      ambiente INTEGER,
      chave TEXT,
      origem TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (cnpj, modelo, serie, numero, ambiente)
    )
  `);
  tabelaOk = true;
}

function marcarOcupadoMemoria({ ambiente, serie, numero }) {
  if (numero == null) return;
  ocupadosMemoria.add(chaveOcupacao(ambiente, serie, numero));
}

function numeroOcupadoSefazEmMemoria({ ambiente, serie, numero } = {}) {
  if (numero == null) return false;
  return ocupadosMemoria.has(chaveOcupacao(ambiente, serie, numero));
}

async function registrarNumeroOcupadoSefaz({
  cnpj,
  modelo = '55',
  serie,
  numero,
  ambiente,
  chave,
  origem = '539'
} = {}) {
  const n = Number(numero);
  const s = Number(serie || 1);
  const amb = ambiente != null ? Number(ambiente) : 2;
  if (!n) return null;
  marcarOcupadoMemoria({ ambiente: amb, serie: s, numero: n });
  await garantirTabelaNumerosOcupados();
  const cnpjLimpo = String(cnpj || '').replace(/\D/g, '');
  try {
    await dbRun(
      `INSERT OR IGNORE INTO nfe_numeros_ocupados_sefaz
       (cnpj, modelo, serie, numero, ambiente, chave, origem)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [cnpjLimpo || null, String(modelo || '55'), s, n, amb, chave || null, origem]
    );
  } catch (_) { /* tabela/coluna */ }
  return { numero: n, serie: s, ambiente: amb, chave: chave || null };
}

async function hidratarOcupadosDoHistorico() {
  if (hidratado) return;
  await garantirTabelaNumerosOcupados();
  const rows = await dbAll(`SELECT cnpj, serie, numero, ambiente FROM nfe_numeros_ocupados_sefaz`).catch(() => []);
  for (const r of rows) {
    marcarOcupadoMemoria(r);
  }
  const historico = await dbAll(`
    SELECT numero, serie, ambiente, chave_acesso, xmotivo_retorno, xml_retorno, cstat_retorno, rejeicao_codigo
    FROM nfe_devolucoes_compra
    WHERE CAST(cstat_retorno AS TEXT) = '539' OR CAST(rejeicao_codigo AS TEXT) = '539'
  `).catch(() => []);
  const historicoVenda = await dbAll(`
    SELECT numero, serie, ambiente, chave_acesso, xmotivo_retorno, xml_retorno, cstat_retorno, rejeicao_codigo
    FROM nfe_devolucoes_venda
    WHERE CAST(cstat_retorno AS TEXT) = '539' OR CAST(rejeicao_codigo AS TEXT) = '539'
  `).catch(() => []);
  for (const row of [...historico, ...historicoVenda]) {
    const chaveSefaz = extrairChaveConflito539(row.xmotivo_retorno, row.xml_retorno);
    const parsed = parseChaveNfe(chaveSefaz);
    const serie = parsed ? parsed.serie : row.serie;
    const numero = parsed ? parsed.numero : row.numero;
    const cnpj = parsed ? parsed.cnpj : null;
    await registrarNumeroOcupadoSefaz({
      cnpj,
      serie,
      numero,
      ambiente: row.ambiente,
      chave: chaveSefaz,
      origem: '539-historico'
    });
    if (row.numero && Number(row.numero) !== Number(numero)) {
      await registrarNumeroOcupadoSefaz({
        cnpj,
        serie: row.serie,
        numero: row.numero,
        ambiente: row.ambiente,
        chave: row.chave_acesso,
        origem: '539-local'
      });
    }
  }
  hidratado = true;
}

async function maiorNumeroConhecido({ serie, ambiente }) {
  const s = Number(serie || 1);
  const amb = ambiente != null ? Number(ambiente) : null;
  const ambSql = amb != null ? 'AND CAST(ambiente AS INTEGER) = ?' : '';
  const paramsDev = amb != null ? [s, amb] : [s];
  const q = async (sql, params) => {
    const row = await dbGet(sql, params).catch(() => null);
    return Number(row && row.m) || 0;
  };
  const local = await Promise.all([
    q(`SELECT MAX(CAST(numero AS INTEGER)) AS m FROM nfe_devolucoes_compra WHERE CAST(serie AS INTEGER) = ? ${ambSql}`, paramsDev),
    q(`SELECT MAX(CAST(numero AS INTEGER)) AS m FROM nfe_devolucoes_venda WHERE CAST(serie AS INTEGER) = ? ${ambSql}`, paramsDev),
    q(`SELECT MAX(CAST(numero AS INTEGER)) AS m FROM nfe_notas WHERE CAST(serie AS INTEGER) = ? ${ambSql}`, paramsDev),
    q(`SELECT MAX(CAST(numero AS INTEGER)) AS m FROM nfe_numeros_ocupados_sefaz WHERE CAST(serie AS INTEGER) = ? ${ambSql}`, paramsDev)
  ]);
  let maxMem = 0;
  for (const k of ocupadosMemoria) {
    const parts = k.split('|');
    if (Number(parts[1]) === s && (amb == null || Number(parts[0]) === amb)) {
      maxMem = Math.max(maxMem, Number(parts[2]) || 0);
    }
  }
  return Math.max(maxMem, ...local);
}

async function alinharContadorNfe(minimo) {
  const { alinharProximoMinimoNfe } = require('./numeracaoFiscalService');
  const cnpjRow = await dbGet(`SELECT valor FROM configuracoes WHERE chave = ?`, ['cnpj']).catch(() => null);
  const ambRow = await dbGet(`SELECT valor FROM configuracoes WHERE chave = ?`, ['fiscal_ambiente']).catch(() => null);
  const serRow = await dbGet(`SELECT valor FROM configuracoes WHERE chave = ?`, ['fiscal_serie_nfe']).catch(() => null);
  return alinharProximoMinimoNfe({
    cnpj: cnpjRow && cnpjRow.valor,
    ambiente: Number((ambRow && ambRow.valor) || 2),
    serie: Number((serRow && serRow.valor) || 1),
    minimo
  });
}

function getConfigNumero() {
  return dbGet(`SELECT valor FROM configuracoes WHERE chave = ?`, ['fiscal_numero_atual_nfe'])
    .then((r) => (r && r.valor) || '1');
}

async function aplicarOcupacaoPorRejeicao539({ parsed = {}, nota = {}, ambiente } = {}) {
  const chaveSefaz = extrairChaveConflito539(parsed.xMotivo, parsed.raw || nota.xml_retorno);
  if (!chaveSefaz) {
    return { chaveSefaz: null, numeroOcupadoSefaz: null, numeroOcupadoLocal: nota.numero || null, proximoMinimo: null };
  }
  const idSefaz = parseChaveNfe(chaveSefaz);
  const serie = (idSefaz && idSefaz.serie) || nota.serie || 1;
  const numeroSefaz = (idSefaz && idSefaz.numero) || null;
  const numeroLocal = nota.numero != null ? Number(nota.numero) : null;
  const amb = ambiente != null ? ambiente : nota.ambiente;
  const cnpj = (idSefaz && idSefaz.cnpj) || null;
  if (numeroSefaz) {
    await registrarNumeroOcupadoSefaz({
      cnpj, serie, numero: numeroSefaz, ambiente: amb, chave: chaveSefaz, origem: '539'
    });
  }
  if (numeroLocal) {
    await registrarNumeroOcupadoSefaz({
      cnpj, serie: nota.serie || serie, numero: numeroLocal, ambiente: amb,
      chave: nota.chave_acesso, origem: '539-local'
    });
  }
  const ocupado = Math.max(Number(numeroSefaz) || 0, Number(numeroLocal) || 0);
  if (ocupado) await alinharContadorNfe(ocupado + 1);
  return {
    chaveSefaz,
    numeroOcupadoSefaz: numeroSefaz,
    numeroOcupadoLocal: numeroLocal,
    proximoMinimo: ocupado ? ocupado + 1 : null
  };
}

async function reservarProximoNumeroNfe({ serie, ambiente, cnpj } = {}) {
  const { reservarProximaNumeracaoFiscal } = require('./numeracaoFiscalService');
  await hidratarOcupadosDoHistorico();
  const s = Number(serie || 1);
  const amb = ambiente != null ? Number(ambiente) : 2;
  const ocupados = [];
  for (const k of ocupadosMemoria) {
    const parts = k.split('|');
    if (Number(parts[0]) === amb && Number(parts[1]) === s) ocupados.push(Number(parts[2]));
  }
  const reserved = await reservarProximaNumeracaoFiscal({
    cnpj,
    ambiente: amb,
    modelo: '55',
    serie: s,
    ocupadosExtras: ocupados
  });
  return reserved.numero;
}

function resetNumeracaoForTests() {
  ocupadosMemoria.clear();
  hidratado = false;
  tabelaOk = false;
}

module.exports = {
  extrairChaveConflito539,
  proximoNumeroLivre,
  registrarNumeroOcupadoSefaz,
  numeroOcupadoSefazEmMemoria,
  hidratarOcupadosDoHistorico,
  aplicarOcupacaoPorRejeicao539,
  reservarProximoNumeroNfe,
  alinharContadorNfe,
  resetNumeracaoForTests,
  marcarOcupadoMemoria
};
