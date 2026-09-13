/**
 * Metadados dos tipos de alerta da Central de Entradas (Sprint 7).
 * Somente leitura / monitoramento — não altera regras de negócio.
 *
 * @module motores/central-entradas/config/centralAlertasTipos
 */

const TIPOS_ALERTA = Object.freeze({
  FORNECEDOR_NOVO: {
    tipo: 'FORNECEDOR_NOVO',
    gravidade: 'media',
    icone: 'fa-user-plus',
    cor: '#0dcaf0',
    acaoSugerida: 'Revise a primeira nota deste fornecedor com atenção.'
  },
  NOTA_DUPLICADA: {
    tipo: 'NOTA_DUPLICADA',
    gravidade: 'baixa',
    icone: 'fa-copy',
    cor: '#dc3545',
    acaoSugerida: 'Verifique se a nota já foi lançada em Compras.'
  },
  VALOR_ACIMA_MEDIA: {
    tipo: 'VALOR_ACIMA_MEDIA',
    gravidade: 'media',
    icone: 'fa-chart-line',
    cor: '#fd7e14',
    acaoSugerida: 'Confira o valor da nota em relação ao histórico do fornecedor.'
  },
  REVISAO_PARADA: {
    tipo: 'REVISAO_PARADA',
    gravidade: 'alta',
    icone: 'fa-hourglass-half',
    cor: '#fd7e14',
    acaoSugerida: 'Conclua a revisão MIIP dos produtos pendentes.'
  },
  SINCRONIZADA_NAO_PROCESSADA: {
    tipo: 'SINCRONIZADA_NAO_PROCESSADA',
    gravidade: 'media',
    icone: 'fa-play-circle',
    cor: '#0d6efd',
    acaoSugerida: 'Execute o processamento da nota na Central.'
  },
  COMPRA_ABERTA: {
    tipo: 'COMPRA_ABERTA',
    gravidade: 'alta',
    icone: 'fa-shopping-cart',
    cor: '#6610f2',
    acaoSugerida: 'Finalize ou retome o lançamento na tela de Compras.'
  },
  ERRO_PROCESSAMENTO: {
    tipo: 'ERRO_PROCESSAMENTO',
    gravidade: 'critica',
    icone: 'fa-exclamation-triangle',
    cor: '#dc3545',
    acaoSugerida: 'Analise o erro e reprocesse ou corrija o XML.'
  },
  XML_INVALIDO: {
    tipo: 'XML_INVALIDO',
    gravidade: 'critica',
    icone: 'fa-file-excel',
    cor: '#dc3545',
    acaoSugerida: 'Verifique o XML da nota ou sincronize novamente na SEFAZ.'
  },
  FALHA_SINCRONIZACAO: {
    tipo: 'FALHA_SINCRONIZACAO',
    gravidade: 'alta',
    icone: 'fa-satellite-dish',
    cor: '#f59e0b',
    acaoSugerida: 'Execute uma nova sincronização SEFAZ e verifique o certificado.'
  }
});

const ORDEM_GRAVIDADE = Object.freeze({
  critica: 0,
  alta: 1,
  media: 2,
  baixa: 3
});

/**
 * @param {string} tipo
 * @returns {Object|null}
 */
function obterMetaAlerta(tipo) {
  return TIPOS_ALERTA[tipo] || null;
}

/**
 * @param {string} gravidade
 * @returns {number}
 */
function pesoGravidade(gravidade) {
  return ORDEM_GRAVIDADE[gravidade] ?? 99;
}

module.exports = {
  TIPOS_ALERTA,
  ORDEM_GRAVIDADE,
  obterMetaAlerta,
  pesoGravidade
};
