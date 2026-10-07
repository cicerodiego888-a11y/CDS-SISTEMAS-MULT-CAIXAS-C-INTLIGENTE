/**
 * Renderer térmico do DANFE NFC-e (bobina 58/80mm, área útil ~48/72mm).
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
  if (right.length >= cols) {
    return [...(left ? quebrarTexto(left, cols) : []), ...quebrarTexto(right, cols)].join('\n');
  }
  const gap = cols - left.length - right.length;
  if (gap >= 1) return left + ' '.repeat(gap) + right;
  const maxLeft = Math.max(0, cols - right.length - 1);
  const leftCut = left.slice(0, maxLeft);
  const espacos = Math.max(1, cols - leftCut.length - right.length);
  return leftCut + ' '.repeat(espacos) + right;
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

  const porLinha = partes.length <= 4 ? partes.length : 4;
  const linhas = [];
  for (let i = 0; i < partes.length; i += porLinha) {
    const linha = partes.slice(i, i + porLinha).join(' ');
    if (linha.length <= cols) linhas.push(linha);
    else quebrarTexto(linha, cols).forEach((l) => linhas.push(l));
  }
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
    if (valores.length <= cols) {
      linhas.push(padLeft(valores, cols));
    } else {
      quebrarTexto(valores, cols).forEach((parte) => linhas.push(padRight(parte, cols)));
    }
  }

  return linhas;
}

function montarLinhasDanfeTermico(dados = {}) {
  const cols = larguraColunas(dados.papelMm);
  const linhas = [];
  const push = (s) => linhas.push(String(s ?? ''));

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

  return linhas.flatMap((l) => String(l ?? '').split('\n')).flatMap((texto) => {
    if (texto.length <= cols) return [padRight(texto, cols)];
    const partes = quebrarTexto(texto, cols);
    if (!partes.length) return [padRight('', cols)];
    return partes.map((parte) => padRight(parte, cols));
  });
}

function escapeHtml(texto) {
  return String(texto == null ? '' : texto)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function linhaValor(label, valor, extraClasse) {
  const classe = extraClasse ? `row ${extraClasse}` : 'row';
  return `<div class="${classe}"><span>${escapeHtml(label)}</span><span>${escapeHtml(valor)}</span></div>`;
}

function montarItensHtml(itens) {
  const lista = Array.isArray(itens) ? itens : [];
  return lista.map((item) => {
    const codigo = String(item.codigo || '').trim();
    const nome = String(item.nome || item.produto_nome || '').trim();
    const qtd = formatarQtdTermica(item.quantidade);
    const unit = formatarUnitarioTermico(item.precoUnitario);
    const tot = helpersDanfe().formatarMoeda(item.subtotal);
    const codigoHtml = codigo
      ? `<span class="cod">${escapeHtml(codigo)}</span> `
      : '';
    return `<div class="item">
      <div class="item-nome">${codigoHtml}<span class="desc">${escapeHtml(nome)}</span></div>
      <div class="item-linha">
        <span class="item-qtd">${escapeHtml(`${qtd} x R$ ${unit}`)}</span>
        <span class="item-tot">${escapeHtml(tot)}</span>
      </div>
    </div>`;
  }).join('');
}

function montarHtmlTermico(linhas, dados = {}) {
  void linhas;
  const papelMm = Number(dados.papelMm) === 58 ? 58 : 80;
  const cols = larguraColunas(papelMm);
  const moeda = (valor) => helpersDanfe().formatarMoeda(valor);

  const endereco = (dados.linhasEndereco || [])
    .map((linha) => `<div class="addr">${escapeHtml(linha)}</div>`)
    .join('');
  const razao = String(dados.razaoSocial || '').trim();
  const fantasia = String(dados.nomeFantasia || '').trim();
  const razaoHtml = razao && razao.toLowerCase() !== fantasia.toLowerCase()
    ? `<div class="razao">${escapeHtml(razao)}</div>`
    : '';

  const chaveLinhas = formatarChaveTermica(dados.chave, cols)
    .map((linha) => `<div>${escapeHtml(linha.trim())}</div>`)
    .join('');

  const qrHtml = dados.qrCodeDataUrl
    ? `<div class="qr"><img src="${dados.qrCodeDataUrl}" alt="QR Code NFC-e" /></div>`
    : '';

  const subtotal = Number(dados.subtotal || 0) > 0
    ? linhaValor('SUBTOTAL', moeda(dados.subtotal), 'sub')
    : '';
  const desconto = Number(dados.desconto || 0) > 0
    ? linhaValor('Desconto', moeda(dados.desconto))
    : '';
  const acrescimo = Number(dados.acrescimo || 0) > 0
    ? linhaValor('Acrescimo', moeda(dados.acrescimo))
    : '';

  const pagamentos = (dados.pagamentos || []).map((p) => {
    const label = helpersDanfe().formatarFormaPagamento(p.forma_pagamento).toUpperCase();
    return linhaValor(label, moeda(p.valor));
  }).join('');
  const totalPago = (dados.pagamentos || []).length
    ? linhaValor('TOTAL PAGO', moeda(dados.totalPago), 'pago')
    : '';

  let troco = '';
  if (Number(dados.troco || 0) > 0) {
    if (Number(dados.valorRecebido || 0) > 0) {
      troco += linhaValor('VALOR ENTREGUE', moeda(dados.valorRecebido));
    }
    troco += linhaValor('TROCO', moeda(dados.troco));
  }

  const tributos = dados.tributos ? `
    <section class="tributos">
      <div class="sec-title">Tributos Lei 12.741/2012</div>
      ${linhaValor('ICMS', moeda(dados.tributos.vICMS || 0))}
      ${linhaValor('PIS', moeda(dados.tributos.vPIS || 0))}
      ${linhaValor('COFINS', moeda(dados.tributos.vCOFINS || 0))}
    </section>` : '';

  const consumidor = dados.consumidorDoc
    ? `<div class="consumidor">CPF/CNPJ: ${escapeHtml(dados.consumidorDocFmt || dados.consumidorDoc)}</div>`
    : '';
  const homolog = dados.homologacao
    ? '<div class="homolog">EMITIDA EM HOMOLOGACAO — SEM VALOR FISCAL</div>'
    : '';
  const protocolo = dados.protocolo
    ? `<div class="proto">Protocolo: ${escapeHtml(dados.protocolo)}</div><div class="proto">Autorizado pela SEFAZ</div>`
    : '';
  const info = dados.informacoesAdicionais
    ? `<div class="info">${escapeHtml(String(dados.informacoesAdicionais))}</div>`
    : '';
  const dataHora = dados.dataHora
    ? `<div class="meta">${escapeHtml(String(dados.dataHora))}</div>`
    : '';
  const telefone = dados.telefoneFmt
    ? `<div class="addr">${escapeHtml(dados.telefoneFmt)}</div>`
    : '';
  const cnpj = dados.cnpjFmt
    ? `<div class="cnpj">CNPJ: ${escapeHtml(dados.cnpjFmt)}</div>`
    : '';

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8" />
  <title>DANFE NFC-e termico</title>
  <style>
    @page { size: ${papelMm}mm auto; margin: 0; }
    html, body {
      margin: 0; padding: 0;
      background: #fff; color: #000;
      -webkit-print-color-adjust: exact; print-color-adjust: exact;
    }
    body.danfe-termico {
      --qr: ${papelMm === 58 ? '26mm' : '42mm'};
      width: ${papelMm}mm; max-width: ${papelMm}mm;
      margin: 0 auto;
      padding: ${papelMm === 58 ? '1.2mm 2mm 1.6mm' : '1.5mm 2.5mm 2mm'};
      box-sizing: border-box;
      font-family: "Segoe UI", "Helvetica Neue", Arial, sans-serif;
      font-size: ${papelMm === 58 ? '9px' : '11px'};
      line-height: 1.2;
      font-weight: 600;
    }
    .header, .documento, .chave, .rodape, .itens, .totais, .pagamentos { width: 100%; max-width: 100%; box-sizing: border-box; }
    .header, .documento, .chave, .rodape { text-align: center; }
    .fantasia {
      font-size: 18px; font-weight: 800; line-height: 1.12;
      text-transform: uppercase; overflow-wrap: anywhere;
    }
    .razao { font-size: 13px; font-weight: 600; line-height: 1.2; overflow-wrap: anywhere; }
    .cnpj, .addr, .consumidor, .meta { font-size: 11px; font-weight: 600; line-height: 1.2; overflow-wrap: anywhere; }
    .doc-title { font-size: 16px; font-weight: 800; letter-spacing: 0.2px; line-height: 1.2; }
    .doc-sub { font-size: 11px; line-height: 1.2; }
    .meta-row, .row, .item-linha {
      display: flex; justify-content: space-between; align-items: baseline;
      gap: 2mm; width: 100%; max-width: 100%; box-sizing: border-box; line-height: 1.2;
    }
    .row span:first-child, .item-qtd, .item-nome { min-width: 0; overflow-wrap: anywhere; }
    .row span:last-child, .item-tot { white-space: nowrap; flex: 0 0 auto; }
    .sec-title { font-size: 12px; font-weight: 800; text-align: center; line-height: 1.2; }
    .sep { border: 0; border-top: 1px solid #000; margin: 0.8mm 0; height: 0; }
    .item { margin: 0 0 0.9mm; width: 100%; max-width: 100%; box-sizing: border-box; }
    .item-nome { font-size: 11px; font-weight: 700; line-height: 1.2; }
    .cod { font-weight: 800; }
    .item-qtd { font-size: 11px; line-height: 1.2; }
    .item-tot { text-align: right; font-size: 11px; font-weight: 800; line-height: 1.2; }
    .sub { font-size: 11px; }
    .total-row {
      font-size: 16px; font-weight: 700; line-height: 1.15;
      margin: 0.4mm 0; padding: 0.4mm 0;
      border-top: 1px solid #000; border-bottom: 1px solid #000;
    }
    .pays { font-size: 11px; width: 100%; max-width: 100%; }
    .pago { font-weight: 800; }
    .chave { font-size: 10px; line-height: 1.25; overflow-wrap: anywhere; }
    .chave .sec-title { margin-bottom: 0.4mm; }
    .qr { text-align: center; margin: 0.8mm 0; width: 100%; max-width: 100%; }
    .qr img {
      display: block; margin-left: auto; margin-right: auto;
      width: var(--qr); height: var(--qr); max-width: 100%;
      image-rendering: pixelated;
    }
    .proto, .info { font-size: 10px; line-height: 1.2; overflow-wrap: anywhere; }
    .thanks { font-size: 11px; font-weight: 800; line-height: 1.2; }
    .homolog { font-size: 10px; font-weight: 800; line-height: 1.2; margin-top: 0.4mm; }
    body.danfe-termico-58 .fantasia { font-size: 13px; }
    body.danfe-termico-58 .razao { font-size: 10px; }
    body.danfe-termico-58 .cnpj,
    body.danfe-termico-58 .addr,
    body.danfe-termico-58 .consumidor,
    body.danfe-termico-58 .meta,
    body.danfe-termico-58 .doc-sub,
    body.danfe-termico-58 .item-nome,
    body.danfe-termico-58 .item-qtd,
    body.danfe-termico-58 .item-tot,
    body.danfe-termico-58 .pays,
    body.danfe-termico-58 .sub,
    body.danfe-termico-58 .thanks { font-size: 9px; }
    body.danfe-termico-58 .doc-title,
    body.danfe-termico-58 .total-row { font-size: 12px; }
    body.danfe-termico-58 .sec-title { font-size: 10px; }
    body.danfe-termico-58 .chave,
    body.danfe-termico-58 .proto,
    body.danfe-termico-58 .info,
    body.danfe-termico-58 .homolog { font-size: 8px; }
  </style>
</head>
<body class="danfe-termico danfe-termico-${papelMm}">
  <header class="header">
    <div class="fantasia">${escapeHtml(fantasia)}</div>
    ${razaoHtml}
    ${cnpj}
    ${endereco}
    ${telefone}
  </header>
  <hr class="sep" />
  <section class="documento">
    <div class="doc-title">DANFE NFC-e</div>
    <div class="doc-sub">Documento Auxiliar da NFC-e</div>
    <div class="meta-row"><span>Nº ${escapeHtml(String(dados.numero || ''))}</span><span>SÉRIE ${escapeHtml(String(dados.serie || ''))}</span></div>
    ${dataHora}
    ${consumidor}
    ${homolog}
  </section>
  <hr class="sep" />
  <section class="itens">
    <div class="sec-title">ITENS</div>
    ${montarItensHtml(dados.itens)}
  </section>
  <hr class="sep" />
  <section class="totais">
    ${subtotal}
    ${desconto}
    ${acrescimo}
    ${linhaValor('TOTAL', moeda(dados.total), 'total-row')}
  </section>
  <section class="pagamentos">
    ${(dados.pagamentos || []).length ? '<div class="sec-title">PAGAMENTOS</div>' : ''}
    <div class="pays">${pagamentos}${totalPago}${troco}</div>
  </section>
  ${tributos}
  <hr class="sep" />
  <section class="chave">
    <div class="sec-title">CHAVE DE ACESSO</div>
    ${chaveLinhas}
  </section>
  ${qrHtml}
  <footer class="rodape">
    ${protocolo}
    ${info}
    <div class="thanks">Obrigado pela preferencia!</div>
  </footer>
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
