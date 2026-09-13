/**
 * SemanticAttributeType — Enum oficial dos tipos de atributo semântico.
 *
 * Sprint 7.2 — contrato de domínio. Sem extração nem lógica de negócio.
 *
 * @module motores/miip/core/SemanticAttributeType
 */

const TIPOS = {
  TIPO: 'TIPO',
  MARCA: 'MARCA',
  MODELO: 'MODELO',
  TECNOLOGIA: 'TECNOLOGIA',
  POTENCIA: 'POTENCIA',
  TENSAO: 'TENSAO',
  COR: 'COR',
  MATERIAL: 'MATERIAL',
  BITOLA: 'BITOLA',
  DIAMETRO: 'DIAMETRO',
  PESO: 'PESO',
  VOLUME: 'VOLUME',
  CAPACIDADE: 'CAPACIDADE',
  EMBALAGEM: 'EMBALAGEM',
  UNIDADE: 'UNIDADE',
  QUANTIDADE: 'QUANTIDADE',
  NCM: 'NCM',
  CEST: 'CEST',
  GTIN: 'GTIN',
  OUTRO: 'OUTRO'
};

const SemanticAttributeType = Object.freeze({
  ...TIPOS,
  TODOS: Object.freeze(Object.values(TIPOS))
});

module.exports = SemanticAttributeType;
