'use strict';

/**
 * Permissões corporativas — RC5.0 Integração Equipamentos
 */

const MODULOS = Object.freeze({
  PDV: 'PDV',
  COMPRAS: 'COMPRAS',
  FISCAL: 'FISCAL',
  TEF: 'TEF',
  CENTRAL_INTELIGENTE: 'CENTRAL_INTELIGENTE',
  ADMIN: 'ADMIN'
});

const ACOES = Object.freeze({
  CONSULTAR: 'consultar',
  SINCRONIZAR: 'sincronizar',
  DIAGNOSTICAR: 'diagnosticar',
  RECONECTAR: 'reconectar',
  DESCOBRIR: 'descobrir',
  CONFIGURAR: 'configurar',
  EVENTOS: 'eventos',
  CONTROLE_TOTAL: '*'
});

/** Matriz oficial módulo → ações permitidas */
const MATRIZ = Object.freeze({
  [MODULOS.PDV]: [ACOES.CONSULTAR, ACOES.RECONECTAR, ACOES.EVENTOS],
  [MODULOS.COMPRAS]: [ACOES.CONSULTAR, ACOES.SINCRONIZAR, ACOES.EVENTOS],
  [MODULOS.FISCAL]: [ACOES.CONSULTAR, ACOES.EVENTOS],
  [MODULOS.TEF]: [ACOES.CONSULTAR, ACOES.DESCOBRIR, ACOES.EVENTOS],
  [MODULOS.CENTRAL_INTELIGENTE]: [ACOES.CONSULTAR, ACOES.EVENTOS],
  [MODULOS.ADMIN]: [ACOES.CONTROLE_TOTAL, ACOES.DIAGNOSTICAR, ACOES.CONFIGURAR, ACOES.SINCRONIZAR, ACOES.DESCOBRIR]
});

/**
 * @param {string} modulo
 * @param {string} acao
 * @param {Object} [usuario]
 * @returns {{ permitido: boolean, motivo?: string }}
 */
function verificarPermissao(modulo, acao, usuario = {}) {
  const mod = String(modulo || '').toUpperCase();
  const act = String(acao || '').toLowerCase();

  if (usuario.perfil === 'SUPER_ADMIN' || usuario.role === 'admin' || usuario.isAdmin === true) {
    return { permitido: true, motivo: 'admin' };
  }

  // Permissão legada do ERP — Centro de Configurações / Admin equipamentos
  if (Array.isArray(usuario.permissoes) && usuario.permissoes.includes('configuracoes')) {
    return { permitido: true, motivo: 'configuracoes' };
  }

  const permitidas = MATRIZ[mod];
  if (!permitidas) {
    return { permitido: false, motivo: `Módulo desconhecido: ${mod}` };
  }
  if (permitidas.includes(ACOES.CONTROLE_TOTAL) || permitidas.includes(act)) {
    return { permitido: true };
  }
  return { permitido: false, motivo: `Módulo ${mod} sem permissão para '${act}'` };
}

function exigirPermissao(modulo, acao, usuario = {}) {
  const r = verificarPermissao(modulo, acao, usuario);
  if (!r.permitido) {
    const err = new Error(r.motivo || 'Permissão negada');
    err.statusCode = 403;
    err.codigo = 'EQUIP_INTEGRACAO_PERMISSAO';
    throw err;
  }
  return r;
}

module.exports = {
  MODULOS,
  ACOES,
  MATRIZ,
  verificarPermissao,
  exigirPermissao
};
