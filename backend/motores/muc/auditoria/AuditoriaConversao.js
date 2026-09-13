/**
 * MUC RC1 — Auditoria de conversões
 * @module motores/muc/auditoria/AuditoriaConversao
 */
'use strict';

const { resultadoParaJson } = require('../dto/ResultadoConversaoDTO');

class AuditoriaConversao {
  constructor(db) {
    this.db = db;
  }

  /**
   * @param {Object} resultado - ResultadoConversaoDTO
   * @param {Object} contexto
   * @param {Function} [callback]
   */
  registrar(resultado, contexto = {}, callback) {
    const done = typeof callback === 'function' ? callback : () => {};
    if (!resultado) return done(null);

    this.db.run(
      `INSERT INTO muc_auditoria_conversao (
        produto_id, apresentacao_id, compra_item_id,
        origem, metodo, confianca, tipo_conversao, fator_conversao,
        quantidade_compra, quantidade_estoque, custo_unitario, custo_total,
        gtin, fornecedor_cnpj, codigo_fornecedor, descricao,
        usuario_id, usuario_nome, motivo, hash, payload_json,
        correlation_id, tempo_processamento_ms, regra_aplicada,
        versao_regra, versao_motor, xml_origem, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now', 'localtime'))`,
      [
        resultado.produtoId,
        resultado.apresentacaoId,
        contexto.compraItemId || null,
        resultado.origem,
        resultado.metodoInferencia,
        resultado.confianca,
        resultado.tipoConversao,
        resultado.fatorConversao,
        resultado.quantidadeCompra,
        resultado.quantidadeEstoque,
        resultado.custoUnitario,
        resultado.custoTotal,
        contexto.gtin || null,
        contexto.fornecedorCnpj || null,
        contexto.codigoFornecedor || null,
        contexto.descricao || null,
        contexto.usuarioId || null,
        contexto.usuarioNome || null,
        contexto.motivo || null,
        resultado.hashConversao || resultado.hash,
        resultadoParaJson(resultado),
        resultado.correlationId || contexto.correlationId || null,
        resultado.tempoProcessamentoMs ?? null,
        resultado.regraAplicada || null,
        resultado.versaoRegra || null,
        resultado.versaoMotor || null,
        contexto.xml || null
      ],
      done
    );
  }

  listarPorProduto(produtoId, callback) {
    this.db.all(
      `SELECT * FROM muc_auditoria_conversao
       WHERE produto_id = ?
       ORDER BY created_at DESC
       LIMIT 50`,
      [produtoId],
      callback
    );
  }
}

module.exports = { AuditoriaConversao };
