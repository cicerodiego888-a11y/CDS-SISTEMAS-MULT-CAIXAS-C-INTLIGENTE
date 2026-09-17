/**
 * RC6 — Tela dedicada de NF-e de Devolução de Compra.
 * Consome preparar / previa / emitir / lifecycle existentes (RC1–RC4).
 * Não recalcula saldo nem tributos no frontend.
 */
(function () {
  'use strict';

  const ETAPAS = [
    { id: 1, label: 'Selecionar NF-e' },
    { id: 2, label: 'Itens e Quantidades' },
    { id: 3, label: 'Revisão Fiscal' },
    { id: 4, label: 'Emissão' },
    { id: 5, label: 'Conclusão' }
  ];

  let estado = estadoInicial();
  let emitindo = false;
  let pollTimer = null;

  function estadoInicial() {
    return {
      etapa: 1,
      compraId: null,
      prep: null,
      itensUi: [],
      observacoes: '',
      cfop: '',
      previa: null,
      resultado: null,
      qtdErro: '',
      buscaOrigens: []
    };
  }

  function headersJson() {
    const h = { 'Content-Type': 'application/json' };
    try {
      const t = localStorage.getItem('token') || sessionStorage.getItem('token');
      if (t) h.Authorization = `Bearer ${t}`;
    } catch (_) { /* ignore */ }
    return h;
  }

  function escapeHtml(v) {
    return String(v == null ? '' : v)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function fmtMoney(v) {
    return Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  }

  function fmtData(v) {
    if (!v) return '—';
    const d = new Date(String(v).replace(' ', 'T'));
    if (Number.isNaN(d.getTime())) return String(v);
    return d.toLocaleDateString('pt-BR');
  }

  function fmtDataHora(v) {
    if (!v) return '—';
    const d = new Date(String(v).replace(' ', 'T'));
    if (Number.isNaN(d.getTime())) return String(v);
    return d.toLocaleString('pt-BR');
  }

  function digits(v) {
    return String(v || '').replace(/\D/g, '');
  }

  function alertar(msg, tipo) {
    if (typeof showNotification === 'function') showNotification(msg, tipo || 'info');
    else window.alert(String(msg).replace(/<[^>]+>/g, ''));
  }

  function copiarTexto(texto, okMsg) {
    const t = String(texto || '');
    if (!t) return;
    const done = () => alertar(okMsg || 'Chave copiada.', 'success');
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(t).then(done).catch(() => fallbackCopy(t, done));
    } else fallbackCopy(t, done);
  }

  function fallbackCopy(t, done) {
    const ta = document.createElement('textarea');
    ta.value = t;
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); done(); } catch (_) { /* ignore */ }
    ta.remove();
  }

  function badgeStatusUi(ui) {
    const st = ui || {};
    const label = `${st.emoji || ''} ${escapeHtml(st.label || '')}`.trim();
    if (st.cor === 'verde') return `<span class="badge bg-success">${label || 'Não devolvido'}</span>`;
    if (st.cor === 'amarelo') return `<span class="badge bg-warning text-dark">${label || 'Parcialmente devolvido'}</span>`;
    if (st.cor === 'azul') return `<span class="badge bg-primary">${label || 'Totalmente devolvido'}</span>`;
    if (st.cor === 'vermelho') return `<span class="badge bg-danger">${label || 'Saldo insuficiente'}</span>`;
    return `<span class="badge bg-secondary">${label || '—'}</span>`;
  }

  function badgeComparacao(linha) {
    const st = String(linha.status || linha.cor || '').toLowerCase();
    if (st === 'igual' || st === 'verde') return '🟢 Igual';
    if (st === 'adaptado' || st === 'amarelo') return '🟡 Adaptado';
    if (st === 'divergente' || st === 'vermelho') return '🔴 Divergente';
    return escapeHtml(linha.label || '—');
  }

  function errosValidacao(prep) {
    const lista = (prep && prep.validacaoOrigem && prep.validacaoOrigem.erros) || [];
    if (lista.length) return lista.map((e) => e.mensagem);
    if (prep && prep.motivoBloqueio) return [prep.motivoBloqueio];
    return [];
  }

  function origemValidaParaAvancar(prep) {
    if (!prep) return false;
    if (prep.validacaoOrigem && prep.validacaoOrigem.ok === false) return false;
    if (!prep.podeEmitir) return false;
    return true;
  }

  function montarItensUi(prep) {
    const itens = prep.itens || [];
    const painel = prep.itensPainel || [];
    const mapa = new Map(itens.map((it) => [Number(it.compra_item_id), it]));
    const base = painel.length ? painel : itens;
    const ids = new Set(base.map((p) => Number(p.compra_item_id)));
    const merged = [
      ...base.map((p) => {
        const extra = mapa.get(Number(p.compra_item_id));
        return extra ? { ...p, ...extra } : p;
      }),
      ...itens.filter((it) => !ids.has(Number(it.compra_item_id)))
    ];
    return merged.map((it) => {
      const saldo = Number(it.saldo != null ? it.saldo : it.quantidade_maxima || 0);
      return {
        ...it,
        selecionado: false,
        qtdDevolver: 0,
        saldo
      };
    });
  }

  function itensSelecionadosPayload() {
    return estado.itensUi
      .filter((it) => it.selecionado && Number(it.qtdDevolver) > 0)
      .map((it) => ({
        compra_item_id: it.compra_item_id,
        produto_id: it.produto_id,
        quantidade: Number(it.qtdDevolver)
      }));
  }

  function totaisLocais() {
    const ativos = estado.itensUi.filter((it) => it.selecionado && Number(it.qtdDevolver) > 0);
    const qtdItens = ativos.length;
    let vProd = 0;
    let vDesc = 0;
    let vFrete = 0;
    ativos.forEach((it) => {
      const qtd = Number(it.qtdDevolver) || 0;
      const vu = Number(it.valor_unitario) || 0;
      vProd += qtd * vu;
      const fator = it.quantidade_comprada > 0 ? (qtd / Number(it.quantidade_comprada)) : 0;
      if (it.vDesc != null) vDesc += Number(it.vDesc);
      else if (it.v_desc != null) vDesc += Number(it.v_desc);
      if (it.vFrete != null) vFrete += Number(it.vFrete);
      else if (estado.prep && estado.prep.compra && Number(estado.prep.compra.valor_frete) && fator) {
        vFrete += Number(estado.prep.compra.valor_frete) * fator;
      }
    });
    if (estado.previa && estado.previa.totais) {
      return {
        qtdItens,
        vProd: Number(estado.previa.totais.vProd || 0),
        vDesc: Number(estado.previa.totais.vDesc || 0),
        vFrete: Number(estado.previa.totais.vFrete || 0),
        vNF: Number(estado.previa.totais.vNF || 0)
      };
    }
    vProd = Number(vProd.toFixed(2));
    vDesc = Number(vDesc.toFixed(2));
    vFrete = Number(vFrete.toFixed(2));
    return { qtdItens, vProd, vDesc, vFrete, vNF: Number((vProd - vDesc + vFrete).toFixed(2)) };
  }

  function agregarComparacao(lista) {
    const chaves = [
      { key: 'ICMS', match: (c) => /icms vicms/i.test(c) || c === 'ICMS' },
      { key: 'IPI', match: (c) => /^ipi$/i.test(c) },
      { key: 'PIS', match: (c) => /^pis$/i.test(c) },
      { key: 'COFINS', match: (c) => /^cofins$/i.test(c) },
      { key: 'ICMS-ST', match: (c) => /icms st/i.test(c) },
      { key: 'FCP', match: (c) => /^fcp$/i.test(c) },
      { key: 'DIFAL', match: (c) => /^difal$/i.test(c) }
    ];
    return chaves.map((def) => {
      let orig = 0;
      let dev = 0;
      let status = 'igual';
      (lista || []).forEach((item) => {
        (item.linhas || []).forEach((ln) => {
          if (!def.match(String(ln.campo || ''))) return;
          orig += Number(ln.original || 0);
          dev += Number(ln.devolucao || 0);
          if (ln.status === 'divergente') status = 'divergente';
          else if (ln.status === 'adaptado' && status !== 'divergente') status = 'adaptado';
        });
      });
      return { tributo: def.key, origem: orig, devolucao: dev, status };
    });
  }

  function renderStepper() {
    return `
      <ol class="ndc-stepper" aria-label="Etapas da devolução">
        ${ETAPAS.map((e) => `
          <li class="ndc-stepper__item${estado.etapa === e.id ? ' is-current' : ''}${estado.etapa > e.id ? ' is-done' : ''}">
            <span class="ndc-stepper__num">${e.id}</span>
            <span class="ndc-stepper__label">${escapeHtml(e.label)}</span>
          </li>`).join('')}
      </ol>`;
  }

  function renderCabecalho() {
    const shell = (typeof CdsPageShell !== 'undefined' && CdsPageShell.renderHeader)
      ? CdsPageShell.renderHeader({
        page: 'nfe-devolucao-compra',
        grupo: 'Fiscal',
        titulo: 'Devolução de Compra',
        subtitulo: 'Devolver mercadoria ao fornecedor, referenciando a NF-e original.',
        breadcrumbVisible: true,
        breadcrumb: [
          { label: 'Fiscal', page: 'nfe-central' },
          { label: 'Nova NF-e', page: 'nfe-avulsa' },
          { label: 'Devolução de Compra' }
        ],
        toolbarHtml: `<button type="button" class="btn btn-sm btn-outline-secondary" id="btnNdcAjuda">
          <i class="fas fa-question-circle"></i> Ajuda
        </button>`
      })
      : `<h1>Devolução de Compra</h1>`;
    return shell;
  }

  function renderCardNfeOrigem() {
    const c = estado.prep && estado.prep.compra;
    if (!c) {
      return `
        <div class="card shadow-sm mb-3" id="ndcCardOrigem">
          <div class="card-header fw-semibold">NF-e de Origem (Fornecedor)</div>
          <div class="card-body">
            <label class="form-label">Chave de acesso da NF-e</label>
            <div class="input-group mb-2">
              <input type="text" class="form-control" id="ndcChave" maxlength="54"
                placeholder="Digite ou cole a chave de acesso..." autocomplete="off">
              <button type="button" class="btn btn-primary" id="btnNdcBuscarChave">
                <i class="fas fa-search"></i> Buscar
              </button>
            </div>
            <button type="button" class="btn btn-link px-0" id="btnNdcAbrirPesquisa">
              Ou selecionar uma compra
            </button>
            <div id="ndcMsgValidacao" class="mt-2"></div>
          </div>
        </div>`;
    }
    const chave = estado.prep.refNFe || c.chave_acesso || '';
    const autorizada = String(c.situacao || '').toLowerCase() !== 'cancelada';
    return `
      <div class="card shadow-sm mb-3" id="ndcCardOrigem">
        <div class="card-header d-flex justify-content-between align-items-center">
          <span class="fw-semibold">NF-e de Origem (Fornecedor)</span>
          <button type="button" class="btn btn-sm btn-outline-secondary" id="btnNdcTrocarNfe">Trocar NF-e</button>
        </div>
        <div class="card-body">
          <div class="d-flex flex-wrap justify-content-between gap-2">
            <div>
              <div class="fs-5">NF-e nº ${escapeHtml(c.numero_nf || '—')}</div>
              <div class="text-muted">Série ${escapeHtml(String(c.serie_nf || '').padStart(3, '0'))}</div>
              <div>${escapeHtml(fmtData(c.data_emissao))}</div>
              <div class="fw-semibold">${fmtMoney(c.valor_total_nota != null ? c.valor_total_nota : c.total)}</div>
            </div>
            <div class="text-end">
              <div>${autorizada ? '🟢 Autorizada' : '🔴 Cancelada'}</div>
              <div class="small text-break mt-1">Chave: ${escapeHtml(chave)}</div>
              <button type="button" class="btn btn-sm btn-outline-secondary mt-1" id="btnNdcCopiarChaveOrigem">
                copiar chave
              </button>
            </div>
          </div>
          <div id="ndcMsgValidacao" class="mt-2"></div>
        </div>
      </div>`;
  }

  function renderCardFornecedor() {
    const c = estado.prep && estado.prep.compra;
    if (!c) return '';
    return `
      <div class="card shadow-sm mb-3">
        <div class="card-header d-flex justify-content-between align-items-center">
          <span class="fw-semibold">Fornecedor</span>
          <button type="button" class="btn btn-sm btn-outline-secondary" id="btnNdcFornecedorCompleto">
            Ver dados completos
          </button>
        </div>
        <div class="card-body">
          <div><strong>${escapeHtml(c.fornecedor || '—')}</strong></div>
          <div class="small">CNPJ: ${escapeHtml(c.fornecedor_cnpj || '—')}</div>
          <div class="small">IE: ${escapeHtml(c.fornecedor_ie || '—')}</div>
          <div class="small">${escapeHtml(c.fornecedor_endereco || '—')}</div>
          <div class="small">${escapeHtml(c.fornecedor_municipio || '—')} / ${escapeHtml(c.fornecedor_uf || '—')}</div>
        </div>
      </div>`;
  }

  function renderLinhaItem(it, idx) {
    const saldo = Number(it.saldo || 0);
    const disabled = !(saldo > 0);
    const qtd = disabled ? 0 : Number(it.qtdDevolver || 0);
    const vu = Number(it.valor_unitario || 0);
    const total = qtd * vu;
    return `
      <tr class="ndc-item-row" data-idx="${idx}">
        <td>
          <input type="checkbox" class="form-check-input ndc-sel" ${it.selecionado ? 'checked' : ''}
            ${disabled ? 'disabled' : ''} aria-label="Selecionar item">
        </td>
        <td>${escapeHtml(it.produto_codigo || '—')}</td>
        <td>
          ${escapeHtml(it.produto_nome || '—')}
          <div class="small mt-1">${badgeStatusUi(it.status_ui)}</div>
        </td>
        <td>${escapeHtml(it.ncm || '—')}</td>
        <td>${escapeHtml(it.cfop_origem || it.cfop || '—')}</td>
        <td>${escapeHtml(it.csosn || it.cst || '—')}</td>
        <td>${escapeHtml(it.unidade || 'UN')}</td>
        <td class="text-end">${Number(it.quantidade_comprada || 0)}</td>
        <td class="text-end">${Number(it.quantidade_devolvida || 0)}</td>
        <td class="text-end fw-semibold">${saldo}</td>
        <td>
          <input type="number" min="0" step="0.001" class="form-control form-control-sm ndc-qtd"
            value="${qtd}" ${disabled || !it.selecionado ? 'disabled' : ''} max="${saldo}">
        </td>
        <td class="text-end">${fmtMoney(vu)}</td>
        <td class="text-end">${fmtMoney(total)}</td>
      </tr>`;
  }

  function renderCardItemMobile(it, idx) {
    const saldo = Number(it.saldo || 0);
    const disabled = !(saldo > 0);
    const qtd = disabled ? 0 : Number(it.qtdDevolver || 0);
    return `
      <div class="card mb-2 ndc-item-card" data-idx="${idx}">
        <div class="card-body py-2">
          <div class="d-flex justify-content-between gap-2">
            <div>
              <input type="checkbox" class="form-check-input ndc-sel me-1" ${it.selecionado ? 'checked' : ''}
                ${disabled ? 'disabled' : ''}>
              <strong>${escapeHtml(it.produto_nome || '—')}</strong>
              <div class="small text-muted">${escapeHtml(it.produto_codigo || '')}</div>
              ${badgeStatusUi(it.status_ui)}
            </div>
            <button type="button" class="btn btn-sm btn-outline-secondary ndc-expand" aria-expanded="false">
              Detalhes
            </button>
          </div>
          <div class="ndc-item-extra mt-2" hidden>
            <div class="small">NCM ${escapeHtml(it.ncm || '—')} · CFOP ${escapeHtml(it.cfop_origem || it.cfop || '—')} · CST/CSOSN ${escapeHtml(it.csosn || it.cst || '—')}</div>
            <div class="small">Comprada ${Number(it.quantidade_comprada || 0)} · Devolvida ${Number(it.quantidade_devolvida || 0)} · Saldo ${saldo}</div>
            <label class="form-label small mb-0 mt-1">Qtd. Devolver</label>
            <input type="number" min="0" step="0.001" class="form-control form-control-sm ndc-qtd"
              value="${qtd}" ${disabled || !it.selecionado ? 'disabled' : ''} max="${saldo}">
            <div class="small mt-1">Unit. ${fmtMoney(it.valor_unitario)} · Total ${fmtMoney(qtd * Number(it.valor_unitario || 0))}</div>
          </div>
        </div>
      </div>`;
  }

  function renderEtapaItens() {
    const linhas = estado.itensUi.map(renderLinhaItem).join('');
    const cards = estado.itensUi.map(renderCardItemMobile).join('');
    const trib = estado.prep && estado.prep.tributacaoOriginal;
    const tribHtml = trib ? Object.keys(trib).map((k) => {
      const info = trib[k] || {};
      return `<li><strong>${escapeHtml(k)}</strong> — ${escapeHtml(info.texto || (info.presente ? 'Presente' : 'Não existente na NF-e original.'))}</li>`;
    }).join('') : '<li class="text-muted">Tributação original será exibida após carregar a NF-e.</li>';
    const tot = totaisLocais();
    const chave = estado.prep && (estado.prep.refNFe || (estado.prep.compra && estado.prep.compra.chave_acesso));
    return `
      <div class="card shadow-sm mb-3">
        <div class="card-header d-flex justify-content-between align-items-center">
          <span class="fw-semibold">Itens da NF-e para Devolução</span>
          <button type="button" class="btn btn-sm btn-outline-primary" id="btnNdcSelecionarTodos">Selecionar todos</button>
        </div>
        <div class="card-body">
          <div class="table-responsive ndc-itens-table">
            <table class="table table-sm table-bordered align-middle">
              <thead>
                <tr>
                  <th></th><th>Código</th><th>Produto</th><th>NCM</th><th>CFOP Orig.</th>
                  <th>CST/CSOSN</th><th>Un.</th>
                  <th class="text-end">Comprada</th><th class="text-end">Devolvida</th>
                  <th class="text-end">Saldo</th><th>Qtd. Devolver</th>
                  <th class="text-end">Valor Unit.</th><th class="text-end">Total</th>
                </tr>
              </thead>
              <tbody>${linhas || '<tr><td colspan="13" class="text-center text-muted">Nenhum item</td></tr>'}</tbody>
            </table>
          </div>
          <div class="ndc-itens-cards">${cards}</div>
          <div id="ndcMsgQtd" class="text-danger small mt-1">${escapeHtml(estado.qtdErro || '')}</div>
          <label class="form-label mt-3">Observações (opcional)</label>
          <textarea class="form-control" id="ndcObservacoes" rows="2"
            placeholder="Informe o motivo da devolução...">${escapeHtml(estado.observacoes)}</textarea>
        </div>
      </div>
      <div class="row g-3">
        <div class="col-lg-4">
          <div class="card shadow-sm h-100">
            <div class="card-header fw-semibold">Totais da Devolução</div>
            <div class="card-body small" id="ndcTotais">
              <div class="d-flex justify-content-between"><span>Quantidade de itens</span><strong>${tot.qtdItens}</strong></div>
              <div class="d-flex justify-content-between"><span>Valor dos produtos</span><strong>${fmtMoney(tot.vProd)}</strong></div>
              <div class="d-flex justify-content-between"><span>Desconto</span><strong>${fmtMoney(tot.vDesc)}</strong></div>
              <div class="d-flex justify-content-between"><span>Frete</span><strong>${fmtMoney(tot.vFrete)}</strong></div>
              <hr>
              <div class="d-flex justify-content-between"><span>Valor total da NF-e</span><strong>${fmtMoney(tot.vNF)}</strong></div>
            </div>
          </div>
        </div>
        <div class="col-lg-8">
          <div class="card shadow-sm h-100">
            <div class="card-header fw-semibold">Informações Fiscais da Devolução</div>
            <div class="card-body small">
              <div>Finalidade da NF-e: <strong>Devolução (finNFe = 4)</strong></div>
              <div>Natureza da operação: <strong>DEVOLUÇÃO DE COMPRA</strong></div>
              <div>CFOP: <strong>${escapeHtml(estado.cfop || (estado.prep && estado.prep.cfopSugerido) || '5202')}</strong></div>
              <div>NF-e referenciada (NFref): <span class="text-break">${escapeHtml(chave || '')}</span>
                <button type="button" class="btn btn-sm btn-outline-secondary ms-1" id="btnNdcCopiarNFref">copiar chave</button>
              </div>
              <hr>
              <div class="fw-semibold mb-1">Tributação Original</div>
              <ul class="mb-0">${tribHtml}</ul>
            </div>
          </div>
        </div>
      </div>`;
  }

  function renderComparacao() {
    const rows = agregarComparacao((estado.prep && estado.prep.comparacaoFiscal) || []);
    return `
      <div class="card shadow-sm mb-3">
        <div class="card-header fw-semibold">Comparação Fiscal</div>
        <div class="card-body p-0">
          <table class="table table-sm mb-0">
            <thead><tr><th>Tributo</th><th>Origem</th><th>Devolução</th><th></th></tr></thead>
            <tbody>
              ${rows.map((r) => `<tr>
                <td>${escapeHtml(r.tributo)}</td>
                <td>${fmtMoney(r.origem)}</td>
                <td>${fmtMoney(r.devolucao)}</td>
                <td>${badgeComparacao(r)}</td>
              </tr>`).join('')}
            </tbody>
          </table>
        </div>
      </div>`;
  }

  function renderRevisao() {
    const c = estado.prep.compra;
    const tot = totaisLocais();
    const chave = estado.prep.refNFe;
    const qtd = itensSelecionadosPayload().reduce((s, i) => s + Number(i.quantidade), 0);
    return `
      <div class="alert alert-warning">Confira os dados antes de transmitir esta NF-e à SEFAZ.</div>
      <div class="card shadow-sm mb-3">
        <div class="card-header fw-semibold">Revisão Fiscal</div>
        <div class="card-body">
          <div class="row g-2 small">
            <div class="col-md-6"><strong>NF-e original</strong><div>nº ${escapeHtml(c.numero_nf || '—')} série ${escapeHtml(c.serie_nf || '—')}</div></div>
            <div class="col-md-6"><strong>Fornecedor</strong><div>${escapeHtml(c.fornecedor || '—')}</div></div>
            <div class="col-md-4"><strong>Itens</strong><div>${tot.qtdItens}</div></div>
            <div class="col-md-4"><strong>Quantidade</strong><div>${qtd}</div></div>
            <div class="col-md-4"><strong>Valor</strong><div>${fmtMoney(tot.vNF)}</div></div>
            <div class="col-md-4"><strong>CFOP</strong><div>${escapeHtml(estado.cfop || estado.prep.cfopSugerido || '')}</div></div>
            <div class="col-md-4"><strong>finNFe</strong><div>4</div></div>
            <div class="col-md-4"><strong>NFref</strong><div class="text-break">${escapeHtml(chave || '')}</div></div>
          </div>
        </div>
      </div>
      ${renderComparacao()}
      ${estado.previa && estado.previa.auditoria && !estado.previa.auditoria.aprovado
        ? `<div class="alert alert-danger">${escapeHtml((estado.previa.auditoria.erros || []).join(' '))}</div>`
        : ''}`;
  }

  function renderEmissao() {
    const fases = ['Gerando XML...', 'Assinando...', 'Validando...', 'Enviando para SEFAZ...', 'Aguardando retorno...'];
    return `
      <div class="card shadow-sm">
        <div class="card-body text-center py-5">
          <div class="spinner-border text-primary mb-3" role="status"></div>
          <div id="ndcFaseEmissao" class="fw-semibold">${fases[0]}</div>
          <ol class="list-unstyled small text-muted mt-3 mb-0">
            ${fases.map((f, i) => `<li data-fase="${i}">${escapeHtml(f)}</li>`).join('')}
          </ol>
        </div>
      </div>`;
  }

  function renderConclusao() {
    const r = estado.resultado || {};
    const st = String(r.status || '').toLowerCase();
    const ok = Boolean(r.success) || st === 'autorizada';
    const rejeitada = st === 'rejeitada' || r.cStat && Number(r.cStat) >= 200 && Number(r.cStat) !== 100;
    const notaId = r.notaId || r.idNota;
    if (ok && !rejeitada) {
      return `
        <div class="card shadow-sm">
          <div class="card-body">
            <h5>🟢 NF-e autorizada</h5>
            <div>Número: <strong>${escapeHtml(r.numero || '—')}</strong> · Série <strong>${escapeHtml(r.serie || '—')}</strong></div>
            <div class="text-break">Chave: ${escapeHtml(r.chaveAcesso || r.chave || '—')}</div>
            <div>Protocolo: ${escapeHtml(r.protocolo || '—')}</div>
            <div>Data/hora: ${escapeHtml(fmtDataHora(r.autorizadoEm || r.dataHora || new Date().toISOString()))}</div>
            <div class="d-flex flex-wrap gap-2 mt-3">
              ${notaId ? `<a class="btn btn-outline-secondary" target="_blank" href="${API_URL}/compras/nfe-devolucao/${notaId}/xml?tipo=autorizado">Baixar XML</a>` : ''}
              ${notaId ? `<a class="btn btn-outline-secondary" target="_blank" href="${API_URL}/compras/nfe-devolucao/${notaId}/danfe">Imprimir DANFE</a>` : ''}
              ${notaId ? `<button type="button" class="btn btn-outline-primary" id="btnNdcLifecycle">Ver Lifecycle</button>` : ''}
              <button type="button" class="btn btn-primary" id="btnNdcFechar">Fechar</button>
            </div>
            <div id="ndcLifecycleBox" class="mt-3"></div>
          </div>
        </div>`;
    }
    return `
      <div class="card shadow-sm">
        <div class="card-body">
          <h5>🔴 NF-e rejeitada</h5>
          <div>Código SEFAZ: <strong>${escapeHtml(r.cStat || r.rejeicao && r.rejeicao.codigo || '—')}</strong></div>
          <div>Motivo: ${escapeHtml(r.xMotivo || r.message || (r.rejeicao && r.rejeicao.motivo) || '—')}</div>
          <div class="d-flex flex-wrap gap-2 mt-3">
            ${notaId ? `<button type="button" class="btn btn-outline-secondary" id="btnNdcDetalhesRejeicao">Ver detalhes</button>` : ''}
            <button type="button" class="btn btn-outline-primary" id="btnNdcVoltarRevisao">Voltar para revisão</button>
            ${notaId ? `<button type="button" class="btn btn-danger" id="btnNdcReenviar">Reenviar</button>` : ''}
          </div>
          <div id="ndcLifecycleBox" class="mt-3"></div>
        </div>
      </div>`;
  }

  function renderRodape() {
    if (estado.etapa === 1) {
      return `<div class="d-flex justify-content-end mt-3">
        <button type="button" class="btn btn-primary" id="btnNdcAvancar1">Avançar para Itens e Quantidades →</button>
      </div>`;
    }
    if (estado.etapa === 2) {
      return `<div class="d-flex justify-content-between mt-3">
        <button type="button" class="btn btn-outline-secondary" id="btnNdcVoltar1">← Voltar</button>
        <button type="button" class="btn btn-primary" id="btnNdcAvancar2">Avançar para Revisão Fiscal →</button>
      </div>`;
    }
    if (estado.etapa === 3) {
      return `<div class="d-flex justify-content-between mt-3">
        <button type="button" class="btn btn-outline-secondary" id="btnNdcVoltar2">← Voltar</button>
        <button type="button" class="btn btn-danger" id="btnNdcEmitir" ${emitindo ? 'disabled' : ''}>Emitir NF-e de Devolução</button>
      </div>`;
    }
    return '';
  }

  function renderTela() {
    let corpo = '';
    if (estado.etapa === 1) corpo = renderCardNfeOrigem() + renderCardFornecedor();
    else if (estado.etapa === 2) corpo = renderCardNfeOrigem() + renderCardFornecedor() + renderEtapaItens();
    else if (estado.etapa === 3) corpo = renderRevisao();
    else if (estado.etapa === 4) corpo = renderEmissao();
    else corpo = renderConclusao();

    $('#page-content').html(`
      ${renderCabecalho()}
      ${renderStepper()}
      <div id="ndcConteudo">${corpo}</div>
      ${renderRodape()}
      ${renderModais()}`);
    bindEventos();
    pintarValidacao();
  }

  function renderModais() {
    return `
      <div class="modal fade" id="ndcModalPesquisa" tabindex="-1">
        <div class="modal-dialog modal-lg modal-dialog-scrollable">
          <div class="modal-content">
            <div class="modal-header">
              <h5 class="modal-title">Selecionar compra / NF-e de origem</h5>
              <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
            </div>
            <div class="modal-body">
              <div class="row g-2 mb-2">
                <div class="col-md-4"><input class="form-control form-control-sm" id="ndcFiltroChave" placeholder="Chave"></div>
                <div class="col-md-2"><input class="form-control form-control-sm" id="ndcFiltroNumero" placeholder="Número"></div>
                <div class="col-md-2"><input class="form-control form-control-sm" id="ndcFiltroSerie" placeholder="Série"></div>
                <div class="col-md-2"><input class="form-control form-control-sm" id="ndcFiltroFornecedor" placeholder="Fornecedor"></div>
                <div class="col-md-2"><input type="date" class="form-control form-control-sm" id="ndcFiltroData"></div>
              </div>
              <button type="button" class="btn btn-sm btn-primary mb-2" id="btnNdcPesquisarOrigens">Pesquisar</button>
              <div class="table-responsive">
                <table class="table table-sm table-hover">
                  <thead><tr><th>Número</th><th>Série</th><th>Data</th><th>Fornecedor</th><th>Valor</th><th>Status</th><th></th></tr></thead>
                  <tbody id="ndcPesquisaBody"></tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      </div>
      <div class="modal fade" id="ndcModalFornecedor" tabindex="-1">
        <div class="modal-dialog">
          <div class="modal-content">
            <div class="modal-header"><h5 class="modal-title">Dados completos do fornecedor</h5>
              <button type="button" class="btn-close" data-bs-dismiss="modal"></button></div>
            <div class="modal-body" id="ndcFornecedorBody"></div>
          </div>
        </div>
      </div>
      <div class="modal fade" id="ndcModalAjuda" tabindex="-1">
        <div class="modal-dialog">
          <div class="modal-content">
            <div class="modal-header"><h5 class="modal-title">Ajuda — Devolução de Compra</h5>
              <button type="button" class="btn-close" data-bs-dismiss="modal"></button></div>
            <div class="modal-body small">
              <p>Localize a NF-e original do fornecedor pela chave ou pela compra, informe as quantidades a devolver (até o saldo) e emita a NF-e de devolução (finNFe = 4) referenciando a nota original.</p>
              <p class="mb-0">O saldo e a tributação vêm do servidor. Não é possível devolver quantidade acima do disponível.</p>
            </div>
          </div>
        </div>
      </div>
      <div class="modal fade" id="ndcModalConfirmar" tabindex="-1" data-bs-backdrop="static">
        <div class="modal-dialog">
          <div class="modal-content">
            <div class="modal-header"><h5 class="modal-title">Emitir NF-e de Devolução?</h5>
              <button type="button" class="btn-close" data-bs-dismiss="modal"></button></div>
            <div class="modal-body" id="ndcConfirmarBody"></div>
            <div class="modal-footer">
              <button type="button" class="btn btn-outline-secondary" data-bs-dismiss="modal">Cancelar</button>
              <button type="button" class="btn btn-danger" id="btnNdcConfirmarEmissao">Confirmar Emissão</button>
            </div>
          </div>
        </div>
      </div>`;
  }

  function pintarValidacao() {
    const el = document.getElementById('ndcMsgValidacao');
    if (!el) return;
    const msgs = errosValidacao(estado.prep);
    if (!msgs.length) {
      el.innerHTML = '';
      return;
    }
    el.innerHTML = msgs.map((m) => `<div class="alert alert-danger py-2 mb-1">${escapeHtml(m)}</div>`).join('');
  }

  function bindEventos() {
    $(document).off('click.ndcBc').on('click.ndcBc', '.cds-breadcrumb__link[data-page]', function (e) {
      e.preventDefault();
      if (typeof loadPage === 'function') loadPage($(this).data('page'));
    });
    $('#btnNdcAjuda').on('click', () => {
      const el = document.getElementById('ndcModalAjuda');
      if (window.bootstrap && el) bootstrap.Modal.getOrCreateInstance(el).show();
      else $(el).modal('show');
    });
    $('#btnNdcBuscarChave').on('click', buscarPorChave);
    $('#ndcChave').on('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); buscarPorChave(); } });
    $('#btnNdcAbrirPesquisa').on('click', abrirPesquisa);
    $('#btnNdcPesquisarOrigens').on('click', pesquisarOrigens);
    $('#btnNdcTrocarNfe').on('click', () => {
      estado.prep = null;
      estado.compraId = null;
      estado.itensUi = [];
      estado.etapa = 1;
      renderTela();
    });
    $('#btnNdcCopiarChaveOrigem, #btnNdcCopiarNFref').on('click', () => {
      copiarTexto(estado.prep && estado.prep.refNFe, 'Chave copiada.');
    });
    $('#btnNdcFornecedorCompleto').on('click', mostrarFornecedorCompleto);
    $('#btnNdcAvancar1').on('click', avancarParaItens);
    $('#btnNdcAvancar2').on('click', avancarParaRevisao);
    $('#btnNdcVoltar1').on('click', () => { estado.etapa = 1; renderTela(); });
    $('#btnNdcVoltar2').on('click', () => { estado.etapa = 2; renderTela(); });
    $('#btnNdcEmitir').on('click', abrirConfirmacao);
    $('#btnNdcConfirmarEmissao').on('click', confirmarEmissao);
    $('#btnNdcSelecionarTodos').on('click', selecionarTodos);
    $('#btnNdcFechar').on('click', () => { if (typeof loadPage === 'function') loadPage('nfe-central'); });
    $('#btnNdcVoltarRevisao').on('click', () => { estado.etapa = 3; renderTela(); });
    $('#btnNdcLifecycle, #btnNdcDetalhesRejeicao').on('click', carregarLifecycle);
    $('#btnNdcReenviar').on('click', reenviar);
    $('.ndc-sel').on('change', onToggleItem);
    $('.ndc-qtd').on('input', onQtdInput);
    $('.ndc-expand').on('click', function () {
      const extra = $(this).closest('.ndc-item-card').find('.ndc-item-extra');
      const open = extra.prop('hidden');
      extra.prop('hidden', !open);
      $(this).attr('aria-expanded', open ? 'true' : 'false');
    });
  }

  function mostrarFornecedorCompleto() {
    const f = estado.prep && estado.prep.compra && estado.prep.compra.fornecedor_completo;
    if (!f) return;
    $('#ndcFornecedorBody').html(`
      <p><strong>${escapeHtml(f.razao_social || '')}</strong></p>
      <p>CNPJ: ${escapeHtml(f.cnpj || '—')}<br>IE: ${escapeHtml(f.ie || '—')}</p>
      <p>${escapeHtml([f.rua, f.numero, f.bairro].filter(Boolean).join(', '))}<br>
      ${escapeHtml(f.municipio || '')} / ${escapeHtml(f.uf || '')} CEP ${escapeHtml(f.cep || '')}</p>`);
    const el = document.getElementById('ndcModalFornecedor');
    if (window.bootstrap && el) bootstrap.Modal.getOrCreateInstance(el).show();
    else $(el).modal('show');
  }

  function abrirPesquisa() {
    const el = document.getElementById('ndcModalPesquisa');
    if (window.bootstrap && el) bootstrap.Modal.getOrCreateInstance(el).show();
    else $(el).modal('show');
    pesquisarOrigens();
  }

  async function pesquisarOrigens() {
    const qs = new URLSearchParams();
    const chave = digits($('#ndcFiltroChave').val() || $('#ndcChave').val() || '');
    const numero = String($('#ndcFiltroNumero').val() || '').trim();
    const serie = String($('#ndcFiltroSerie').val() || '').trim();
    const fornecedor = String($('#ndcFiltroFornecedor').val() || '').trim();
    const data = String($('#ndcFiltroData').val() || '').trim();
    if (chave) qs.set('chave', chave);
    if (numero) qs.set('numero', numero);
    if (serie) qs.set('serie', serie);
    if (fornecedor) qs.set('fornecedor', fornecedor);
    if (data) qs.set('data', data);
    try {
      const resp = await fetch(`${API_URL}/compras/nfe-devolucao/origens?${qs}`, { headers: headersJson() });
      const dataJson = await resp.json().catch(() => ({}));
      const rows = dataJson.origens || [];
      estado.buscaOrigens = rows;
      if (!rows.length) {
        $('#ndcPesquisaBody').html('<tr><td colspan="7" class="text-center text-muted">Nenhuma NF-e encontrada.</td></tr>');
        return;
      }
      $('#ndcPesquisaBody').html(rows.map((r) => `
        <tr>
          <td>${escapeHtml(r.numero || '—')}</td>
          <td>${escapeHtml(r.serie || '—')}</td>
          <td>${escapeHtml(fmtData(r.data))}</td>
          <td>${escapeHtml(r.fornecedor || '—')}</td>
          <td>${fmtMoney(r.valor)}</td>
          <td>${escapeHtml(r.status || '—')}</td>
          <td><button type="button" class="btn btn-sm btn-primary ndc-sel-origem" data-id="${r.compraId}">Selecionar</button></td>
        </tr>`).join(''));
      $('.ndc-sel-origem').on('click', function () {
        const id = Number($(this).data('id'));
        const el = document.getElementById('ndcModalPesquisa');
        if (window.bootstrap && el) bootstrap.Modal.getInstance(el)?.hide();
        else $(el).modal('hide');
        carregarCompra(id);
      });
    } catch (err) {
      alertar(err.message || 'Falha ao pesquisar.', 'danger');
    }
  }

  async function buscarPorChave() {
    const chave = digits($('#ndcChave').val());
    if (chave && chave.length !== 44) {
      $('#ndcMsgValidacao').html('<div class="alert alert-danger py-2">Chave de acesso inválida.</div>');
      return;
    }
    if (!chave) {
      $('#ndcMsgValidacao').html('<div class="alert alert-warning py-2">Informe a chave de acesso.</div>');
      return;
    }
    try {
      const resp = await fetch(`${API_URL}/compras/nfe-devolucao/origens?chave=${encodeURIComponent(chave)}`, { headers: headersJson() });
      const dataJson = await resp.json().catch(() => ({}));
      const rows = dataJson.origens || [];
      if (!rows.length) {
        $('#ndcMsgValidacao').html('<div class="alert alert-danger py-2">NF-e inexistente.</div>');
        return;
      }
      await carregarCompra(rows[0].compraId);
    } catch (err) {
      alertar(err.message || 'Falha ao buscar NF-e.', 'danger');
    }
  }

  async function carregarCompra(compraId) {
    try {
      const resp = await fetch(`${API_URL}/compras/${compraId}/nfe-devolucao/preparar`, { headers: headersJson() });
      const prep = await resp.json().catch(() => ({}));
      if (!resp.ok || prep.success === false) {
        alertar(prep.error || 'Não foi possível carregar a NF-e.', 'warning');
        estado.prep = prep.compra ? prep : { validacaoOrigem: { ok: false, erros: [{ mensagem: prep.error || 'NF-e inexistente.' }] } };
        renderTela();
        return;
      }
      estado.compraId = compraId;
      estado.prep = prep;
      estado.itensUi = montarItensUi(prep);
      estado.cfop = prep.cfopSugerido || '5202';
      estado.observacoes = (prep.rascunho && prep.rascunho.observacoes) || estado.observacoes || '';
      estado.etapa = 1;
      renderTela();
    } catch (err) {
      alertar(err.message || 'Erro ao preparar devolução.', 'danger');
    }
  }

  function avancarParaItens() {
    if (!estado.prep) {
      alertar('Selecione a NF-e original antes de avançar.', 'warning');
      return;
    }
    if (!origemValidaParaAvancar(estado.prep)) {
      const msg = errosValidacao(estado.prep)[0] || 'Esta NF-e não pode ser utilizada para devolução.';
      alertar(msg, 'warning');
      pintarValidacao();
      return;
    }
    estado.etapa = 2;
    renderTela();
  }

  async function avancarParaRevisao() {
    estado.observacoes = String($('#ndcObservacoes').val() || estado.observacoes || '');
    const itens = itensSelecionadosPayload();
    if (!itens.length) {
      alertar('Selecione ao menos um item com quantidade a devolver.', 'warning');
      return;
    }
    if (estado.qtdErro) {
      alertar(estado.qtdErro, 'warning');
      return;
    }
    try {
      const resp = await fetch(`${API_URL}/compras/${estado.compraId}/nfe-devolucao/previa`, {
        method: 'POST',
        headers: headersJson(),
        body: JSON.stringify({
          itens,
          observacoes: estado.observacoes,
          cfop: estado.cfop,
          refNFe: estado.prep.refNFe
        })
      });
      const previa = await resp.json().catch(() => ({}));
      if (!resp.ok || previa.success === false) {
        alertar(previa.error || 'Não foi possível gerar a revisão fiscal.', 'warning');
        return;
      }
      estado.previa = previa;
      estado.etapa = 3;
      renderTela();
    } catch (err) {
      alertar(err.message || 'Erro na prévia.', 'danger');
    }
  }

  function persistFormItens() {
    const obs = document.getElementById('ndcObservacoes');
    if (obs) estado.observacoes = String(obs.value || '');
  }

  function selecionarTodos() {
    persistFormItens();
    estado.itensUi.forEach((it) => {
      if (Number(it.saldo) > 0) {
        it.selecionado = true;
        it.qtdDevolver = Number(it.saldo);
      }
    });
    estado.qtdErro = '';
    renderTela();
  }

  function onToggleItem() {
    persistFormItens();
    const idx = Number($(this).closest('[data-idx]').data('idx'));
    const it = estado.itensUi[idx];
    if (!it) return;
    it.selecionado = this.checked;
    if (it.selecionado) it.qtdDevolver = Number(it.saldo || 0);
    else it.qtdDevolver = 0;
    estado.qtdErro = '';
    renderTela();
  }

  function onQtdInput() {
    const idx = Number($(this).closest('[data-idx]').data('idx'));
    const it = estado.itensUi[idx];
    if (!it) return;
    const raw = Number(String(this.value).replace(',', '.'));
    const saldo = Number(it.saldo || 0);
    if (!Number.isFinite(raw) || raw < 0) {
      it.qtdDevolver = 0;
      estado.qtdErro = '';
      atualizarTotaisDom();
      return;
    }
    if (raw > saldo + 1e-9) {
      estado.qtdErro = 'Quantidade superior ao saldo disponível.';
      it.qtdDevolver = saldo;
      this.value = saldo;
      $('#ndcMsgQtd').text(estado.qtdErro);
      return;
    }
    estado.qtdErro = '';
    it.qtdDevolver = raw;
    if (raw === 0) it.selecionado = false;
    else it.selecionado = true;
    $('#ndcMsgQtd').text('');
    atualizarTotaisDom();
  }

  function atualizarTotaisDom() {
    const tot = totaisLocais();
    const el = document.getElementById('ndcTotais');
    if (!el) return;
    el.innerHTML = `
      <div class="d-flex justify-content-between"><span>Quantidade de itens</span><strong>${tot.qtdItens}</strong></div>
      <div class="d-flex justify-content-between"><span>Valor dos produtos</span><strong>${fmtMoney(tot.vProd)}</strong></div>
      <div class="d-flex justify-content-between"><span>Desconto</span><strong>${fmtMoney(tot.vDesc)}</strong></div>
      <div class="d-flex justify-content-between"><span>Frete</span><strong>${fmtMoney(tot.vFrete)}</strong></div>
      <hr>
      <div class="d-flex justify-content-between"><span>Valor total da NF-e</span><strong>${fmtMoney(tot.vNF)}</strong></div>`;
  }

  function abrirConfirmacao() {
    if (emitindo) return;
    const c = estado.prep.compra;
    const tot = totaisLocais();
    $('#ndcConfirmarBody').html(`
      <p>Fornecedor: <strong>${escapeHtml(c.fornecedor || '')}</strong></p>
      <p>NF original: nº ${escapeHtml(c.numero_nf || '')} série ${escapeHtml(c.serie_nf || '')}</p>
      <p>Quantidade de itens: <strong>${tot.qtdItens}</strong></p>
      <p>Valor total: <strong>${fmtMoney(tot.vNF)}</strong></p>`);
    const el = document.getElementById('ndcModalConfirmar');
    if (window.bootstrap && el) bootstrap.Modal.getOrCreateInstance(el).show();
    else $(el).modal('show');
  }

  async function confirmarEmissao() {
    if (emitindo) return;
    const el = document.getElementById('ndcModalConfirmar');
    if (window.bootstrap && el) bootstrap.Modal.getInstance(el)?.hide();
    else $(el).modal('hide');
    emitindo = true;
    estado.etapa = 4;
    renderTela();
    animarFases();
    const itens = itensSelecionadosPayload();
    try {
      const resp = await fetch(`${API_URL}/compras/${estado.compraId}/emitir-nfe-devolucao`, {
        method: 'POST',
        headers: headersJson(),
        body: JSON.stringify({
          itens,
          observacoes: estado.observacoes,
          cfop: estado.cfop,
          refNFe: estado.prep.refNFe
        })
      });
      const data = await resp.json().catch(() => ({}));
      const r = data.resultado || data;
      estado.resultado = {
        ...r,
        notaId: data.notaId || r.notaId || r.idNota,
        numero: data.numero || r.numero,
        serie: data.serie || r.serie,
        chaveAcesso: data.chaveAcesso || r.chaveAcesso || r.chave,
        protocolo: data.protocolo || r.protocolo,
        status: data.status || r.status,
        cStat: data.cStat || r.cStat,
        xMotivo: data.xMotivo || r.xMotivo,
        success: r.success,
        message: data.mensagem || data.message || r.message
      };
      const st = String(estado.resultado.status || '').toLowerCase();
      if (st === 'aguardando_retorno' || st === 'lote_enviado' || st === 'processando' || String(estado.resultado.cStat) === '103') {
        await acompanharLifecycle(estado.resultado.notaId);
      }
      estado.etapa = 5;
      renderTela();
    } catch (err) {
      estado.resultado = { success: false, status: 'erro', message: err.message };
      estado.etapa = 5;
      renderTela();
    } finally {
      emitindo = false;
    }
  }

  function animarFases() {
    const fases = ['Gerando XML...', 'Assinando...', 'Validando...', 'Enviando para SEFAZ...', 'Aguardando retorno...'];
    let i = 0;
    const tick = () => {
      i = Math.min(i + 1, fases.length - 1);
      $('#ndcFaseEmissao').text(fases[i]);
      if (i < fases.length - 1 && emitindo) setTimeout(tick, 450);
    };
    setTimeout(tick, 400);
  }

  async function acompanharLifecycle(notaId) {
    if (!notaId) return;
    for (let i = 0; i < 8; i += 1) {
      try {
        const resp = await fetch(`${API_URL}/compras/nfe-devolucao/${notaId}/status`, { headers: headersJson() });
        const painel = await resp.json().catch(() => ({}));
        const st = String(painel.status || '').toLowerCase();
        if (st === 'autorizada' || st === 'rejeitada' || st === 'cancelada' || st === 'denegada') {
          estado.resultado = { ...estado.resultado, ...painel, chaveAcesso: painel.chave, success: st === 'autorizada' };
          return;
        }
        if (st === 'aguardando_retorno' || st === 'lote_enviado') {
          await fetch(`${API_URL}/compras/nfe-devolucao/${notaId}/consultar`, {
            method: 'POST',
            headers: headersJson(),
            body: '{}'
          }).catch(() => null);
        }
      } catch (_) { /* ignore */ }
      await new Promise((r) => setTimeout(r, 1500));
    }
  }

  async function carregarLifecycle() {
    const notaId = estado.resultado && (estado.resultado.notaId || estado.resultado.id);
    if (!notaId) return;
    try {
      const resp = await fetch(`${API_URL}/compras/nfe-devolucao/${notaId}/eventos`, { headers: headersJson() });
      const data = await resp.json().catch(() => ({}));
      const ev = data.eventos || [];
      $('#ndcLifecycleBox').html(`
        <h6>Lifecycle</h6>
        <ul class="small mb-0">${ev.map((e) => `<li>${escapeHtml(e.evento || e.status || e.tipo || '')} — ${escapeHtml(e.mensagem || e.xMotivo || e.created_at || '')}</li>`).join('') || '<li>Sem eventos.</li>'}</ul>`);
    } catch (err) {
      alertar(err.message || 'Falha ao carregar lifecycle.', 'danger');
    }
  }

  async function reenviar() {
    const notaId = estado.resultado && estado.resultado.notaId;
    if (!notaId || emitindo) return;
    emitindo = true;
    estado.etapa = 4;
    renderTela();
    try {
      const resp = await fetch(`${API_URL}/compras/nfe-devolucao/${notaId}/reenviar`, {
        method: 'POST',
        headers: headersJson(),
        body: '{}'
      });
      const data = await resp.json().catch(() => ({}));
      estado.resultado = { ...estado.resultado, ...(data.resultado || data), notaId };
      estado.etapa = 5;
      renderTela();
    } catch (err) {
      alertar(err.message || 'Falha ao reenviar.', 'danger');
      estado.etapa = 5;
      renderTela();
    } finally {
      emitindo = false;
    }
  }

  function loadNfeDevolucaoCompra() {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
    const pre = Number(window.__CDS_NFE_DEVOLUCAO_COMPRA_ID || 0) || null;
    window.__CDS_NFE_DEVOLUCAO_COMPRA_ID = null;
    estado = estadoInicial();
    renderTela();
    if (pre) carregarCompra(pre);
  }

  window.loadNfeDevolucaoCompra = loadNfeDevolucaoCompra;
  window.abrirTelaNfeDevolucaoCompra = function (compraId) {
    window.__CDS_NFE_DEVOLUCAO_COMPRA_ID = compraId || null;
    if (typeof loadPage === 'function') loadPage('nfe-devolucao-compra');
    else loadNfeDevolucaoCompra();
  };
})();
