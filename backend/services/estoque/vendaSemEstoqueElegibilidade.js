'use strict';

const { categoriaEhAcougueOuHortifruti } = require('../categorias/categoriaPadroes');

function produtoElegivelVendaSemEstoque(produto = {}) {
  const categoria = produto.categoria_nome || produto.categoria || '';
  return categoriaEhAcougueOuHortifruti(
    categoria && typeof categoria === 'object' ? categoria.nome : categoria
  );
}

function vendaSemEstoquePermitida(produto, flagAtivada) {
  return flagAtivada === true && produtoElegivelVendaSemEstoque(produto);
}

function deveBloquearExcedentePorCategoria(produto, quantidade, disponivel, flagAtivada) {
  if (flagAtivada !== true) return false;
  if (Number(produto?.controla_estoque ?? 1) === 0) return false;
  if (Number(quantidade || 0) <= Number(disponivel || 0) + 1e-9) return false;
  return !produtoElegivelVendaSemEstoque(produto);
}

module.exports = {
  produtoElegivelVendaSemEstoque,
  vendaSemEstoquePermitida,
  deveBloquearExcedentePorCategoria
};