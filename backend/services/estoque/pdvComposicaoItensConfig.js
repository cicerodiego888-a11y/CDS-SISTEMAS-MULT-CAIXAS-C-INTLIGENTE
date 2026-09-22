/**
 * Configuração administrativa — composição de itens no carrinho do PDV.
 * Valores: UNIFICAR | SEPARAR | AUTOMATICO. Padrão: UNIFICAR.
 */
'use strict';

const CHAVE = 'pdv_composicao_itens';
const UNIFICAR = 'UNIFICAR';
const SEPARAR = 'SEPARAR';
const AUTOMATICO = 'AUTOMATICO';
const VALORES = Object.freeze([UNIFICAR, SEPARAR, AUTOMATICO]);
const DESCRICAO =
  'Composição de itens no carrinho do PDV: UNIFICAR, SEPARAR ou AUTOMATICO';

let cacheValor = UNIFICAR;
let cacheHidratado = false;

function ehChave(chave) {
  return String(chave || '') === CHAVE;
}

function normalizarValor(valor) {
  const v = String(valor == null ? '' : valor).trim().toUpperCase();
  if (v === UNIFICAR || v === 'UNIFICADO' || v === 'AGRUPAR' || v === '1') {
    return UNIFICAR;
  }
  if (v === SEPARAR || v === 'SEPARADO' || v === 'SPLIT' || v === '2') {
    return SEPARAR;
  }
  if (v === AUTOMATICO || v === 'AUTO' || v === '3') {
    return AUTOMATICO;
  }
  if (v === '' || v === 'NULL' || v === 'UNDEFINED') {
    return UNIFICAR;
  }
  return null;
}

function aplicarCache(valor) {
  const normalizado = normalizarValor(valor) || UNIFICAR;
  cacheValor = normalizado;
  cacheHidratado = true;
  return cacheValor;
}

function modoAtualSync() {
  return cacheValor === SEPARAR || cacheValor === AUTOMATICO ? cacheValor : UNIFICAR;
}

function montarResposta(valor) {
  const normalizado = normalizarValor(valor) || UNIFICAR;
  return Object.freeze({
    chave: CHAVE,
    valor: normalizado,
    modo: normalizado
  });
}

function ler(db, callback) {
  db.get(
    'SELECT valor FROM configuracoes WHERE chave = ?',
    [CHAVE],
    (err, row) => {
      if (err) return callback(err);
      const bruto = row && row.valor != null ? row.valor : UNIFICAR;
      const valor = normalizarValor(bruto) || UNIFICAR;
      aplicarCache(valor);
      callback(null, montarResposta(valor));
    }
  );
}

function hidratar(db, callback) {
  ler(db, (err, dados) => {
    if (typeof callback === 'function') callback(err, dados);
  });
}

function obterModo(db, callback) {
  ler(db, (err, dados) => {
    if (err) return callback(err);
    callback(null, dados.modo);
  });
}

function salvar(db, valorEntrada, callback) {
  const valor = normalizarValor(valorEntrada);
  if (!valor || !VALORES.includes(valor)) {
    const erro = new Error('Valor inválido. Use UNIFICAR, SEPARAR ou AUTOMATICO.');
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
  UNIFICAR,
  SEPARAR,
  AUTOMATICO,
  VALORES,
  DESCRICAO,
  ehChave,
  normalizarValor,
  modoAtualSync,
  cacheHidratado: () => cacheHidratado,
  montarResposta,
  ler,
  hidratar,
  obterModo,
  salvar,
  exigirSuperAdminAlteracao,
  _resetCacheForTests: () => {
    cacheValor = UNIFICAR;
    cacheHidratado = false;
  }
};
