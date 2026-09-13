/**
 * RC4.31.6 — Logs inteligentes de certificação SQL
 * @module lib/sqlCertification/logger
 */
'use strict';

const _logs = [];
const _stats = {
  INSERT: { auditados: 0, aprovados: 0, reprovados: 0 },
  UPDATE: { auditados: 0, aprovados: 0, reprovados: 0 },
  DELETE: { auditados: 0, aprovados: 0, reprovados: 0 },
  SELECT: { auditados: 0, aprovados: 0, reprovados: 0 },
  OTHER: { auditados: 0, aprovados: 0, reprovados: 0 }
};

const MAX_LOGS = 500;

function registrarLogSql(entry) {
  const op = entry.operacao || 'OTHER';
  if (!_stats[op]) _stats[op] = { auditados: 0, aprovados: 0, reprovados: 0 };
  _stats[op].auditados += 1;
  if (entry.nivel === 'ERRO' || entry.nivel === 'CRITICO') {
    _stats[op].reprovados += 1;
    if (entry.nivel === 'CRITICO') {
      console.error('[SQL CERT CRITICO]', entry.motivo || entry.erro, entry.tabela || '', entry.caller || '');
    }
  } else {
    _stats[op].aprovados += 1;
  }
  _logs.push(Object.freeze({ ...entry, timestamp: new Date().toISOString() }));
  if (_logs.length > MAX_LOGS) _logs.shift();
}

function gerarRelatorioCertificacao() {
  const linhas = [
    '# Relatório de Certificação SQL — RC4.31.6',
    ''
  ];
  ['INSERT', 'UPDATE', 'DELETE', 'SELECT'].forEach((op) => {
    const s = _stats[op] || { auditados: 0, aprovados: 0, reprovados: 0 };
    linhas.push(`## ${op}`);
    linhas.push(`- Auditados: ${s.auditados}`);
    linhas.push(`- Aprovados: ${s.aprovados}`);
    linhas.push(`- Reprovados: ${s.reprovados}`);
    linhas.push('');
  });
  return linhas.join('\n');
}

function resetRelatorio() {
  _logs.length = 0;
  Object.keys(_stats).forEach((k) => {
    _stats[k] = { auditados: 0, aprovados: 0, reprovados: 0 };
  });
}

function obterLogs() {
  return [..._logs];
}

module.exports = {
  registrarLogSql,
  gerarRelatorioCertificacao,
  resetRelatorio,
  obterLogs,
  _stats
};
