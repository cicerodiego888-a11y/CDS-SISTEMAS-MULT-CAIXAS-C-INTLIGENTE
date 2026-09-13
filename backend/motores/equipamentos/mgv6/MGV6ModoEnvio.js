/**
 * RC14.15.3 — Autoridade do método de envio do equipamento.
 * Valores oficiais: TCP | MGV6
 * Default para equipamentos sem config: TCP (não migrar automaticamente).
 */

'use strict';

const db = require('../../../database');
const { CHAVE_CONFIG, normalizar } = require('./MGV6Configuration');
const { MGV6Error, CODES } = require('./MGV6Errors');

const CHAVE_MODO_ENVIO = 'modo_envio';
const MODO_TCP = 'TCP';
const MODO_MGV6 = 'MGV6';

const CODIGO_MODO_MGV6 = 'MODO_ENVIO_MGV6';
const CODIGO_MODO_TCP = 'MODO_ENVIO_TCP';

function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(err) {
      if (err) return reject(err);
      resolve({ lastID: this.lastID, changes: this.changes });
    });
  });
}

function get(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row || null)));
  });
}

function whenReady() {
  return new Promise((resolve, reject) => {
    if (typeof db.whenReady === 'function') {
      db.whenReady((err) => (err ? reject(err) : resolve()));
      return;
    }
    resolve();
  });
}

/**
 * @param {*} raw
 * @returns {'TCP'|'MGV6'}
 */
function normalizarModoEnvio(raw) {
  const v = String(raw == null ? '' : raw).trim().toUpperCase();
  if (v === MODO_MGV6 || v === 'MGV') return MODO_MGV6;
  return MODO_TCP;
}

/**
 * @param {number} equipamentoId
 * @returns {Promise<'TCP'|'MGV6'>}
 */
async function obterModoEnvio(equipamentoId) {
  await whenReady();
  const id = Number(equipamentoId);
  if (!Number.isFinite(id) || id <= 0) {
    return MODO_TCP;
  }
  const row = await get(
    `SELECT valor FROM equipamentos_configuracoes
     WHERE equipamento_id = ? AND chave = ? LIMIT 1`,
    [id, CHAVE_MODO_ENVIO]
  );
  if (!row || row.valor == null || String(row.valor).trim() === '') {
    return MODO_TCP;
  }
  return normalizarModoEnvio(row.valor);
}

/**
 * Sincroniza flag legado `enabled` em mgv6.config com o modo (sem segunda autoridade).
 * @param {number} equipamentoId
 * @param {'TCP'|'MGV6'} modo
 */
async function sincronizarEnabledMgv6(equipamentoId, modo) {
  const id = Number(equipamentoId);
  const row = await get(
    `SELECT id, valor FROM equipamentos_configuracoes
     WHERE equipamento_id = ? AND chave = ? LIMIT 1`,
    [id, CHAVE_CONFIG]
  );
  let parsed = {};
  if (row?.valor) {
    try {
      parsed = typeof row.valor === 'object' ? row.valor : JSON.parse(String(row.valor));
    } catch (_) {
      parsed = {};
    }
  }
  const cfg = normalizar({
    ...parsed,
    enabled: modo === MODO_MGV6
  });
  const payload = {
    enabled: cfg.enabled,
    exportFolder: cfg.exportFolder,
    mgv6Executable: cfg.mgv6Executable,
    fileName: cfg.fileName,
    encoding: cfg.encoding,
    lineEnding: cfg.lineEnding,
    autoLaunch: cfg.autoLaunch,
    modoVariavel: cfg.modoVariavel,
    digitosPlu: cfg.digitosPlu,
    prefixoEtiqueta: cfg.prefixoEtiqueta,
    diferenciarPesoUnidade: cfg.diferenciarPesoUnidade,
    tipoRegistro: cfg.tipoRegistro,
    descricaoMaxLength: cfg.descricaoMaxLength
  };
  const valorStr = JSON.stringify(payload);
  if (row?.id) {
    await run(
      `UPDATE equipamentos_configuracoes
       SET valor = ?, descricao = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [valorStr, 'Compatibilidade MGV6 (exportação legada)', row.id]
    );
  } else if (modo === MODO_MGV6) {
    await run(
      `INSERT INTO equipamentos_configuracoes (equipamento_id, chave, valor, descricao)
       VALUES (?, ?, ?, ?)`,
      [id, CHAVE_CONFIG, valorStr, 'Compatibilidade MGV6 (exportação legada)']
    );
  }
}

/**
 * @param {number} equipamentoId
 * @param {*} modoRaw
 * @returns {Promise<'TCP'|'MGV6'>}
 */
async function salvarModoEnvio(equipamentoId, modoRaw) {
  await whenReady();
  const id = Number(equipamentoId);
  if (!Number.isFinite(id) || id <= 0) {
    throw MGV6Error.fromCode(CODES.EQUIPAMENTO_INVALID, 'equipamentoId inválido');
  }
  const modo = normalizarModoEnvio(modoRaw);
  const existente = await get(
    `SELECT id FROM equipamentos_configuracoes
     WHERE equipamento_id = ? AND chave = ? LIMIT 1`,
    [id, CHAVE_MODO_ENVIO]
  );
  if (existente?.id) {
    await run(
      `UPDATE equipamentos_configuracoes
       SET valor = ?, descricao = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [modo, 'Método de envio de produtos (TCP | MGV6)', existente.id]
    );
  } else {
    await run(
      `INSERT INTO equipamentos_configuracoes (equipamento_id, chave, valor, descricao)
       VALUES (?, ?, ?, ?)`,
      [id, CHAVE_MODO_ENVIO, modo, 'Método de envio de produtos (TCP | MGV6)']
    );
  }
  await sincronizarEnabledMgv6(id, modo);
  return modo;
}

/**
 * Bloqueia upload TCP quando equipamento está em MGV6.
 * @param {'TCP'|'MGV6'|string} modo
 */
function assertPermitidoUploadTcp(modo) {
  if (normalizarModoEnvio(modo) === MODO_MGV6) {
    const err = new Error('Este equipamento está configurado para envio via MGV6.');
    err.statusCode = 409;
    err.code = CODIGO_MODO_MGV6;
    err.codigo = CODIGO_MODO_MGV6;
    throw err;
  }
}

/**
 * Bloqueia exportação MGV6 quando equipamento está em TCP.
 * @param {'TCP'|'MGV6'|string} modo
 */
function assertPermitidoExportMgv6(modo) {
  if (normalizarModoEnvio(modo) !== MODO_MGV6) {
    throw MGV6Error.fromCode(
      CODES.MODO_ENVIO_TCP,
      'Este equipamento está configurado para envio TCP.',
      { statusCode: 409, codigo: CODIGO_MODO_TCP }
    );
  }
}

/**
 * @param {number} equipamentoId
 */
async function garantirModoTcp(equipamentoId) {
  const modo = await obterModoEnvio(equipamentoId);
  assertPermitidoUploadTcp(modo);
  return modo;
}

/**
 * @param {number} equipamentoId
 */
async function garantirModoMgv6(equipamentoId) {
  const modo = await obterModoEnvio(equipamentoId);
  assertPermitidoExportMgv6(modo);
  return modo;
}

module.exports = {
  CHAVE_MODO_ENVIO,
  MODO_TCP,
  MODO_MGV6,
  CODIGO_MODO_MGV6,
  CODIGO_MODO_TCP,
  normalizarModoEnvio,
  obterModoEnvio,
  salvarModoEnvio,
  sincronizarEnabledMgv6,
  assertPermitidoUploadTcp,
  assertPermitidoExportMgv6,
  garantirModoTcp,
  garantirModoMgv6
};
