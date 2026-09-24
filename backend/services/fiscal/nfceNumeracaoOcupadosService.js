/**
 * NFC-e 65 — números já ocupados na SEFAZ (ex.: CStat 539 com chave diferente).
 * Não representa autorização local; impede reutilização do nNF.
 */

'use strict';

const db = require('../../database');
const { onlyDigits } = require('./utils');

const ocupadosMemoria = new Set();
let tabelaOk = false;
let hidratado = false;

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

function chaveOcupacao(cnpj, ambiente, serie, numero) {
  const emp = onlyDigits(cnpj).padStart(14, '0').slice(-14) || '00000000000000';
  return `${emp}|${Number(ambiente)}|${Number(serie)}|${Number(numero)}`;
}

function parseChaveNfce(chave) {
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

function extrairChaveConflito539(xMotivo, xmlRetorno) {
  const texto = `${xMotivo || ''}\n${xmlRetorno || ''}`;
  const m = texto.match(/chNFe[:\s]*([0-9]{44})/i)
    || texto.match(/\[chNFe:([0-9]{44})\]/i)
    || texto.match(/<chNFe>\s*([0-9]{44})\s*<\/chNFe>/i);
  return m ? m[1] : null;
}

function logNum(tag, campos = {}) {
  const parts = Object.entries(campos)
    .filter(([, v]) => v != null && v !== '')
    .map(([k, v]) => `${String(k).toUpperCase()}=${v}`);
  // eslint-disable-next-line no-console
  console.log(`[FISCAL][NUMERACAO][${tag}] ${parts.join(' ')}`);
}

async function garantirTabelaNfceOcupadosSefaz() {
  if (tabelaOk) return;
  await dbRun(`
    CREATE TABLE IF NOT EXISTS nfce_numeros_ocupados_sefaz (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      cnpj TEXT NOT NULL,
      ambiente INTEGER NOT NULL,
      serie INTEGER NOT NULL,
      numero INTEGER NOT NULL,
      chave TEXT,
      origem TEXT,
      cstat TEXT,
      xmotivo TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(cnpj, ambiente, serie, numero)
    )
  `);
  tabelaOk = true;
}

function marcarOcupadoMemoria({ cnpj, ambiente, serie, numero }) {
  if (numero == null) return;
  ocupadosMemoria.add(chaveOcupacao(cnpj, ambiente, serie, numero));
}

function numeroOcupadoSefazEmMemoria({ cnpj, ambiente, serie, numero } = {}) {
  if (numero == null) return false;
  return ocupadosMemoria.has(chaveOcupacao(cnpj, ambiente, serie, numero));
}

async function registrarNumeroOcupadoSefazNfce({
  cnpj,
  ambiente,
  serie,
  numero,
  chave = null,
  origem = '539',
  cstat = null,
  xmotivo = null
} = {}) {
  const n = Number(numero);
  const s = Number(serie || 1);
  const amb = ambiente != null ? Number(ambiente) : 2;
  const emp = onlyDigits(cnpj).padStart(14, '0').slice(-14) || '00000000000000';
  if (!n) return null;

  await garantirTabelaNfceOcupadosSefaz();
  marcarOcupadoMemoria({ cnpj: emp, ambiente: amb, serie: s, numero: n });

  try {
    await dbRun(
      `INSERT INTO nfce_numeros_ocupados_sefaz
         (cnpj, ambiente, serie, numero, chave, origem, cstat, xmotivo)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(cnpj, ambiente, serie, numero) DO UPDATE SET
         chave = COALESCE(excluded.chave, nfce_numeros_ocupados_sefaz.chave),
         origem = COALESCE(excluded.origem, nfce_numeros_ocupados_sefaz.origem),
         cstat = COALESCE(excluded.cstat, nfce_numeros_ocupados_sefaz.cstat),
         xmotivo = COALESCE(excluded.xmotivo, nfce_numeros_ocupados_sefaz.xmotivo)`,
      [emp, amb, s, n, chave || null, origem || null, cstat != null ? String(cstat) : null, xmotivo || null]
    );
  } catch (_) { /* schema legado */ }

  logNum('OCUPADO_SEFAZ', {
    cnpj: emp, ambiente: amb, modelo: 65, serie: s, numero: n, chave, origem, cstat
  });

  return { numero: n, serie: s, ambiente: amb, chave: chave || null, cnpj: emp };
}

async function listarNumerosOcupadosNfce({ cnpj, ambiente, serie } = {}) {
  await garantirTabelaNfceOcupadosSefaz();
  const emp = onlyDigits(cnpj).padStart(14, '0').slice(-14);
  const amb = Number(ambiente);
  const s = Number(serie || 1);
  const rows = await dbAll(
    `SELECT numero FROM nfce_numeros_ocupados_sefaz
     WHERE cnpj = ? AND CAST(ambiente AS INTEGER) = ? AND CAST(serie AS INTEGER) = ?`,
    [emp, amb, s]
  ).catch(() => []);
  const set = new Set(rows.map((r) => Number(r.numero)).filter((n) => n > 0));
  for (const k of ocupadosMemoria) {
    const [c, a, ser, num] = k.split('|');
    if (c === emp && Number(a) === amb && Number(ser) === s) set.add(Number(num));
  }
  return [...set];
}

async function hidratarOcupadosNfceDoHistorico() {
  if (hidratado) return;
  await garantirTabelaNfceOcupadosSefaz();

  const rows = await dbAll(
    `SELECT cnpj, ambiente, serie, numero, chave FROM nfce_numeros_ocupados_sefaz`
  ).catch(() => []);
  for (const r of rows) marcarOcupadoMemoria(r);

  const notas539 = await dbAll(`
    SELECT numero, serie, ambiente, chave_acesso, xml_retorno, status
    FROM nfce_notas
    WHERE CAST(status AS TEXT) LIKE '%duplicidade%'
       OR CAST(status AS TEXT) = 'rejeitada_duplicidade'
       OR CAST(xml_retorno AS TEXT) LIKE '%<cStat>539</cStat>%'
       OR CAST(xml_retorno AS TEXT) LIKE '%cStat>539<%'
  `).catch(() => []);

  for (const row of notas539) {
    const chaveSefaz = extrairChaveConflito539(null, row.xml_retorno);
    const parsed = parseChaveNfce(chaveSefaz);
    const serie = parsed ? parsed.serie : row.serie;
    const numeroSefaz = parsed ? parsed.numero : null;
    const cnpj = parsed ? parsed.cnpj : null;
    const amb = row.ambiente;

    if (numeroSefaz) {
      await registrarNumeroOcupadoSefazNfce({
        cnpj,
        ambiente: amb,
        serie,
        numero: numeroSefaz,
        chave: chaveSefaz,
        origem: '539-historico',
        cstat: '539'
      });
    }
    if (row.numero) {
      await registrarNumeroOcupadoSefazNfce({
        cnpj: cnpj || '',
        ambiente: amb,
        serie: row.serie || serie || 1,
        numero: row.numero,
        chave: row.chave_acesso || chaveSefaz,
        origem: '539-local',
        cstat: '539'
      });
    }
  }

  const docs539 = await dbAll(`
    SELECT numero, serie, ambiente, chave_acesso, xml_retorno, cstat, xmotivo
    FROM fechamentos_fiscais_documentos
    WHERE CAST(cstat AS TEXT) = '539'
       OR CAST(xml_retorno AS TEXT) LIKE '%<cStat>539</cStat>%'
  `).catch(() => []);

  for (const row of docs539) {
    const chaveSefaz = extrairChaveConflito539(row.xmotivo, row.xml_retorno);
    const parsed = parseChaveNfce(chaveSefaz);
    const serie = parsed ? parsed.serie : row.serie;
    const numeroSefaz = parsed ? parsed.numero : null;
    const cnpj = parsed ? parsed.cnpj : null;
    if (numeroSefaz) {
      await registrarNumeroOcupadoSefazNfce({
        cnpj,
        ambiente: row.ambiente,
        serie,
        numero: numeroSefaz,
        chave: chaveSefaz,
        origem: '539-fechamento-historico',
        cstat: '539',
        xmotivo: row.xmotivo
      });
    }
    if (row.numero) {
      await registrarNumeroOcupadoSefazNfce({
        cnpj: cnpj || '',
        ambiente: row.ambiente,
        serie: row.serie || serie || 1,
        numero: row.numero,
        chave: row.chave_acesso || chaveSefaz,
        origem: '539-fechamento-local',
        cstat: '539',
        xmotivo: row.xmotivo
      });
    }
  }

  hidratado = true;
}

/**
 * Registra ocupação após CStat 539 e alinha contador fiscal_numeracao.
 * Não autoriza documento sem confirmação; não reutiliza nNF.
 */
async function aplicarOcupacaoPorRejeicao539Nfce({
  cnpj,
  ambiente,
  serie,
  numeroEnviado,
  chaveEnviada,
  xMotivo,
  xmlRetorno,
  cStat = '539'
} = {}) {
  logNum('539', {
    cnpj,
    ambiente,
    modelo: 65,
    serie,
    numero_enviado: numeroEnviado,
    chave_enviada: chaveEnviada,
    cstat: cStat
  });

  const chaveSefaz = extrairChaveConflito539(xMotivo, xmlRetorno);
  const idSefaz = parseChaveNfce(chaveSefaz);
  const serieEfetiva = (idSefaz && idSefaz.serie) || Number(serie || 1);
  const numeroSefaz = idSefaz ? idSefaz.numero : null;
  const numeroLocal = numeroEnviado != null ? Number(numeroEnviado) : null;
  const amb = ambiente != null ? Number(ambiente) : 2;
  const emp = (idSefaz && idSefaz.cnpj) || onlyDigits(cnpj);

  const mesmaChave = Boolean(
    chaveSefaz
    && chaveEnviada
    && onlyDigits(chaveSefaz) === onlyDigits(chaveEnviada)
  );

  if (numeroSefaz) {
    await registrarNumeroOcupadoSefazNfce({
      cnpj: emp,
      ambiente: amb,
      serie: serieEfetiva,
      numero: numeroSefaz,
      chave: chaveSefaz,
      origem: '539',
      cstat: String(cStat || '539'),
      xmotivo: xMotivo || null
    });
  }

  if (numeroLocal) {
    await registrarNumeroOcupadoSefazNfce({
      cnpj: emp,
      ambiente: amb,
      serie: Number(serie || serieEfetiva),
      numero: numeroLocal,
      chave: chaveEnviada || null,
      origem: mesmaChave ? '539-mesma-chave' : '539-local',
      cstat: String(cStat || '539'),
      xmotivo: xMotivo || null
    });
  }

  const ocupado = Math.max(Number(numeroSefaz) || 0, Number(numeroLocal) || 0);
  let proximoMinimo = null;
  if (ocupado) {
    const { alinharProximoMinimoNfce } = require('./numeracaoFiscalService');
    proximoMinimo = await alinharProximoMinimoNfce({
      cnpj: emp,
      ambiente: amb,
      serie: serieEfetiva,
      minimo: ocupado + 1
    });
  }

  logNum('RECUPERACAO', {
    cnpj: emp,
    ambiente: amb,
    numero_enviado: numeroLocal,
    chave_enviada: chaveEnviada,
    numero_sefaz: numeroSefaz,
    chave_sefaz: chaveSefaz,
    mesma_chave: mesmaChave ? 1 : 0,
    proximo_minimo: proximoMinimo
  });

  return {
    chaveSefaz,
    numeroOcupadoSefaz: numeroSefaz,
    numeroOcupadoLocal: numeroLocal,
    mesmaChave,
    proximoMinimo,
    numero_enviado: numeroLocal,
    chave_enviada: chaveEnviada || null,
    numero_sefaz: numeroSefaz,
    chave_sefaz: chaveSefaz,
    cstat: String(cStat || '539'),
    xmotivo: xMotivo || null
  };
}

/**
 * Garante próximo nNF > maior conhecido e fora de nfce_numeros_ocupados_sefaz.
 */
async function reconciliarNumeracaoNfce({ cnpj, ambiente, serie } = {}) {
  await garantirTabelaNfceOcupadosSefaz();
  await hidratarOcupadosNfceDoHistorico();

  const {
    obterProximaNumeracaoFiscal,
    salvarProximaNumeracaoFiscal,
    proximoLivreDeConjunto,
    cnpjChave,
    maxLocalModelo65
  } = require('./numeracaoFiscalService');

  const emp = cnpjChave(cnpj);
  const amb = Number(ambiente != null ? ambiente : 2);
  const ser = Number(serie || 1);

  const peek = await obterProximaNumeracaoFiscal({
    cnpj: emp, ambiente: amb, modelo: '65', serie: ser
  });
  const maxLocal = typeof maxLocalModelo65 === 'function'
    ? await maxLocalModelo65({ serie: ser, ambiente: amb, cnpj: emp })
    : (peek.maiorLocal || 0);
  const ocupados = await listarNumerosOcupadosNfce({ cnpj: emp, ambiente: amb, serie: ser });
  const inicio = Math.max(peek.numero, maxLocal + 1);
  const proximo = proximoLivreDeConjunto(inicio, ocupados);

  if (proximo !== peek.numero) {
    await salvarProximaNumeracaoFiscal({
      cnpj: emp,
      ambiente: amb,
      modelo: '65',
      serie: ser,
      proximoNumero: proximo
    });
  }

  logNum('RECUPERACAO', {
    cnpj: emp, ambiente: amb, modelo: 65, serie: ser,
    peek: peek.numero, max_local: maxLocal, proximo, origem: 'reconciliarNumeracaoNfce'
  });

  return {
    cnpj: emp,
    ambiente: amb,
    serie: ser,
    proximo_numero: proximo,
    maior_local: maxLocal,
    ocupados: ocupados.length
  };
}

function resetNfceOcupadosForTests() {
  ocupadosMemoria.clear();
  hidratado = false;
  tabelaOk = false;
}

module.exports = {
  garantirTabelaNfceOcupadosSefaz,
  registrarNumeroOcupadoSefazNfce,
  numeroOcupadoSefazEmMemoria,
  listarNumerosOcupadosNfce,
  hidratarOcupadosNfceDoHistorico,
  aplicarOcupacaoPorRejeicao539Nfce,
  reconciliarNumeracaoNfce,
  extrairChaveConflito539,
  parseChaveNfce,
  resetNfceOcupadosForTests
};
