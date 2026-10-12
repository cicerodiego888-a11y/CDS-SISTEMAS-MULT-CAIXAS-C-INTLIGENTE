'use strict';

/**
 * Produto decidido na Central para cada linha da NF-e (índice em parse_json.itens).
 *
 * Fonte oficial: decisão do operador gravada item a item na última sessão de revisão
 * não cancelada (central_entradas_revisao_itens). Sem produto na sessão, vale o produto
 * gravado no documento (identificação automática ou correção explícita).
 * O que a tela envia nunca é fonte da decisão.
 */

const CODIGO_DIVERGENCIA = 'PRODUTO_DIFERENTE_DA_DECISAO_CENTRAL';

const SQL_DECISOES_SESSAO = `
  SELECT i.item_index, i.produto_destino_id, i.decisao
  FROM central_entradas_revisao_itens i
  WHERE i.status = 'CONCLUIDO'
    AND i.sessao_id = (
      SELECT MAX(s.id) FROM central_entradas_revisao_sessoes s
      WHERE s.documento_id = ? AND s.status <> 'CANCELADA'
    )`;

function idProduto(valor) {
  const n = Number(valor);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/**
 * @param {Object[]} itensDocumento - parse_json.itens do documento
 * @param {Object[]} linhasSessao - linhas de SQL_DECISOES_SESSAO
 * @returns {Map<number, { produtoId: number, fonte: 'revisao'|'documento', decisao?: string }>}
 */
function montarDecisoesProduto(itensDocumento = [], linhasSessao = []) {
  const decisoes = new Map();
  (Array.isArray(itensDocumento) ? itensDocumento : []).forEach((item, indice) => {
    const produtoId = idProduto(item?.produto_id ?? item?.produtoId);
    if (produtoId) decisoes.set(indice, { produtoId, fonte: 'documento' });
  });
  (Array.isArray(linhasSessao) ? linhasSessao : []).forEach((linha) => {
    const indice = Number(linha?.item_index ?? linha?.itemIndex);
    const produtoId = idProduto(linha?.produto_destino_id ?? linha?.produtoDestinoId);
    if (!Number.isInteger(indice) || indice < 0 || !produtoId) return;
    decisoes.set(indice, { produtoId, fonte: 'revisao', decisao: linha.decisao || null });
  });
  return decisoes;
}

/**
 * Itens já reconciliados com o documento (têm central_item_indice).
 * @returns {Object[]} linhas bloqueadas; vazio quando todas respeitam a decisão
 */
function validarProdutosContraDecisao(itens = [], decisoes = new Map()) {
  const erros = [];
  (Array.isArray(itens) ? itens : []).forEach((item, posicao) => {
    const indice = Number(item?.central_item_indice);
    const decidida = decisoes.get(indice);
    if (!decidida) return;
    const enviado = idProduto(item?.produto_id ?? item?.produtoId);
    if (enviado === decidida.produtoId) return;
    erros.push({
      posicao,
      central_item_indice: indice,
      nItem: item?.nItem ?? null,
      produto_nome: item?.produto_nome || null,
      produto_id_enviado: enviado,
      produto_id_decidido: decidida.produtoId,
      fonte_decisao: decidida.fonte,
      codigo: CODIGO_DIVERGENCIA,
      justificativa: `Na Central esta linha foi associada ao produto #${decidida.produtoId}. `
        + 'Para trocar, faça a correção do produto na Central.',
      bloqueia_efetivacao: true
    });
  });
  return erros;
}

/** Versão com callback para as rotas que usam o sqlite3 diretamente. */
function carregarDecisoesProduto(db, documento, callback) {
  db.all(SQL_DECISOES_SESSAO, [Number(documento.id)], (err, rows) => {
    if (err) return callback(err);
    return callback(null, montarDecisoesProduto(documento.itens, rows || []));
  });
}

module.exports = {
  CODIGO_DIVERGENCIA,
  SQL_DECISOES_SESSAO,
  montarDecisoesProduto,
  validarProdutosContraDecisao,
  carregarDecisoesProduto
};
