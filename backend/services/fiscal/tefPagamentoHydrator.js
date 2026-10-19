'use strict';

const cryptoService = require('../crypto/cryptoService');

function hidratarMetadadosPagamentoTef(pagamentos) {
  return (pagamentos || []).map((pagamento) => {
    let retornoTef = null;
    let erroPayload = null;

    if (pagamento.tef_payload_retorno) {
      try {
        retornoTef = cryptoService.descriptografarObjeto(pagamento.tef_payload_retorno);
      } catch (error) {
        erroPayload = error.message;
        console.error(
          `Não foi possível recuperar o payload TEF ${pagamento.tef_transacao_id}:`,
          error.message
        );
      }
    }

    const tef = pagamento.tef_transacao_id != null
      ? {
        transacao_id: String(pagamento.tef_transacao_id),
        status: pagamento.tef_status || null,
        venda_id: pagamento.tef_venda_id != null ? Number(pagamento.tef_venda_id) : null,
        provedor: pagamento.tef_provedor || null,
        nsu: pagamento.tef_nsu || pagamento.nsu || null,
        autorizacao: pagamento.tef_autorizacao || pagamento.autorizacao || null,
        bandeira: pagamento.tef_bandeira || null,
        adquirente: pagamento.tef_adquirente || null,
        cnpj_credenciadora: retornoTef?.cnpj_credenciadora || null,
        cnpj_instituicao: retornoTef?.cnpj_instituicao || null
      }
      : null;

    return {
      ...pagamento,
      tef: tef || undefined,
      ...(erroPayload ? { tef_payload_error: erroPayload } : {}),
      cnpj_credenciadora: tef?.cnpj_credenciadora || null
    };
  });
}

module.exports = { hidratarMetadadosPagamentoTef };
