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

  /** COLETA no PinPad (cartão/senha) — ack vazio; não digitar PAN no PDV (51.05 / MRT-50.74). */
  function ehColetaPinPad(acao) {
    const a = normalizarAcao(acao);
    const chave = String(a.chave || '').toLowerCase();
    if (/cartao|senha|pin|track|emv|chip|aproxim|transacao_cartao/.test(chave)) return true;
    const msg = String(a.mensagem || '').toLowerCase();
    return /aproxime|insira|passe o cart|aguarde a senha|digite a senha|pin-pad|pinpad/.test(msg);
  }

  function validarResposta(acao, valor) {
    const a = normalizarAcao(acao);
    if (a.tipo === TIPOS.DISPLAY || !a.tipo) {
      return { ok: true, resposta: { displayAck: true } };
    }
    if (a.tipo === TIPOS.COLETA) {
      if (ehColetaPinPad(a)) {
        const texto = valor == null ? '' : String(valor);
        return { ok: true, resposta: { informacao: texto }, pinpadAck: true };
      }
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

  function ambienteSemUi() {
    try {
      return typeof document === 'undefined'
        || typeof $ === 'undefined'
        || typeof $.fn === 'undefined';
    } catch (_) {
      return true;
    }
  }

  function solicitarRespostaOperador(acao) {
    const a = normalizarAcao(acao);
    // MRT-38 — sem TTY/UI: falha explícita (não descartar coleta em silêncio)
    if (ambienteSemUi()) {
      return Promise.resolve({
        ok: false,
        cancelado: false,
        codigo: 'DESTAXA_PDV_SEM_TTY',
        mensagem: 'PDV sem UI/TTY — OPCAO/COLETA exige operador; continuidade não pode seguir oculta',
        retryAllowed: false
      });
    }
    return new Promise((resolve) => {
      const id = `tef-cont-${Date.now()}`;
      let submetido = false;
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

      let resolvido = false;
      const concluir = (resultado) => {
        if (resolvido) return;
        resolvido = true;
        resolve(resultado);
      };
      const fechar = (resultado) => {
        try {
          $overlay.modal('hide');
        } catch (_) { /* ignore */ }
        setTimeout(() => $overlay.remove(), 400);
        concluir(resultado);
      };

      $overlay.find('.tef-cont-ok').on('click', () => {
        if (submetido) return;
        const bruto = leitor();
        const v = validarResposta(a, bruto);
        if (!v.ok) {
          $overlay.find('.tef-cont-erro').text(v.mensagem).show();
          return;
        }
        submetido = true;
        fechar({ ok: true, resposta: v.resposta, cancelado: false });
      });

      // Sem botão cancelar financeiro — operador só confirma (evita EST/cancel comercial)
      $overlay.on('hidden.bs.modal', () => {
        if (!submetido) {
          concluir({
            ok: false,
            cancelado: true,
            codigo: 'DESTAXA_PDV_SEM_OPERADOR',
            mensagem: 'Operador fechou a continuidade sem responder',
            retryAllowed: false
          });
        }
      });

      // Timeout Destaxa se declarado; senão teto PDV 90s (< 120s V$Pague) — 51.05
      const timeoutDeclarado = Number(a.timeout);
      const timeoutSeg = (Number.isFinite(timeoutDeclarado) && timeoutDeclarado > 0)
        ? timeoutDeclarado
        : 90;
      setTimeout(() => {
        if (submetido) return;
        submetido = true;
        fechar({
          ok: false,
          cancelado: false,
          codigo: 'DESTAXA_CONTINUIDADE_TIMEOUT',
          mensagem: `Timeout de coleta (${timeoutSeg}s) no PDV — continuidade interrompida; UNKNOWN; sem retry`,
          retryAllowed: false
        });
      }, timeoutSeg * 1000);

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
    // MRT-40 — usa API exportada (permite stub de postContinuar/solicitarRespostaOperador em testes)
    const api = () => root.PdvTefContinuidade || {};
    const postFn = (...args) => (api().postContinuar || postContinuar)(...args);
    const solicitarFn = (...args) => (api().solicitarRespostaOperador || solicitarRespostaOperador)(...args);

    if (ambienteSemUi() && contexto.permitirHeadless !== true) {
      return {
        ...atual,
        sucesso: false,
        status: 'pendente',
        codigo: 'DESTAXA_PDV_SEM_TTY',
        mensagem: 'Continuidade TEF bloqueada: PDV sem UI/TTY — coleta não descartada',
        requerContinuacao: true,
        retryAllowed: false,
        idempotency_key: idempotencyKey
      };
    }

    while (ehContinuidade(atual) && passos < maxPassos) {
      passos += 1;
      const acao = normalizarAcao(atual.acao);
      if (acao.tipo === TIPOS.DISPLAY || (acao.tipo === TIPOS.COLETA && ehColetaPinPad(acao))) {
        // DISPLAY ou COLETA PinPad: ack imediato (informacao vazia no PinPad) — 51.05
        const respostaContinuidade = acao.tipo === TIPOS.DISPLAY
          ? { displayAck: true }
          : { informacao: '' };
        try {
          const { response, data } = await postFn(apiUrl, token, {
            transacao_id: atual.transacao_id || atual.transacaoId,
            idempotency_key: idempotencyKey,
            venda_id: vendaId,
            resposta_continuidade: respostaContinuidade,
            acao,
            solicitadaEm: atual.solicitadaEm || atual.continuidade?.solicitadaEm
          });
          const payload = data && typeof data === 'object' ? data : {};
          payload.idempotency_key = payload.idempotency_key || idempotencyKey;
          atual = { ...payload, httpStatus: response?.status };
        } catch (err) {
          return {
            ...atual,
            sucesso: false,
            status: 'pendente',
            codigo: 'DESTAXA_PDV_FALHA_COMUNICACAO',
            mensagem: err?.message || 'Falha de comunicação no ack de continuidade',
            requerContinuacao: true,
            inconclusivo: true,
            retryAllowed: false,
            idempotency_key: idempotencyKey
          };
        }
        continue;
      }

      const coleta = await solicitarFn(acao);
      if (!coleta || coleta.ok !== true) {
        return {
          ...atual,
          sucesso: false,
          status: 'pendente',
          // MRT-40 — preservar código específico (timeout / SEM_TTY / sem operador)
          codigo: coleta?.codigo || 'DESTAXA_PDV_SEM_RESPOSTA',
          mensagem: coleta?.mensagem || 'Operador não respondeu à continuidade TEF',
          requerContinuacao: true,
          inconclusivo: coleta?.codigo === 'DESTAXA_CONTINUIDADE_TIMEOUT',
          retryAllowed: false,
          idempotency_key: idempotencyKey
        };
      }

      let response;
      let data;
      try {
        ({ response, data } = await postFn(apiUrl, token, {
          transacao_id: atual.transacao_id || atual.transacaoId,
          idempotency_key: idempotencyKey,
          venda_id: vendaId,
          resposta_continuidade: coleta.resposta,
          acao,
          solicitadaEm: atual.solicitadaEm || atual.continuidade?.solicitadaEm
        }));
      } catch (err) {
        return {
          ...atual,
          sucesso: false,
          status: 'pendente',
          codigo: 'DESTAXA_PDV_FALHA_COMUNICACAO',
          mensagem: err?.message || 'Falha de comunicação ao continuar TEF — sem nova cobrança',
          requerContinuacao: true,
          inconclusivo: true,
          retryAllowed: false,
          reconciliacaoObrigatoria: true,
          idempotency_key: idempotencyKey
        };
      }
      data = data && typeof data === 'object' ? data : {};
      data.idempotency_key = data.idempotency_key || idempotencyKey;
      atual = { ...data, httpStatus: response?.status };
    }

    return atual;
  }

  /**
   * MRT-40 — Reabertura do PDV: remonta resultado 99/OPCAO a partir da
   * continuidade persistida (SQLite), sem novo /tef/pagar nem TX_START.
   */
  function montarResultadoContinuidadePendente({
    transacao_id,
    transacaoId,
    idempotency_key,
    continuidade
  } = {}) {
    const id = transacao_id != null ? transacao_id : transacaoId;
    const cont = continuidade && typeof continuidade === 'object' ? continuidade : null;
    const sol = cont?.solicitacao99;
    if (id == null || String(id).trim() === '') {
      return {
        ok: false,
        codigo: 'TEF_CONTINUIDADE_SEM_TRANSACAO',
        mensagem: 'transacao_id obrigatório para reabrir continuidade'
      };
    }
    if (!sol || !sol.acao) {
      return {
        ok: false,
        codigo: 'DESTAXA_CONTINUIDADE_SEM_SOLICITACAO',
        mensagem: 'Nenhuma solicitação 99/OPCAO persistida para reabrir'
      };
    }
    if (cont.estado === 'TIMEOUT' || cont.estado === 'PERDA_COMUNICACAO') {
      return {
        ok: false,
        codigo: cont.estado === 'TIMEOUT'
          ? 'DESTAXA_CONTINUIDADE_TIMEOUT'
          : 'DESTAXA_CONTINUIDADE_PERDA_COMUNICACAO',
        mensagem: `Continuidade em estado ${cont.estado} — reabertura bloqueada`,
        retryAllowed: false
      };
    }
    const acao = normalizarAcao(sol.acao);
    return {
      ok: true,
      resultado: {
        sucesso: false,
        status: 'pendente',
        requerContinuacao: true,
        codigo: '99',
        acao,
        solicitadaEm: sol.solicitadaEm,
        mensagem: acao.mensagem || sol.mensagem || 'Continuidade TEF pendente — responda as opções',
        transacao_id: Number(id) || id,
        transacaoId: String(id),
        idempotency_key: idempotency_key || cont.identidade?.idempotency_key || null,
        continuidadeRecuperada: true
      }
    };
  }

  root.PdvTefContinuidade = {
    TIPOS,
    normalizarAcao,
    ehContinuidade,
    validarResposta,
    ehColetaPinPad,
    solicitarRespostaOperador,
    conduzirContinuidade,
    postContinuar,
    montarResultadoContinuidadePendente,
    ambienteSemUi
  };
})(typeof window !== 'undefined' ? window : globalThis);
