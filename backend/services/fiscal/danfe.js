const QRCodeService = require('../qrcode/QRCodeService');

/**
 * PRINT-RC1.0 — Layout visual do Cupom Fiscal (DANFE NFC-e).
 * Motor: HTML → Chromium/Electron (não ESC/POS).
 * Altera SOMENTE apresentação. Dados fiscais / QR / tributos inalterados.
 */

function montarPagamentosDanfe(pagamentos) {
  if (!Array.isArray(pagamentos) || pagamentos.length === 0) {
    return '';
  }

  return pagamentos.map(p => {
    return `${formatarFormaPagamento(p.forma_pagamento)}: ${formatarMoeda(p.valor)}`;
  }).join('\n');
}

function obterPagamentosComerciaisDanfe(pagamentos = []) {
  const lista = Array.isArray(pagamentos) ? pagamentos : [];
  if (lista.length === 0) return [];

  const mapa = new Map();
  for (const p of lista) {
    const forma = String(p.forma_pagamento || p.forma || '').toLowerCase().trim() || 'outro';
    const valor = Number(p.valor || 0);
    if (!Number.isFinite(valor) || valor <= 0) continue;
    mapa.set(forma, Math.round(((mapa.get(forma) || 0) + valor) * 100) / 100);
  }

  return Array.from(mapa.entries()).map(([forma_pagamento, valor]) => ({
    forma_pagamento,
    valor
  }));
}

function somarPagamentosDanfe(pagamentos = []) {
  return Math.round(
    (Array.isArray(pagamentos) ? pagamentos : []).reduce(
      (s, p) => s + Number(p.valor || 0),
      0
    ) * 100
  ) / 100;
}

function resolverPagamentosExibicaoDanfe(venda = {}) {
  const total = Math.round(Number(venda.total || 0) * 100) / 100;
  const recebimentos = Array.isArray(venda.pagamentos) ? venda.pagamentos : [];
  const comerciais = Array.isArray(venda.pagamentos_comerciais)
    ? venda.pagamentos_comerciais
    : [];

  const fromRec = obterPagamentosComerciaisDanfe(recebimentos);
  const somaRec = somarPagamentosDanfe(fromRec);
  if (fromRec.length > 0 && (total <= 0 || Math.abs(somaRec - total) <= 0.01)) {
    return fromRec;
  }

  const fromCom = obterPagamentosComerciaisDanfe(comerciais);
  const somaCom = somarPagamentosDanfe(fromCom);
  if (fromCom.length > 0 && (total <= 0 || Math.abs(somaCom - total) <= 0.01)) {
    return fromCom;
  }

  const mesclado = obterPagamentosComerciaisDanfe([...recebimentos, ...comerciais]);
  const somaMesclado = somarPagamentosDanfe(mesclado);
  if (mesclado.length > 0 && (total <= 0 || Math.abs(somaMesclado - total) <= 0.01)) {
    return mesclado;
  }

  if (fromRec.length > 0 && total > 0 && somaRec < total - 0.01) {
    const falta = Math.round((total - somaRec) * 100) / 100;
    const formasRec = new Set(fromRec.map((p) => p.forma_pagamento));
    const extra = fromCom.find((p) => !formasRec.has(p.forma_pagamento));
    const formaFalta = extra?.forma_pagamento
      || String(venda.forma_pagamento || fromRec[0].forma_pagamento || 'outro').toLowerCase();
    return obterPagamentosComerciaisDanfe([
      ...fromRec,
      { forma_pagamento: formaFalta, valor: falta }
    ]);
  }

  if (fromCom.length === 1 && total > 0) {
    return [{ forma_pagamento: fromCom[0].forma_pagamento, valor: total }];
  }

  const formaVenda = String(venda.forma_pagamento || '').toLowerCase().trim();
  if (formaVenda && formaVenda !== 'misto' && total > 0) {
    return [{ forma_pagamento: formaVenda, valor: total }];
  }

  return fromRec.length ? fromRec : fromCom;
}

function formatarFormaPagamento(forma) {
  const nomes = {
    dinheiro: 'Dinheiro',
    pix: 'PIX',
    cartao: 'Cartão',
    cartao_debito: 'Cartão Débito',
    cartao_credito: 'Cartão Crédito',
    tef: 'TEF',
    misto: 'Misto',
    troco: 'Troco'
  };

  return nomes[forma] || forma;
}

function formatarMoeda(valor) {
  return 'R$ ' + Number(valor || 0).toFixed(2).replace('.', ',');
}

function obterQuantidadeFiscalDanfe(item = {}) {
  return Number(item.quantidade_fiscal ?? 0);
}

function obterValorFiscalItemDanfe(item = {}) {
  return Number(item.valor_fiscal ?? 0);
}

function obterQuantidadeImpressao(item = {}) {
  return Number(item.quantidade_fiscal ?? 0) + Number(item.quantidade_nao_fiscal ?? 0);
}

function obterValorImpressao(item = {}) {
  return Number(item.valor_fiscal ?? 0) + Number(item.valor_nao_fiscal ?? 0);
}

function formatarCNPJ(cnpj) {
  if (!cnpj) return '';
  const numeros = String(cnpj).replace(/\D/g, '');
  if (numeros.length !== 14) return cnpj;
  return numeros.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5');
}

function formatarCpfCnpj(valor) {
  const v = String(valor || '').replace(/\D/g, '');
  if (v.length === 11) {
    return v.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
  }
  if (v.length === 14) {
    return v.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
  }
  return valor || '';
}

function formatarCep(cep) {
  const d = String(cep || '').replace(/\D/g, '');
  if (d.length !== 8) return cep || '';
  return d.replace(/(\d{5})(\d{3})/, '$1-$2');
}

function formatarTelefone(tel) {
  const d = String(tel || '').replace(/\D/g, '');
  if (d.length === 11) return d.replace(/(\d{2})(\d{5})(\d{4})/, '($1) $2-$3');
  if (d.length === 10) return d.replace(/(\d{2})(\d{4})(\d{4})/, '($1) $2-$3');
  return String(tel || '').trim();
}

function escapeHtml(texto) {
  return String(texto == null ? '' : texto)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function resolverLarguraPapelMm(empresa = {}, opcoes = {}) {
  const raw = Number(opcoes.larguraMm || empresa.larguraMm || empresa.largura_mm || 80);
  return raw === 58 ? 58 : 80;
}

function resolverNomeFantasia(empresa = {}) {
  return String(empresa.nomeFantasia || empresa.nome_fantasia || empresa.nome || '').trim();
}

function resolverRazaoSocial(empresa = {}) {
  return String(
    empresa.razaoSocial || empresa.razao_social || empresa.nomeEmpresa || empresa.nome || ''
  ).trim();
}

function montarLinhasEndereco(empresa = {}, maxChars = 36) {
  const logradouro = String(empresa.logradouro || '').trim();
  const numero = String(empresa.numero || empresa.numeroEndereco || '').trim();
  const bairro = String(empresa.bairro || '').trim();
  const municipio = String(empresa.municipio || empresa.municipioNome || '').trim();
  const uf = String(empresa.uf || '').trim();
  const cep = String(empresa.cep || '').trim();

  if (logradouro || bairro || municipio) {
    const linhas = [];
    const rua = [logradouro, numero].filter(Boolean).join(', ');
    if (rua) linhas.push(rua);
    if (bairro) linhas.push(bairro);
    const cidadeUf = [municipio, uf].filter(Boolean).join(' - ');
    if (cidadeUf) linhas.push(cidadeUf);
    if (cep) linhas.push(`CEP ${formatarCep(cep)}`);
    return linhas;
  }

  const texto = String(empresa.endereco || '').trim();
  if (!texto) return [];

  const partes = texto.split(/,\s*/).map((p) => p.trim()).filter(Boolean);
  if (partes.length > 1) return partes;

  const linhas = [];
  let atual = '';
  for (const palavra of texto.split(/\s+/)) {
    const tentativa = atual ? `${atual} ${palavra}` : palavra;
    if (tentativa.length > maxChars && atual) {
      linhas.push(atual);
      atual = palavra;
    } else {
      atual = tentativa;
    }
  }
  if (atual) linhas.push(atual);
  return linhas;
}

function formatarChaveAcessoGrupos(chave) {
  const d = String(chave || '').replace(/\D/g, '');
  if (d.length < 44) return String(chave || '');
  return d.replace(/(\d{4})(?=\d)/g, '$1 ').trim();
}

function obterCodigoItem(item = {}) {
  return String(
    item.produto_codigo || item.codigo || item.produto_codigo_barras || item.produto_id || ''
  ).trim();
}

function montarPagamentosHtml(pagamentos = []) {
  if (!Array.isArray(pagamentos) || pagamentos.length === 0) return '';
  return pagamentos.map((p) => {
    const label = formatarFormaPagamento(p.forma_pagamento);
    const valor = formatarMoeda(p.valor);
    return `<div class="row"><span>${escapeHtml(label)}</span><span>${escapeHtml(valor)}</span></div>`;
  }).join('');
}

function icoEmpresa() {
  return '<svg class="ico brand-ico" viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M2 14V4l6-2 6 2v10H9V9H7v5H2zm2-2h2V8h4v4h2V5.2L8 3.4 4 5.2V12z"/></svg>';
}

function icoLocal() {
  return '<svg class="ico" viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M8 1a5 5 0 0 0-5 5c0 3.5 5 9 5 9s5-5.5 5-9a5 5 0 0 0-5-5zm0 7a2 2 0 1 1 0-4 2 2 0 0 1 0 4z"/></svg>';
}

function icoTelefone() {
  return '<svg class="ico" viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M3.5 1.5h3l1 3-2 1.5a9 9 0 0 0 4.5 4.5l1.5-2 3 1v3A1.5 1.5 0 0 1 13 14 11.5 11.5 0 0 1 2 3a1.5 1.5 0 0 1 1.5-1.5z"/></svg>';
}

async function montarDadosDanfe({
  venda = {},
  itens: itensDanfe = [],
  itensFiscal = [],
  empresa = {},
  chave,
  numero,
  serie,
  qrCodeUrl,
  tributos,
  nota,
  larguraMm
} = {}) {
  void itensFiscal;

  const tpAmbDanfe = Number(
    nota?.tpAmb || nota?.ambiente || venda?.tpAmb || venda?.ambiente || 1
  );

  const papelMm = resolverLarguraPapelMm(empresa, { larguraMm });
  const qrLargura = papelMm === 58 ? 160 : 200;

  const qrCodeDataUrl = qrCodeUrl
    ? (await QRCodeService.gerarLink(qrCodeUrl, {
      formato: 'dataurl',
      largura: qrLargura,
      uso: 'danfe'
    })).imagem || ''
    : '';

  const itensOrigem = Array.isArray(itensDanfe) ? itensDanfe : [];
  const itens = itensOrigem.map((item) => {
    const quantidade = obterQuantidadeImpressao(item);
    const subtotal = obterValorImpressao(item);
    const precoUnitario = quantidade > 0
      ? subtotal / quantidade
      : Number(item.preco_unitario || 0);
    return {
      codigo: obterCodigoItem(item),
      nome: String(item.produto_nome || item.nome || ''),
      quantidade,
      precoUnitario,
      subtotal
    };
  });

  const pagamentos = resolverPagamentosExibicaoDanfe(venda).map((p) => ({
    forma_pagamento: p.forma_pagamento,
    valor: Number(p.valor || 0)
  }));

  const valorTotalVenda = Number(venda.total ?? 0) > 0
    ? Number(venda.total)
    : itens.reduce((acc, item) => acc + Number(item.subtotal || 0), 0);

  const desconto = Number(venda.desconto || 0);
  const acrescimo = Number(venda.acrescimo || venda.outro || 0);
  const subtotal = Number(venda.subtotal || 0) > 0
    ? Number(venda.subtotal)
    : itens.reduce((acc, item) => acc + Number(item.subtotal || 0), 0);
  const trocoCampo = Number(venda.troco || venda.valor_troco || 0);
  const valorRecebido = Number(venda.valor_recebido || 0);
  const troco = trocoCampo > 0
    ? trocoCampo
    : (valorRecebido > valorTotalVenda ? valorRecebido - valorTotalVenda : 0);
  const totalPago = somarPagamentosDanfe(pagamentos);

  const consumidorDoc = venda.cpf_cnpj_nota || venda.cliente_cpf || '';

  return {
    papelMm,
    qrLargura,
    fsBase: papelMm === 58 ? '9.5px' : '11px',
    fsFantasia: papelMm === 58 ? '15px' : '18px',
    qrCodeUrl: qrCodeUrl || '',
    qrCodeDataUrl,
    itensOrigem,
    itens,
    pagamentos,
    total: valorTotalVenda,
    subtotal,
    desconto,
    acrescimo,
    troco,
    valorRecebido,
    totalPago,
    nomeFantasia: resolverNomeFantasia(empresa),
    razaoSocial: resolverRazaoSocial(empresa),
    linhasEndereco: montarLinhasEndereco(empresa, papelMm === 58 ? 28 : 36),
    telefoneFmt: formatarTelefone(empresa.telefone || ''),
    cnpjFmt: formatarCNPJ(empresa.cnpj),
    protocolo: String(nota?.protocolo || venda?.protocolo || '').trim(),
    dataHora: String(
      nota?.data_autorizacao || nota?.updated_at || venda?.data_hora
      || venda?.created_at || venda?.data_venda || ''
    ).trim(),
    chave: chave || '',
    chaveGrupos: formatarChaveAcessoGrupos(chave),
    numero,
    serie,
    tributos: tributos || null,
    tpAmb: tpAmbDanfe,
    homologacao: tpAmbDanfe === 2,
    consumidorDoc,
    consumidorDocFmt: consumidorDoc ? formatarCpfCnpj(consumidorDoc) : '',
    informacoesAdicionais: String(
      venda.informacoes_adicionais || venda.observacao || nota?.informacoes_adicionais || ''
    ).trim(),
    _danfeDto: true
  };
}

async function gerarDanfeHtml(args = {}) {
  const dados = args && args._danfeDto
    ? args
    : await montarDadosDanfe(args);

  const avisoHomologacao = dados.homologacao
    ? '<div class="homolog">EMITIDA EM AMBIENTE DE HOMOLOGAÇÃO — SEM VALOR FISCAL</div>'
    : '';

  const papelMm = dados.papelMm;
  const qrLargura = dados.qrLargura;
  const fsBase = dados.fsBase;
  const fsFantasia = dados.fsFantasia;
  const qrCodeDataUrl = dados.qrCodeDataUrl;
  const itensImpressao = dados.itensOrigem || [];
  const pagamentosComerciais = dados.pagamentos;
  const textoPagamentos = montarPagamentosDanfe(pagamentosComerciais);
  const pagamentosHtml = montarPagamentosHtml(pagamentosComerciais);
  const valorTotalVenda = dados.total;
  const desconto = dados.desconto;
  const nomeFantasia = dados.nomeFantasia;
  const razaoSocial = dados.razaoSocial;
  const linhasEndereco = dados.linhasEndereco;
  const telefoneFmt = dados.telefoneFmt;
  const cnpjFmt = dados.cnpjFmt;
  const protocolo = dados.protocolo;
  const dataHora = dados.dataHora;
  const chave = dados.chave;
  const numero = dados.numero;
  const serie = dados.serie;
  const tributos = dados.tributos;

  const itensHtml = itensImpressao.map((item) => {
    const quantidade = obterQuantidadeImpressao(item);
    const subtotal = obterValorImpressao(item);
    const precoUnitario = quantidade > 0
      ? subtotal / quantidade
      : Number(item.preco_unitario || 0);
    const codigo = obterCodigoItem(item);
    const nome = String(item.produto_nome || '');
    return `
    <tr>
      <td class="col-cod">${escapeHtml(codigo)}</td>
      <td class="col-desc">${escapeHtml(nome)}</td>
      <td class="col-qtd">${escapeHtml(String(quantidade))}</td>
      <td class="col-vl">${escapeHtml(precoUnitario.toFixed(2))}</td>
      <td class="col-tot">${escapeHtml(subtotal.toFixed(2))}</td>
    </tr>`;
  }).join('');

  const tributosHtml = tributos ? `
    <div class="block muted">
      <div>Tributos Totais Incidentes (Lei Federal 12.741/2012):</div>
      <div class="row"><span>ICMS</span><span>R$ ${Number(tributos.vICMS || 0).toFixed(2)}</span></div>
      <div class="row"><span>PIS</span><span>R$ ${Number(tributos.vPIS || 0).toFixed(2)}</span></div>
      <div class="row"><span>COFINS</span><span>R$ ${Number(tributos.vCOFINS || 0).toFixed(2)}</span></div>
    </div>` : '';

  const consumidorDoc = dados.consumidorDoc;
  const consumidorHtml = consumidorDoc
    ? `<div class="center consumer">CPF/CNPJ do Consumidor: ${escapeHtml(formatarCpfCnpj(consumidorDoc))}</div>`
    : '';

  const enderecoHtml = linhasEndereco.map((linha) => (
    `<div class="addr-line">${icoLocal()}<span>${escapeHtml(linha)}</span></div>`
  )).join('');

  const telefoneHtml = telefoneFmt
    ? `<div class="addr-line">${icoTelefone()}<span>${escapeHtml(telefoneFmt)}</span></div>`
    : '';

  const razaoHtml = razaoSocial
    ? `<div class="razao">${escapeHtml(razaoSocial)}</div>`
    : '';

  let trocoHtml = '';
  if (Number(dados.troco || 0) > 0) {
    if (Number(dados.valorRecebido || 0) > 0) {
      trocoHtml += `<div class="row"><span>Valor entregue</span><span>${escapeHtml(formatarMoeda(dados.valorRecebido))}</span></div>`;
    }
    trocoHtml += `<div class="row"><span>Troco</span><span>${escapeHtml(formatarMoeda(dados.troco))}</span></div>`;
  }

  const totalLegado = `Total: R$ ${valorTotalVenda.toFixed(2)}`;
  const pagamentosLegado = textoPagamentos
    ? `<div class="sr-only">${escapeHtml(textoPagamentos)}</div>`
    : '';

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8" />
  <title>DANFE NFC-e</title>
  <style>
    :root { --danfe-width: ${papelMm}mm; --danfe-ink: #111; --danfe-muted: #333; --danfe-line: #999; }
    * { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; color: var(--danfe-ink); background: #fff; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    body.danfe {
      width: var(--danfe-width); max-width: var(--danfe-width); margin: 0 auto; padding: 2mm 2.2mm 3mm;
      font-family: "Segoe UI", "Helvetica Neue", Arial, sans-serif; font-size: ${fsBase}; line-height: 1.25;
    }
    .center { text-align: center; }
    .header { text-align: center; margin: 0 0 2px; }
    .fantasia { font-size: ${fsFantasia}; font-weight: 800; letter-spacing: 0.2px; line-height: 1.15; text-transform: uppercase; margin: 0; }
    .razao { font-size: ${papelMm === 58 ? '9px' : '10.5px'}; font-weight: 400; color: var(--danfe-muted); margin: 1px 0 0; line-height: 1.2; }
    .cnpj { margin-top: 3px; font-size: ${papelMm === 58 ? '9px' : '10.5px'}; font-weight: 600; }
    .addr { margin-top: 4px; font-size: ${papelMm === 58 ? '8.5px' : '10px'}; color: var(--danfe-muted); }
    .addr-line { display: flex; align-items: flex-start; justify-content: center; gap: 4px; margin: 1px 0; }
    .addr-line span { max-width: 92%; }
    .ico { width: 9px; height: 9px; flex: 0 0 auto; margin-top: 1px; opacity: 0.85; }
    .brand-ico { display: inline-block; vertical-align: -1px; margin-right: 3px; }
    .sep { border: 0; border-top: 1px solid var(--danfe-line); margin: 6px 0; height: 0; }
    .danfe-title { text-align: center; font-weight: 800; font-size: ${papelMm === 58 ? '11px' : '12.5px'}; letter-spacing: 0.4px; margin: 0; }
    .danfe-sub { text-align: center; font-size: ${papelMm === 58 ? '8px' : '9px'}; color: var(--danfe-muted); margin: 2px 0 0; line-height: 1.2; }
    .meta { text-align: center; margin-top: 4px; font-size: ${papelMm === 58 ? '9px' : '10px'}; }
    .consumer { margin-top: 4px; font-size: ${papelMm === 58 ? '8.5px' : '9.5px'}; }
    table.items { width: 100%; border-collapse: collapse; table-layout: fixed; margin: 2px 0; font-size: ${papelMm === 58 ? '8px' : '9.5px'}; }
    table.items th { font-weight: 700; border-bottom: 1px solid var(--danfe-line); padding: 2px 1px; text-align: left; }
    table.items td { padding: 3px 1px; vertical-align: top; word-break: break-word; }
    .col-cod { width: ${papelMm === 58 ? '14%' : '12%'}; }
    .col-desc { width: ${papelMm === 58 ? '36%' : '40%'}; }
    .col-qtd { width: 12%; text-align: center; }
    .col-vl { width: 18%; text-align: right; }
    .col-tot { width: 18%; text-align: right; font-weight: 600; }
    th.col-qtd { text-align: center; }
    th.col-vl, th.col-tot { text-align: right; }
    .row { display: flex; justify-content: space-between; align-items: baseline; gap: 8px; margin: 2px 0; }
    .total-box { margin: 6px 0 4px; padding: 5px 4px; border-top: 2px solid #000; border-bottom: 2px solid #000; }
    .total-box .row { font-size: ${papelMm === 58 ? '12px' : '14px'}; font-weight: 800; letter-spacing: 0.3px; }
    .pays { margin: 2px 0 4px; font-size: ${papelMm === 58 ? '9px' : '10.5px'}; }
    .block.muted { font-size: ${papelMm === 58 ? '8px' : '9px'}; color: var(--danfe-muted); }
    .qr { text-align: center; margin: 10px 0 8px; }
    .qr img { display: block; margin: 0 auto; width: ${papelMm === 58 ? '38mm' : '42mm'}; height: ${papelMm === 58 ? '38mm' : '42mm'}; image-rendering: pixelated; }
    .qr-caption { margin-top: 4px; font-size: ${papelMm === 58 ? '8px' : '9px'}; color: var(--danfe-muted); }
    .chave { font-size: ${papelMm === 58 ? '8px' : '9px'}; text-align: center; word-break: break-word; letter-spacing: 0.3px; margin: 3px 0; }
    .footer { text-align: center; font-size: ${papelMm === 58 ? '8px' : '9px'}; color: var(--danfe-muted); margin-top: 4px; }
    .thanks { text-align: center; font-weight: 700; margin-top: 6px; font-size: ${papelMm === 58 ? '9.5px' : '11px'}; }
    .homolog { text-align: center; font-weight: 800; margin: 8px 0 2px; font-size: ${papelMm === 58 ? '8.5px' : '10px'}; border: 1px solid #000; padding: 4px 2px; }
    .sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0,0,0,0); border: 0; }
    @media print { body.danfe { width: var(--danfe-width); } }
  </style>
</head>
<body class="danfe danfe-${papelMm}">
  <header class="header">
    <div class="fantasia">${icoEmpresa()}${escapeHtml(nomeFantasia)}</div>
    ${razaoHtml}
    <div class="cnpj">CNPJ: ${escapeHtml(cnpjFmt)}</div>
    <div class="addr">${enderecoHtml}${telefoneHtml}</div>
  </header>
  <hr class="sep" />
  <div class="danfe-title">DANFE NFC-e</div>
  <div class="danfe-sub">Documento Auxiliar da Nota Fiscal<br/>de Consumidor Eletrônica</div>
  <div class="meta">NFC-e nº ${escapeHtml(String(numero || ''))} &nbsp;|&nbsp; Série ${escapeHtml(String(serie || ''))}</div>
  ${consumidorHtml}
  <hr class="sep" />
  <table class="items">
    <thead>
      <tr>
        <th class="col-cod">Cód</th>
        <th class="col-desc">Descrição</th>
        <th class="col-qtd">Qtd</th>
        <th class="col-vl">Vl.Unit</th>
        <th class="col-tot">Total</th>
      </tr>
    </thead>
    <tbody>${itensHtml}</tbody>
  </table>
  <hr class="sep" />
  <div class="totals">
    ${desconto > 0
      ? `<div class="row"><span>Desconto</span><span>${escapeHtml(formatarMoeda(desconto))}</span></div>`
      : `<div class="sr-only">Desconto: R$ ${Number(desconto).toFixed(2)}</div>`}
    <div class="total-box">
      <div class="row"><span>TOTAL</span><span>${escapeHtml(formatarMoeda(valorTotalVenda))}</span></div>
    </div>
    <div class="sr-only">${escapeHtml(totalLegado)}</div>
  </div>
  <div class="pays">${pagamentosHtml}${trocoHtml}${pagamentosLegado}</div>
  <hr class="sep" />
  ${tributosHtml}
  ${tributosHtml ? '<hr class="sep" />' : ''}
  <div class="center muted" style="font-size:9px;">Consulte pela chave de acesso</div>
  <div class="chave">${escapeHtml(formatarChaveAcessoGrupos(chave))}</div>
  <div class="sr-only">${escapeHtml(String(chave || ''))}</div>
  ${qrCodeDataUrl ? `
  <div class="qr">
    <img src="${qrCodeDataUrl}" alt="QR Code NFC-e" width="${qrLargura}" height="${qrLargura}" />
    <div class="qr-caption">Consulte via QR Code</div>
  </div>` : ''}
  <div class="footer">
    ${protocolo ? `<div>Protocolo: ${escapeHtml(protocolo)}</div>` : ''}
    ${dataHora ? `<div>${escapeHtml(dataHora)}</div>` : ''}
  </div>
  <div class="thanks">Obrigado pela preferência!</div>
  ${avisoHomologacao}
</body>
</html>`;
}

module.exports = {
  gerarDanfeHtml,
  montarDadosDanfe,
  obterPagamentosComerciaisDanfe,
  resolverPagamentosExibicaoDanfe,
  obterQuantidadeImpressao,
  obterValorImpressao,
  obterQuantidadeFiscalDanfe,
  obterValorFiscalItemDanfe,
  resolverLarguraPapelMm,
  resolverNomeFantasia,
  resolverRazaoSocial,
  montarLinhasEndereco,
  formatarTelefone,
  formatarCNPJ,
  formatarMoeda,
  formatarFormaPagamento,
  formatarChaveAcessoGrupos
};
