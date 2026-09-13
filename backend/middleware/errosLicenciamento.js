/**
 * Respostas padronizadas de licenciamento / recurso — Hotfix RC1.
 * Não altera regras de negócio; apenas contrato HTTP de segurança.
 */

'use strict';

const MENSAGENS_MODULO = {
  nfe: 'O módulo NF-e não está habilitado para esta empresa.',
  nfce: 'O módulo NFC-e não está habilitado para esta empresa.',
  fiscal: 'Módulo Fiscal não contratado.',
  faturamento: 'O módulo Expedição não está habilitado para esta empresa.',
  expedicao: 'O módulo Expedição não está habilitado para esta empresa.',
  pedidos: 'O módulo Pedidos não está habilitado para esta empresa.',
  vendasEntrega: 'O módulo Vendas para Entrega não está habilitado para esta empresa.',
  multiCaixa: 'O módulo Multi-Caixa não está habilitado para esta empresa.',
  pdv: 'O módulo PDV não está habilitado para esta empresa.',
  historicoVendas: 'O módulo Histórico de Vendas não está habilitado para esta empresa.',
  compraFacil: 'O módulo Compra Fácil não está habilitado para esta empresa.',
  marketplace: 'O módulo Marketplace não está habilitado para esta empresa.',
  crm: 'O módulo CRM não está habilitado para esta empresa.'
};

function mensagemModulo(nomeRecurso) {
  return MENSAGENS_MODULO[nomeRecurso]
    || `O módulo ${nomeRecurso} não está habilitado para esta empresa.`;
}

/**
 * HTTP 403 — recurso de implantação / módulo desabilitado
 */
function responderModuloNaoLicenciado(res, nomeRecurso, mensagemExtra = null) {
  return res.status(403).json({
    erro: 'MODULO_NAO_LICENCIADO',
    mensagem: mensagemExtra || mensagemModulo(nomeRecurso),
    modulo: nomeRecurso || null
  });
}

/**
 * HTTP 403 — licença comercial inválida / vencida / ausente
 */
function responderLicencaInvalida(res, codigo, mensagem, extras = {}) {
  return res.status(403).json({
    erro: codigo || 'LICENCA_INVALIDA',
    mensagem: mensagem || 'Sistema não ativado.',
    ...extras
  });
}

module.exports = {
  MENSAGENS_MODULO,
  mensagemModulo,
  responderModuloNaoLicenciado,
  responderLicencaInvalida
};
