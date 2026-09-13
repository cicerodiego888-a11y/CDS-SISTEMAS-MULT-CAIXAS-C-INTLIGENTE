/**
 * RC4.0.2 — Central de Faturamento (Painel Operacional Fiscal)
 * Tela inicial: fila + dashboard + SEFAZ + rejeições + eventos + lote
 * Detalhe: RC4.0.1 (pendências, timeline, documentos…)
 */
(function (global) {
  'use strict';

  const API = () => (typeof API_URL !== 'undefined' ? API_URL : '/api');
  const headersJson = () => ({
    'Content-Type': 'application/json',
    Authorization: `Bearer ${localStorage.getItem('token') || ''}`
  });

  let vista = 'painel'; // painel | detalhe
  let vendaAtualId = null;
  let pacoteAtual = null;
  let filtroAtual = 'todos';
  let buscaAtual = '';
  let selecao = new Set();
  let painelCache = null;

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function money(v) {
    return Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  }

  function fmtMs(ms) {
    if (ms == null || Number.isNaN(Number(ms))) return '—';
    const n = Number(ms);
    if (n < 1000) return `${Math.round(n)} ms`;
    return `${(n / 1000).toFixed(1)} s`;
  }

  function fmtData(d) {
    if (!d) return '—';
    return String(d).replace('T', ' ').slice(0, 19);
  }

  function badgeNivel(nivel) {
    if (nivel === 'ok' || nivel === 'concluido' || nivel === 'autorizada') return 'bg-success';
    if (nivel === 'atencao' || nivel === 'atual' || nivel === 'aguardando' || nivel === 'prontas') return 'bg-warning text-dark';
    if (nivel === 'erro' || nivel === 'rejeitada' || nivel === 'pendencias') return 'bg-danger';
    if (nivel === 'transmitida' || nivel === 'processando') return 'bg-info text-dark';
    if (nivel === 'cancelada') return 'bg-dark';
    return 'bg-secondary';
  }

  function iconeNivel(nivel) {
    if (nivel === 'ok' || nivel === 'concluido') return '🟢';
    if (nivel === 'atencao' || nivel === 'atual') return '🟡';
    if (nivel === 'erro') return '🔴';
    return '⚪';
  }

  function labelNivel(nivel) {
    if (nivel === 'ok') return 'OK';
    if (nivel === 'atencao') return 'Atenção';
    if (nivel === 'erro') return 'Erro';
    return nivel || '—';
  }

  function resolverVendaInicial() {
    const w = Number(global.__cdsCentralFatVendaId || 0) || 0;
    if (w > 0) return w;
    try { return Number(localStorage.getItem('cds_central_fat_venda_id') || 0) || 0; }
    catch (_) { return 0; }
  }

  function lerDadosFiscaisForm() {
    return {
      natureza_operacao: $('#cfNatureza').val() || 'VENDA DE MERCADORIA',
      cfop: $('#cfCfop').val() || '5102',
      transportadora: $('#cfTransportadora').val() || '',
      frete: Number($('#cfFrete').val() || 0),
      volumes: Number($('#cfVolumes').val() || 0),
      peso: Number($('#cfPeso').val() || 0),
      observacoes: $('#cfObs').val() || '',
      dados_adicionais: $('#cfDadosAdic').val() || ''
    };
  }

  function persistLocal(vendaId, dados) {
    try { localStorage.setItem(`cds_cf_dados_${vendaId}`, JSON.stringify(dados)); } catch (_) { /* */ }
  }

  function carregarLocal(vendaId) {
    try { return JSON.parse(localStorage.getItem(`cds_cf_dados_${vendaId}`) || 'null'); }
    catch (_) { return null; }
  }

  function alertar(msg, tipo) {
    const el = $('#cfAlert');
    if (!el.length) return;
    el.html(`<div class="alert alert-${tipo || 'info'} mb-0">${esc(msg)}</div>`);
  }

  /* ========== PAINEL ========== */

  function kpi(label, valor, extra) {
    return `<div class="col-6 col-md-3 col-xl">
      <div class="border rounded p-2 h-100 bg-white">
        <div class="text-muted small">${esc(label)}</div>
        <div class="fs-5 fw-semibold">${esc(valor)}</div>
        ${extra ? `<div class="small text-muted">${esc(extra)}</div>` : ''}
      </div>
    </div>`;
  }

  function renderDashboard(ind) {
    const i = ind || {};
    return `<div class="row g-2">
      ${kpi('Aguardando faturamento', i.aguardando_faturamento ?? 0)}
      ${kpi('Pendências fiscais', i.pendencias_fiscais ?? 0)}
      ${kpi('Autorizadas hoje', i.autorizadas_hoje ?? 0)}
      ${kpi('Rejeitadas', i.rejeitadas ?? 0)}
      ${kpi('Tempo médio emissão', fmtMs(i.tempo_medio_emissao_ms))}
      ${kpi('Tempo até autorização', fmtMs(i.tempo_medio_autorizacao_ms))}
      ${kpi('Reenvios', i.quantidade_reenvios ?? 0)}
      ${kpi('Última SEFAZ', fmtData(i.ultima_comunicacao_sefaz))}
    </div>`;
  }

  function renderSefaz(s) {
    if (!s) return '<span class="text-muted">—</span>';
    const ok = !!s.disponivel;
    return `
      <div class="d-flex justify-content-between align-items-start mb-2">
        <div>
          <div class="fw-semibold">Status da SEFAZ</div>
          <div class="small text-muted">Ambiente: ${esc(s.ambiente_label || '—')}</div>
        </div>
        <span class="badge ${ok ? 'bg-success' : 'bg-danger'}">${ok ? 'Disponível' : 'Indisponível'}</span>
      </div>
      <div class="row g-2 small">
        <div class="col-6"><strong>Homologação</strong><div>${s.homologacao ? 'Sim' : 'Não'}</div></div>
        <div class="col-6"><strong>Produção</strong><div>${s.producao ? 'Sim' : 'Não'}</div></div>
        <div class="col-6"><strong>Última comunicação</strong><div>${esc(fmtData(s.ultima_comunicacao))}</div></div>
        <div class="col-6"><strong>Tempo resposta</strong><div>${esc(fmtMs(s.tempo_resposta_ms))}</div></div>
        <div class="col-12"><strong>Último erro</strong><div>${esc(s.ultimo_erro || '—')}</div></div>
      </div>`;
  }

  function renderRejeicoes(itens) {
    if (!itens || !itens.length) {
      return '<p class="text-muted mb-0 small">Nenhuma rejeição agrupada.</p>';
    }
    return `<div class="table-responsive" style="max-height:220px;overflow:auto">
      <table class="table table-sm table-hover mb-0">
        <thead class="table-light"><tr>
          <th>Código</th><th>Descrição</th><th>Qtd</th><th>Última</th><th></th>
        </tr></thead>
        <tbody>${itens.map((r) => `
          <tr>
            <td><code>${esc(r.codigo)}</code></td>
            <td class="small">${esc(String(r.descricao || '').slice(0, 80))}</td>
            <td>${esc(r.quantidade)}</td>
            <td class="small">${esc(fmtData(r.ultima_ocorrencia))}</td>
            <td><button type="button" class="btn btn-sm btn-outline-danger cf-filtro-rapido" data-filtro="rejeitadas">Ver</button></td>
          </tr>`).join('')}</tbody>
      </table>
    </div>`;
  }

  function renderEventos(eventos) {
    if (!eventos || !eventos.length) {
      return '<p class="text-muted mb-0 small">Sem eventos recentes.</p>';
    }
    return `<div style="max-height:240px;overflow:auto" class="small">
      ${eventos.map((e) => `
        <div class="border-bottom py-1">
          <strong>${esc(e.usuario)}</strong> ${esc(e.acao_label || e.acao)}
          ${e.venda_id ? ` · venda #${esc(e.venda_id)}` : ''}
          ${e.nota_id ? ` · nota #${esc(e.nota_id)}` : ''}
          <div class="text-muted">${esc(e.data || '')} ${esc(e.hora || '')}</div>
        </div>`).join('')}
    </div>`;
  }

  function renderTiposDoc(tipos) {
    return `<div class="d-flex flex-wrap gap-1">${(tipos || []).map((t) =>
      `<span class="badge ${t.ativo ? 'bg-primary' : 'bg-light text-dark border'}">${esc(t.label)}${!t.ativo ? ' · em breve' : ''}</span>`
    ).join('')}</div>`;
  }

  function renderFiltros(filtros) {
    const lista = filtros || [];
    return `<div class="d-flex flex-wrap gap-1">${lista.map((f) => `
      <button type="button" class="btn btn-sm ${filtroAtual === f.id ? 'btn-primary' : 'btn-outline-secondary'} cf-filtro-rapido" data-filtro="${esc(f.id)}">${esc(f.label)}</button>
    `).join('')}</div>`;
  }

  function renderFilaTabela(itens) {
    if (!itens || !itens.length) {
      return '<p class="text-muted mb-0">Nenhum registro neste filtro.</p>';
    }
    return `<div class="table-responsive">
      <table class="table table-sm table-hover align-middle mb-0">
        <thead class="table-light">
          <tr>
            <th style="width:32px"><input type="checkbox" id="cfSelTodos"></th>
            <th>Pedido</th><th>Venda</th><th>Cliente</th><th>Valor</th><th>Data</th>
            <th>Sit. Comercial</th><th>Sit. Fiscal</th><th>Status NF-e</th>
            <th>Responsável</th><th>Última atualização</th><th>Ações</th>
          </tr>
        </thead>
        <tbody>${itens.map((r) => {
      const id = Number(r.venda_id);
      const checked = selecao.has(id) ? 'checked' : '';
      return `<tr>
            <td><input type="checkbox" class="cf-sel-venda" data-id="${id}" ${checked}></td>
            <td>#${esc(r.pedido_id || '—')}</td>
            <td>#${esc(r.venda_id)}</td>
            <td>${esc(r.cliente_nome || '—')}<div class="small text-muted">${esc(r.cliente_cpf || '')}</div></td>
            <td>${money(r.valor)}</td>
            <td class="small">${esc(fmtData(r.data))}</td>
            <td><span class="badge bg-secondary">${esc(r.situacao_comercial || '—')}</span></td>
            <td><span class="badge ${badgeNivel(r.situacao_fiscal)}">${esc(r.situacao_fiscal || '—')}</span></td>
            <td><span class="badge ${badgeNivel(r.status_nfe)}">${esc(r.status_nfe || '—')}</span></td>
            <td class="small">${esc(r.responsavel || '—')}</td>
            <td class="small">${esc(fmtData(r.ultima_atualizacao))}</td>
            <td class="text-nowrap">
              <button type="button" class="btn btn-sm btn-outline-primary cf-abrir-venda" data-id="${id}">Abrir</button>
            </td>
          </tr>`;
    }).join('')}</tbody>
      </table>
    </div>`;
  }

  function atualizarContadorSelecao() {
    $('#cfSelCount').text(selecao.size ? `${selecao.size} selecionada(s)` : '');
  }

  async function carregarPainel(silencioso) {
    const qs = new URLSearchParams({
      filtro: filtroAtual || 'todos',
      q: buscaAtual || '',
      limite: '150'
    }).toString();
    if (!silencioso) alertar('Atualizando painel…', 'info');
    const resp = await fetch(`${API()}/central-faturamento/painel?${qs}`, { headers: headersJson() });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(data.error || 'Falha ao carregar painel.');
    painelCache = data;

    $('#cfDashboard').html(renderDashboard(data.dashboard));
    $('#cfSefaz').html(renderSefaz(data.sefaz));
    $('#cfRejeicoes').html(renderRejeicoes(data.rejeicoes));
    $('#cfEventos').html(renderEventos(data.eventos));
    $('#cfTiposDoc').html(renderTiposDoc(data.tipos_documento));
    $('#cfFiltros').html(renderFiltros(data.filtros_disponiveis));
    $('#cfFilaOps').html(renderFilaTabela(data.fila?.itens || []));
    $('#cfFilaMeta').text(`${data.fila?.total || 0} registro(s) · atualizado ${fmtData(data.atualizado_em)}`);
    atualizarContadorSelecao();
    if (!silencioso) alertar('Painel atualizado.', 'success');
  }

  async function executarLote(acao) {
    const ids = Array.from(selecao);
    if (!ids.length) return alertar('Selecione vendas na fila.', 'warning');
    let body = { acao, venda_ids: ids };
    if (acao === 'cancelar') {
      const just = prompt('Justificativa do cancelamento (mín. 15 caracteres):');
      if (!just || just.trim().length < 15) return alertar('Justificativa inválida.', 'warning');
      body.justificativa = just;
    }
    alertar(`Executando ${acao} em ${ids.length} venda(s)…`, 'info');
    const resp = await fetch(`${API()}/central-faturamento/lote`, {
      method: 'POST', headers: headersJson(), body: JSON.stringify(body)
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok && !data.resultados) throw new Error(data.error || 'Falha no lote.');

    if (acao === 'exportar_xml' || acao === 'xml') {
      (data.resultados || []).forEach((r) => {
        if (r.success && r.resultado?.xml) {
          const blob = new Blob([r.resultado.xml], { type: 'application/xml' });
          const a = document.createElement('a');
          a.href = URL.createObjectURL(blob);
          a.download = `NFe-${r.resultado.chave || r.venda_id}.xml`;
          a.click();
        }
      });
    }
    if (acao === 'imprimir_danfe' || acao === 'danfe') {
      (data.resultados || []).forEach((r) => {
        if (r.success && r.resultado?.danfe_html) {
          const w = window.open('', '_blank');
          w.document.write(r.resultado.danfe_html);
          w.document.close();
        }
      });
    }

    alertar(`Lote ${acao}: ${data.ok || 0} ok · ${data.falhas || 0} falha(s).`, data.falhas ? 'warning' : 'success');
    selecao.clear();
    await carregarPainel(true);
  }

  function montarShellPainel(titulo) {
    $('#page-content').html(`
      <div class="container-fluid py-3">
        <div class="d-flex flex-wrap justify-content-between align-items-start gap-2 mb-2">
          <div>
            <h4 class="mb-1"><i class="fas fa-file-invoice-dollar text-primary"></i> ${esc(titulo)}</h4>
            <div class="text-muted small">Painel Operacional Fiscal · monitoramento em tempo real</div>
          </div>
          <div class="d-flex flex-wrap gap-2">
            <button type="button" class="btn btn-outline-secondary btn-sm" id="cfBtnVoltarExpedicao"><i class="fas fa-dolly"></i> Expedição</button>
            <button type="button" class="btn btn-outline-primary btn-sm" id="cfBtnAtualizar"><i class="fas fa-sync"></i> Atualizar</button>
          </div>
        </div>
        <div id="cfAlert" class="mb-2"></div>

        <div class="card shadow-sm mb-3">
          <div class="card-header fw-semibold">Dashboard</div>
          <div class="card-body" id="cfDashboard"><span class="text-muted">…</span></div>
        </div>

        <div class="row g-3 mb-3">
          <div class="col-lg-4">
            <div class="card shadow-sm h-100"><div class="card-body" id="cfSefaz">…</div></div>
          </div>
          <div class="col-lg-4">
            <div class="card shadow-sm h-100">
              <div class="card-header fw-semibold py-2">Painel de Rejeições</div>
              <div class="card-body" id="cfRejeicoes">…</div>
            </div>
          </div>
          <div class="col-lg-4">
            <div class="card shadow-sm h-100">
              <div class="card-header fw-semibold py-2">Central de Eventos</div>
              <div class="card-body" id="cfEventos">…</div>
            </div>
          </div>
        </div>

        <div class="card shadow-sm mb-2">
          <div class="card-body py-2">
            <div class="d-flex flex-wrap justify-content-between gap-2 mb-2">
              <div id="cfFiltros"></div>
              <div id="cfTiposDoc"></div>
            </div>
            <div class="row g-2 align-items-end">
              <div class="col-md-6">
                <label class="form-label small mb-0">Pesquisar (pedido, venda, cliente, CPF/CNPJ, NF-e, chave)</label>
                <input class="form-control form-control-sm" id="cfBusca" placeholder="Buscar…">
              </div>
              <div class="col-md-6">
                <div class="d-flex flex-wrap gap-1 justify-content-md-end">
                  <span class="small text-muted align-self-center me-1" id="cfSelCount"></span>
                  <button type="button" class="btn btn-sm btn-success cf-lote" data-acao="emitir">Emitir</button>
                  <button type="button" class="btn btn-sm btn-warning cf-lote" data-acao="reenviar">Reenviar</button>
                  <button type="button" class="btn btn-sm btn-info cf-lote" data-acao="consultar">Consultar</button>
                  <button type="button" class="btn btn-sm btn-outline-primary cf-lote" data-acao="imprimir_danfe">DANFE</button>
                  <button type="button" class="btn btn-sm btn-outline-primary cf-lote" data-acao="exportar_xml">XML</button>
                  <button type="button" class="btn btn-sm btn-outline-danger cf-lote" data-acao="cancelar">Cancelar</button>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div class="card shadow-sm">
          <div class="card-header d-flex justify-content-between py-2">
            <span class="fw-semibold">Fila de Faturamento</span>
            <span class="small text-muted" id="cfFilaMeta"></span>
          </div>
          <div class="card-body p-0" id="cfFilaOps"><span class="p-3 d-block text-muted">…</span></div>
        </div>
      </div>`);
  }

  /* ========== DETALHE (RC4.0.1) ========== */

  function renderAlertas(alertas) {
    if (!alertas || !alertas.length) return '';
    return `<div class="d-flex flex-column gap-1 mb-3">${alertas.map((a) => {
      const cls = a.nivel === 'erro' ? 'danger' : 'warning';
      return `<div class="alert alert-${cls} py-2 mb-0 small">⚠ ${esc(a.texto)}</div>`;
    }).join('')}</div>`;
  }

  function renderPendencias(checklist) {
    const itens = checklist?.itens || [];
    const bloqueio = checklist?.mensagem_bloqueio;
    return `
      <div class="d-flex justify-content-between align-items-center mb-2">
        <h6 class="mb-0">⚠ Pendências para emissão</h6>
        <span class="badge ${checklist?.pode_emitir ? 'bg-success' : 'bg-danger'}">
          ${checklist?.pode_emitir ? 'Pronto para emitir' : 'Bloqueado'}
        </span>
      </div>
      ${bloqueio && !checklist?.pode_emitir
        ? `<div class="alert alert-danger py-2 small">${esc(bloqueio)}</div>` : ''}
      <div class="row g-2">
        ${itens.map((i) => `
          <div class="col-md-6 col-xl-4">
            <div class="border rounded px-2 py-1 d-flex justify-content-between align-items-start gap-2 h-100">
              <div class="small">
                <div>${iconeNivel(i.nivel)} ${esc(i.rotulo)}</div>
                <div class="text-muted">${esc(i.detalhe || '')}</div>
              </div>
              <span class="badge ${badgeNivel(i.nivel)}">${labelNivel(i.nivel)}</span>
            </div>
          </div>`).join('')}
      </div>`;
  }

  function renderTimeline(timeline) {
    const etapas = timeline?.etapas || [];
    const rej = timeline?.rejeicao;
    return `
      <div class="d-flex flex-column gap-2">
        ${etapas.map((e, idx) => `
          <div class="d-flex gap-2 align-items-start">
            <div class="text-center" style="min-width:28px">
              <div class="rounded-circle ${badgeNivel(e.status)} d-inline-flex align-items-center justify-content-center"
                   style="width:22px;height:22px;font-size:11px">${idx + 1}</div>
              ${idx < etapas.length - 1 ? '<div class="border-start mx-auto" style="height:14px"></div>' : ''}
            </div>
            <div class="flex-grow-1 small pb-1">
              <div class="fw-semibold">${esc(e.rotulo)}
                <span class="badge ${badgeNivel(e.status)} ms-1">${esc(e.status)}</span>
              </div>
              <div class="text-muted">
                ${e.data ? esc(e.data) : ''} ${e.hora ? esc(e.hora) : ''}
                ${e.usuario ? ` · ${esc(e.usuario)}` : ''}
              </div>
              ${e.mensagem ? `<div>${esc(e.mensagem)}</div>` : ''}
              ${e.cstat ? `<div>Código: <code>${esc(e.cstat)}</code></div>` : ''}
              ${e.sugestao ? `<div class="text-warning">Sugestão: ${esc(e.sugestao)}</div>` : ''}
            </div>
          </div>`).join('')}
      </div>
      ${rej ? `
        <div class="alert alert-danger mt-3 mb-0 small">
          <strong>Rejeição</strong><br>
          Código: ${esc(rej.codigo || '—')}<br>
          ${esc(rej.descricao || '')}<br>
          ${rej.sugestao ? `<em>${esc(rej.sugestao)}</em>` : ''}
        </div>` : ''}`;
  }

  function renderDocumentos(docs) {
    if (!docs) return '<span class="text-muted">—</span>';
    const btn = (key, cls) => {
      const a = docs[key];
      if (!a) return '';
      const dis = a.habilitado ? '' : 'disabled';
      const prep = a.preparado && !a.habilitado ? ` title="${esc(a.mensagem || 'Em breve')}"` : '';
      return `<button type="button" class="btn btn-sm ${cls} cf-doc-acao" data-acao="${key}" ${dis}${prep}>${esc(a.label)}</button>`;
    };
    return `<div class="d-flex flex-wrap gap-2">
      ${btn('visualizar_xml', 'btn-outline-primary')}
      ${btn('download_xml', 'btn-outline-primary')}
      ${btn('visualizar_danfe', 'btn-outline-primary')}
      ${btn('reimprimir_danfe', 'btn-outline-primary')}
      ${btn('copiar_chave', 'btn-outline-secondary')}
      ${btn('consultar_situacao', 'btn-outline-info')}
      ${btn('reenviar', 'btn-warning')}
      ${btn('cancelar', 'btn-outline-danger')}
      ${btn('carta_correcao', 'btn-outline-secondary')}
      ${btn('manifestacao', 'btn-outline-secondary')}
    </div>`;
  }

  function renderResumoFiscal(r) {
    if (!r) return '<span class="text-muted">—</span>';
    const cell = (l, v) => `<div class="col-md-3 col-6"><strong>${esc(l)}</strong><div>${v}</div></div>`;
    return `<div class="row g-2 small">
      ${cell('Número', esc(r.numero || '—'))}
      ${cell('Série', esc(r.serie || '—'))}
      ${cell('Modelo', esc(r.modelo || 55))}
      ${cell('Ambiente', r.ambiente === 1 ? 'Produção' : (r.ambiente === 2 ? 'Homologação' : '—'))}
      ${cell('CFOP', esc(r.cfop || '—'))}
      ${cell('Natureza', esc(r.natureza || '—'))}
      ${cell('Itens', esc(r.qtd_itens || 0))}
      ${cell('Peso', esc(r.peso || 0))}
      ${cell('Volumes', esc(r.volumes || 0))}
      ${cell('Transportadora', esc(r.transportadora || '—'))}
      ${cell('Forma pagto', esc(r.forma_pagamento || '—'))}
      ${cell('Produtos', money(r.valor_produtos))}
      ${cell('Frete', money(r.valor_frete))}
      ${cell('Desconto', money(r.valor_desconto))}
      ${cell('Acréscimo', money(r.valor_acrescimo))}
      ${cell('Valor da Nota', money(r.valor_nota))}
      ${cell('Valor Final', money(r.valor_final))}
    </div>`;
  }

  function renderLogSefaz(log) {
    if (!log || !log.disponivel) {
      return `<p class="text-muted mb-0 small">${esc(log?.mensagem || 'Sem transmissão.')}</p>`;
    }
    return `
      <div class="row g-2 small">
        <div class="col-md-4"><strong>Última transmissão</strong><div>${esc(log.ultima_transmissao || '—')}</div></div>
        <div class="col-md-4"><strong>Última resposta</strong><div>${esc(log.ultima_resposta || '—')}</div></div>
        <div class="col-md-2"><strong>cStat</strong><div><code>${esc(log.cStat || '—')}</code></div></div>
        <div class="col-md-2"><strong>Tentativas</strong><div>${esc(log.tentativas || 0)}</div></div>
        <div class="col-md-6"><strong>xMotivo</strong><div>${esc(log.xMotivo || '—')}</div></div>
        <div class="col-md-3"><strong>Protocolo</strong><div>${esc(log.protocolo || '—')}</div></div>
        <div class="col-md-3"><strong>Tempo</strong><div>${log.tempo_ms != null ? esc(log.tempo_ms) + ' ms' : '—'}</div></div>
        <div class="col-12"><strong>Chave</strong><div class="text-break">${esc(log.chave || '—')}</div></div>
      </div>
      ${log.rejeicao ? `
        <div class="alert alert-danger mt-2 mb-0 small">
          <strong>Motivo:</strong> ${esc(log.rejeicao.motivo || '')}<br>
          <strong>Possível causa:</strong> ${esc(log.rejeicao.possivel_causa || '')}
        </div>` : ''}`;
  }

  function renderModulosFuturos(mods) {
    return `<div class="d-flex flex-wrap gap-2">${(mods || []).map((m) =>
      `<span class="badge ${m.ativo ? 'bg-primary' : 'bg-light text-dark border'}">${esc(m.label)}${m.preparado && !m.ativo ? ' · em breve' : ''}</span>`
    ).join('')}</div>`;
  }

  function atualizarBotoes() {
    const pode = !!(pacoteAtual?.checklist?.pode_emitir);
    const st = String(pacoteAtual?.nota?.status || '');
    $('#cfBtnEmitir').prop('disabled', !pode || st === 'autorizada');
    $('#cfMsgBloqueio').toggleClass('d-none', !!pode || !vendaAtualId);
  }

  function preencherForm(pacote) {
    const pedido = pacote.pedido || {};
    const local = carregarLocal(pacote.venda.id) || {};
    $('#cfNatureza').val(local.natureza_operacao || pedido.natureza_operacao || 'VENDA DE MERCADORIA');
    $('#cfCfop').val(local.cfop || pedido.cfop || '5102');
    $('#cfTransportadora').val(local.transportadora || pedido.transportadora || '');
    $('#cfFrete').val(local.frete != null ? local.frete : (pedido.frete || 0));
    $('#cfVolumes').val(local.volumes != null ? local.volumes : (pedido.volumes || 0));
    $('#cfPeso').val(local.peso != null ? local.peso : (pedido.peso || 0));
    $('#cfObs').val(local.observacoes || pacote.venda.observacao || '');
    $('#cfDadosAdic').val(local.dados_adicionais || pedido.dados_adicionais || '');
  }

  function renderPacote(pacote) {
    pacoteAtual = pacote;
    const v = pacote.venda;
    const itens = pacote.itens || [];
    const doc = String(v.cliente_cpf || v.cpf_cnpj_nota || '').trim();
    const semDoc = !doc || /^0+$/.test(doc.replace(/\D/g, ''));

    $('#cfAlertas').html(renderAlertas(pacote.alertas));
    $('#cfPendencias').html(renderPendencias(pacote.checklist || pacote.pendencias));
    $('#cfTimeline').html(renderTimeline(pacote.timeline));
    $('#cfDocumentos').html(renderDocumentos(pacote.documentos));
    $('#cfResumoFiscal').html(renderResumoFiscal(pacote.resumo_fiscal));
    $('#cfLogSefaz').html(renderLogSefaz(pacote.log_sefaz));
    $('#cfModulosFuturos').html(renderModulosFuturos(pacote.modulos_futuros));

    $('#cfResumo').html(`
      <div class="row g-2 small">
        <div class="col-md-2"><strong>Pedido</strong><div>#${esc(v.pedido_id || '—')}</div></div>
        <div class="col-md-2"><strong>Venda</strong><div>#${esc(v.id)}</div></div>
        <div class="col-md-3"><strong>Cliente</strong><div>${esc(v.cliente_nome || '—')}</div></div>
        <div class="col-md-2"><strong>Valor</strong><div>${money(v.valor_fiscal != null ? v.valor_fiscal : v.total)}</div></div>
        <div class="col-md-3"><strong>Status fiscal</strong><div><span class="badge bg-info text-dark">${esc(pacote.status_fiscal)}</span></div></div>
      </div>`);

    $('#cfProdutos').html(`
      <div class="table-responsive"><table class="table table-sm table-hover mb-0">
        <thead class="table-light"><tr>
          <th>Produto</th><th>Qtd</th><th>Subtotal</th><th>CFOP</th><th>NCM</th><th>CSOSN</th><th>Indicador</th>
        </tr></thead><tbody>
        ${itens.map((it) => {
          const qF = Number(it.quantidade_fiscal || 0);
          const vF = Number(it.valor_fiscal || 0);
          const fiscal = qF > 0 && vF > 0;
          const ncm = String(it.produto_ncm || it.ncm || '');
          const alerta = fiscal && ncm.replace(/\D/g, '').length < 8;
          return `<tr class="${alerta ? 'table-danger' : ''}">
            <td>${esc(it.produto_nome || '#' + it.produto_id)}${alerta ? ' <span class="badge bg-danger">NCM</span>' : ''}</td>
            <td>${esc(fiscal ? qF : it.quantidade)}</td>
            <td>${money(fiscal ? vF : it.subtotal)}</td>
            <td>${esc(it.produto_cfop || it.cfop || '—')}</td>
            <td>${esc(ncm || '—')}</td>
            <td>${esc(it.produto_csosn || '—')}</td>
            <td>${fiscal ? '<span class="badge bg-primary">Fiscal</span>' : '<span class="badge bg-secondary">NF</span>'}</td>
          </tr>`;
        }).join('') || '<tr><td colspan="7" class="text-muted">Sem itens</td></tr>'}
        </tbody></table></div>`);

    $('#cfCliente').html(`
      ${semDoc ? '<div class="alert alert-danger py-2">CPF/CNPJ ausente — emissão bloqueada.</div>' : ''}
      <div class="row g-2 small">
        <div class="col-md-6"><strong>Nome</strong><div>${esc(v.cliente_nome || '—')}</div></div>
        <div class="col-md-3"><strong>CPF/CNPJ</strong><div class="${semDoc ? 'text-danger fw-bold' : ''}">${esc(doc || '—')}</div></div>
        <div class="col-md-3"><strong>CEP</strong><div>${esc(v.cliente_cep || '—')}</div></div>
        <div class="col-md-6"><strong>Endereço</strong><div>${esc(v.cliente_rua || '—')}, ${esc(v.cliente_numero || 'S/N')}</div></div>
        <div class="col-md-3"><strong>Cidade</strong><div>${esc(v.cliente_cidade || '—')}</div></div>
        <div class="col-md-2"><strong>UF</strong><div>${esc(v.cliente_uf || '—')}</div></div>
      </div>
      <button type="button" class="btn btn-outline-primary btn-sm mt-2" id="cfBtnEditarCliente">
        <i class="fas fa-user-edit"></i> Editar Cadastro
      </button>`);

    preencherForm(pacote);
    atualizarBotoes();
  }

  function montarShellDetalhe(titulo) {
    $('#page-content').html(`
      <div class="container-fluid py-3">
        <div class="d-flex flex-wrap justify-content-between align-items-start gap-2 mb-2">
          <div>
            <h4 class="mb-1"><i class="fas fa-file-invoice-dollar text-primary"></i> ${esc(titulo)}</h4>
            <div class="text-muted small">Detalhe da venda · Validação → SEFAZ → DANFE</div>
          </div>
          <div class="d-flex flex-wrap gap-2">
            <button type="button" class="btn btn-outline-secondary btn-sm" id="cfBtnVoltarPainel"><i class="fas fa-list"></i> Voltar ao Painel</button>
            <button type="button" class="btn btn-outline-secondary btn-sm" id="cfBtnVoltarExpedicao"><i class="fas fa-dolly"></i> Expedição</button>
            <button type="button" class="btn btn-outline-primary btn-sm" id="cfBtnAtualizarDetalhe"><i class="fas fa-sync"></i> Atualizar</button>
          </div>
        </div>
        <div id="cfAlert" class="mb-2"></div>
        <div id="cfAlertas"></div>
        <div class="card shadow-sm border-warning mb-3">
          <div class="card-body" id="cfPendencias"><span class="text-muted">Carregando…</span></div>
        </div>
        <div class="row g-3">
          <div class="col-lg-7">
            <div class="card shadow-sm mb-3"><div class="card-header fw-semibold">Resumo da venda</div><div class="card-body" id="cfResumo">—</div></div>
            <div class="card shadow-sm mb-3"><div class="card-header fw-semibold">Timeline Fiscal</div><div class="card-body" id="cfTimeline">—</div></div>
            <div class="card shadow-sm mb-3"><div class="card-header fw-semibold">Produtos</div><div class="card-body" id="cfProdutos">—</div></div>
            <div class="card shadow-sm mb-3"><div class="card-header fw-semibold">Cliente</div><div class="card-body" id="cfCliente">—</div></div>
            <div class="card shadow-sm mb-3">
              <div class="card-header fw-semibold">Dados fiscais</div>
              <div class="card-body">
                <div class="row g-2">
                  <div class="col-md-8"><label class="form-label">Natureza</label><input class="form-control form-control-sm" id="cfNatureza"></div>
                  <div class="col-md-4"><label class="form-label">CFOP</label><input class="form-control form-control-sm" id="cfCfop"></div>
                  <div class="col-md-6"><label class="form-label">Transportadora</label><input class="form-control form-control-sm" id="cfTransportadora"></div>
                  <div class="col-md-2"><label class="form-label">Frete</label><input type="number" step="0.01" class="form-control form-control-sm" id="cfFrete" value="0"></div>
                  <div class="col-md-2"><label class="form-label">Volumes</label><input type="number" class="form-control form-control-sm" id="cfVolumes" value="0"></div>
                  <div class="col-md-2"><label class="form-label">Peso</label><input type="number" step="0.001" class="form-control form-control-sm" id="cfPeso" value="0"></div>
                  <div class="col-md-6"><label class="form-label">Observações</label><textarea class="form-control form-control-sm" id="cfObs" rows="2"></textarea></div>
                  <div class="col-md-6"><label class="form-label">Dados adicionais</label><textarea class="form-control form-control-sm" id="cfDadosAdic" rows="2"></textarea></div>
                </div>
              </div>
            </div>
          </div>
          <div class="col-lg-5">
            <div class="card shadow-sm mb-3"><div class="card-header fw-semibold">Central de Documentos</div><div class="card-body" id="cfDocumentos">—</div></div>
            <div class="card shadow-sm mb-3"><div class="card-header fw-semibold">Resumo Fiscal</div><div class="card-body" id="cfResumoFiscal">—</div></div>
            <div class="card shadow-sm mb-3"><div class="card-header fw-semibold">Log da SEFAZ</div><div class="card-body" id="cfLogSefaz">—</div></div>
            <div class="card shadow-sm mb-3"><div class="card-header fw-semibold">Módulos</div><div class="card-body" id="cfModulosFuturos">—</div></div>
          </div>
          <div class="col-12">
            <div class="card shadow-sm"><div class="card-body">
              <div id="cfMsgBloqueio" class="alert alert-danger py-2 small d-none">Existem pendências fiscais que impedem a emissão.</div>
              <div class="d-flex flex-wrap gap-2">
                <button type="button" class="btn btn-outline-secondary" id="cfBtnSalvar"><i class="fas fa-save"></i> Salvar</button>
                <button type="button" class="btn btn-success" id="cfBtnEmitir" disabled><i class="fas fa-paper-plane"></i> Emitir NF-e</button>
              </div>
            </div></div>
          </div>
        </div>
      </div>`);
  }

  async function atualizarChecklistSilencioso() {
    if (!vendaAtualId) return;
    const dados = lerDadosFiscaisForm();
    const qs = new URLSearchParams(dados).toString();
    const resp = await fetch(`${API()}/central-faturamento/vendas/${vendaAtualId}/checklist?${qs}`, {
      headers: headersJson()
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) return;
    if (pacoteAtual) {
      pacoteAtual.checklist = data;
      pacoteAtual.pendencias = data;
      pacoteAtual.alertas = data.alertas || pacoteAtual.alertas;
      $('#cfPendencias').html(renderPendencias(data));
      $('#cfAlertas').html(renderAlertas(pacoteAtual.alertas));
      atualizarBotoes();
    }
  }

  async function carregarVenda(vendaId) {
    const id = Number(vendaId);
    if (!(id > 0)) return alertar('Venda inválida.', 'warning');
    vendaAtualId = id;
    vista = 'detalhe';
    try {
      global.__cdsCentralFatVendaId = id;
      localStorage.setItem('cds_central_fat_venda_id', String(id));
    } catch (_) { /* */ }

    const titulo = (global.CdsNomenclatura && global.CdsNomenclatura.FISCAL
      && global.CdsNomenclatura.FISCAL.centralFaturamento) || 'Central de Faturamento';
    montarShellDetalhe(titulo);
    bindDetalhe();

    const dados = lerDadosFiscaisForm();
    const qs = new URLSearchParams({
      natureza_operacao: dados.natureza_operacao || '',
      cfop: dados.cfop || ''
    }).toString();

    alertar('Carregando venda…', 'info');
    const resp = await fetch(`${API()}/central-faturamento/vendas/${id}?${qs}`, { headers: headersJson() });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(data.error || 'Falha ao carregar venda.');
    renderPacote(data);
    await atualizarChecklistSilencioso();
    alertar(`Venda #${id} carregada.`, 'success');
  }

  async function acaoDocumento(acao) {
    if (!vendaAtualId) return;
    const docs = pacoteAtual?.documentos || {};
    try {
      if (acao === 'visualizar_xml' || acao === 'download_xml') {
        const resp = await fetch(`${API()}/central-faturamento/vendas/${vendaAtualId}/xml`, { headers: headersJson() });
        const data = await resp.json().catch(() => ({}));
        if (!resp.ok) throw new Error(data.error || 'XML indisponível');
        if (acao === 'download_xml') {
          const blob = new Blob([data.xml], { type: 'application/xml' });
          const a = document.createElement('a');
          a.href = URL.createObjectURL(blob);
          a.download = `NFe-${data.chave || vendaAtualId}.xml`;
          a.click();
          return;
        }
        const w = window.open('', '_blank');
        w.document.write(`<pre>${esc(data.xml)}</pre>`);
        return;
      }
      if (acao === 'visualizar_danfe' || acao === 'reimprimir_danfe') {
        const notaId = pacoteAtual?.nota?.id;
        if (notaId && typeof abrirDanfe === 'function') {
          abrirDanfe({
            tipo: 'VENDA',
            id: notaId,
            chave: pacoteAtual?.nota?.chave_acesso,
            numero: pacoteAtual?.nota?.numero,
            serie: pacoteAtual?.nota?.serie,
            imprimir: acao === 'reimprimir_danfe'
          });
          return;
        }
        const resp = await fetch(`${API()}/central-faturamento/vendas/${vendaAtualId}/danfe`, { headers: headersJson() });
        const data = await resp.json().catch(() => ({}));
        if (!resp.ok) throw new Error(data.error || 'DANFE indisponível');
        const w = window.open('', '_blank');
        w.document.write(data.danfe_html);
        w.document.close();
        if (acao === 'reimprimir_danfe') setTimeout(() => { try { w.print(); } catch (_) {} }, 400);
        return;
      }
      if (acao === 'copiar_chave') {
        const chave = docs.copiar_chave?.valor || pacoteAtual?.nota?.chave_acesso;
        if (!chave) throw new Error('Chave indisponível');
        await navigator.clipboard.writeText(String(chave));
        alertar('Chave copiada.', 'success');
        return;
      }
      if (acao === 'consultar_situacao') {
        const resp = await fetch(`${API()}/central-faturamento/vendas/${vendaAtualId}/consultar`, {
          method: 'POST', headers: headersJson(), body: '{}'
        });
        const data = await resp.json().catch(() => ({}));
        if (!resp.ok) throw new Error(data.error || data.mensagem || 'Falha na consulta');
        alertar(data.message || data.mensagem || 'Consulta concluída.', 'success');
        await carregarVenda(vendaAtualId);
        return;
      }
      if (acao === 'reenviar') {
        const resp = await fetch(`${API()}/central-faturamento/vendas/${vendaAtualId}/reenviar`, {
          method: 'POST', headers: headersJson(), body: '{}'
        });
        const data = await resp.json().catch(() => ({}));
        if (!resp.ok) throw new Error(data.error || data.mensagem || 'Falha no reenvio');
        alertar(data.message || 'Reenvio concluído.', 'success');
        await carregarVenda(vendaAtualId);
        return;
      }
      if (acao === 'cancelar') {
        const notaId = pacoteAtual?.nota?.id;
        if (!notaId) throw new Error('Nota não encontrada');
        const justificativa = prompt('Justificativa do cancelamento (mín. 15 caracteres):');
        if (!justificativa || justificativa.trim().length < 15) throw new Error('Justificativa inválida.');
        const resp = await fetch(`${API()}/central-faturamento/notas/${notaId}/cancelar`, {
          method: 'POST', headers: headersJson(), body: JSON.stringify({ justificativa })
        });
        const data = await resp.json().catch(() => ({}));
        if (!resp.ok) throw new Error(data.error || data.mensagem || 'Falha ao cancelar');
        alertar('Cancelamento solicitado.', 'success');
        await carregarVenda(vendaAtualId);
        return;
      }
      if (acao === 'carta_correcao' || acao === 'manifestacao') {
        alertar('Recurso preparado para RC futura.', 'info');
      }
    } catch (e) {
      alertar(e.message, 'danger');
    }
  }

  function bindPainel() {
    $('#cfBtnVoltarExpedicao').on('click', () => { if (typeof loadPage === 'function') loadPage('faturamento'); });
    $('#cfBtnAtualizar').on('click', () => carregarPainel(false).catch((e) => alertar(e.message, 'danger')));

    $(document).off('click.cfFiltro', '.cf-filtro-rapido').on('click.cfFiltro', '.cf-filtro-rapido', function () {
      filtroAtual = String($(this).data('filtro') || 'todos');
      carregarPainel(false).catch((e) => alertar(e.message, 'danger'));
    });

    let buscaTimer = null;
    $('#cfBusca').off('input.cf').on('input.cf', function () {
      clearTimeout(buscaTimer);
      buscaTimer = setTimeout(() => {
        buscaAtual = String($(this).val() || '').trim();
        carregarPainel(true).catch(() => {});
      }, 400);
    });

    $(document).off('click.cfAbrir', '.cf-abrir-venda').on('click.cfAbrir', '.cf-abrir-venda', function () {
      carregarVenda($(this).data('id')).catch((e) => alertar(e.message, 'danger'));
    });

    $(document).off('change.cfSel', '.cf-sel-venda').on('change.cfSel', '.cf-sel-venda', function () {
      const id = Number($(this).data('id'));
      if ($(this).is(':checked')) selecao.add(id);
      else selecao.delete(id);
      atualizarContadorSelecao();
    });

    $(document).off('change.cfTodos', '#cfSelTodos').on('change.cfTodos', '#cfSelTodos', function () {
      const on = $(this).is(':checked');
      selecao.clear();
      $('.cf-sel-venda').each(function () {
        $(this).prop('checked', on);
        if (on) selecao.add(Number($(this).data('id')));
      });
      atualizarContadorSelecao();
    });

    $(document).off('click.cfLote', '.cf-lote').on('click.cfLote', '.cf-lote', function () {
      executarLote(String($(this).data('acao'))).catch((e) => alertar(e.message, 'danger'));
    });
  }

  function bindDetalhe() {
    $('#cfBtnVoltarPainel').on('click', () => {
      vista = 'painel';
      vendaAtualId = null;
      mostrarPainel().catch((e) => alertar(e.message, 'danger'));
    });
    $('#cfBtnVoltarExpedicao').on('click', () => { if (typeof loadPage === 'function') loadPage('faturamento'); });
    $('#cfBtnAtualizarDetalhe').on('click', () => {
      if (vendaAtualId) carregarVenda(vendaAtualId).catch((e) => alertar(e.message, 'danger'));
    });

    $(document).off('click.cfCli', '#cfBtnEditarCliente').on('click.cfCli', '#cfBtnEditarCliente', () => {
      if (typeof loadPage === 'function') loadPage('clientes');
    });
    $(document).off('click.cfDoc', '.cf-doc-acao').on('click.cfDoc', '.cf-doc-acao', function () {
      acaoDocumento($(this).data('acao'));
    });

    $('#cfNatureza, #cfCfop, #cfTransportadora, #cfFrete, #cfVolumes, #cfPeso, #cfObs, #cfDadosAdic')
      .off('change.cf input.cf')
      .on('change.cf input.cf', () => {
        if (!vendaAtualId) return;
        persistLocal(vendaAtualId, lerDadosFiscaisForm());
        atualizarChecklistSilencioso().catch(() => {});
      });

    $('#cfBtnSalvar').on('click', async () => {
      if (!vendaAtualId) return;
      const dados = lerDadosFiscaisForm();
      persistLocal(vendaAtualId, dados);
      try {
        const resp = await fetch(`${API()}/central-faturamento/vendas/${vendaAtualId}/dados-fiscais`, {
          method: 'PUT', headers: headersJson(), body: JSON.stringify(dados)
        });
        const data = await resp.json().catch(() => ({}));
        if (!resp.ok) throw new Error(data.error || 'Falha ao salvar.');
        await atualizarChecklistSilencioso();
        alertar('Dados fiscais salvos.', 'success');
      } catch (e) { alertar(e.message, 'danger'); }
    });

    $('#cfBtnEmitir').on('click', async () => {
      if (!vendaAtualId) return;
      const dados = lerDadosFiscaisForm();
      $('#cfBtnEmitir').prop('disabled', true);
      try {
        const resp = await fetch(`${API()}/central-faturamento/vendas/${vendaAtualId}/emitir`, {
          method: 'POST', headers: headersJson(), body: JSON.stringify({ dadosNfe: dados })
        });
        const data = await resp.json().catch(() => ({}));
        if (!resp.ok) {
          if (data.checklist) {
            pacoteAtual.checklist = data.checklist;
            $('#cfPendencias').html(renderPendencias(data.checklist));
            atualizarBotoes();
          }
          throw new Error(data.error || 'Existem pendências fiscais que impedem a emissão.');
        }
        alertar(data.message || 'Emissão concluída.', data.success ? 'success' : 'warning');
        await carregarVenda(vendaAtualId);
        if (data.nfe && data.nfe.notaId && typeof apresentarDocumentoNfePosEmissao === 'function') {
          apresentarDocumentoNfePosEmissao(data.nfe);
        }
      } catch (e) {
        alertar(e.message, 'danger');
      } finally {
        atualizarBotoes();
      }
    });
  }

  async function mostrarPainel() {
    vista = 'painel';
    const titulo = (global.CdsNomenclatura && global.CdsNomenclatura.FISCAL
      && global.CdsNomenclatura.FISCAL.centralFaturamento) || 'Central de Faturamento';
    montarShellPainel(titulo);
    bindPainel();
    await carregarPainel(false);
  }

  async function loadCentralFaturamento() {
    if (global.__cfRefreshTimer) clearInterval(global.__cfRefreshTimer);
    global.__cfRefreshTimer = setInterval(() => {
      if (vista === 'painel') {
        carregarPainel(true).catch(() => {});
      } else if (vista === 'detalhe' && vendaAtualId && pacoteAtual) {
        const st = String(pacoteAtual.nota?.status || '');
        if (['autorizada', 'cancelada', 'denegada'].includes(st)) return;
        carregarVenda(vendaAtualId).catch(() => {});
      }
    }, 25000);

    const inicial = resolverVendaInicial();
    try {
      if (inicial > 0 && global.__cdsCentralFatVendaId) {
        // veio da Expedição → abre detalhe
        await carregarVenda(inicial);
        try { delete global.__cdsCentralFatVendaId; } catch (_) { /* */ }
      } else {
        await mostrarPainel();
      }
    } catch (e) {
      alertar(e.message, 'danger');
      try { await mostrarPainel(); } catch (_) { /* */ }
    }
  }

  global.loadCentralFaturamento = loadCentralFaturamento;
})(typeof window !== 'undefined' ? window : globalThis);
