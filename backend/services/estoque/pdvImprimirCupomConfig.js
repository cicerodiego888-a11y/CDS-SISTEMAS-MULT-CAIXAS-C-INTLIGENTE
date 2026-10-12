/**
 * Impressão automática de cupom no PDV (fiscal e não fiscal).
 * Padrão: ATIVADO (comportamento atual).
 * DESATIVADO: a venda segue; reimpressão manual continua disponível.
 */
'use strict';

const CHAVE = 'pdv_imprimir_cupom';
const CHAVE_LEGADO = 'imprimir_cupom';
const ATIVADO = 'ATIVADO';
const DESATIVADO = 'DESATIVADO';
const DESCRICAO =
  'Imprimir cupom automaticamente ao finalizar a venda no PDV';

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

function montarResposta(valor) {
  const normalizado = valor === DESATIVADO ? DESATIVADO : ATIVADO;
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
      if (row && row.valor != null && String(row.valor).trim() !== '') {
        const valor = normalizarValor(row.valor) || ATIVADO;
        aplicarCache(valor);
        return callback(null, montarResposta(valor));
      }
      db.get(
        'SELECT valor FROM configuracoes WHERE chave = ?',
        [CHAVE_LEGADO],
        (errLegado, legado) => {
          if (errLegado) return callback(errLegado);
          const valor = normalizarValor(legado && legado.valor) || ATIVADO;
          aplicarCache(valor);
          callback(null, montarResposta(valor));
        }
      );
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
      db.run(
        `INSERT INTO configuracoes (chave, valor, tipo, descricao, updated_at)
         VALUES (?, ?, 'boolean', 'Imprimir cupom fiscal', datetime('now', 'localtime'))
         ON CONFLICT(chave) DO UPDATE SET
           valor = excluded.valor,
           updated_at = excluded.updated_at`,
        [CHAVE_LEGADO, valor === ATIVADO ? 'true' : 'false'],
        () => callback(null, montarResposta(valor))
      );
    }
  );
}

function exigirSuperAdminAlteracao(req, res, next) {
  if (!req || !req.user) {
    return res.status(401).json({
      error: 'Usuário não autenticado.',
      erro: 'Usuário não autenticado.'
    });
  }

  const perfilLogado = String(req.user?.perfil || req.user?.nivel || '').toUpperCase();
  const roleLogado = String(req.user?.role || '').toLowerCase();
  const permite = ['SUPER_ADMIN', 'ADMIN', 'OPERADOR'].includes(perfilLogado)
    || ['admin', 'operador'].includes(roleLogado);

  if (!permite) {
    return res.status(403).json({
      error: 'Apenas SUPER ADMIN, ADMIN ou OPERADOR podem alterar esta configuração.',
      erro: 'Apenas SUPER ADMIN, ADMIN ou OPERADOR podem alterar esta configuração.'
    });
  }

  return next();
}

const PERFIS_OPERACAO_PDV = ['SUPER_ADMIN', 'ADMIN', 'SUPERVISOR', 'OPERADOR', 'CAIXA'];
const ROLES_OPERACAO_PDV = ['admin', 'supervisor', 'operador'];
const PERMISSOES_OPERACAO_PDV = ['pdv', 'caixa'];

/** Alternar Cupom ON/OFF: qualquer usuário autenticado com acesso operacional ao PDV. */
function exigirAcessoOperacionalPdv(req, res, next) {
  if (!req || !req.user) {
    return res.status(401).json({
      error: 'Usuário não autenticado.',
      erro: 'Usuário não autenticado.'
    });
  }

  const perfilLogado = String(req.user.perfil || req.user.nivel || '').toUpperCase();
  const roleLogado = String(req.user.role || '').toLowerCase();
  const permissoes = Array.isArray(req.user.permissoes)
    ? req.user.permissoes.map((p) => String(p || '').toLowerCase())
    : [];
  const permite = PERFIS_OPERACAO_PDV.includes(perfilLogado)
    || ROLES_OPERACAO_PDV.includes(roleLogado)
    || permissoes.some((p) => PERMISSOES_OPERACAO_PDV.includes(p));

  if (!permite) {
    return res.status(403).json({
      error: 'Usuário sem acesso operacional ao PDV.',
      erro: 'Usuário sem acesso operacional ao PDV.'
    });
  }

  return next();
}

module.exports = {
  CHAVE,
  CHAVE_LEGADO,
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
  exigirSuperAdminAlteracao,
  exigirAcessoOperacionalPdv,
  _resetCacheForTests: () => {
    cacheValor = ATIVADO;
    cacheHidratado = false;
  }
};
