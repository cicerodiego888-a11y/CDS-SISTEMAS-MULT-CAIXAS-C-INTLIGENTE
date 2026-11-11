'use strict';

const cryptoService = require('../crypto/cryptoService');
const {
  extrairCnpjCredenciadoraDeParametros,
  normalizarCnpjCredenciadoraDestaxa
} = require('../tef/destaxa/destaxaProtocolo');

/**
 * TEF-DESTAXA-51.54 — resolve CNPJ fiscal sem inventar.
 * Ordem: top-level cnpj_credenciadora / cnpj_instituicao → parametros.transacao_rede_cnpj.
 * Nunca lê comprovante nem CNPJ Destaxa textual.
 */
function resolverCnpjCredenciadoraDoPayload(retornoTef) {
  if (!retornoTef || typeof retornoTef !== 'object') return null;

  const direto = normalizarCnpjCredenciadoraDestaxa(
    retornoTef.cnpj_credenciadora || retornoTef.cnpj_instituicao || null
  );
  if (direto) return direto;

  const parametros = retornoTef.parametros
    || (retornoTef.payloadRetorno && retornoTef.payloadRetorno.parametros)
    || null;
  return extrairCnpjCredenciadoraDeParametros(parametros || {});
}

function hidratarMetadadosPagamentoTef(pagamentos) {
  return (pagamentos || []).map((pagamento) => {
    let retornoTef = null;

    if (pagamento.tef_payload_retorno) {
      retornoTef = cryptoService.descriptografarObjeto(pagamento.tef_payload_retorno);
    }

    const cnpjCredenciadora = resolverCnpjCredenciadoraDoPayload(retornoTef);
    const bandeira = pagamento.tef_bandeira
      || retornoTef?.bandeira
      || retornoTef?.parametros?.transacao_administradora
      || null;
    const adquirente = pagamento.tef_adquirente
      || retornoTef?.adquirente
      || retornoTef?.parametros?.transacao_rede
      || null;

    const tef = pagamento.tef_transacao_id != null
      ? {
        transacao_id: String(pagamento.tef_transacao_id),
        status: pagamento.tef_status || null,
        venda_id: pagamento.tef_venda_id != null ? Number(pagamento.tef_venda_id) : null,
        provedor: pagamento.tef_provedor || null,
        nsu: pagamento.tef_nsu || pagamento.nsu || null,
        autorizacao: pagamento.tef_autorizacao || pagamento.autorizacao || null,
        bandeira: bandeira || null,
        adquirente: adquirente || null,
        cnpj_credenciadora: cnpjCredenciadora,
        cnpj_instituicao: normalizarCnpjCredenciadoraDestaxa(retornoTef?.cnpj_instituicao) || null
      }
      : null;

    return {
      ...pagamento,
      tef: tef || undefined,
      cnpj_credenciadora: tef?.cnpj_credenciadora || null
    };
  });
}

module.exports = {
  hidratarMetadadosPagamentoTef,
  resolverCnpjCredenciadoraDoPayload
};
