/**
 * RC4.31.6 — Camada universal de certificação SQL
 * @module lib/sqlCertification
 */
'use strict';

const {
  validateInsertAlignment,
  analisarInsertSql,
  tabelaMonitorada,
  TABELAS_MONITORADAS,
  InsertAlignmentError
} = require('../validateInsertAlignment');
const {
  SqlCertificationError,
  normalizarSql,
  countPlaceholders,
  detectarOperacao,
  deveIgnorar,
  extrairTabela,
  extrairCaller,
  extrairParametros,
  temWhere,
  analisarUpdate
} = require('./common');
const { registrarLogSql, gerarRelatorioCertificacao, resetRelatorio } = require('./logger');

function validateUpdate(sql, params = [], options = {}) {
  const caller = options.caller || extrairCaller();
  const analise = analisarUpdate(sql);
  if (!analise.ok) {
    throw new SqlCertificationError('UPDATE', { motivo: analise.motivo, caller, sql: normalizarSql(sql) });
  }
  if (analise.dupes.length) {
    throw new SqlCertificationError('UPDATE', {
      motivo: `colunas_duplicadas:${analise.dupes.join(',')}`,
      tabela: analise.tabela,
      caller,
      sql: normalizarSql(sql)
    });
  }
  const parametros = Array.isArray(params) ? params.length : 0;
  if (analise.placeholders !== parametros) {
    throw new SqlCertificationError('UPDATE', {
      motivo: `set(${analise.placeholdersSet})+where(${analise.placeholdersWhere}) !== parametros(${parametros})`,
      placeholders: analise.placeholders,
      parametros,
      tabela: analise.tabela,
      caller,
      sql: normalizarSql(sql)
    });
  }
  return { ok: true, operacao: 'UPDATE', ...analise };
}

function validateDelete(sql, params = [], options = {}) {
  const caller = options.caller || extrairCaller();
  const norm = normalizarSql(sql);
  const tabela = extrairTabela(sql, 'DELETE');
  const placeholders = countPlaceholders(sql);
  const parametros = Array.isArray(params) ? params.length : 0;
  const allowFull = options.allowFullDelete || /--\s*allow-full-delete/i.test(sql);

  if (!allowFull && !temWhere(sql)) {
    registrarLogSql({
      nivel: 'CRITICO',
      operacao: 'DELETE',
      tabela,
      sql: norm,
      caller,
      motivo: 'DELETE sem WHERE bloqueado'
    });
    throw new SqlCertificationError('DELETE', {
      motivo: 'DELETE sem WHERE — use WHERE ou -- allow-full-delete',
      tabela,
      caller,
      sql: norm
    });
  }
  if (placeholders !== parametros) {
    throw new SqlCertificationError('DELETE', {
      motivo: 'placeholders !== parametros',
      placeholders,
      parametros,
      tabela,
      caller,
      sql: norm
    });
  }
  return { ok: true, operacao: 'DELETE', tabela, placeholders, parametros };
}

function validateSelect(sql, params = [], options = {}) {
  const caller = options.caller || extrairCaller();
  const norm = normalizarSql(sql);
  const placeholders = countPlaceholders(sql);
  const parametros = Array.isArray(params) ? params.length : 0;
  const tabela = extrairTabela(sql, 'SELECT');

  if (placeholders !== parametros) {
    throw new SqlCertificationError('SELECT', {
      motivo: 'placeholders !== parametros',
      placeholders,
      parametros,
      tabela,
      caller,
      sql: norm
    });
  }
  if (options.rejeitarUndefined && Array.isArray(params)) {
    const idx = params.findIndex((p) => p === undefined);
    if (idx >= 0) {
      throw new SqlCertificationError('SELECT', {
        motivo: `parametro_undefined_indice_${idx}`,
        placeholders,
        parametros,
        tabela,
        caller,
        sql: norm
      });
    }
  }
  return { ok: true, operacao: 'SELECT', tabela, placeholders, parametros };
}

/**
 * Validação universal SQL — ponto único de certificação
 * @param {string} sql
 * @param {Array} [params]
 * @param {Object} [options]
 */
function validateSql(sql, params = [], options = {}) {
  if (!sql || typeof sql !== 'string') return { ok: true, skipped: true };
  if (deveIgnorar(sql, options)) return { ok: true, skipped: true, operacao: detectarOperacao(sql) };

  const operacao = detectarOperacao(sql);
  const caller = options.caller || extrairCaller();
  const t0 = Date.now();
  let resultado;

  try {
    if (operacao === 'INSERT') {
      const analise = analisarInsertSql(sql);
      if (analise.ok && (options.allTables || tabelaMonitorada(analise.tabela))) {
        resultado = validateInsertAlignment(sql, params, { caller, permitirNaoInsert: true });
      } else {
        const ph = countPlaceholders(sql);
        const parametros = Array.isArray(params) ? params.length : 0;
        if (ph !== parametros) {
          throw new SqlCertificationError('INSERT', { motivo: 'placeholders !== parametros', placeholders: ph, parametros, caller, sql: normalizarSql(sql) });
        }
        resultado = { ok: true, operacao: 'INSERT' };
      }
    } else if (operacao === 'UPDATE') {
      resultado = validateUpdate(sql, params, { ...options, caller });
    } else if (operacao === 'DELETE') {
      resultado = validateDelete(sql, params, { ...options, caller });
    } else if (operacao === 'SELECT') {
      resultado = validateSelect(sql, params, { ...options, caller, rejeitarUndefined: true });
    } else {
      const ph = countPlaceholders(sql);
      const parametros = Array.isArray(params) ? params.length : 0;
      if (ph !== parametros) {
        throw new SqlCertificationError(operacao, { motivo: 'placeholders !== parametros', placeholders: ph, parametros, caller, sql: normalizarSql(sql) });
      }
      resultado = { ok: true, operacao };
    }

    registrarLogSql({
      nivel: 'OK',
      operacao,
      tabela: resultado.tabela || extrairTabela(sql, operacao),
      sql: normalizarSql(sql),
      placeholders: countPlaceholders(sql),
      parametros: Array.isArray(params) ? params.length : 0,
      tempoMs: Date.now() - t0,
      caller
    });
    return resultado;
  } catch (err) {
    registrarLogSql({
      nivel: 'ERRO',
      operacao,
      tabela: extrairTabela(sql, operacao),
      sql: normalizarSql(sql),
      placeholders: countPlaceholders(sql),
      parametros: Array.isArray(params) ? params.length : 0,
      tempoMs: Date.now() - t0,
      caller,
      erro: err.message
    });
    throw err;
  }
}

function wrapDbMethod(originalFn, methodName) {
  return function sqlCertificado(sql, ...args) {
    if (typeof sql === 'string') {
      const params = extrairParametros(args);
      validateSql(sql, params, { caller: `${methodName}:${extrairCaller(2)}` });
    }
    return originalFn.call(this, sql, ...args);
  };
}

function aplicarCertificacaoSql(db) {
  const originais = {
    run: db.run.bind(db),
    get: db.get.bind(db),
    all: db.all.bind(db),
    each: db.each.bind(db),
    prepare: db.prepare.bind(db)
  };

  db.run = wrapDbMethod(originais.run, 'run');
  db.get = wrapDbMethod(originais.get, 'get');
  db.all = wrapDbMethod(originais.all, 'all');
  db.each = wrapDbMethod(originais.each, 'each');

  db.prepare = function prepareCertificado(sql) {
    const stmt = originais.prepare(sql);
    ['run', 'get', 'all', 'each'].forEach((m) => {
      if (typeof stmt[m] !== 'function') return;
      const original = stmt[m].bind(stmt);
      stmt[m] = function (...a) {
        validateSql(sql, extrairParametros(a), { caller: `prepare.${m}:${extrairCaller(2)}` });
        return original(...a);
      };
    });
    return stmt;
  };

  return db;
}

module.exports = {
  SqlCertificationError,
  InsertAlignmentError,
  TABELAS_MONITORADAS,
  validateSql,
  validateUpdate,
  validateDelete,
  validateSelect,
  validateInsertAlignment,
  analisarInsertSql,
  analisarUpdate,
  tabelaMonitorada,
  countPlaceholders,
  detectarOperacao,
  aplicarCertificacaoSql,
  wrapDbMethod,
  extrairParametros,
  registrarLogSql,
  gerarRelatorioCertificacao,
  resetRelatorio
};
