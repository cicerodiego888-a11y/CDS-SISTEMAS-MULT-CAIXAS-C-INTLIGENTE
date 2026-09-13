/**
 * Super Usuário — controle global de validade da empresa.
 * Padrão: ATIVADO (comportamento atual, produto a produto).
 * DESATIVADO: desmarca imediatamente controlar_validade em todos os produtos.
 */
'use strict';

const CHAVE = 'empresa_controla_validade';
const ATIVADO = 'ATIVADO';
const DESATIVADO = 'DESATIVADO';
const DESCRICAO = 'Empresa controla validade de produtos (lotes/FEFO/alertas)';

let cacheValor = ATIVADO;
let cacheHidratado = false;

function ehChave(chave) {
  return String(chave || '') === CHAVE;
}

function normalizarValor(valor) {
  const v = String(valor == null ? '' : valor).trim().toUpperCase();
  if (v === ATIVADO || v === '1' || v === 'TRUE' || v === 'SIM' || v === 'ON') {
    return ATIVADO;
  }
  if (
    v === DESATIVADO
    || v === '0'
    || v === 'FALSE'
    || v === 'NAO'
    || v === 'NÃO'
    || v === 'OFF'
  ) {
    return DESATIVADO;
  }
  return null;
}

function aplicarCache(valor) {
  cacheValor = valor === DESATIVADO ? DESATIVADO : ATIVADO;
  cacheHidratado = true;
  return cacheValor;
}

function estaAtivadaSync() {
  return cacheValor === ATIVADO;
}

function montarResposta(valor, produtosDesmarcados = 0) {
  const normalizado = valor === DESATIVADO ? DESATIVADO : ATIVADO;
  return Object.freeze({
    chave: CHAVE,
    valor: normalizado,
    permitido: normalizado === ATIVADO,
    produtos_desmarcados: Number(produtosDesmarcados || 0)
  });
}

function ler(db, callback) {
  db.get(
    'SELECT valor FROM configuracoes WHERE chave = ?',
    [CHAVE],
    (err, row) => {
      if (err) return callback(err);
      const bruto = row && row.valor != null ? row.valor : ATIVADO;
      const valor = normalizarValor(bruto) || ATIVADO;
      aplicarCache(valor);
      callback(null, montarResposta(valor, 0));
    }
  );
}

function hidratar(db, callback) {
  ler(db, (err, dados) => {
    if (typeof callback === 'function') callback(err, dados);
  });
}

function estaAtivada(db, callback) {
  ler(db, (err, dados) => {
    if (err) return callback(err);
    callback(null, dados.permitido);
  });
}

function desmarcarControlarValidadeProdutos(db, callback) {
  db.run(
    `UPDATE produtos
     SET controlar_validade = 0,
         updated_at = CURRENT_TIMESTAMP
     WHERE COALESCE(controlar_validade, 0) = 1`,
    function onUpdate(err) {
      if (err) return callback(err);
      callback(null, Number(this.changes || 0));
    }
  );
}

function salvar(db, valorEntrada, callback) {
  const valor = normalizarValor(valorEntrada);
  if (valor !== ATIVADO && valor !== DESATIVADO) {
    const erro = new Error('Valor inválido. Use ATIVADO ou DESATIVADO.');
    erro.status = 400;
    return callback(erro);
  }

  db.run(
    `INSERT INTO configuracoes (chave, valor, tipo, descricao, updated_at)
     VALUES (?, ?, 'string', ?, datetime('now', 'localtime'))
     ON CONFLICT(chave) DO UPDATE SET
       valor = excluded.valor,
       tipo = excluded.tipo,
       descricao = excluded.descricao,
       updated_at = excluded.updated_at`,
    [CHAVE, valor, DESCRICAO],
    function onSave(err) {
      if (err) return callback(err);
      aplicarCache(valor);
      if (valor !== DESATIVADO) {
        return callback(null, montarResposta(valor, 0));
      }
      desmarcarControlarValidadeProdutos(db, (updErr, qtd) => {
        if (updErr) return callback(updErr);
        callback(null, montarResposta(valor, qtd));
      });
    }
  );
}

function exigirSuperAdminAlteracao(req, res, next) {
  const perfilLogado = String(req.user?.perfil || '').toUpperCase();
  if (perfilLogado !== 'SUPER_ADMIN') {
    return res.status(403).json({
      error: 'Apenas SUPER USUÁRIO pode alterar esta configuração.',
      erro: 'Apenas SUPER USUÁRIO pode alterar esta configuração.'
    });
  }
  return next();
}

function resolverFlagControlarValidade(db, solicitado, callback) {
  estaAtivada(db, (err, permitido) => {
    if (err) return callback(err);
    if (!permitido) return callback(null, 0);
    callback(null, solicitado ? 1 : 0);
  });
}

module.exports = {
  CHAVE,
  ATIVADO,
  DESATIVADO,
  DESCRICAO,
  ehChave,
  normalizarValor,
  estaAtivadaSync,
  cacheHidratado: () => cacheHidratado,
  montarResposta,
  ler,
  hidratar,
  estaAtivada,
  salvar,
  desmarcarControlarValidadeProdutos,
  resolverFlagControlarValidade,
  exigirSuperAdminAlteracao,
  _resetCacheForTests: () => {
    cacheValor = ATIVADO;
    cacheHidratado = false;
  }
};
