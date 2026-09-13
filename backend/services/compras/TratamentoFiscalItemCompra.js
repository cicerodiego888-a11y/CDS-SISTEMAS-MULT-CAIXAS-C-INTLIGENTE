/**
 * RC4.31.11 — Tratamento fiscal por item de compra (CFOP, bonificação, estoque/custo).
 * @module services/compras/TratamentoFiscalItemCompra
 */
'use strict';

const {
  TIPO_ENTRADA,
  normalizarTipoEntrada
} = require('./PoliticaEntradaCompra');
const { classificarPorCfopItem } = require('./ClassificadorEntradaCompra');
const { getPadraoFiscal } = require('../configuracaoService');

/** Sufixos CFOP típicos de bonificação (últimos 3 dígitos). */
const CFOP_SUFIXO_BONIFICACAO = new Set(['910', '949']);

function digitsOnly(v) {
  return String(v || '').replace(/\D/g, '');
}

function isCfopBonificacao(cfop) {
  const d = digitsOnly(cfop);
  if (d.length !== 4) return false;
  return CFOP_SUFIXO_BONIFICACAO.has(d.slice(1));
}

function normalizarConfigBonificacao(config = {}) {
  const cfg = config || getPadraoFiscal();
  return {
    cfop_padrao: String(cfg.entrada_bonificacao_cfop_padrao || '5910').trim(),
    csosn_padrao: String(cfg.entrada_bonificacao_csosn_padrao || cfg.csosn_padrao || '').trim(),
    natureza_operacao: String(cfg.entrada_bonificacao_natureza || 'Bonificação recebida').trim(),
    atualizar_custo: cfg.entrada_bonificacao_atualizar_custo === true
      || cfg.entrada_bonificacao_atualizar_custo === 1
      || cfg.entrada_bonificacao_atualizar_custo === '1',
    gerar_estoque: cfg.entrada_bonificacao_gerar_estoque !== false
      && cfg.entrada_bonificacao_gerar_estoque !== 0
      && cfg.entrada_bonificacao_gerar_estoque !== '0'
  };
}

/**
 * Classifica tipo fiscal do item (prioridade: manual > CFOP > padrão compra).
 * @param {Object} item
 * @param {string} [tipoEntradaCompra]
 * @returns {{ tipoFiscal: string, bonificacao: boolean, cfop: string|null, origem: string }}
 */
function classificarTratamentoFiscalItem(item = {}, tipoEntradaCompra = null) {
  const cfop = digitsOnly(item.cfop || item.CFOP || '').slice(0, 4) || null;
  const tipoManual = item.tipo_fiscal_item || item.tipoFiscalItem || null;

  if (tipoManual) {
    const tipo = normalizarTipoEntrada(tipoManual === 'BONIFICACAO' ? 'BONIFICACAO' : tipoManual);
    return {
      tipoFiscal: tipo,
      bonificacao: tipo === TIPO_ENTRADA.BONIFICACAO || Number(item.bonificacao) === 1,
      cfop,
      origem: 'manual'
    };
  }

  if (Number(item.bonificacao) === 1) {
    return {
      tipoFiscal: TIPO_ENTRADA.BONIFICACAO,
      bonificacao: true,
      cfop,
      origem: 'flag'
    };
  }

  if (cfop) {
    const porCfop = classificarPorCfopItem(cfop);
    if (porCfop) {
      return {
        tipoFiscal: porCfop.tipo,
        bonificacao: porCfop.tipo === TIPO_ENTRADA.BONIFICACAO,
        cfop,
        origem: 'cfop'
      };
    }
  }

  if (tipoEntradaCompra) {
    const tipo = normalizarTipoEntrada(tipoEntradaCompra);
    return {
      tipoFiscal: tipo,
      bonificacao: tipo === TIPO_ENTRADA.BONIFICACAO,
      cfop,
      origem: 'compra'
    };
  }

  return {
    tipoFiscal: TIPO_ENTRADA.REVENDA,
    bonificacao: false,
    cfop,
    origem: 'padrao'
  };
}

/**
 * Enriquece item com cfop, tipo_fiscal_item e bonificacao.
 * @param {Object} item
 * @param {Object} [opcoes]
 * @returns {Object}
 */
function enriquecerItemFiscalCompra(item = {}, opcoes = {}) {
  const base = { ...item };
  const cfopXml = digitsOnly(base.cfop || base.CFOP || '').slice(0, 4);
  if (cfopXml) base.cfop = cfopXml;

  const classificacao = classificarTratamentoFiscalItem(base, opcoes.tipoEntradaCompra);
  base.tipo_fiscal_item = classificacao.tipoFiscal;
  base.bonificacao = classificacao.bonificacao ? 1 : 0;
  if (!base.cfop && classificacao.tipoFiscal === TIPO_ENTRADA.BONIFICACAO && opcoes.configBonificacao?.cfop_padrao) {
    base.cfop = opcoes.configBonificacao.cfop_padrao;
  }
  return base;
}

/**
 * Resolve efeitos operacionais do item (estoque / custo).
 * @param {Object} item
 * @param {Object} [configFiscal]
 * @returns {{ gerarEstoque: boolean, atualizarCusto: boolean, bonificacao: boolean, tipoFiscal: string, tooltip: string }}
 */
function resolverTratamentoFiscalItem(item = {}, configFiscal = null) {
  const cfgBonif = normalizarConfigBonificacao(configFiscal);
  const classificacao = classificarTratamentoFiscalItem(item);

  if (classificacao.tipoFiscal === TIPO_ENTRADA.USO_CONSUMO) {
    return {
      gerarEstoque: false,
      atualizarCusto: false,
      bonificacao: false,
      tipoFiscal: classificacao.tipoFiscal,
      tooltip: 'Uso e consumo — sem movimentação de estoque.'
    };
  }

  if (classificacao.bonificacao) {
    return {
      gerarEstoque: cfgBonif.gerar_estoque,
      atualizarCusto: cfgBonif.atualizar_custo,
      bonificacao: true,
      tipoFiscal: TIPO_ENTRADA.BONIFICACAO,
      tooltip: cfgBonif.gerar_estoque
        ? (cfgBonif.atualizar_custo
          ? 'Bonificação — gera estoque e atualiza custo (config).'
          : 'Bonificação — gera estoque sem alterar custo médio (config).')
        : 'Bonificação — sem movimentação de estoque (config).'
    };
  }

  return {
    gerarEstoque: true,
    atualizarCusto: true,
    bonificacao: false,
    tipoFiscal: classificacao.tipoFiscal,
    tooltip: `CFOP ${classificacao.cfop || '—'} — entrada operacional padrão.`
  };
}

module.exports = {
  CFOP_SUFIXO_BONIFICACAO,
  isCfopBonificacao,
  normalizarConfigBonificacao,
  classificarTratamentoFiscalItem,
  enriquecerItemFiscalCompra,
  resolverTratamentoFiscalItem
};
