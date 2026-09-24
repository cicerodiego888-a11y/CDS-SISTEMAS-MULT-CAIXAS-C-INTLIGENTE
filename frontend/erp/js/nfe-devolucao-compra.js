/**
 * RC6 — Tela dedicada de NF-e de Devolução de Compra.
 * Consome preparar / previa / emitir / lifecycle existentes (RC1–RC4).
 * Não recalcula saldo nem tributos no frontend.
 */

function normalizarTextoBuscaNdc(texto) {
  return String(texto == null ? '' : texto)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function itemCorrespondeBuscaNdc(item, termo) {
  const q = normalizarTextoBuscaNdc(termo);
  if (!q) return true;
  const codigo = normalizarTextoBuscaNdc(item && (item.produto_codigo || item.codigo));
  const nome = normalizarTextoBuscaNdc(item && (item.produto_nome || item.descricao || item.descricao_produto));
  const composto = `${codigo} ${nome}`.trim();
  const tokens = q.split(' ').filter(Boolean);
  if (!tokens.length) return true;
  return tokens.every((t) => composto.indexOf(t) !== -1);
}

function filtrarItensVisiveisNdc(itens, termo) {
  const lista = Array.isArray(itens) ? itens : [];
  return lista
    .map((item, idx) => ({ item, idx }))
    .filter((row) => itemCorrespondeBuscaNdc(row.item, termo));
}

function parseNumeroUiNdc(valor) {
  if (typeof valor === 'number' && Number.isFinite(valor)) return valor;
  const s = String(valor == null ? '' : valor).trim().replace(/\s/g, '');
  if (!s) return NaN;
  if (s.indexOf(',') >= 0 && s.indexOf('.') >= 0) {
    return Number(s.replace(/\./g, '').replace(',', '.'));
  }
  return Number(s.replace(',', '.'));
}

function aplicarEdicaoItemUiNdc(item, patch) {
  if (!item) return null;
  if (patch && patch.valor_unitario != null && Number.isFinite(Number(patch.valor_unitario))) {
    item.valor_unitario = Number(patch.valor_unitario);
  }
  if (patch && patch.qtdDevolver != null && Number.isFinite(Number(patch.qtdDevolver))) {
    item.qtdDevolver = Number(patch.qtdDevolver);
  }
  if (patch && patch.selecionado != null) {
    item.selecionado = Boolean(patch.selecionado);
  }
  const qtd = Number(item.qtdDevolver || 0);
  const vu = Number(item.valor_unitario || 0);
  item.valor_total = Math.round(qtd * vu * 100) / 100;
  return item;
}

function aplicarFiltroSemRecriarEstadoNdc(itensUi, termo) {
  return {
    estado: itensUi,
    visiveis: filtrarItensVisiveisNdc(itensUi, termo)
  };
}

function classificarResultadoEmissaoNfe(r) {
  if (typeof require === 'function') {
    try {
      return require('../../../backend/services/fiscal/classificarResultadoEmissaoNfe')
        .classificarResultadoEmissaoNfe(r);
    } catch (_) { /* browser: cai no fallback */ }
  }
  const st = String((r && (r.status || r.code)) || '').toLowerCase();
  const cStat = r && String(r.cStat || r.cstat_retorno || r.rejeicao_codigo || '').trim();
  const cStatOk = cStat && /^\d+$/.test(cStat) ? cStat : null;
  const xMotivo = r && (r.xMotivo || r.message || r.error || null);
  if (r && (r.success === true || (st === 'autorizada' && r.success !== false))) {
    return { classe: 'SUCCESS', titulo: 'NF-e autorizada', cStat: cStatOk, xMotivo, rejeicaoSefaz: false };
  }
  if (cStatOk && (Number(cStatOk) >= 200 || Number(cStatOk) === 110)) {
    return { classe: 'REJECTED_BY_SEFAZ', titulo: 'NF-e rejeitada pela SEFAZ', cStat: cStatOk, xMotivo, rejeicaoSefaz: true };
  }
  if (st === 'rejeitada' && !cStatOk) {
    return { classe: 'PROCESSING_ERROR', titulo: 'Não foi possível emitir a NF-e', cStat: null, xMotivo, rejeicaoSefaz: false };
  }
  if (st === 'erro_comunicacao') {
    return { classe: 'COMMUNICATION_ERROR', titulo: 'Falha na comunicação com a SEFAZ', cStat: null, xMotivo, rejeicaoSefaz: false };
  }
  if (st === 'erro_validacao' || st === 'erro_assinatura' || st === 'erro' || st === 'saldo_zerado') {
    return { classe: 'VALIDATION_ERROR', titulo: 'Não foi possível emitir a NF-e', cStat: null, xMotivo, rejeicaoSefaz: false };
  }
  return { classe: 'PROCESSING_ERROR', titulo: 'Não foi possível emitir a NF-e', cStat: null, xMotivo, rejeicaoSefaz: false };
}

function normalizarPayloadEmissaoNfe(data) {
  if (typeof require === 'function') {
    try {
      return require('../../../backend/services/fiscal/classificarResultadoEmissaoNfe')
        .normalizarPayloadEmissaoNfe(data);
    } catch (_) { /* browser */ }
  }
  const r = (data && data.resultado) || data || {};
  const base = {
    success: r.success === true || (data && data.status === 'autorizada'),
    status: (data && data.status) || r.status || (data && data.code) || r.code || null,
    code: (data && data.code) || r.code || null,
    notaId: (data && data.notaId) || r.notaId || r.idNota || null,
    numero: (data && data.numero) || r.numero || null,
    serie: (data && data.serie) || r.serie || null,
    chaveAcesso: (data && data.chaveAcesso) || r.chaveAcesso || r.chave || null,
    protocolo: (data && data.protocolo) || r.protocolo || null,
    recibo: (data && data.recibo) || r.recibo || null,
    cStat: (data && data.cStat) || r.cStat || r.cstat_retorno || null,
    xMotivo: (data && (data.xMotivo || data.mensagem || data.message || data.error))
      || r.xMotivo || r.message || r.error || null,
    message: (data && (data.mensagem || data.message || data.error)) || r.message || r.error || null
  };
  return Object.assign(base, classificarResultadoEmissaoNfe(base));
}

if (typeof module === 'object' && module.exports) {
  module.exports = {
    normalizarTextoBuscaNdc,
    itemCorrespondeBuscaNdc,
    filtrarItensVisiveisNdc,
    parseNumeroUiNdc,
    aplicarEdicaoItemUiNdc,
    aplicarFiltroSemRecriarEstadoNdc,
    classificarResultadoEmissaoNfe,
    normalizarPayloadEmissaoNfe
  };
}

if (typeof window === 'undefined' || typeof document === 'undefined') {
  /* helpers apenas — testes Node não executam a UI */
} else (function () {
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
      buscaOrigens: [],
      buscaItens: '',
      devolucaoRelacionada: null
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
    if (prep.rascunho && prep.rascunho.origem_nfe_devolucao_id) return true;
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
    const rascunhoMap = new Map(
      ((prep.rascunho && prep.rascunho.itens) || []).map((r) => [Number(r.compra_item_id), r])
    );
    return merged.map((it) => {
      const r = rascunhoMap.get(Number(it.compra_item_id));
      const saldo = Number(it.saldo != null ? it.saldo : it.quantidade_maxima || 0);
      const qtdRasc = r ? Number(r.quantidade || 0) : 0;
      const editavelRascunho = Boolean(it.editavel_rascunho || (prep.rascunho && prep.rascunho.origem_nfe_devolucao_id));
      return {
        ...it,
        valor_unitario_original: r && r.valor_unitario != null ? Number(r.valor_unitario) : Number(it.valor_unitario || 0),
        valor_unitario: r && r.valor_unitario != null ? Number(r.valor_unitario) : Number(it.valor_unitario || 0),
        n_item_origem: (r && r.n_item_origem) || it.n_item_origem || it.nItemOrigem || null,
        selecionado: qtdRasc > 0,
        qtdDevolver: qtdRasc > 0 ? qtdRasc : 0,
        saldo,
        editavelRascunho,
        qtdMax: editavelRascunho
          ? Number(it.quantidade_comprada || it.quantidade_maxima || qtdRasc || saldo || 0)
          : saldo
      };
    });
  }

  function itensSelecionadosPayload() {
    return estado.itensUi
      .filter((it) => it.selecionado && Number(it.qtdDevolver) > 0)
      .map((it) => ({
        compra_item_id: it.compra_item_id,
        produto_id: it.produto_id,
        quantidade: Number(it.qtdDevolver),
        valor_unitario: Number(it.valor_unitario),
        n_item_origem: it.n_item_origem || it.nItemOrigem || undefined
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
    const disabled = !(saldo > 0) && !it.editavelRascunho;
    const qtd = disabled ? 0 : Number(it.qtdDevolver || 0);
    const vu = Number(it.valor_unitario || 0);
    const total = qtd * vu;
    const qtdMax = Number(it.qtdMax != null ? it.qtdMax : saldo);
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
            data-field="quantidade" data-idx="${idx}"
            value="${qtd}" ${disabled || !it.selecionado ? 'disabled' : ''} max="${qtdMax}">
        </td>
        <td class="text-end">
          <input type="number" min="0" step="0.01" class="form-control form-control-sm ndc-vu"
            data-field="valor-unitario" data-idx="${idx}"
            value="${vu}" ${disabled || !it.selecionado ? 'disabled' : ''} title="Valor unitário">
        </td>
        <td class="text-end ndc-total-item">${fmtMoney(total)}</td>
      </tr>`;
  }

  function renderCardItemMobile(it, idx) {
    const saldo = Number(it.saldo || 0);
    const disabled = !(saldo > 0) && !it.editavelRascunho;
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
              data-field="quantidade" data-idx="${idx}"
              value="${qtd}" ${disabled || !it.selecionado ? 'disabled' : ''} max="${Number(it.qtdMax != null ? it.qtdMax : saldo)}">
            <label class="form-label small mb-0 mt-1">Valor unitário</label>
            <input type="number" min="0" step="0.01" class="form-control form-control-sm ndc-vu"
              data-field="valor-unitario" data-idx="${idx}"
              value="${Number(it.valor_unitario || 0)}" ${disabled || !it.selecionado ? 'disabled' : ''}>
            <div class="small mt-1">Total ${fmtMoney(qtd * Number(it.valor_unitario || 0))}</div>
          </div>
        </div>
      </div>`;
  }

  function rotuloContadorBusca(visiveis, total, termo) {
    const t = Number(total) || 0;
    const v = Number(visiveis) || 0;
    if (!normalizarTextoBuscaNdc(termo)) return `${t} ${t === 1 ? 'item' : 'itens'}`;
    if (v === 0) return `Nenhum item encontrado de ${t}`;
    if (v === 1) return `1 item encontrado de ${t}`;
    return `${v} itens encontrados de ${t}`;
  }

  function renderEtapaItens() {
    const visiveis = filtrarItensVisiveisNdc(estado.itensUi, estado.buscaItens);
    const linhas = visiveis.map((row) => renderLinhaItem(row.item, row.idx)).join('');
    const cards = visiveis.map((row) => renderCardItemMobile(row.item, row.idx)).join('');
    const trib = estado.prep && estado.prep.tributacaoOriginal;
    const tribHtml = trib ? Object.keys(trib).map((k) => {
      const info = trib[k] || {};
      return `<li><strong>${escapeHtml(k)}</strong> — ${escapeHtml(info.texto || (info.presente ? 'Presente' : 'Não existente na NF-e original.'))}</li>`;
    }).join('') : '<li class="text-muted">Tributação original será exibida após carregar a NF-e.</li>';
    const tot = totaisLocais();
    const chave = estado.prep && (estado.prep.refNFe || (estado.prep.compra && estado.prep.compra.chave_acesso));
    return `
      ${renderResumoDuplicacao()}
      <div class="card shadow-sm mb-3">
        <div class="card-header d-flex justify-content-between align-items-center">
          <span class="fw-semibold">Itens da NF-e para Devolução</span>
          <button type="button" class="btn btn-sm btn-outline-primary" id="btnNdcSelecionarTodos">Selecionar todos</button>
        </div>
        <div class="card-body">
          <div class="d-flex flex-wrap align-items-center gap-2 mb-2">
            <div class="input-group flex-grow-1" style="min-width:220px;">
              <span class="input-group-text"><i class="fas fa-search"></i></span>
              <input type="search" id="ndcBuscaItens" class="form-control"
                placeholder="Buscar por código ou descrição..."
                value="${escapeHtml(estado.buscaItens || '')}"
                autocomplete="off">
              <button type="button" class="btn btn-outline-secondary" id="btnNdcLimparBusca"
                ${normalizarTextoBuscaNdc(estado.buscaItens) ? '' : 'disabled'}>Limpar</button>
            </div>
          </div>
          <div id="ndcBuscaContador" class="small text-muted mb-2">${rotuloContadorBusca(visiveis.length, estado.itensUi.length, estado.buscaItens)}</div>
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
              <tbody>${linhas || `<tr><td colspan="13" class="text-center text-muted">${
                normalizarTextoBuscaNdc(estado.buscaItens)
                  ? 'Nenhum produto encontrado para a busca.'
                  : 'Nenhum item'
              }</td></tr>`}</tbody>
            </table>
          </div>
          <div class="ndc-itens-cards">${cards}</div>
          <div id="ndcMsgQtd" class="text-danger small mt-1">${escapeHtml(estado.qtdErro || '')}</div>
          <label class="form-label mt-3 fw-semibold">INFORMAÇÕES COMPLEMENTARES DA NF-e</label>
          <textarea class="form-control" id="ndcObservacoes" rows="4"
            placeholder="Texto gravado em infAdic/infCpl do XML...">${escapeHtml(estado.observacoes)}</textarea>
          <div class="form-text">Este texto é persistido no rascunho e enviado no XML (infCpl).</div>
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

  function renderDevolucaoRelacionada() {
    const rel = estado.devolucaoRelacionada || (estado.prep && estado.prep.devolucaoRelacionada);
    if (!rel) return '';
    return `
      <div class="card shadow-sm mb-3 border-primary">
        <div class="card-header fw-semibold">DEVOLUÇÃO RELACIONADA</div>
        <div class="card-body small">
          <div>NF-e anterior: <strong>${escapeHtml(rel.nfAnterior || '—')}</strong></div>
          <div>Série: <strong>${escapeHtml(rel.serie || '—')}</strong></div>
          <div class="text-break">Chave: ${escapeHtml(rel.chave || '—')}</div>
          <div>Status SEFAZ: <strong>${escapeHtml(rel.statusSefaz || 'AUTORIZADA')}</strong></div>
          <hr>
          <div>Manifestação: <strong>${escapeHtml(rel.manifestacao || '210240 — Operação não Realizada')}</strong></div>
          <div>Relação: <strong>${escapeHtml(rel.relacao || 'SUBSTITUIÇÃO OPERACIONAL')}</strong></div>
          <div class="mt-2 text-muted">${escapeHtml(rel.aviso || 'A NF-e anterior permanece AUTORIZADA na SEFAZ.')}</div>
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
      ${renderDevolucaoRelacionada()}
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
      <div class="card shadow-sm mb-3">
        <div class="card-header fw-semibold">INFORMAÇÕES COMPLEMENTARES DA NF-e</div>
        <div class="card-body">
          <textarea class="form-control" id="ndcObservacoes" rows="4">${escapeHtml(estado.observacoes)}</textarea>
          <div class="form-text">O valor editado é gravado em infAdic/infCpl do XML da nova NF-e.</div>
        </div>
      </div>
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
    const cls = classificarResultadoEmissaoNfe(r);
    const notaId = r.notaId || r.idNota;
    if (cls.classe === 'SUCCESS') {
      return `
        <div class="card shadow-sm">
          <div class="card-body">
            <h5>🟢 NF-e autorizada</h5>
            <div>Número: <strong>${escapeHtml(r.numero || '—')}</strong> · Série <strong>${escapeHtml(r.serie || '—')}</strong></div>
            <div class="text-break">Chave: ${escapeHtml(r.chaveAcesso || r.chave || '—')}</div>
            <div>Protocolo: ${escapeHtml(r.protocolo || '—')}</div>
            <div>Data/hora: ${escapeHtml(fmtDataHora(r.autorizadoEm || r.dataHora || new Date().toISOString()))}</div>
            <div class="d-flex flex-wrap gap-2 mt-3">
              ${notaId ? `<button type="button" class="btn btn-outline-secondary" id="btnNdcXml">Baixar XML</button>` : ''}
              ${notaId ? `<button type="button" class="btn btn-outline-secondary" id="btnNdcDanfe">Imprimir DANFE</button>` : ''}
              ${notaId ? `<button type="button" class="btn btn-outline-primary" id="btnNdcLifecycle">Ver Lifecycle</button>` : ''}
              <button type="button" class="btn btn-primary" id="btnNdcFechar">Fechar</button>
            </div>
            <div id="ndcLifecycleBox" class="mt-3"></div>
          </div>
        </div>`;
    }
    const cStat = cls.rejeicaoSefaz ? (cls.cStat || r.cStat || '—') : (cls.cStat || '—');
    const motivo = cls.xMotivo || r.xMotivo || r.message || r.error || '—';
    const emoji = cls.classe === 'COMMUNICATION_ERROR' ? '🟠' : '🔴';
    const codigoLinha = cls.rejeicaoSefaz
      ? `<div>Código SEFAZ: <strong>${escapeHtml(cStat)}</strong></div>`
      : `<div class="small text-muted">Sem cStat da SEFAZ — esta falha ocorreu antes ou fora do retorno fiscal.</div>`;
    const cStatNorm = String(cStat || '').replace(/\D/g, '');
    const xmlEstruturalmenteInvalido = cStatNorm === '225';
    const podeReenviar = Boolean(notaId)
      && !xmlEstruturalmenteInvalido
      && (cls.classe === 'REJECTED_BY_SEFAZ' || cls.classe === 'COMMUNICATION_ERROR');
    return `
      <div class="card shadow-sm">
        <div class="card-body">
          <h5>${emoji} ${escapeHtml(cls.titulo)}</h5>
          ${codigoLinha}
          <div>Motivo: ${escapeHtml(motivo)}</div>
          ${cls.etapa ? `<div class="small text-muted">Etapa: ${escapeHtml(cls.etapa)}</div>` : ''}
          ${r.notaId || r.numero ? `<div class="small">Tentativa: nota ${escapeHtml(r.notaId || '—')} · nº ${escapeHtml(r.numero || '—')} série ${escapeHtml(r.serie || '—')}</div>` : ''}
          <div class="d-flex flex-wrap gap-2 mt-3">
            ${notaId ? `<button type="button" class="btn btn-outline-secondary" id="btnNdcDetalhesRejeicao">Ver detalhes</button>` : ''}
            ${notaId ? `<button type="button" class="btn btn-outline-success" id="btnNdcXml">Baixar XML</button>` : ''}
            <button type="button" class="btn btn-outline-primary" id="btnNdcVoltarRevisao">Voltar para revisão</button>
            ${podeReenviar ? `<button type="button" class="btn btn-danger" id="btnNdcReenviar">Reenviar</button>` : ''}
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
      estado.buscaItens = '';
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
    $('#btnNdcDanfe').on('click', imprimirDanfeDevolucao);
    $('#btnNdcXml').on('click', baixarXmlDevolucao);
    garantirDelegacaoItens();
    $('#ndcBuscaItens').on('keydown', onBuscaItensKeydown);
    $('#btnNdcLimparBusca').on('click', limparBuscaItens);
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
      estado.cfop = (prep.rascunho && prep.rascunho.cfop) || prep.cfopSugerido || '5202';
      estado.observacoes = (prep.rascunho && prep.rascunho.observacoes) || estado.observacoes || '';
      estado.devolucaoRelacionada = prep.devolucaoRelacionada || null;
      estado.etapa = window.__CDS_NFE_DEVOLUCAO_ABRIR_ITENS && prep.rascunho ? 2 : 1;
      window.__CDS_NFE_DEVOLUCAO_ABRIR_ITENS = false;
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
    persistFormItens();
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
          refNFe: estado.prep.refNFe,
          origemNfeDevolucaoId: (estado.prep.rascunho && (estado.prep.rascunho.origem_nfe_devolucao_id
            || estado.prep.rascunho.documento_original_id)) || null,
          chaveAnterior: estado.devolucaoRelacionada && estado.devolucaoRelacionada.chave
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

  let delegacaoItensAtiva = false;

  function garantirDelegacaoItens() {
    if (delegacaoItensAtiva) return;
    delegacaoItensAtiva = true;
    $(document)
      .off('.ndcItens')
      .on('input.ndcItens', '.ndc-qtd', onQtdInput)
      .on('input.ndcItens change.ndcItens', '.ndc-vu', onVuInput)
      .on('change.ndcItens', '.ndc-sel', onToggleItem)
      .on('input.ndcItens', '#ndcBuscaItens', onBuscaItensInput);
  }

  function elementoUiVisivel(el) {
    if (!el) return false;
    if (el.getClientRects && el.getClientRects().length > 0) return true;
    return !!(el.offsetWidth || el.offsetHeight);
  }

  function seletorItensEditaveisVisiveis() {
    const tabela = document.querySelector('.ndc-itens-table');
    if (tabela && elementoUiVisivel(tabela)) return '.ndc-itens-table .ndc-item-row';
    return '.ndc-itens-cards .ndc-item-card';
  }

  function persistFormItens() {
    const obs = document.getElementById('ndcObservacoes');
    if (obs) estado.observacoes = String(obs.value || '');
    const sel = seletorItensEditaveisVisiveis();
    document.querySelectorAll(sel).forEach((el) => {
      if (!elementoUiVisivel(el)) return;
      const idx = Number(el.getAttribute('data-idx'));
      const it = estado.itensUi[idx];
      if (!it) return;
      const qtdEl = el.querySelector('.ndc-qtd');
      const vuEl = el.querySelector('.ndc-vu');
      const patch = {};
      if (qtdEl) {
        const qtd = parseNumeroUiNdc(qtdEl.value);
        if (Number.isFinite(qtd) && qtd >= 0) patch.qtdDevolver = qtd;
      }
      if (vuEl) {
        const vu = parseNumeroUiNdc(vuEl.value);
        if (Number.isFinite(vu) && vu >= 0) patch.valor_unitario = vu;
      }
      aplicarEdicaoItemUiNdc(it, patch);
    });
  }

  function aplicarBuscaItens(valor, caret) {
    persistFormItens();
    estado.buscaItens = String(valor == null ? '' : valor);
    renderTela();
    const input = document.getElementById('ndcBuscaItens');
    if (!input) return;
    input.focus();
    const pos = caret != null ? caret : String(estado.buscaItens).length;
    try { input.setSelectionRange(pos, pos); } catch (_) { /* ignore */ }
  }

  function onBuscaItensInput() {
    const el = document.getElementById('ndcBuscaItens');
    aplicarBuscaItens(el ? el.value : '', el && el.selectionStart);
  }

  function onBuscaItensKeydown(e) {
    if (e.key === 'Escape') {
      e.preventDefault();
      limparBuscaItens();
    }
  }

  function limparBuscaItens() {
    aplicarBuscaItens('');
  }

  function renderResumoDuplicacao() {
    const r = estado.prep && estado.prep.rascunho;
    if (!r || !r.origem_nfe_devolucao_id) return '';
    const alterados = (estado.itensUi || []).filter((it) => {
      const orig = Number(it.valor_unitario_original != null ? it.valor_unitario_original : it.valor_unitario);
      return Number(it.valor_unitario) !== orig && it.selecionado;
    });
    const qtd = (r.itens || []).length;
    return `
      <div class="alert alert-info">
        <strong>Resumo da duplicação</strong>
        <div>NF base: ${escapeHtml(r.numero_base || r.origem_nfe_devolucao_id)}</div>
        <div>NF original: ${escapeHtml(r.numero_origem || (estado.prep.compra && estado.prep.compra.numero_nf) || '—')}</div>
        <div>Itens: ${qtd}</div>
        <div>Itens alterados (valor unitário nesta tela): ${alterados.length}</div>
        <div>Itens mantidos: ${Math.max(0, qtd - alterados.length)}</div>
        <div class="small mb-0">Rascunho independente. A NF-e original não foi alterada. Não há transmissão automática.</div>
      </div>`;
  }

  function selecionarTodos() {
    persistFormItens();
    // Atua sobre TODOS os itens da NF, inclusive os ocultos pelo filtro visual.
    estado.itensUi.forEach((it) => {
      const max = Number(it.qtdMax != null ? it.qtdMax : it.saldo);
      if (max > 0 || it.editavelRascunho) {
        it.selecionado = true;
        it.qtdDevolver = max > 0 ? max : Number(it.qtdDevolver || 0);
      }
    });
    estado.qtdErro = '';
    renderTela();
  }

  function resolverIdxItem(el) {
    const direto = el && el.getAttribute && el.getAttribute('data-idx');
    if (direto != null && direto !== '') return Number(direto);
    const host = el && el.closest && el.closest('[data-idx]');
    return host ? Number(host.getAttribute('data-idx')) : NaN;
  }

  function onToggleItem() {
    persistFormItens();
    const idx = resolverIdxItem(this);
    const it = estado.itensUi[idx];
    if (!it) return;
    it.selecionado = this.checked;
    if (it.selecionado) it.qtdDevolver = Number(it.saldo || 0);
    else it.qtdDevolver = 0;
    aplicarEdicaoItemUiNdc(it, { selecionado: it.selecionado, qtdDevolver: it.qtdDevolver });
    estado.qtdErro = '';
    renderTela();
  }

  function onQtdInput() {
    const idx = resolverIdxItem(this);
    const it = estado.itensUi[idx];
    if (!it) return;
    const raw = parseNumeroUiNdc(this.value);
    const saldo = Number(it.qtdMax != null ? it.qtdMax : it.saldo || 0);
    if (!Number.isFinite(raw) || raw < 0) {
      aplicarEdicaoItemUiNdc(it, { qtdDevolver: 0 });
      estado.qtdErro = '';
      atualizarTotaisDom();
      return;
    }
    if (raw > saldo + 1e-9) {
      estado.qtdErro = 'Quantidade superior ao saldo disponível.';
      aplicarEdicaoItemUiNdc(it, { qtdDevolver: saldo, selecionado: saldo > 0 });
      this.value = saldo;
      $('#ndcMsgQtd').text(estado.qtdErro);
      return;
    }
    estado.qtdErro = '';
    aplicarEdicaoItemUiNdc(it, { qtdDevolver: raw, selecionado: raw > 0 });
    $('#ndcMsgQtd').text('');
    atualizarTotaisDom();
  }

  function onVuInput() {
    const idx = resolverIdxItem(this);
    const it = estado.itensUi[idx];
    if (!it) return;
    const raw = parseNumeroUiNdc(this.value);
    aplicarEdicaoItemUiNdc(it, {
      valor_unitario: Number.isFinite(raw) && raw >= 0 ? raw : 0
    });
    atualizarTotaisDom();
    const row = this.closest('[data-idx]');
    const totalEl = row && row.querySelector('.ndc-total-item');
    if (totalEl) totalEl.textContent = fmtMoney(it.valor_total);
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
    const obsRev = document.getElementById('ndcObservacoes');
    if (obsRev) estado.observacoes = String(obsRev.value || estado.observacoes || '');
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
          refNFe: estado.prep.refNFe,
          origemNfeDevolucaoId: (estado.prep.rascunho && (estado.prep.rascunho.origem_nfe_devolucao_id
            || estado.prep.rascunho.documento_original_id)) || null,
          origem_nfe_devolucao_id: (estado.prep.rascunho && estado.prep.rascunho.origem_nfe_devolucao_id) || null,
          chaveAnterior: estado.devolucaoRelacionada && estado.devolucaoRelacionada.chave
        })
      });
      const data = await resp.json().catch(() => ({}));
      estado.resultado = normalizarPayloadEmissaoNfe(data);
      const st = String(estado.resultado.status || '').toLowerCase();
      if (st === 'aguardando_retorno' || st === 'lote_enviado' || st === 'processando' || String(estado.resultado.cStat) === '103') {
        await acompanharLifecycle(estado.resultado.notaId);
      }
      estado.etapa = 5;
      renderTela();
    } catch (err) {
      estado.resultado = normalizarPayloadEmissaoNfe({
        success: false,
        status: 'erro',
        error: err.message,
        message: err.message
      });
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

  function refDanfeAtual() {
    const r = estado.resultado || {};
    const notaId = r.notaId || r.idNota;
    return {
      tipo: 'DEVOLUCAO_COMPRA',
      id: Number(notaId),
      chave: r.chaveAcesso || r.chave || '',
      numero: r.numero,
      serie: r.serie
    };
  }

  function imprimirDanfeDevolucao() {
    const ref = refDanfeAtual();
    if (!ref.id) return;
    if (typeof abrirDanfe === 'function') {
      abrirDanfe({ ...ref, imprimir: true });
      return;
    }
    alertar('Visualizador de DANFE indisponível.', 'danger');
  }

  async function baixarXmlDevolucao() {
    const ref = refDanfeAtual();
    if (!ref.id) return;
    if (typeof baixarXmlNfe55 === 'function') {
      baixarXmlNfe55(ref);
      return;
    }
    try {
      const tipoXml = (estado.resultado && classificarResultadoEmissaoNfe(estado.resultado).classe === 'SUCCESS')
        ? 'autorizado'
        : 'assinado';
      const resp = await fetch(`${API_URL}/compras/nfe-devolucao/${ref.id}/xml?tipo=${tipoXml}`, {
        headers: headersJson()
      });
      if (!resp.ok) {
        const data = await resp.json().catch(() => ({}));
        throw new Error(data.error || 'XML indisponível.');
      }
      const blob = await resp.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `nfe-devolucao-${tipoXml}-${ref.chave || ref.id}.xml`;
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch (err) {
      alertar(err.message || 'Falha ao baixar XML.', 'danger');
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
      estado.resultado = normalizarPayloadEmissaoNfe({ ...data, notaId, resultado: data.resultado || data });
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
