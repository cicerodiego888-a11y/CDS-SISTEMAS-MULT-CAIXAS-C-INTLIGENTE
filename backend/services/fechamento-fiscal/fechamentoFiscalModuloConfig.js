/**
 * Sprint 04 — Chave única ON/OFF do Fechamento Fiscal do Dia.
 * Padrão: DESATIVADO. Validação no backend (não só frontend).
 */

'use strict';

const CHAVE = 'fechamento_fiscal_do_dia';
const ATIVADO = 'ATIVADO';
const DESATIVADO = 'DESATIVADO';
const DESCRICAO = 'Permitir Fechamento Fiscal do Dia';

let cacheValor = DESATIVADO;
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
    || v === ''
  ) {
    return DESATIVADO;
  }
  return null;
}

function aplicarCache(valor) {
  cacheValor = valor === ATIVADO ? ATIVADO : DESATIVADO;
  cacheHidratado = true;
  return cacheValor;
}

function estaAtivadaSync() {
  return cacheValor === ATIVADO;
}

function montarResposta(valor) {
  const normalizado = valor === ATIVADO ? ATIVADO : DESATIVADO;
  return Object.freeze({
    chave: CHAVE,
    valor: normalizado,
    permitido: normalizado === ATIVADO
  });
}

function ler(db, callback) {
  db.get(
    'SELECT valor FROM configuracoes WHERE chave = ?',
    [CHAVE],
    (err, row) => {
      if (err) return callback(err);
      const bruto = row && row.valor != null ? row.valor : DESATIVADO;
      const valor = normalizarValor(bruto) || DESATIVADO;
      aplicarCache(valor);
      callback(null, montarResposta(valor));
    }
  );
}

function lerAsync(db) {
  return new Promise((resolve, reject) => {
    ler(db, (err, dados) => (err ? reject(err) : resolve(dados)));
  });
}

function estaAtivada(db, callback) {
  ler(db, (err, dados) => {
    if (err) return callback(err);
    callback(null, dados.permitido);
  });
}

function estaAtivadaAsync(db) {
  return new Promise((resolve, reject) => {
    estaAtivada(db, (err, ok) => (err ? reject(err) : resolve(ok)));
  });
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
      callback(null, montarResposta(valor));
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
  lerAsync,
  estaAtivada,
  estaAtivadaAsync,
  salvar,
  exigirSuperAdminAlteracao,
  _resetCacheForTests: () => {
    cacheValor = DESATIVADO;
    cacheHidratado = false;
  }
};
