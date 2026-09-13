/**
 * Feature flag MIP — Sprint 02.
 * Default OFF: nenhum consumidor deve ativar até validação.
 * @module motores/produto-identidade/config/produtoIdentidadeFlags
 */

const FLAG_CHAVE = 'produto_identidade_enabled';

/** Estado em memória (default OFF). */
let _enabled = false;

/**
 * @returns {boolean}
 */
function isProdutoIdentidadeEnabled() {
  if (process.env.PRODUTO_IDENTIDADE_ENABLED === '1'
    || process.env.PRODUTO_IDENTIDADE_ENABLED === 'true') {
    return true;
  }
  if (process.env.PRODUTO_IDENTIDADE_ENABLED === '0'
    || process.env.PRODUTO_IDENTIDADE_ENABLED === 'false') {
    return false;
  }
  return _enabled === true;
}

/**
 * Apenas para testes / admin explícito. Não ligar em produção sem homologação.
 * @param {boolean} valor
 */
function setProdutoIdentidadeEnabled(valor) {
  _enabled = valor === true;
}

function getFlagChave() {
  return FLAG_CHAVE;
}

/**
 * Tenta hidratar da tabela configuracoes (opcional; falha silenciosa).
 * @param {Object} db
 * @returns {Promise<boolean>}
 */
function hidratarFlagDoBanco(db) {
  return new Promise((resolve) => {
    if (!db || typeof db.get !== 'function') {
      resolve(isProdutoIdentidadeEnabled());
      return;
    }
    db.get(
      'SELECT valor FROM configuracoes WHERE chave = ? LIMIT 1',
      [FLAG_CHAVE],
      (err, row) => {
        if (!err && row) {
          const v = String(row.valor || '').toLowerCase();
          _enabled = v === '1' || v === 'true' || v === 'sim';
        }
        resolve(isProdutoIdentidadeEnabled());
      }
    );
  });
}

module.exports = {
  FLAG_CHAVE,
  isProdutoIdentidadeEnabled,
  setProdutoIdentidadeEnabled,
  getFlagChave,
  hidratarFlagDoBanco
};
