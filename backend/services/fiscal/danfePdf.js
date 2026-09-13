/**
 * PDF do DANFE a partir do mesmo modelo/paginação do HTML.
 * A4 retrato. Não usa resumo textual.
 */

'use strict';

const { barrasParaPdf } = require('./danfeBarcode');
const { fmtMoney, fmtQtd, rotuloModFrete, RODAPE_DANFE, linhaEnderecoEmitente, nomeEmitenteVisual } = require('./danfeModelo');
const { paginarItensDanfe } = require('./danfePaginacao');

const W = 595.28;
const H = 841.89;
const ML = 14.17;
const MT = 14.17;
const USABLE = 200;

function mm(n) {
  return n * 2.83465;
}

function pdfEsc(text) {
  return String(text == null ? '' : text)
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)')
    .replace(/[^\x20-\x7E]/g, (ch) => {
      const map = {
        Á: 'A', À: 'A', Ã: 'A', Â: 'A', É: 'E', Ê: 'E', Í: 'I', Ó: 'O', Ô: 'O', Õ: 'O', Ú: 'U',
        Ç: 'C', á: 'a', à: 'a', ã: 'a', â: 'a', é: 'e', ê: 'e', í: 'i', ó: 'o', ô: 'o', õ: 'o',
        ú: 'u', ç: 'c', º: 'o', ª: 'a', '–': '-', '—': '-', '✓': 'X', Nº: 'No', nº: 'no'
      };
      return map[ch] || ' ';
    });
}

function wrap(text, max) {
  const s = String(text || '');
  if (s.length <= max) return [s];
  const out = [];
  let rest = s;
  while (rest.length) {
    if (rest.length <= max) {
      out.push(rest);
      break;
    }
    let cut = rest.lastIndexOf(' ', max);
    if (cut < max * 0.45) cut = max;
    out.push(rest.slice(0, cut));
    rest = rest.slice(cut).trim();
  }
  return out.slice(0, 3);
}

class PaginaPdf {
  constructor() {
    this.ops = ['0.4 w', '0 0 0 RG', '0 0 0 rg'];
  }

  y(mmFromTop) {
    return H - MT - mm(mmFromTop);
  }

  rect(x, yTop, w, h) {
    const px = ML + mm(x);
    const py = this.y(yTop) - mm(h);
    this.ops.push(`${px.toFixed(2)} ${py.toFixed(2)} ${mm(w).toFixed(2)} ${mm(h).toFixed(2)} re S`);
  }

  dash(x1, yTop, x2) {
    const y = this.y(yTop);
    this.ops.push(`[1.2 1.2] 0 d`);
    this.ops.push(`${(ML + mm(x1)).toFixed(2)} ${y.toFixed(2)} m ${(ML + mm(x2)).toFixed(2)} ${y.toFixed(2)} l S`);
    this.ops.push(`[] 0 d`);
  }

  text(x, yTop, str, size = 7) {
    const px = ML + mm(x);
    const py = this.y(yTop) - size;
    this.ops.push(`BT /F1 ${size} Tf ${px.toFixed(2)} ${py.toFixed(2)} Td (${pdfEsc(str)}) Tj ET`);
  }

  clip(x, yTop, w, h) {
    const px = ML + mm(x);
    const py = this.y(yTop) - mm(h);
    this.ops.push('q');
    this.ops.push(`${px.toFixed(2)} ${py.toFixed(2)} ${mm(w).toFixed(2)} ${mm(h).toFixed(2)} re W n`);
  }

  unclip() {
    this.ops.push('Q');
  }

  barcode(x, yTop, w, h, chave) {
    const px = ML + mm(x);
    const py = this.y(yTop) - mm(h);
    this.ops.push(barrasParaPdf(chave, px, py, mm(w), mm(h)));
  }

  stream() {
    return this.ops.join('\n');
  }
}

function celulas(p, y, cols) {
  let x = 0;
  const h = 6.8;
  cols.forEach((c) => {
    p.rect(x, y, c.w, h);
    p.text(x + 0.5, y + 0.3, String(c.l || '').toUpperCase(), 4.5);
    p.text(x + 0.5, y + 2.4, c.v == null ? '' : String(c.v), 7);
    x += c.w;
  });
  return y + h;
}

function desenharChave(p, x, y, w, m, compacto) {
  const hBar = compacto ? 8 : 11;
  if (m.chave) p.barcode(x + 0.8, y + 0.5, w - 1.6, hBar, m.chave);
  p.text(x + 1, y + hBar + 0.7, 'CHAVE DE ACESSO', 4.5);
  const linhas = m.chaveLinhas && m.chaveLinhas.length ? m.chaveLinhas : [m.chaveFormatada];
  linhas.forEach((ln, i) => p.text(x + 1, y + hBar + 2.6 + i * 3.1, ln, 6.5));
  const aposChave = y + hBar + 2.6 + linhas.length * 3.1 + 1.4;
  if (!compacto) {
    p.text(x + 1, aposChave, 'Consulta de autenticidade no portal nacional da NF-e', 4.5);
    p.text(x + 1, aposChave + 2.6, 'www.nfe.fazenda.gov.br/portal', 5);
    p.text(x + 1, aposChave + 4.8, 'ou no site da Sefaz autorizadora', 5);
  }
  if (m.chave) {
    p.ops.push(`BT /F1 0.01 Tf -200 -200 Td (${pdfEsc(m.chave)}) Tj ET`);
  }
}

function desenharPagina(modelo, pagina) {
  const p = new PaginaPdf();
  let y = 0;
  const primeira = pagina.folha === 1;

  if (modelo.previa) {
    p.text(40, 90, 'PREVIA - SEM VALOR FISCAL', 16);
  }

  if (primeira) {
    p.rect(0, y, 158, 22);
    p.rect(158, y, 42, 22);
    p.text(1, y + 0.8, `Recebemos de ${nomeEmitenteVisual(modelo.emitente.nome)} os produtos e/ou servicos constantes da Nota Fiscal Eletronica indicada ao lado.`, 6);
    p.text(1, y + 6.2, `Emissao: ${modelo.dataEmissao}   Dest/Reme: ${modelo.destinatario.nome}   Valor Total: ${fmtMoney(modelo.imposto.vNF)}`, 6);
    p.rect(0, y + 13.5, 70, 8.5);
    p.rect(70, y + 13.5, 88, 8.5);
    p.text(1, y + 14, 'DATA DO RECEBIMENTO', 4.5);
    p.text(71, y + 14, 'IDENTIFICACAO E ASSINATURA DO RECEBEDOR', 4.5);
    p.text(160, y + 1.2, `NF-e No ${modelo.numeroFormatado}`, 8);
    p.text(160, y + 5, `Serie ${modelo.serieFormatada}`, 8);
    if (modelo.chave) p.barcode(160, y + 9, 38, 11, modelo.chave);
    y = 23.2;
    p.dash(0, y, USABLE);
    y += 2.2;
  }

  const headH = primeira ? 42 : 22;
  p.rect(0, y, 86, headH);
  p.rect(86, y, 36, headH);
  p.rect(122, y, 78, headH);
  p.clip(0.4, y + 0.3, 85.2, headH - 0.6);
  const nomeVis = nomeEmitenteVisual(modelo.emitente.nome);
  const nomeLinhas = wrap(nomeVis, primeira ? 28 : 32);
  nomeLinhas.forEach((ln, i) => p.text(1.5, y + 1.2 + i * 3.5, ln, primeira ? 8.5 : 7));
  if (primeira) {
    const yEnder = y + 1.2 + nomeLinhas.length * 3.5 + 0.8;
    wrap(linhaEnderecoEmitente(modelo.emitente), 48).forEach((ln, i) => {
      p.text(1.5, yEnder + i * 3, ln, 6);
    });
    p.text(1.5, yEnder + 9.5, `Fone: ${modelo.emitente.fone}`, 6);
    if (modelo.emitente.email) p.text(1.5, yEnder + 12.5, String(modelo.emitente.email).slice(0, 48), 6);
  }
  p.unclip();
  p.text(90, y + 1.2, 'DANFE', primeira ? 12 : 10);
  if (primeira) {
    p.text(87.2, y + 6.5, 'Documento Auxiliar da', 5);
    p.text(87.2, y + 8.8, 'Nota Fiscal Eletronica', 5);
    p.text(90, y + 11.5, '0 - ENTRADA', 5);
    p.rect(97, y + 13.6, 4.5, 4.5);
    p.text(98, y + 14.2, String(modelo.tpNF) === '0' ? '0' : '1', 8);
    p.text(91, y + 18.4, '1 - SAIDA', 5);
    p.text(88, y + 23, `No ${modelo.numeroFormatado}`, 8);
    p.text(88, y + 27.5, `Serie ${modelo.serieFormatada}`, 7.5);
    p.text(88, y + 32, `Folha ${pagina.folha}/${pagina.total}`, 7.5);
  } else {
    p.text(88, y + 8, `No ${modelo.numeroFormatado}`, 7.5);
    p.text(88, y + 12, `Serie ${modelo.serieFormatada}`, 7);
    p.text(88, y + 16, `Folha ${pagina.folha}/${pagina.total}`, 7);
  }
  desenharChave(p, 123, y + 0.4, 76, modelo, !primeira);
  y += headH + 0.4;

  if (primeira) {
    y = celulas(p, y, [
      { w: 128, l: 'NATUREZA DA OPERACAO', v: modelo.natureza },
      { w: 72, l: 'PROTOCOLO DE AUTORIZACAO DE USO', v: [modelo.protocolo, modelo.dhAutorizacao].filter(Boolean).join(' ') }
    ]);
    y = celulas(p, y, [
      { w: 66, l: 'INSCRICAO ESTADUAL', v: modelo.emitente.ie },
      { w: 74, l: 'INSCRICAO ESTADUAL DO SUBSTITUTO TRIBUTARIO', v: modelo.emitente.ieSt },
      { w: 60, l: 'CNPJ / CPF', v: modelo.emitente.cnpj }
    ]);
    p.text(0.5, y + 0.2, 'DESTINATARIO / REMETENTE', 6);
    y += 3.4;
    y = celulas(p, y, [
      { w: 110, l: 'NOME / RAZAO SOCIAL', v: modelo.destinatario.nome },
      { w: 50, l: 'CNPJ / CPF', v: modelo.destinatario.cnpj },
      { w: 40, l: 'DATA DA EMISSAO', v: modelo.dataEmissao }
    ]);
    y = celulas(p, y, [
      { w: 80, l: 'ENDERECO', v: modelo.destinatario.endereco },
      { w: 46, l: 'BAIRRO / DISTRITO', v: modelo.destinatario.bairro },
      { w: 30, l: 'CEP', v: modelo.destinatario.cep },
      { w: 44, l: 'DATA DA SAIDA / ENTRADA', v: modelo.dataSaida }
    ]);
    y = celulas(p, y, [
      { w: 56, l: 'MUNICIPIO', v: modelo.destinatario.municipio },
      { w: 40, l: 'FONE / FAX', v: modelo.destinatario.fone },
      { w: 14, l: 'UF', v: modelo.destinatario.uf },
      { w: 46, l: 'INSCRICAO ESTADUAL', v: modelo.destinatario.ie },
      { w: 44, l: 'HORA DA SAIDA', v: modelo.horaSaida }
    ]);
    p.text(0.5, y + 0.2, 'CALCULO DO IMPOSTO', 6);
    y += 3.4;
    const i = modelo.imposto;
    y = celulas(p, y, [
      { w: 40, l: 'BASE DE CALCULO DO ICMS', v: fmtMoney(i.vBC) },
      { w: 40, l: 'VALOR DO ICMS', v: fmtMoney(i.vICMS) },
      { w: 40, l: 'BASE DE CALCULO DO ICMS ST', v: fmtMoney(i.vBCST) },
      { w: 40, l: 'VALOR DO ICMS ST', v: fmtMoney(i.vST) },
      { w: 40, l: 'VALOR TOTAL DOS PRODUTOS', v: fmtMoney(i.vProd) }
    ]);
    y = celulas(p, y, [
      { w: 32, l: 'VALOR DO FRETE', v: fmtMoney(i.vFrete) },
      { w: 32, l: 'VALOR DO SEGURO', v: fmtMoney(i.vSeg) },
      { w: 32, l: 'DESCONTO', v: fmtMoney(i.vDesc) },
      { w: 36, l: 'OUTRAS DESPESAS', v: fmtMoney(i.vOutro) },
      { w: 34, l: 'VALOR TOTAL DO IPI', v: fmtMoney(i.vIPI || i.vIPIDevol) },
      { w: 34, l: 'VALOR TOTAL DA NOTA', v: fmtMoney(i.vNF) }
    ]);
    p.text(0.5, y + 0.2, 'TRANSPORTADOR / VOLUMES TRANSPORTADOS', 6);
    y += 3.4;
    const t = modelo.transporte;
    y = celulas(p, y, [
      { w: 70, l: 'NOME / RAZAO SOCIAL', v: t.nome },
      { w: 32, l: 'FRETE POR CONTA', v: rotuloModFrete(t.modFrete) },
      { w: 24, l: 'CODIGO ANTT', v: t.rntc },
      { w: 26, l: 'PLACA DO VEICULO', v: t.placa },
      { w: 12, l: 'UF', v: t.ufVeic },
      { w: 36, l: 'CNPJ / CPF', v: t.cnpj }
    ]);
    y = celulas(p, y, [
      { w: 80, l: 'ENDERECO', v: t.endereco },
      { w: 50, l: 'MUNICIPIO', v: t.municipio },
      { w: 16, l: 'UF', v: t.uf },
      { w: 54, l: 'INSCRICAO ESTADUAL', v: t.ie }
    ]);
    y = celulas(p, y, [
      { w: 28, l: 'QUANTIDADE', v: t.qVol },
      { w: 32, l: 'ESPECIE', v: t.esp },
      { w: 32, l: 'MARCA', v: t.marca },
      { w: 32, l: 'NUMERACAO', v: t.nVol },
      { w: 38, l: 'PESO BRUTO', v: t.pesoB },
      { w: 38, l: 'PESO LIQUIDO', v: t.pesoL }
    ]);
  }

  p.text(0.5, y + 0.2, 'DADOS DOS PRODUTOS / SERVICOS', 6);
  y += 3.4;
  p.rect(0, y, USABLE, 5);
  p.text(0.4, y + 1.4, 'COD  DESCRICAO  NCM  CST  CFOP  UN  QTD  VL UNIT  VL TOTAL  BC ICMS  VL ICMS  VL IPI  ALIQ', 4.5);
  y += 5;
  (pagina.itens || []).forEach((it) => {
    const descLines = wrap(it.descricao, 34);
    const rowH = Math.max(5, 3.2 + descLines.length * 2.6);
    p.rect(0, y, USABLE, rowH);
    p.text(0.4, y + 1.2, String(it.codigo || ''), 5.5);
    descLines.forEach((ln, i) => p.text(16.5, y + 1.2 + i * 2.6, ln, 5.5));
    p.text(70, y + 1.2, String(it.ncm || ''), 5);
    p.text(84, y + 1.2, String(it.cst || ''), 5);
    p.text(96, y + 1.2, String(it.cfop || ''), 5);
    p.text(107, y + 1.2, String(it.unidade || ''), 5);
    p.text(116, y + 1.2, fmtQtd(it.qtd), 5);
    p.text(130, y + 1.2, fmtMoney(it.vUn), 5);
    p.text(148, y + 1.2, fmtMoney(it.vProd), 5);
    p.text(166, y + 1.2, fmtMoney(it.vBC), 5);
    p.text(180, y + 1.2, fmtMoney(it.vICMS), 5);
    p.text(190, y + 1.2, fmtMoney(it.vIPI), 5);
    y += rowH;
  });

  if (pagina.extra) {
    p.text(0.5, y + 0.2, 'DADOS ADICIONAIS', 6);
    y += 3.4;
    p.rect(0, y, 118, 20);
    p.rect(118, y, 82, 20);
    p.text(0.6, y + 0.4, 'INFORMACOES COMPLEMENTARES', 4.5);
    const refs = (modelo.refs || []).map((c, i) => `NFe referenciada: ${(modelo.refsFormatadas && modelo.refsFormatadas[i]) || c} ${c}`);
    const inf = [modelo.infCpl, ...refs].filter(Boolean).join(' | ');
    wrap(inf, 92).forEach((ln, i) => p.text(0.6, y + 3 + i * 3, ln, 5.5));
    p.text(119, y + 0.4, 'RESERVADO AO FISCO', 4.5);
    y += 21;
  }

  p.text(0.5, 280, RODAPE_DANFE, 6);
  return p.stream();
}

function gerarPdfDanfeDoModelo(modelo) {
  const pags = paginarItensDanfe(modelo);
  const streams = pags.map((pg) => desenharPagina(modelo, pg));
  const objects = [];
  objects.push('<< /Type /Catalog /Pages 2 0 R >>');
  const kids = pags.map((_, i) => `${3 + i * 2} 0 R`).join(' ');
  objects.push(`<< /Type /Pages /Kids [${kids}] /Count ${pags.length} >>`);
  const fontObjIndex = 3 + pags.length * 2;
  streams.forEach((content, i) => {
    const pageObj = 3 + i * 2;
    const contObj = pageObj + 1;
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Contents ${contObj} 0 R /Resources << /Font << /F1 ${fontObjIndex} 0 R >> >> >>`
    );
    objects.push(`<< /Length ${Buffer.byteLength(content, 'utf8')} >>\nstream\n${content}\nendstream`);
  });
  objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');

  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((obj, i) => {
    offsets.push(Buffer.byteLength(pdf, 'utf8'));
    pdf += `${i + 1} 0 obj\n${obj}\nendobj\n`;
  });
  const xref = Buffer.byteLength(pdf, 'utf8');
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i < offsets.length; i += 1) {
    pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer << /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(pdf, 'utf8');
}

module.exports = {
  gerarPdfDanfeDoModelo
};
