/**
 * Sprint 14.7 — ToledoPluMapper
 * Converte Produto CDS → estrutura da balança. Sem comunicação.
 */

'use strict';

function num(v, def = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
}

function str(v, max) {
  const s = v == null ? '' : String(v).trim();
  return max != null ? s.slice(0, max) : s;
}

/**
 * @param {object} produto CDS
 * @returns {object} PLU Toledo
 */
function map(produto = {}) {
  const plu = produto.plu != null
    ? String(produto.plu).trim()
    : (produto.codigo != null ? String(produto.codigo).trim() : '');

  // Departamento: se não informado, null (validator reporta); CDS pode enviar departamento/departamento_id.
  let departamento = null;
  if (produto.departamento != null && produto.departamento !== '') {
    departamento = num(produto.departamento, NaN);
    if (Number.isNaN(departamento)) departamento = null;
  } else if (produto.departamento_id != null && produto.departamento_id !== '') {
    departamento = num(produto.departamento_id, NaN);
    if (Number.isNaN(departamento)) departamento = null;
  }

  const unidadeRaw = produto.unidade != null ? String(produto.unidade).trim() : '';
  // Pesáveis sem unidade explícita → kg (padrão balança)
  const pesavel = Number(produto.produto_fracionado ?? produto.vendido_por_peso ?? produto.produto_pesavel ?? 0) === 1;
  const unidade = unidadeRaw || (pesavel ? 'kg' : '');

  return {
    produto_id: produto.id != null ? produto.id : (produto.produto_id != null ? produto.produto_id : null),
    plu,
    descricao: str(produto.descricao || produto.nome || produto.descricao_reduzida, 22),
    preco: num(produto.preco != null ? produto.preco : produto.preco_venda, NaN),
    validade: produto.validade != null ? str(produto.validade, 20) : (produto.dias_validade != null ? String(produto.dias_validade) : null),
    tara: num(produto.tara, 0),
    departamento,
    unidade: unidade || null,
    ativo: produto.ativo !== undefined ? produto.ativo : null,
    produto_fracionado: produto.produto_fracionado != null
      ? Number(produto.produto_fracionado)
      : (produto.vendido_por_peso != null ? Number(produto.vendido_por_peso) : null),
    codigoBarras: str(produto.codigoBarras || produto.codigo_barras || produto.ean || produto.gtin, 14)
  };
}

function mapMany(lista) {
  return (Array.isArray(lista) ? lista : []).map(map);
}

module.exports = {
  map,
  mapMany
};
