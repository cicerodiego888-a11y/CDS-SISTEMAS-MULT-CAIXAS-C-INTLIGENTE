/**
 * RC4.31.8 — Relatórios da homologação operacional da Central Inteligente
 * @module certification/CentralInteligenteHomologacaoReporter
 */
'use strict';

const fs = require('fs');
const path = require('path');

const FLUXOS_ORDEM = [
  'importacao_xml',
  'parser',
  'miip',
  'associacao_manual',
  'edicao',
  'datas',
  'parcelas',
  'compra',
  'estoque',
  'financeiro',
  'persistencia',
  'regressao'
];

function icone(ok) {
  return ok ? '✔' : '✘';
}

function parecerFinal(relatorio) {
  const fluxosOk = Object.values(relatorio.fluxos || {}).filter((f) => f.ok).length;
  const fluxosTotal = Object.keys(relatorio.fluxos || {}).length;
  const excecoes = relatorio.estatisticas?.quantidadeExcecoes ?? 0;

  if (fluxosOk === fluxosTotal && excecoes === 0) return 'APROVADA';
  if (fluxosOk >= Math.ceil(fluxosTotal * 0.85) && excecoes <= 2) return 'APROVADA COM RESSALVAS';
  return 'REPROVADA';
}

function gerarMarkdown(relatorio) {
  const linhas = [
    '# Homologação Operacional — Central Inteligente RC4.31.8',
    '',
    '## Ambiente',
    '',
    `- Versão: ${relatorio.ambiente?.versao || 'N/A'}`,
    `- Commit: ${relatorio.ambiente?.commit || 'local'}`,
    `- Build: ${relatorio.ambiente?.build || 'N/A'}`,
    `- Data: ${relatorio.geradoEm}`,
    '',
    '## Fluxos testados',
    ''
  ];

  FLUXOS_ORDEM.forEach((chave) => {
    const f = relatorio.fluxos?.[chave];
    if (!f) return;
    linhas.push(`${icone(f.ok)} ${f.titulo || chave}`);
    if (f.detalhe) linhas.push(`  - ${f.detalhe}`);
  });

  linhas.push('', '## Estatísticas', '');
  const s = relatorio.estatisticas || {};
  linhas.push(`- XMLs processados: ${s.xmlsProcessados ?? 0}`);
  linhas.push(`- Produtos identificados automaticamente: ${s.produtosIdentificadosAutomaticamente ?? 0}`);
  linhas.push(`- Produtos associados manualmente: ${s.produtosAssociadosManualmente ?? 0}`);
  linhas.push(`- Compras gravadas: ${s.comprasGravadas ?? 0}`);
  linhas.push(`- Exceções encontradas: ${s.quantidadeExcecoes ?? 0}`);
  linhas.push(`- Tempo médio de processamento: ${s.tempoMedioProcessamentoMs ?? 0} ms`);
  linhas.push(`- Tempo total da homologação: ${s.tempoTotalSeg ?? 0} s`);
  linhas.push(`- Cobertura dos fluxos críticos: ${relatorio.coberturaFluxos ?? 0}%`);

  if (relatorio.xmlsUtilizados?.length) {
    linhas.push('', '## XMLs utilizados', '');
    relatorio.xmlsUtilizados.slice(0, 30).forEach((x) => {
      linhas.push(`- chave …${String(x.chave || '').slice(-8)} | itens=${x.qtdItens ?? '?'} | cobr=${x.comCobranca ? 'sim' : 'não'}`);
    });
    if (relatorio.xmlsUtilizados.length > 30) {
      linhas.push(`- … e mais ${relatorio.xmlsUtilizados.length - 30} XML(s)`);
    }
  }

  if (relatorio.inconsistencias?.length) {
    linhas.push('', '## Inconsistências encontradas', '');
    relatorio.inconsistencias.forEach((i) => linhas.push(`- [${i.fluxo}] ${i.mensagem}`));
  }

  if (relatorio.excecoes?.length) {
    linhas.push('', '## Exceções', '');
    relatorio.excecoes.forEach((e) => linhas.push(`- [${e.etapa}] ${e.mensagem}`));
  }

  linhas.push(
    '',
    '## Parecer final',
    '',
    `**${relatorio.parecer || relatorio.status}**`,
    '',
    `Recomendação técnica de liberação: **${relatorio.recomendacao || relatorio.status}**`
  );

  return linhas.join('\n');
}

function gerarPdf(relatorio) {
  const md = gerarMarkdown(relatorio);
  const linhas = md.split('\n').slice(0, 90);
  const esc = (s) => String(s).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');

  const stream = ['BT', '/F1 9 Tf', '40 780 Td'];
  let y = 0;
  linhas.forEach((linha) => {
    const l = linha.replace(/[^\x20-\x7E]/g, '?').slice(0, 95);
    if (y > 0) stream.push('0 -12 Td');
    stream.push(`(${esc(l)}) Tj`);
    y += 1;
  });
  stream.push('ET');
  const content = stream.join('\n');

  const parts = ['%PDF-1.4'];
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

  const jsonPath = path.join(outDir, 'central-inteligente-homologacao.json');
  const mdPath = path.join(outDir, 'central-inteligente-homologacao.md');
  const pdfPath = path.join(outDir, 'central-inteligente-homologacao.pdf');

  fs.writeFileSync(jsonPath, `${JSON.stringify(relatorio, null, 2)}\n`, 'utf8');
  fs.writeFileSync(mdPath, `${gerarMarkdown(relatorio)}\n`, 'utf8');
  fs.writeFileSync(pdfPath, gerarPdf(relatorio));

  return { jsonPath, mdPath, pdfPath };
}

module.exports = {
  gerarMarkdown,
  gerarPdf,
  escreverRelatorios,
  parecerFinal,
  FLUXOS_ORDEM
};
