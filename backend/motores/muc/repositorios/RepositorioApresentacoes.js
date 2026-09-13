/**
 * MUC RC1 — Repositório de apresentações (ProdutoApresentacao)
 * Tabela física: produto_embalagens
 * @module motores/muc/repositorios/RepositorioApresentacoes
 */
'use strict';

const { parseApresentacaoRow, parseListaApresentacoes } = require('../core/ParserApresentacoes');
const { inferirTipoConversao } = require('../constants/tiposConversao');
const { normalizarTipoApresentacao } = require('../constants/tiposApresentacao');

class RepositorioApresentacoes {
  constructor(db) {
    this.db = db;
  }

  listarPorProduto(produtoId, callback) {
    this.db.all(
      `SELECT * FROM produto_embalagens
       WHERE produto_id = ?
       ORDER BY principal DESC, compra DESC, id ASC`,
      [produtoId],
      (err, rows) => {
        if (err) return callback(err);
        callback(null, parseListaApresentacoes(rows));
      }
    );
  }

  buscarPorId(apresentacaoId, callback) {
    this.db.get(
      `SELECT * FROM produto_embalagens WHERE id = ?`,
      [apresentacaoId],
      (err, row) => {
        if (err) return callback(err);
        callback(null, parseApresentacaoRow(row));
      }
    );
  }

  resolverPorIdentificador(produtoId, { gtin, codigo_fornecedor, fornecedor_cnpj }, callback) {
    const cnpj = fornecedor_cnpj ? String(fornecedor_cnpj).replace(/\D/g, '') : null;
    const gtinNorm = gtin ? String(gtin).trim() : null;
    const codForn = codigo_fornecedor ? String(codigo_fornecedor).trim() : null;

    const fallback = () => {
      this.listarPorProduto(produtoId, (listErr, lista) => {
        if (listErr) return callback(listErr);
        const ativas = (lista || []).filter((a) => a.ativa);
        callback(null,
          ativas.find((a) => a.principal && a.compra)
          || ativas.find((a) => a.compra)
          || ativas[0]
          || null
        );
      });
    };

    if (gtinNorm) {
      this.db.get(
        `SELECT * FROM produto_embalagens
         WHERE produto_id = ? AND ativa = 1 AND gtin = ? LIMIT 1`,
        [produtoId, gtinNorm],
        (err, row) => {
          if (err) return callback(err);
          if (row) return callback(null, parseApresentacaoRow(row));
          buscarCodigoFornecedor.call(this);
        }
      );
      return;
    }

    buscarCodigoFornecedor.call(this);

    function buscarCodigoFornecedor() {
      if (!codForn) return fallback();

      const params = [produtoId, codForn];
      let sql = `SELECT * FROM produto_embalagens
                 WHERE produto_id = ? AND ativa = 1 AND codigo_fornecedor = ?`;
      if (cnpj) {
        sql += ' AND (fornecedor_cnpj IS NULL OR fornecedor_cnpj = ? OR fornecedor_cnpj = \'\')';
        params.push(cnpj);
      }
      sql += ' ORDER BY principal DESC LIMIT 1';

      this.db.get(sql, params, (err, row) => {
        if (err) return callback(err);
        if (row) return callback(null, parseApresentacaoRow(row));
        fallback();
      });
    }
  }

  /** Converte apresentação DTO → row para INSERT/UPDATE */
  normalizarInput(ap, unidadeProduto = 'un', usuario = null) {
    const tipo = normalizarTipoApresentacao(ap.tipo);
    return {
      tipo,
      descricao: ap.descricao || null,
      quantidade: Number(ap.quantidade || 1),
      unidade: String(ap.unidade || unidadeProduto).toLowerCase(),
      gtin: ap.gtin || null,
      codigo_fornecedor: ap.codigo_fornecedor || ap.codigoFornecedor || null,
      codigo_interno_fornecedor: ap.codigo_interno_fornecedor || ap.codigoInternoFornecedor || null,
      fornecedor_cnpj: ap.fornecedor_cnpj || ap.fornecedorCnpj || null,
      fornecedor_nome: ap.fornecedor_nome || ap.fornecedorNome || null,
      fornecedor_descricao: ap.fornecedor_descricao || ap.fornecedorDescricao || null,
      valor_compra: Number(ap.valor_compra ?? ap.valorCompra ?? 0),
      preco_venda: Number(ap.preco_venda ?? ap.precoVenda ?? 0),
      tipo_conversao: ap.tipo_conversao || ap.tipoConversao
        || inferirTipoConversao(tipo, ap.unidade || unidadeProduto),
      principal: Number(ap.principal || 0) === 1 ? 1 : 0,
      compra: Number(ap.compra ?? 1) === 1 ? 1 : 0,
      venda: Number(ap.venda ?? 1) === 1 ? 1 : 0,
      estoque: Number(ap.estoque ?? 1) === 1 ? 1 : 0,
      ativa: Number(ap.ativa ?? 1) === 1 ? 1 : 0,
      vigencia_inicio: ap.vigencia_inicio || ap.vigenciaInicio || null,
      vigencia_fim: ap.vigencia_fim || ap.vigenciaFim || null,
      origem: ap.origem || 'CADASTRO',
      observacao: ap.observacao || null,
      motivo_alteracao: ap.motivo_alteracao || ap.motivoAlteracao || null,
      usuario_alteracao: usuario?.id || null
    };
  }
}

module.exports = { RepositorioApresentacoes };
