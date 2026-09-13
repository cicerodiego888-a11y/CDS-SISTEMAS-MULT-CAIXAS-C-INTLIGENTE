/**
 * RC15.1 — Enviar Produtos para Balança (Toledo Prix IV Uno)
 * RC14.15.3 — respeita modo_envio: TCP → upload-plus | MGV6 → /mgv6/export-all
 * Não duplica Motor Universal — apenas orquestra UI → API.
 */

'use strict';

let __epbEquipamentos = [];
let __epbProdutos = [];
let __epbSelecionados = new Set();
let __epbEnviando = false;
/** RC15.4 — true quando o envio partiu de "Selecionar Todos" (operacao ENVIAR_TODOS). */
let __epbModoEnviarTodos = false;
/** Cache do modo_envio do equipamento selecionado (TCP | MGV6). */
let __epbModoEnvio = 'TCP';

function epbApi() {
  return (typeof API_URL === 'string' && API_URL.trim() !== '')
    ? API_URL
    : `${window.location.origin}/api`;
}

function epbHeaders() {
  const headers = { 'Content-Type': 'application/json' };
  const token = localStorage.getItem('token');
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

function epbEsc(t) {
  if (t == null) return '';
  return String(t)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function epbHora() {
  try {
    return new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  } catch (_) {
    return '--:--';
  }
}

function epbLog(msg, tipo = 'info') {
  const el = document.getElementById('epbLog');
  if (!el) return;
  const cor = tipo === 'ok' ? 'text-success'
    : (tipo === 'erro' ? 'text-danger'
      : (tipo === 'warn' ? 'text-warning' : 'text-muted'));
  const linha = document.createElement('div');
  linha.className = cor;
  linha.textContent = `${epbHora()} ${msg}`;
  el.appendChild(linha);
  el.scrollTop = el.scrollHeight;
}

function epbSetProgresso(pct, label) {
  const bar = document.getElementById('epbProgressBar');
  const txt = document.getElementById('epbProgressLabel');
  if (bar) {
    const v = Math.max(0, Math.min(100, Number(pct) || 0));
    bar.style.width = `${v}%`;
    bar.setAttribute('aria-valuenow', String(v));
    bar.classList.toggle('progress-bar-animated', __epbEnviando);
    bar.classList.toggle('progress-bar-striped', __epbEnviando);
  }
  if (txt) txt.textContent = label || '';
}

function epbAtualizarContador() {
  const el = document.getElementById('epbSelecionadosCount');
  if (el) el.textContent = String(__epbSelecionados.size);
  const btn = document.getElementById('epbBtnEnviar');
  if (btn) btn.disabled = __epbEnviando || __epbSelecionados.size === 0;
}

function epbPluKey(p) {
  const plu = p.plu != null && String(p.plu).trim() !== '' ? String(p.plu).trim() : null;
  const codigo = p.codigo != null ? String(p.codigo).trim() : null;
  return plu || codigo || String(p.id);
}

function epbEhPesavel(p) {
  if (!p || typeof p !== 'object') return false;
  const tipo = String(p.tipo_comercializacao || p.tipoComercializacao || '').toUpperCase();
  if (tipo === 'PESO' || tipo === 'PESAVEL' || tipo === 'KG') return true;
  if (p.permite_balanca === true || p.permite_balanca === 1 || p.permite_balanca === '1') return true;
  if (Number(p.produto_fracionado ?? p.vendido_por_peso ?? p.produto_pesavel ?? 0) === 1) return true;
  return false;
}

function epbEhAtivo(p) {
  if (p == null) return false;
  if (p.ativo === false || p.ativo === 0 || p.ativo === '0') return false;
  const st = String(p.status || '').toUpperCase();
  if (st === 'INATIVO' || st === 'INACTIVE' || st === 'DESATIVADO') return false;
  return true;
}

function epbEhProdutoComum(p) {
  const tipo = String(p.tipo || p.tipo_produto || p.categoria_tipo || '').toUpperCase();
  if (tipo.includes('SERVICO') || tipo.includes('SERVIÇO') || tipo.includes('SERVICE')) return false;
  if (tipo.includes('COMBO') || tipo.includes('KIT')) return false;
  if (p.servico === true || p.servico === 1 || p.is_servico === 1) return false;
  if (p.combo === true || p.combo === 1 || p.is_combo === 1) return false;
  return true;
}

function epbIntegraBalanca(p) {
  if (!p || typeof p !== 'object') return false;
  if (p.integrar_balanca === false || p.integrar_balanca === 0 || p.integrar_balanca === '0') return false;
  if (p.integrar_balanca === true || p.integrar_balanca === 1 || p.integrar_balanca === '1') return true;
  return epbEhPesavel(p);
}

function epbElegivelBalanca(p) {
  return epbIntegraBalanca(p) && epbEhAtivo(p) && epbEhProdutoComum(p);
}

function epbNomePorPlu(plu) {
  const key = String(plu);
  const p = __epbProdutos.find((x) => epbPluKey(x) === key);
  return p?.nome || key;
}

function epbIdsSelecionados() {
  const ids = [];
  for (const key of __epbSelecionados) {
    const p = __epbProdutos.find((x) => epbPluKey(x) === String(key));
    if (p && p.id != null) ids.push(Number(p.id));
  }
  return ids.filter((n) => Number.isFinite(n) && n > 0);
}

function epbEquipamentoIdAtual() {
  return Number(document.getElementById('epbEquipamento')?.value || 0);
}

async function epbObterModoEnvio(equipamentoId) {
  const id = Number(equipamentoId);
  if (!Number.isFinite(id) || id <= 0) return 'TCP';
  try {
    const resp = await fetch(`${epbApi()}/equipamentos/mgv6/config/${id}`, { headers: epbHeaders() });
    const body = await resp.json().catch(() => ({}));
    const modo = String(body.modo_envio || body.config?.modo_envio || 'TCP').toUpperCase();
    return modo === 'MGV6' ? 'MGV6' : 'TCP';
  } catch (_) {
    return 'TCP';
  }
}

function epbMensagemErroMgv6(body, fallback) {
  const code = String(body?.codigo || body?.code || '').toUpperCase();
  const msg = String(body?.mensagem || body?.error || fallback || '');
  if (code.includes('FOLDER') || /pasta/i.test(msg)) return '❌ Pasta MGV6 não encontrada.';
  if (code.includes('WRITE') || /permiss|gravar|escrita/i.test(msg)) return '❌ Não foi possível gravar o arquivo MGV6.';
  if (code.includes('CONFIG') || /configura/i.test(msg)) return '❌ Configuração MGV6 incompleta.';
  if (code.includes('LAUNCH') && /não encontrado|not found|inexist/i.test(msg)) {
    return '❌ Não foi possível iniciar o MGV6.exe.';
  }
  if (/MGV6\.exe/i.test(msg) && /não encontrado|not found/i.test(msg)) {
    return '⚠ MGV6.exe não encontrado.';
  }
  if (code === 'MODO_ENVIO_TCP') return '❌ Este equipamento está configurado para envio TCP.';
  return msg ? `❌ ${msg}` : (fallback || '❌ Falha na exportação MGV6.');
}

function epbAtualizarUiModo() {
  const badge = document.getElementById('epbModoBadge');
  const btnConn = document.getElementById('epbBtnConectar');
  const btnEnviar = document.getElementById('epbBtnEnviar');
  if (badge) {
    badge.textContent = __epbModoEnvio === 'MGV6' ? 'Método: MGV6 / Catálogo completo' : 'Método: TCP Oficial';
    badge.className = __epbModoEnvio === 'MGV6'
      ? 'badge text-bg-secondary'
      : 'badge text-bg-primary';
  }
  if (btnConn) {
    btnConn.classList.toggle('d-none', __epbModoEnvio === 'MGV6');
  }
  if (btnEnviar) {
    btnEnviar.textContent = __epbModoEnvio === 'MGV6'
      ? 'Gerar TXITENS (todos elegíveis)'
      : 'Enviar Selecionados';
    btnEnviar.title = __epbModoEnvio === 'MGV6'
      ? 'No MGV6 o arquivo é sempre o catálogo completo — seleção parcial apagaria os demais PLUs.'
      : '';
  }
}

function epbRenderLista() {
  const tbody = document.getElementById('epbListaBody');
  if (!tbody) return;
  const busca = String(document.getElementById('epbBusca')?.value || '').trim().toLowerCase();
  const filtrados = __epbProdutos.filter((p) => {
    if (!busca) return true;
    const plu = epbPluKey(p).toLowerCase();
    const nome = String(p.nome || '').toLowerCase();
    const codigo = String(p.codigo || '').toLowerCase();
    return plu.includes(busca) || nome.includes(busca) || codigo.includes(busca);
  });

  if (!filtrados.length) {
    tbody.innerHTML = '<tr><td colspan="3" class="text-muted">Nenhum produto encontrado.</td></tr>';
    return;
  }

  tbody.innerHTML = filtrados.map((p) => {
    const key = epbPluKey(p);
    const checked = __epbSelecionados.has(key) ? 'checked' : '';
    return `<tr>
      <td style="width:2.5rem;">
        <input type="checkbox" class="form-check-input epb-check" data-plu="${epbEsc(key)}" ${checked}>
      </td>
      <td class="font-monospace">${epbEsc(key)}</td>
      <td>${epbEsc(p.nome || '—')}</td>
    </tr>`;
  }).join('');

  tbody.querySelectorAll('.epb-check').forEach((cb) => {
    cb.addEventListener('change', () => {
      const plu = cb.getAttribute('data-plu');
      if (cb.checked) __epbSelecionados.add(plu);
      else {
        __epbSelecionados.delete(plu);
        __epbModoEnviarTodos = false;
      }
      epbAtualizarContador();
    });
  });
}

function epbSelecionarTodos(marcar) {
  const busca = String(document.getElementById('epbBusca')?.value || '').trim().toLowerCase();
  __epbProdutos.forEach((p) => {
    const key = epbPluKey(p);
    if (busca) {
      const nome = String(p.nome || '').toLowerCase();
      const codigo = String(p.codigo || '').toLowerCase();
      if (!(key.toLowerCase().includes(busca) || nome.includes(busca) || codigo.includes(busca))) {
        return;
      }
    }
    if (marcar) __epbSelecionados.add(key);
    else __epbSelecionados.delete(key);
  });
  __epbModoEnviarTodos = Boolean(marcar) && !busca && __epbSelecionados.size > 0;
  epbRenderLista();
  epbAtualizarContador();
}

function epbFormatarDataHist(iso) {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return String(iso);
    return d.toLocaleString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    });
  } catch (_) {
    return String(iso);
  }
}

async function epbCarregarHistorico() {
  const box = document.getElementById('epbHistoricoBox');
  const lista = document.getElementById('epbHistoricoLista');
  if (!box || !lista) return;
  box.classList.remove('d-none');
  lista.innerHTML = '<div class="text-muted small">Carregando…</div>';
  const eqId = epbEquipamentoIdAtual();
  try {
    if (__epbModoEnvio === 'MGV6') {
      const q = new URLSearchParams({ limite: '40' });
      if (eqId) q.set('equipamentoId', String(eqId));
      const resp = await fetch(`${epbApi()}/equipamentos/mgv6/history?${q}`, { headers: epbHeaders() });
      const body = await resp.json().catch(() => ({}));
      const hist = Array.isArray(body.historico) ? body.historico : [];
      if (!hist.length) {
        lista.innerHTML = '<div class="text-muted small">Nenhuma exportação MGV6 registrada.</div>';
        return;
      }
      lista.innerHTML = hist.map((item) => {
        const ok = String(item.status || '').toUpperCase().includes('EXPORTADO');
        return `<div class="border-bottom py-2 mb-1 small">
          <div class="fw-semibold">${epbEsc(epbFormatarDataHist(item.criado_em))}</div>
          <div class="${ok ? 'text-success' : 'text-danger'}">${epbEsc(item.status || '—')}</div>
          <div class="text-muted">${epbEsc(item.arquivo || '')} — ${item.quantidade_produtos ?? 0} produto(s)</div>
          ${item.pasta ? `<div class="font-monospace">${epbEsc(item.pasta)}</div>` : ''}
          ${item.erro ? `<div class="text-danger">${epbEsc(item.erro)}</div>` : ''}
        </div>`;
      }).join('');
      return;
    }

    const q = new URLSearchParams({ limite: '40' });
    if (eqId) q.set('equipamento_id', String(eqId));
    const resp = await fetch(`${epbApi()}/equipamentos/plu/sync-log?${q}`, { headers: epbHeaders() });
    const body = await resp.json().catch(() => ({}));
    const hist = Array.isArray(body.historico) ? body.historico : [];
    if (!hist.length) {
      lista.innerHTML = '<div class="text-muted small">Nenhuma sincronização registrada.</div>';
      return;
    }
    lista.innerHTML = hist.map((item) => {
      const ok = String(item.resultado || '').toUpperCase() === 'SUCESSO';
      const eq = item.equipamento_nome || item.equipamento_modelo || '';
      const prod = item.produto_nome || item.plu || '—';
      const tempo = item.tempo_ms != null ? `${item.tempo_ms} ms` : '';
      const msg = !ok && item.mensagem ? epbEsc(item.mensagem) : '';
      return `<div class="border-bottom py-2 mb-1 small">
        <div class="fw-semibold">${epbEsc(epbFormatarDataHist(item.created_at))}</div>
        <div class="${ok ? 'text-success' : 'text-danger'}">${ok ? 'Sucesso' : 'Erro'}</div>
        <div class="text-muted">${epbEsc(prod)}${eq ? `<br>Equipamento<br>${epbEsc(eq)}` : ''}</div>
        ${ok && tempo ? `<div>${epbEsc(tempo)}</div>` : ''}
        ${msg ? `<div class="text-danger">${msg}</div>` : ''}
      </div>`;
    }).join('');
  } catch (err) {
    lista.innerHTML = `<div class="text-danger small">${epbEsc(err.message || 'Erro ao carregar')}</div>`;
  }
}

async function epbCarregarEquipamentos() {
  const sel = document.getElementById('epbEquipamento');
  if (!sel) return;
  try {
    const resp = await fetch(`${epbApi()}/equipamentos?todos=1`, { headers: epbHeaders() });
    const body = await resp.json().catch(() => ([]));
    const lista = Array.isArray(body) ? body : (body.equipamentos || body.data || []);
    __epbEquipamentos = lista.filter((e) => {
      const driver = String(e.driver_codigo || e.driver || '').toUpperCase();
      const fab = String(e.fabricante || '').toLowerCase();
      const modelo = String(e.modelo || '').toLowerCase();
      return driver.includes('TOLEDO')
        || fab.includes('toledo')
        || modelo.includes('prix');
    });
    if (!__epbEquipamentos.length) {
      __epbEquipamentos = lista.filter((e) => e.ip || e.host);
    }
    sel.innerHTML = __epbEquipamentos.length
      ? __epbEquipamentos.map((e) => {
        const label = `${e.nome || e.modelo || 'Equipamento'} — ${e.ip || e.host || '?'}:${e.porta_tcp || e.porta || 9000}`;
        return `<option value="${e.id}">${epbEsc(label)}</option>`;
      }).join('')
      : '<option value="">Nenhum equipamento Toledo cadastrado</option>';
    await epbAtualizarStatus();
  } catch (err) {
    sel.innerHTML = '<option value="">Erro ao carregar equipamentos</option>';
    epbLog(`Erro ao listar equipamentos: ${err.message}`, 'erro');
  }
}

async function epbAtualizarStatus() {
  const el = document.getElementById('epbStatus');
  const id = epbEquipamentoIdAtual();
  if (!el) return;
  if (!id) {
    el.innerHTML = '<span class="text-muted">⚪ Sem equipamento</span>';
    __epbModoEnvio = 'TCP';
    epbAtualizarUiModo();
    return;
  }
  __epbModoEnvio = await epbObterModoEnvio(id);
  epbAtualizarUiModo();

  if (__epbModoEnvio === 'MGV6') {
    el.innerHTML = '<span class="text-secondary">📁 Pronto para exportar (MGV6)</span>';
    return;
  }

  const eq = __epbEquipamentos.find((e) => Number(e.id) === id);
  try {
    const q = new URLSearchParams({
      equipamentoId: String(id),
      host: eq?.ip || eq?.host || '',
      porta: String(eq?.porta_tcp || eq?.porta || 9000)
    });
    const resp = await fetch(`${epbApi()}/equipamentos/status?${q}`, { headers: epbHeaders() });
    const body = await resp.json().catch(() => ({}));
    const connected = body.connected === true || body.conectado === true
      || String(body.status || body.estado || '').toUpperCase() === 'CONNECTED';
    el.innerHTML = connected
      ? '<span class="text-success">🟢 Conectado</span>'
      : '<span class="text-secondary">🔴 Desconectado</span>';
  } catch (_) {
    el.innerHTML = '<span class="text-muted">⚪ Status indisponível</span>';
  }
}

async function epbGarantirConexao() {
  const id = epbEquipamentoIdAtual();
  const eq = __epbEquipamentos.find((e) => Number(e.id) === id);
  if (!id || !eq) throw new Error('Selecione um equipamento.');
  if (__epbModoEnvio === 'MGV6') {
    throw new Error('Equipamento em modo MGV6 — conexão TCP não é utilizada no envio.');
  }
  const host = eq.ip || eq.host;
  const porta = eq.porta_tcp || eq.porta || 9000;
  const resp = await fetch(`${epbApi()}/equipamentos/connect`, {
    method: 'POST',
    headers: epbHeaders(),
    body: JSON.stringify({ id, equipamentoId: id, host, porta })
  });
  const body = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(body.error || `Falha ao conectar (${resp.status})`);
  await epbAtualizarStatus();
  return { id, host, porta };
}

async function epbCarregarProdutos() {
  try {
    const resp = await fetch(`${epbApi()}/produtos?modo_fiscal=0`, { headers: epbHeaders() });
    const body = await resp.json().catch(() => ([]));
    const lista = Array.isArray(body) ? body : (body.produtos || body.data || []);
    __epbProdutos = lista.filter((p) => {
      const key = epbPluKey(p);
      if (!key || key === 'undefined' || key === 'null') return false;
      return epbElegivelBalanca(p);
    });
    for (const sel of [...__epbSelecionados]) {
      if (!__epbProdutos.some((p) => epbPluKey(p) === sel)) {
        __epbSelecionados.delete(sel);
      }
    }
    epbRenderLista();
    epbAtualizarContador();
    epbLog(`${__epbProdutos.length} produto(s) pesável(is) carregado(s).`);
  } catch (err) {
    epbLog(`Erro ao carregar produtos: ${err.message}`, 'erro');
  }
}

/** RC14.15.3 — pipeline TCP (inalterado). */
async function epbEnviarSelecionadosTCP(plus, id) {
  let ok = 0;
  let erro = 0;
  await epbGarantirConexao();
  for (let i = 0; i < plus.length; i += 1) {
    const plu = plus[i];
    const nome = epbNomePorPlu(plu);
    const pct = Math.round((i / plus.length) * 100);
    epbSetProgresso(pct, `⏳ ${nome}…`);
    epbLog(`⏳ ${nome} enviada`);

    try {
      const payload = {
        plus: [plu],
        operacao: __epbModoEnviarTodos ? 'ENVIAR_TODOS' : 'ENVIAR_LOTE'
      };
      const resp = await fetch(`${epbApi()}/equipamentos/${id}/upload-plus`, {
        method: 'POST',
        headers: epbHeaders(),
        body: JSON.stringify(payload)
      });
      const body = await resp.json().catch(() => ({}));
      const item = Array.isArray(body.resultados) ? body.resultados[0] : null;
      const sucesso = resp.ok && (body.success === true || item?.success === true);
      if (sucesso) {
        ok += 1;
        epbLog('✅ ACK recebido', 'ok');
      } else {
        erro += 1;
        const motivos = Array.isArray(item?.motivos) && item.motivos.length
          ? item.motivos
          : (Array.isArray(body.motivos) && body.motivos.length
            ? body.motivos
            : (Array.isArray(item?.errors) ? item.errors.map((e) => e.motivo || e).filter(Boolean) : []));
        epbLog('❌ Produto não enviado', 'erro');
        if (motivos.length) {
          epbLog('Motivo:', 'erro');
          motivos.forEach((m) => epbLog(`• ${m}`, 'erro'));
        } else {
          const msg = item?.error || body.error || 'falha';
          if (String(msg).toUpperCase() !== 'VALIDATION_ERROR') {
            epbLog(`• ${msg}`, 'erro');
          } else {
            epbLog('• Validação falhou (detalhes indisponíveis).', 'erro');
          }
        }
      }
    } catch (err) {
      erro += 1;
      epbLog('❌ Produto não enviado', 'erro');
      epbLog(`• ${err.message}`, 'erro');
    }
    epbSetProgresso(Math.round(((i + 1) / plus.length) * 100), `${i + 1}/${plus.length}`);
  }
  return { ok, erro };
}

/**
 * RC14.15.12 — diálogo legado: Aviso / "Deseja iniciar o software da balança?"
 * Sem caminho, PID, SQL ou instruções técnicas no diálogo.
 * @returns {Promise<boolean>}
 */
function epbPerguntarIniciarSoftwareBalanca() {
  return new Promise((resolve) => {
    const existing = document.getElementById('epbModalIniciarMgv6');
    if (existing) existing.remove();

    const wrap = document.createElement('div');
    wrap.innerHTML = `
<div class="modal fade" id="epbModalIniciarMgv6" tabindex="-1" aria-labelledby="epbModalIniciarMgv6Title" aria-hidden="true">
  <div class="modal-dialog modal-dialog-centered">
    <div class="modal-content">
      <div class="modal-header py-2">
        <h5 class="modal-title" id="epbModalIniciarMgv6Title">Aviso</h5>
        <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Fechar"></button>
      </div>
      <div class="modal-body">Deseja iniciar o software da balança?</div>
      <div class="modal-footer py-2">
        <button type="button" class="btn btn-primary" id="epbBtnMgv6Sim">Sim</button>
        <button type="button" class="btn btn-secondary" id="epbBtnMgv6Nao" data-bs-dismiss="modal">Não</button>
      </div>
    </div>
  </div>
</div>`;
    document.body.appendChild(wrap.firstElementChild);
    const el = document.getElementById('epbModalIniciarMgv6');
    let settled = false;
    const finish = (valor) => {
      if (settled) return;
      settled = true;
      try {
        const inst = bootstrap.Modal.getInstance(el);
        if (inst) inst.hide();
      } catch (_) { /* ignore */ }
      resolve(valor);
      setTimeout(() => { try { el.remove(); } catch (_) { /* ignore */ } }, 300);
    };

    if (typeof bootstrap !== 'undefined' && bootstrap.Modal) {
      const modal = new bootstrap.Modal(el, { backdrop: 'static', keyboard: true });
      el.querySelector('#epbBtnMgv6Sim')?.addEventListener('click', () => finish(true), { once: true });
      el.querySelector('#epbBtnMgv6Nao')?.addEventListener('click', () => finish(false), { once: true });
      el.addEventListener('hidden.bs.modal', () => finish(false), { once: true });
      modal.show();
      return;
    }

    // Fallback próximo ao MessageBox do legado
    finish(window.confirm('Deseja iniciar o software da balança?'));
  });
}

/**
 * RC14.15.3 / RC14.15.12 — pipeline MGV6 exclusivo (sem connect / upload-plus / carga).
 * Layout gerado pelo backend: MGV6-REAL-CLIENT-V1 (TXITENS.TXT, 320 chars).
 * Sempre export-all: TXITENS parcial sobrescreve o arquivo e apaga os demais PLUs na carga.
 */
async function epbEnviarSelecionadosMGV6(id) {
  const produtoIds = epbIdsSelecionados();
  if (!produtoIds.length) {
    throw new Error('Não foi possível resolver os IDs dos produtos selecionados.');
  }

  epbLog(`Seleção na tela: ${produtoIds.length} produto(s) (referência).`);
  epbLog('Modo: MGV6 — exportando catálogo completo (todos elegíveis).');
  epbLog('Motivo: TXITENS.TXT é dump completo; lista parcial apaga os demais PLUs.');
  produtoIds.slice(0, 20).forEach((pid) => {
    const p = __epbProdutos.find((x) => Number(x.id) === Number(pid));
    if (!p) return;
    epbLog(`Produto (seleção): ${p.nome || pid}`);
    epbLog(`Código interno: ${p.codigo || '-'}`);
    epbLog(`PLU: ${p.plu || '-'}`);
  });
  if (produtoIds.length > 20) {
    epbLog(`… e mais ${produtoIds.length - 20} na seleção.`);
  }
  epbLog('Exportando TXITENS.TXT (export-all)...');
  epbSetProgresso(20, '⏳ Exportando catálogo completo…');

  const resp = await fetch(`${epbApi()}/equipamentos/mgv6/export-all`, {
    method: 'POST',
    headers: epbHeaders(),
    body: JSON.stringify({
      equipamentoId: id,
      autoLaunch: false
    })
  });
  const body = await resp.json().catch(() => ({}));
  if (!resp.ok || body.sucesso === false) {
    const code = String(body?.codigo || body?.code || '').toUpperCase();
    if (code.includes('PLU_REQUIRED')) {
      epbLog('❌ Produto marcado para balança sem PLU configurado.', 'erro');
    }
    const msg = epbMensagemErroMgv6(body, body.error || `HTTP ${resp.status}`);
    epbLog(msg, 'erro');
    throw new Error(body.mensagem || body.error || msg);
  }

  epbSetProgresso(80, '✔ Arquivo gerado');
  const arquivo = body.arquivo || 'TXITENS.TXT';
  const qtd = Number(body.quantidade) || 0;
  epbLog(`✔ ${arquivo} gerado`, 'ok');
  epbLog(`✔ Produtos no arquivo: ${qtd || '?'}`, 'ok');
  const omitQtd = Number(body.quantidadeOmitidosSemPlu) || (Array.isArray(body.omitidosSemPlu) ? body.omitidosSemPlu.length : 0);
  if (omitQtd > 0) {
    epbLog(`⚠ ${omitQtd} produto(s) omitido(s) sem PLU`, 'warn');
    (Array.isArray(body.omitidosSemPlu) ? body.omitidosSemPlu : []).slice(0, 10).forEach((o) => {
      epbLog(`  • ${o?.nome || o?.produtoId || '?'} (sem PLU)`, 'warn');
    });
  }
  epbLog(`✔ Registro: ${body.registroLength || 320} caracteres`, 'ok');
  const plusExp = Array.isArray(body.plusExportados) && body.plusExportados.length
    ? body.plusExportados
    : (Array.isArray(body.plus) ? body.plus.map((p) => String(p).replace(/\D/g, '').padStart(6, '0').slice(-6)) : []);
  plusExp.forEach((p) => epbLog(`PLU exportado: ${p}`, 'ok'));
  if (body.caminho || body.pasta) {
    epbLog(`Pasta: ${body.caminho || `${body.pasta}\\${arquivo}`}`, 'ok');
  }
  if (body.validacao?.ok !== false) {
    epbLog('✔ TXITENS validado', 'ok');
  }

  if (!body.mgv6?.encontrado) {
    epbLog('Software MGV6 não encontrado neste computador.', 'warn');
    if (body.mgv6?.erro) {
      epbLog(`Detalhe técnico: ${body.mgv6.erro}`, 'info');
    }
    return { ok: qtd || produtoIds.length, erro: 0, body, mgv6Iniciado: false };
  }

  epbLog('✔ MGV6 encontrado', 'ok');
  epbLog('Aguardando decisão do usuário para iniciar MGV6...', 'info');
  epbSetProgresso(90, 'Aguardando decisão…');

  const desejaIniciar = await epbPerguntarIniciarSoftwareBalanca();
  if (!desejaIniciar) {
    epbLog('MGV6 não iniciado pelo usuário.', 'info');
    return { ok: qtd || produtoIds.length, erro: 0, body, mgv6Iniciado: false };
  }

  const launchResp = await fetch(`${epbApi()}/equipamentos/mgv6/launch`, {
    method: 'POST',
    headers: epbHeaders(),
    body: JSON.stringify({ equipamentoId: id })
  });
  const launchBody = await launchResp.json().catch(() => ({}));
  if (
    !launchResp.ok
    || launchBody.sucesso === false
    || launchBody.iniciado !== true
  ) {
    epbLog('❌ Não foi possível abrir o MGV6.', 'erro');
    const motivo = launchBody.motivo || launchBody.mensagem || launchBody.error || 'Falha ao abrir MGV6';
    epbLog(`Motivo: ${motivo}`, 'warn');
    if (launchBody.code || launchBody.codigo) {
      epbLog(`Código: ${launchBody.code || launchBody.codigo}`, 'warn');
    }
    epbLog('ℹ A carga da balança é realizada manualmente no MGV6.', 'info');
    return { ok: qtd || produtoIds.length, erro: 0, body, mgv6Iniciado: false };
  }

  epbLog('✔ MGV6 aberto pelo Windows', 'ok');
  epbLog('ℹ A carga da balança é realizada manualmente no MGV6.', 'info');
  return { ok: qtd || produtoIds.length, erro: 0, body, mgv6Iniciado: true };
}

async function epbEnviarSelecionados() {
  if (__epbEnviando) return;
  const plus = [...__epbSelecionados];
  if (!plus.length) {
    const msg = 'Selecione pelo menos um produto.';
    if (typeof showNotification === 'function') showNotification(msg, 'warning');
    epbLog(msg, 'warn');
    return;
  }

  const id = epbEquipamentoIdAtual();
  if (!id) {
    const msg = 'Selecione um equipamento.';
    if (typeof showNotification === 'function') showNotification(msg, 'warning');
    epbLog(msg, 'warn');
    return;
  }

  __epbEnviando = true;
  epbAtualizarContador();
  epbSetProgresso(0, 'Iniciando…');

  let ok = 0;
  let erro = 0;
  try {
    __epbModoEnvio = await epbObterModoEnvio(id);
    epbAtualizarUiModo();

    if (__epbModoEnvio === 'MGV6') {
      const r = await epbEnviarSelecionadosMGV6(id);
      ok = r.ok;
      erro = r.erro;
    } else {
      epbLog(`Iniciando envio de ${plus.length} produto(s) pesável(is)…`);
      const r = await epbEnviarSelecionadosTCP(plus, id);
      ok = r.ok;
      erro = r.erro;
    }

    epbLog('Finalizado', ok && !erro ? 'ok' : 'warn');
    const btnHist = document.getElementById('epbBtnHistorico');
    if (btnHist) btnHist.classList.remove('d-none');
    if (typeof showNotification === 'function') {
      if (erro) {
        showNotification(`Envio concluído com ${erro} erro(s).`, 'warning');
      } else if (__epbModoEnvio === 'MGV6') {
        const omit = Number(r.body?.quantidadeOmitidosSemPlu) || 0;
        showNotification(
          `Catálogo completo gerado (${ok} produto(s) no TXITENS). A carga da balança é realizada manualmente no MGV6.`,
          'success'
        );
        if (omit > 0) {
          showNotification(
            r.body?.aviso ||
            `${omit} produto(s) omitido(s) sem PLU. Cadastre o PLU ou desmarque Integrar com Balança.`,
            'warning'
          );
        }
      } else {
        showNotification(`${ok} produto(s) enviado(s).`, 'success');
      }
    }
  } catch (err) {
    epbLog(`❌ ${err.message}`, 'erro');
    if (typeof showNotification === 'function') showNotification(err.message, 'danger');
  } finally {
    __epbEnviando = false;
    epbAtualizarContador();
    epbSetProgresso(100, 'Concluído');
    await epbAtualizarStatus();
  }
}

function loadEnviarProdutosBalanca() {
  const root = document.getElementById('page-content');
  if (!root) return;

  root.innerHTML = `
    <div class="container-fluid py-3" id="epbRoot">
      <nav aria-label="breadcrumb" class="mb-2">
        <ol class="breadcrumb mb-0 small">
          <li class="breadcrumb-item">Equipamentos</li>
          <li class="breadcrumb-item">Toledo Prix IV</li>
          <li class="breadcrumb-item active">Enviar Produtos</li>
        </ol>
      </nav>
      <h3 class="mb-3">Enviar Produtos para Balança</h3>

      <div class="row g-3 mb-3">
        <div class="col-md-6">
          <label class="form-label mb-1" for="epbEquipamento">Equipamento</label>
          <select id="epbEquipamento" class="form-select"></select>
          <div class="mt-1"><span id="epbModoBadge" class="badge text-bg-primary">Método: TCP Oficial</span></div>
        </div>
        <div class="col-md-6 d-flex align-items-end">
          <div>
            <div class="text-muted small">Status</div>
            <div id="epbStatus" class="fs-5">⚪ —</div>
          </div>
          <button type="button" class="btn btn-outline-secondary btn-sm ms-3" id="epbBtnStatus">Atualizar status</button>
          <button type="button" class="btn btn-outline-primary btn-sm ms-2" id="epbBtnConectar">Conectar</button>
        </div>
      </div>

      <div class="card mb-3">
        <div class="card-header d-flex flex-wrap gap-2 align-items-center justify-content-between">
          <div class="d-flex align-items-center gap-2">
            <strong>Produtos</strong>
            <span class="badge text-bg-info" title="Filtro fixo RC15.2">Produtos Pesáveis</span>
          </div>
          <div class="d-flex flex-wrap gap-2 align-items-center">
            <input type="search" id="epbBusca" class="form-control form-control-sm" style="min-width:220px;"
              placeholder="Buscar produto pesável…">
            <button type="button" class="btn btn-sm btn-outline-secondary" id="epbBtnTodos">Selecionar Todos</button>
            <button type="button" class="btn btn-sm btn-outline-secondary" id="epbBtnNenhum">Desmarcar Todos</button>
          </div>
        </div>
        <div class="card-body p-0" style="max-height:340px; overflow:auto;">
          <table class="table table-sm table-hover mb-0">
            <thead class="table-light sticky-top">
              <tr>
                <th></th>
                <th>PLU</th>
                <th>Nome</th>
              </tr>
            </thead>
            <tbody id="epbListaBody">
              <tr><td colspan="3" class="text-muted">Carregando…</td></tr>
            </tbody>
          </table>
        </div>
        <div class="card-footer d-flex flex-wrap gap-3 align-items-center justify-content-between">
          <div>Selecionados: <strong id="epbSelecionadosCount">0</strong></div>
          <div class="d-flex gap-2">
            <button type="button" class="btn btn-outline-secondary d-none" id="epbBtnHistorico">Ver Histórico</button>
            <button type="button" class="btn btn-primary" id="epbBtnEnviar" disabled>Enviar Selecionados</button>
          </div>
        </div>
      </div>

      <div class="mb-2">
        <div class="d-flex justify-content-between small mb-1">
          <span id="epbProgressLabel">—</span>
          <span id="epbProgressPct"></span>
        </div>
        <div class="progress" style="height: 10px;">
          <div id="epbProgressBar" class="progress-bar" role="progressbar" style="width:0%" aria-valuenow="0" aria-valuemin="0" aria-valuemax="100"></div>
        </div>
      </div>

      <div class="card mb-3">
        <div class="card-header"><strong>LOG</strong></div>
        <div class="card-body font-monospace small" id="epbLog"
          style="min-height:140px; max-height:260px; overflow:auto; background:#f8f9fa;"></div>
      </div>

      <div class="card d-none" id="epbHistoricoBox">
        <div class="card-header d-flex justify-content-between align-items-center">
          <strong>Histórico de Sincronização</strong>
          <button type="button" class="btn btn-sm btn-outline-secondary" id="epbBtnHistoricoFechar">Fechar</button>
        </div>
        <div class="card-body" id="epbHistoricoLista" style="max-height:320px; overflow:auto;"></div>
      </div>
    </div>
  `;

  document.getElementById('epbEquipamento')?.addEventListener('change', () => epbAtualizarStatus());
  document.getElementById('epbBtnStatus')?.addEventListener('click', () => epbAtualizarStatus());
  document.getElementById('epbBtnConectar')?.addEventListener('click', async () => {
    try {
      await epbGarantirConexao();
      epbLog('Conexão OK.', 'ok');
    } catch (err) {
      epbLog(err.message, 'erro');
    }
  });
  document.getElementById('epbBusca')?.addEventListener('input', () => epbRenderLista());
  document.getElementById('epbBtnTodos')?.addEventListener('click', () => epbSelecionarTodos(true));
  document.getElementById('epbBtnNenhum')?.addEventListener('click', () => epbSelecionarTodos(false));
  document.getElementById('epbBtnEnviar')?.addEventListener('click', () => epbEnviarSelecionados());
  document.getElementById('epbBtnHistorico')?.addEventListener('click', () => epbCarregarHistorico());
  document.getElementById('epbBtnHistoricoFechar')?.addEventListener('click', () => {
    document.getElementById('epbHistoricoBox')?.classList.add('d-none');
  });

  epbCarregarEquipamentos();
  epbCarregarProdutos();
}

window.loadEnviarProdutosBalanca = loadEnviarProdutosBalanca;
window.epbPerguntarIniciarSoftwareBalanca = epbPerguntarIniciarSoftwareBalanca;
