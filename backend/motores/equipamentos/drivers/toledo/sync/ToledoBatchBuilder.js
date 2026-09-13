/**
 * Sprint 15.4 — ToledoBatchBuilder
 * Organiza envio em lotes: PLUs, Departamentos, Preços, Promoções, Etiquetas, Configurações.
 */

'use strict';

const crypto = require('crypto');

const TIPOS = Object.freeze({
  PLU: 'PLU',
  DEPARTAMENTO: 'DEPARTAMENTO',
  PRECO: 'PRECO',
  PROMOCAO: 'PROMOCAO',
  ETIQUETA: 'ETIQUETA',
  CONFIGURACAO: 'CONFIGURACAO'
});

const COMANDO_POR_TIPO = Object.freeze({
  [TIPOS.PLU]: 'uploadPlu',
  [TIPOS.DEPARTAMENTO]: 'uploadDepartment',
  [TIPOS.PRECO]: 'uploadPrice',
  [TIPOS.PROMOCAO]: 'uploadPrice',
  [TIPOS.ETIQUETA]: 'uploadLabel',
  [TIPOS.CONFIGURACAO]: 'uploadPlu'
});

function checksumItens(itens) {
  const h = crypto.createHash('sha1');
  h.update(JSON.stringify(itens || []));
  return h.digest('hex').slice(0, 12);
}

/**
 * @param {Array} itens
 * @param {{tamanhoLote?:number, tipo?:string}} [opcoes]
 * @returns {Array<{id:string, tipo:string, comando:string, quantidade:number, checksum:string, itens:Array, tempo:null, confirmed:boolean}>}
 */
function build(itens = [], opcoes = {}) {
  const tamanho = Math.max(1, Number(opcoes.tamanhoLote) || 10);
  const tipo = String(opcoes.tipo || TIPOS.PLU).toUpperCase();
  const comando = COMANDO_POR_TIPO[tipo] || 'uploadPlu';
  const lista = Array.isArray(itens) ? itens.filter(Boolean) : [];
  const lotes = [];

  for (let i = 0; i < lista.length; i += tamanho) {
    const slice = lista.slice(i, i + tamanho);
    const seq = lotes.length + 1;
    lotes.push({
      id: `${tipo.toLowerCase()}-${seq}-${checksumItens(slice)}`,
      tipo,
      comando,
      quantidade: slice.length,
      checksum: checksumItens(slice),
      itens: slice,
      tempo: null,
      confirmed: false,
      seq
    });
  }

  return lotes;
}

/**
 * Monta lotes multi-tipo a partir de um plano de sincronização.
 * @param {{plus?:Array, departamentos?:Array, precos?:Array, promocoes?:Array, etiquetas?:Array, configs?:Array}} carga
 * @param {{tamanhoLote?:number}} [opcoes]
 */
function buildFromCarga(carga = {}, opcoes = {}) {
  const lotes = [];
  const push = (tipo, itens) => {
    if (!itens || !itens.length) return;
    lotes.push(...build(itens, { ...opcoes, tipo }));
  };
  push(TIPOS.DEPARTAMENTO, carga.departamentos);
  push(TIPOS.PLU, carga.plus || carga.produtos || carga.plu);
  push(TIPOS.PRECO, carga.precos);
  push(TIPOS.PROMOCAO, carga.promocoes);
  push(TIPOS.ETIQUETA, carga.etiquetas);
  push(TIPOS.CONFIGURACAO, carga.configs || carga.configuracoes);
  return lotes;
}

module.exports = {
  build,
  buildFromCarga,
  checksumItens,
  TIPOS,
  COMANDO_POR_TIPO
};
