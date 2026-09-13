/**
 * Sprint 15.8 — CertificationReport (JSON / Markdown / PDF mínimo)
 */

'use strict';

function buildMarkdown(resultado) {
  const linhas = [
    `# Certificação de Driver — ${resultado.driverId}`,
    '',
    `**Resultado:** ${resultado.resultado}  `,
    `**Nota:** ${resultado.nota}  `,
    `**Versão:** ${resultado.driverVersao || '—'}  `,
    `**Firmware:** ${resultado.firmware || '—'}  `,
    `**Tempo:** ${resultado.tempoMs} ms  `,
    `**Executado em:** ${resultado.executadoEm}  `,
    `**Por:** ${resultado.executadoPor || 'sistema'}`,
    '',
    '## Resumo Executivo',
    '',
    `- Fabricante: ${resultado.fabricante || '—'}`,
    `- Modelo: ${resultado.modelo || '—'}`,
    `- OK: ${resultado.resumo?.ok ?? 0}/${resultado.resumo?.total ?? 0}`,
    `- Falhas: ${resultado.resumo?.fail ?? 0}`,
    `- Pendentes: ${resultado.resumo?.pendente ?? 0}`,
    '',
    '## Checklist',
    ''
  ];

  (resultado.checklist || []).forEach((i) => {
    const mark = i.status === 'OK' ? '✅' : (i.status === 'FAIL' ? '❌' : '⏳');
    linhas.push(`- ${mark} **${i.label}** (${i.status})${i.note ? ` — ${i.note}` : ''}`);
  });

  if ((resultado.falhas || []).length) {
    linhas.push('', '## Falhas', '');
    resultado.falhas.forEach((f) => {
      linhas.push(`- ${f.label}: ${f.note || 'falhou'}`);
    });
  }

  linhas.push('', '---', '_Gerado pelo Motor Universal — Observability Sprint 15.8_');
  return linhas.join('\n');
}

/**
 * PDF mínimo (texto) sem dependências externas.
 */
function buildPdfBuffer(resultado) {
  const text = [
    `Certificacao ${resultado.driverId}`,
    `Resultado: ${resultado.resultado}`,
    `Nota: ${resultado.nota}`,
    `Versao: ${resultado.driverVersao || '-'}`,
    `Firmware: ${resultado.firmware || '-'}`,
    `Tempo: ${resultado.tempoMs} ms`,
    '',
    ...(resultado.checklist || []).map((i) => `${i.status} ${i.label}`)
  ].join('\n');

  const escaped = text
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)')
    .split('\n')
    .map((line, idx) => `BT /F1 10 Tf 40 ${750 - idx * 14} Td (${line.slice(0, 90)}) Tj ET`)
    .join('\n');

  const stream = `${escaped}\n`;
  const objects = [];
  objects.push('1 0 obj<< /Type /Catalog /Pages 2 0 R >>endobj');
  objects.push('2 0 obj<< /Type /Pages /Kids [3 0 R] /Count 1 >>endobj');
  objects.push('3 0 obj<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources<< /Font<< /F1 5 0 R >> >> >>endobj');
  objects.push(`4 0 obj<< /Length ${Buffer.byteLength(stream, 'utf8')} >>stream\n${stream}endstream\nendobj`);
  objects.push('5 0 obj<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>endobj');

  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((obj) => {
    offsets.push(Buffer.byteLength(pdf, 'utf8'));
    pdf += `${obj}\n`;
  });
  const xrefPos = Buffer.byteLength(pdf, 'utf8');
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += '0000000000 65535 f \n';
  for (let i = 1; i < offsets.length; i += 1) {
    pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefPos}\n%%EOF`;
  return Buffer.from(pdf, 'utf8');
}

function buildReport(resultado, opcoes = {}) {
  const markdown = buildMarkdown(resultado);
  const json = {
    titulo: 'Relatório de Certificação — Motor Universal',
    sprint: '15.8',
    ...resultado,
    resumoExecutivo: {
      driver: resultado.driverId,
      resultado: resultado.resultado,
      nota: resultado.nota,
      versao: resultado.driverVersao,
      firmware: resultado.firmware,
      tempoMs: resultado.tempoMs
    }
  };

  const out = {
    json,
    markdown,
    geradoEm: new Date().toISOString()
  };

  if (opcoes.incluirPdf !== false) {
    const buf = buildPdfBuffer(resultado);
    out.pdf = {
      contentType: 'application/pdf',
      base64: buf.toString('base64'),
      bytes: buf.length
    };
  }

  return out;
}

module.exports = {
  buildMarkdown,
  buildPdfBuffer,
  buildReport
};
