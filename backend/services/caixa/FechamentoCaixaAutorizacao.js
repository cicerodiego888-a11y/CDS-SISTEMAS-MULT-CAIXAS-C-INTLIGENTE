/**
 * Autorização de fechamento com divergência — Fechamento V2.
 * Permissão oficial: fechar_caixa_com_divergencia
 */
'use strict';

const { PERMISSOES_DISPONIVEIS } = require('../../middleware/auth');
const { resumirInconsistencias } = require('./ReconciliacaoVendaCaixa');
const { arred2 } = require('../financeiro/politicaMonetaria');

const PERMISSAO_FECHAR_COM_DIVERGENCIA = 'fechar_caixa_com_divergencia';

function perfilUsuario(user) {
  return String(user && (user.perfil || user.nivel) || '').trim().toUpperCase();
}

function usuarioTemBypassAdmin(user) {
  const perfil = perfilUsuario(user);
  const role = String(user && user.role || '').toLowerCase();
  return role === 'admin' || role === 'supervisor' || ['SUPER_ADMIN', 'ADMIN'].includes(perfil);
}

function permissoesEfetivas(user, permissoesDb) {
  if (usuarioTemBypassAdmin(user)) return PERMISSOES_DISPONIVEIS.slice();
  return Array.isArray(permissoesDb) ? permissoesDb : [];
}

function usuarioPodeAutorizarDivergencia(user, permissoesDb) {
  const tokenPerms = Array.isArray(user && user.permissoes) ? user.permissoes : [];
  if (tokenPerms.length) {
    return tokenPerms.includes(PERMISSAO_FECHAR_COM_DIVERGENCIA);
  }
  const dbPerms = Array.isArray(permissoesDb) ? permissoesDb : [];
  if (dbPerms.includes(PERMISSAO_FECHAR_COM_DIVERGENCIA)) {
    return true;
  }
  if (!dbPerms.length && usuarioTemBypassAdmin(user)) {
    return permissoesEfetivas(user, dbPerms).includes(PERMISSAO_FECHAR_COM_DIVERGENCIA);
  }
  return false;
}

function avaliarDivergenciaFechamento(consolidacao, fisico) {
  const vendas = (consolidacao && consolidacao.reconciliacao && consolidacao.reconciliacao.vendas) || [];
  const rec = resumirInconsistencias(vendas);
  const diferencaFisica = fisico && fisico.diferenca != null ? arred2(fisico.diferenca) : null;
  const fisicaOk = !fisico || fisico.conferencia_ok !== false;
  const temRecon = rec.quantidade_inconsistencias > 0;
  const temFisica = fisicaOk === false;
  const valor = temRecon
    ? rec.valor_divergencia
    : arred2(Math.abs(Number(diferencaFisica || 0)));
  return {
    exige_autorizacao: temRecon || temFisica,
    tipo_divergencia: temRecon && temFisica
      ? 'FISICA_E_RECONCILIACAO'
      : (temRecon ? 'RECONCILIACAO' : (temFisica ? 'FISICA' : null)),
    quantidade_inconsistencias: rec.quantidade_inconsistencias,
    valor_divergencia: valor,
    saldo_liquido: rec.saldo_liquido,
    diferenca_fisica: diferencaFisica,
    detalhes: rec.detalhes
  };
}

function decidirAutorizacaoFechamento({ avaliacao, fecharComDivergencia, user, permissoes } = {}) {
  if (!avaliacao || !avaliacao.exige_autorizacao) {
    return { autorizado: false, autorizador: null, precisaCredencial: false };
  }
  const flag = fecharComDivergencia === true
    || fecharComDivergencia === 1
    || fecharComDivergencia === '1';
  if (!flag) {
    return {
      autorizado: false,
      autorizador: null,
      precisaCredencial: true,
      erro: montarErroAutorizacaoNecessaria(avaliacao)
    };
  }
  if (usuarioPodeAutorizarDivergencia(user, permissoes)) {
    return {
      autorizado: true,
      autorizador: user || null,
      precisaCredencial: false
    };
  }
  return {
    autorizado: false,
    autorizador: null,
    precisaCredencial: true,
    erro: montarErroAutorizacaoNecessaria(avaliacao)
  };
}

function montarErroAutorizacaoNecessaria(avaliacao) {
  const err = new Error(
    `Foi identificada uma divergência de ${Number(avaliacao.valor_divergencia || 0).toFixed(2)}. `
    + 'É necessária autorização de um administrador.'
  );
  err.codigo = 'AUTORIZACAO_ADMIN_NECESSARIA';
  err.quantidade_inconsistencias = avaliacao.quantidade_inconsistencias || 0;
  err.valor_divergencia = avaliacao.valor_divergencia || 0;
  err.saldo_liquido = avaliacao.saldo_liquido || 0;
  err.diferenca_fisica = avaliacao.diferenca_fisica;
  err.tipo_divergencia = avaliacao.tipo_divergencia;
  err.detalhes = avaliacao.detalhes || [];
  return err;
}

module.exports = {
  PERMISSAO_FECHAR_COM_DIVERGENCIA,
  usuarioTemBypassAdmin,
  permissoesEfetivas,
  usuarioPodeAutorizarDivergencia,
  avaliarDivergenciaFechamento,
  decidirAutorizacaoFechamento,
  montarErroAutorizacaoNecessaria
};
