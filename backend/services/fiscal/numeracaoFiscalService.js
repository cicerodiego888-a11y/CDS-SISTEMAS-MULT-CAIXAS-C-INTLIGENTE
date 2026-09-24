/**
 * Numeração fiscal genérica: empresa (CNPJ) + ambiente + modelo + série.
 * NFC-e (65) e NF-e (55) não compartilham sequência.
 */

'use strict';

const db = require('../../database');
const { onlyDigits } = require('./utils');

const LIMITE_NUMERO = 999999999;
const LIMITE_SERIE = 999;

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

function padModelo(modelo) {
  return String(modelo == null ? '' : modelo).replace(/\D/g, '').padStart(2, '0') || '55';
}

function cnpjChave(cnpj) {
  return onlyDigits(cnpj).padStart(14, '0').slice(-14) || '00000000000000';
}

function chaveLockNumeracao({ cnpj, ambiente, modelo, serie }) {
  return `fiscal-num:${cnpjChave(cnpj)}:${Number(ambiente)}:${padModelo(modelo)}:${Number(serie)}`;
}

function validarNumeracaoFiscal({ serie, proximoNumero } = {}) {
  const s = Number(serie);
  const n = Number(proximoNumero);
  if (!Number.isFinite(s) || s < 1 || s > LIMITE_SERIE || !Number.isInteger(s)) {
    const err = new Error('Série fiscal inválida. Informe um valor entre 1 e 999.');
    err.code = 'SERIE_INVALIDA';
    throw err;
  }
  if (!Number.isFinite(n) || n < 1 || n > LIMITE_NUMERO || !Number.isInteger(n)) {
    const err = new Error('Próximo número fiscal inválido. Informe um valor entre 1 e 999999999.');
    err.code = 'NUMERO_INVALIDO';
    throw err;
  }
  return { serie: s, proximoNumero: n };
}

function proximoLivreDeConjunto(inicio, ocupados) {
  const set = ocupados instanceof Set
    ? ocupados
    : new Set((ocupados || []).map((x) => Number(x)));
  let n = Math.max(1, Number(inicio) || 1);
  while (set.has(n)) n += 1;
  if (n > LIMITE_NUMERO) {
    const err = new Error('Limite de numeração fiscal (999999999) atingido.');
    err.code = 'NUMERO_LIMITE';
    throw err;
  }
  return n;
}

let tabelaOk = false;

async function garantirTabelaNumeracaoFiscal() {
  if (tabelaOk) return;
  await dbRun(`
    CREATE TABLE IF NOT EXISTS fiscal_numeracao (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      empresa_cnpj TEXT NOT NULL,
      ambiente INTEGER NOT NULL,
      modelo TEXT NOT NULL,
      serie INTEGER NOT NULL,
      proximo_numero INTEGER NOT NULL DEFAULT 1,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (empresa_cnpj, ambiente, modelo, serie)
    )
  `);
  tabelaOk = true;
}

async function obterLinhaNumeracao({ cnpj, ambiente, modelo, serie }) {
  await garantirTabelaNumeracaoFiscal();
  return dbGet(
    `SELECT * FROM fiscal_numeracao
     WHERE empresa_cnpj = ? AND CAST(ambiente AS INTEGER) = ?
       AND modelo = ? AND CAST(serie AS INTEGER) = ?`,
    [cnpjChave(cnpj), Number(ambiente), padModelo(modelo), Number(serie)]
  );
}

async function upsertNumeracao({ cnpj, ambiente, modelo, serie, proximoNumero }) {
  const v = validarNumeracaoFiscal({ serie, proximoNumero });
  await garantirTabelaNumeracaoFiscal();
  const emp = cnpjChave(cnpj);
  const amb = Number(ambiente);
  const mod = padModelo(modelo);
  await dbRun(
    `INSERT INTO fiscal_numeracao (empresa_cnpj, ambiente, modelo, serie, proximo_numero, updated_at)
     VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT(empresa_cnpj, ambiente, modelo, serie) DO UPDATE SET
       proximo_numero = excluded.proximo_numero,
       updated_at = CURRENT_TIMESTAMP`,
    [emp, amb, mod, v.serie, v.proximoNumero]
  );
  return {
    numero: v.proximoNumero,
    serie: v.serie,
    modelo: mod,
    ambiente: amb,
    empresaCnpj: emp
  };
}

async function maxLocalModelo({ modelo, serie, ambiente, cnpj }) {
  const s = Number(serie);
  const amb = Number(ambiente);
  const mod = padModelo(modelo);
  const emp = cnpjChave(cnpj);
  const q = async (sql, params) => {
    const row = await dbGet(sql, params).catch(() => null);
    return Number(row && row.m) || 0;
  };
  if (mod === '65') {
    const [notas, docs, ocup] = await Promise.all([
      q(
        `SELECT MAX(CAST(numero AS INTEGER)) AS m FROM nfce_notas
         WHERE CAST(serie AS INTEGER) = ? AND CAST(ambiente AS INTEGER) = ?`,
        [s, amb]
      ),
      q(
        `SELECT MAX(CAST(numero AS INTEGER)) AS m FROM fechamentos_fiscais_documentos
         WHERE CAST(serie AS INTEGER) = ? AND CAST(ambiente AS INTEGER) = ?`,
        [s, amb]
      ).catch(() => 0),
      q(
        `SELECT MAX(CAST(numero AS INTEGER)) AS m FROM nfce_numeros_ocupados_sefaz
         WHERE CAST(serie AS INTEGER) = ? AND CAST(ambiente AS INTEGER) = ?
           AND (cnpj IS NULL OR cnpj = ? OR cnpj = '')`,
        [s, amb, emp]
      ).catch(() => 0)
    ]);
    return Math.max(notas, docs, ocup);
  }
  const likeCnpj = `%${emp}%`;
  const [compra, venda, nfe, ocup] = await Promise.all([
    q(
      `SELECT MAX(CAST(numero AS INTEGER)) AS m FROM nfe_devolucoes_compra
       WHERE CAST(serie AS INTEGER) = ? AND CAST(ambiente AS INTEGER) = ?`,
      [s, amb]
    ),
    q(
      `SELECT MAX(CAST(numero AS INTEGER)) AS m FROM nfe_devolucoes_venda
       WHERE CAST(serie AS INTEGER) = ? AND CAST(ambiente AS INTEGER) = ?`,
      [s, amb]
    ),
    q(
      `SELECT MAX(CAST(numero AS INTEGER)) AS m FROM nfe_notas
       WHERE CAST(serie AS INTEGER) = ? AND CAST(ambiente AS INTEGER) = ?`,
      [s, amb]
    ),
    q(
      `SELECT MAX(CAST(numero AS INTEGER)) AS m FROM nfe_numeros_ocupados_sefaz
       WHERE CAST(serie AS INTEGER) = ? AND CAST(ambiente AS INTEGER) = ?
         AND (cnpj IS NULL OR cnpj = ? OR chave LIKE ?)`,
      [s, amb, emp, likeCnpj]
    )
  ]);
  return Math.max(compra, venda, nfe, ocup);
}

async function migrarNumeracaoSeNecessario({ cnpj, ambiente }) {
  await garantirTabelaNumeracaoFiscal();
  const emp = cnpjChave(cnpj);
  const amb = Number(ambiente || 2);
  const cfg = async (chave, padrao) => {
    const row = await dbGet(`SELECT valor FROM configuracoes WHERE chave = ?`, [chave]).catch(() => null);
    return row && row.valor != null && row.valor !== '' ? row.valor : padrao;
  };

  const serie65 = Number(await cfg('fiscal_serie', '1')) || 1;
  if (!(await obterLinhaNumeracao({ cnpj: emp, ambiente: amb, modelo: '65', serie: serie65 }))) {
    const atual65 = Number(await cfg('fiscal_numero_atual', '1')) || 1;
    const max65 = await maxLocalModelo({ modelo: '65', serie: serie65, ambiente: amb, cnpj: emp });
    const proximo65 = Math.max(1, atual65, max65 + 1);
    await upsertNumeracao({
      cnpj: emp, ambiente: amb, modelo: '65', serie: serie65, proximoNumero: proximo65
    });
  }

  const serie55 = Number(await cfg('fiscal_serie_nfe', await cfg('fiscal_serie', '1'))) || 1;
  if (!(await obterLinhaNumeracao({ cnpj: emp, ambiente: amb, modelo: '55', serie: serie55 }))) {
    const atual55 = Number(await cfg('fiscal_numero_atual_nfe', '')) || 0;
    const max55 = await maxLocalModelo({ modelo: '55', serie: serie55, ambiente: amb, cnpj: emp });
    const proximo55 = atual55 > 0 ? Math.max(atual55, max55 + 1) : Math.max(1, max55 + 1);
    await upsertNumeracao({
      cnpj: emp, ambiente: amb, modelo: '55', serie: serie55, proximoNumero: proximo55
    });
    const { setConfiguracao } = require('./configService');
    await setConfiguracao('fiscal_serie_nfe', String(serie55), 'number', 'Série da NF-e modelo 55');
    await setConfiguracao('fiscal_numero_atual_nfe', String(proximo55), 'number', 'Próximo número da NF-e modelo 55');
  }
}

async function obterProximaNumeracaoFiscal({
  empresaId,
  cnpj,
  ambiente,
  modelo,
  serie
} = {}) {
  const emp = cnpjChave(cnpj || empresaId);
  const amb = Number(ambiente);
  const mod = padModelo(modelo);
  const ser = Number(serie || 1);
  await migrarNumeracaoSeNecessario({ cnpj: emp, ambiente: amb });
  const linha = await obterLinhaNumeracao({ cnpj: emp, ambiente: amb, modelo: mod, serie: ser });
  const maxLocal = await maxLocalModelo({ modelo: mod, serie: ser, ambiente: amb, cnpj: emp });
  let proximo = Number(linha && linha.proximo_numero) || 1;
  if (!linha) {
    proximo = Math.max(1, maxLocal + 1);
  }
  return {
    numero: proximo,
    serie: ser,
    modelo: mod,
    ambiente: amb,
    empresaCnpj: emp,
    maiorLocal: maxLocal
  };
}

async function salvarProximaNumeracaoFiscal(params) {
  const v = validarNumeracaoFiscal({
    serie: params.serie,
    proximoNumero: params.proximoNumero
  });
  const out = await upsertNumeracao({
    cnpj: params.cnpj || params.empresaId,
    ambiente: params.ambiente,
    modelo: params.modelo,
    serie: v.serie,
    proximoNumero: v.proximoNumero
  });
  const { setConfiguracao } = require('./configService');
  const mod = padModelo(params.modelo);
  if (mod === '55') {
    await setConfiguracao('fiscal_serie_nfe', String(v.serie), 'number', 'Série da NF-e modelo 55');
    await setConfiguracao('fiscal_numero_atual_nfe', String(v.proximoNumero), 'number', 'Próximo número da NF-e modelo 55');
  }
  if (mod === '65') {
    await setConfiguracao('fiscal_serie', String(v.serie), 'number', 'Série da NFC-e');
    await setConfiguracao('fiscal_numero_atual', String(Math.max(0, v.proximoNumero - 1)), 'number', 'Próximo número da NFC-e');
  }
  return out;
}

function logReserva(tag, campos = {}) {
  const parts = Object.entries(campos)
    .filter(([, v]) => v != null && v !== '')
    .map(([k, v]) => `${String(k).toUpperCase()}=${v}`);
  // eslint-disable-next-line no-console
  console.log(`[FISCAL][NUMERACAO][${tag}] ${parts.join(' ')}`);
}

async function reservarProximaNumeracaoFiscal({
  empresaId,
  cnpj,
  ambiente,
  modelo,
  serie,
  ocupadosExtras,
  origem
} = {}) {
  const { withLockQueued } = require('./nfeEmissionLockService');
  const { setConfiguracao } = require('./configService');
  const emp = cnpjChave(cnpj || empresaId);
  const amb = Number(ambiente);
  const mod = padModelo(modelo);
  const ser = Number(serie || 1);
  const lock = chaveLockNumeracao({ cnpj: emp, ambiente: amb, modelo: mod, serie: ser });

  logReserva('LOCK', { lock, origem: origem || 'DESCONHECIDA' });

  return withLockQueued(lock, async () => {
    await migrarNumeracaoSeNecessario({ cnpj: emp, ambiente: amb });
    if (mod === '65') {
      try {
        const { reconciliarNumeracaoNfce } = require('./nfceNumeracaoOcupadosService');
        await reconciliarNumeracaoNfce({ cnpj: emp, ambiente: amb, serie: ser });
      } catch (_) { /* best-effort */ }
    }
    const peek = await obterProximaNumeracaoFiscal({
      cnpj: emp, ambiente: amb, modelo: mod, serie: ser
    });
    const ocupados = new Set([...(ocupadosExtras || [])].map((n) => Number(n)));
    if (mod === '55') {
      try {
        const { hidratarOcupadosDoHistorico, numeroOcupadoSefazEmMemoria } = require('./nfeNumeracaoNfeService');
        await hidratarOcupadosDoHistorico();
        let cand = peek.numero;
        while (numeroOcupadoSefazEmMemoria({ ambiente: amb, serie: ser, numero: cand })) {
          ocupados.add(cand);
          cand += 1;
        }
      } catch (_) { /* ocupados opcionais */ }
    }
    if (mod === '65') {
      try {
        const {
          hidratarOcupadosNfceDoHistorico,
          listarNumerosOcupadosNfce
        } = require('./nfceNumeracaoOcupadosService');
        await hidratarOcupadosNfceDoHistorico();
        const lista = await listarNumerosOcupadosNfce({ cnpj: emp, ambiente: amb, serie: ser });
        for (const n of lista) ocupados.add(Number(n));
      } catch (_) { /* ocupados opcionais */ }
    }
    const usado = proximoLivreDeConjunto(Math.max(peek.numero, (peek.maiorLocal || 0) + 1), ocupados);
    await upsertNumeracao({
      cnpj: emp, ambiente: amb, modelo: mod, serie: ser, proximoNumero: usado + 1
    });
    if (mod === '55') {
      await setConfiguracao('fiscal_numero_atual_nfe', String(usado + 1), 'number', 'Próximo número da NF-e modelo 55');
      await setConfiguracao('fiscal_serie_nfe', String(ser), 'number', 'Série da NF-e modelo 55');
    }
    if (mod === '65') {
      // Compatibilidade UX: fiscal_numero_atual = último nNF usado; UI deriva próximo = atual + 1.
      await setConfiguracao('fiscal_numero_atual', String(usado), 'number', 'Último número NFC-e utilizado');
      await setConfiguracao('fiscal_serie', String(ser), 'number', 'Série da NFC-e');
    }
    const out = {
      numero: usado,
      serie: ser,
      modelo: mod,
      ambiente: amb,
      empresaCnpj: emp,
      origem: origem || null
    };
    logReserva('RESERVA', {
      cnpj: emp,
      ambiente: amb,
      modelo: mod,
      serie: ser,
      numero: usado,
      origem: origem || (mod === '65' ? 'NFCe' : 'NFe')
    });
    if (mod === '65') {
      logReserva('NFCe', {
        cnpj: emp, ambiente: amb, modelo: 65, serie: ser, numero: usado, origem: origem || 'NFCe'
      });
    }
    return out;
  });
}

async function alinharProximoMinimoNfe({ cnpj, ambiente, serie, minimo }) {
  const peek = await obterProximaNumeracaoFiscal({
    cnpj, ambiente, modelo: '55', serie: serie || 1
  });
  const alvo = Math.max(peek.numero, Number(minimo) || 1);
  if (alvo > peek.numero) {
    await salvarProximaNumeracaoFiscal({
      cnpj, ambiente, modelo: '55', serie: peek.serie, proximoNumero: alvo
    });
  }
  return alvo;
}

async function alinharProximoMinimoNfce({ cnpj, ambiente, serie, minimo }) {
  const peek = await obterProximaNumeracaoFiscal({
    cnpj, ambiente, modelo: '65', serie: serie || 1
  });
  const alvo = Math.max(peek.numero, Number(minimo) || 1);
  if (alvo > peek.numero) {
    await salvarProximaNumeracaoFiscal({
      cnpj, ambiente, modelo: '65', serie: peek.serie, proximoNumero: alvo
    });
  }
  return alvo;
}

async function maxLocalModelo65(opts) {
  return maxLocalModelo({ ...opts, modelo: '65' });
}

module.exports = {
  LIMITE_NUMERO,
  LIMITE_SERIE,
  validarNumeracaoFiscal,
  chaveLockNumeracao,
  proximoLivreDeConjunto,
  garantirTabelaNumeracaoFiscal,
  migrarNumeracaoSeNecessario,
  obterProximaNumeracaoFiscal,
  salvarProximaNumeracaoFiscal,
  reservarProximaNumeracaoFiscal,
  alinharProximoMinimoNfe,
  alinharProximoMinimoNfce,
  maxLocalModelo65,
  cnpjChave,
  padModelo,
  upsertNumeracao
};
