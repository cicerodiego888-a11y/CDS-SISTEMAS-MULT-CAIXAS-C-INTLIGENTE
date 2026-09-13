/**
 * RC8.5.2 — Motor Inteligente de Identificação de Embalagens (MIE).
 * Analisa xProd, infAdProd, uCom, uTrib, cProd e aprendizado do fornecedor.
 *
 * @module services/embalagens/MotorInteligenteEmbalagens
 */

'use strict';

const {
  UNIDADES_EMBALAGEM,
  normalizarTexto,
  normalizarUCom,
  extrairUnidadeDoTexto,
  extrairQuantidadeDoTexto,
  extrairMedidaEmbalagem
} = require('./MiePadroes');

const LIMIAR_AUTO = 95;
const LIMIAR_SUGESTAO = 70;

/**
 * @param {Object} input
 * @param {string} [input.xProd]
 * @param {string} [input.infAdProd]
 * @param {string} [input.uCom]
 * @param {string} [input.uTrib]
 * @param {string} [input.cProd]
 * @param {string} [input.marca]
 * @param {number} [input.quantidade]
 * @param {number} [input.precoUnitario]
 * @param {number} [input.subtotal]
 * @param {Object|null} [input.aprendizado] — { unidade, quantidade_por_embalagem, ocorrencias }
 * @returns {Object} sugestão MIE
 */
function analisar(input = {}) {
  const xProd = input.xProd || input.produto_nome || input.descricao || '';
  const infAd = input.infAdProd || input.inf_ad_prod || input.descricao_complementar || '';
  const uComRaw = input.uCom || input.unidade || '';
  const uTribRaw = input.uTrib || input.unidade_tributavel || '';
  const cProd = input.cProd || input.codigo_fornecedor || '';
  const marca = input.marca || '';
  const aprendizado = input.aprendizado || null;

  const motivos = [];
  let confianca = 0;
  let unidade = null;
  let quantidade = null;
  const origens = [];

  const uCom = normalizarUCom(uComRaw);
  if (uCom && UNIDADES_EMBALAGEM.includes(uCom)) {
    unidade = uCom;
    confianca += 40;
    motivos.push(`uCom = ${uComRaw || uCom}`);
    origens.push('unidade_comercial');
  }

  const undDesc = extrairUnidadeDoTexto(xProd);
  if (undDesc.unidade) {
    if (!unidade) {
      unidade = undDesc.unidade;
      confianca += 45;
      origens.push('descricao');
    } else if (unidade === undDesc.unidade) {
      confianca += 22;
      origens.push('descricao');
    } else {
      // Descrição diverge do uCom — prioriza descrição se mais específica
      motivos.push(`Descrição indica ${undDesc.unidade} (uCom=${unidade})`);
      unidade = undDesc.unidade;
      confianca = Math.max(confianca, 72);
      origens.push('descricao');
    }
    motivos.push(`Encontrado "${undDesc.match}" na descrição`);
  }

  const qtdDesc = extrairQuantidadeDoTexto(xProd);
  if (qtdDesc.quantidade) {
    quantidade = qtdDesc.quantidade;
    confianca += 28;
    motivos.push(`Encontrado "${qtdDesc.match}" (${qtdDesc.tipo})`);
    if (!origens.includes('descricao')) origens.push('descricao');
  }

  const undInf = extrairUnidadeDoTexto(infAd);
  if (undInf.unidade) {
    if (!unidade) {
      unidade = undInf.unidade;
      confianca += 20;
    } else if (unidade === undInf.unidade) {
      confianca += 12;
    }
    motivos.push(`Encontrado "${undInf.match}" nas informações adicionais`);
    origens.push('informacoes_adicionais');
  }

  const qtdInf = extrairQuantidadeDoTexto(infAd);
  if (qtdInf.quantidade) {
    if (!quantidade) {
      quantidade = qtdInf.quantidade;
      confianca += 18;
    } else if (quantidade === qtdInf.quantidade) {
      confianca += 8;
    }
    motivos.push(`Quantidade "${qtdInf.match}" nas informações adicionais`);
    if (!origens.includes('informacoes_adicionais')) origens.push('informacoes_adicionais');
  }

  const medida = extrairMedidaEmbalagem(xProd).medida
    ? extrairMedidaEmbalagem(xProd)
    : extrairMedidaEmbalagem(infAd);
  if (medida.medida && unidade) {
    confianca += 12;
    motivos.push(`Medida de embalagem "${medida.match}"`);
  }

  // cProd / marca — reforço leve se texto auxiliar
  const textoAux = normalizarTexto(`${cProd} ${marca}`);
  const undAux = extrairUnidadeDoTexto(textoAux);
  if (undAux.unidade && undAux.unidade === unidade) {
    confianca += 4;
    motivos.push(`Código/marca reforça ${unidade}`);
  }

  // Aprendizado do fornecedor
  if (aprendizado && aprendizado.unidade) {
    const undApr = normalizarUCom(aprendizado.unidade);
    const qtdApr = Number(aprendizado.quantidade_por_embalagem || 0);
    const ocorrencias = Number(aprendizado.ocorrencias || 1);
    if (UNIDADES_EMBALAGEM.includes(undApr)) {
      if (!unidade || unidade === undApr) {
        unidade = undApr;
        confianca += Math.min(35, 20 + ocorrencias * 3);
        motivos.push(`Fornecedor já utilizou esse padrão (${undApr}${qtdApr > 0 ? ` × ${qtdApr}` : ''})`);
        origens.push('aprendizado_fornecedor');
      }
      if (qtdApr > 1 && !quantidade) {
        quantidade = qtdApr;
        confianca += 10;
      } else if (qtdApr > 1 && quantidade === qtdApr) {
        confianca += 8;
      }
    }
  }

  // uTrib diferente de uCom embalagem reforça conversão
  const uTrib = normalizarUCom(uTribRaw);
  if (unidade && uTrib && uTrib !== unidade && (uTrib === 'UN' || uTrib === 'UND')) {
    confianca += 6;
    motivos.push(`uTrib=${uTribRaw || uTrib} (estoque em unidade)`);
  }

  confianca = Math.min(99, Math.round(confianca));

  // Descrição com unidade de embalagem, mesmo sem qty → no mínimo sugerir
  if (unidade && UNIDADES_EMBALAGEM.includes(unidade) && confianca > 0 && confianca < LIMIAR_SUGESTAO) {
    confianca = LIMIAR_SUGESTAO;
  }

  const compraPorEmbalagem = Boolean(unidade && UNIDADES_EMBALAGEM.includes(unidade) && confianca >= LIMIAR_SUGESTAO);

  let acao = 'ignorar';
  if (compraPorEmbalagem && confianca > LIMIAR_AUTO) acao = 'auto_ativar';
  else if (compraPorEmbalagem && confianca >= LIMIAR_SUGESTAO) acao = 'sugerir';

  const precoUnitario = Number(input.precoUnitario ?? input.preco_unitario ?? input.valor_unitario ?? 0);
  const valorEmbalagem = precoUnitario > 0 ? Math.round(precoUnitario * 100) / 100 : null;

  const origemLabel = origens.length
    ? origens.map((o) => ({
      unidade_comercial: 'Unidade Comercial',
      descricao: 'Descrição',
      informacoes_adicionais: 'Informações adicionais',
      aprendizado_fornecedor: 'Histórico do fornecedor'
    }[o] || o)).join(' + ')
    : '—';

  return {
    motor: 'MIE',
    versao: 'RC8.5.2',
    compra_por_embalagem: compraPorEmbalagem,
    unidade_comercial: unidade || null,
    quantidade_por_embalagem: quantidade || null,
    valor_compra_embalagem: valorEmbalagem,
    confianca,
    acao,
    motivos,
    origem: origemLabel,
    origens,
    rotulo: unidade && quantidade
      ? `${unidade} × ${quantidade}`
      : (unidade || null),
    limiares: { auto: LIMIAR_AUTO, sugestao: LIMIAR_SUGESTAO }
  };
}

function deveAutoAtivar(sugestao) {
  return sugestao && sugestao.acao === 'auto_ativar';
}

function deveSugerir(sugestao) {
  return sugestao && sugestao.acao === 'sugerir';
}

module.exports = {
  analisar,
  deveAutoAtivar,
  deveSugerir,
  LIMIAR_AUTO,
  LIMIAR_SUGESTAO
};
