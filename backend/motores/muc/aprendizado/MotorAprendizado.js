/**
 * MUC RC1 — Aprendizado contínuo (Produto + Apresentação + Fornecedor + GTIN + Conversão)
 * Integração MIIP/MIE via muc_aprendizado
 * @module motores/muc/aprendizado/MotorAprendizado
 */
'use strict';

const { normalizarTipoApresentacao } = require('../constants/tiposApresentacao');
const { normalizarTipoConversao } = require('../constants/tiposConversao');

function digitsCnpj(v) {
  return String(v || '').replace(/\D/g, '');
}

class MotorAprendizado {
  constructor(db) {
    this.db = db;
  }

  /**
   * Registra ou incrementa aprendizado após conversão confirmada
   * @param {Object} dados
   * @param {Function} [callback]
   */
  registrar(dados = {}, callback) {
    const done = typeof callback === 'function' ? callback : () => {};
    const cnpj = digitsCnpj(dados.fornecedorCnpj);
    if (!cnpj || !dados.produtoId) return done(null);

    const gtin = dados.gtin ? String(dados.gtin).trim() : null;
    const codForn = dados.codigoFornecedor ? String(dados.codigoFornecedor).trim() : null;
    const tipo = normalizarTipoApresentacao(dados.tipoApresentacao);
    const fator = Number(dados.fatorConversao || dados.quantidade || 1);
    const tipoConv = normalizarTipoConversao(dados.tipoConversao);

    this.db.get(
      `SELECT id, ocorrencias FROM muc_aprendizado
       WHERE fornecedor_cnpj = ?
         AND produto_id = ?
         AND COALESCE(gtin, '') = COALESCE(?, '')
         AND COALESCE(codigo_fornecedor, '') = COALESCE(?, '')`,
      [cnpj, dados.produtoId, gtin, codForn],
      (findErr, existente) => {
        if (findErr) return done(findErr);

        if (existente) {
          return this.db.run(
            `UPDATE muc_aprendizado SET
               apresentacao_id = COALESCE(?, apresentacao_id),
               tipo_apresentacao = ?,
               fator_conversao = ?,
               tipo_conversao = ?,
               confianca = ?,
               ocorrencias = ocorrencias + 1,
               ultima_descricao = ?,
               updated_at = datetime('now', 'localtime')
             WHERE id = ?`,
            [
              dados.apresentacaoId || null,
              tipo,
              fator,
              tipoConv,
              Math.min(100, Number(dados.confianca || 85) + existente.ocorrencias),
              dados.descricao || null,
              existente.id
            ],
            done
          );
        }

        this.db.run(
          `INSERT INTO muc_aprendizado (
            produto_id, apresentacao_id, fornecedor_cnpj, gtin, codigo_fornecedor,
            tipo_apresentacao, fator_conversao, tipo_conversao, confianca,
            ocorrencias, ultima_descricao, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, datetime('now', 'localtime'), datetime('now', 'localtime'))`,
          [
            dados.produtoId,
            dados.apresentacaoId || null,
            cnpj,
            gtin,
            codForn,
            tipo,
            fator,
            tipoConv,
            Number(dados.confianca || 85),
            dados.descricao || null
          ],
          done
        );
      }
    );
  }

  /**
   * Busca aprendizado por GTIN ou código fornecedor (MIIP)
   * @returns {Promise<Object|null>}
   */
  buscar({ fornecedorCnpj, gtin, codigoFornecedor, produtoId }) {
    return new Promise((resolve, reject) => {
      const cnpj = digitsCnpj(fornecedorCnpj);
      if (!cnpj) return resolve(null);

      const gtinNorm = gtin ? String(gtin).trim() : null;
      const codForn = codigoFornecedor ? String(codigoFornecedor).trim() : null;

      let sql = `SELECT * FROM muc_aprendizado WHERE fornecedor_cnpj = ?`;
      const params = [cnpj];

      if (gtinNorm) {
        sql += ' AND gtin = ?';
        params.push(gtinNorm);
      } else if (codForn) {
        sql += ' AND codigo_fornecedor = ?';
        params.push(codForn);
      } else {
        return resolve(null);
      }

      if (produtoId) {
        sql += ' AND produto_id = ?';
        params.push(produtoId);
      }

      sql += ' ORDER BY ocorrencias DESC, confianca DESC LIMIT 1';

      this.db.get(sql, params, (err, row) => {
        if (err) return reject(err);
        if (!row) return resolve(null);
        resolve({
          produtoId: row.produto_id,
          apresentacaoId: row.apresentacao_id,
          tipoApresentacao: row.tipo_apresentacao,
          fatorConversao: row.fator_conversao,
          tipoConversao: row.tipo_conversao,
          confianca: row.confianca,
          ocorrencias: row.ocorrencias,
          origem: 'APRENDIZADO'
        });
      });
    });
  }
}

module.exports = { MotorAprendizado };
