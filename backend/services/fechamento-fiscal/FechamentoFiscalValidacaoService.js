/**
 * Sprint 03 — Validação fiscal do Fechamento Fiscal do Dia.
 * Não inventa NCM/CFOP/CSOSN. Não altera cadastro de produto.
 */

'use strict';

const crypto = require('crypto');
const { arredondarMoeda, toCentavos, somarMoeda } = require('../fiscal/modeloTotais');
const { STATUS, TP_EMIS } = require('./constants');

function onlyDigits(s) {
  return String(s || '').replace(/\D/g, '');
}

function agoraLocal() {
  return new Date().toISOString().replace('T', ' ').slice(0, 19);
}

function criarErroEstruturado({ produto, campo, mensagem, codigo }) {
  return {
    codigo: codigo || 'VALIDACAO_FISCAL',
    campo: campo || null,
    produto_id: produto?.id != null ? Number(produto.id) : (produto?.produto_id != null ? Number(produto.produto_id) : null),
    produto_nome: produto?.nome || produto?.produto_nome || produto?.descricao || null,
    mensagem: String(mensagem || '')
  };
}

/**
 * Consome recebimentos históricos até o valor da tentativa (sem alterar o original).
 * Ex.: recebimento 687,76 + tentativa 437,77 → [{ ..., valor: 437,77 }]
 */
function obterRecebimentosDaTentativa(recebimentos, valorTentativa) {
  const alvoCents = toCentavos(valorTentativa);
  if (!(alvoCents > 0)) return [];
  const out = [];
  let restante = alvoCents;
  for (const r of recebimentos || []) {
    if (restante <= 0) break;
    const disp = toCentavos(r.valor);
    if (disp <= 0) continue;
    const usa = Math.min(restante, disp);
    out.push({
      ...r,
      valor: arredondarMoeda(usa / 100),
      valor_original: arredondarMoeda(r.valor),
      valor_tentativa: arredondarMoeda(usa / 100)
    });
    restante -= usa;
  }
  if (restante > 0) {
    const err = new Error(
      `Recebimentos históricos insuficientes para a tentativa (faltam R$ ${arredondarMoeda(restante / 100).toFixed(2)}).`
    );
    err.statusCode = 400;
    err.code = 'RECEBIMENTOS_TENTATIVA_INSUFICIENTES';
    throw err;
  }
  return out;
}

/**
 * Contexto da emissão: INICIAL vs CONTINUACAO (valorTentativa ≠ valor_principal).
 */
function resolverContextoEmissao(fechamento, saldo = null, opts = {}) {
  const principal = arredondarMoeda(
    (saldo && saldo.valor_principal != null)
      ? saldo.valor_principal
      : (fechamento.valor_principal != null ? fechamento.valor_principal : fechamento.valor_informado)
  );
  const emitido = arredondarMoeda(
    (saldo && saldo.valor_emitido_autorizado != null)
      ? saldo.valor_emitido_autorizado
      : (fechamento.valor_emitido_autorizado || 0)
  );
  const pendente = arredondarMoeda(
    (saldo && saldo.valor_pendente_emissao != null)
      ? saldo.valor_pendente_emissao
      : Math.max(0, principal - emitido)
  );

  const forcarContinuar = opts.continuar_emissao === true
    || opts.continuar === true
    || opts.tipo === 'CONTINUACAO';

  if (toCentavos(emitido) > 0 && toCentavos(pendente) > 0) {
    return {
      tipo: 'CONTINUACAO',
      valorPrincipal: principal,
      valorEmitidoAutorizado: emitido,
      valorPendente: pendente,
      valorTentativa: pendente
    };
  }

  if (toCentavos(emitido) > 0 && toCentavos(pendente) === 0) {
    return {
      tipo: 'CONCLUIDO',
      valorPrincipal: principal,
      valorEmitidoAutorizado: emitido,
      valorPendente: 0,
      valorTentativa: 0
    };
  }

  const valorDistribuido = arredondarMoeda(fechamento.valor_distribuido || 0);
  const valorInformado = arredondarMoeda(fechamento.valor_informado || 0);
  const valorTentativa = valorDistribuido > 0 ? valorDistribuido : valorInformado;

  return {
    tipo: forcarContinuar ? 'CONTINUACAO' : 'INICIAL',
    valorPrincipal: principal,
    valorEmitidoAutorizado: emitido,
    valorPendente: pendente > 0 ? pendente : valorTentativa,
    valorTentativa
  };
}

/**
 * Rateia recebimentos (centavos) entre documentos (centavos),
 * garantindo soma por documento = valor do documento.
 */
function ratearRecebimentosPorDocumentos(documentos, recebimentos) {
  const docs = (documentos || []).map((d) => ({
    ...d,
    centavos: toCentavos(d.valor)
  }));
  const recs = (recebimentos || []).map((r) => ({
    ...r,
    restante: toCentavos(r.valor)
  }));

  const totalDocs = docs.reduce((s, d) => s + d.centavos, 0);
  const totalRecs = recs.reduce((s, r) => s + r.restante, 0);
  if (totalDocs !== totalRecs) {
    const err = new Error(
      `Soma dos recebimentos (R$ ${(totalRecs / 100).toFixed(2)}) difere do total dos documentos (R$ ${(totalDocs / 100).toFixed(2)}).`
    );
    err.statusCode = 400;
    err.code = 'PAGAMENTO_DIVERGENTE';
    throw err;
  }

  const porDoc = docs.map((d) => ({ previa_venda_id: d.previa_venda_id, sequencia: d.sequencia, pagamentos: [] }));
  let recIdx = 0;

  for (let i = 0; i < docs.length; i++) {
    let precisa = docs[i].centavos;
    while (precisa > 0 && recIdx < recs.length) {
      const rec = recs[recIdx];
      if (rec.restante <= 0) {
        recIdx += 1;
        continue;
      }
      const usa = Math.min(precisa, rec.restante);
      porDoc[i].pagamentos.push({
        recebimento_id: rec.id != null ? Number(rec.id) : null,
        operadora: rec.operadora || rec.descricao || 'CARTAO',
        cnpj: onlyDigits(rec.cnpj),
        forma_pagamento: 'cartao',
        valor: arredondarMoeda(usa / 100),
        observacao: rec.observacao || null
      });
      rec.restante -= usa;
      precisa -= usa;
      if (rec.restante <= 0) recIdx += 1;
    }
    if (precisa !== 0) {
      const err = new Error('Falha ao ratear pagamentos fiscais entre documentos.');
      err.statusCode = 500;
      err.code = 'RATEIO_PAGAMENTO';
      throw err;
    }
  }

  return porDoc;
}

function validarProdutoSnapshot(produto, itemPrevia) {
  const erros = [];
  const nome = produto?.nome || `Produto #${itemPrevia.produto_id}`;
  const ctx = { id: itemPrevia.produto_id, nome };

  if (!produto) {
    erros.push(criarErroEstruturado({
      produto: ctx,
      campo: 'produto',
      mensagem: `Produto não encontrado no cadastro.`,
      codigo: 'PRODUTO_AUSENTE'
    }));
    return erros;
  }

  const ncm = onlyDigits(produto.ncm);
  if (ncm.length !== 8) {
    erros.push(criarErroEstruturado({
      produto: ctx,
      campo: 'ncm',
      mensagem: 'NCM não informado.',
      codigo: 'NCM_AUSENTE'
    }));
  }

  const cfop = String(produto.cfop || '').trim();
  if (!cfop) {
    erros.push(criarErroEstruturado({
      produto: ctx,
      campo: 'cfop',
      mensagem: 'CFOP não configurado.',
      codigo: 'CFOP_AUSENTE'
    }));
  }

  const csosn = String(produto.csosn || produto.cst || '').trim();
  if (!csosn) {
    erros.push(criarErroEstruturado({
      produto: ctx,
      campo: 'csosn',
      mensagem: 'Tributação (CSOSN/CST) não informada.',
      codigo: 'TRIBUTACAO_AUSENTE'
    }));
  }

  const cest = onlyDigits(produto.cest);
  if (cest && cest.length !== 7) {
    erros.push(criarErroEstruturado({
      produto: ctx,
      campo: 'cest',
      mensagem: 'CEST inválido (deve ter 7 dígitos).',
      codigo: 'CEST_INVALIDO'
    }));
  }

  const qtd = Number(itemPrevia.quantidade);
  if (!(qtd > 0)) {
    erros.push(criarErroEstruturado({
      produto: ctx,
      campo: 'quantidade',
      mensagem: 'Quantidade inválida.',
      codigo: 'QTD_INVALIDA'
    }));
  }

  const vUnit = Number(itemPrevia.valor_unitario);
  const vTot = Number(itemPrevia.valor_total != null ? itemPrevia.valor_total : itemPrevia.valor);
  if (!(vUnit >= 0) || !(vTot > 0)) {
    erros.push(criarErroEstruturado({
      produto: ctx,
      campo: 'valores',
      mensagem: 'Valores do item inválidos.',
      codigo: 'VALOR_INVALIDO'
    }));
  }

  return erros;
}

function montarChecklist(flags) {
  const labels = [
    ['empresa', 'Empresa'],
    ['certificado', 'Certificado digital'],
    ['serie', 'Série fiscal'],
    ['produtos', 'Produtos'],
    ['ncm', 'NCM'],
    ['cfop', 'CFOP'],
    ['tributacao', 'Tributação'],
    ['valores', 'Valores'],
    ['pagamento', 'Pagamento'],
    ['total', 'Total'],
    ['xml', 'XML']
  ];
  return labels.map(([key, label]) => ({
    key,
    label,
    ok: Boolean(flags[key])
  }));
}

/**
 * Valida fechamento + prévia + produtos + config fiscal para preparação.
 * @returns {{ ok: boolean, erros: Array, checklist: Array, avisos: Array }}
 */
function validarPreparacaoFiscal({
  fechamento,
  previaVendas,
  produtosPorId,
  configFiscal,
  recebimentos,
  opts = {},
  contextoEmissao = null,
  saldo = null
}) {
  const erros = [];
  const avisos = [];
  const flags = {
    empresa: false,
    certificado: false,
    serie: false,
    produtos: false,
    ncm: false,
    cfop: false,
    tributacao: false,
    valores: false,
    pagamento: false,
    total: false,
    xml: false
  };

  if (!fechamento) {
    erros.push(criarErroEstruturado({ mensagem: 'Fechamento fiscal não encontrado.', codigo: 'FECHAMENTO_AUSENTE' }));
    return { ok: false, erros, checklist: montarChecklist(flags), avisos };
  }

  const contexto = contextoEmissao || resolverContextoEmissao(fechamento, saldo, opts);
  const isContinuacao = contexto.tipo === 'CONTINUACAO';

  if (contexto.tipo === 'CONCLUIDO') {
    erros.push(criarErroEstruturado({
      mensagem: 'Fechamento já totalmente autorizado. Não há saldo para nova preparação.',
      codigo: 'FECHAMENTO_JA_CONCLUIDO'
    }));
    return {
      ok: false,
      erros,
      checklist: montarChecklist(flags),
      avisos,
      contextoEmissao: contexto
    };
  }

  if (![STATUS.PREVIA, STATUS.VALIDANDO, STATUS.PRONTO_EMISSAO, STATUS.ERRO, STATUS.REJEITADO, STATUS.AUTORIZACAO_PARCIAL, STATUS.PENDENTE_RECUPERACAO].includes(fechamento.status)) {
    erros.push(criarErroEstruturado({
      mensagem: `Status ${fechamento.status} não permite preparação fiscal.`,
      codigo: 'STATUS_INVALIDO'
    }));
  }

  // Hora retroativa arbitrária
  if (opts.data_hora_emissao || opts.dhEmi || opts.forcar_dhEmi) {
    erros.push(criarErroEstruturado({
      campo: 'data_hora_emissao',
      mensagem: 'Hora retroativa arbitrária não é permitida. A data/hora de emissão será a do momento real da transmissão.',
      codigo: 'HORA_RETROATIVA_PROIBIDA'
    }));
  }

  const cnpj = onlyDigits(fechamento.cnpj || configFiscal?.cnpj);
  if (cnpj.length !== 14) {
    erros.push(criarErroEstruturado({
      campo: 'cnpj',
      mensagem: 'CNPJ da empresa inválido ou não informado.',
      codigo: 'CNPJ_INVALIDO'
    }));
  } else if (configFiscal?.cnpj && onlyDigits(configFiscal.cnpj) !== cnpj) {
    erros.push(criarErroEstruturado({
      campo: 'cnpj',
      mensagem: 'CNPJ do fechamento diverge do CNPJ da configuração fiscal.',
      codigo: 'CNPJ_DIVERGENTE'
    }));
  } else {
    flags.empresa = true;
  }

  const ie = onlyDigits(configFiscal?.ie);
  if (!ie) {
    erros.push(criarErroEstruturado({
      campo: 'ie',
      mensagem: 'Inscrição estadual não informada.',
      codigo: 'IE_AUSENTE'
    }));
    flags.empresa = false;
  }

  const ambiente = Number(configFiscal?.ambiente);
  if (![1, 2].includes(ambiente)) {
    erros.push(criarErroEstruturado({
      campo: 'ambiente',
      mensagem: 'Ambiente fiscal não configurado (homologação/produção).',
      codigo: 'AMBIENTE_AUSENTE'
    }));
  }

  if (opts.bloquearProducaoEmTeste && ambiente === 1) {
    erros.push(criarErroEstruturado({
      campo: 'ambiente',
      mensagem: 'Ambiente de produção bloqueado em testes automatizados.',
      codigo: 'PRODUCAO_BLOQUEADA'
    }));
  }

  const serie = Number(configFiscal?.serie);
  if (!(serie >= 0)) {
    erros.push(criarErroEstruturado({
      campo: 'serie',
      mensagem: 'Série fiscal não configurada.',
      codigo: 'SERIE_AUSENTE'
    }));
  } else {
    flags.serie = true;
  }

  const temCert =
    Boolean(configFiscal?.certificadoPath || configFiscal?.certificado_path) ||
    opts.certificadoOpcional === true;
  if (!temCert) {
    erros.push(criarErroEstruturado({
      campo: 'certificado',
      mensagem: 'Certificado digital não configurado.',
      codigo: 'CERTIFICADO_AUSENTE'
    }));
  } else {
    flags.certificado = true;
  }

  const vendas = previaVendas || [];
  if (!vendas.length) {
    erros.push(criarErroEstruturado({
      mensagem: 'Não há vendas na prévia para preparar emissão.',
      codigo: 'PREVIA_VAZIA'
    }));
  }

  let somaVendas = 0;
  let ncmOk = true;
  let cfopOk = true;
  let tribOk = true;
  let produtosOk = true;
  let valoresItensOk = true;

  for (const v of vendas) {
    const itens = v.itens || [];
    const somaItens = toCentavos(somarMoeda(itens.map((i) => i.valor_total != null ? i.valor_total : i.valor)));
    const valorVenda = toCentavos(v.valor);
    if (somaItens !== valorVenda) {
      valoresItensOk = false;
      erros.push(criarErroEstruturado({
        mensagem: `Soma dos itens da venda #${v.sequencia} difere do total da venda fiscal.`,
        codigo: 'TOTAL_ITENS_DIVERGENTE'
      }));
    }
    somaVendas += valorVenda;

    for (const it of itens) {
      const prod = produtosPorId.get(Number(it.produto_id));
      const errs = validarProdutoSnapshot(prod, it);
      for (const e of errs) {
        erros.push(e);
        if (e.codigo === 'NCM_AUSENTE') ncmOk = false;
        if (e.codigo === 'CFOP_AUSENTE') cfopOk = false;
        if (e.codigo === 'TRIBUTACAO_AUSENTE') tribOk = false;
        if (e.codigo === 'PRODUTO_AUSENTE') produtosOk = false;
        if (e.codigo === 'VALOR_INVALIDO' || e.codigo === 'QTD_INVALIDA') valoresItensOk = false;
      }
      if (!prod) produtosOk = false;
    }
  }

  flags.produtos = produtosOk && vendas.length > 0 && ncmOk && cfopOk && tribOk;
  flags.ncm = ncmOk && vendas.length > 0;
  flags.cfop = cfopOk && vendas.length > 0;
  flags.tributacao = tribOk && vendas.length > 0;
  flags.valores = valoresItensOk && vendas.length > 0;

  const valorTentativaCents = toCentavos(contexto.valorTentativa);
  const valorDistribuido = toCentavos(fechamento.valor_distribuido);
  const valorInformadoHistorico = toCentavos(fechamento.valor_informado);
  const diferenca = toCentavos(fechamento.diferenca);

  // Continuação: NÃO comparar valor_principal/valor_informado histórico com distribuído.
  // Esperado: soma vendas = distribuído = valorTentativa (pendente).
  if (isContinuacao) {
    if (somaVendas !== valorTentativaCents) {
      erros.push(criarErroEstruturado({
        mensagem:
          `Soma das vendas da tentativa (R$ ${arredondarMoeda(somaVendas / 100).toFixed(2)}) ` +
          `difere do valor pendente da continuação (R$ ${arredondarMoeda(contexto.valorTentativa).toFixed(2)}).`,
        codigo: 'TOTAL_VENDAS_TENTATIVA_DIVERGENTE'
      }));
    }
    if (valorDistribuido !== valorTentativaCents) {
      erros.push(criarErroEstruturado({
        mensagem:
          `Valor distribuído da tentativa (R$ ${arredondarMoeda(valorDistribuido / 100).toFixed(2)}) ` +
          `deve ser igual ao saldo pendente (R$ ${arredondarMoeda(contexto.valorTentativa).toFixed(2)}).`,
        codigo: 'DISTRIBUIDO_TENTATIVA_DIVERGENTE'
      }));
    } else if (somaVendas === valorTentativaCents) {
      flags.total = true;
    }

    let recebimentosTentativa = recebimentos;
    if (opts.recebimentosJaDaTentativa !== true) {
      try {
        recebimentosTentativa = obterRecebimentosDaTentativa(recebimentos, contexto.valorTentativa);
      } catch (e) {
        erros.push(criarErroEstruturado({
          campo: 'pagamento',
          mensagem: e.message,
          codigo: e.code || 'RECEBIMENTOS_TENTATIVA'
        }));
        recebimentosTentativa = [];
      }
    }
    const somaRecTent = toCentavos(somarMoeda((recebimentosTentativa || []).map((r) => r.valor)));
    if (somaRecTent !== valorTentativaCents) {
      erros.push(criarErroEstruturado({
        campo: 'pagamento',
        mensagem:
          `Soma dos recebimentos da tentativa (R$ ${arredondarMoeda(somaRecTent / 100).toFixed(2)}) ` +
          `deve ser igual ao valor da continuação (R$ ${arredondarMoeda(contexto.valorTentativa).toFixed(2)}).`,
        codigo: 'RECEBIMENTOS_TENTATIVA_DIVERGENTES'
      }));
    } else if ((recebimentosTentativa || []).length > 0) {
      flags.pagamento = true;
    } else {
      erros.push(criarErroEstruturado({
        campo: 'pagamento',
        mensagem: 'Informe os recebimentos das máquinas para o pagamento fiscal da tentativa.',
        codigo: 'RECEBIMENTOS_AUSENTES'
      }));
    }
  } else {
    if (somaVendas !== valorDistribuido) {
      erros.push(criarErroEstruturado({
        mensagem: 'Soma das vendas fiscais difere do valor distribuído.',
        codigo: 'TOTAL_VENDAS_DIVERGENTE'
      }));
    }
    if (valorDistribuido !== valorInformadoHistorico || diferenca !== 0) {
      erros.push(criarErroEstruturado({
        mensagem: 'Valor distribuído deve ser igual ao valor informado (diferença R$ 0,00).',
        codigo: 'DIFERENCA_NAO_ZERO'
      }));
    } else {
      flags.total = true;
    }

    const somaRec = toCentavos(somarMoeda((recebimentos || []).map((r) => r.valor)));
    if (somaRec !== valorInformadoHistorico) {
      erros.push(criarErroEstruturado({
        campo: 'pagamento',
        mensagem: 'Soma dos recebimentos das máquinas deve ser igual ao valor do fechamento.',
        codigo: 'RECEBIMENTOS_DIVERGENTES'
      }));
    } else if ((recebimentos || []).length > 0) {
      flags.pagamento = true;
    } else {
      erros.push(criarErroEstruturado({
        campo: 'pagamento',
        mensagem: 'Informe os recebimentos das máquinas para o pagamento fiscal.',
        codigo: 'RECEBIMENTOS_AUSENTES'
      }));
    }
  }

  flags.xml = false; // preenchido após geração

  return {
    ok: erros.length === 0,
    erros,
    avisos,
    checklist: montarChecklist(flags),
    ambiente,
    serie: Number.isFinite(serie) ? serie : null,
    cnpj,
    tp_emis: TP_EMIS.NORMAL,
    data_referencia_comercial: fechamento.data_referencia_comercial || fechamento.data_fechamento,
    data_hora_preparacao: agoraLocal(),
    contextoEmissao: contexto
  };
}

function hashIdempotencia({ fechamentoId, previaVendas, recebimentos, ambiente, cnpj }) {
  const payload = {
    fechamento_id: Number(fechamentoId),
    ambiente: Number(ambiente),
    cnpj: String(cnpj || '').replace(/\D/g, ''),
    vendas: (previaVendas || []).map((v) => ({
      id: v.id,
      sequencia: v.sequencia,
      valor: toCentavos(v.valor),
      itens: (v.itens || []).map((i) => ({
        p: i.produto_id,
        q: i.quantidade,
        vu: toCentavos(i.valor_unitario),
        vt: toCentavos(i.valor_total != null ? i.valor_total : i.valor)
      }))
    })),
    recebimentos: (recebimentos || []).map((r) => ({
      id: r.id,
      o: r.operadora,
      v: toCentavos(r.valor)
    }))
  };
  return crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex').slice(0, 40);
}

function formatarErrosUsuario(erros) {
  if (!erros || !erros.length) return '';
  const linhas = [`⚠ Documento não pode ser preparado`, '', `${erros.length} problema(s) encontrado(s):`, ''];
  erros.forEach((e, idx) => {
    if (e.produto_nome) {
      linhas.push(`${idx + 1}. Produto "${e.produto_nome}"`);
      linhas.push(`   ${e.mensagem}`);
    } else {
      linhas.push(`${idx + 1}. ${e.mensagem}`);
    }
    linhas.push('');
  });
  return linhas.join('\n').trim();
}

module.exports = {
  onlyDigits,
  criarErroEstruturado,
  validarProdutoSnapshot,
  validarPreparacaoFiscal,
  ratearRecebimentosPorDocumentos,
  obterRecebimentosDaTentativa,
  resolverContextoEmissao,
  hashIdempotencia,
  formatarErrosUsuario,
  montarChecklist,
  agoraLocal
};
