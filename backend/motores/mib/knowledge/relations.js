'use strict';

/** Tipos de nó do Knowledge Graph */
const NODE_TYPES = Object.freeze({
  PRODUTO: 'produto',
  MARCA: 'marca',
  CATEGORIA: 'categoria',
  SUBCATEGORIA: 'subcategoria',
  FORNECEDOR: 'fornecedor',
  CLIENTE: 'cliente',
  NCM: 'ncm',
  CEST: 'cest',
  CFOP: 'cfop',
  FABRICANTE: 'fabricante',
  GRUPO: 'grupo',
  SUBGRUPO: 'subgrupo',
  CLUSTER: 'cluster'
});

/** Relacionamentos oficiais */
const REL = Object.freeze({
  PERTENCE_A: 'PERTENCE_A',
  FABRICADO_POR: 'FABRICADO_POR',
  FORNECIDO_POR: 'FORNECIDO_POR',
  COMPRADO_JUNTO: 'COMPRADO_JUNTO',
  VENDIDO_JUNTO: 'VENDIDO_JUNTO',
  SUBSTITUI: 'SUBSTITUI',
  SIMILAR: 'SIMILAR',
  MESMA_CATEGORIA: 'MESMA_CATEGORIA',
  MESMA_MARCA: 'MESMA_MARCA',
  COMPATIVEL: 'COMPATIVEL',
  CONCORRENTE: 'CONCORRENTE',
  NO_CLUSTER: 'NO_CLUSTER'
});

module.exports = { NODE_TYPES, REL };
