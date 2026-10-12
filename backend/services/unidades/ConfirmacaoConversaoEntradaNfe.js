/**
 * Confirmação individual de conversão na entrada NF-e.
 * Não é um motor novo: revalida pelo MotorUnidadesMedida (MUC/MUM) e
 * amarra a decisão à identidade estável da linha.
 */
'use strict';

const crypto = require('crypto');
const MotorUnidadesMedida = require('./MotorUnidadesMedida');
const { getJwtSecret } = require('../../config/secrets');

const ESTADOS_DECISAO = Object.freeze({
  PENDENTE: 'PENDENTE',
  SIM: 'SIM',
  NAO: 'NAO'
});

function num(valor) {
  const n = Number(valor);
  return Number.isFinite(n) ? n : 0;
}

function texto(valor) {
  if (valor === undefined || valor === null) return '';
  return String(valor).trim();
}

function digits(valor) {
  return String(valor || '').replace(/\D/g, '');
}

function normalizarDecisaoConversaoEntrada(valor) {
  if (valor === null || valor === undefined) return null;
  if (typeof valor === 'boolean') return valor;
  if (typeof valor === 'number') return valor === 1;
  if (typeof valor === 'object') {
    return normalizarDecisaoConversaoEntrada(
      valor.confirmacao ?? valor.confirmado ?? valor.decisao ?? valor.valor ?? valor.resultado ?? valor.estado
    );
  }
  if (typeof valor === 'string') {
    const raw = valor.trim().toLowerCase();
    if (raw === 'true' || raw === '1' || raw === 'sim' || raw === 's' || raw === 'aceitar') return true;
    if (raw === 'false' || raw === '0' || raw === 'nao' || raw === 'não' || raw === 'n' || raw === 'no' || raw === 'recusar') {
      return false;
    }
    if (raw === 'null' || raw === 'none' || raw === 'nenhum' || raw === 'pendente') return null;
  }
  return null;
}

function estadoDecisao(valor) {
  const n = normalizarDecisaoConversaoEntrada(valor);
  if (n === true) return ESTADOS_DECISAO.SIM;
  if (n === false) return ESTADOS_DECISAO.NAO;
  return ESTADOS_DECISAO.PENDENTE;
}

/**
 * Identidade da linha: nItem / linha_xml / item_key estável.
 * Não usa código de barras nem produto_id isolado (duas linhas podem ser o mesmo produto).
 */
function extrairChaveConversaoItem(item = {}, fallbackIndex = 0) {
  const nItem = item.nItem ?? item.nitem ?? item.linha_xml ?? item.linhaXml;
  if (nItem !== undefined && nItem !== null && texto(nItem) !== '') {
    return `linha:${texto(nItem)}`;
  }

  const estavel = [
    item.item_key,
    item.itemKey,
    item.linha_id,
    item.linhaId
  ].find((valor) => valor !== undefined && valor !== null && texto(valor) !== '');

  if (estavel !== undefined) {
    const raw = texto(estavel);
    if (raw.startsWith('item:') || raw.startsWith('linha:') || raw.startsWith('produto:')) {
      return raw;
    }
    return `linha:${raw}`;
  }

  const itemId = item.item_id ?? item.itemId ?? item.compra_item_id ?? item.compraItemId;
  if (itemId !== undefined && itemId !== null && texto(itemId) !== '') {
    return `item:${texto(itemId)}`;
  }

  const produtoRef = item.produto_id ?? item.produtoId;
  if (produtoRef !== undefined && produtoRef !== null && texto(produtoRef) !== '') {
    return `produto:${texto(produtoRef)}:idx:${fallbackIndex}`;
  }

  return `idx:${fallbackIndex}`;
}

function chavesCandidatasItem(item = {}, index = 0) {
  const primaria = extrairChaveConversaoItem(item, index);
  const lista = [primaria];
  const extras = [
    item.item_key,
    item.itemKey,
    item.nItem != null ? `linha:${item.nItem}` : null,
    item.nitem != null ? `linha:${item.nitem}` : null,
    item.linha_xml != null ? `linha:${item.linha_xml}` : null,
    `idx:${index}`
  ];
  extras.forEach((chave) => {
    if (chave && !lista.includes(String(chave))) lista.push(String(chave));
  });
  return lista;
}

function snapshotXmlLinha(item = {}, index = 0) {
  return {
    nItem: item.nItem ?? item.nitem ?? item.linha_xml ?? index,
    linha_xml: item.linha_xml ?? item.nItem ?? item.nitem ?? index,
    descricao_xml: item.produto_nome || item.descricao || item.xProd || null,
    uCom: item.unidade_comercial || item.uCom || item.unidade || null,
    qCom: num(item.quantidade_comercial ?? item.quantidade_embalagens ?? item.qCom ?? item.quantidade),
    uTrib: item.unidade_tributavel || item.uTrib || null,
    qTrib: num(item.quantidade_tributavel ?? item.qTrib),
    cProd: item.codigo_fornecedor || item.cProd || null,
    codigo_barras: item.codigo_barras || item.gtin || null
  };
}

function itemRequerConfirmacaoConversao(item = {}, resultado = null) {
  if (!resultado) return false;
  if (resultado.requerConfirmacao === true
    || resultado.tipoPendencia === 'CONVERSAO_UNIDADE'
    || resultado.codigo === 'FATOR_CONVERSAO_AUSENTE'
    || resultado.codigo === 'DIVERGENCIA_QTRIB_FATOR') {
    return true;
  }

  const unidadeComercial = String(item.unidade_comercial || item.uCom || item.unidade || 'UN').trim().toUpperCase();
  const unidadeEstoque = String(resultado.unidadeEstoque || item.unidade_estoque || item.unidade || '').trim().toUpperCase();
  const unidadeTributavel = String(item.unidade_tributavel || item.uTrib || '').trim().toUpperCase();
  const quantidadeTributavel = Number(item.quantidade_tributavel ?? item.qTrib ?? 0);

  // Apresentação já cadastrada e coerente (FATOR_APRESENTACAO) é conversão confirmada: não pergunta.
  // Só a proposta inferida do XML (qTrib na unidade de estoque) exige decisão do operador.
  return Boolean(
    resultado.ok === true
    && unidadeComercial
    && unidadeEstoque
    && unidadeComercial !== unidadeEstoque
    && quantidadeTributavel > 0
    && unidadeTributavel === unidadeEstoque
    && resultado.origem === 'QTRIB_UNIDADE_ESTOQUE'
  );
}

function quantidadeSeguraSemConversao(item, produto, resultado) {
  const uCom = MotorUnidadesMedida.normalizarUnidadeEntradaNfe(
    item.unidade_comercial || item.uCom || item.unidade || 'UN'
  );
  const uEstoque = MotorUnidadesMedida.normalizarUnidadeEntradaNfe(
    resultado?.unidadeEstoque || produto?.unidade || item.unidade_estoque || item.unidade || ''
  );
  return uCom && uEstoque && uCom === uEstoque;
}

/** Quantas vezes o produto da linha foi corrigido na Central (confirmações anteriores deixam de valer). */
function revisaoProdutoLinha(item = {}) {
  const explicita = Number(item.revisao_produto_linha);
  if (Number.isInteger(explicita) && explicita >= 0) return explicita;
  return Array.isArray(item.correcoes_produto) ? item.correcoes_produto.length : 0;
}

function quatroCasas(valor) {
  if (valor === undefined || valor === null || texto(valor) === '') return null;
  return Math.round(num(valor) * 10000) / 10000;
}

/**
 * O que o operador aprova: documento, linha do XML, produto, unidades e quantidades
 * e a quantidade em estoque proposta pelo MUC para essa linha.
 */
function contextoSeloConversao(pendencia = {}) {
  const xml = pendencia.xml_original || {};
  const unidade = (valor) => MotorUnidadesMedida.normalizarUnidadeEntradaNfe(valor) || null;
  return {
    documento_id: Number(pendencia.documento_id),
    indice: Number(pendencia.indice),
    nItem: texto(xml.nItem),
    revisao_produto: Number(pendencia.revisao_produto_linha) || 0,
    produto_id: Number(pendencia.produto_id) || null,
    uCom: unidade(xml.uCom),
    qCom: quatroCasas(xml.qCom),
    uTrib: unidade(xml.uTrib),
    qTrib: quatroCasas(xml.qTrib),
    unidade_estoque: unidade(pendencia.unidade_estoque),
    quantidade_proposta: quatroCasas(pendencia.quantidade_resultante_proposta)
  };
}

function gerarSeloConversao(pendencia) {
  const chave = crypto.createHmac('sha256', getJwtSecret()).update('cds:selo-conversao-entrada-nfe:v1').digest();
  const assinatura = crypto.createHmac('sha256', chave)
    .update(JSON.stringify(contextoSeloConversao(pendencia)))
    .digest('hex');
  return `v1.${assinatura}`;
}

function selosIguais(recebido, esperado) {
  const a = Buffer.from(texto(recebido));
  const b = Buffer.from(texto(esperado));
  return a.length > 0 && a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** SIM/NÃO só vale com o selo emitido pelo servidor para esta mesma linha, produto e conversão. */
function verificarSeloDecisao(decisao, pendencia) {
  const recebido = texto(decisao?.selo_conversao ?? decisao?.seloConversao);
  if (!recebido) {
    return {
      codigo: 'CONFIRMACAO_CONVERSAO_SEM_SELO',
      justificativa: 'Confirmação sem comprovação do servidor. Confirme a conversão desta linha novamente.'
    };
  }
  if (!selosIguais(recebido, pendencia?.selo_conversao)) {
    return {
      codigo: 'CONFIRMACAO_CONVERSAO_DESATUALIZADA',
      justificativa: 'A confirmação foi dada para outra linha, outro produto ou outra conversão. Confirme novamente.'
    };
  }
  return null;
}

function temDocumento(documentoId) {
  return documentoId !== undefined && documentoId !== null && texto(documentoId) !== '';
}

function montarPendencia(item, produto, resultado, index, extras = {}) {
  const xml = snapshotXmlLinha(item, index);
  const qEstoqueProposta = resultado?.ok
    ? resultado.quantidadeEstoque
    : (resultado?.codigo === 'DIVERGENCIA_QTRIB_FATOR' && xml.qTrib > 0
      ? xml.qTrib
      : resultado?.quantidadeTributavel || null);
  const pendencia = {
    item_key: extrairChaveConversaoItem(item, index),
    indice: index,
    nItem: xml.nItem,
    documento_id: extras.documentoId ?? item.documento_id ?? item.central_documento_id ?? null,
    chave_acesso: extras.chaveAcesso ?? item.chave_acesso ?? null,
    produto_id: produto?.id || item.produto_id || item.produtoId || null,
    produto_nome: produto?.nome || item.produto_nome || null,
    descricao_xml: xml.descricao_xml,
    codigo_barras: xml.codigo_barras,
    cProd: xml.cProd,
    unidade_nf: xml.uCom,
    unidade_comercial: xml.uCom,
    quantidade_nf: xml.qCom,
    quantidade_comercial: xml.qCom,
    unidade_tributavel: xml.uTrib,
    quantidade_tributavel: xml.qTrib,
    unidade_estoque: produto?.unidade || resultado?.unidadeEstoque || item.unidade_estoque || null,
    fator_sugerido: resultado?.fatorSugerido || resultado?.fatorConversao || null,
    conversao_sugerida: resultado?.conversaoSugerida
      || (resultado?.ok && resultado.fatorConversao
        ? `1 ${resultado.unidadeComercial} = ${resultado.fatorConversao} ${resultado.unidadeEstoque}`
        : null),
    quantidade_resultante_proposta: qEstoqueProposta,
    origem_sugestao: resultado?.origem || null,
    justificativa: resultado?.erro || resultado?.origem || null,
    codigo: resultado?.codigo || (resultado?.ok ? resultado.origem : 'FATOR_CONVERSAO_AUSENTE'),
    estado_decisao: extras.estadoDecisao || ESTADOS_DECISAO.PENDENTE,
    requer_confirmacao: true,
    pode_continuar: extras.podeContinuar === true,
    bloqueia_efetivacao: extras.bloqueiaEfetivacao !== false,
    aprendizado_permanente: false,
    xml_original: xml,
    unidadeComercial: resultado?.unidadeComercial,
    unidadeEstoque: resultado?.unidadeEstoque,
    fatorConversao: resultado?.fatorConversao || 0,
    revisao_produto_linha: revisaoProdutoLinha(item),
    selo_conversao: null
  };
  if (temDocumento(pendencia.documento_id)) pendencia.selo_conversao = gerarSeloConversao(pendencia);
  return pendencia;
}

/**
 * contexto.apresentacao: apresentação cadastrada do próprio produto que o MUC vai usar na gravação
 * (mesma resolução do MUC), para que validação, selo e gravação partam do mesmo fator.
 */
function avaliarLinha(item = {}, produto = {}, index = 0, contexto = {}) {
  const resultado = MotorUnidadesMedida.resolverQuantidadeEntradaNfe(item, produto || {}, contexto.apresentacao || null);
  const requer = itemRequerConfirmacaoConversao(item, resultado);
  return { resultado, requer, pendencia: requer ? montarPendencia(item, produto, resultado, index, contexto) : null };
}

function validarIdentidadeNota(decisao, contexto = {}) {
  if (!decisao || typeof decisao !== 'object') return null;
  const docDecisao = decisao.documento_id ?? decisao.central_documento_id ?? decisao.documentoId;
  const docCtx = contexto.documentoId ?? contexto.central_documento_id;
  if (docDecisao != null && docCtx != null && Number(docDecisao) !== Number(docCtx)) {
    return { codigo: 'DECISAO_NOTA_INCORRETA', message: 'A decisão de conversão pertence a outra nota.' };
  }
  const chaveDecisao = digits(decisao.chave_acesso || decisao.chaveAcesso);
  const chaveCtx = digits(contexto.chaveAcesso || contexto.chave_acesso);
  if (chaveDecisao && chaveCtx && chaveDecisao !== chaveCtx) {
    return { codigo: 'DECISAO_NOTA_INCORRETA', message: 'A decisão de conversão pertence a outra nota.' };
  }
  return null;
}

function normalizarDecisoesConversaoEntrada(confirmacoes = [], itens = []) {
  const mapa = new Map();
  if (!confirmacoes) return mapa;

  const registrar = (chave, valor, meta = {}) => {
    if (!chave) return;
    mapa.set(String(chave), {
      confirmacao: normalizarDecisaoConversaoEntrada(valor),
      ...meta
    });
  };

  if (Array.isArray(confirmacoes)) {
    confirmacoes.forEach((decisao, index) => {
      if (decisao == null) return;
      if (typeof decisao !== 'object') {
        registrar(extrairChaveConversaoItem(itens[index] || {}, index), decisao, { indice: index });
        return;
      }
      const itemRef = decisao;
      const chave = extrairChaveConversaoItem(
        { ...itens[index], ...itemRef },
        itemRef.indice ?? itemRef.index ?? index
      );
      registrar(chave, itemRef, {
        indice: itemRef.indice ?? itemRef.index ?? index,
        documento_id: itemRef.documento_id ?? itemRef.documentoId ?? null,
        chave_acesso: itemRef.chave_acesso ?? itemRef.chaveAcesso ?? null,
        item_key: chave,
        selo_conversao: itemRef.selo_conversao ?? itemRef.seloConversao ?? null
      });
    });
    return mapa;
  }

  if (typeof confirmacoes === 'object') {
    for (const [chave, valor] of Object.entries(confirmacoes)) {
      registrar(chave, valor, {
        item_key: chave,
        selo_conversao: (valor && typeof valor === 'object') ? (valor.selo_conversao ?? valor.seloConversao ?? null) : null
      });
    }
  }
  return mapa;
}

function obterDecisaoDoItem(mapa, item, index) {
  const chaves = chavesCandidatasItem(item, index);
  for (const chave of chaves) {
    if (mapa.has(chave)) return mapa.get(chave);
  }
  const itemKey = texto(item.item_key || item.itemKey);
  if (itemKey && mapa.has(itemKey)) return mapa.get(itemKey);
  if (item.confirmacao !== undefined || item.decisao_conversao !== undefined || item.conversao_decisao !== undefined) {
    return {
      confirmacao: normalizarDecisaoConversaoEntrada(
        item.confirmacao ?? item.decisao_conversao ?? item.conversao_decisao
      ),
      documento_id: item.documento_id,
      indice: index,
      selo_conversao: item.selo_conversao ?? null
    };
  }
  return null;
}

function aplicarSim(item, produto, resultado, index, contexto) {
  const xml = snapshotXmlLinha(item, index);
  const uTrib = MotorUnidadesMedida.normalizarUnidadeEntradaNfe(xml.uTrib);
  const uEstoque = MotorUnidadesMedida.normalizarUnidadeEntradaNfe(
    resultado?.unidadeEstoque || produto?.unidade || ''
  );

  if (resultado?.ok === true) {
    return {
      ok: true,
      quantidadeEstoque: resultado.quantidadeEstoque,
      fatorConversao: resultado.fatorConversao,
      origem: resultado.origem,
      conversao_aplicada: true,
      aprendizado_permanente: false,
      xml
    };
  }

  if (resultado?.codigo === 'DIVERGENCIA_QTRIB_FATOR' && xml.qTrib > 0 && uTrib && uTrib === uEstoque) {
    return {
      ok: true,
      quantidadeEstoque: xml.qTrib,
      fatorConversao: xml.qCom > 0 ? xml.qTrib / xml.qCom : 0,
      origem: 'QTRIB_UNIDADE_ESTOQUE',
      conversao_aplicada: true,
      aprendizado_permanente: false,
      xml
    };
  }

  return {
    ok: false,
    pendencia: montarPendencia(item, produto, resultado, index, {
      ...contexto,
      estadoDecisao: ESTADOS_DECISAO.SIM,
      bloqueiaEfetivacao: true,
      podeContinuar: false
    })
  };
}

function aplicarNao(item, produto, resultado, index, contexto) {
  const xml = snapshotXmlLinha(item, index);
  if (quantidadeSeguraSemConversao(item, produto, resultado)) {
    return {
      ok: true,
      quantidadeEstoque: xml.qCom,
      fatorConversao: 1,
      origem: 'QCOM_UNIDADE_ESTOQUE',
      conversao_aplicada: false,
      aprendizado_permanente: false,
      xml
    };
  }
  return {
    ok: false,
    pendencia: montarPendencia(item, produto, resultado, index, {
      ...contexto,
      estadoDecisao: ESTADOS_DECISAO.NAO,
      bloqueiaEfetivacao: true,
      podeContinuar: false
    })
  };
}

function validarPendenciasConversaoEntrada(itens = [], {
  produtoMap = new Map(),
  confirmacoes = [],
  documentoId = null,
  chaveAcesso = null,
  origemCompra = null,
  apresentacoes = null
} = {}) {
  if (String(origemCompra || '').toUpperCase() === 'MANUAL') {
    return [];
  }

  const pendencias = [];
  const mapa = normalizarDecisoesConversaoEntrada(confirmacoes, itens);
  const contextoNota = { documentoId, chaveAcesso };

  for (let posicao = 0; posicao < itens.length; posicao += 1) {
    const item = itens[posicao] || {};
    const index = Number.isInteger(item.central_item_indice) ? item.central_item_indice : posicao;
    const produtoId = Number(item.produto_id || item.produtoId || 0);
    const produto = produtoId ? (produtoMap.get(produtoId) || produtoMap.get(Number(produtoId)) || null) : null;
    const avaliacao = avaliarLinha(item, produto || {}, index, {
      ...contextoNota,
      apresentacao: apresentacoes?.get(index) || null
    });
    if (!avaliacao.requer) continue;

    const decisaoBruta = obterDecisaoDoItem(mapa, item, index);
    if (decisaoBruta) {
      const notaErrada = validarIdentidadeNota(decisaoBruta, contextoNota);
      if (notaErrada) {
        pendencias.push({
          ...avaliacao.pendencia,
          codigo: notaErrada.codigo,
          justificativa: notaErrada.message,
          estado_decisao: ESTADOS_DECISAO.PENDENTE,
          bloqueia_efetivacao: true
        });
        continue;
      }
      if (decisaoBruta.indice != null && Number(decisaoBruta.indice) !== index
          && decisaoBruta.item_key
          && decisaoBruta.item_key !== extrairChaveConversaoItem(item, index)) {
        pendencias.push({
          ...avaliacao.pendencia,
          codigo: 'DECISAO_LINHA_INCORRETA',
          justificativa: 'A decisão não pertence a esta linha da NF-e.',
          bloqueia_efetivacao: true
        });
        continue;
      }
    }

    const estado = estadoDecisao(decisaoBruta?.confirmacao);
    if (estado !== ESTADOS_DECISAO.PENDENTE && temDocumento(documentoId)) {
      const seloInvalido = verificarSeloDecisao(decisaoBruta, avaliacao.pendencia);
      if (seloInvalido) {
        pendencias.push({
          ...avaliacao.pendencia,
          ...seloInvalido,
          estado_decisao: ESTADOS_DECISAO.PENDENTE,
          bloqueia_efetivacao: true
        });
        continue;
      }
    }
    if (estado === ESTADOS_DECISAO.SIM) {
      const aplicado = aplicarSim(item, produto, avaliacao.resultado, index, contextoNota);
      if (!aplicado.ok) pendencias.push(aplicado.pendencia);
      continue;
    }
    if (estado === ESTADOS_DECISAO.NAO) {
      const recusa = aplicarNao(item, produto, avaliacao.resultado, index, contextoNota);
      if (!recusa.ok) {
        pendencias.push({
          ...recusa.pendencia,
          codigo: 'CONVERSAO_RECUSADA_SEM_QUANTIDADE_SEGURA',
          justificativa: 'Conversão recusada. Não há quantidade segura na unidade de estoque até corrigir associação ou unidade.'
        });
      }
      continue;
    }

    pendencias.push({
      ...avaliacao.pendencia,
      estado_decisao: ESTADOS_DECISAO.PENDENTE
    });
  }

  return pendencias;
}

function aplicarDecisoesNosItens(itens = [], {
  produtoMap = new Map(),
  confirmacoes = [],
  documentoId = null,
  chaveAcesso = null,
  apresentacoes = null
} = {}) {
  const mapa = normalizarDecisoesConversaoEntrada(confirmacoes, itens);
  return itens.map((item, posicao) => {
    const index = Number.isInteger(item.central_item_indice) ? item.central_item_indice : posicao;
    const produtoId = Number(item.produto_id || item.produtoId || 0);
    const produto = produtoId ? (produtoMap.get(produtoId) || null) : null;
    const avaliacao = avaliarLinha(item, produto || {}, index, {
      documentoId,
      chaveAcesso,
      apresentacao: apresentacoes?.get(index) || null
    });
    const xml = snapshotXmlLinha(item, index);
    const base = {
      ...item,
      item_key: extrairChaveConversaoItem(item, index),
      nItem: xml.nItem,
      quantidade_comercial: xml.qCom,
      unidade_comercial: xml.uCom,
      quantidade_tributavel: xml.qTrib,
      unidade_tributavel: xml.uTrib,
      qCom: xml.qCom,
      uCom: xml.uCom,
      qTrib: xml.qTrib,
      uTrib: xml.uTrib,
      conversao_aplicada: false,
      aprendizado_conversao: false
    };
    if (!avaliacao.requer) return base;

    const decisaoBruta = obterDecisaoDoItem(mapa, item, index);
    if (temDocumento(documentoId) && verificarSeloDecisao(decisaoBruta, avaliacao.pendencia)) return base;
    const estado = estadoDecisao(decisaoBruta?.confirmacao);
    if (estado === ESTADOS_DECISAO.SIM) {
      const aplicado = aplicarSim(item, produto, avaliacao.resultado, index, { documentoId, chaveAcesso });
      if (!aplicado.ok) return base;
      return {
        ...base,
        decisao_conversao: true,
        conversao_decisao: 'SIM',
        quantidade_estoque_confirmada: aplicado.quantidadeEstoque,
        origem_conversao_confirmada: aplicado.origem,
        fator_conversao_confirmado: aplicado.fatorConversao,
        conversao_aplicada: false
      };
    }
    if (estado === ESTADOS_DECISAO.NAO) {
      const recusa = aplicarNao(item, produto, avaliacao.resultado, index, { documentoId, chaveAcesso });
      if (!recusa.ok) return base;
      return {
        ...base,
        decisao_conversao: false,
        conversao_decisao: 'NAO',
        quantidade_estoque_confirmada: recusa.quantidadeEstoque,
        origem_conversao_confirmada: recusa.origem,
        conversao_aplicada: false
      };
    }
    return base;
  });
}

// Decisões e quantidades confirmadas só podem nascer no backend; vindas no item são descartadas.
const CAMPOS_DECISAO_ITEM = Object.freeze([
  'confirmacao',
  'decisao_conversao',
  'conversao_decisao',
  'confirmacao_conversao',
  'conversao',
  'quantidade_estoque_confirmada',
  'origem_conversao_confirmada',
  'fator_conversao_confirmado',
  'conversao_aplicada',
  'selo_conversao'
]);

// Fator, apresentação e quantidades convertidas vêm do cadastro do produto (via MUC), do XML e do selo;
// os valores calculados pela tela não decidem a conversão de uma NF-e da Central.
const CAMPOS_CONVERSAO_ITEM = Object.freeze([
  'quantidade_por_embalagem',
  'fator_conversao',
  'tipo_conversao',
  'quantidade_apresentacao',
  'produto_apresentacao_id',
  'embalagem_id',
  'compra_em',
  'quantidade_embalagens',
  'quantidade_convertida',
  'quantidade_estoque',
  'peso_total_compra'
]);

/**
 * Quantidade em estoque que a gravação pode registrar para a linha: a proposta do MUC quando a linha
 * não exige confirmação, ou a quantidade aprovada (SIM/NÃO com selo válido) quando exige.
 * null = nenhuma quantidade autorizada.
 */
function quantidadeAutorizadaEntradaNfe(item = {}, produto = {}, index = 0, contexto = {}) {
  const avaliacao = avaliarLinha(item, produto || {}, index, contexto);
  if (avaliacao.requer) {
    const confirmada = Number(item.quantidade_estoque_confirmada);
    return item.conversao_decisao && Number.isFinite(confirmada) && confirmada > 0 ? confirmada : null;
  }
  const proposta = Number(avaliacao.resultado?.quantidadeEstoque);
  return avaliacao.resultado?.ok && Number.isFinite(proposta) && proposta > 0 ? proposta : null;
}

function inteiroOuNull(valor) {
  if (valor === undefined || valor === null || texto(valor) === '') return null;
  const n = Number(valor);
  return Number.isInteger(n) ? n : null;
}

function localizarLinhaPorNumero(itensDocumento, numero) {
  return itensDocumento.findIndex((linha, idx) => Number(linha?.nItem ?? linha?.nitem ?? idx) === numero);
}

/**
 * Linha original da NF-e na Central: posição em parse_json.itens (central_item_indice),
 * com nItem / item_key numérico como identificadores alternativos. Todos devem concordar.
 */
function resolverLinhaCentral(item = {}, itensDocumento = []) {
  const candidatos = [];
  const indiceDireto = inteiroOuNull(item.central_item_indice ?? item.centralItemIndice);
  if (indiceDireto !== null) {
    candidatos.push(indiceDireto >= 0 && indiceDireto < itensDocumento.length ? indiceDireto : -1);
  }
  [item.nItem, item.nitem, item.linha_xml].forEach((valor) => {
    const numero = inteiroOuNull(valor);
    if (numero !== null) candidatos.push(localizarLinhaPorNumero(itensDocumento, numero));
  });
  const chave = texto(item.item_key || item.itemKey).match(/^(?:linha|idx):(\d+)$/);
  if (chave) candidatos.push(localizarLinhaPorNumero(itensDocumento, Number(chave[1])));

  if (!candidatos.length) {
    return { erro: 'LINHA_CENTRAL_NAO_IDENTIFICADA', justificativa: 'Item sem identificador da linha original da NF-e.' };
  }
  if (candidatos.some((idx) => idx < 0)) {
    return { erro: 'LINHA_CENTRAL_INEXISTENTE', justificativa: 'Identificador de linha não existe na NF-e da Central.' };
  }
  if (new Set(candidatos).size > 1) {
    return { erro: 'LINHA_CENTRAL_DIVERGENTE', justificativa: 'Identificadores do item apontam para linhas diferentes da NF-e.' };
  }
  return { indice: candidatos[0] };
}

/**
 * CENTRAL_NFE: reidentifica cada item na linha persistida da Central e restaura
 * nItem/uCom/qCom/uTrib/qTrib do XML. Campos comerciais editáveis (preço, descrição, margem…) são mantidos.
 */
function reconciliarItensComDocumentoCentral(itens = [], documento = {}) {
  const itensDocumento = Array.isArray(documento.itens) ? documento.itens : [];
  const erros = [];
  const usados = new Map();
  const reconciliados = [];

  (Array.isArray(itens) ? itens : []).forEach((item = {}, posicao) => {
    const base = {
      posicao,
      produto_id: item.produto_id || null,
      produto_nome: item.produto_nome || null,
      documento_id: documento.id ?? null,
      bloqueia_efetivacao: true
    };
    const linha = resolverLinhaCentral(item, itensDocumento);
    if (linha.erro) {
      erros.push({ ...base, codigo: linha.erro, justificativa: linha.justificativa });
      return;
    }
    if (usados.has(linha.indice)) {
      erros.push({
        ...base,
        codigo: 'LINHA_CENTRAL_DUPLICADA',
        justificativa: 'Mais de um item aponta para a mesma linha da NF-e.',
        central_item_indice: linha.indice
      });
      return;
    }
    usados.set(linha.indice, posicao);

    const original = snapshotXmlLinha(itensDocumento[linha.indice], linha.indice);
    const restaurados = [];
    const limpo = { ...item };
    CAMPOS_DECISAO_ITEM.forEach((campo) => { delete limpo[campo]; });
    const conversaoDescartada = CAMPOS_CONVERSAO_ITEM.filter((campo) => (
      limpo[campo] !== undefined && limpo[campo] !== null && texto(limpo[campo]) !== ''
    ));
    CAMPOS_CONVERSAO_ITEM.forEach((campo) => { delete limpo[campo]; });

    const mesmaUnidade = (a, b) => MotorUnidadesMedida.normalizarUnidadeEntradaNfe(texto(a))
      === MotorUnidadesMedida.normalizarUnidadeEntradaNfe(texto(b));
    let unidadeComercial = item.unidade_comercial;
    if (!mesmaUnidade(item.unidade_comercial ?? item.uCom, original.uCom)) {
      unidadeComercial = original.uCom;
      restaurados.push('unidade_comercial');
    }
    if (num(item.quantidade_comercial ?? item.qCom) !== original.qCom) restaurados.push('quantidade_comercial');
    if (texto(item.unidade_tributavel ?? item.uTrib) && !mesmaUnidade(item.unidade_tributavel ?? item.uTrib, original.uTrib)) {
      restaurados.push('unidade_tributavel');
    }
    if ((item.quantidade_tributavel ?? item.qTrib) != null && num(item.quantidade_tributavel ?? item.qTrib) !== original.qTrib) {
      restaurados.push('quantidade_tributavel');
    }

    reconciliados.push({
      ...limpo,
      central_item_indice: linha.indice,
      revisao_produto_linha: revisaoProdutoLinha({ correcoes_produto: itensDocumento[linha.indice]?.correcoes_produto }),
      nItem: original.nItem,
      item_key: `linha:${original.nItem}`,
      uCom: original.uCom,
      qCom: original.qCom,
      uTrib: original.uTrib,
      qTrib: original.qTrib,
      unidade_comercial: unidadeComercial,
      quantidade_comercial: original.qCom,
      unidade_tributavel: original.uTrib,
      quantidade_tributavel: original.qTrib,
      campos_xml_restaurados: restaurados,
      campos_conversao_descartados: conversaoDescartada
    });
  });

  return { ok: erros.length === 0, itens: reconciliados, erros };
}

/** Só valem decisões amarradas a este documento e a uma linha; as demais são descartadas. */
function filtrarConfirmacoesDocumento(confirmacoes, documentoId) {
  if (!Array.isArray(confirmacoes)) return [];
  return confirmacoes.filter((decisao) => {
    if (!decisao || typeof decisao !== 'object') return false;
    const docDecisao = decisao.documento_id ?? decisao.central_documento_id ?? decisao.documentoId;
    if (docDecisao === undefined || docDecisao === null || texto(docDecisao) === '') return false;
    return inteiroOuNull(decisao.nItem ?? decisao.nitem) !== null
      || /^(?:linha|idx):\d+$/.test(texto(decisao.item_key || decisao.itemKey));
  });
}

function montarErroPendencias(pendencias) {
  const err = new Error('Há itens com conversão de unidade pendente de confirmação.');
  err.status = 422;
  err.code = 'PENDENCIAS_CONVERSAO';
  err.tipo = 'PENDENCIAS_CONVERSAO';
  err.pendencias = pendencias;
  err.linhas = pendencias;
  return err;
}

function montarRegistroConversaoPersistente(item, produto, decisao, resultadoValidado, index, documentoId) {
  const xml = snapshotXmlLinha(item, index);
  return {
    item_key: extrairChaveConversaoItem(item, index),
    indice: index,
    documento_id: documentoId != null ? Number(documentoId) : null,
    produto_id: produto?.id || item.produto_id || null,
    estado: estadoDecisao(decisao),
    confirmacao: normalizarDecisaoConversaoEntrada(decisao),
    origem_decisao: 'manual',
    resultado_backend: resultadoValidado || null,
    aprendizado_permanente: false,
    xml_original: xml,
    atualizado_em: new Date().toISOString()
  };
}

module.exports = {
  ESTADOS_DECISAO,
  normalizarDecisaoConversaoEntrada,
  normalizarDecisoesConversaoEntrada,
  extrairChaveConversaoItem,
  itemRequerConfirmacaoConversao,
  validarPendenciasConversaoEntrada,
  aplicarDecisoesNosItens,
  avaliarLinha,
  montarPendencia,
  montarErroPendencias,
  snapshotXmlLinha,
  validarIdentidadeNota,
  estadoDecisao,
  montarRegistroConversaoPersistente,
  resolverLinhaCentral,
  reconciliarItensComDocumentoCentral,
  filtrarConfirmacoesDocumento,
  CAMPOS_DECISAO_ITEM,
  CAMPOS_CONVERSAO_ITEM,
  quantidadeAutorizadaEntradaNfe,
  aplicarSim,
  aplicarNao,
  revisaoProdutoLinha,
  contextoSeloConversao,
  gerarSeloConversao,
  verificarSeloDecisao
};
