/**
 * RC4.32.0 — Relatórios da certificação de release (JSON, MD, PDF)
 * @module certification/ReleaseCertificationReporter
 */
'use strict';

const fs = require('fs');
const path = require('path');

const MODULOS_ORDEM = [
  'inicializacao', 'login', 'produtos', 'compras', 'financeiro', 'estoque',
  'miip', 'central', 'nfce', 'nfe', 'relatorios', 'performance'
];

function icone(ok) {
  return ok ? '✔' : '✘';
}

function gerarMarkdown(relatorio) {
  const linhas = [
    '# Release Certification Report — RC4.32.0',
    '',
    '## Ambiente',
    '',
    `- Versão: ${relatorio.ambiente.versao}`,
    `- Commit: ${relatorio.ambiente.commit}`,
    `- Build: ${relatorio.ambiente.build}`,
    `- Hash app.asar: \`${relatorio.ambiente.hashAppAsar || 'N/A'}\``,
    `- Origem: ${relatorio.ambiente.origem}`,
    `- Data: ${relatorio.geradoEm}`,
    '',
    '## Resultados',
    ''
  ];

  MODULOS_ORDEM.forEach((mod) => {
    const r = relatorio.modulos[mod];
    if (!r) return;
    linhas.push(`${icone(r.ok)} ${r.titulo || mod}`);
    if (r.detalhe) linhas.push(`  - ${r.detalhe}`);
  });

  linhas.push('', '## Estatísticas', '');
  const s = relatorio.estatisticas;
  linhas.push(`- Tempo total: ${s.tempoTotalSeg}s`);
  linhas.push(`- Memória máxima: ${s.memoriaMaxMb} MB`);
  linhas.push(`- CPU user: ${s.cpuUserMs} ms`);
  linhas.push(`- Testes/etapas: ${s.quantidadeEtapas}`);
  linhas.push(`- Exceções: ${s.quantidadeExcecoes}`);
  linhas.push(`- Consultas SQL: ${s.quantidadeConsultasSql}`);
  linhas.push(`- Cobertura funcional: ${relatorio.coberturaFuncional}%`);
  linhas.push('', `## Status da Release`, '', `**${relatorio.status}**`);

  if (relatorio.excecoes?.length) {
    linhas.push('', '## Exceções', '');
    relatorio.excecoes.forEach((e) => linhas.push(`- [${e.etapa}] ${e.mensagem}`));
  }

  return linhas.join('\n');
}

/** PDF mínimo (texto) — sem dependências externas */
function gerarPdf(relatorio) {
  const md = gerarMarkdown(relatorio);
  const linhas = md.split('\n').slice(0, 80);
  const texto = linhas.join('\n');
  const esc = (s) => String(s).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');

  const stream = [];
  stream.push('BT');
  stream.push('/F1 10 Tf');
  stream.push('50 780 Td');
  let y = 0;
  linhas.forEach((linha) => {
    const l = linha.replace(/[^\x20-\x7E]/g, '?').slice(0, 90);
    if (y > 0) stream.push('0 -14 Td');
    stream.push(`(${esc(l)}) Tj`);
    y += 1;
  });
  stream.push('ET');
  const content = stream.join('\n');

  const parts = [];
  parts.push('%PDF-1.4');
  const offsets = [0];
  let pos = parts.join('\n').length + 1;

  const addObj = (n, body) => {
    offsets[n] = pos;
    const chunk = `${n} 0 obj\n${body}\nendobj\n`;
    parts.push(chunk);
    pos += chunk.length;
  };

  addObj(1, '<< /Type /Catalog /Pages 2 0 R >>');
  addObj(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
  addObj(3, '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>');
  addObj(4, `<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
  addObj(5, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');

  const xrefPos = pos;
  parts.push('xref');
  parts.push(`0 ${offsets.length}`);
  parts.push('0000000000 65535 f ');
  for (let i = 1; i < offsets.length; i += 1) {
    parts.push(`${String(offsets[i]).padStart(10, '0')} 00000 n `);
  }
  parts.push('trailer');
  parts.push(`<< /Size ${offsets.length} /Root 1 0 R >>`);
  parts.push('startxref');
  parts.push(String(xrefPos));
  parts.push('%%EOF');
  return Buffer.from(parts.join('\n'), 'utf8');
}

function escreverRelatorios(rootDir, relatorio, opcoes = {}) {
  const outDir = opcoes.outDir || path.join(rootDir, 'docs', 'build');
  fs.mkdirSync(outDir, { recursive: true });

  const jsonPath = path.join(outDir, 'release-certification-report.json');
  const mdPath = path.join(outDir, 'release-certification-report.md');
  const pdfPath = path.join(outDir, 'release-certification-report.pdf');

  fs.writeFileSync(jsonPath, `${JSON.stringify(relatorio, null, 2)}\n`, 'utf8');
  fs.writeFileSync(mdPath, `${gerarMarkdown(relatorio)}\n`, 'utf8');
  fs.writeFileSync(pdfPath, gerarPdf(relatorio));

  return { jsonPath, mdPath, pdfPath };
}

module.exports = {
  gerarMarkdown,
  gerarPdf,
  escreverRelatorios,
  MODULOS_ORDEM
};
