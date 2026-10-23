'use strict';

const MAX_CAMPO = 120;

function limparTexto(valor, max = MAX_CAMPO) {
  if (valor == null) return null;
  let texto = String(valor)
    .replace(/[\u0000-\u001f\u007f-\u009f]+/g, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!texto) return null;
  if (texto.length > max) texto = `${texto.slice(0, max - 1).trimEnd()}…`;
  return texto;
}

function primeiroValor(...valores) {
  for (const v of valores) {
    if (v != null && String(v).trim() !== '') return v;
  }
  return null;
}

/**
 * Associa uma falha de validação fiscal ao item (produto) que a provocou.
 * Campos de contexto vêm do próprio item; campo/valor/esperado vêm das
 * propriedades anexadas pelo validador que lançou o erro (sem interpretar texto).
 */
function criarErroItemFiscal(erro, item = {}, indice = 0) {
  const produtoId = Number(item.produto_id);
  const diag = item.identificacao_diagnostico || {};
  return {
    produto_id: Number.isSafeInteger(produtoId) && produtoId > 0 ? produtoId : null,
    codigo: limparTexto(primeiroValor(diag.codigo, item.codigo, item.produto_codigo, item.codigo_interno, item.sku)),
    nome: limparTexto(primeiroValor(item.produto_nome, item.nome, item.descricao)),
    codigo_barras: limparTexto(primeiroValor(diag.codigo_barras, item.codigo_barras, item.codigo_barra, item.ean), 40),
    numero_item: indice + 1,
    campo: limparTexto(erro?.campoFiscal, 30),
    valor_encontrado: limparTexto(erro?.valorEncontrado, 60),
    valor_esperado: limparTexto(erro?.valorEsperado, 120),
    mensagem: limparTexto(erro?.message || String(erro), 300) || 'Falha na validação fiscal do item.'
  };
}

function descreverErroItem(e) {
  const partes = [`Item ${e.numero_item}`];
  if (e.nome) partes.push(`produto "${e.nome}"`);
  if (e.produto_id != null) partes.push(`ID ${e.produto_id}`);
  if (e.codigo) partes.push(`código ${e.codigo}`);
  const campo = e.campo
    ? ` [campo ${e.campo}${e.valor_encontrado != null ? `, valor encontrado "${e.valor_encontrado}"` : ''}]`
    : '';
  return `${partes.join(', ')}${campo}: ${e.mensagem}`;
}

/**
 * Erro único que carrega todos os itens inválidos. Com um só item mantém a
 * mensagem original do validador, preservando consumidores existentes.
 */
function criarErroItensFiscais(itensErros) {
  const lista = Array.isArray(itensErros) ? itensErros : [];
  const mensagem = lista.length === 1
    ? lista[0].mensagem
    : `Falha na validação fiscal de ${lista.length} itens. ${lista[0]?.mensagem || ''}`.trim();
  const erro = new Error(mensagem);
  erro.itensErros = lista;
  return erro;
}

function sanitizarErroItem(e) {
  if (!e || typeof e !== 'object') return null;
  const numero = Number(e.numero_item);
  const produtoId = Number(e.produto_id);
  const saida = {
    produto_id: Number.isSafeInteger(produtoId) && produtoId > 0 ? produtoId : null,
    codigo: limparTexto(e.codigo),
    nome: limparTexto(e.nome),
    codigo_barras: limparTexto(e.codigo_barras, 40),
    numero_item: Number.isSafeInteger(numero) && numero > 0 ? numero : null,
    campo: limparTexto(e.campo, 30),
    valor_encontrado: limparTexto(e.valor_encontrado, 60),
    valor_esperado: limparTexto(e.valor_esperado, 120),
    mensagem: limparTexto(e.mensagem, 300) || 'Falha na validação fiscal do item.'
  };
  return saida;
}

module.exports = {
  criarErroItemFiscal,
  criarErroItensFiscais,
  descreverErroItem,
  sanitizarErroItem
};
