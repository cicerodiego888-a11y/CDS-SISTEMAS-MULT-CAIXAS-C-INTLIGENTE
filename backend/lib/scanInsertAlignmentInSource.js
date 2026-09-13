/**
 * RC4.31.5 — Auditoria estática de INSERTs em arquivos fonte
 * @module lib/scanInsertAlignmentInSource
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { analisarInsertSql, tabelaMonitorada } = require('./validateInsertAlignment');

/** Módulos obrigatórios RC4.31.5 */
const MODULOS_AUDITORIA = Object.freeze([
  { modulo: 'compras', arquivos: ['backend/rotas/compras.js'] },
  { modulo: 'financeiro', arquivos: ['backend/rotas/financeiro.js', 'backend/rotas/compras.js', 'backend/services/vendas/VendaFinanceiroService.js'] },
  { modulo: 'produtos', arquivos: ['backend/rotas/produtos.js', 'backend/rotas/compras.js'] },
  { modulo: 'vendas', arquivos: ['backend/services/vendas/VendaPagamentoService.js', 'backend/services/vendas/VendaFinanceiroService.js', 'backend/services/entrega/CriarVendaEntregaService.js'] },
  { modulo: 'pedidos', arquivos: ['backend/services/pedido/PedidoRepository.js'] },
  { modulo: 'nfce', arquivos: ['backend/services/fiscal/emissor.js'] },
  { modulo: 'nfe', arquivos: ['backend/services/fiscal/nfeEmissorVenda.js', 'backend/services/fiscal/nfeDevolucaoCompra.js'] }
]);

function findMatchingParen(str, openIdx) {
  if (str[openIdx] !== '(') return -1;
  let depth = 0;
  let inString = false;
  let stringChar = '';
  for (let i = openIdx; i < str.length; i += 1) {
    const c = str[i];
    if (inString) {
      if (c === stringChar && str[i - 1] !== '\\') inString = false;
      continue;
    }
    if (c === "'" || c === '"') {
      inString = true;
      stringChar = c;
      continue;
    }
    if (c === '(') depth += 1;
    if (c === ')') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function extrairInsertsDeArquivo(conteudo) {
  const achados = [];
  const reStart = /INSERT\s+(?:OR\s+\w+\s+)?INTO\s+/gi;
  let m;
  while ((m = reStart.exec(conteudo)) !== null) {
    const start = m.index;
    let i = m.index + m[0].length;
    while (i < conteudo.length && conteudo[i] !== '(') i += 1;
    if (i >= conteudo.length) continue;
    const colEnd = findMatchingParen(conteudo, i);
    if (colEnd < 0) continue;
    const rest = conteudo.slice(colEnd + 1);
    const valuesMatch = rest.match(/VALUES\s*\(/i);
    if (!valuesMatch) continue;
    const valOpen = colEnd + 1 + valuesMatch.index + valuesMatch[0].length - 1;
    const valEnd = findMatchingParen(conteudo, valOpen);
    if (valEnd < 0) continue;
    achados.push({ sql: conteudo.slice(start, valEnd + 1), index: start });
  }
  return achados;
}

function auditarArquivo(rootDir, relPath) {
  const abs = path.join(rootDir, relPath);
  if (!fs.existsSync(abs)) {
    return [{ arquivo: relPath, ok: false, erro: 'arquivo não encontrado' }];
  }
  const conteudo = fs.readFileSync(abs, 'utf8');
  const inserts = extrairInsertsDeArquivo(conteudo);
  const resultados = [];

  inserts.forEach((ins) => {
    if (/\$\{/.test(ins.sql)) {
      return; // INSERT dinâmico (template) — validado em runtime via db.run wrapper
    }
    const analise = analisarInsertSql(ins.sql);
    if (!analise.ok) return;
    if (!tabelaMonitorada(analise.tabela)) return;

    const alinhado = analise.colunas === analise.slots;
    resultados.push({
      arquivo: relPath,
      tabela: analise.tabela,
      colunas: analise.colunas,
      placeholders: analise.placeholders,
      literais: analise.literais,
      slots: analise.slots,
      ok: alinhado,
      sql: analise.sql.slice(0, 160)
    });
  });

  return resultados;
}

function auditarModulos(rootDir = path.join(__dirname, '..', '..')) {
  const vistos = new Set();
  const relatorios = [];

  MODULOS_AUDITORIA.forEach(({ modulo, arquivos }) => {
    arquivos.forEach((rel) => {
      if (vistos.has(rel)) return;
      vistos.add(rel);
      const res = auditarArquivo(rootDir, rel);
      res.forEach((r) => relatorios.push({ ...r, modulo }));
    });
  });

  return relatorios;
}

module.exports = {
  MODULOS_AUDITORIA,
  extrairInsertsDeArquivo,
  auditarArquivo,
  auditarModulos
};
