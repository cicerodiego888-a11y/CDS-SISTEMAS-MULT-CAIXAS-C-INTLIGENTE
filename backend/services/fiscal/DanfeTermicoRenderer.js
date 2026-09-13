/**
 * Renderer térmico do DANFE NFC-e (bobina 80mm / GT710).
 * Não recalcula tributos, totais ou pagamentos — só apresenta o DTO.
 * Não usa tabela HTML nem CSS de colunas.
 */

'use strict';

function helpersDanfe() {
  return require('./danfe');
}

const COLS_80 = 48;
const COLS_58 = 32;

function larguraColunas(papelMm) {
  return Number(papelMm) === 58 ? COLS_58 : COLS_80;
}

function sep(cols) {
  return '-'.repeat(cols);
}

function padRight(texto, largura) {
  const s = String(texto == null ? '' : texto);
  if (s.length >= largura) return s.slice(0, largura);
  return s + ' '.repeat(largura - s.length);
}

function padLeft(texto, largura) {
  const s = String(texto == null ? '' : texto);
  if (s.length >= largura) return s.slice(0, largura);
  return ' '.repeat(largura - s.length) + s;
}

function linhaLabelValor(label, valor, cols) {
  const right = String(valor == null ? '' : valor);
  const left = String(label == null ? '' : label);
  const gap = cols - left.length - right.length;
  if (gap >= 1) return left + ' '.repeat(gap) + right;
  const maxLeft = Math.max(1, cols - right.length - 1);
  return padRight(left, maxLeft) + ' ' + right;
}

function centralizar(texto, cols) {
  const s = String(texto == null ? '' : texto);
  if (s.length >= cols) return s.slice(0, cols);
  const left = Math.floor((cols - s.length) / 2);
  return ' '.repeat(left) + s;
}

function quebrarTexto(texto, largura) {
  const bruto = String(texto == null ? '' : texto).trim();
  if (!bruto) return [];
  if (largura < 1) return [bruto];

  const palavras = bruto.split(/\s+/).filter(Boolean);
  const linhas = [];
  let atual = '';

  const despejarLonga = (palavra) => {
    for (let i = 0; i < palavra.length; i += largura) {
      const pedaco = palavra.slice(i, i + largura);
      if (pedaco.length === largura) linhas.push(pedaco);
      else atual = pedaco;
    }
  };

  for (const palavra of palavras) {
    if (palavra.length > largura) {
      if (atual) {
        linhas.push(atual);
        atual = '';
      }
      despejarLonga(palavra);
      continue;
    }
    const tentativa = atual ? `${atual} ${palavra}` : palavra;
    if (tentativa.length > largura) {
      linhas.push(atual);
      atual = palavra;
    } else {
      atual = tentativa;
    }
  }
  if (atual) linhas.push(atual);
  return linhas;
}

function formatarQtdTermica(quantidade) {
  const n = Number(quantidade || 0);
  if (!Number.isFinite(n)) return '0,00';
  if (Number.isInteger(n)) return `${n},00`;
  return n.toFixed(2).replace('.', ',');
}

function formatarUnitarioTermico(valor) {
  return Number(valor || 0).toFixed(2).replace('.', ',');
}

function formatarChaveTermica(chave, cols) {
  const { formatarChaveAcessoGrupos } = helpersDanfe();
  const grupos = formatarChaveAcessoGrupos(chave);
  if (!grupos) return [];
  const partes = grupos.split(/\s+/).filter(Boolean);
  if (partes.length <= 1) return quebrarTexto(grupos, cols);

  const porLinha = 5;
  const linhas = [];
  if (partes.length <= porLinha) {
    return [partes.join(' ')];
  }
  linhas.push(partes.slice(0, porLinha).join(' '));
  const resto = partes.slice(porLinha).join(' ');
  if (resto.length <= cols) linhas.push(resto);
  else quebrarTexto(resto, cols).forEach((l) => linhas.push(l));
  return linhas;
}

function montarLinhasItens(itens, cols) {
  const linhas = [];
  const lista = Array.isArray(itens) ? itens : [];

  for (const item of lista) {
    const codigo = String(item.codigo || '').trim().slice(0, 12);
    const nome = String(item.nome || item.produto_nome || '').trim();
    const prefixo = codigo ? `${codigo}  ` : '';
    const larguraNome = Math.max(8, cols - prefixo.length);
    const nomeLinhas = quebrarTexto(nome, larguraNome);

    if (nomeLinhas.length === 0) {
      linhas.push(padRight(prefixo.trimEnd(), cols));
    } else {
      linhas.push(padRight(prefixo + nomeLinhas[0], cols));
      const indent = ' '.repeat(Math.min(prefixo.length, cols - 1));
      for (let i = 1; i < nomeLinhas.length; i += 1) {
        linhas.push(padRight(indent + nomeLinhas[i], cols));
      }
    }

    const qtd = formatarQtdTermica(item.quantidade);
    const unit = formatarUnitarioTermico(item.precoUnitario);
    const tot = formatarUnitarioTermico(item.subtotal);
    const valores = `${qtd} x ${unit} = ${tot}`;
    linhas.push(padLeft(valores, cols));
  }

  return linhas;
}

function montarLinhasDanfeTermico(dados = {}) {
  const cols = larguraColunas(dados.papelMm);
  const linhas = [];
  const push = (s) => linhas.push(padRight(s, cols));

  const fantasia = String(dados.nomeFantasia || '').trim();
  const razao = String(dados.razaoSocial || '').trim();
  quebrarTexto(fantasia, cols).forEach((l) => linhas.push(centralizar(l, cols)));
  if (razao && razao.toLowerCase() !== fantasia.toLowerCase()) {
    quebrarTexto(razao, cols).forEach((l) => linhas.push(centralizar(l, cols)));
  }
  if (dados.cnpjFmt) {
    linhas.push(centralizar(`CNPJ: ${dados.cnpjFmt}`, cols));
  }
  (dados.linhasEndereco || []).forEach((l) => {
    quebrarTexto(l, cols).forEach((p) => linhas.push(centralizar(p, cols)));
  });
  if (dados.telefoneFmt) {
    linhas.push(centralizar(dados.telefoneFmt, cols));
  }

  push(sep(cols));
  linhas.push(centralizar('DANFE NFC-e', cols));
  quebrarTexto('Documento Auxiliar da NFC-e', cols)
    .forEach((l) => linhas.push(centralizar(l, cols)));
  push(`Numero: ${dados.numero || ''}`);
  push(`Serie: ${dados.serie || ''}`);
  if (dados.dataHora) {
    quebrarTexto(String(dados.dataHora), cols).forEach(push);
  }
  if (dados.consumidorDoc) {
    quebrarTexto(`CPF/CNPJ: ${dados.consumidorDocFmt || dados.consumidorDoc}`, cols)
      .forEach(push);
  }
  if (dados.homologacao) {
    push(sep(cols));
    quebrarTexto('EMITIDA EM HOMOLOGACAO — SEM VALOR FISCAL', cols)
      .forEach((l) => linhas.push(centralizar(l, cols)));
  }

  push(sep(cols));
  linhas.push(centralizar('ITENS', cols));
  push(sep(cols));
  montarLinhasItens(dados.itens, cols).forEach((l) => linhas.push(l));

  push(sep(cols));
  if (Number(dados.subtotal || 0) > 0) {
    push(linhaLabelValor('Subtotal', helpersDanfe().formatarMoeda(dados.subtotal), cols));
  }
  if (Number(dados.desconto || 0) > 0) {
    push(linhaLabelValor('Desconto', helpersDanfe().formatarMoeda(dados.desconto), cols));
  }
  if (Number(dados.acrescimo || 0) > 0) {
    push(linhaLabelValor('Acrescimo', helpersDanfe().formatarMoeda(dados.acrescimo), cols));
  }
  push(sep(cols));
  push(linhaLabelValor('TOTAL', helpersDanfe().formatarMoeda(dados.total), cols));
  push(sep(cols));

  (dados.pagamentos || []).forEach((p) => {
    const label = helpersDanfe().formatarFormaPagamento(p.forma_pagamento).toUpperCase();
    push(linhaLabelValor(label, helpersDanfe().formatarMoeda(p.valor), cols));
  });
  if ((dados.pagamentos || []).length) {
    push(linhaLabelValor('TOTAL PAGO', helpersDanfe().formatarMoeda(dados.totalPago), cols));
  }
  if (Number(dados.troco || 0) > 0) {
    if (Number(dados.valorRecebido || 0) > 0) {
      push(linhaLabelValor('VALOR ENTREGUE', helpersDanfe().formatarMoeda(dados.valorRecebido), cols));
    }
    push(linhaLabelValor('TROCO', helpersDanfe().formatarMoeda(dados.troco), cols));
  }

  if (dados.tributos) {
    push(sep(cols));
    quebrarTexto('Tributos Lei 12.741/2012', cols).forEach(push);
    push(linhaLabelValor('ICMS', helpersDanfe().formatarMoeda(dados.tributos.vICMS || 0), cols));
    push(linhaLabelValor('PIS', helpersDanfe().formatarMoeda(dados.tributos.vPIS || 0), cols));
    push(linhaLabelValor('COFINS', helpersDanfe().formatarMoeda(dados.tributos.vCOFINS || 0), cols));
  }

  push(sep(cols));
  linhas.push(centralizar('CHAVE DE ACESSO', cols));
  formatarChaveTermica(dados.chave, cols).forEach((l) => linhas.push(centralizar(l, cols)));
  if (dados.qrCodeDataUrl || dados.qrCodeUrl) {
    linhas.push(centralizar('[QR CODE NFC-e]', cols));
  }
  if (dados.protocolo) {
    quebrarTexto(`Protocolo: ${dados.protocolo}`, cols).forEach(push);
  }
  if (dados.informacoesAdicionais) {
    quebrarTexto(String(dados.informacoesAdicionais), cols).forEach(push);
  }
  linhas.push(centralizar('Obrigado pela preferencia!', cols));
  linhas.push('');
  linhas.push('');
  linhas.push('');

  return linhas.map((l) => (l.length > cols ? l.slice(0, cols) : padRight(l, cols)));
}

function escapeHtml(texto) {
  return String(texto == null ? '' : texto)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function montarHtmlTermico(linhas, dados = {}) {
  const papelMm = Number(dados.papelMm) === 58 ? 58 : 80;
  const cols = larguraColunas(papelMm);
  const qrLargura = papelMm === 58 ? 160 : 200;
  const texto = linhas.join('\n');
  const chaveIdx = linhas.findIndex((l) => /CHAVE DE ACESSO/.test(l));
  const qrIdx = linhas.findIndex((l) => /\[QR CODE NFC-e\]/.test(l));

  let blocoAntes = texto;
  let blocoDepois = '';
  if (qrIdx >= 0) {
    blocoAntes = linhas.slice(0, qrIdx).join('\n');
    blocoDepois = linhas.slice(qrIdx + 1).join('\n');
  } else if (chaveIdx >= 0) {
    const corte = chaveIdx + 1 + formatarChaveTermica(dados.chave, cols).length;
    blocoAntes = linhas.slice(0, corte).join('\n');
    blocoDepois = linhas.slice(corte).join('\n');
  }

  const qrHtml = dados.qrCodeDataUrl
    ? `<div class="qr"><img src="${dados.qrCodeDataUrl}" alt="QR Code NFC-e" width="${qrLargura}" height="${qrLargura}" /></div>`
    : '';

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8" />
  <title>DANFE NFC-e termico</title>
  <style>
    @page { size: ${papelMm}mm auto; margin: 0; }
    html, body {
      margin: 0; padding: 0; width: ${papelMm}mm; max-width: ${papelMm}mm;
      background: #fff; color: #000;
      -webkit-print-color-adjust: exact; print-color-adjust: exact;
    }
    pre.termico {
      font-family: "Consolas", "Courier New", "Lucida Console", monospace;
      font-size: ${papelMm === 58 ? '10px' : '11px'};
      line-height: 1.12;
      white-space: pre;
      width: ${cols}ch;
      max-width: ${cols}ch;
      margin: 0 auto;
      padding: 1.5mm 1mm 2mm;
      letter-spacing: 0;
    }
    .qr { text-align: center; margin: 4px 0; }
    .qr img {
      display: block; margin: 0 auto;
      width: ${papelMm === 58 ? '36mm' : '42mm'};
      height: ${papelMm === 58 ? '36mm' : '42mm'};
      image-rendering: pixelated;
    }
  </style>
</head>
<body class="danfe-termico danfe-termico-${papelMm}">
<pre class="termico">${escapeHtml(blocoAntes)}</pre>
${qrHtml}
<pre class="termico">${escapeHtml(blocoDepois)}</pre>
</body>
</html>`;
}

function gerar(dadosEntrada = {}) {
  const dados = dadosEntrada && typeof dadosEntrada === 'object' ? dadosEntrada : {};
  const linhas = montarLinhasDanfeTermico(dados);
  return {
    papelMm: Number(dados.papelMm) === 58 ? 58 : 80,
    colunas: larguraColunas(dados.papelMm),
    linhas,
    texto: linhas.map((l) => l.trimEnd()).join('\n'),
    html: montarHtmlTermico(linhas, dados),
    qrCodeDataUrl: dados.qrCodeDataUrl || '',
    corteAutomaticoDriver: true
  };
}

module.exports = {
  gerar,
  montarLinhasDanfeTermico,
  quebrarTexto,
  linhaLabelValor,
  formatarChaveTermica,
  formatarQtdTermica,
  larguraColunas,
  COLS_80,
  COLS_58
};
