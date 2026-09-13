/**
 * RC4.31.6 — Auditoria estática universal SQL
 * @module lib/scanSqlCertificationInSource
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { analisarInsertSql, tabelaMonitorada } = require('./validateInsertAlignment');
const {
  countPlaceholders,
  detectarOperacao,
  temWhere,
  analisarUpdate,
  normalizarSql
} = require('./sqlCertification/common');
const { extrairInsertsDeArquivo, findMatchingParen } = require('./scanInsertAlignmentInSource');

/** Cobertura RC4.31.6 — módulos críticos */
const MODULOS_AUDITORIA = Object.freeze([
  { modulo: 'produtos', arquivos: ['backend/rotas/produtos.js'] },
  { modulo: 'compras', arquivos: ['backend/rotas/compras.js'] },
  { modulo: 'vendas', arquivos: ['backend/services/vendas/VendaPagamentoService.js', 'backend/services/vendas/VendaFinanceiroService.js', 'backend/services/entrega/CriarVendaEntregaService.js'] },
  { modulo: 'financeiro', arquivos: ['backend/rotas/financeiro.js', 'backend/rotas/contas_receber.js'] },
  { modulo: 'estoque', arquivos: ['backend/services/ajusteEstoqueService.js', 'backend/services/lotesService.js'] },
  { modulo: 'fiscal', arquivos: ['backend/services/fiscal/emissor.js', 'backend/services/fiscal/nfeEmissorVenda.js', 'backend/services/fiscal/nfeDevolucaoCompra.js'] },
  { modulo: 'nfce', arquivos: ['backend/services/fiscal/emissor.js'] },
  { modulo: 'nfe', arquivos: ['backend/services/fiscal/nfeEmissorVenda.js'] },
  { modulo: 'miip', arquivos: ['backend/motores/miip/repositories/MiipEstatisticasRepository.js'] },
  { modulo: 'central_entradas', arquivos: ['backend/motores/central-entradas/repositories/CentralEventosRepository.js'] },
  { modulo: 'clientes', arquivos: ['backend/rotas/clientes.js'] },
  { modulo: 'fornecedores', arquivos: ['backend/rotas/fornecedores.js'] },
  { modulo: 'pedidos', arquivos: ['backend/services/pedido/PedidoRepository.js'] },
  { modulo: 'orcamentos', arquivos: ['backend/rotas/orcamentos.js'] },
  { modulo: 'equipamentos', arquivos: ['backend/motores/equipamentos/identidade/IdentidadeRepository.js'] },
  { modulo: 'configuracoes', arquivos: ['backend/rotas/configuracoes.js', 'backend/database.js'] }
]);

function extrairSqlStatements(conteudo) {
  const achados = [];
  const re = /db\.(run|get|all|each|prepare)\(\s*`([\s\S]*?)`/g;
  let m;
  while ((m = re.exec(conteudo)) !== null) {
    const sql = m[2].trim();
    if (!/^(INSERT|UPDATE|DELETE|SELECT)\b/i.test(sql)) continue;
    if (/\$\{/.test(sql)) continue;
    const line = conteudo.slice(0, m.index).split('\n').length;
    achados.push({ sql, metodo: m[1], line, index: m.index });
  }
  return achados;
}

function auditarStatement(stmt, arquivo, modulo) {
  const op = detectarOperacao(stmt.sql);
  const base = {
    arquivo,
    modulo,
    linha: stmt.line,
    operacao: op,
    metodo: stmt.metodo,
    sql: normalizarSql(stmt.sql).slice(0, 120)
  };

  if (op === 'INSERT') {
    const a = analisarInsertSql(stmt.sql);
    if (!a.ok) return null;
    if (!tabelaMonitorada(a.tabela) && !MODULOS_AUDITORIA.some((m) => m.arquivos.includes(arquivo))) return null;
    return {
      ...base,
      tabela: a.tabela,
      ok: a.colunas === a.slots,
      placeholders: a.placeholders,
      detalhe: `colunas=${a.colunas} slots=${a.slots}`
    };
  }

  if (op === 'UPDATE') {
    const a = analisarUpdate(stmt.sql);
    if (!a.ok) return { ...base, ok: false, detalhe: a.motivo };
    return {
      ...base,
      tabela: a.tabela,
      ok: a.dupes.length === 0,
      placeholders: a.placeholders,
      detalhe: a.dupes.length ? `dupes:${a.dupes.join(',')}` : `ph=${a.placeholders}`
    };
  }

  if (op === 'DELETE') {
    const allow = /--\s*allow-full-delete/i.test(stmt.sql);
    const ok = allow || temWhere(stmt.sql);
    return {
      ...base,
      ok,
      placeholders: countPlaceholders(stmt.sql),
      detalhe: ok ? 'WHERE ok' : 'DELETE sem WHERE'
    };
  }

  if (op === 'SELECT') {
    return {
      ...base,
      ok: true,
      placeholders: countPlaceholders(stmt.sql),
      detalhe: `ph=${countPlaceholders(stmt.sql)}`
    };
  }

  return null;
}

function auditarArquivo(rootDir, relPath, modulo) {
  const abs = path.join(rootDir, relPath);
  if (!fs.existsSync(abs)) return [];
  const conteudo = fs.readFileSync(abs, 'utf8');
  const resultados = [];

  extrairInsertsDeArquivo(conteudo).forEach((ins) => {
    if (/\$\{/.test(ins.sql)) return;
    const line = conteudo.slice(0, ins.index).split('\n').length;
    const r = auditarStatement({ sql: ins.sql, line, metodo: 'run' }, relPath, modulo);
    if (r) resultados.push(r);
  });

  extrairSqlStatements(conteudo).forEach((stmt) => {
    const r = auditarStatement(stmt, relPath, modulo);
    if (r) resultados.push(r);
  });

  return resultados;
}

function auditarModulos(rootDir = path.join(__dirname, '..', '..')) {
  const vistos = new Set();
  const relatorios = [];

  MODULOS_AUDITORIA.forEach(({ modulo, arquivos }) => {
    arquivos.forEach((rel) => {
      const key = `${modulo}:${rel}`;
      if (vistos.has(key)) return;
      vistos.add(key);
      if (!fs.existsSync(path.join(rootDir, rel))) return;
      auditarArquivo(rootDir, rel, modulo).forEach((r) => relatorios.push(r));
    });
  });

  return relatorios;
}

function gerarRelatorioPorModulo(relatorios) {
  const porOp = { INSERT: [], UPDATE: [], DELETE: [], SELECT: [] };
  relatorios.forEach((r) => {
    if (porOp[r.operacao]) porOp[r.operacao].push(r);
  });

  const resumo = {};
  Object.entries(porOp).forEach(([op, lista]) => {
    resumo[op] = {
      auditados: lista.length,
      aprovados: lista.filter((x) => x.ok).length,
      reprovados: lista.filter((x) => !x.ok).length
    };
  });
  return { porOp, resumo, total: relatorios.length, reprovados: relatorios.filter((r) => !r.ok) };
}

module.exports = {
  MODULOS_AUDITORIA,
  extrairSqlStatements,
  auditarArquivo,
  auditarModulos,
  gerarRelatorioPorModulo
};
