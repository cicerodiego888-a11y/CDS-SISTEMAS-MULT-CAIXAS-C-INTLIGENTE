'use strict';

/**
 * MRT-22 — UI/contrato de continuidade CRT Destaxa no PDV.
 * DISPLAY → auto-ack (backend). COLETA/OPCAO → modal operador → POST /tef/continuar.
 */
(function (root) {
  const TIPOS = Object.freeze({
    DISPLAY: 'DISPLAY',
    COLETA: 'COLETA',
    OPCAO: 'OPCAO'
  });

  function normalizarAcao(acao) {
    if (!acao || typeof acao !== 'object') {
      return { tipo: null, mensagem: '', opcoes: [], reconhecida: false };
    }
    const tipo = String(acao.tipo || '').toUpperCase() || null;
    const opcoes = Array.isArray(acao.opcoes)
      ? acao.opcoes.map((o) => String(o).trim()).filter(Boolean)
      : [];
    return {
      tipo,
      mensagem: String(acao.mensagem || ''),
      opcoes,
      tipoDado: acao.tipoDado || null,
      mascara: acao.mascara || null,
      chave: acao.chave || null,
      timeout: acao.timeout || null,
      reconhecida: tipo === TIPOS.DISPLAY || tipo === TIPOS.COLETA || tipo === TIPOS.OPCAO
    };
  }

  function ehContinuidade(resultado) {
    if (!resultado || typeof resultado !== 'object') return false;
    if (resultado.requerContinuacao === true) return true;
    const codigo = String(resultado.codigo || '').toUpperCase();
    return codigo === 'DESTAXA_CICLO_CONTINUIDADE_SEM_RESPOSTA'
      || (codigo === '99' && resultado.sucesso !== true);
  }

  function validarResposta(acao, valor) {
    const a = normalizarAcao(acao);
    if (a.tipo === TIPOS.DISPLAY || !a.tipo) {
      return { ok: true, resposta: { displayAck: true } };
    }
    if (a.tipo === TIPOS.COLETA) {
      const texto = valor == null ? '' : String(valor).trim();
      if (!texto) {
        return { ok: false, codigo: 'DESTAXA_PDV_COLETA_VAZIA', mensagem: 'Informe o valor solicitado.' };
      }
      return { ok: true, resposta: { informacao: texto } };
    }
    if (a.tipo === TIPOS.OPCAO) {
      const escolhida = valor == null ? '' : String(valor).trim();
      if (!escolhida) {
        return { ok: false, codigo: 'DESTAXA_PDV_OPCAO_AUSENTE', mensagem: 'Selecione uma opção.' };
      }
      if (a.opcoes.length && a.opcoes.indexOf(escolhida) < 0) {
        return {
          ok: false,
          codigo: 'DESTAXA_PDV_OPCAO_INVALIDA',
          mensagem: 'Opção inválida para o provedor.'
        };
      }
      return { ok: true, resposta: { informacao: escolhida } };
    }
    return { ok: false, codigo: 'DESTAXA_PDV_ACAO_DESCONHECIDA', mensagem: 'Tipo de continuidade não suportado.' };
  }

  function solicitarRespostaOperador(acao) {
    const a = normalizarAcao(acao);
    return new Promise((resolve) => {
      const id = `tef-cont-${Date.now()}`;
      const $overlay = $(`
        <div id="${id}" class="modal fade" tabindex="-1" data-backdrop="static" data-keyboard="false">
          <div class="modal-dialog modal-dialog-centered">
            <div class="modal-content">
              <div class="modal-header">
                <h5 class="modal-title">TEF — Continuação</h5>
              </div>
              <div class="modal-body">
                <p class="tef-cont-msg mb-3"></p>
                <div class="tef-cont-corpo"></div>
                <div class="text-danger small tef-cont-erro" style="display:none;"></div>
              </div>
              <div class="modal-footer">
                <button type="button" class="btn btn-primary tef-cont-ok">Confirmar</button>
              </div>
            </div>
          </div>
        </div>
      `);

      $('body').append($overlay);
      $overlay.find('.tef-cont-msg').text(a.mensagem || 'Informação solicitada pelo TEF.');

      const $corpo = $overlay.find('.tef-cont-corpo');
      let leitor = () => null;

      if (a.tipo === TIPOS.OPCAO) {
        const $sel = $('<select class="form-control tef-cont-select"></select>');
        $sel.append('<option value="">Selecione...</option>');
        (a.opcoes || []).forEach((op) => {
          $sel.append($('<option></option>').attr('value', op).text(op));
        });
        $corpo.append($sel);
        leitor = () => $sel.val();
      } else {
        const $inp = $('<input type="text" class="form-control tef-cont-input" autocomplete="off" />');
        if (a.mascara) $inp.attr('placeholder', String(a.mascara));
        $corpo.append($inp);
        leitor = () => $inp.val();
        setTimeout(() => $inp.trigger('focus'), 300);
      }

      const fechar = (resultado) => {
        try {
          $overlay.modal('hide');
        } catch (_) { /* ignore */ }
        setTimeout(() => $overlay.remove(), 400);
        resolve(resultado);
      };

      $overlay.find('.tef-cont-ok').on('click', () => {
        const bruto = leitor();
        const v = validarResposta(a, bruto);
        if (!v.ok) {
          $overlay.find('.tef-cont-erro').text(v.mensagem).show();
          return;
        }
        fechar({ ok: true, resposta: v.resposta, cancelado: false });
      });

      // Sem botão cancelar financeiro — operador só confirma (evita EST/cancel comercial)
      $overlay.on('hidden.bs.modal', () => {
        // se fechou sem confirmar (ex.: PDV fechado), sinaliza ausência
      });

      $overlay.modal('show');
    });
  }

  async function postContinuar(apiUrl, token, pedido) {
    const response = await fetch(`${apiUrl}/tef/continuar`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token || ''}`
      },
      body: JSON.stringify(pedido)
    });
    const data = await response.json().catch(() => ({}));
    return { response, data };
  }

  /**
   * Loop de continuidade até conclusivo/inconclusivo.
   * Preserva transacao_id e idempotency_key; nunca chama /tef/pagar de novo.
   */
  async function conduzirContinuidade(resultadoInicial, contexto = {}) {
    let atual = resultadoInicial;
    const apiUrl = contexto.apiUrl;
    const token = contexto.token || '';
    const idempotencyKey = contexto.idempotencyKey || atual.idempotency_key || null;
    const vendaId = contexto.vendaId != null ? contexto.vendaId : null;
    const maxPassos = contexto.maxPassos || 32;
    let passos = 0;

    while (ehContinuidade(atual) && passos < maxPassos) {
      passos += 1;
      const acao = normalizarAcao(atual.acao);
      if (acao.tipo === TIPOS.DISPLAY) {
        // DISPLAY: backend já faz auto-ack quando possível; se chegou ao PDV, envia ack explícito
        const { response, data } = await postContinuar(apiUrl, token, {
          transacao_id: atual.transacao_id || atual.transacaoId,
          idempotency_key: idempotencyKey,
          venda_id: vendaId,
          resposta_continuidade: { displayAck: true },
          acao
        });
        data.idempotency_key = data.idempotency_key || idempotencyKey;
        atual = { ...data, httpStatus: response.status };
        continue;
      }

      const coleta = await solicitarRespostaOperador(acao);
      if (!coleta || coleta.ok !== true) {
        return {
          ...atual,
          sucesso: false,
          status: 'pendente',
          codigo: 'DESTAXA_PDV_SEM_RESPOSTA',
          mensagem: 'Operador não respondeu à continuidade TEF',
          requerContinuacao: true,
          inconclusivo: false,
          retryAllowed: false,
          idempotency_key: idempotencyKey
        };
      }

      const { response, data } = await postContinuar(apiUrl, token, {
        transacao_id: atual.transacao_id || atual.transacaoId,
        idempotency_key: idempotencyKey,
        venda_id: vendaId,
        resposta_continuidade: coleta.resposta,
        acao
      });
      data.idempotency_key = data.idempotency_key || idempotencyKey;
      atual = { ...data, httpStatus: response.status };
    }

    return atual;
  }

  root.PdvTefContinuidade = {
    TIPOS,
    normalizarAcao,
    ehContinuidade,
    validarResposta,
    solicitarRespostaOperador,
    conduzirContinuidade,
    postContinuar
  };
})(typeof window !== 'undefined' ? window : globalThis);
