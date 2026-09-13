/**
 * RC4.31.6 — Utilitários comuns de certificação SQL
 * @module lib/sqlCertification/common
 */
'use strict';

class SqlCertificationError extends Error {
  constructor(operacao, details = {}) {
    const msg = [
      `SQL ${operacao} inválido:`,
      details.motivo || null,
      details.placeholders != null ? `placeholders=${details.placeholders}` : null,
      details.parametros != null ? `parametros=${details.parametros}` : null,
      details.tabela ? `tabela=${details.tabela}` : null,
      details.caller ? `caller=${details.caller}` : null
    ].filter(Boolean).join(' | ');
    super(msg);
    this.name = 'SqlCertificationError';
    this.operacao = operacao;
    this.details = Object.freeze({ operacao, ...details });
  }
}

function normalizarSql(sql) {
  return String(sql || '').replace(/\s+/g, ' ').trim();
}

function countPlaceholders(sql) {
  let count = 0;
  let inString = false;
  let stringChar = '';
  const s = String(sql || '');
  for (let i = 0; i < s.length; i += 1) {
    const c = s[i];
    if (inString) {
      if (c === stringChar && s[i - 1] !== '\\') inString = false;
      continue;
    }
    if (c === "'" || c === '"') {
      inString = true;
      stringChar = c;
      continue;
    }
    if (c === '?') count += 1;
  }
  return count;
}

function detectarOperacao(sql) {
  const norm = normalizarSql(sql).toUpperCase();
  if (/^PRAGMA\b/.test(norm)) return 'PRAGMA';
  if (/^BEGIN\b/.test(norm)) return 'TRANSACTION';
  if (/^(COMMIT|ROLLBACK|SAVEPOINT|RELEASE)\b/.test(norm)) return 'TRANSACTION';
  if (/^CREATE\b|^ALTER\b|^DROP\b/.test(norm)) return 'DDL';
  if (/^INSERT\b/.test(norm)) return 'INSERT';
  if (/^UPDATE\b/.test(norm)) return 'UPDATE';
  if (/^DELETE\b/.test(norm)) return 'DELETE';
  if (/^SELECT\b/.test(norm)) return 'SELECT';
  return 'OTHER';
}

function deveIgnorar(sql, options = {}) {
  const op = detectarOperacao(sql);
  if (options.allowFullDelete && op === 'DELETE') return false;
  if (['PRAGMA', 'TRANSACTION', 'DDL', 'OTHER'].includes(op)) return true;
  if (/--\s*cds-skip-sql-cert/i.test(sql)) return true;
  return false;
}

function extrairTabela(sql, operacao) {
  const norm = normalizarSql(sql);
  let m;
  if (operacao === 'INSERT') {
    m = norm.match(/INSERT\s+(?:OR\s+\w+\s+)?INTO\s+([`"[\]\w]+)/i);
  } else if (operacao === 'UPDATE') {
    m = norm.match(/UPDATE\s+(?:OR\s+\w+\s+)?([`"[\]\w]+)/i);
  } else if (operacao === 'DELETE') {
    m = norm.match(/DELETE\s+FROM\s+([`"[\]\w]+)/i);
  } else if (operacao === 'SELECT') {
    m = norm.match(/FROM\s+([`"[\]\w]+)/i);
  }
  return m ? String(m[1]).replace(/[`"[\]]/g, '') : null;
}

function extrairCaller(stackDepth = 3) {
  const stack = new Error().stack || '';
  return stack.split('\n').slice(1, stackDepth + 1).map((l) => l.trim()).join(' <- ') || 'desconhecida';
}

function extrairParametros(args) {
  if (!args.length) return [];
  if (typeof args[0] === 'function') return [];
  if (Array.isArray(args[0])) return args[0];
  const params = [];
  for (let i = 0; i < args.length; i += 1) {
    if (typeof args[i] === 'function') break;
    params.push(args[i]);
  }
  return params;
}

function temWhere(sql) {
  const semStrings = String(sql || '').replace(/'[^']*'/g, ' ').replace(/"[^"]*"/g, ' ');
  return /\bWHERE\b/i.test(semStrings);
}

function splitSetAssignments(setClause) {
  const parts = [];
  let current = '';
  let depth = 0;
  let inString = false;
  let stringChar = '';
  const s = String(setClause || '');
  for (let i = 0; i < s.length; i += 1) {
    const c = s[i];
    if (inString) {
      current += c;
      if (c === stringChar && s[i - 1] !== '\\') inString = false;
      continue;
    }
    if (c === "'" || c === '"') {
      inString = true;
      stringChar = c;
      current += c;
      continue;
    }
    if (c === '(') depth += 1;
    if (c === ')') depth -= 1;
    if (c === ',' && depth === 0) {
      if (current.trim()) parts.push(current.trim());
      current = '';
      continue;
    }
    current += c;
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

function analisarUpdate(sql) {
  const norm = normalizarSql(sql);
  const updateMatch = norm.match(/^UPDATE\s+(?:OR\s+\w+\s+)?([`"[\]\w]+)\s+SET\s+/i);
  if (!updateMatch) return { ok: false, motivo: 'parse_update_falhou' };
  const tabela = String(updateMatch[1]).replace(/[`"[\]]/g, '');
  const rest = norm.slice(updateMatch[0].length);
  let setClause = rest;
  let whereClause = '';
  const whereIdx = rest.search(/\s+WHERE\s+/i);
  if (whereIdx >= 0) {
    setClause = rest.slice(0, whereIdx);
    whereClause = rest.slice(whereIdx).replace(/^\s+WHERE\s+/i, '');
  }
  const assignments = splitSetAssignments(setClause).filter(Boolean);
  const colunas = assignments.map((a) => {
    const eq = a.indexOf('=');
    return eq >= 0 ? a.slice(0, eq).trim().replace(/[`"]/g, '') : a.trim();
  });
  const dupes = colunas.filter((c, i) => colunas.indexOf(c) !== i);
  const phSet = countPlaceholders(setClause);
  const phWhere = countPlaceholders(whereClause);
  return {
    ok: true,
    tabela,
    colunas,
    dupes,
    placeholdersSet: phSet,
    placeholdersWhere: phWhere,
    placeholders: phSet + phWhere,
    temWhere: Boolean(whereClause)
  };
}

module.exports = {
  SqlCertificationError,
  normalizarSql,
  countPlaceholders,
  detectarOperacao,
  deveIgnorar,
  extrairTabela,
  extrairCaller,
  extrairParametros,
  temWhere,
  splitSetAssignments,
  analisarUpdate
};
