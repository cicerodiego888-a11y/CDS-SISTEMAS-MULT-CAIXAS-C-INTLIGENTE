/**
 * Conferência física × retirada no fechamento — Fechamento V2.
 */
'use strict';

const { arred2, quaseIgual, subtrair, TOLERANCIA } = require('../financeiro/politicaMonetaria');

function usuarioPodeFecharComDivergencia(user, senhaAdminValidada) {
  const perfil = String(user && user.perfil || '').toUpperCase();
  const role = String(user && user.role || '').toLowerCase();
  if (perfil === 'SUPER_ADMIN' || perfil === 'ADMIN' || perfil === 'ADMINISTRADOR') return true;
  if (role === 'admin' || role === 'supervisor') return true;
  return senhaAdminValidada === true;
}

function calcularConferenciaFisica({
  saldoInicial,
  recebimentosDinheiro,
  suprimentos,
  sangriasOperacionais,
  dinheiroConferido,
  retiradaFechamento,
  modoRetirada
} = {}) {
  const esperado = arred2(
    Number(saldoInicial || 0)
    + Number(recebimentosDinheiro || 0)
    + Number(suprimentos || 0)
    - Number(sangriasOperacionais || 0)
  );
  const conferido = dinheiroConferido == null ? null : arred2(dinheiroConferido);
  const diferenca = conferido == null ? null : arred2(conferido - esperado);

  let retirada = arred2(retiradaFechamento || 0);
  const modo = String(modoRetirada || '').toLowerCase();
  if (modo === 'total' && conferido != null) {
    retirada = conferido;
  } else if (modo === 'nenhuma' || modo === 'nao' || modo === 'não') {
    retirada = 0;
  }

  return {
    saldo_inicial: arred2(saldoInicial),
    recebimentos_dinheiro: arred2(recebimentosDinheiro),
    suprimentos: arred2(suprimentos),
    sangrias_operacionais: arred2(sangriasOperacionais),
    dinheiro_esperado: esperado,
    dinheiro_conferido: conferido,
    diferenca,
    conferencia_ok: conferido == null ? null : quaseIgual(conferido, esperado),
    retirada_fechamento: retirada,
    saldo_final: conferido == null ? null : arred2(subtrair(conferido, retirada)),
    relatorio: [
      { label: 'Abertura', valor: arred2(saldoInicial) },
      { label: '+ Vendas dinheiro', valor: arred2(recebimentosDinheiro) },
      { label: '+ Suprimentos', valor: arred2(suprimentos) },
      { label: '- Sangrias', valor: arred2(sangriasOperacionais) },
      { label: 'Esperado', valor: esperado },
      { label: 'Conferido', valor: conferido },
      { label: 'Diferença', valor: diferenca },
      { label: 'Retirada fechamento', valor: retirada },
      { label: 'Saldo final', valor: conferido == null ? null : arred2(subtrair(conferido, retirada)) }
    ]
  };
}

function validarConferenciaERetirada(fisico, { fecharComDivergencia, justificativa, user, senhaAdminValidada } = {}) {
  if (fisico.dinheiro_conferido == null) {
    return { ok: false, erro: 'Informe o dinheiro contado na gaveta.' };
  }
  if (fisico.retirada_fechamento < -1e-9) {
    return { ok: false, erro: 'Retirada no fechamento não pode ser negativa.' };
  }
  if (fisico.retirada_fechamento > fisico.dinheiro_conferido + TOLERANCIA) {
    return { ok: false, erro: 'Retirada no fechamento não pode ser maior que o dinheiro conferido.' };
  }
  if (fisico.conferencia_ok === false) {
    if (!fecharComDivergencia) {
      return {
        ok: false,
        bloqueio: 'CONFERENCIA_FISICA',
        erro: `Diferença de caixa: esperado ${fisico.dinheiro_esperado.toFixed(2)}, contado ${fisico.dinheiro_conferido.toFixed(2)}, diferença ${fisico.diferenca.toFixed(2)}.`,
        diferenca: fisico.diferenca
      };
    }
    if (!String(justificativa || '').trim()) {
      return { ok: false, erro: 'Informe a justificativa para fechar com divergência.' };
    }
    if (!usuarioPodeFecharComDivergencia(user, senhaAdminValidada)) {
      return {
        ok: false,
        bloqueio: 'CONFERENCIA_FISICA',
        erro: 'Somente usuário autorizado/admin pode fechar com divergência, mediante justificativa.'
      };
    }
  }
  return { ok: true };
}

module.exports = {
  usuarioPodeFecharComDivergencia,
  calcularConferenciaFisica,
  validarConferenciaERetirada
};
