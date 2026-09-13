/**
 * RC3.17 — Formas de pagamento comerciais (componente compartilhado).
 * Expedição / NF-e Avulsa / futuros módulos.
 * Não altera motor financeiro: apenas monta UI e payload para o núcleo.
 */
(function (global) {
  'use strict';

  const FORMAS = Object.freeze([
    { value: 'dinheiro', label: 'Dinheiro' },
    { value: 'pix', label: 'PIX' },
    { value: 'cartao_debito', label: 'Cartão Débito' },
    { value: 'cartao_credito', label: 'Cartão Crédito' },
    { value: 'boleto', label: 'Boleto Bancário' },
    { value: 'transferencia', label: 'Transferência Bancária' },
    { value: 'deposito', label: 'Depósito Bancário' },
    { value: 'crediario', label: 'Crediário' },
    { value: 'parcelado', label: 'Parcelado' }
  ]);

  const FORMAS_PARCELAVEIS = Object.freeze(['parcelado', 'crediario', 'boleto', 'prazo']);

  function rotuloForma(value) {
    const v = String(value || '').toLowerCase();
    const hit = FORMAS.find((f) => f.value === v);
    if (hit) return hit.label;
    const mapa = { prazo: 'A prazo', boleto_bancario: 'Boleto Bancário' };
    return mapa[v] || (value || '—');
  }

  function ehParcelavel(forma) {
    return FORMAS_PARCELAVEIS.includes(String(forma || '').toLowerCase());
  }

  function ehBoleto(forma) {
    const f = String(forma || '').toLowerCase();
    return f === 'boleto' || f === 'boleto_bancario';
  }

  function dataPadraoVencimento(dias = 30) {
    const d = new Date();
    d.setDate(d.getDate() + dias);
    return d.toISOString().slice(0, 10);
  }

  function fmtMoney(v) {
    return Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  }

  function optionsHtml(selected) {
    const sel = String(selected || 'dinheiro');
    return FORMAS.map((f) =>
      `<option value="${f.value}" ${f.value === sel ? 'selected' : ''}>${f.label}</option>`
    ).join('');
  }

  /**
   * HTML dos painéis condicionais (Parcelado / Boleto).
   * @param {string} prefix — ids: {prefix}Forma, {prefix}ParcelasExtra, etc.
   */
  function htmlPaineisExtras(prefix) {
    const p = String(prefix || 'cdsPag');
    return `
      <div class="row g-2 mt-1 d-none" id="${p}PainelParcelado">
        <div class="col-md-2">
          <label class="form-label">Qtd. parcelas</label>
          <input type="number" class="form-control" id="${p}Parcelas" min="1" max="48" value="2">
        </div>
        <div class="col-md-3">
          <label class="form-label">Primeiro vencimento</label>
          <input type="date" class="form-control" id="${p}PrimeiroVenc">
        </div>
        <div class="col-md-2">
          <label class="form-label">Intervalo</label>
          <select class="form-select" id="${p}Intervalo">
            <option value="mensal" selected>Mensal</option>
            <option value="quinzenal">Quinzenal</option>
            <option value="semanal">Semanal</option>
          </select>
        </div>
        <div class="col-md-2">
          <label class="form-label">Valor da parcela</label>
          <input type="text" class="form-control" id="${p}ValorParcela" readonly>
        </div>
        <div class="col-md-3">
          <label class="form-label">Resumo</label>
          <div class="form-control-plaintext fw-semibold" id="${p}ResumoParcelas">—</div>
        </div>
      </div>
      <div class="row g-2 mt-1 d-none" id="${p}PainelBoleto">
        <div class="col-md-3">
          <label class="form-label">Primeiro vencimento</label>
          <input type="date" class="form-control" id="${p}BolPrimeiroVenc">
        </div>
        <div class="col-md-2">
          <label class="form-label">Qtd. boletos</label>
          <input type="number" class="form-control" id="${p}BolQtd" min="1" max="48" value="1">
        </div>
        <div class="col-md-2">
          <label class="form-label">Intervalo</label>
          <select class="form-select" id="${p}BolIntervalo">
            <option value="mensal" selected>Mensal</option>
            <option value="quinzenal">Quinzenal</option>
            <option value="semanal">Semanal</option>
          </select>
        </div>
        <div class="col-md-2">
          <label class="form-label">Carteira</label>
          <input type="text" class="form-control" id="${p}BolCarteira" placeholder="Opcional">
        </div>
        <div class="col-md-3">
          <label class="form-label">Observação</label>
          <input type="text" class="form-control" id="${p}BolObs" placeholder="Opcional">
        </div>
      </div>`;
  }

  function htmlSelectComPaineis(prefix, selected) {
    const p = String(prefix || 'cdsPag');
    return `
      <label class="form-label">Forma de pagamento</label>
      <select class="form-select" id="${p}Forma">${optionsHtml(selected)}</select>
      ${htmlPaineisExtras(p)}`;
  }

  function atualizarResumo($root, prefix, total) {
    const p = String(prefix || 'cdsPag');
    const q = (sel) => ($root ? $root.find(sel) : $(sel));
    const forma = String(q(`#${p}Forma`).val() || 'dinheiro');
    const totalNum = Number(total || 0);

    const painelParc = q(`#${p}PainelParcelado`);
    const painelBol = q(`#${p}PainelBoleto`);
    painelParc.addClass('d-none');
    painelBol.addClass('d-none');

    if (forma === 'parcelado' || forma === 'crediario') {
      painelParc.removeClass('d-none');
      const n = Math.max(1, parseInt(q(`#${p}Parcelas`).val() || '1', 10) || 1);
      const valor = n > 0 ? Number((totalNum / n).toFixed(2)) : 0;
      q(`#${p}ValorParcela`).val(fmtMoney(valor));
      q(`#${p}ResumoParcelas`).text(`${n}x ${fmtMoney(valor)}`);
      if (!q(`#${p}PrimeiroVenc`).val()) q(`#${p}PrimeiroVenc`).val(dataPadraoVencimento(30));
    } else if (ehBoleto(forma)) {
      painelBol.removeClass('d-none');
      if (!q(`#${p}BolPrimeiroVenc`).val()) q(`#${p}BolPrimeiroVenc`).val(dataPadraoVencimento(30));
    }
  }

  /**
   * Liga change handlers. getTotal: () => number
   */
  function bind(prefix, getTotal, $root) {
    const p = String(prefix || 'cdsPag');
    const q = (sel) => ($root ? $root.find(sel) : $(sel));
    const refresh = () => atualizarResumo($root, p, typeof getTotal === 'function' ? getTotal() : 0);
    q(`#${p}Forma`).off('change.cdsPag').on('change.cdsPag', refresh);
    q(`#${p}Parcelas, #${p}PrimeiroVenc, #${p}Intervalo`).off('input.cdsPag change.cdsPag').on('input.cdsPag change.cdsPag', refresh);
    q(`#${p}BolQtd, #${p}BolPrimeiroVenc, #${p}BolIntervalo`).off('input.cdsPag change.cdsPag').on('input.cdsPag change.cdsPag', refresh);
    refresh();
    return { refresh };
  }

  /**
   * Monta campos para POST de venda/faturamento (núcleo existente).
   */
  function montarPayloadPagamento(prefix, total, $root) {
    const p = String(prefix || 'cdsPag');
    const q = (sel) => ($root ? $root.find(sel) : $(sel));
    const forma = String(q(`#${p}Forma`).val() || 'dinheiro').toLowerCase();
    const totalNum = Number(total || 0);
    const base = {
      forma_pagamento: forma,
      pagamentos: [{ forma_pagamento: forma, valor: totalNum }],
      valor_recebido: totalNum
    };

    if (forma === 'parcelado' || forma === 'crediario') {
      const parcelas = Math.max(1, parseInt(q(`#${p}Parcelas`).val() || '1', 10) || 1);
      base.parcelas = parcelas;
      base.primeiro_vencimento = q(`#${p}PrimeiroVenc`).val() || dataPadraoVencimento(30);
      base.intervalo_parcelas = q(`#${p}Intervalo`).val() || 'mensal';
      if (forma === 'crediario' && parcelas <= 1) {
        base.parcelas = 1;
      }
    } else if (ehBoleto(forma)) {
      base.parcelas = Math.max(1, parseInt(q(`#${p}BolQtd`).val() || '1', 10) || 1);
      base.primeiro_vencimento = q(`#${p}BolPrimeiroVenc`).val() || dataPadraoVencimento(30);
      base.intervalo_parcelas = q(`#${p}BolIntervalo`).val() || 'mensal';
      base.carteira_boleto = q(`#${p}BolCarteira`).val() || null;
      base.observacao_pagamento = q(`#${p}BolObs`).val() || null;
    } else {
      base.parcelas = 1;
    }

    return base;
  }

  const api = {
    FORMAS,
    FORMAS_PARCELAVEIS,
    rotuloForma,
    ehParcelavel,
    ehBoleto,
    optionsHtml,
    htmlSelectComPaineis,
    htmlPaineisExtras,
    bind,
    atualizarResumo,
    montarPayloadPagamento,
    dataPadraoVencimento,
    fmtMoney
  };

  global.CdsFormasPagamento = api;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof window !== 'undefined' ? window : global);
