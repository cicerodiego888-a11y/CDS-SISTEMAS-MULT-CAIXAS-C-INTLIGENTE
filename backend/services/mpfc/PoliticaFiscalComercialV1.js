/**
 * PoliticaFiscalComercialV1 — CONTRATO CONGELADO (RC8.2.2).
 *
 * Status: CONGELADO. Homologado com MPFC V1.
 * Toda evolução futura DEVE criar PoliticaFiscalComercialV2.
 * Nunca alterar este contrato V1 (campos, defaults semânticos, códigos).
 *
 * Objeto declarativo; não contém regras executáveis.
 */
'use strict';

const VERSAO_CONTRATO = '1.0';

const MODOS = Object.freeze({
  FIXA: 'FIXA',
  FLEXIVEL: 'FLEXIVEL'
});

const CODIGOS_POLITICA = Object.freeze({
  FIXA_PADRAO: 'FIXA_PADRAO',
  FIXA_PRESERVAR_DINHEIRO: 'FIXA_PRESERVAR_DINHEIRO',
  FLEXIVEL: 'FLEXIVEL'
});

/**
 * Defaults oficiais V1.
 * nuncaVenderAbaixoDaMargem=false no mapeamento de config (sem regra prévia no PDV).
 * Contrato ainda aceita true quando configurado.
 */
const DEFAULTS_V1 = Object.freeze({
  versao: VERSAO_CONTRATO,
  modo: MODOS.FIXA,
  percentualDinheiroFiscal: 0,
  margemMinimaSobreOCusto: 20,
  nuncaVenderAbaixoDaMargem: false,
  preservarDinheiro: false,
  codigoPolitica: CODIGOS_POLITICA.FIXA_PADRAO
});

function freezeDeep(obj) {
  if (!obj || typeof obj !== 'object' || Object.isFrozen(obj)) {
    return obj;
  }
  Object.freeze(obj);
  return obj;
}

function resolverCodigoPolitica(modo, preservarDinheiro) {
  if (modo === MODOS.FLEXIVEL) return CODIGOS_POLITICA.FLEXIVEL;
  if (preservarDinheiro) return CODIGOS_POLITICA.FIXA_PRESERVAR_DINHEIRO;
  return CODIGOS_POLITICA.FIXA_PADRAO;
}

/**
 * Monta e congela um PoliticaFiscalComercialV1.
 * @param {object} [parcial]
 */
function criarPoliticaFiscalComercialV1(parcial = {}) {
  const modo = parcial.modo === MODOS.FLEXIVEL ? MODOS.FLEXIVEL : MODOS.FIXA;
  const preservarDinheiro = Boolean(
    parcial.preservarDinheiro != null
      ? parcial.preservarDinheiro
      : DEFAULTS_V1.preservarDinheiro
  );
  const codigoPolitica = parcial.codigoPolitica
    ? String(parcial.codigoPolitica)
    : resolverCodigoPolitica(modo, preservarDinheiro);

  const politica = {
    versao: String(parcial.versao != null ? parcial.versao : DEFAULTS_V1.versao),
    codigoPolitica,
    modo,
    percentualDinheiroFiscal: Number(
      parcial.percentualDinheiroFiscal != null
        ? parcial.percentualDinheiroFiscal
        : DEFAULTS_V1.percentualDinheiroFiscal
    ),
    margemMinimaSobreOCusto: Number(
      parcial.margemMinimaSobreOCusto != null
        ? parcial.margemMinimaSobreOCusto
        : DEFAULTS_V1.margemMinimaSobreOCusto
    ),
    nuncaVenderAbaixoDaMargem: Boolean(
      parcial.nuncaVenderAbaixoDaMargem != null
        ? parcial.nuncaVenderAbaixoDaMargem
        : DEFAULTS_V1.nuncaVenderAbaixoDaMargem
    ),
    preservarDinheiro: modo === MODOS.FIXA ? preservarDinheiro : false
  };
  return freezeDeep(politica);
}

/**
 * Payload oficial para persistir na venda (RC8.2).
 */
function serializarSnapshotPolitica(politica) {
  const p = politica || DEFAULTS_V1;
  return {
    versao: p.versao || VERSAO_CONTRATO,
    codigoPolitica: p.codigoPolitica || resolverCodigoPolitica(p.modo, p.preservarDinheiro),
    modo: p.modo || MODOS.FIXA,
    percentualDinheiroFiscal: Number(p.percentualDinheiroFiscal || 0),
    margemMinimaSobreOCusto: Number(p.margemMinimaSobreOCusto || 0),
    nuncaVenderAbaixoDaMargem: Boolean(p.nuncaVenderAbaixoDaMargem),
    preservarDinheiro: Boolean(p.preservarDinheiro)
  };
}

module.exports = {
  VERSAO_CONTRATO,
  MODOS,
  CODIGOS_POLITICA,
  DEFAULTS_V1,
  criarPoliticaFiscalComercialV1,
  resolverCodigoPolitica,
  serializarSnapshotPolitica,
  freezeDeep
};
