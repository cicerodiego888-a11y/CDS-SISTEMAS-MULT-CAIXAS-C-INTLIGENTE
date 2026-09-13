/**
 * RC4.31.5 — Validação de alinhamento INSERT (colunas × placeholders × valores)
 * @module lib/validateInsertAlignment
 */
'use strict';

/** Tabelas monitoradas obrigatoriamente (runtime + auditoria estática) */
const TABELAS_MONITORADAS = Object.freeze([
  'compras',
  'compras_itens',
  'financeiro',
  'contas_pagar',
  'contas_receber',
  'produtos',
  'vendas',
  'vendas_itens',
  'nfce_notas',
  'nfe_notas',
  'pedidos',
  'pedidos_itens'
]);

class InsertAlignmentError extends Error {
  constructor(details = {}) {
    const msg = [
      'INSERT desalinhado:',
      `colunas=${details.colunas}`,
      `placeholders=${details.placeholders}`,
      `literais=${details.literais}`,
      `slots=${details.slots}`,
      `valores=${details.valores}`,
      details.tabela ? `tabela=${details.tabela}` : null,
      details.caller ? `caller=${details.caller}` : null
    ].filter(Boolean).join(' | ');
    super(msg);
    this.name = 'InsertAlignmentError';
    this.details = Object.freeze({ ...details });
  }
}

function normalizarSql(sql) {
  return String(sql || '').replace(/\s+/g, ' ').trim();
}

function extrairInsert(sql) {
  const norm = normalizarSql(sql);
  const m = norm.match(
    /INSERT\s+(?:OR\s+\w+\s+)?INTO\s+([`"[\w]]+|\w+)\s*\(([\s\S]*?)\)\s*VALUES\s*\(([\s\S]*)\)\s*$/i
  );
  if (!m) return null;
  const tabela = String(m[1]).replace(/[`"[\]]/g, '');
  const columns = m[2].split(',').map((c) => c.trim()).filter(Boolean);
  const valuesClause = m[3].trim();
  return { tabela, columns, valuesClause };
}

function splitValueSlots(valuesClause) {
  const slots = [];
  let current = '';
  let inString = false;
  let stringChar = '';
  let depth = 0;

  for (let i = 0; i < valuesClause.length; i += 1) {
    const c = valuesClause[i];
    if (inString) {
      current += c;
      if (c === stringChar && valuesClause[i - 1] !== '\\') inString = false;
      continue;
    }
    if (c === "'" || c === '"') {
      inString = true;
      stringChar = c;
      current += c;
      continue;
    }
    if (c === '(') {
      depth += 1;
      current += c;
      continue;
    }
    if (c === ')') {
      depth -= 1;
      current += c;
      continue;
    }
    if (c === ',' && depth === 0) {
      if (current.trim()) slots.push(current.trim());
      current = '';
      continue;
    }
    current += c;
  }
  if (current.trim()) slots.push(current.trim());
  return slots;
}

function analisarInsertSql(sql) {
  const parsed = extrairInsert(sql);
  if (!parsed) {
    return { ok: false, motivo: 'nao_e_insert', sql: normalizarSql(sql) };
  }

  const slots = splitValueSlots(parsed.valuesClause);
  const placeholders = slots.filter((s) => s === '?').length;
  const literais = slots.length - placeholders;

  return {
    ok: true,
    tabela: parsed.tabela,
    colunas: parsed.columns.length,
    columns: parsed.columns,
    slots: slots.length,
    placeholders,
    literais,
    valuesClause: parsed.valuesClause,
    sql: normalizarSql(sql)
  };
}

/**
 * Valida alinhamento INSERT: colunas === slots (placeholders + literais) === valores.length (para ?)
 * @param {string} sql
 * @param {Array} [values]
 * @param {Object} [options]
 * @param {string} [options.caller] — função chamadora para diagnóstico
 * @throws {InsertAlignmentError}
 */
function validateInsertAlignment(sql, values = [], options = {}) {
  const caller = options.caller || options.funcao || null;
  const analise = analisarInsertSql(sql);

  if (!analise.ok) {
    if (options.permitirNaoInsert) return analise;
    throw new InsertAlignmentError({
      colunas: 0,
      placeholders: 0,
      literais: 0,
      slots: 0,
      valores: Array.isArray(values) ? values.length : 0,
      caller,
      sql: normalizarSql(sql),
      motivo: analise.motivo
    });
  }

  const valoresLen = Array.isArray(values) ? values.length : 0;
  const erros = [];

  if (analise.colunas !== analise.slots) {
    erros.push(`colunas(${analise.colunas}) !== slots(${analise.slots})`);
  }
  if (analise.placeholders !== valoresLen) {
    erros.push(`placeholders(${analise.placeholders}) !== valores(${valoresLen})`);
  }

  if (erros.length) {
    throw new InsertAlignmentError({
      colunas: analise.colunas,
      placeholders: analise.placeholders,
      literais: analise.literais,
      slots: analise.slots,
      valores: valoresLen,
      tabela: analise.tabela,
      caller,
      sql: analise.sql,
      colunasLista: analise.columns,
      erros
    });
  }

  return analise;
}

function tabelaMonitorada(tabela) {
  return TABELAS_MONITORADAS.includes(String(tabela || '').toLowerCase());
}

/**
 * db.run com validação automática para INSERTs monitorados.
 * Assinatura idêntica ao sqlite3 db.run(sql, params?, callback?)
 */
function dbRunInsert(db, sql, ...args) {
  let params = [];
  let callback;

  if (typeof args[0] === 'function') {
    callback = args[0];
  } else {
    params = args[0] || [];
    callback = args[1];
  }

  const analise = analisarInsertSql(sql);
  if (analise.ok && tabelaMonitorada(analise.tabela)) {
    const stack = new Error().stack || '';
    const caller = stack.split('\n')[2]?.trim() || 'desconhecida';
    validateInsertAlignment(sql, params, { caller });
  }

  return db.run(sql, ...args);
}

module.exports = {
  InsertAlignmentError,
  TABELAS_MONITORADAS,
  validateInsertAlignment,
  analisarInsertSql,
  splitValueSlots,
  tabelaMonitorada,
  dbRunInsert
};
