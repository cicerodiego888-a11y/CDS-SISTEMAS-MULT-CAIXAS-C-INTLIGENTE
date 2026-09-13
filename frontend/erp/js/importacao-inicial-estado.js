/**
 * Estado de tela da Importação Inicial (somente sessão UI — não toca banco).
 * V1.0.18 — modos CADASTRO_INICIAL | ATUALIZAR_QUANTIDADES + modo_fiscal_importacao
 */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }
  if (typeof root !== 'undefined') {
    root.ImportacaoInicialEstado = api;
  }
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const MODOS = Object.freeze({
    CADASTRO_INICIAL: 'CADASTRO_INICIAL',
    ATUALIZAR_QUANTIDADES: 'ATUALIZAR_QUANTIDADES'
  });

  const MODOS_FISCAIS = Object.freeze({
    FISCAL: 'FISCAL',
    NAO_FISCAL: 'NAO_FISCAL'
  });

  function criarEstadoVazioImportacao(modo) {
    return {
      modo: modo || MODOS.CADASTRO_INICIAL,
      modo_fiscal_importacao: null,
      arquivoNome: null,
      sessaoId: null,
      resumo: null,
      linhas: [],
      resultado: null,
      politica_pendentes: null,
      pode_importar: false
    };
  }

  function resetarEstadoImportacaoInicial(estadoAnterior) {
    return {
      estado: criarEstadoVazioImportacao(estadoAnterior?.modo || MODOS.CADASTRO_INICIAL),
      sessaoAnterior: estadoAnterior?.sessaoId || null
    };
  }

  function trocarModoImportacao(estadoAnterior, novoModo) {
    const modo = novoModo === MODOS.ATUALIZAR_QUANTIDADES
      ? MODOS.ATUALIZAR_QUANTIDADES
      : MODOS.CADASTRO_INICIAL;
    return {
      estado: criarEstadoVazioImportacao(modo),
      sessaoAnterior: estadoAnterior?.sessaoId || null,
      modoAnterior: estadoAnterior?.modo || MODOS.CADASTRO_INICIAL
    };
  }

  function contadoresZerados(modo) {
    if (modo === MODOS.ATUALIZAR_QUANTIDADES) {
      return {
        produtos_no_arquivo: 0,
        produtos_encontrados: 0,
        produtos_nao_encontrados: 0,
        quantidade_total_a_lancar: 0
      };
    }
    return {
      produtos_encontrados: 0,
      produtos_validos: 0,
      com_erro: 0,
      possiveis_duplicados: 0,
      estoque_inicial_total: 0
    };
  }

  function temDadosCarregados(estado) {
    return !!(
      estado?.arquivoNome
      || estado?.sessaoId
      || (estado?.linhas || []).length
      || estado?.resultado
    );
  }

  function rotuloModoFiscal(modoFiscal) {
    return modoFiscal === MODOS_FISCAIS.NAO_FISCAL
      ? 'NÃO FISCAL — SEM NF'
      : 'FISCAL — COM NF';
  }

  return Object.freeze({
    MODOS,
    MODOS_FISCAIS,
    criarEstadoVazioImportacao,
    resetarEstadoImportacaoInicial,
    trocarModoImportacao,
    contadoresZerados,
    temDadosCarregados,
    rotuloModoFiscal
  });
}));
