/**
 * ProdutoIdentificadoresBackfill — migração idempotente produtos → identificadores.
 * @module motores/produto-identidade/services/ProdutoIdentificadoresBackfill
 */

const { criarDbHelpers, resolverDb } = require('../../miip/repositories/dbHelpers');
const ProdutoIdentificadoresService = require('./ProdutoIdentificadoresService');

class ProdutoIdentificadoresBackfill {
  /**
   * @param {Object} [deps]
   * @param {Object|null} [deps.db]
   * @param {ProdutoIdentificadoresService} [deps.service]
   */
  constructor(deps = {}) {
    this._db = deps.db != null ? deps.db : resolverDb(null);
    this._helpers = this._db ? criarDbHelpers(this._db) : null;
    this._service = deps.service
      ?? new ProdutoIdentificadoresService({ db: this._db });
  }

  /**
   * Processa todos os produtos. Seguro para rodar múltiplas vezes.
   * @returns {Promise<{ processados: number, criados: number, atualizados: number, inalterados: number, conflitos: Array, erros: Array }>}
   */
  async executar() {
    if (!this._helpers) throw new Error('Database não disponível para backfill.');
    await this._helpers.whenReady();

    const produtos = await this._helpers.all(
      `SELECT id, codigo, codigo_barras FROM produtos ORDER BY id ASC`
    );

    const stats = {
      processados: 0,
      criados: 0,
      atualizados: 0,
      inalterados: 0,
      desativados: 0,
      promovidos: 0,
      conflitos: [],
      erros: []
    };

    const acumular = (resultado, produtoId, campo) => {
      if (!resultado) return;
      if (resultado.acao === 'criado') stats.criados += 1;
      else if (resultado.acao === 'atualizado') stats.atualizados += 1;
      else if (resultado.acao === 'inalterado') stats.inalterados += 1;
      else if (resultado.acao === 'desativado') stats.desativados += 1;
      else if (resultado.acao === 'promovido') stats.promovidos += 1;
      else if (resultado.acao === 'conflito') {
        stats.conflitos.push({
          produtoId,
          campo,
          conflitoProdutoId: resultado.conflito?.produtoId,
          tipo: resultado.conflito?.tipo,
          codigo: resultado.conflito?.codigo
        });
      }
    };

    for (const p of produtos) {
      stats.processados += 1;
      try {
        const out = await this._service.espelharCodigoEBarras(p.id, {
          codigo: p.codigo,
          codigo_barras: p.codigo_barras
        }, { origem: 'migracao' });
        acumular(out.interno, p.id, 'codigo');
        acumular(out.barras, p.id, 'codigo_barras');
      } catch (err) {
        stats.erros.push({ produtoId: p.id, erro: err.message });
      }
    }

    return stats;
  }
}

module.exports = ProdutoIdentificadoresBackfill;
module.exports.ProdutoIdentificadoresBackfill = ProdutoIdentificadoresBackfill;
