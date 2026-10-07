/**
 * Sprint 01–06 — Fechamento Fiscal do Dia.
 * Monitoramento diário + prévia + preparação — sem baixa estoque / financeiro.
 */

'use strict';

let __ffdEstado = {
  fechamentoId: null,
  data: null,
  resumo: null,
  previa: null,
  indicadores: null,
  complementacao: null,
  recebimentos: [],
  recebimentosLocais: false,
  vendasElegiveis: [],
  vendasElegiveisCarregadas: false,
  vista: 'venda', // venda | produto
  validacao: null,
  documentos: [],
  statusFiscal: null,
  moduloOn: false,
  ambiente: null,
  transmissaoHabilitada: false,
  diagnosticoTx: null,
  transmitindo: false,
  modoRecebimento: 'por_maquina',
  comprovantes: [],
  filaEmissao: {
    status: 'IDLE',
    total: 0,
    indiceAtual: 0,
    vendaAtualId: null,
    countdownMs: null,
    resultados: [],
    resumo: null,
    mensagem: null
  },
  pollTimer: null,
  ultimaAtualizacao: null,
  montado: false,
  ops: { previa: false, validar: false, preparar: false, salvar: false, transmitir: false, emitir: false },
  usuarioEditando: false
};

const FFD_POLL_MS = 10000;
const FFD_PREVIA_TIMEOUT_MS = 120000;
let ffdPreviaAttemptCounter = 0;
let ffdPreviaClickAt = null;

function ffdApi() {
  return (typeof API_URL === 'string' && API_URL.trim() !== '')
    ? API_URL
    : `${window.location.origin}/api`;
}

function ffdHeaders() {
  const headers = { 'Content-Type': 'application/json' };
  const token = localStorage.getItem('token');
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

function ffdLogDesenvolvimento(evento, payload) {
  const hostLocal = ['localhost', '127.0.0.1'].includes(String(window.location.hostname || '').toLowerCase());
  const debugAtivo = hostLocal || localStorage.getItem('cds_debug') === '1';
  if (debugAtivo) console.debug(`[FFD] ${evento}`, payload);
}

function ffdHojeISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function ffdFmtMoney(n) {
  return Number(n || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function ffdEsc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function ffdNotify(msg, tipo = 'info') {
  if (typeof showNotification === 'function') showNotification(msg, tipo);
  else console.warn('[FFD]', msg);
}

function ffdErroApi(body, fallback) {
  const payload = body && typeof body === 'object' ? body : {};
  const linhas = [];
  if (payload.error) linhas.push(payload.error);
  if (payload.detalhes && payload.detalhes !== payload.error) linhas.push(payload.detalhes);
  if (Array.isArray(payload.erros)) {
    payload.erros.forEach((e) => {
      const texto = e && (e.mensagem || e.message);
      if (texto) linhas.push(texto);
    });
  }
  const msg = linhas.filter(Boolean).join('\n') || fallback || 'Erro ao processar.';
  console.error('[FFD] erro API', {
    error: payload.error,
    code: payload.code,
    detalhes: payload.detalhes,
    erros: payload.erros,
    checklist: payload.checklist,
    status: payload.status
  });
  return msg;
}

/**
 * Sprint 07.8 — referência da conciliação do próprio fechamento.
 * Com prévia persistida: usa a fotografia da composição, não o residual diário.
 */
function ffdValorReferenciaConciliacao() {
  const previa = __ffdEstado.previa;
  if (previa && previa.valor_distribuido != null && previa.valor_distribuido !== '') {
    return Number(previa.valor_distribuido || 0);
  }
  if (previa && previa.valor_informado != null && previa.valor_informado !== '') {
    return Number(previa.valor_informado || 0);
  }
  return Number(
    __ffdEstado.resumo?.valor_fiscal_elegivel
    ?? __ffdEstado.resumo?.valor_elegivel
    ?? 0
  );
}

function ffdDiferencaConciliacao() {
  const informado = ffdTotalRecebimentos();
  const referencia = ffdValorReferenciaConciliacao();
  return Math.round((referencia - informado) * 100) / 100;
}

function ffdRecebimentosConciliados() {
  return Math.abs(ffdDiferencaConciliacao()) < 0.005 && ffdTotalRecebimentos() > 0;
}

function ffdPreviaValida(previa) {
  const p = previa || __ffdEstado.previa;
  return Boolean(p && p.perfeita && (p.vendas || []).length);
}

function ffdModalAberto() {
  return Boolean(document.querySelector('.modal.show, .modal.showing'));
}

function ffdUsuarioEditandoTela() {
  const ativo = document.activeElement;
  if (!ativo) return false;
  return Boolean(ativo.closest && ativo.closest('#ffdValorAlvo, #ffdValorMin, #ffdValorMax, #ffdMaquinaModal, #ffdConfirmModal, #ffdAlertModal'));
}

function ffdOpsAtivas() {
  const ops = __ffdEstado.ops || {};
  return Object.keys(ops).some((k) => ops[k]);
}

async function ffdComLock(chave, botaoSel, rotuloBusy, fn) {
  if (!__ffdEstado.ops) {
    __ffdEstado.ops = { previa: false, validar: false, preparar: false, salvar: false, transmitir: false, emitir: false, limpar: false };
  }
  if (__ffdEstado.ops[chave]) return null;
  __ffdEstado.ops[chave] = true;
  const $btn = botaoSel ? $(botaoSel) : null;
  const original = $btn && $btn.length ? $btn.text() : null;
  if ($btn && $btn.length) {
    $btn.prop('disabled', true).text(rotuloBusy || 'Aguarde…');
  }
  try {
    return await fn();
  } finally {
    __ffdEstado.ops[chave] = false;
    if ($btn && $btn.length && original != null) {
      $btn.text(original);
    }
    ffdAtualizarBotoesEtapa5(__ffdEstado.previa);
  }
}

function ffdBlurSeDentro(modalEl) {
  const active = document.activeElement;
  if (active && modalEl && modalEl.contains(active) && typeof active.blur === 'function') {
    active.blur();
  }
}

function ffdFocoSeguro(trigger) {
  const candidatos = [
    trigger,
    document.getElementById('ffdBtnAtualizarPrevia'),
    document.getElementById('ffdRoot'),
    document.body
  ];
  for (const el of candidatos) {
    if (!el || !document.contains(el)) continue;
    if (typeof el.focus !== 'function') continue;
    try {
      el.focus({ preventScroll: true });
    } catch (_) {
      el.focus();
    }
    return el;
  }
  return null;
}

function ffdPrepararModalAcessivel(modalEl, trigger) {
  if (!modalEl || modalEl.dataset.ffdFocoBound === '1') return;
  modalEl.dataset.ffdFocoBound = '1';
  modalEl.addEventListener('hide.bs.modal', () => {
    ffdBlurSeDentro(modalEl);
  });
  modalEl.addEventListener('hidden.bs.modal', () => {
    ffdBlurSeDentro(modalEl);
    ffdFocoSeguro(trigger);
  });
}

/** Modal Bootstrap — Electron não suporta window.prompt / confirm / alert. */
function ffdRemoverModal(id) {
  const el = document.getElementById(id);
  if (!el) return;
  ffdBlurSeDentro(el);
  try {
    const inst = bootstrap.Modal.getInstance(el);
    if (inst) inst.dispose();
  } catch (_) { /* ignore */ }
  el.remove();
}

function ffdConfirm(mensagem, titulo = 'Confirmação', opcoes = {}) {
  return new Promise((resolve) => {
    const trigger = document.activeElement;
    ffdRemoverModal('ffdConfirmModal');
    const html = `
      <div class="modal fade" id="ffdConfirmModal" tabindex="-1" aria-hidden="true">
        <div class="modal-dialog modal-dialog-centered">
          <div class="modal-content">
            <div class="modal-header">
              <h5 class="modal-title">${ffdEsc(titulo)}</h5>
              <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Fechar"></button>
            </div>
            <div class="modal-body"><p class="mb-0" style="white-space:pre-wrap">${ffdEsc(mensagem)}</p></div>
            <div class="modal-footer">
              <button type="button" class="btn btn-secondary" id="ffdConfirmNao">Não</button>
              <button type="button" class="btn btn-primary" id="ffdConfirmSim">Sim</button>
            </div>
          </div>
        </div>
      </div>`;
    const host = document.getElementById('modal-container') || document.body;
    host.insertAdjacentHTML('beforeend', html);
    const el = document.getElementById('ffdConfirmModal');
    el.querySelector('#ffdConfirmNao').textContent = opcoes.rotuloCancelar || 'Não';
    el.querySelector('#ffdConfirmSim').textContent = opcoes.rotuloConfirmar || 'Sim';
    const modal = new bootstrap.Modal(el, { backdrop: 'static', keyboard: true });
    let decidido = false;
    let resultado = false;
    const finalizar = (ok) => {
      if (decidido) return;
      decidido = true;
      resultado = ok === true;
      ffdBlurSeDentro(el);
      modal.hide();
    };
    ffdPrepararModalAcessivel(el, trigger);
    el.querySelector('#ffdConfirmNao').addEventListener('click', (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      finalizar(false);
    });
    el.querySelector('#ffdConfirmSim').addEventListener('click', (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      finalizar(true);
    });
    el.addEventListener('hidden.bs.modal', () => {
      ffdBlurSeDentro(el);
      ffdFocoSeguro(trigger);
      ffdRemoverModal('ffdConfirmModal');
      resolve(resultado === true);
    }, { once: true });
    modal.show();
  });
}

function ffdAlert(mensagem, titulo = 'Detalhe') {
  return new Promise((resolve) => {
    const trigger = document.activeElement;
    ffdRemoverModal('ffdAlertModal');
    const html = `
      <div class="modal fade" id="ffdAlertModal" tabindex="-1" aria-hidden="true">
        <div class="modal-dialog modal-dialog-centered modal-lg">
          <div class="modal-content">
            <div class="modal-header">
              <h5 class="modal-title">${ffdEsc(titulo)}</h5>
              <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Fechar"></button>
            </div>
            <div class="modal-body"><pre class="mb-0 small" style="white-space:pre-wrap">${ffdEsc(mensagem)}</pre></div>
            <div class="modal-footer">
              <button type="button" class="btn btn-primary" data-bs-dismiss="modal">OK</button>
            </div>
          </div>
        </div>
      </div>`;
    const host = document.getElementById('modal-container') || document.body;
    host.insertAdjacentHTML('beforeend', html);
    const el = document.getElementById('ffdAlertModal');
    const modal = new bootstrap.Modal(el);
    ffdPrepararModalAcessivel(el, trigger);
    el.addEventListener('hide.bs.modal', () => ffdBlurSeDentro(el));
    el.addEventListener('hidden.bs.modal', () => {
      ffdBlurSeDentro(el);
      ffdFocoSeguro(trigger);
      ffdRemoverModal('ffdAlertModal');
      resolve();
    }, { once: true });
    modal.show();
  });
}

function ffdAbrirModalMaquina() {
  return new Promise((resolve) => {
    const trigger = document.activeElement;
    ffdRemoverModal('ffdMaquinaModal');
    const modoPorComprovante = __ffdEstado.modoRecebimento === 'por_comprovante';
    const html = `
      <div class="modal fade" id="ffdMaquinaModal" tabindex="-1" aria-hidden="true">
        <div class="modal-dialog modal-dialog-centered">
          <div class="modal-content">
            <div class="modal-header">
              <h5 class="modal-title">Adicionar máquina / operadora</h5>
              <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Fechar"></button>
            </div>
            <div class="modal-body">
              <div class="mb-3">
                <label for="ffdMaqOperadora" class="form-label">Máquina / Operadora *</label>
                <input type="text" class="form-control" id="ffdMaqOperadora"
                  placeholder="Ex.: Sicredi, Stone, Mercado Pago" autocomplete="off">
              </div>
              ${modoPorComprovante ? `
                <div class="mb-3">
                  <div class="d-flex justify-content-between align-items-center mb-2">
                    <label class="form-label mb-0">Valores recebidos *</label>
                    <button type="button" class="btn btn-sm btn-outline-primary" id="ffdMaqAddValor">+ Valor</button>
                  </div>
                  <div id="ffdMaqValoresList">
                    <div class="input-group mb-2" data-ffd-maq-valor-linha>
                      <input type="text" class="form-control" data-ffd-maq-valor-input
                        placeholder="Ex.: 400,00" inputmode="decimal" autocomplete="off" aria-label="Valor recebido 1">
                      <button type="button" class="btn btn-outline-danger" data-ffd-maq-remover-valor aria-label="Remover valor">×</button>
                    </div>
                  </div>
                  <div class="small text-muted">Cada valor informado gera uma venda fiscal individual.</div>
                </div>
              ` : `
                <div class="mb-3">
                  <label for="ffdMaqValor" class="form-label">Valor recebido *</label>
                  <input type="text" class="form-control" id="ffdMaqValor"
                    placeholder="Ex.: 400,00" inputmode="decimal" autocomplete="off">
                </div>
              `}
              <div class="mb-0">
                <label for="ffdMaqCnpj" class="form-label">CNPJ da máquina (opcional)</label>
                <input type="text" class="form-control" id="ffdMaqCnpj"
                  placeholder="Somente números" autocomplete="off">
              </div>
            </div>
            <div class="modal-footer">
              <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Cancelar</button>
              <button type="button" class="btn btn-success" id="ffdMaqSalvar">Adicionar</button>
            </div>
          </div>
        </div>
      </div>`;
    const host = document.getElementById('modal-container') || document.body;
    host.insertAdjacentHTML('beforeend', html);
    const el = document.getElementById('ffdMaquinaModal');
    const modal = new bootstrap.Modal(el, { backdrop: 'static' });
    let decidido = false;

    const parseValor = (valorStr) => {
      let parsed = Number(String(valorStr || '').trim().replace(/\s/g, '').replace(',', '.'));
      if (!(parsed > 0) && String(valorStr || '').includes(',')) {
        parsed = Number(String(valorStr).trim().replace(/\./g, '').replace(',', '.'));
      }
      return parsed;
    };

    const montarValores = () => {
      if (!modoPorComprovante) return [el.querySelector('#ffdMaqValor')?.value || ''];
      return Array.from(el.querySelectorAll('[data-ffd-maq-valor-input]')).map((input) => input.value);
    };

    const adicionarLinhaValor = (valor = '') => {
      const container = el.querySelector('#ffdMaqValoresList');
      if (!container) return;
      const linha = document.createElement('div');
      linha.className = 'input-group mb-2';
      linha.setAttribute('data-ffd-maq-valor-linha', '1');
      linha.innerHTML = `
        <input type="text" class="form-control" data-ffd-maq-valor-input
          placeholder="Ex.: 400,00" inputmode="decimal" autocomplete="off" aria-label="Valor recebido" value="${ffdEsc(valor)}">
        <button type="button" class="btn btn-outline-danger" data-ffd-maq-remover-valor aria-label="Remover valor">×</button>
      `;
      const remover = linha.querySelector('[data-ffd-maq-remover-valor]');
      remover.addEventListener('click', () => {
        linha.remove();
      });
      container.appendChild(linha);
      const input = linha.querySelector('[data-ffd-maq-valor-input]');
      if (input) input.focus();
    };

    if (modoPorComprovante) {
      const botaoAdd = el.querySelector('#ffdMaqAddValor');
      if (botaoAdd) {
        botaoAdd.addEventListener('click', () => adicionarLinhaValor());
      }
      el.querySelectorAll('[data-ffd-maq-remover-valor]').forEach((botao) => {
        botao.addEventListener('click', () => {
          const linha = botao.closest('[data-ffd-maq-valor-linha]');
          if (linha) linha.remove();
        });
      });
    }

    let resultado = null;
    const finalizar = (dados) => {
      if (decidido) return;
      decidido = true;
      resultado = dados || null;
      ffdBlurSeDentro(el);
      modal.hide();
    };
    ffdPrepararModalAcessivel(el, trigger);

    el.querySelector('#ffdMaqSalvar').addEventListener('click', () => {
      const operadora = String(el.querySelector('#ffdMaqOperadora').value || '').trim();
      const cnpj = String(el.querySelector('#ffdMaqCnpj').value || '').replace(/\D/g, '');
      if (!operadora) {
        ffdNotify('Informe a máquina / operadora.', 'warning');
        el.querySelector('#ffdMaqOperadora').focus();
        return;
      }

      if (modoPorComprovante) {
        const valores = [];
        for (const valor of montarValores()) {
          const texto = String(valor || '').trim();
          if (texto === '') continue;
          const parsed = parseValor(valor);
          if (!(parsed > 0)) {
            ffdNotify('Há um valor inválido na lista.', 'warning');
            const primeiroInvalido = Array.from(el.querySelectorAll('[data-ffd-maq-valor-input]')).find((input) => {
              const campo = String(input.value || '').trim();
              return campo !== '' && !(parseValor(input.value) > 0);
            });
            if (primeiroInvalido) primeiroInvalido.focus();
            return;
          }
          valores.push(Math.round(parsed * 100) / 100);
        }

        if (!valores.length) {
          ffdNotify('Informe pelo menos um valor recebido.', 'warning');
          const primeiroInput = el.querySelector('[data-ffd-maq-valor-input]');
          if (primeiroInput) primeiroInput.focus();
          return;
        }

        finalizar({
          operadora,
          cnpj,
          valores: valores.map((valor) => ({ operadora, cnpj, valor }))
        });
        return;
      }

      const valorStr = el.querySelector('#ffdMaqValor').value;
      const parsed = parseValor(valorStr);
      if (!(parsed > 0)) {
        ffdNotify('Valor inválido.', 'warning');
        el.querySelector('#ffdMaqValor').focus();
        return;
      }
      finalizar({
        operadora,
        cnpj,
        valor: Math.round(parsed * 100) / 100
      });
    });

    el.addEventListener('hidden.bs.modal', () => {
      ffdBlurSeDentro(el);
      ffdFocoSeguro(trigger);
      ffdRemoverModal('ffdMaquinaModal');
      resolve(decidido ? resultado : null);
    }, { once: true });

    modal.show();
    setTimeout(() => {
      const input = document.getElementById('ffdMaqOperadora');
      if (input) input.focus();
    }, 200);
  });
}

function ffdTotalRecebimentos() {
  if (__ffdEstado.modoRecebimento === 'por_venda') {
    const totalCentavos = (__ffdEstado.vendasElegiveis || []).reduce((total, venda) => {
      const centavos = ffdParseValorCentavos(venda.valor_comprovante);
      return centavos == null ? total : total + centavos;
    }, 0);
    return totalCentavos / 100;
  }
  return (__ffdEstado.recebimentos || []).reduce((s, r) => s + Number(r.valor || 0), 0);
}

function ffdFmtDataBr(iso) {
  const s = String(iso || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return s || '—';
  const [y, m, d] = s.split('-');
  return `${d}/${m}/${y}`;
}

function ffdFmtHora(date = new Date()) {
  return date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function ffdPararPolling() {
  if (__ffdEstado.pollTimer) {
    clearInterval(__ffdEstado.pollTimer);
    __ffdEstado.pollTimer = null;
  }
  __ffdEstado.montado = false;
}

function ffdIniciarPolling() {
  ffdPararPolling();
  __ffdEstado.montado = true;
  __ffdEstado.pollTimer = setInterval(() => {
    if (!__ffdEstado.montado) return;
    if (!document.getElementById('ffdRoot')) {
      ffdPararPolling();
      return;
    }
    if (ffdModalAberto() || ffdUsuarioEditandoTela() || ffdOpsAtivas()) return;
    ffdCarregarDia({ silencioso: true });
  }, FFD_POLL_MS);
}

function ffdRotuloStatusMonitoramento(status) {
  const st = String(status || '').toUpperCase();
  if (!st || st === 'CANCELADO') return 'MONITORANDO';
  if (st === 'RASCUNHO') return 'FECHAMENTO EM PREPARAÇÃO';
  if (st === 'PREVIA' || st === 'VALIDANDO') return 'FECHAMENTO EM PREPARAÇÃO';
  if (st === 'PRONTO_EMISSAO') return 'PRONTO PARA EMISSÃO';
  if (st === 'EMITINDO' || st === 'PROCESSANDO') return 'EM PROCESSAMENTO';
  if (st === 'AUTORIZADO' || st === 'CONCLUIDO' || st === 'CONFIRMADO') return 'AUTORIZADO';
  if (st === 'AUTORIZACAO_PARCIAL') return 'AUTORIZAÇÃO PARCIAL';
  if (st === 'PENDENTE_RECUPERACAO') return 'PENDENTE DE RECUPERAÇÃO';
  if (st === 'REJEITADO') return 'REJEITADO';
  if (st === 'ERRO') return 'ERRO TÉCNICO';
  return st;
}

/** Fechamento já emitido/autorizado por completo — residual do dia NÃO deve excluir a própria prévia.
 *  AUTORIZACAO_PARCIAL NÃO é finalizado: ainda há saldo para CONTINUAR EMISSÃO. */
function ffdFechamentoFinalizado(status) {
  const st = String(status || __ffdEstado.statusFiscal || '').toUpperCase();
  return st === 'AUTORIZADO'
    || st === 'CONCLUIDO'
    || st === 'CONFIRMADO';
}

function ffdEhAutorizacaoParcial(status, saldo) {
  const st = String(status || __ffdEstado.statusFiscal || '').toUpperCase();
  // Já preparado o restante — não tratar como “precisa continuar”
  if (st === 'PRONTO_EMISSAO' || st === 'EMITINDO' || st === 'AUTORIZADO') return false;
  const s = saldo || __ffdEstado.saldo || {};
  if (st === 'AUTORIZACAO_PARCIAL') return true;
  return Number(s.valor_emitido_autorizado || 0) > 0
    && Number(s.valor_pendente_emissao || 0) > 0
    && st !== 'PENDENTE_RECUPERACAO';
}

/**
 * Só exclui o fechamento atual do residual quando ainda está em edição/regeneração de prévia.
 * Se AUTORIZADO, excluir faria o dia “voltar” com o valor já fechado (bug de tela suja).
 */
function ffdDeveExcluirFechamentoDoResumo(status) {
  if (ffdFechamentoFinalizado(status)) return false;
  const st = String(status || __ffdEstado.statusFiscal || '').toUpperCase();
  if (!st || st === 'CANCELADO') return false;
  return true;
}

function ffdRenderCabecalhoMonitor() {
  const on = Boolean(__ffdEstado.moduloOn);
  const el = document.getElementById('ffdMonitorBadge');
  if (el) {
    el.innerHTML = on
      ? '<span class="text-success">● Monitoramento ativo</span>'
      : '<span class="text-muted">○ Monitoramento desativado</span>';
  }
  const stEl = document.getElementById('ffdStatusFluxo');
  if (stEl) {
    stEl.textContent = ffdRotuloStatusMonitoramento(__ffdEstado.statusFiscal);
  }
  const dataIso = __ffdEstado.data || ffdHojeISO();
  const hoje = ffdHojeISO();
  const rotulo = dataIso === hoje ? `Hoje — ${ffdFmtDataBr(dataIso)}` : ffdFmtDataBr(dataIso);
  const dEl = document.getElementById('ffdDataRotulo');
  if (dEl) dEl.textContent = rotulo;
  const uEl = document.getElementById('ffdUltimaAtualizacao');
  if (uEl && __ffdEstado.ultimaAtualizacao) {
    uEl.textContent = `Última atualização: ${__ffdEstado.ultimaAtualizacao}`;
  }
}

function ffdRenderKpis(resumo) {
  const r = resumo || {};
  const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  set('ffdKpiVendasDia', String(r.vendas_do_dia ?? r.quantidade_vendas ?? 0));
  set('ffdKpiVendasNf', String(r.vendas_nao_fiscais ?? 0));
  set('ffdKpiValorNf', ffdFmtMoney(r.valor_nao_fiscal_vendido ?? 0));
  set('ffdKpiProdMonitor', String(r.produtos_fiscais_com_consumo_nao_fiscal ?? r.itens_fiscais_elegiveis ?? 0));
  set('ffdKpiUnidades', String(r.unidades_fiscais_elegiveis ?? 0));
  set('ffdKpiValorElegivel', ffdFmtMoney(r.valor_fiscal_elegivel ?? r.valor_elegivel ?? 0));
}

function ffdRenderAlertaInteligente(resumo) {
  const box = document.getElementById('ffdAlertaInteligente');
  if (!box) return;
  const r = resumo || {};
  const pendencias = Array.isArray(r.pendencias_fiscais) ? r.pendencias_fiscais : [];
  const unidades = Number(r.unidades_fiscais_elegiveis || 0);
  const produtos = Number(r.produtos_fiscais_com_consumo_nao_fiscal || 0);
  const valor = Number(r.valor_fiscal_elegivel || r.valor_elegivel || 0);
  if (pendencias.length > 0) {
    const recuperaveis = pendencias.filter((p) =>
      p.pode_recuperar_duplicidade === true
      || String(p.situacao || '').toUpperCase() === 'DUPLICIDADE_PENDENTE'
    );
    box.innerHTML = `
      <div class="alert alert-warning mb-0">
        <div class="fw-semibold mb-2">Há documentos fiscais que precisam de recuperação antes de concluir o fechamento.</div>
        <div class="small mb-1">Existem NFC-e com duplicidade pendente de recuperação.</div>
        <div class="small mb-2">${pendencias.length} documento(s) pendente(s). Essas vendas não foram incluídas nem classificadas como autorizadas.</div>
        <ul class="small mb-2">${pendencias.map((p) =>
          `<li>Venda #${ffdEsc(p.venda_id)} · NFC-e ${ffdEsc(p.nfce_id || '—')} · cStat ${ffdEsc((p.cstats || []).join(', ') || '—')} · ${ffdEsc(p.situacao || 'PENDENTE')}</li>`
        ).join('')}</ul>
        <div class="small">Demais itens elegíveis: <strong>${unidades}</strong> unidades · <strong>${ffdFmtMoney(valor)}</strong>.</div>
        ${recuperaveis.length ? '<button type="button" class="btn btn-outline-secondary btn-sm mt-3" id="ffdBtnRecuperarDuplicidades">RECUPERAR SITUAÇÃO FISCAL</button>' : ''}
      </div>`;
    const btn = document.getElementById('ffdBtnRecuperarDuplicidades');
    if (btn) btn.addEventListener('click', () => ffdRecuperarDuplicidades());
    return;
  }
  if (unidades > 0) {
    box.innerHTML = `
      <div class="alert alert-primary border-0 shadow-sm mb-0">
        <div class="fw-semibold mb-2">🔔 Foram identificadas vendas não fiscais de produtos fiscais.</div>
        <div class="mb-2">
          <strong>${produtos}</strong> produtos ·
          <strong>${unidades}</strong> unidades ·
          <strong>${ffdFmtMoney(valor)}</strong>
        </div>
        <div class="small mb-3">Esses valores estão disponíveis para composição do Fechamento Fiscal do Dia.</div>
        <button type="button" class="btn btn-primary btn-sm" id="ffdBtnAnalisar">ANALISAR FECHAMENTO</button>
      </div>`;
    const btn = document.getElementById('ffdBtnAnalisar');
    if (btn) {
      btn.addEventListener('click', () => {
        const alvo = document.getElementById('ffdSecaoRecebimentos');
        if (alvo) alvo.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    }
  } else if (ffdFechamentoFinalizado()) {
    const ffId = __ffdEstado.fechamentoId;
    const rotulo = ffId ? `FF-${String(Number(ffId)).padStart(6, '0')}` : 'fechamento';
    box.innerHTML = `
      <div class="alert alert-success border-0 shadow-sm mb-0">
        <div class="fw-semibold mb-2">✓ Fechamento Fiscal do Dia autorizado</div>
        <div class="small mb-1">O saldo elegível deste dia já foi consumido por <strong>${ffdEsc(rotulo)}</strong>.</div>
        <div class="small text-muted">Não há novos valores pendentes para composição. A NFC-e emitida permanece em Fiscal → NFC-e Emitidas.</div>
      </div>`;
  } else {
    box.innerHTML = `
      <div class="alert alert-light border mb-0">
        <div class="fw-semibold mb-2">Nenhuma unidade fiscal foi consumida em vendas não fiscais hoje.</div>
        <div class="small text-muted">
          Produtos com saldo fiscal vendidos: <strong>${r.produtos_fiscais_vendidos ?? 0}</strong><br>
          Unidades fiscais consumidas em operações não fiscais: <strong>0</strong>
        </div>
        <div class="small mt-2">Por isso, não há valores disponíveis para composição do fechamento.</div>
      </div>`;
  }
}

async function ffdRecuperarDuplicidades() {
  const pendencias = (__ffdEstado.resumo?.pendencias_fiscais || []).filter((p) =>
    p.pode_recuperar_duplicidade === true
    || String(p.situacao || '').toUpperCase() === 'DUPLICIDADE_PENDENTE'
  );
  if (!pendencias.length) {
    ffdNotify('Não há duplicidades cStat 539 aguardando recuperação.', 'info');
    return;
  }

  const confirmado = await ffdConfirm(
    'Esta operação consultará a situação fiscal dos documentos indicados na SEFAZ. Nenhuma nova NFC-e será emitida.',
    'Recuperar situação fiscal',
    { rotuloCancelar: 'Cancelar', rotuloConfirmar: 'Consultar SEFAZ' }
  );
  if (!confirmado) return;

  return ffdComLock('recuperarDuplicidades', '#ffdBtnRecuperarDuplicidades', 'Consultando SEFAZ…', async () => {
    try {
      const resp = await fetch(`${ffdApi()}/fiscal/fechamentos/recuperar-duplicidades`, {
        method: 'POST',
        headers: ffdHeaders(),
        body: JSON.stringify({
          confirmacao_consulta: true,
          data: __ffdEstado.data,
          pendencias: pendencias.map((p) => ({ venda_id: p.venda_id, nfce_id: p.nfce_id }))
        })
      });
      const body = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(ffdErroApi(body, `HTTP ${resp.status}`));
      if (body.resumo) {
        __ffdEstado.resumo = body.resumo;
        ffdRenderKpis(body.resumo);
        ffdRenderAlertaInteligente(body.resumo);
        ffdRenderGridMonitoramento(body.resumo);
      }
      const linhas = (body.resultados || []).map((r) =>
        `Venda #${r.venda_id || '—'}: ${r.situacao_fiscal || 'ERRO'} — ${r.mensagem || 'consulta concluída'}`
      );
      const falhas = (body.resultados || []).some((r) => !r.success);
      await ffdAlert(
        `${linhas.join('\n')}\n\nNenhuma nova NFC-e foi emitida.`,
        falhas ? 'Recuperação concluída com pendências' : 'Recuperação fiscal concluída'
      );
      await ffdCarregarDia();
    } catch (err) {
      ffdNotify(err.message || 'Não foi possível consultar a situação fiscal.', 'danger');
    }
  });
}

function ffdRenderGridMonitoramento(resumo) {
  const body = document.getElementById('ffdGridBody');
  if (!body) return;
  const rows = (resumo && resumo.monitoramento) || [];
  if (!rows.length) {
    body.innerHTML = '<tr><td colspan="7" class="text-muted text-center py-4">Nenhum produto fiscal em operação não fiscal neste dia.</td></tr>';
    return;
  }
  body.innerHTML = rows.map((p) => `
    <tr class="ffd-prod-row" style="cursor:pointer" data-ffd-pid="${p.produto_id}">
      <td>${ffdEsc(p.nome)}</td>
      <td class="text-end">${p.quantidade_vendida}</td>
      <td class="text-end">${p.quantidade_fiscal}</td>
      <td class="text-end">${p.quantidade_nao_fiscal}</td>
      <td class="text-end fw-semibold">${p.quantidade_elegivel}</td>
      <td class="text-end">${ffdFmtMoney(p.valor_elegivel)}</td>
      <td>${p.quantidade_elegivel > 0
        ? '<span class="badge text-bg-success">Elegível</span>'
        : '<span class="badge text-bg-secondary">Não elegível</span>'}</td>
    </tr>`).join('');
  body.querySelectorAll('[data-ffd-pid]').forEach((tr) => {
    tr.addEventListener('click', () => {
      const pid = Number(tr.getAttribute('data-ffd-pid'));
      const prod = rows.find((x) => Number(x.produto_id) === pid);
      if (prod) ffdAbrirDetalheProduto(prod);
    });
  });
}

function ffdAbrirDetalheProduto(prod) {
  const linhas = (prod.vendas || []).map((v) =>
    `Venda #${v.venda_id}\n${v.quantidade_original} un\n${v.quantidade_fiscal} fiscal\n${v.quantidade_nao_fiscal} não fiscal\nElegível: ${v.quantidade_elegivel}`
  ).join('\n\n');
  const txt =
    `${prod.nome}\n\n` +
    `Total vendido: ${prod.quantidade_vendida}\n` +
    `Consumo fiscal: ${prod.quantidade_fiscal}\n` +
    `Consumo não fiscal: ${prod.quantidade_nao_fiscal}\n` +
    `Elegível: ${prod.quantidade_elegivel}\n\n` +
    (linhas || 'Sem vendas detalhadas.');
  ffdAlert(txt, prod.nome || 'Detalhe do produto');
}

function ffdRenderComplementacao(comp) {
  const el = document.getElementById('ffdComplementacaoPainel');
  if (!el) return;
  const c = comp || __ffdEstado.complementacao;
  if (!c) {
    el.innerHTML = '';
    return;
  }
  const restante = Number(c.deficit_restante || 0);
  const alerta = restante > 0.004
    ? `<div class="alert alert-warning py-2 px-3 mb-0 mt-2">Há déficit restante de ${ffdFmtMoney(restante)} sem produtos fiscais elegíveis suficientes. Nenhuma saída extra foi inventada.</div>`
    : '';
  const itens = (c.itens_complementacao || []).map((it) =>
    `<li>Produto #${ffdEsc(it.produto_id)}${it.nome ? ` — ${ffdEsc(it.nome)}` : ''} · ${ffdFmtMoney(it.valor)}</li>`
  ).join('');
  el.innerHTML = `
    <div class="border rounded-3 p-3 bg-light">
      <div class="fw-semibold mb-2">Complementação fiscal por recebimento</div>
      <div class="row g-2 small">
        <div class="col-md"><div class="text-muted">Recebimentos da maquineta</div><strong>${ffdFmtMoney(c.valor_recebido)}</strong></div>
        <div class="col-md"><div class="text-muted">Cobertura fiscal</div><strong>${ffdFmtMoney(c.cobertura_fiscal)}</strong></div>
        <div class="col-md"><div class="text-muted">Déficit</div><strong>${ffdFmtMoney(c.deficit)}</strong></div>
        <div class="col-md"><div class="text-muted">Complementação fiscal</div><strong>${ffdFmtMoney(c.valor_complementado)}</strong></div>
        <div class="col-md"><div class="text-muted">Déficit restante</div><strong>${ffdFmtMoney(c.deficit_restante)}</strong></div>
      </div>
      ${itens ? `<ul class="small mt-2 mb-0">${itens}</ul>` : '<div class="small text-muted mt-2">Nenhum item de complementação.</div>'}
      ${alerta}
    </div>`;
}

function ffdRenderConciliacaoRecebimentos() {
  const el = document.getElementById('ffdConciliacao');
  const informado = ffdTotalRecebimentos();
  const tot = document.getElementById('ffdTotalInformado');
  if (tot) tot.textContent = ffdFmtMoney(informado);
  if (!el) return;
  const referencia = ffdValorReferenciaConciliacao();
  const difRec = ffdDiferencaConciliacao();
  const temPrevia = Boolean(__ffdEstado.previa && (__ffdEstado.previa.valor_distribuido != null
    || (__ffdEstado.previa.vendas || []).length));
  const residualDia = Number(
    __ffdEstado.resumo?.valor_fiscal_elegivel
    ?? __ffdEstado.resumo?.valor_elegivel
    ?? 0
  );
  const conciliado = ffdRecebimentosConciliados();
  const rotuloRef = temPrevia ? 'Valor da composição' : 'Valor elegível';
  el.innerHTML = `
    <div class="row g-2 small">
      <div class="col-md-4">${rotuloRef}: <strong>${ffdFmtMoney(referencia)}</strong></div>
      <div class="col-md-4">Recebimentos: <strong>${ffdFmtMoney(informado)}</strong></div>
      <div class="col-md-4">Diferença: <strong>${ffdFmtMoney(difRec)}</strong></div>
    </div>
    ${temPrevia
      ? `<div class="small text-muted mt-1">Saldo residual do dia (monitoramento): ${ffdFmtMoney(residualDia)}.</div>`
      : ''}
    <div class="mt-2">${ffdFechamentoFinalizado()
      ? '<span class="text-success">● Conciliado</span><div class="small text-muted mt-1">Fechamento autorizado / concluído. Os recebimentos e a composição acima são o registro do fechamento já emitido.</div>'
      : (conciliado
        ? '<span class="text-success">● Conciliado</span><div class="small text-muted mt-1">Conciliação dos recebimentos com a composição do fechamento. Ainda é necessário atualizar a prévia e validar para emissão.</div>'
        : '<span class="text-warning">○ Pendente de conciliação</span><div class="small text-muted mt-1">O valor dos recebimentos deve ser igual ao valor da composição do fechamento.</div>')}</div>`;
}

function ffdLimparUiAposAutorizado() {
  if (!ffdFechamentoFinalizado()) {
    $('#ffdSecaoRecebimentos, #ffdSecaoComposicao').removeClass('d-none');
    $('#ffdBtnEmitir').closest('.d-flex').removeClass('d-none');
    $('#ffdBtnAddMaquina, #ffdBtnAtualizarPrevia, #ffdVistaVenda, #ffdVistaProduto').prop('disabled', false);
    $('#ffdValorAlvo, #ffdValorMin, #ffdValorMax, #ffdAuto').prop('disabled', false);
    return;
  }

  // Limpa formulário de trabalho — dados fiscais ficam no banco / NFC-e Emitidas.
  __ffdEstado.recebimentos = [];
  __ffdEstado.recebimentosLocais = false;
  __ffdEstado.previa = null;
  __ffdEstado.validacao = null;

  ffdRenderMaquinas();
  const prevEl = document.getElementById('ffdPreviaConteudo');
  if (prevEl) prevEl.innerHTML = '';
  const alertaPrev = document.getElementById('ffdAlertaPrevia');
  if (alertaPrev) alertaPrev.innerHTML = '';
  const conc = document.getElementById('ffdConciliacao');
  if (conc) conc.innerHTML = '';
  $('#ffdTotalInformado').text(ffdFmtMoney(0));
  $('#ffdPrevInformado, #ffdPrevDistribuido, #ffdPrevDiferenca, #ffdPrevQtdVendas, #ffdIndElegiveis, #ffdIndElegivel').text('—');

  $('#ffdSecaoRecebimentos, #ffdSecaoComposicao').addClass('d-none');
  $('#ffdBtnEmitir').closest('.d-flex').addClass('d-none');
  $('#ffdPainelEmissao, #ffdChecklist, #ffdErrosValidacao, #ffdTxProgresso').empty();
  $('#ffdBtnCorrigir').prop('disabled', true);

  const docs = __ffdEstado.documentos || [];
  const docsAuth = docs.filter((d) => String(d.status || '').toUpperCase() === 'AUTORIZADO');
  const ffId = __ffdEstado.fechamentoId;
  const rotulo = ffId ? `FF-${String(Number(ffId)).padStart(6, '0')}` : '—';
  const valorFechado = Number(
    __ffdEstado.valorFechado
    || (__ffdEstado._ultimoTxResumo && __ffdEstado._ultimoTxResumo.valor_total)
    || 0
  );

  $('#ffdValTotal').text(ffdFmtMoney(valorFechado));
  $('#ffdValDocs').text(String(docsAuth.length || docs.length || 1));
  $('#ffdValStatus').text('AUTORIZADO');
  const amb = Number(__ffdEstado.ambiente);
  $('#ffdValAmbiente').text(amb === 1 ? 'Produção' : (amb === 2 ? 'Homologação' : '—'));

  const res = document.getElementById('ffdTxResultado');
  if (res) {
    res.innerHTML = `<div class="alert alert-success mb-0">
      <div class="fw-semibold">✓ Fechamento ${ffdEsc(rotulo)} concluído${valorFechado ? ` · ${ffdFmtMoney(valorFechado)}` : ''}</div>
      <div class="small mt-2">Recebimentos e composição foram limpos automaticamente desta tela.</div>
      <div class="small text-muted">O documento fiscal permanece em Fiscal → NFC-e Emitidas.</div>
      <ul class="small mb-2 mt-2">${(docsAuth.length ? docsAuth : docs).map((d) =>
        `<li>NFC-e nº <strong>${ffdEsc(d.numero || d.numero_provisorio || '—')}</strong>
         · Série <strong>${ffdEsc(d.serie || '1')}</strong><br>
         Chave: ${ffdEsc(d.chave_acesso || '—')}<br>
         Protocolo: ${ffdEsc(d.protocolo || '—')}</li>`
      ).join('') || '<li>Documento autorizado.</li>'}</ul>
      <button type="button" class="btn btn-sm btn-outline-success" id="ffdBtnReabrirCupomLimpo">Abrir Cupom Fiscal</button>
    </div>`;
    const btn = document.getElementById('ffdBtnReabrirCupomLimpo');
    if (btn) {
      btn.addEventListener('click', () => ffdAbrirCupomAposAutorizacao({
        status: 'AUTORIZADO',
        documentos: docs
      }));
    }
  }

  const body = document.getElementById('ffdGridBody');
  if (body) {
    const rows = ((__ffdEstado.resumo && __ffdEstado.resumo.monitoramento) || [])
      .filter((p) => Number(p.quantidade_elegivel) > 0);
    if (!rows.length) {
      body.innerHTML = '<tr><td colspan="7" class="text-muted text-center py-4">Nenhuma pendência fiscal elegível neste dia.</td></tr>';
    } else {
      ffdRenderGridMonitoramento({ monitoramento: rows });
    }
  }
}

function ffdAplicarModoSomenteLeituraAutorizado() {
  const root = document.getElementById('ffdRoot');
  if (root) root.classList.toggle('ffd-autorizado', ffdFechamentoFinalizado());
  ffdLimparUiAposAutorizado();
}

function loadFechamentoFiscalDoDia() {
  ffdPararPolling();
  const hoje = ffdHojeISO();
  __ffdEstado = {
    fechamentoId: null,
    data: hoje,
    resumo: null,
    previa: null,
    indicadores: null,
    complementacao: null,
    recebimentos: [],
    recebimentosLocais: false,
    vendasElegiveis: [],
    vendasElegiveisCarregadas: false,
    vista: 'venda',
    validacao: null,
    documentos: [],
    statusFiscal: null,
    moduloOn: false,
    ambiente: null,
    transmissaoHabilitada: false,
    diagnosticoTx: null,
    transmitindo: false,
    modoRecebimento: 'por_maquina',
    filaEmissao: {
      status: 'IDLE',
      total: 0,
      indiceAtual: 0,
      vendaAtualId: null,
      countdownMs: null,
      resultados: [],
      resumo: null,
      mensagem: null
    },
    pollTimer: null,
    ultimaAtualizacao: null,
    montado: true,
    ops: { previa: false, validar: false, preparar: false, salvar: false, transmitir: false, emitir: false },
    usuarioEditando: false
  };

  $('#page-content').html(`
    <div class="container-fluid py-3" id="ffdRoot">
      <div class="d-flex flex-wrap justify-content-between align-items-start gap-2 mb-3">
        <div>
          <h2 class="h3 mb-1">Fechamento Fiscal do Dia</h2>
          <p class="text-muted mb-1">Monitoramento das vendas não fiscais de produtos fiscais</p>
          <div id="ffdMonitorBadge" class="small mb-1"></div>
          <div class="small"><span class="text-muted">Status:</span> <strong id="ffdStatusFluxo">MONITORANDO</strong></div>
        </div>
        <div class="text-end">
          <div class="fw-semibold" id="ffdDataRotulo">Hoje — ${ffdFmtDataBr(hoje)}</div>
          <div class="small text-muted" id="ffdUltimaAtualizacao">Última atualização: —</div>
          <div class="mt-2 d-flex gap-2 justify-content-end">
            <input type="date" class="form-control form-control-sm" id="ffdData" value="${hoje}" style="max-width:11rem">
            <button type="button" class="btn btn-sm btn-outline-primary" id="ffdBtnCarregarDia">Atualizar</button>
          </div>
        </div>
      </div>

      <div id="ffdModuloAlerta"></div>

      <div class="row g-3 mb-3">
        <div class="col-6 col-lg-3">
          <div class="border rounded-3 p-3 h-100 bg-white shadow-sm">
            <div class="text-muted text-uppercase small">Vendas com saldo fiscal</div>
            <div class="display-6 fs-2" id="ffdKpiVendasDia">—</div>
          </div>
        </div>
        <div class="col-6 col-lg-3">
          <div class="border rounded-3 p-3 h-100 bg-white shadow-sm">
            <div class="text-muted text-uppercase small">Não fiscal (saldo fiscal)</div>
            <div class="display-6 fs-2" id="ffdKpiValorNf">—</div>
            <div class="small text-muted"><span id="ffdKpiVendasNf">0</span> operações</div>
          </div>
        </div>
        <div class="col-6 col-lg-3">
          <div class="border rounded-3 p-3 h-100 bg-white shadow-sm">
            <div class="text-muted text-uppercase small">Unidades elegíveis</div>
            <div class="display-6 fs-2" id="ffdKpiUnidades">—</div>
            <div class="small text-muted"><span id="ffdKpiProdMonitor">0</span> produtos monitorados</div>
          </div>
        </div>
        <div class="col-6 col-lg-3">
          <div class="border rounded-3 p-3 h-100 bg-white shadow-sm">
            <div class="text-muted text-uppercase small">Valor elegível</div>
            <div class="display-6 fs-2" id="ffdKpiValorElegivel">—</div>
          </div>
        </div>
      </div>

      <div id="ffdAlertaInteligente" class="mb-3"></div>

      <div class="card border-0 shadow-sm mb-3" id="ffdModoRecebimentoCard">
        <div class="card-header bg-white"><strong>Modo de recebimento do Recebimento Fiscal do Dia</strong></div>
        <div class="card-body">
          <div class="d-flex flex-wrap gap-3">
            <label class="form-check w-100 w-md-auto border rounded p-3 flex-fill mb-0 border-primary bg-primary-subtle" for="ffdModoPorMaquina" style="cursor:pointer; min-width: 16rem;">
              <input class="form-check-input me-2" type="radio" name="ffdModoRecebimento" id="ffdModoPorMaquina" value="por_maquina" checked>
              <span class="form-check-label fw-semibold">Por máquina — Relatório Geral</span>
              <div class="small text-muted mt-1">Informe o total recebido por máquina/operadora.</div>
            </label>
            <label class="form-check w-100 w-md-auto border rounded p-3 flex-fill mb-0" for="ffdModoPorComprovante" style="cursor:pointer; min-width: 16rem;">
              <input class="form-check-input me-2" type="radio" name="ffdModoRecebimento" id="ffdModoPorComprovante" value="por_comprovante">
              <span class="form-check-label fw-semibold">Por comprovante — Informar comprovantes</span>
              <div class="small text-muted mt-1">Informe os valores recebidos no dia sem associar a uma venda.</div>
            </label>
          </div>
        </div>
      </div>

      <div class="card border-0 shadow-sm mb-3 d-none" id="ffdSecaoModoVenda">
        <div class="card-header bg-white"><strong>Vendas elegíveis do dia</strong></div>
        <div class="card-body p-0">
          <div class="table-responsive">
            <table class="table table-sm align-middle mb-0">
              <thead class="table-light"><tr><th>Venda</th><th>Data/Hora</th><th class="text-end">Valor da venda</th><th class="text-end">Valor do comprovante</th><th class="text-end">Diferença</th></tr></thead>
              <tbody id="ffdStatusVendasElegiveis"><tr><td colspan="5" class="text-muted p-3">Selecione Por venda para carregar vendas elegíveis.</td></tr></tbody>
            </table>
          </div>
          <div class="row g-3 p-3 border-top" id="ffdResumoComprovantes">
            <div class="col-md-4"><div class="small text-muted">Total das vendas</div><strong id="ffdTotalVendasPorVenda">—</strong></div>
            <div class="col-md-4"><div class="small text-muted">Total dos comprovantes informados</div><strong id="ffdTotalComprovantes">—</strong></div>
            <div class="col-md-4"><div class="small text-muted">Diferença total</div><strong id="ffdDiferencaComprovantes">—</strong></div>
          </div>
          <div class="px-3 pb-3">
            <button type="button" class="btn btn-primary" id="ffdBtnIniciarEmissaoSequencial" disabled>Iniciar emissão</button>
            <div class="mt-3 d-none" id="ffdPainelFilaEmissao" aria-live="polite">
              <div class="fw-semibold" id="ffdFilaTitulo"></div>
              <div class="small mt-1" id="ffdFilaStatus"></div>
              <div class="fw-semibold text-primary mt-2" id="ffdFilaCountdown"></div>
              <div class="small mt-2" id="ffdFilaResumo"></div>
              <div class="table-responsive mt-2">
                <table class="table table-sm align-middle mb-0">
                  <thead class="table-light"><tr><th>Venda</th><th>Status</th><th>Resultado</th><th>Protocolo / Chave</th></tr></thead>
                  <tbody id="ffdFilaResultados"></tbody>
                </table>
              </div>
            </div>
          </div>
          <div class="d-flex flex-wrap align-items-center gap-2 px-3 pb-3">
            <button type="button" class="btn btn-outline-primary btn-sm" id="ffdBtnSalvarComprovantes" disabled>Salvar comprovantes</button>
            <span class="small text-muted" id="ffdSalvarComprovantesStatus" role="status"></span>
          </div>
        </div>
      </div>

      <div class="card border-0 shadow-sm mb-3">
        <div class="card-header bg-white"><strong>Produtos monitorados</strong></div>
        <div class="card-body p-0">
          <div class="table-responsive">
            <table class="table table-hover mb-0 align-middle">
              <thead class="table-light">
                <tr>
                  <th>Produto</th>
                  <th class="text-end">Vendido</th>
                  <th class="text-end">Fiscal</th>
                  <th class="text-end">Não fiscal</th>
                  <th class="text-end">Elegível</th>
                  <th class="text-end">Valor elegível</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody id="ffdGridBody">
                <tr><td colspan="7" class="text-muted text-center py-3">Carregando…</td></tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div class="card border-0 shadow-sm mb-3" id="ffdSecaoRecebimentos">
        <div class="card-header bg-white d-flex justify-content-between align-items-center" id="ffdCabecalhoRecebimentosMaquina">
          <strong>Recebimentos informados</strong>
          <button type="button" class="btn btn-sm btn-outline-success" id="ffdBtnAddMaquina">+ Adicionar máquina</button>
        </div>
        <div class="card-body">
          <div id="ffdPainelRecebimentosMaquina">
          <div class="table-responsive">
            <table class="table table-sm align-middle">
              <thead><tr><th>Máquina / Operadora</th><th>CNPJ</th><th class="text-end">Valor</th><th></th></tr></thead>
              <tbody id="ffdMaquinasBody"><tr><td colspan="4" class="text-muted">Nenhuma máquina informada.</td></tr></tbody>
            </table>
          </div>
          <div class="text-end fw-semibold mb-3">TOTAL INFORMADO <span id="ffdTotalInformado">${ffdFmtMoney(0)}</span></div>
          </div>
          <div id="ffdConciliacao"></div>
          <div id="ffdComplementacaoPainel" class="mt-3"></div>
        </div>
      </div>

      <div class="card border-0 shadow-sm mb-3" id="ffdSecaoComposicao">
        <div class="card-header bg-white"><strong>Composição fiscal sugerida</strong></div>
        <div class="card-body">
          <div class="row g-3 mb-3">
            <div class="col-md-3">
              <label class="form-label" for="ffdValorAlvo">Valor alvo por venda</label>
              <input type="number" step="0.01" min="0" class="form-control" id="ffdValorAlvo" value="250.00">
              <div class="form-text">Sugestão. O sistema pode variar para fechar o total.</div>
            </div>
            <div class="col-md-3">
              <label class="form-label" for="ffdValorMin">Valor mínimo sugerido</label>
              <input type="number" step="0.01" min="0" class="form-control" id="ffdValorMin" value="8.00">
              <div class="form-text">Sugestão mínima por NFC-e (padrão homologação realista).</div>
            </div>
            <div class="col-md-3">
              <label class="form-label" for="ffdValorMax">Valor máximo sugerido</label>
              <input type="number" step="0.01" min="0" class="form-control" id="ffdValorMax" value="500.00">
              <div class="form-text">Teto por NFC-e na prévia de homologação.</div>            </div>
            <div class="col-md-3 d-flex align-items-end">
              <div class="form-check form-switch">
                <input class="form-check-input" type="checkbox" id="ffdAuto" checked>
                <label class="form-check-label" for="ffdAuto">Distribuição automática</label>
              </div>
            </div>
          </div>
          <div class="d-flex flex-wrap justify-content-between align-items-center gap-2 mb-2">
            <div class="btn-group btn-group-sm" role="group">
              <button type="button" class="btn btn-outline-secondary active" id="ffdVistaVenda">Por venda</button>
              <button type="button" class="btn btn-outline-secondary" id="ffdVistaProduto">Por produto</button>
            </div>
            <div class="d-flex gap-2">
              <button type="button" class="btn btn-outline-danger btn-sm" id="ffdBtnLimparTudo">Limpar tudo do dia</button>
              <button type="button" class="btn btn-outline-primary btn-sm" id="ffdBtnAtualizarPrevia">Atualizar Prévia</button>
            </div>
          </div>
          <div id="ffdAlertaPrevia" class="mb-3"></div>
          <div class="row g-3 mb-3" id="ffdIndicadores">
            <div class="col"><div class="text-muted small">Produtos elegíveis</div><div id="ffdIndElegiveis">—</div></div>
            <div class="col"><div class="text-muted small">Valor elegível</div><div id="ffdIndElegivel">—</div></div>
            <div class="col"><div class="text-muted small">Valor informado</div><div id="ffdPrevInformado">—</div></div>
            <div class="col"><div class="text-muted small">Valor distribuído</div><div id="ffdPrevDistribuido">—</div></div>
            <div class="col"><div class="text-muted small">Diferença</div><div id="ffdPrevDiferenca">—</div></div>
            <div class="col"><div class="text-muted small">Qtd. vendas</div><div id="ffdPrevQtdVendas">—</div></div>
          </div>
          <div id="ffdPreviaConteudo" class="text-muted">Atualize a prévia para visualizar a composição.</div>
        </div>
      </div>

      <div class="card border-0 shadow-sm mb-3" id="ffdSecaoEmissao">
        <div class="card-header bg-white"><strong>Validação e emissão</strong></div>
        <div class="card-body">
          <div class="row g-3 mb-3">
            <div class="col-md-3"><div class="text-muted small">Valor total</div><div class="fs-5" id="ffdValTotal">—</div></div>
            <div class="col-md-3"><div class="text-muted small">Documentos</div><div class="fs-5" id="ffdValDocs">—</div></div>
            <div class="col-md-3"><div class="text-muted small">Status</div><div class="fs-5" id="ffdValStatus">—</div></div>
            <div class="col-md-3"><div class="text-muted small">Ambiente</div><div class="fs-5" id="ffdValAmbiente">—</div></div>
            <div class="col-12 mt-2">
              <div class="row g-2" id="ffdSaldoBox" style="display:none">
                <div class="col-md-4"><div class="border rounded p-2 bg-light"><div class="text-muted small">VALOR PRINCIPAL</div><div class="fs-5 fw-semibold" id="ffdSaldoPrincipal">—</div></div></div>
                <div class="col-md-4"><div class="border rounded p-2 bg-light"><div class="text-muted small">JÁ EMITIDO</div><div class="fs-5 fw-semibold text-success" id="ffdSaldoEmitido">—</div></div></div>
                <div class="col-md-4"><div class="border rounded p-2 bg-light"><div class="text-muted small">RESTANTE</div><div class="fs-5 fw-semibold text-primary" id="ffdSaldoPendente">—</div></div></div>
              </div>
              <div class="mt-2 d-flex flex-wrap gap-2 align-items-center">
                <button type="button" class="btn btn-primary btn-lg" id="ffdBtnContinuarEmissao" style="display:none">Continuar emissão</button>
                <div class="small text-muted" id="ffdSaldoMsgs"></div>
              </div>
            </div>
          </div>
          <div id="ffdPainelEmissao" class="mb-3"></div>
          <div id="ffdChecklist" class="mb-3"></div>
          <div id="ffdErrosValidacao"></div>
          <div class="d-flex flex-wrap gap-2 align-items-center mb-2">
            <button type="button" class="btn btn-success btn-lg" id="ffdBtnEmitir" disabled>Emitir fechamento</button>
            <span class="text-muted small" id="ffdEmitirHint"></span>
          </div>
          <div id="ffdTxProgresso" class="mt-3"></div>
          <div id="ffdTxResultado" class="mt-3"></div>
          <details class="mt-3" id="ffdDetalhesTecnicos">
            <summary class="small text-muted" style="cursor:pointer">Detalhes técnicos (suporte)</summary>
            <div class="pt-3">
              <div id="ffdChecklistTecnico" class="mb-2 small text-muted"></div>
              <div id="ffdXmlPreview" class="d-none mb-2">
                <label class="form-label small">XML preparado (validação)</label>
                <textarea class="form-control form-control-sm font-monospace" id="ffdXmlText" rows="8" readonly></textarea>
              </div>
              <div class="d-flex flex-wrap gap-2">
                <button type="button" class="btn btn-outline-secondary btn-sm" id="ffdBtnSalvarRascunho">Salvar Rascunho</button>
                <button type="button" class="btn btn-outline-dark btn-sm" id="ffdBtnValidar" disabled>Validar fiscal</button>
                <button type="button" class="btn btn-outline-secondary btn-sm" id="ffdBtnGerarXml" disabled>Gerar XML</button>
                <button type="button" class="btn btn-outline-secondary btn-sm" id="ffdBtnVerXml" disabled>Visualizar XML</button>
                <button type="button" class="btn btn-outline-success btn-sm" id="ffdBtnPreparar" disabled>Preparar para emissão</button>
                <button type="button" class="btn btn-outline-info btn-sm" id="ffdBtnRecuperar" disabled>Recuperar SEFAZ</button>
                <button type="button" class="btn btn-outline-dark btn-sm" id="ffdBtnTransmitir" disabled title="Transmitir após PRONTO_EMISSAO com configuração fiscal válida">Transmitir para SEFAZ</button>
              </div>
              <div class="text-muted small mt-2">Etapas técnicas preservadas para suporte. A transmissão usa o Motor Fiscal oficial (PRODUÇÃO ou HOMOLOGAÇÃO conforme configuração).</div>
            </div>
          </details>
        </div>
      </div>

      <div class="d-flex flex-wrap gap-2 justify-content-between">
        <div class="d-flex flex-wrap gap-2">
          <button type="button" class="btn btn-outline-secondary" id="ffdBtnCancelar">Voltar / Cancelar</button>
          <button type="button" class="btn btn-outline-warning" id="ffdBtnCorrigir" disabled>Corrigir pendências</button>
        </div>
      </div>
    </div>
  `);

  $('#ffdBtnCarregarDia').on('click', () => ffdCarregarDia());
  $('#ffdData').on('change', () => ffdCarregarDia());
  $('#ffdBtnAddMaquina').on('click', () => ffdAdicionarMaquinaUi());
  $('#ffdBtnAtualizarPrevia').on('click', () => {
    ffdPreviaClickAt = performance.now();
    ffdLogDesenvolvimento('PREVIA CLICK', { timestamp: Date.now() });
    ffdAtualizarPrevia();
  });
  $('#ffdBtnLimparTudo').on('click', () => ffdLimparTudoDoDia());
  $('#ffdBtnSalvarRascunho').on('click', () => ffdSalvarRascunho());
  $('#ffdBtnCancelar').on('click', () => ffdCancelar());
  $('#ffdBtnEmitir').on('click', () => ffdEmitirFechamento());
  $('input[name="ffdModoRecebimento"]').on('change', function () {
    __ffdEstado.modoRecebimento = String(this.value || 'por_maquina');
    ffdAtualizarModoRecebimentoUi();
  });
  $('#ffdBtnSalvarComprovantes').on('click', () => ffdSalvarComprovantes());
  $('#ffdBtnIniciarEmissaoSequencial').on('click', () => ffdIniciarFilaEmissao());
  $('#ffdBtnValidar').on('click', () => ffdValidarFiscal());
  $('#ffdBtnGerarXml').on('click', () => ffdPrepararEmissao(true));
  $('#ffdBtnPreparar').on('click', () => ffdPrepararEmissao(true));
  $('#ffdBtnVerXml').on('click', () => ffdToggleXml());
  $('#ffdBtnCorrigir').on('click', () => ffdCorrigirPendencias());
  $('#ffdBtnTransmitir').on('click', () => ffdTransmitirSefaz());
  $('#ffdBtnRecuperar').on('click', () => ffdRecuperarSefaz());
  $('#ffdBtnContinuarEmissao').on('click', () => ffdContinuarEmissao());
  $('#ffdVistaVenda').on('click', () => { __ffdEstado.vista = 'venda'; ffdAtualizarVistaBtns(); ffdRenderPrevia(__ffdEstado.previa); });
  $('#ffdVistaProduto').on('click', () => { __ffdEstado.vista = 'produto'; ffdAtualizarVistaBtns(); ffdRenderPrevia(__ffdEstado.previa); });
  $('#ffdValorAlvo, #ffdValorMin, #ffdValorMax').on('focus', () => { __ffdEstado.usuarioEditando = true; });
  $('#ffdValorAlvo, #ffdValorMin, #ffdValorMax').on('blur', () => { __ffdEstado.usuarioEditando = false; });

  $(document).off('cds:page-change.ffd').on('cds:page-change.ffd', () => ffdPararPolling());

  ffdVerificarModulo().then(() => {
    ffdCarregarDia();
    ffdIniciarPolling();
  });
}

function ffdAtualizarModoRecebimentoUi() {
  const porMaquina = __ffdEstado.modoRecebimento === 'por_maquina';
  const porComprovante = __ffdEstado.modoRecebimento === 'por_comprovante';
  const porVenda = __ffdEstado.modoRecebimento === 'por_venda';
  $('#ffdModoPorMaquina').prop('checked', porMaquina);
  $('#ffdModoPorComprovante').prop('checked', porComprovante);
  $('#ffdModoPorVenda').prop('checked', porVenda);
  $('label[for="ffdModoPorMaquina"], label[for="ffdModoPorComprovante"], label[for="ffdModoPorVenda"]').removeClass('border-primary bg-primary-subtle');
  const ativo = porMaquina ? $('label[for="ffdModoPorMaquina"]') : (porComprovante ? $('label[for="ffdModoPorComprovante"]') : $('label[for="ffdModoPorVenda"]'));
  if (ativo && ativo.length) ativo.addClass('border-primary bg-primary-subtle');

  const vendaBox = document.getElementById('ffdSecaoModoVenda');
  const maquinas = document.getElementById('ffdPainelRecebimentosMaquina');
  const cabecalhoMaquinas = document.getElementById('ffdCabecalhoRecebimentosMaquina');
  const complementacaoMaquinas = document.getElementById('ffdComplementacaoPainel');
  const emitirFechamento = document.getElementById('ffdBtnEmitir');
  const continuarEmissao = document.getElementById('ffdBtnContinuarEmissao');
  const detalhesTecnicos = document.getElementById('ffdDetalhesTecnicos');
  const acaoEmissao = emitirFechamento && emitirFechamento.closest('.d-flex');
  if (vendaBox) vendaBox.classList.toggle('d-none', !porVenda);
  if (maquinas) maquinas.classList.toggle('d-none', porVenda);
  if (cabecalhoMaquinas) cabecalhoMaquinas.classList.toggle('d-none', porVenda);
  if (complementacaoMaquinas) complementacaoMaquinas.classList.toggle('d-none', porVenda);
  if (acaoEmissao) acaoEmissao.classList.toggle('d-none', porVenda);
  if (continuarEmissao) continuarEmissao.classList.toggle('d-none', porVenda);
  if (detalhesTecnicos) detalhesTecnicos.classList.toggle('d-none', porVenda);
  if (porVenda) ffdCarregarVendasElegiveis();
  if (porComprovante) ffdCarregarComprovantes();
  ffdRenderConciliacaoRecebimentos();
  ffdAtualizarBotaoFilaEmissao();
  ffdRenderFilaEmissao();
}

function ffdParseValorCentavos(valor) {
  const texto = String(valor == null ? '' : valor).trim();
  if (!texto) return null;

  const formatoBrasileiro = /^(?:\d+|\d{1,3}(?:\.\d{3})+)(?:,\d{1,2})?$/;
  const formatoDecimalPonto = /^\d+\.\d{1,2}$/;
  let normalizado = texto;
  if (texto.includes(',')) {
    if (!formatoBrasileiro.test(texto)) return undefined;
    normalizado = texto.replace(/\./g, '').replace(',', '.');
  } else if (formatoBrasileiro.test(texto) && /^\d{1,3}(?:\.\d{3})+$/.test(texto)) {
    normalizado = texto.replace(/\./g, '');
  } else if (!/^\d+$/.test(texto) && !formatoDecimalPonto.test(texto)) {
    return undefined;
  }

  const [inteiro, fracao = ''] = normalizado.split('.');
  const reais = Number(inteiro);
  if (!Number.isSafeInteger(reais)) return undefined;
  const centavos = reais * 100 + Number((fracao + '00').slice(0, 2));
  return Number.isSafeInteger(centavos) ? centavos : undefined;
}

function ffdFormatarCentavos(centavos) {
  return (Number(centavos || 0) / 100).toLocaleString('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

function somarComprovantes(comprovantes = []) {
  return (Array.isArray(comprovantes) ? comprovantes : []).reduce((soma, item) => {
    const valor = item && typeof item === 'object' && item.valor != null ? item.valor : item;
    const centavos = ffdParseValorCentavos(String(valor ?? ''));
    if (centavos == null || centavos === undefined) return soma;
    return soma + centavos;
  }, 0) / 100;
}

function ffdAdicionarLinhaComprovante(valor = '') {
  const lista = Array.isArray(__ffdEstado.comprovantes) ? __ffdEstado.comprovantes : [];
  const item = { id: null, valor: valor, ordem: Date.now() + Math.random() };
  __ffdEstado.comprovantes = [...lista, item];
  ffdRenderComprovantes();
}

function ffdRemoverLinhaComprovante(id) {
  if (!Array.isArray(__ffdEstado.comprovantes)) return;
  __ffdEstado.comprovantes = __ffdEstado.comprovantes.filter((item) => item.ordem !== id && item.id !== id);
  ffdRenderComprovantes();
}

function ffdRenderComprovantes() {
  const body = document.getElementById('ffdComprovantesBody');
  const total = document.getElementById('ffdTotalComprovantesInformados');
  if (!body || !total) return;

  const lista = Array.isArray(__ffdEstado.comprovantes) && __ffdEstado.comprovantes.length
    ? __ffdEstado.comprovantes
    : [{ id: null, valor: '', ordem: Date.now() + Math.random() }];

  body.innerHTML = lista.map((item, idx) => {
    const id = item.id != null ? item.id : item.ordem ?? idx;
    const valor = String(item.valor ?? '');
    const centavos = ffdParseValorCentavos(valor);
    const invalido = centavos === undefined;
    const btnId = `ffdBtnRemoverComprovante-${ffdEsc(String(id))}`;
    return `
      <div class="d-flex align-items-center gap-2">
        <div class="flex-grow-1">
          <input type="text" inputmode="decimal" autocomplete="off" class="form-control form-control-sm ${invalido ? 'is-invalid' : ''}" value="${ffdEsc(valor)}" data-ffd-comprovante-id="${ffdEsc(String(id))}" placeholder="R$ 0,00" aria-label="Comprovante ${idx + 1}">
        </div>
        <button type="button" id="${btnId}" class="btn btn-sm btn-outline-danger" data-ffd-remover-comprovante="${ffdEsc(String(id))}" aria-label="Remover comprovante">×</button>
      </div>`;
  }).join('');

  body.querySelectorAll('[data-ffd-comprovante-id]').forEach((input) => {
    input.addEventListener('input', () => {
      const key = input.getAttribute('data-ffd-comprovante-id');
      const listaAtual = Array.isArray(__ffdEstado.comprovantes) ? __ffdEstado.comprovantes : [];
      const atual = listaAtual.find((item) => String(item.id ?? item.ordem) === String(key));
      if (!atual) return;
      atual.valor = input.value;
      const totalAtual = somarComprovantes(listaAtual);
      total.textContent = ffdFmtMoney(totalAtual);
    });
  });

  body.querySelectorAll('[data-ffd-remover-comprovante]').forEach((button) => {
    button.addEventListener('click', () => {
      const id = button.getAttribute('data-ffd-remover-comprovante');
      ffdRemoverLinhaComprovante(id);
    });
  });

  total.textContent = ffdFmtMoney(somarComprovantes(lista));
}

async function ffdSalvarComprovantesPorFechamento() {
  const fechamentoId = Number(__ffdEstado.fechamentoId || 0);
  if (!fechamentoId) return false;
  const lista = (__ffdEstado.recebimentos || []).map((item) => ({
    operadora: String(item?.operadora || '').trim(),
    cnpj: String(item?.cnpj || '').trim(),
    valor: Number(item?.valor ?? 0)
  })).filter((item) => item.operadora && Number(item.valor) > 0);
  try {
    const resp = await fetch(`${ffdApi()}/fiscal/fechamentos/${fechamentoId}/recebimentos`, {
      method: 'PUT',
      headers: ffdHeaders(),
      body: JSON.stringify({ recebimentos: lista })
    });
    const resultado = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(resultado.error || `HTTP ${resp.status}`);
    __ffdEstado.recebimentos = (resultado.recebimentos || []).map((item) => ({
      id: item.id,
      operadora: item.operadora,
      cnpj: item.cnpj || '',
      valor: Number(item.valor || 0)
    }));
    ffdRenderMaquinas();
    return true;
  } catch (err) {
    ffdNotify(err.message || 'Falha ao salvar recebimentos.', 'danger');
    return false;
  }
}

async function ffdCarregarComprovantes() {
  const fechamentoId = Number(__ffdEstado.fechamentoId || 0);
  if (!fechamentoId || __ffdEstado.modoRecebimento !== 'por_comprovante') return;
  try {
    const resp = await fetch(`${ffdApi()}/fiscal/fechamentos/${fechamentoId}/recebimentos`, { headers: ffdHeaders() });
    const resultado = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(resultado.error || `HTTP ${resp.status}`);
    __ffdEstado.recebimentos = (resultado.recebimentos || []).map((item) => ({
      id: item.id,
      operadora: item.operadora,
      cnpj: item.cnpj || '',
      valor: Number(item.valor || 0)
    }));
    ffdRenderMaquinas();
  } catch (err) {
    __ffdEstado.recebimentos = [];
    ffdRenderMaquinas();
  }
}

function ffdAtualizarResumoComprovantes() {
  const body = document.getElementById('ffdStatusVendasElegiveis');
  if (!body) return;
  const inputs = [...body.querySelectorAll('[data-ffd-venda-id]')];
  let totalVendasCentavos = 0;
  let totalComprovantesCentavos = 0;
  let totalVendasComComprovanteCentavos = 0;
  let comprovantesInformados = 0;
  let possuiInvalido = false;
  let possuiAlteracao = false;

  for (const input of inputs) {
    const valorVendaCentavos = Number(input.dataset.ffdValorVendaCentavos || 0);
    const valorComprovanteCentavos = ffdParseValorCentavos(input.value);
    const valorPersistido = input.dataset.ffdPersistido || '';
    totalVendasCentavos += valorVendaCentavos;

    if (valorComprovanteCentavos === undefined) {
      possuiInvalido = true;
    } else if (valorComprovanteCentavos === null) {
      if (valorPersistido !== '') possuiAlteracao = true;
    } else {
      totalComprovantesCentavos += valorComprovanteCentavos;
      totalVendasComComprovanteCentavos += valorVendaCentavos;
      comprovantesInformados += 1;
      if (String(valorComprovanteCentavos) !== valorPersistido) possuiAlteracao = true;
    }
  }

  const valoresPorVenda = new Map(inputs.map((input) => [
    Number(input.dataset.ffdVendaId),
    ffdParseValorCentavos(input.value)
  ]));
  __ffdEstado.vendasElegiveis = (__ffdEstado.vendasElegiveis || []).map((venda) => {
    const centavos = valoresPorVenda.get(Number(venda.venda_id));
    return centavos == null || centavos === undefined
      ? { ...venda, valor_comprovante: null }
      : { ...venda, valor_comprovante: centavos / 100 };
  });

  const totalVendas = document.getElementById('ffdTotalVendasPorVenda');
  const totalComprovantes = document.getElementById('ffdTotalComprovantes');
  const diferencaTotal = document.getElementById('ffdDiferencaComprovantes');
  if (totalVendas) totalVendas.textContent = ffdFmtMoney(totalVendasCentavos / 100);
  if (totalComprovantes) {
    totalComprovantes.textContent = comprovantesInformados
      ? ffdFmtMoney(totalComprovantesCentavos / 100)
      : '—';
  }
  if (diferencaTotal) {
    diferencaTotal.textContent = comprovantesInformados
      ? ffdFmtMoney((totalComprovantesCentavos - totalVendasComComprovanteCentavos) / 100)
      : '—';
  }

  const salvar = document.getElementById('ffdBtnSalvarComprovantes');
  if (salvar) salvar.disabled = !__ffdEstado.fechamentoId || !possuiAlteracao || possuiInvalido;
  const status = document.getElementById('ffdSalvarComprovantesStatus');
  if (status && !__ffdEstado.fechamentoId) status.textContent = 'Abra um fechamento para salvar os comprovantes.';
  ffdRenderConciliacaoRecebimentos();
  ffdAtualizarBotaoFilaEmissao();
}

function ffdComprovantesPorVendaValidos() {
  if (!__ffdEstado.vendasElegiveisCarregadas) return false;
  const body = document.getElementById('ffdStatusVendasElegiveis');
  if (!body) return false;
  const ids = new Set();
  for (const input of body.querySelectorAll('[data-ffd-venda-id]')) {
    const id = Number(input.dataset.ffdVendaId);
    if (!Number.isInteger(id) || id <= 0 || ids.has(id)) return false;
    ids.add(id);
    if (ffdParseValorCentavos(input.value) === undefined) return false;
  }
  return true;
}

function ffdAtualizarLinhaComprovante(input) {
  const linha = input.closest('tr');
  if (!linha) return;
  const diferenca = linha.querySelector('[data-ffd-diferenca]');
  const valorComprovanteCentavos = ffdParseValorCentavos(input.value);
  const valorVendaCentavos = Number(input.dataset.ffdValorVendaCentavos || 0);

  input.classList.toggle('is-invalid', valorComprovanteCentavos === undefined);
  input.setAttribute('aria-invalid', valorComprovanteCentavos === undefined ? 'true' : 'false');
  if (diferenca) {
    diferenca.textContent = valorComprovanteCentavos == null
      ? '—'
      : ffdFmtMoney((valorComprovanteCentavos - valorVendaCentavos) / 100);
    diferenca.classList.toggle('text-danger', valorComprovanteCentavos != null && valorComprovanteCentavos < valorVendaCentavos);
    diferenca.classList.toggle('text-success', valorComprovanteCentavos != null && valorComprovanteCentavos > valorVendaCentavos);
  }
  ffdAtualizarResumoComprovantes();
}

function ffdVincularEntradasComprovantes() {
  const body = document.getElementById('ffdStatusVendasElegiveis');
  if (!body || body.dataset.ffdComprovantesBound === '1') return;
  body.dataset.ffdComprovantesBound = '1';
  body.addEventListener('input', (event) => {
    const input = event.target.closest('[data-ffd-venda-id]');
    if (input) ffdAtualizarLinhaComprovante(input);
  });
  body.addEventListener('blur', (event) => {
    const input = event.target.closest('[data-ffd-venda-id]');
    if (!input) return;
    const centavos = ffdParseValorCentavos(input.value);
    if (centavos != null) input.value = ffdFormatarCentavos(centavos);
    ffdAtualizarLinhaComprovante(input);
  }, true);
}

function ffdRenderVendasElegiveis(vendas) {
  const body = document.getElementById('ffdStatusVendasElegiveis');
  if (!body) return;
  ffdVincularEntradasComprovantes();
  const lista = Array.isArray(vendas) ? vendas : [];
  __ffdEstado.vendasElegiveis = lista.map((venda) => ({ ...venda }));
  __ffdEstado.vendasElegiveisCarregadas = true;
  if (!lista.length) {
    body.innerHTML = '<tr><td colspan="5" class="text-muted p-3">Nenhuma venda elegível encontrada.</td></tr>';
    ffdAtualizarResumoComprovantes();
    ffdAtualizarBotaoFilaEmissao();
    return;
  }
  body.innerHTML = lista.map((venda) => {
    const identificador = venda.codigo || venda.venda_id;
    const dataHora = String(venda.data_hora || '').replace('T', ' ').slice(0, 16);
    const valorVendaCentavos = Math.round((Number(venda.valor_venda || 0) + Number.EPSILON) * 100);
    const valorPersistidoCentavos = venda.valor_comprovante == null
      ? ''
      : String(Math.round((Number(venda.valor_comprovante) + Number.EPSILON) * 100));
    const valorInicial = valorPersistidoCentavos === '' ? '' : ffdFormatarCentavos(Number(valorPersistidoCentavos));
    const diferencaInicial = valorPersistidoCentavos === ''
      ? '—'
      : ffdFmtMoney((Number(valorPersistidoCentavos) - valorVendaCentavos) / 100);
    return `<tr>
      <td>#${ffdEsc(identificador)}</td>
      <td>${ffdEsc(dataHora)}</td>
      <td class="text-end">${ffdFmtMoney(valorVendaCentavos / 100)}</td>
      <td><input type="text" inputmode="decimal" autocomplete="off" class="form-control form-control-sm text-end" aria-label="Valor do comprovante da venda #${ffdEsc(identificador)}" value="${ffdEsc(valorInicial)}" data-ffd-venda-id="${Number(venda.venda_id)}" data-ffd-valor-venda-centavos="${valorVendaCentavos}" data-ffd-persistido="${valorPersistidoCentavos}"></td>
      <td class="text-end" data-ffd-diferenca>${diferencaInicial}</td>
    </tr>`;
  }).join('');
  ffdAtualizarResumoComprovantes();
  ffdAtualizarBotaoFilaEmissao();
}

async function ffdSalvarComprovantes(opcoes = {}) {
  const silencioso = Boolean(opcoes.silencioso);
  const body = document.getElementById('ffdStatusVendasElegiveis');
  const status = document.getElementById('ffdSalvarComprovantesStatus');
  const fechamentoId = Number(__ffdEstado.fechamentoId || 0);
  if (!body || !fechamentoId) return false;

  const recebimentos = [];
  for (const input of body.querySelectorAll('[data-ffd-venda-id]')) {
    const valorCentavos = ffdParseValorCentavos(input.value);
    if (valorCentavos === undefined) {
      input.focus();
      if (status && !silencioso) status.textContent = 'Revise os valores inválidos antes de salvar.';
      return false;
    }
    const persistido = input.dataset.ffdPersistido || '';
    if (valorCentavos === null) {
      if (persistido !== '') {
        recebimentos.push({ venda_id: Number(input.dataset.ffdVendaId), valor_comprovante: null });
      }
    } else if (String(valorCentavos) !== persistido) {
      recebimentos.push({
        venda_id: Number(input.dataset.ffdVendaId),
        valor_comprovante: valorCentavos / 100
      });
    }
  }

  if (!recebimentos.length) {
    if (status && !silencioso) status.textContent = 'Nenhuma alteração para salvar.';
    return true;
  }

  const botao = document.getElementById('ffdBtnSalvarComprovantes');
  if (botao) botao.disabled = true;
  if (status && !silencioso) status.textContent = 'Salvando comprovantes...';
  try {
    const resp = await fetch(`${ffdApi()}/fiscal/fechamentos/${fechamentoId}/recebimentos-vendas`, {
      method: 'PUT',
      headers: ffdHeaders(),
      body: JSON.stringify({ recebimentos })
    });
    const resultado = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(resultado.error || `HTTP ${resp.status}`);
    ffdRenderVendasElegiveis(resultado.vendas);
    if (status && !silencioso) status.textContent = 'Comprovantes salvos.';
    return true;
  } catch (err) {
    if (status && !silencioso) status.textContent = err.message || 'Falha ao salvar comprovantes.';
    return false;
  } finally {
    ffdAtualizarResumoComprovantes();
  }
}

async function ffdCarregarVendasElegiveis() {
  const body = document.getElementById('ffdStatusVendasElegiveis');
  if (!body || __ffdEstado.modoRecebimento !== 'por_venda') return;
  const data = String($('#ffdData').val() || __ffdEstado.data || '');
  const fechamentoId = Number(__ffdEstado.fechamentoId || 0);
  __ffdEstado.vendasElegiveisCarregadas = false;
  __ffdEstado.vendasElegiveis = [];
  ffdRenderConciliacaoRecebimentos();
  body.innerHTML = '<tr><td colspan="5" class="text-muted p-3">Carregando vendas elegíveis...</td></tr>';
  try {
    const url = `${ffdApi()}/fiscal/fechamentos/${fechamentoId}/recebimentos-vendas?data=${encodeURIComponent(data)}`;
    const resp = await fetch(url, { headers: ffdHeaders() });
    const resultado = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(resultado.error || `HTTP ${resp.status}`);
    if (__ffdEstado.modoRecebimento !== 'por_venda' || String($('#ffdData').val() || __ffdEstado.data || '') !== data) return;
    ffdRenderVendasElegiveis(resultado.vendas);
  } catch (err) {
    if (__ffdEstado.modoRecebimento === 'por_venda' && String($('#ffdData').val() || __ffdEstado.data || '') === data) {
      body.innerHTML = `<tr><td colspan="5" class="text-danger p-3">${ffdEsc(err.message || 'Falha ao carregar vendas elegíveis.')}</td></tr>`;
      ffdRenderConciliacaoRecebimentos();
    }
  }
}

function ffdEscolherIntervaloEmissaoMs(aleatorio = Math.random) {
  const sorteio = Math.max(0, Math.min(0.999999999, Number(aleatorio()) || 0));
  return 60000 + Math.floor(sorteio * 240001);
}

function ffdAguardarCountdown(intervaloMs, aoAtualizar, temporizadores = {}) {
  return new Promise((resolve) => {
    const agora = temporizadores.now || Date.now;
    const criarIntervalo = temporizadores.setInterval || setInterval;
    const limparIntervalo = temporizadores.clearInterval || clearInterval;
    const inicio = agora();
    let timerId = null;
    const atualizar = () => {
      const restante = Math.max(0, Number(intervaloMs) - (agora() - inicio));
      if (typeof aoAtualizar === 'function') aoAtualizar(restante);
      if (restante <= 0) {
        if (timerId != null) limparIntervalo(timerId);
        resolve();
      }
    };
    atualizar();
    if (Number(intervaloMs) > 0) timerId = criarIntervalo(atualizar, 1000);
  });
}

function ffdReservarFilaEmissao(fila) {
  if (!fila || ['RUNNING', 'WAITING', 'CANCELLED'].includes(String(fila.status || '').toUpperCase())) return false;
  fila.status = 'RUNNING';
  return true;
}

function ffdGuardFilaEmissaoKey() {
  return 'ffd_fila_emissao_guard';
}

function ffdAtualizarGuardFilaEmissao(status = null) {
  const chave = ffdGuardFilaEmissaoKey();
  if (typeof sessionStorage === 'undefined') return false;
  const fila = __ffdEstado.filaEmissao || { status: 'IDLE' };
  const proximoStatus = String(status || fila.status || 'IDLE').toUpperCase();
  if (!proximoStatus || ['IDLE', 'COMPLETED', 'CANCELLED'].includes(proximoStatus)) {
    sessionStorage.removeItem(chave);
    return false;
  }
  sessionStorage.setItem(chave, JSON.stringify({
    fechamentoId: Number(__ffdEstado.fechamentoId || 0) || null,
    status: proximoStatus,
    ts: Date.now()
  }));
  return true;
}

function ffdProtegerFilaEmissaoRecarga() {
  if (typeof sessionStorage === 'undefined') return false;
  const chave = typeof ffdGuardFilaEmissaoKey === 'function' ? ffdGuardFilaEmissaoKey() : 'ffd_fila_emissao_guard';
  const raw = sessionStorage.getItem(chave);
  if (!raw) return false;
  try {
    const guard = JSON.parse(raw);
    if (!guard || !guard.status) {
      sessionStorage.removeItem(chave);
      return false;
    }
    const status = String(guard.status).toUpperCase();
    const fechamentoId = Number(guard.fechamentoId || 0);
    const mesmoFechamento = !fechamentoId || Number(__ffdEstado.fechamentoId || 0) === 0 || fechamentoId === Number(__ffdEstado.fechamentoId || 0);
    const ativo = ['RUNNING', 'WAITING'].includes(status) && mesmoFechamento && Date.now() - Number(guard.ts || Date.now()) < 30 * 60 * 1000;
    if (ativo) return true;
  } catch (_) {
    sessionStorage.removeItem(chave);
    return false;
  }
  sessionStorage.removeItem(chave);
  return false;
}

function ffdCancelarFilaEmissao(opcoes = {}) {
  const fila = __ffdEstado.filaEmissao || { status: 'IDLE', resultados: [] };
  if (!fila) return false;
  if (fila.status === 'COMPLETED') return false;
  const mensagem = opcoes.mensagem || 'Emissão cancelada pelo usuário.';
  Object.assign(fila, {
    status: 'CANCELLED',
    vendaAtualId: null,
    proximaVendaId: null,
    countdownMs: null,
    mensagem
  });
  if (typeof sessionStorage !== 'undefined' && typeof ffdGuardFilaEmissaoKey === 'function') {
    sessionStorage.removeItem(ffdGuardFilaEmissaoKey());
  }
  if (typeof ffdRenderFilaEmissao === 'function') ffdRenderFilaEmissao();
  return true;
}

async function ffdExecutarFilaSequencial(vendas, dependencias = {}) {
  const lista = Array.isArray(vendas) ? vendas : [];
  const consultarSituacao = dependencias.consultarSituacao;
  const emitirVenda = dependencias.emitirVenda;
  const atualizarEstado = dependencias.atualizarEstado || (() => {});
  const registrarLog = dependencias.registrarLog || (() => {});
  const escolherIntervalo = dependencias.escolherIntervaloMs || ffdEscolherIntervaloEmissaoMs;
  const esperarIntervalo = dependencias.esperarIntervalo || ((ms, tick) => ffdAguardarCountdown(ms, tick));
  const agora = dependencias.agora || (() => new Date().toISOString());
  const resultados = [];

  atualizarEstado({ status: lista.length ? 'RUNNING' : 'COMPLETED', total: lista.length, indiceAtual: 0, resultados: [] });
  registrarLog('FILA_INICIADA', { quantidade_vendas: lista.length });

  for (let indice = 0; indice < lista.length; indice += 1) {
    const venda = lista[indice] || {};
    const vendaId = Number(venda.venda_id);
    atualizarEstado({
      status: 'RUNNING',
      total: lista.length,
      indiceAtual: indice + 1,
      vendaAtualId: vendaId,
      countdownMs: null,
      mensagem: 'Verificando situação fiscal...'
    });
    registrarLog('VENDA_INICIO', { venda_id: vendaId, indice: indice + 1, total: lista.length });

    let resultado;
    try {
      const atual = await consultarSituacao(vendaId);
      const situacao = String(atual?.nfce_situacao_fiscal || 'DESCONHECIDA').toUpperCase();
      const cancelada = Number(atual?.cancelada || 0) === 1
        || String(atual?.status || '').toLowerCase() === 'cancelada'
        || situacao === 'CANCELADA';

      if (cancelada) {
        resultado = { venda_id: vendaId, status: 'CANCELADA', mensagem: 'Venda cancelada; NFC-e não emitida.' };
      } else if (situacao === 'AUTORIZADA') {
        resultado = {
          venda_id: vendaId,
          status: 'JA_AUTORIZADA',
          mensagem: 'Venda já possui NFC-e autorizada.',
          protocolo: atual?.nfce_protocolo || null,
          chave_acesso: atual?.nfce_chave || null
        };
      } else if (situacao !== 'SEM_DOCUMENTO') {
        resultado = {
          venda_id: vendaId,
          status: 'BLOQUEADA',
          mensagem: atual?.nfce_classificacao_motivo || `Situação fiscal ${situacao}; exige análise antes de emitir.`,
          situacao_fiscal: situacao,
          cstats: atual?.nfce_cstats || []
        };
      } else {
        atualizarEstado({ mensagem: 'Enviando ao serviço fiscal...' });
        const resposta = await emitirVenda(vendaId);
        const statusFiscal = String(resposta?.status || '').toLowerCase();
        if (resposta?.reused && statusFiscal === 'autorizada') {
          resultado = {
            venda_id: vendaId,
            status: 'JA_AUTORIZADA',
            mensagem: resposta.message || 'NFC-e já autorizada; emissão existente reutilizada.',
            nota_id: resposta.notaId || null,
            chave_acesso: resposta.chaveAcesso || null
          };
        } else if (resposta?.success === true && statusFiscal === 'autorizada') {
          resultado = {
            venda_id: vendaId,
            status: 'AUTORIZADA',
            mensagem: resposta.message || 'NFC-e autorizada.',
            nota_id: resposta.notaId || null,
            numero: resposta.numero || null,
            chave_acesso: resposta.chaveAcesso || null,
            protocolo: resposta.soap?.protocolo || null
          };
        } else {
          resultado = {
            venda_id: vendaId,
            status: 'ERRO',
            mensagem: resposta?.message || `Emissão não autorizada (${resposta?.status || 'sem status'}).`,
            codigo: resposta?.code || null,
            status_fiscal: resposta?.status || null,
            nota_id: resposta?.notaId || null,
            chave_acesso: resposta?.chaveAcesso || null,
            protocolo: resposta?.soap?.protocolo || null
          };
        }
      }
    } catch (err) {
      resultado = {
        venda_id: vendaId,
        status: 'ERRO',
        mensagem: err.message || 'Falha ao consultar ou emitir NFC-e.',
        codigo: err.code || null
      };
    }

    resultado.data_hora = agora();
    resultados.push(resultado);
    atualizarEstado({ status: 'RUNNING', resultados: resultados.slice(), ultimoResultado: resultado });
    registrarLog('VENDA_RESULTADO', resultado);

    if (indice < lista.length - 1) {
      const sorteado = Number(escolherIntervalo());
      const intervaloMs = Number.isFinite(sorteado) ? Math.max(60000, Math.min(300000, sorteado)) : 60000;
      const proximaVendaId = Number(lista[indice + 1]?.venda_id);
      atualizarEstado({ status: 'WAITING', vendaAtualId: vendaId, proximaVendaId, intervaloMs, countdownMs: intervaloMs });
      registrarLog('INTERVALO_INICIO', { venda_id: vendaId, proxima_venda_id: proximaVendaId, intervalo_ms: intervaloMs });
      await esperarIntervalo(intervaloMs, (countdownMs) => {
        atualizarEstado({ status: 'WAITING', vendaAtualId: vendaId, proximaVendaId, intervaloMs, countdownMs });
      });
      registrarLog('INTERVALO_FIM', { proxima_venda_id: proximaVendaId, intervalo_ms: intervaloMs });
    }
  }

  const resumo = {
    total: resultados.length,
    autorizadas: resultados.filter((item) => item.status === 'AUTORIZADA').length,
    ja_autorizadas: resultados.filter((item) => item.status === 'JA_AUTORIZADA').length,
    erros: resultados.filter((item) => item.status === 'ERRO').length,
    bloqueadas: resultados.filter((item) => item.status === 'BLOQUEADA' || item.status === 'CANCELADA').length
  };
  atualizarEstado({ status: 'COMPLETED', vendaAtualId: null, proximaVendaId: null, countdownMs: null, resultados: resultados.slice(), resumo });
  registrarLog('FILA_FINALIZADA', resumo);
  return { status: 'COMPLETED', resultados, resumo };
}

function ffdFormatarCountdown(ms) {
  const totalSegundos = Math.ceil(Math.max(0, Number(ms || 0)) / 1000);
  const minutos = Math.floor(totalSegundos / 60);
  const segundos = totalSegundos % 60;
  return `${String(minutos).padStart(2, '0')}:${String(segundos).padStart(2, '0')}`;
}

function ffdRenderFilaEmissao() {
  const fila = __ffdEstado.filaEmissao || {};
  const painel = document.getElementById('ffdPainelFilaEmissao');
  const titulo = document.getElementById('ffdFilaTitulo');
  const status = document.getElementById('ffdFilaStatus');
  const countdown = document.getElementById('ffdFilaCountdown');
  const resumo = document.getElementById('ffdFilaResumo');
  const resultados = document.getElementById('ffdFilaResultados');
  const botao = document.getElementById('ffdBtnIniciarEmissaoSequencial');
  const emAndamento = fila.status === 'RUNNING' || fila.status === 'WAITING';
  if (painel) painel.classList.toggle('d-none', !fila.status || fila.status === 'IDLE');
  if (botao) botao.disabled = emAndamento || ['CANCELLED'].includes(String(fila.status || '').toUpperCase()) || !ffdFilaEmissaoPodeIniciar();

  if (titulo) {
    titulo.textContent = fila.status === 'COMPLETED'
      ? 'EMISSÃO CONCLUÍDA'
      : (fila.status === 'CANCELLED'
        ? 'EMISSÃO CANCELADA'
        : (fila.status === 'WAITING'
          ? `Emissão ${fila.indiceAtual} de ${fila.total}`
          : `Emissão ${fila.indiceAtual || 1} de ${fila.total || 0}`));
  }
  if (status) {
    status.textContent = fila.status === 'COMPLETED'
      ? 'Fila finalizada.'
      : (fila.status === 'CANCELLED'
        ? 'Emissão cancelada pelo usuário.'
        : (fila.vendaAtualId
          ? `Venda #${fila.vendaAtualId} — ${fila.mensagem || (fila.status === 'WAITING' ? 'Aguardando próxima emissão.' : 'Processando...')}`
          : (fila.mensagem || '')));
  }
  if (countdown) {
    countdown.textContent = fila.status === 'WAITING' && fila.proximaVendaId
      ? `Próxima emissão em ${ffdFormatarCountdown(fila.countdownMs)} · Venda #${fila.proximaVendaId}`
      : '';
  }

  const totalizador = fila.resumo;
  if (resumo) {
    resumo.textContent = totalizador
      ? `Total: ${totalizador.total} · Autorizadas: ${totalizador.autorizadas} · Já autorizadas: ${totalizador.ja_autorizadas} · Erros: ${totalizador.erros} · Bloqueadas: ${totalizador.bloqueadas}`
      : '';
  }
  if (resultados) {
    resultados.innerHTML = (fila.resultados || []).map((item) => {
      const chave = item.protocolo || item.chave_acesso || '—';
      return `<tr><td>#${ffdEsc(item.venda_id)}</td><td>${ffdEsc(item.status)}</td><td>${ffdEsc(item.mensagem || '—')}</td><td>${ffdEsc(chave)}</td></tr>`;
    }).join('');
  }
}

function ffdFilaEmissaoPodeIniciar() {
  return __ffdEstado.modoRecebimento === 'por_venda'
    && Boolean(__ffdEstado.fechamentoId)
    && __ffdEstado.vendasElegiveisCarregadas === true
    && (__ffdEstado.vendasElegiveis || []).length > 0
    && ffdComprovantesPorVendaValidos()
    && ffdRecebimentosConciliados()
    && ffdPreviaValida()
    && !ffdFechamentoFinalizado();
}

function ffdAtualizarBotaoFilaEmissao() {
  const botao = document.getElementById('ffdBtnIniciarEmissaoSequencial');
  if (!botao) return;
  const status = __ffdEstado.filaEmissao?.status;
  const bloqueado = ['RUNNING', 'WAITING', 'CANCELLED'].includes(String(status || '').toUpperCase());
  botao.disabled = bloqueado || !ffdFilaEmissaoPodeIniciar();
}

async function ffdConsultarSituacaoVendaParaFila(vendaId) {
  const resp = await fetch(`${ffdApi()}/vendas/${Number(vendaId)}`, { headers: ffdHeaders() });
  const body = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(body.error || `Falha ao consultar venda #${vendaId} (HTTP ${resp.status}).`);
  return body;
}

async function ffdEmitirVendaPeloMotorExistente(vendaId) {
  const resp = await fetch(`${ffdApi()}/fiscal/emitir/venda/${Number(vendaId)}`, {
    method: 'POST',
    headers: ffdHeaders()
  });
  const body = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(body.error || `Falha ao emitir venda #${vendaId} (HTTP ${resp.status}).`);
  return body;
}

function ffdIniciarFilaEmissao(dependencias = {}) {
  if (!ffdFilaEmissaoPodeIniciar()) {
    ffdNotify('Concilie e valide a prévia antes de iniciar a emissão por venda.', 'warning');
    return Promise.resolve(false);
  }

  const protegerRecarga = typeof ffdProtegerFilaEmissaoRecarga === 'function' ? ffdProtegerFilaEmissaoRecarga : () => false;
  if (protegerRecarga()) {
    ffdNotify('Já existe uma fila de emissão ativa para este fechamento. Recarregou a página ou outra sessão está executando.', 'warning');
    return Promise.resolve(false);
  }

  const fila = __ffdEstado.filaEmissao || { status: 'IDLE', resultados: [] };
  if (!ffdReservarFilaEmissao(fila)) return Promise.resolve(false);
  Object.assign(fila, {
    total: __ffdEstado.vendasElegiveis.length,
    indiceAtual: 0,
    vendaAtualId: null,
    proximaVendaId: null,
    countdownMs: null,
    resultados: [],
    resumo: null,
    mensagem: null
  });
  __ffdEstado.filaEmissao = fila;
  const atualizarGuard = typeof ffdAtualizarGuardFilaEmissao === 'function' ? ffdAtualizarGuardFilaEmissao : () => false;
  atualizarGuard('RUNNING');
  ffdRenderFilaEmissao();

  const executar = async () => {
    try {
      if (!dependencias.silencioso) {
        ffdLogDesenvolvimento('FILA_EMISSAO_INICIADA', { fechamento_id: __ffdEstado.fechamentoId, quantidade_vendas: fila.total });
      }
      const comprovantesSalvos = await ffdSalvarComprovantes({ silencioso: true });
      if (!comprovantesSalvos) {
        Object.assign(fila, { status: 'ERROR', mensagem: 'Não foi possível salvar os comprovantes antes da emissão.' });
        ffdRenderFilaEmissao();
        return false;
      }
      const resposta = await ffdExecutarFilaSequencial(__ffdEstado.vendasElegiveis.slice(), {
        consultarSituacao: dependencias.consultarSituacao || ffdConsultarSituacaoVendaParaFila,
        emitirVenda: dependencias.emitirVenda || ffdEmitirVendaPeloMotorExistente,
        escolherIntervaloMs: dependencias.escolherIntervaloMs,
        esperarIntervalo: dependencias.esperarIntervalo,
        agora: dependencias.agora,
        registrarLog: (evento, payload) => {
          console.info(`[FFD][FILA] ${evento}`, payload);
          if (dependencias.registrarLog) dependencias.registrarLog(evento, payload);
        },
        atualizarEstado: (patch) => {
          Object.assign(fila, patch);
          if (['RUNNING', 'WAITING'].includes(String((patch && patch.status) || fila.status || '').toUpperCase())) {
            const atualizarGuardNoEstado = typeof ffdAtualizarGuardFilaEmissao === 'function' ? ffdAtualizarGuardFilaEmissao : () => false;
            atualizarGuardNoEstado(patch && patch.status ? patch.status : fila.status);
          }
          ffdRenderFilaEmissao();
        }
      });
      const atualizarGuardFinal = typeof ffdAtualizarGuardFilaEmissao === 'function' ? ffdAtualizarGuardFilaEmissao : () => false;
      atualizarGuardFinal(resposta?.status || 'COMPLETED');
      return resposta;
    } catch (err) {
      Object.assign(fila, { status: 'ERROR', vendaAtualId: null, countdownMs: null, mensagem: err.message || 'Falha inesperada na fila.' });
      const atualizarGuardErro = typeof ffdAtualizarGuardFilaEmissao === 'function' ? ffdAtualizarGuardFilaEmissao : () => false;
      atualizarGuardErro('ERROR');
      ffdRenderFilaEmissao();
      return false;
    }
  };

  const locks = dependencias.locks === undefined
    ? (typeof navigator !== 'undefined' ? navigator.locks : null)
    : dependencias.locks;
  if (locks && typeof locks.request === 'function') {
    return locks.request('fechamento-fiscal-dia-emissao-sequencial', { ifAvailable: true }, (lock) => {
      if (!lock) {
        Object.assign(fila, { status: 'IDLE', mensagem: 'Outra fila de emissão já está ativa.' });
        ffdRenderFilaEmissao();
        return false;
      }
      return executar();
    }).catch((err) => {
      Object.assign(fila, { status: 'ERROR', mensagem: err.message || 'Não foi possível adquirir o lock da fila.' });
      ffdRenderFilaEmissao();
      return false;
    });
  }
  return executar();
}

function ffdAtualizarVistaBtns() {
  $('#ffdVistaVenda').toggleClass('active', __ffdEstado.vista === 'venda');
  $('#ffdVistaProduto').toggleClass('active', __ffdEstado.vista === 'produto');
}

function ffdRenderMaquinas() {
  const body = document.getElementById('ffdMaquinasBody');
  if (!body) return;
  const rows = __ffdEstado.recebimentos || [];
  if (!rows.length) {
    body.innerHTML = '<tr><td colspan="4" class="text-muted">Nenhuma máquina informada.</td></tr>';
  } else {
    body.innerHTML = rows.map((r, idx) => `
      <tr>
        <td>${ffdEsc(r.operadora)}</td>
        <td>${ffdEsc(r.cnpj || '—')}</td>
        <td class="text-end">${ffdFmtMoney(r.valor)}</td>
        <td class="text-end"><button type="button" class="btn btn-sm btn-outline-danger" data-ffd-rm="${idx}">Remover</button></td>
      </tr>`).join('');
    body.querySelectorAll('[data-ffd-rm]').forEach((btn) => {
      btn.addEventListener('click', () => {
        ffdRemoverMaquinaUi(Number(btn.getAttribute('data-ffd-rm')));
      });
    });
  }
  ffdRenderConciliacaoRecebimentos();
}

async function ffdPersistirRecebimentosSeRascunho() {
  const id = __ffdEstado.fechamentoId;
  if (!id || ffdFechamentoFinalizado()) return;
  try {
    await ffdSincronizarRecebimentos(id);
    __ffdEstado.recebimentosLocais = false;
    ffdRenderMaquinas();
  } catch (err) {
    ffdNotify(err.message || 'Falha ao salvar máquinas.', 'danger');
  }
}

function ffdRemoverMaquinaUi(idx) {
  const i = Number(idx);
  if (!Number.isInteger(i) || i < 0) return;
  __ffdEstado.recebimentos.splice(i, 1);
  __ffdEstado.recebimentosLocais = true;
  ffdRenderMaquinas();
  ffdPersistirRecebimentosSeRascunho();
}

async function ffdAdicionarMaquinaUi() {
  const dados = await ffdAbrirModalMaquina();
  if (!dados) return;

  const linhas = Array.isArray(dados.valores) && dados.valores.length
    ? dados.valores
    : [{ operadora: dados.operadora, cnpj: dados.cnpj || '', valor: dados.valor }];

  linhas.forEach((linha) => {
    __ffdEstado.recebimentos.push({
      operadora: linha.operadora,
      cnpj: linha.cnpj || '',
      valor: linha.valor
    });
  });

  __ffdEstado.recebimentosLocais = true;
  ffdRenderMaquinas();
  await ffdPersistirRecebimentosSeRascunho();
}

async function ffdCarregarDia(opts = {}) {
  const silencioso = Boolean(opts.silencioso);
  const data = String($('#ffdData').val() || ffdHojeISO());
  if (__ffdEstado.data && __ffdEstado.data !== data) {
    __ffdEstado.recebimentosLocais = false;
    __ffdEstado.recebimentos = [];
    __ffdEstado.vendasElegiveis = [];
    __ffdEstado.vendasElegiveisCarregadas = false;
    __ffdEstado.previa = null;
  }
  __ffdEstado.data = data;
  try {
    if (!__ffdEstado.moduloOn) {
      ffdRenderCabecalhoMonitor();
      ffdRenderKpis({});
      ffdRenderAlertaInteligente({});
      const body = document.getElementById('ffdGridBody');
      if (body) {
        body.innerHTML = '<tr><td colspan="7" class="text-muted text-center py-4">Monitoramento indisponível — módulo desativado.</td></tr>';
      }
      return;
    }

    // Sprint 07.8 — descobrir fechamento ativo ANTES do resumo, para excluir a própria prévia.
    const listaResp = await fetch(`${ffdApi()}/fiscal/fechamentos?data=${encodeURIComponent(data)}`, { headers: ffdHeaders() });
    const listaBody = await listaResp.json().catch(() => ({}));
    const ativos = (listaBody.fechamentos || []).filter((f) => f.status !== 'CANCELADO');
    const ff = ativos.length ? ativos[0] : null;

    if (ff) {
      __ffdEstado.fechamentoId = ff.id;
      __ffdEstado.statusFiscal = ff.status || null;
      __ffdEstado.documentos = ff.documentos || [];
      __ffdEstado.complementacao = ff.complementacao || null;
      if (ff.saldo || ff.valor_principal != null) {
        __ffdEstado.saldo = ff.saldo || {
          valor_principal: ff.valor_principal,
          valor_emitido_autorizado: ff.valor_emitido_autorizado,
          valor_pendente_emissao: ff.valor_pendente_emissao,
          mensagens: ff.mensagens_saldo
        };
        ffdRenderSaldo(__ffdEstado.saldo);
      }
      // Abertura explícita: força GET saldo com log RECUPERACAO no backend
      if (!silencioso && ff.id) {
        try {
          const saldoResp = await fetch(`${ffdApi()}/fiscal/fechamentos/${ff.id}/saldo`, { headers: ffdHeaders() });
          const saldoBody = await saldoResp.json().catch(() => ({}));
          if (saldoResp.ok && saldoBody.saldo) {
            __ffdEstado.saldo = saldoBody.saldo;
            if (saldoBody.status) __ffdEstado.statusFiscal = saldoBody.status;
            ffdRenderSaldo(saldoBody.saldo);
          }
        } catch (_) { /* ignore */ }
      }
      ffdRenderComplementacao(__ffdEstado.complementacao);
      const finalizado = ffdFechamentoFinalizado(__ffdEstado.statusFiscal || ff.status);

      if (finalizado) {
        // Não reidrata recebimentos/prévia na UI — limpeza automática pós-autorização.
        __ffdEstado.recebimentos = [];
        __ffdEstado.recebimentosLocais = false;
        __ffdEstado.previa = null;
        __ffdEstado.valorFechado = Number(ff.valor_distribuido || ff.valor_informado || 0);
      } else {
        if (!silencioso && !__ffdEstado.recebimentosLocais) {
          if (__ffdEstado.modoRecebimento === 'por_comprovante') {
            try {
              const resp = await fetch(`${ffdApi()}/fiscal/fechamentos/${ff.id}/recebimentos-comprovantes`, { headers: ffdHeaders() });
              const body = await resp.json().catch(() => ({}));
              if (resp.ok) {
                __ffdEstado.recebimentos = (body.comprovantes || []).map((r, idx) => ({
                  id: r.id,
                  operadora: r.operadora || `Comprovante ${idx + 1}`,
                  cnpj: '',
                  valor: Number(r.valor || 0)
                }));
              } else {
                __ffdEstado.recebimentos = [];
              }
            } catch (_) {
              __ffdEstado.recebimentos = [];
            }
          } else {
            __ffdEstado.recebimentos = (ff.recebimentos || []).map((r) => ({
              id: r.id, operadora: r.operadora, cnpj: r.cnpj, valor: Number(r.valor)
            }));
          }
          ffdRenderMaquinas();
        }
        if (!silencioso) {
          $('#ffdValorAlvo').val(Number(ff.valor_alvo || 250).toFixed(2));
          $('#ffdValorMin').val(Number(ff.valor_min != null ? ff.valor_min : 8).toFixed(2));
          $('#ffdValorMax').val(Number(ff.valor_max || 400).toFixed(2));
        }
        if (ff.previa_vendas && ff.previa_vendas.length && !silencioso) {
          ffdRenderPrevia({
            vendas: ff.previa_vendas.map((v) => ({
              sequencia: v.sequencia,
              rotulo: `Venda Fiscal ${String(v.sequencia).padStart(3, '0')}`,
              valor: Number(v.valor),
              quantidade_itens: (v.itens || []).length,
              itens: (v.itens || []).map((it) => ({
                nome: it.nome || `Produto ${it.produto_id}`,
                quantidade: it.quantidade,
                valor_total: it.valor_total,
                produto_id: it.produto_id
              }))
            })),
            porProduto: (ff.itens || []).map((i) => ({
              nome: i.nome || `Produto ${i.produto_id}`,
              produto_id: i.produto_id,
              quantidade_vendida: i.quantidade_disponivel,
              quantidade_utilizada: i.quantidade_utilizada
            })),
            valor_informado: Number(ff.valor_informado),
            valor_distribuido: Number(ff.valor_distribuido),
            diferenca: Number(ff.diferenca),
            quantidade_vendas: ff.previa_vendas.length,
            perfeita: Number(ff.diferenca) === 0,
            incompleta: Number(ff.diferenca) !== 0,
            mensagem: Number(ff.diferenca) === 0
              ? 'Valor informado e valor distribuído estão iguais.'
              : null,
            valor_elegivel: Number(ff.valor_distribuido)
          });
        } else if (ff.previa_vendas && ff.previa_vendas.length && silencioso && __ffdEstado.previa) {
          __ffdEstado.previa.valor_informado = Number(ff.valor_informado);
          __ffdEstado.previa.valor_distribuido = Number(ff.valor_distribuido);
          __ffdEstado.previa.diferenca = Number(ff.diferenca);
          __ffdEstado.previa.perfeita = Number(ff.diferenca) === 0;
        } else if (ff.previa_vendas && ff.previa_vendas.length && !__ffdEstado.previa) {
          // Polling encontrou prévia persistida ainda não carregada na sessão.
          ffdRenderPrevia({
            vendas: ff.previa_vendas.map((v) => ({
              sequencia: v.sequencia,
              rotulo: `Venda Fiscal ${String(v.sequencia).padStart(3, '0')}`,
              valor: Number(v.valor),
              quantidade_itens: (v.itens || []).length,
              itens: (v.itens || []).map((it) => ({
                nome: it.nome || `Produto ${it.produto_id}`,
                quantidade: it.quantidade,
                valor_total: it.valor_total,
                produto_id: it.produto_id
              }))
            })),
            porProduto: (ff.itens || []).map((i) => ({
              nome: i.nome || `Produto ${i.produto_id}`,
              produto_id: i.produto_id,
              quantidade_vendida: i.quantidade_disponivel,
              quantidade_utilizada: i.quantidade_utilizada
            })),
            valor_informado: Number(ff.valor_informado),
            valor_distribuido: Number(ff.valor_distribuido),
            diferenca: Number(ff.diferenca),
            quantidade_vendas: ff.previa_vendas.length,
            perfeita: Number(ff.diferenca) === 0,
            incompleta: Number(ff.diferenca) !== 0,
            mensagem: Number(ff.diferenca) === 0
              ? 'Valor informado e valor distribuído estão iguais.'
              : null,
            valor_elegivel: Number(ff.valor_distribuido)
          });
        }
      }
    } else if (!silencioso) {
      __ffdEstado.fechamentoId = null;
      __ffdEstado.statusFiscal = null;
      if (!__ffdEstado.recebimentosLocais) {
        __ffdEstado.recebimentos = [];
      }
      ffdRenderMaquinas();
    }

    const qsResumo = new URLSearchParams({ data });
    // Após AUTORIZADO, NÃO excluir o próprio FF do residual — senão a tela “ressuscita” o valor já fechado.
    if (__ffdEstado.fechamentoId && ffdDeveExcluirFechamentoDoResumo(__ffdEstado.statusFiscal)) {
      qsResumo.set('fechamento_id', String(__ffdEstado.fechamentoId));
    }
    const resp = await fetch(`${ffdApi()}/fiscal/fechamentos/resumo?${qsResumo.toString()}`, { headers: ffdHeaders() });
    const body = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(body.error || `HTTP ${resp.status}`);
    __ffdEstado.resumo = body;
    __ffdEstado.ultimaAtualizacao = ffdFmtHora();
    ffdRenderKpis(body);
    ffdRenderAlertaInteligente(body);
    ffdRenderGridMonitoramento(body);
    ffdRenderConciliacaoRecebimentos();
    ffdAtualizarBotoesEtapa5(__ffdEstado.previa);
    ffdRenderCabecalhoMonitor();
    ffdAplicarModoSomenteLeituraAutorizado();
    if (!silencioso && __ffdEstado.modoRecebimento === 'por_venda') {
      await ffdCarregarVendasElegiveis();
    }
  } catch (err) {
    if (!silencioso) ffdNotify(err.message || 'Falha ao carregar o dia.', 'danger');
  }
}

function ffdRenderPrevia(previa) {
  __ffdEstado.previa = previa;
  const el = document.getElementById('ffdPreviaConteudo');
  const alerta = document.getElementById('ffdAlertaPrevia');
  if (!el) return;

  const ind = __ffdEstado.indicadores || {};
  if (!previa) {
    $('#ffdPrevInformado, #ffdPrevDistribuido, #ffdPrevDiferenca, #ffdPrevQtdVendas, #ffdIndElegiveis, #ffdIndElegivel').text('—');
  } else {
    $('#ffdPrevInformado').text(ffdFmtMoney(previa.valor_informado));
    $('#ffdPrevDistribuido').text(ffdFmtMoney(previa.valor_distribuido));
    $('#ffdPrevDiferenca').text(ffdFmtMoney(previa.diferenca));
    $('#ffdPrevQtdVendas').text(String(previa.quantidade_vendas ?? (previa.vendas || []).length ?? 0));
    $('#ffdIndElegiveis').text(String(
      ind.produtos_elegiveis
      ?? previa.metricas?.produtos_elegiveis
      ?? __ffdEstado.resumo?.produtos_fiscais_com_consumo_nao_fiscal
      ?? __ffdEstado.resumo?.itens_fiscais_elegiveis
      ?? '—'
    ));
    $('#ffdIndElegivel').text(ffdFmtMoney(
      ind.valor_elegivel
      ?? previa.valor_elegivel
      ?? __ffdEstado.resumo?.valor_fiscal_elegivel
      ?? __ffdEstado.resumo?.capacidade_elegivel
    ));
  }
  ffdRenderConciliacaoRecebimentos();
  ffdAtualizarBotaoFilaEmissao();
  ffdRenderCabecalhoMonitor();

  if (alerta) {
    if (!previa) {
      alerta.innerHTML = '';
    } else if (previa.codigo === 'VALOR_ZERO') {
      alerta.innerHTML = `<div class="alert alert-info mb-0">${ffdEsc(previa.mensagem)}</div>`;
    } else if (previa.perfeita) {
      alerta.innerHTML = `<div class="alert alert-success mb-0"><strong>✓ Distribuição concluída</strong><div class="small">${ffdEsc(previa.mensagem || 'Valor informado e valor distribuído estão iguais.')}</div></div>`;
    } else if (previa.incompleta) {
      alerta.innerHTML = `<div class="alert alert-warning mb-0"><strong>⚠ Distribuição incompleta</strong><pre class="mb-0 mt-2 small" style="white-space:pre-wrap">${ffdEsc(previa.mensagem || '')}</pre></div>`;
    } else {
      alerta.innerHTML = '';
    }
  }

  if (!previa || (!(previa.vendas || []).length && __ffdEstado.vista === 'venda')) {
    el.innerHTML = '<span class="text-muted">Nenhuma composição gerada.</span>';
    return;
  }

  if (__ffdEstado.vista === 'produto') {
    const rows = previa.porProduto || previa.itensUtilizados || [];
    if (!rows.length) {
      el.innerHTML = '<span class="text-muted">Sem utilização por produto.</span>';
      return;
    }
    el.innerHTML = `
      <div class="table-responsive">
        <table class="table table-sm">
          <thead><tr><th>Produto</th><th class="text-end">Vendido</th><th class="text-end">Utilizado</th><th class="text-end">Valor utilizado</th></tr></thead>
          <tbody>
            ${rows.map((p) => `
              <tr>
                <td>${ffdEsc(p.nome || `Produto ${p.produto_id}`)}</td>
                <td class="text-end">${p.quantidade_vendida != null ? p.quantidade_vendida : '—'}</td>
                <td class="text-end">${p.quantidade_utilizada != null ? p.quantidade_utilizada : '—'}</td>
                <td class="text-end">${ffdFmtMoney(p.valor_utilizado)}</td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>`;
    return;
  }

  el.innerHTML = (previa.vendas || []).map((v, idx) => {
    const itens = v.itens || [];
    const rotulo = ffdEsc(v.rotulo || `Venda Fiscal ${String(v.sequencia || idx + 1).padStart(3, '0')}`);
    return `
      <div class="border rounded-3 p-3 mb-3 shadow-sm" style="background: linear-gradient(180deg, #f5f8f6 0%, #edf2ef 100%); border-color: #dfe9e2 !important;">
        <div class="d-flex justify-content-between align-items-start gap-3">
          <div class="flex-grow-1">
            <div class="fw-bold text-dark">${rotulo}</div>
            <div class="fs-5 fw-semibold mt-1">${ffdFmtMoney(v.valor)}</div>
            <div class="text-muted small mt-1">${itens.length} itens</div>
          </div>
          <div class="dropdown">
            <button class="btn btn-sm btn-outline-secondary" type="button" data-bs-toggle="dropdown" aria-expanded="false" aria-label="Detalhes da venda">⋮</button>
            <ul class="dropdown-menu dropdown-menu-end">
              <li><button class="dropdown-item" type="button" data-ffd-detalhe="${idx}">Ver detalhes</button></li>
              <li><button class="dropdown-item disabled" type="button" title="Próxima etapa">Ajustar manualmente</button></li>
              <li><button class="dropdown-item text-danger" type="button" data-ffd-remover="${idx}">Remover da composição</button></li>
            </ul>
          </div>
        </div>
        ${itens.length ? `
          <div class="table-responsive mt-3">
            <table class="table table-sm mb-0 align-middle">
              <thead class="table-light">
                <tr>
                  <th class="border-0">Produto</th>
                  <th class="text-end border-0">Qtd.</th>
                  <th class="text-end border-0">Valor</th>
                </tr>
              </thead>
              <tbody>
                ${itens.map((it) => `
                  <tr>
                    <td class="border-0">${ffdEsc(it.nome || `Produto ${it.produto_id}`)}</td>
                    <td class="text-end border-0">${it.quantidade}</td>
                    <td class="text-end border-0">${ffdFmtMoney(it.valor_total != null ? it.valor_total : it.valor)}</td>
                  </tr>`).join('')}
              </tbody>
            </table>
          </div>` : ''}
      </div>`;
  }).join('');

  el.querySelectorAll('[data-ffd-detalhe]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const v = (previa.vendas || [])[Number(btn.getAttribute('data-ffd-detalhe'))];
      if (!v) return;
      const txt = (v.itens || []).map((it) =>
        `${it.nome}: ${it.quantidade} × ${ffdFmtMoney(it.valor_unitario || 0)} = ${ffdFmtMoney(it.valor_total || it.valor)}`
      ).join('\n');
      ffdAlert(
        `${v.rotulo}\nTotal: ${ffdFmtMoney(v.valor)}\n\n${txt || 'Sem itens'}`,
        v.rotulo || 'Detalhe da composição'
      );
    });
  });
  el.querySelectorAll('[data-ffd-remover]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const ok = await ffdConfirm('Remover esta venda da composição e recalcular a prévia?');
      if (!ok) return;
      // Sprint 02: remoção = regenerar (sem edição manual persistente nesta etapa)
      ffdNotify('Recalculando distribuição…', 'info');
      await ffdAtualizarPrevia();
    });
  });

  ffdAtualizarBotoesEtapa5(previa);
}

function ffdAtualizarBotoesEtapa5(previa) {
  const okPrevia = ffdPreviaValida(previa);
  const conciliado = ffdRecebimentosConciliados();
  const validado = Boolean(__ffdEstado.validacao && __ffdEstado.validacao.ok);
  const pronto = __ffdEstado.statusFiscal === 'PRONTO_EMISSAO';
  const emitindo = __ffdEstado.statusFiscal === 'EMITINDO';
  const autorizado = __ffdEstado.statusFiscal === 'AUTORIZADO';
  const parcial = ffdEhAutorizacaoParcial();
  const temXml = (__ffdEstado.documentos || []).some((d) => d.xml_preparado || d.xml_hash);
  const moduloOk = Boolean(__ffdEstado.moduloOn);
  const homolog = Number(__ffdEstado.ambiente) === 2;
  const producao = Number(__ffdEstado.ambiente) === 1;
  const txOk = Boolean(__ffdEstado.transmissaoHabilitada);
  const ops = __ffdEstado.ops || {};
  const porVenda = __ffdEstado.modoRecebimento === 'por_venda';
  const aptoEmitir = Boolean(
    moduloOk
    && txOk
    && conciliado
    && okPrevia
    && !autorizado
    && !parcial
    && !__ffdEstado.transmitindo
    && !ops.emitir
    && !ops.transmitir
  );
  $('#ffdBtnEmitir').prop('disabled', !aptoEmitir || porVenda);
  const acaoEmissao = document.getElementById('ffdBtnEmitir')?.closest('.d-flex');
  if (acaoEmissao) acaoEmissao.classList.toggle('d-none', porVenda);
  $('#ffdBtnEmitir, #ffdBtnContinuarEmissao, #ffdDetalhesTecnicos').toggleClass('d-none', porVenda);
  if (parcial) {
    $('#ffdBtnEmitir').addClass('d-none');
  } else {
    $('#ffdBtnEmitir').removeClass('d-none');
  }
  $('#ffdBtnValidar').prop('disabled', !moduloOk || ops.validar || (!okPrevia && !pronto) || (!conciliado && !pronto) || parcial);
  $('#ffdBtnGerarXml').prop('disabled', !moduloOk || ops.preparar || (!(okPrevia && (validado || pronto)) && !pronto) || parcial);
  $('#ffdBtnPreparar').prop('disabled', !moduloOk || ops.preparar || (!(okPrevia && (validado || pronto)) && !pronto) || parcial);
  $('#ffdBtnVerXml').prop('disabled', !temXml);
  $('#ffdBtnAtualizarPrevia').prop('disabled', Boolean(ops.previa) || autorizado || parcial);
  $('#ffdBtnSalvarRascunho').prop('disabled', Boolean(ops.salvar) || autorizado || parcial);
  $('#ffdBtnCorrigir').prop('disabled', autorizado || parcial || !(__ffdEstado.validacao && __ffdEstado.validacao.ok === false));
  $('#ffdBtnTransmitir').prop(
    'disabled',
    !moduloOk
      || !txOk
      || __ffdEstado.transmitindo
      || Boolean(ops.transmitir)
      || !(pronto || emitindo)
      || autorizado
      || parcial
  );
  $('#ffdBtnRecuperar').prop(
    'disabled',
    !moduloOk
      || !txOk
      || __ffdEstado.transmitindo
      || !(
        emitindo
        || (__ffdEstado.documentos || []).some((d) =>
          d.status === 'EMITINDO' || d.status === 'ERRO_COM_POSSIVEL_PROCESSAMENTO'
        )
      )
  );
  $('#ffdValTotal').text(ffdFmtMoney(previa?.valor_distribuido ?? previa?.valor_informado));
  $('#ffdValDocs').text(String((__ffdEstado.documentos || []).length || previa?.quantidade_vendas || '—'));
  $('#ffdValStatus').text(__ffdEstado.statusFiscal || (okPrevia ? 'PREVIA' : '—'));
  $('#ffdValAmbiente').text(
    producao ? 'Produção' : (homolog ? 'Homologação' : '—')
  );
  ffdRenderPainelEmissao();
  ffdAtualizarBotaoFilaEmissao();
}


function ffdMotivosBloqueioEmissao() {
  const motivos = [];
  if (!__ffdEstado.moduloOn) motivos.push('Módulo Fechamento Fiscal do Dia está desativado.');
  if (!ffdRecebimentosConciliados()) {
    const dif = ffdFmtMoney(Math.abs(ffdDiferencaConciliacao()));
    motivos.push(`Recebimentos não conciliados (diferença ${dif}).`);
  }
  if (!ffdPreviaValida()) motivos.push('Prévia fiscal ainda não está pronta (sem diferença e com vendas).');
  if (!__ffdEstado.transmissaoHabilitada) {
    const diag = __ffdEstado.diagnosticoTx || {};
    const motivo = (diag.pendencias && diag.pendencias[0] && diag.pendencias[0].mensagem)
      || diag.mensagem
      || 'Configuração fiscal incompleta para transmissão.';
    motivos.push(motivo);
  }
  if (__ffdEstado.statusFiscal === 'AUTORIZADO') {
    motivos.push('Fechamento já autorizado.');
  }
  const errosVal = (__ffdEstado.validacao && __ffdEstado.validacao.ok === false
    && Array.isArray(__ffdEstado.validacao.erros))
    ? __ffdEstado.validacao.erros
    : [];
  errosVal.forEach((e) => {
    if (e && e.produto_nome && e.mensagem) {
      motivos.push(`Produto ${e.produto_nome} — ${e.mensagem}`);
    } else if (e && e.mensagem) {
      motivos.push(e.mensagem);
    }
  });
  return motivos;
}

function ffdRenderPainelEmissao() {
  const painel = document.getElementById('ffdPainelEmissao');
  const checklist = document.getElementById('ffdChecklist');
  const hint = document.getElementById('ffdEmitirHint');
  if (!painel && !checklist) return;

  const conciliado = ffdRecebimentosConciliados();
  const okPrevia = ffdPreviaValida();
  const validado = Boolean(__ffdEstado.validacao && __ffdEstado.validacao.ok);
  const pronto = __ffdEstado.statusFiscal === 'PRONTO_EMISSAO'
    || __ffdEstado.statusFiscal === 'EMITINDO'
    || __ffdEstado.statusFiscal === 'AUTORIZADO';
  const dadosOk = validado || pronto;
  const motivos = ffdMotivosBloqueioEmissao();
  const apto = motivos.length === 0 && __ffdEstado.statusFiscal !== 'AUTORIZADO';

  const itens = [
    { ok: conciliado, label: 'Recebimentos conciliados' },
    { ok: okPrevia, label: 'Prévia fiscal pronta' },
    {
      ok: dadosOk || (conciliado && okPrevia),
      label: dadosOk ? 'Dados fiscais válidos' : (conciliado && okPrevia
        ? 'Dados fiscais serão validados na emissão'
        : 'Dados fiscais pendentes')
    }
  ];

  if (checklist) {
    checklist.innerHTML = `<div class="fw-semibold mb-2">Checklist</div>
      <ul class="list-unstyled mb-0">${itens.map((c) =>
        `<li class="${c.ok ? 'text-success' : 'text-muted'}">${c.ok ? '✓' : '○'} ${ffdEsc(c.label)}</li>`
      ).join('')}</ul>`;
  }

  if (painel) {
    if (__ffdEstado.statusFiscal === 'AUTORIZADO') {
      const docsAuth = (__ffdEstado.documentos || []).filter((d) => d.status === 'AUTORIZADO');
      painel.innerHTML = `<div class="alert alert-success mb-0"><strong>✓ NFC-e AUTORIZADA</strong>
        <ul class="small mb-2 mt-2">${(docsAuth.length ? docsAuth : [{}]).map((d) =>
          `<li>Número: <strong>${ffdEsc(d.numero || d.numero_provisorio || '—')}</strong>
           · Série: <strong>${ffdEsc(d.serie || '1')}</strong><br>
           Chave: ${ffdEsc(d.chave_acesso || '—')}<br>
           Protocolo: ${ffdEsc(d.protocolo || '—')}</li>`
        ).join('')}</ul>
        <button type="button" class="btn btn-sm btn-outline-success" id="ffdBtnReabrirCupomPainel">Abrir Cupom Fiscal</button>
        <div class="small text-muted mt-2">Também disponível em Fiscal → NFC-e Emitidas.</div></div>`;
      const btnPainel = document.getElementById('ffdBtnReabrirCupomPainel');
      if (btnPainel) {
        btnPainel.addEventListener('click', () => ffdAbrirCupomAposAutorizacao({
          status: 'AUTORIZADO',
          documentos: __ffdEstado.documentos
        }));
      }
    } else if (apto) {
      painel.innerHTML = `<div class="alert alert-success mb-0"><strong>Está tudo certo. Pode emitir.</strong>
        <div class="small mt-1">O sistema validará, preparará o XML e solicitará confirmação antes de transmitir.</div></div>`;
    } else {
      painel.innerHTML = `<div class="alert alert-warning mb-0"><strong>Não é possível emitir ainda.</strong>
        <ul class="small mb-0 mt-2">${motivos.map((m) => `<li>${ffdEsc(m)}</li>`).join('')}</ul></div>`;
    }
  }

  if (hint) {
    hint.textContent = apto
      ? 'Uma confirmação será pedida antes da transmissão.'
      : '';
  }
}

async function ffdVerificarModulo() {
  try {
    const resp = await fetch(`${ffdApi()}/fiscal/fechamentos/modulo`, { headers: ffdHeaders() });
    const body = await resp.json().catch(() => ({}));
    __ffdEstado.moduloOn = Boolean(body.permitido);
    __ffdEstado.ambiente = body.ambiente != null ? Number(body.ambiente) : null;
    __ffdEstado.diagnosticoTx = body.diagnostico_transmissao || null;
    __ffdEstado.transmissaoHabilitada = Boolean(body.transmissao_habilitada);
    const alerta = document.getElementById('ffdModuloAlerta');
    if (alerta) {
      if (!__ffdEstado.moduloOn) {
        alerta.innerHTML = `<div class="alert alert-danger">Módulo <strong>Fechamento Fiscal do Dia</strong> desativado.
          Ative em Configurações → Plataforma Fiscal → Fechamento Fiscal do Dia.</div>`;
      } else {
        const diag = body.diagnostico_transmissao || {};
        const amb = Number(body.ambiente);
        const msgBackend = body.mensagem_ambiente || diag.mensagem || '';
        const pend = Array.isArray(diag.pendencias) ? diag.pendencias : [];
        const detalhePend = pend.length
          ? `<div class="small mt-1">${ffdEsc(pend.map((p) => p.mensagem).filter(Boolean).join(' · '))}</div>`
          : '';
        if (amb === 1 && diag.ok) {
          alerta.innerHTML = `<div class="alert alert-success mb-0">🟢 Ambiente fiscal em <strong>PRODUÇÃO</strong> — transmissão habilitada.
            <div class="small mt-1">${ffdEsc(msgBackend)}</div></div>`;
        } else if (amb === 2 && diag.ok) {
          alerta.innerHTML = `<div class="alert alert-info mb-0">🔵 Ambiente fiscal em <strong>HOMOLOGAÇÃO</strong> — ambiente de testes.
            <div class="small mt-1">${ffdEsc(msgBackend)}</div></div>`;
        } else if (amb === 1 && pend.some((p) => String(p.codigo || '').includes('CERTIFICADO'))) {
          alerta.innerHTML = `<div class="alert alert-danger mb-0">🔴 Ambiente fiscal em <strong>PRODUÇÃO</strong> — certificado digital inválido ou ausente.
            ${detalhePend}</div>`;
        } else if (amb === 1) {
          alerta.innerHTML = `<div class="alert alert-warning mb-0">🟠 Ambiente fiscal em <strong>PRODUÇÃO</strong> — configuração fiscal incompleta.
            ${detalhePend || `<div class="small mt-1">${ffdEsc(msgBackend)}</div>`}</div>`;
        } else if (amb === 2) {
          alerta.innerHTML = `<div class="alert alert-warning mb-0">🟠 Ambiente fiscal em <strong>HOMOLOGAÇÃO</strong> — configuração incompleta para transmissão.
            ${detalhePend || `<div class="small mt-1">${ffdEsc(msgBackend)}</div>`}</div>`;
        } else {
          alerta.innerHTML = `<div class="alert alert-warning mb-0">🟠 Ambiente fiscal não configurado.
            ${detalhePend || `<div class="small mt-1">${ffdEsc(msgBackend || 'Configure produção ou homologação.')}</div>`}</div>`;
        }
      }
    }
    ffdRenderCabecalhoMonitor();
    ffdAtualizarBotoesEtapa5(__ffdEstado.previa);
  } catch (_) {
    __ffdEstado.moduloOn = false;
    __ffdEstado.transmissaoHabilitada = false;
    ffdRenderCabecalhoMonitor();
  }
}

async function ffdTransmitirSefaz(opts = {}) {
  if (__ffdEstado.transmitindo || (__ffdEstado.ops && __ffdEstado.ops.transmitir)) return false;
  if (!__ffdEstado.moduloOn) {
    ffdNotify('Módulo desativado.', 'warning');
    return false;
  }
  if (!__ffdEstado.transmissaoHabilitada) {
    const diag = __ffdEstado.diagnosticoTx || {};
    const motivo = (diag.pendencias && diag.pendencias[0] && diag.pendencias[0].mensagem)
      || diag.mensagem
      || 'Configuração fiscal incompleta para transmissão.';
    ffdNotify(motivo, 'warning');
    return false;
  }
  if (__ffdEstado.statusFiscal === 'AUTORIZADO') {
    ffdNotify('Fechamento já autorizado. Não é possível transmitir novamente.', 'info');
    return false;
  }
  if (__ffdEstado.statusFiscal !== 'PRONTO_EMISSAO' && __ffdEstado.statusFiscal !== 'EMITINDO') {
    ffdNotify('Prepare o fechamento para emissão antes de transmitir.', 'warning');
    return false;
  }

  if (!opts.confirmado) {
    const docs = __ffdEstado.documentos || [];
    const qtd = docs.length || (__ffdEstado.previa?.quantidade_vendas || 0);
    const total = ffdFmtMoney(__ffdEstado.previa?.valor_distribuido || __ffdEstado.previa?.valor_informado);
    const amb = Number(__ffdEstado.ambiente);
    const ambLabel = amb === 1 ? 'PRODUÇÃO' : (amb === 2 ? 'HOMOLOGAÇÃO' : '—');
    const dataBr = ffdFmtDataBr(__ffdEstado.data || ffdHojeISO());
    const avisoReal = amb === 1
      ? '\n\nEsta emissão será transmitida para a SEFAZ em PRODUÇÃO.\nA transmissão irá gerar documento fiscal REAL na SEFAZ de PRODUÇÃO.'
      : '\n\nAmbiente de testes (homologação).';
    const ok = await ffdConfirm(
      `CONFIRMAR TRANSMISSÃO\n\nValor total: ${total}\nDocumentos: ${qtd}\nData: ${dataBr}\nAmbiente: ${ambLabel}${avisoReal}`,
      'Emitir fechamento fiscal?',
      { rotuloCancelar: 'Cancelar', rotuloConfirmar: 'Confirmar emissão' }
    );
    if (!ok) return false;
  }

  return ffdExecutarTransmissaoCore();
}

async function ffdExecutarTransmissaoCore() {
  const docs = __ffdEstado.documentos || [];
  const qtd = docs.length || (__ffdEstado.previa?.quantidade_vendas || 0);

  __ffdEstado.ops.transmitir = true;
  __ffdEstado.transmitindo = true;
  ffdAtualizarBotoesEtapa5(__ffdEstado.previa);
  const prog = document.getElementById('ffdTxProgresso');
  if (prog) {
    prog.innerHTML = `<div class="alert alert-info mb-0"><strong>Transmitindo documentos...</strong>
      <div class="small mt-2">${Array.from({ length: qtd }, (_, i) =>
        `Documento ${i + 1}/${qtd}: ${i === 0 ? '⟳ Processando' : 'Aguardando'}`
      ).join('<br>')}</div></div>`;
  }

  try {
    const id = __ffdEstado.fechamentoId;
    const resp = await fetch(`${ffdApi()}/fiscal/fechamentos/${id}/transmitir`, {
      method: 'POST', headers: ffdHeaders(), body: JSON.stringify({})
    });
    const body = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(ffdErroApi(body, `HTTP ${resp.status}`));

    __ffdEstado.documentos = body.documentos || [];
    __ffdEstado.statusFiscal = body.status;
    if (body.resumo) __ffdEstado._ultimoTxResumo = body.resumo;
    if (body.saldo) __ffdEstado.saldo = body.saldo;
    if (body.status === 'AUTORIZADO') {
      __ffdEstado.valorFechado = Number(
        (body.saldo && body.saldo.valor_principal)
        || (body.resumo && body.resumo.valor_total)
        || (__ffdEstado.previa && (__ffdEstado.previa.valor_distribuido || __ffdEstado.previa.valor_informado))
        || 0
      );
    }
    ffdRenderSaldo(body.saldo || body);
    ffdRenderResultadoTx(body);
    ffdAtualizarBotoesEtapa5(__ffdEstado.previa);
    ffdNotify(body.mensagem || 'Transmissão concluída.', body.ok ? 'success' : 'warning');
    if (body.status === 'AUTORIZADO') {
      await ffdCarregarDia({ silencioso: true });
      await ffdAbrirCupomAposAutorizacao(body);
    }
    return body;
  } catch (err) {
    ffdNotify(err.message || 'Falha na transmissão.', 'danger');
    const res = document.getElementById('ffdTxResultado');
    if (res) res.innerHTML = `<div class="alert alert-danger">${ffdEsc(err.message || 'Erro')}</div>`;
    return null;
  } finally {
    __ffdEstado.transmitindo = false;
    if (__ffdEstado.ops) __ffdEstado.ops.transmitir = false;
    ffdAtualizarBotoesEtapa5(__ffdEstado.previa);
  }
}

async function ffdRecuperarSefaz() {
  try {
    const id = __ffdEstado.fechamentoId;
    const resp = await fetch(`${ffdApi()}/fiscal/fechamentos/${id}/recuperar`, {
      method: 'POST', headers: ffdHeaders(), body: JSON.stringify({})
    });
    const body = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(body.error || `HTTP ${resp.status}`);
    __ffdEstado.documentos = body.documentos || [];
    __ffdEstado.statusFiscal = body.status;
    if (body.saldo) __ffdEstado.saldo = body.saldo;
    ffdRenderSaldo(body.saldo || body);
    ffdRenderResultadoTx(body);
    ffdAtualizarBotoesEtapa5(__ffdEstado.previa);
    ffdNotify('Recuperação concluída.', 'success');
    if (body.status === 'AUTORIZADO') {
      await ffdCarregarDia({ silencioso: true });
      await ffdAbrirCupomAposAutorizacao(body);
    }
  } catch (err) {
    ffdNotify(err.message || 'Falha na recuperação.', 'danger');
  }
}

function ffdRenderSaldo(saldoOuBody) {
  const s = saldoOuBody && (saldoOuBody.valor_principal != null || saldoOuBody.saldo)
    ? (saldoOuBody.saldo || saldoOuBody)
    : (__ffdEstado.saldo || null);
  const box = document.getElementById('ffdSaldoBox');
  const btn = document.getElementById('ffdBtnContinuarEmissao');
  const msgs = document.getElementById('ffdSaldoMsgs');
  if (!s || s.valor_principal == null) {
    if (box) box.style.display = 'none';
    if (btn) btn.style.display = 'none';
    return;
  }
  __ffdEstado.saldo = s;
  if (box) box.style.display = '';
  const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = ffdFmtMoney(v); };
  set('ffdSaldoPrincipal', s.valor_principal);
  set('ffdSaldoEmitido', s.valor_emitido_autorizado || 0);
  set('ffdSaldoPendente', s.valor_pendente_emissao != null ? s.valor_pendente_emissao : 0);
  if (msgs) {
    const linhas = s.mensagens || saldoOuBody.mensagens_saldo || [];
    const arr = Array.isArray(linhas) ? linhas : String(linhas || '').split('\n').filter(Boolean);
    msgs.innerHTML = arr.map((m) => `<div>${ffdEsc(m)}</div>`).join('');
  }
  const st = String(__ffdEstado.statusFiscal || '').toUpperCase();
  const podeContinuar = Number(s.valor_emitido_autorizado || 0) > 0
    && Number(s.valor_pendente_emissao || 0) > 0
    && st !== 'AUTORIZADO'
    && st !== 'PENDENTE_RECUPERACAO'
    && st !== 'PRONTO_EMISSAO'
    && st !== 'EMITINDO';
  if (btn) {
    btn.style.display = podeContinuar ? '' : 'none';
    btn.classList.toggle('btn-lg', podeContinuar);
  }
  // Em parcial, Emitir fechamento não é a ação principal
  if (podeContinuar || ffdEhAutorizacaoParcial(st, s)) {
    $('#ffdBtnEmitir').addClass('d-none');
  }
}

async function ffdContinuarEmissao() {
  const id = __ffdEstado.fechamentoId;
  if (!id) return;
  try {
    const resp = await fetch(`${ffdApi()}/fiscal/fechamentos/${id}/continuar-emissao`, {
      method: 'POST',
      headers: ffdHeaders(),
      body: JSON.stringify({
        valor_alvo: Number($('#ffdValorAlvo').val() || 250),
        valor_min: Number($('#ffdValorMin').val() || 8),
        valor_max: Number($('#ffdValorMax').val() || 500)
      })
    });
    const body = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(ffdErroApi(body, `HTTP ${resp.status}`));
    if (body.saldo) __ffdEstado.saldo = body.saldo;
    if (body.preparacao && body.preparacao.documentos) {
      __ffdEstado.documentos = body.preparacao.documentos;
    }
    __ffdEstado.statusFiscal = (body.preparacao && body.preparacao.status) || body.status || __ffdEstado.statusFiscal;
    ffdRenderSaldo(body.saldo || body);
    ffdAtualizarBotoesEtapa5(__ffdEstado.previa);
    ffdNotify(body.mensagem || 'Continuação preparada com o saldo restante.', 'info');
    if (body.ok && __ffdEstado.statusFiscal === 'PRONTO_EMISSAO') {
      const ok = window.confirm(
        `${body.mensagem || ''}\n\nDeseja transmitir agora o restante (R$ ${Number(body.valor_base_continuacao || 0).toFixed(2)})?`
      );
      if (ok) await ffdTransmitirSefaz({ confirmado: true });
    }
  } catch (err) {
    ffdNotify(err.message || 'Falha ao continuar emissão.', 'danger');
  }
}

function ffdRenderResultadoTx(body) {
  const prog = document.getElementById('ffdTxProgresso');
  const res = document.getElementById('ffdTxResultado');
  const docs = body.documentos || [];
  if (prog) {
    prog.innerHTML = `<div class="alert alert-secondary"><strong>Progresso</strong><div class="small mt-2">${
      docs.map((d, i) => {
        const st = d.status;
        const icon = st === 'AUTORIZADO' ? '✓' : (st === 'REJEITADO' ? '⚠' : (st === 'EMITINDO' ? '⟳' : '•'));
        return `Documento ${i + 1}/${docs.length}: ${icon} ${ffdEsc(st)}`;
      }).join('<br>')
    }</div></div>`;
  }
  if (!res) return;
  const r = body.resumo || {};
  if (body.status === 'AUTORIZADO') {
    const docsAuth = docs.filter((d) => d.status === 'AUTORIZADO');
    res.innerHTML = `<div class="alert alert-success"><strong>✓ NFC-e AUTORIZADA</strong>
      <div class="small mt-2">${r.autorizados || docsAuth.length} documentos autorizados · Total ${ffdFmtMoney(r.valor_total || __ffdEstado.previa?.valor_distribuido)}</div>
      <ul class="small mb-2 mt-2">${docsAuth.map((d) =>
        `<li>Número: <strong>${ffdEsc(d.numero || d.numero_provisorio)}</strong>
         · Série: <strong>${ffdEsc(d.serie || '1')}</strong><br>
         Chave: ${ffdEsc(d.chave_acesso || '—')}<br>
         Protocolo: ${ffdEsc(d.protocolo || '—')}</li>`
      ).join('')}</ul>
      <button type="button" class="btn btn-sm btn-outline-success" id="ffdBtnReabrirCupom">Abrir Cupom Fiscal</button>
      <div class="small text-muted mt-2">Também disponível em Fiscal → NFC-e Emitidas.</div></div>`;
    const btn = document.getElementById('ffdBtnReabrirCupom');
    if (btn) btn.addEventListener('click', () => ffdAbrirCupomAposAutorizacao(body));
  } else if (body.status === 'AUTORIZACAO_PARCIAL' || ((r.autorizados || 0) > 0 && (r.rejeitados || 0) > 0)) {
    const docsAuth = docs.filter((d) => d.status === 'AUTORIZADO');
    const docsRej = docs.filter((d) => d.status === 'REJEITADO');
    const tem539 = docsRej.some((d) => String(d.cstat) === '539')
      || (body.resultados || []).some((x) => String(x.cstat) === '539' || x.reconciliacao_539);
    const saldo = body.saldo || {};
    const emitido = saldo.valor_emitido_autorizado != null ? saldo.valor_emitido_autorizado : (r.valor_emitido_autorizado || 0);
    const pendente = saldo.valor_pendente_emissao != null ? saldo.valor_pendente_emissao : (r.valor_pendente_emissao || 0);
    const principal = saldo.valor_principal != null ? saldo.valor_principal : (r.valor_principal || __ffdEstado.previa?.valor_informado || 0);
    const alerta539 = tem539
      ? `<div class="alert alert-info mb-2 py-2"><strong>Reconciliação CStat 539</strong><br>
         Foi identificada uma numeração já existente na SEFAZ.
         O sistema está reconciliando o documento antes de continuar.</div>`
      : '';
    res.innerHTML = `<div class="alert alert-warning"><strong>⚠ AUTORIZAÇÃO PARCIAL</strong>
      ${alerta539}
      <div class="mt-2"><strong>Venda emitida:</strong> ${ffdFmtMoney(emitido)}</div>
      <div><strong>Valor original do fechamento:</strong> ${ffdFmtMoney(principal)}</div>
      <div><strong>Valor restante para emissão:</strong> ${ffdFmtMoney(pendente)}</div>
      <div class="small mt-2">${r.autorizados || docsAuth.length} autorizada(s) · ${r.rejeitados || docsRej.length} rejeitada(s)</div>
      <ul class="small mb-2 mt-2">${docsAuth.map((d) =>
        `<li>✓ Número: <strong>${ffdEsc(d.numero || d.numero_provisorio)}</strong>
         · Protocolo: ${ffdEsc(d.protocolo || '—')}<br>
         Chave: ${ffdEsc(d.chave_acesso || '—')} · Valor: ${ffdFmtMoney(d.valor_total)}</li>`
      ).join('')}</ul>
      <ul class="small mb-2">${docsRej.map((d) =>
        `<li>⚠ Documento ${String(d.sequencia).padStart(3, '0')} — Código: ${ffdEsc(d.cstat || '—')}<br>
         ${String(d.cstat) === '539'
           ? 'Numeração existente na SEFAZ — reconciliando antes de continuar.'
           : `Motivo: ${ffdEsc(d.xmotivo || '—')}`}</li>`
      ).join('')}</ul>
      ${docsAuth.length ? '<button type="button" class="btn btn-sm btn-outline-success" id="ffdBtnReabrirCupomParcial">Visualizar Cupom (autorizada)</button>' : ''}
      <button type="button" class="btn btn-sm btn-primary ms-1" id="ffdBtnContinuarEmissaoTx">Continuar emissão (${ffdFmtMoney(pendente)})</button>
      <div class="small text-muted mt-2">A continuação usará automaticamente o saldo restante — nunca o valor principal novamente.</div></div>`;
    const btnP = document.getElementById('ffdBtnReabrirCupomParcial');
    if (btnP) btnP.addEventListener('click', () => ffdAbrirCupomAposAutorizacao(body));
    const btnC = document.getElementById('ffdBtnContinuarEmissaoTx');
    if (btnC) btnC.addEventListener('click', () => ffdContinuarEmissao());
    ffdRenderSaldo(saldo);
  } else if ((r.rejeitados || 0) > 0) {
    const docsRej = docs.filter((d) => d.status === 'REJEITADO');
    const tem539 = docsRej.some((d) => String(d.cstat) === '539')
      || (body.resultados || []).some((x) => String(x.cstat) === '539' || x.reconciliacao_539);
    if (tem539) {
      res.innerHTML = `<div class="alert alert-info"><strong>Reconciliação CStat 539</strong>
        <div class="mt-2">Foi identificada uma numeração já existente na SEFAZ.
        O sistema está reconciliando o documento antes de continuar.</div>
        <ul class="small mb-0 mt-2">${docsRej.map((d) =>
          `<li>Documento ${String(d.sequencia).padStart(3, '0')}
           · nNF ${ffdEsc(d.numero || d.numero_provisorio || '—')}
           · ${String(d.cstat) === '539' ? 'OCUPADO_SEFAZ / reconciliando' : ffdEsc(d.xmotivo || '')}</li>`
        ).join('')}</ul>
        <div class="small text-muted mt-2">${ffdEsc(body.mensagem || '')}</div></div>`;
    } else {
      res.innerHTML = `<div class="alert alert-warning"><strong>⚠ DOCUMENTO REJEITADO / PARCIAL</strong>
        <div class="small">${r.autorizados || 0} autorizados · ${r.rejeitados || 0} rejeitados</div>
        <ul class="small mb-0 mt-2">${docsRej.map((d) =>
          `<li>Documento ${String(d.sequencia).padStart(3, '0')}<br>Código: ${ffdEsc(d.cstat || '—')}<br>Motivo: ${ffdEsc(d.xmotivo || '—')}</li>`
        ).join('')}</ul></div>`;
    }
  } else {
    res.innerHTML = `<div class="alert alert-info">${ffdEsc(body.mensagem || 'Transmissão com pendências.')}
      <div class="small">${r.autorizados || 0} autorizados · ${r.erros || 0} erros</div></div>`;
  }
}

/**
 * Sprint 08.1 — abre Cupom Fiscal/DANFE somente após AUTORIZADO.
 * Reutiliza GET /fiscal/notas/:id/danfe + impressão existente.
 */
async function ffdAbrirCupomAposAutorizacao(body) {
  const docs = (body && body.documentos) || __ffdEstado.documentos || [];
  const auth = docs.find((d) => d.status === 'AUTORIZADO' && (d.historico_nfce?.nfce_id || d.chave_acesso));
  if (!auth) return;

  const cStat = String(auth.cstat || '');
  if (cStat && cStat !== '100' && cStat !== '150') return;
  if (!auth.chave_acesso || !(auth.numero || auth.numero_provisorio) || !auth.protocolo) {
    ffdNotify('NFC-e autorizada sem dados completos para o cupom.', 'warning');
    return;
  }

  let nfceId = auth.historico_nfce && auth.historico_nfce.nfce_id;
  if (!nfceId) {
    try {
      const respLista = await fetch(`${ffdApi()}/fiscal/notas?todas=1`, { headers: ffdHeaders() });
      const lista = await respLista.json().catch(() => []);
      const hit = Array.isArray(lista)
        ? lista.find((n) => n.chave_acesso === auth.chave_acesso)
        : null;
      nfceId = hit && hit.id;
    } catch (_) { /* ignore */ }
  }
  if (!nfceId) {
    ffdNotify('Cupom fiscal ainda não disponível no histórico oficial.', 'warning');
    return;
  }

  try {
    const resp = await fetch(`${ffdApi()}/fiscal/notas/${nfceId}/danfe?pacote=1`, { headers: ffdHeaders() });
    const pacote = await resp.json().catch(() => ({}));
    if (!resp.ok || !pacote.html) {
      throw new Error(pacote.error || `HTTP ${resp.status}`);
    }
    const notaMeta = pacote.nota || {};
    const htmlOficial = /danfe-termico/.test(String(pacote.htmlTermico || ''))
      ? pacote.htmlTermico
      : (/danfe-termico/.test(String(pacote.html || '')) ? pacote.html : '');
    if (!htmlOficial) {
      throw new Error('Cupom NFC-e oficial indisponível.');
    }
    __ffdEstado.ultimoCupom = {
      nfceId,
      html: htmlOficial,
      htmlTermico: htmlOficial,
      meta: {
        numero: notaMeta.numero || auth.numero || auth.numero_provisorio,
        serie: notaMeta.serie || auth.serie || '1',
        chave: notaMeta.chave_acesso || auth.chave_acesso,
        protocolo: notaMeta.protocolo || auth.protocolo,
        valor: notaMeta.valor_total
          || auth.valor_total
          || auth.valor_documento
          || __ffdEstado.previa?.valor_distribuido
      }
    };
    ffdMostrarModalCupomFiscal(__ffdEstado.ultimoCupom);
  } catch (err) {
    ffdNotify(err.message || 'Falha ao abrir cupom fiscal.', 'danger');
  }
}

function ffdMostrarModalCupomFiscal(cupom) {
  if (!cupom || !cupom.html) return;
  ffdRemoverModal('ffdCupomFiscalModal');
  const meta = cupom.meta || {};
  const html = `
    <div class="modal fade" id="ffdCupomFiscalModal" tabindex="-1" aria-hidden="true">
      <div class="modal-dialog modal-lg modal-dialog-scrollable modal-dialog-centered">
        <div class="modal-content">
          <div class="modal-header bg-success text-white">
            <h5 class="modal-title">Cupom Fiscal — NFC-e Autorizada</h5>
            <button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal" aria-label="Fechar"></button>
          </div>
          <div class="modal-body">
            <div class="row g-2 small mb-3">
              <div class="col-md-3"><div class="text-muted">Número</div><strong>${ffdEsc(meta.numero)}</strong></div>
              <div class="col-md-3"><div class="text-muted">Série</div><strong>${ffdEsc(meta.serie)}</strong></div>
              <div class="col-md-3"><div class="text-muted">Protocolo</div><strong>${ffdEsc(meta.protocolo)}</strong></div>
              <div class="col-md-3"><div class="text-muted">Valor</div><strong>${ffdFmtMoney(meta.valor)}</strong></div>
            </div>
            <div class="small mb-2" style="word-break:break-all"><span class="text-muted">Chave:</span> ${ffdEsc(meta.chave)}</div>
            <div class="border rounded bg-white p-2" style="max-height:55vh;overflow:auto">
              <iframe id="ffdCupomFrame" title="DANFE NFC-e" style="width:100%;min-height:420px;border:0"></iframe>
            </div>
          </div>
          <div class="modal-footer">
            <button type="button" class="btn btn-outline-secondary" data-bs-dismiss="modal" id="ffdCupomFechar">Fechar</button>
            <button type="button" class="btn btn-outline-primary" id="ffdCupomAmpliar">Visualizar / Ampliar</button>
            <button type="button" class="btn btn-primary" id="ffdCupomImprimir">Imprimir cupom</button>
          </div>
        </div>
      </div>
    </div>`;
  const host = document.getElementById('modal-container') || document.body;
  host.insertAdjacentHTML('beforeend', html);
  const el = document.getElementById('ffdCupomFiscalModal');
  const frame = document.getElementById('ffdCupomFrame');
  if (frame) {
    const doc = frame.contentDocument || frame.contentWindow.document;
    doc.open();
    doc.write((cupom && cupom.htmlTermico) || '');
    doc.close();
  }
  const modal = new bootstrap.Modal(el, { backdrop: 'static', keyboard: true });
  ffdPrepararModalAcessivel(el, document.activeElement);
  el.querySelector('#ffdCupomImprimir').addEventListener('click', () => {
    ffdImprimirCupomFiscal(cupom);
  });
  el.querySelector('#ffdCupomAmpliar').addEventListener('click', () => {
    ffdAmpliarCupomFiscal(cupom);
  });
  el.addEventListener('hidden.bs.modal', () => {
    ffdRemoverModal('ffdCupomFiscalModal');
  }, { once: true });
  modal.show();
}

function ffdAmpliarCupomFiscal(cupom) {
  const html = (cupom && cupom.htmlTermico) || '';
  if (!html) return;
  if (typeof imprimirHtmlFiscal === 'function') {
    // abre em janela (sem print automático se usuário só quer visualizar)
    const win = window.open('', '_blank', 'width=420,height=800');
    if (!win) {
      ffdNotify('Permita popups para visualizar o cupom.', 'warning');
      return;
    }
    win.document.open();
    win.document.write(html);
    win.document.close();
    win.focus();
    return;
  }
  ffdNotify('Visualização indisponível neste ambiente.', 'warning');
}

function ffdImprimirCupomFiscal(cupom) {
  const html = (cupom && cupom.htmlTermico) || '';
  if (!html) return;
  // Reutiliza o mesmo mecanismo de impressão do módulo fiscal.
  if (typeof imprimirHtmlFiscal === 'function') {
    imprimirHtmlFiscal(html);
    return;
  }
  if (window.electronAPI && typeof window.electronAPI.abrirComprovante === 'function') {
    window.electronAPI.abrirComprovante(html, { silent: false });
    return;
  }
  const win = window.open('', '_blank', 'width=420,height=800');
  if (!win) {
    ffdNotify('Permita popups para imprimir o cupom.', 'warning');
    return;
  }
  win.document.open();
  win.document.write(html);
  win.document.close();
  win.focus();
  setTimeout(() => {
    try { win.print(); } catch (_) { /* ignore */ }
  }, 400);
}

function ffdRenderChecklist(checklist, erros) {
  const el = document.getElementById('ffdChecklistTecnico') || document.getElementById('ffdChecklist');
  const errEl = document.getElementById('ffdErrosValidacao');
  if (el && el.id === 'ffdChecklistTecnico') {
    if (!checklist || !checklist.length) {
      el.innerHTML = '';
    } else {
      el.innerHTML = `<div class="fw-semibold">Checklist técnico</div><ul class="list-unstyled mb-0">${checklist.map((c) =>
        `<li>${c.ok ? '✓' : '⚠'} ${ffdEsc(c.label)}</li>`
      ).join('')}</ul>`;
    }
  }
  if (errEl) {
    if (erros && erros.length) {
      errEl.innerHTML = `<div class="alert alert-warning"><strong>Não é possível emitir ainda.</strong><pre class="mb-0 small mt-2" style="white-space:pre-wrap">${ffdEsc(
        erros.map((e, i) => e.produto_nome
          ? `${i + 1}. Produto "${e.produto_nome}"\n   ${e.mensagem}`
          : `${i + 1}. ${e.mensagem}`
        ).join('\n\n')
      )}</pre></div>`;
    } else if (__ffdEstado.statusFiscal === 'PRONTO_EMISSAO') {
      errEl.innerHTML = `<div class="alert alert-success mb-0"><strong>✓ Documento pronto para emissão</strong>
        <div class="small">${(__ffdEstado.documentos || []).length} documentos fiscais preparados · Total ${ffdFmtMoney(__ffdEstado.previa?.valor_distribuido)}</div></div>`;
    } else {
      errEl.innerHTML = '';
    }
  }
  ffdRenderPainelEmissao();
}

function ffdBloqueioAvanco(acao) {
  if (!ffdRecebimentosConciliados()) {
    const dif = ffdFmtMoney(Math.abs(ffdDiferencaConciliacao()));
    return `Não é possível ${acao}: diferença de ${dif} entre valor da composição e recebimentos.`;
  }
  if (!ffdPreviaValida()) {
    return `Não é possível ${acao}: atualize a prévia e aguarde uma composição válida (sem diferença).`;
  }
  return null;
}

/** Extrai motivos reais de erros de validação/API para o operador. */
function ffdMotivoRealErro(body, fallback) {
  const erros = body?.validacao?.erros || body?.erros || [];
  if (Array.isArray(erros) && erros.length) {
    return erros.map((e) => {
      if (e.produto_nome && e.mensagem) return `Produto ${e.produto_nome} — ${e.mensagem}`;
      return e.mensagem || String(e);
    }).join('\n');
  }
  return ffdErroApi(body, fallback || 'Falha na operação.');
}

async function ffdExecutarValidacaoCore() {
  const bloqueio = ffdBloqueioAvanco('validar');
  if (bloqueio) return { ok: false, erro: bloqueio, body: null };
  const id = await ffdGarantirRascunho();
  $('#ffdValStatus').text('VALIDANDO...');
  const resp = await fetch(`${ffdApi()}/fiscal/fechamentos/${id}/validar`, {
    method: 'POST', headers: ffdHeaders(), body: JSON.stringify({})
  });
  const body = await resp.json().catch(() => ({}));
  if (!resp.ok && !body.validacao) {
    return { ok: false, erro: ffdMotivoRealErro(body, `HTTP ${resp.status}`), body };
  }
  __ffdEstado.validacao = body.validacao || body;
  ffdRenderChecklist(body.validacao?.checklist || body.checklist, body.validacao?.erros || body.erros);
  const ok = Boolean(body.ok || body.validacao?.ok);
  if (ok) {
    $('#ffdValStatus').text('VALIDADO');
    return { ok: true, body, erro: null };
  }
  $('#ffdValStatus').text('ERRO');
  $('#ffdBtnCorrigir').prop('disabled', false);
  return {
    ok: false,
    body,
    erro: ffdMotivoRealErro(body, 'Pendências fiscais encontradas.')
  };
}

async function ffdExecutarPreparacaoCore() {
  const bloqueio = ffdBloqueioAvanco('preparar para emissão');
  if (bloqueio) return { ok: false, erro: bloqueio, body: null };
  if (!(__ffdEstado.validacao && __ffdEstado.validacao.ok) && __ffdEstado.statusFiscal !== 'PRONTO_EMISSAO') {
    return { ok: false, erro: 'Validação fiscal necessária antes da preparação.', body: null };
  }
  const id = await ffdGarantirRascunho();
  $('#ffdValStatus').text('PREPARANDO...');
  const resp = await fetch(`${ffdApi()}/fiscal/fechamentos/${id}/preparar-emissao`, {
    method: 'POST',
    headers: ffdHeaders(),
    body: JSON.stringify({ gerarXml: true })
  });
  const body = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    __ffdEstado.validacao = body.validacao || null;
    ffdRenderChecklist(body.checklist || body.validacao?.checklist, body.erros || body.validacao?.erros);
    return {
      ok: false,
      body,
      erro: ffdMotivoRealErro(body, `Não foi possível preparar o fechamento. HTTP ${resp.status}`)
    };
  }
  __ffdEstado.documentos = body.documentos || [];
  __ffdEstado.validacao = body.validacao || null;
  __ffdEstado.statusFiscal = body.status || 'PRONTO_EMISSAO';
  ffdRenderChecklist(body.validacao?.checklist, body.validacao?.erros);
  ffdAtualizarBotoesEtapa5(__ffdEstado.previa);
  $('#ffdValAmbiente').text(Number(body.ambiente) === 1 ? 'Produção' : 'Homologação');
  $('#ffdValDocs').text(String((__ffdEstado.documentos || []).length));
  $('#ffdValStatus').text(__ffdEstado.statusFiscal);
  return { ok: true, body, erro: null };
}

async function ffdConfirmarEmissaoModal() {
  const docs = __ffdEstado.documentos || [];
  const qtd = docs.length || (__ffdEstado.previa?.quantidade_vendas || 0);
  const total = ffdFmtMoney(__ffdEstado.previa?.valor_distribuido || __ffdEstado.previa?.valor_informado);
  const amb = Number(__ffdEstado.ambiente);
  const ambLabel = amb === 1 ? 'PRODUÇÃO' : (amb === 2 ? 'HOMOLOGAÇÃO' : '—');
  const dataBr = ffdFmtDataBr(__ffdEstado.data || ffdHojeISO());
  const aviso = amb === 1
    ? '\n\nEsta emissão será transmitida para a SEFAZ em PRODUÇÃO.\nA transmissão irá gerar documento fiscal REAL na SEFAZ de PRODUÇÃO.'
    : '\n\nAmbiente de testes (homologação).';
  return ffdConfirm(
    `CONFIRMAR TRANSMISSÃO\n\nValor total: ${total}\nDocumentos: ${qtd}\nData: ${dataBr}\nAmbiente: ${ambLabel}${aviso}`,
    'Emitir fechamento fiscal?',
    { rotuloCancelar: 'Cancelar', rotuloConfirmar: 'Confirmar emissão' }
  );
}

/**
 * Sprint 07.9 — ação principal: orquestra validar → preparar/XML → confirmar → transmitir.
 * Não transmite sem confirmação explícita do operador.
 */
async function ffdEmitirFechamento() {
  return ffdComLock('emitir', '#ffdBtnEmitir', 'Preparando emissão…', async () => {
    // Fechamento legado/parcial → redireciona para CONTINUAR EMISSÃO (nunca reemite o principal)
    if (ffdEhAutorizacaoParcial()) {
      ffdNotify(
        'Fechamento em AUTORIZAÇÃO PARCIAL. Use Continuar emissão para o saldo restante — não é possível reemitir o valor principal.',
        'warning'
      );
      ffdRenderSaldo(__ffdEstado.saldo);
      return ffdContinuarEmissao();
    }
    const bloqueio = ffdBloqueioAvanco('emitir o fechamento');
    if (bloqueio) {
      ffdNotify(bloqueio, 'warning');
      ffdRenderPainelEmissao();
      return null;
    }
    if (!__ffdEstado.transmissaoHabilitada) {
      const motivos = ffdMotivosBloqueioEmissao();
      ffdNotify(motivos[0] || 'Configuração fiscal incompleta.', 'warning');
      ffdRenderPainelEmissao();
      return null;
    }
    if (__ffdEstado.statusFiscal === 'AUTORIZADO') {
      ffdNotify('Fechamento já autorizado.', 'info');
      return null;
    }

    try {
      const jaPronto = __ffdEstado.statusFiscal === 'PRONTO_EMISSAO'
        || __ffdEstado.statusFiscal === 'EMITINDO';

      if (!jaPronto) {
        $('#ffdBtnEmitir').text('Validando…');
        const val = await ffdExecutarValidacaoCore();
        if (!val.ok) {
          ffdNotify(val.erro || 'Não é possível emitir ainda.', 'warning');
          ffdRenderPainelEmissao();
          return null;
        }

        $('#ffdBtnEmitir').text('Gerando XML…');
        const prep = await ffdExecutarPreparacaoCore();
        if (!prep.ok) {
          ffdNotify(prep.erro || 'Não é possível emitir ainda.', 'warning');
          ffdRenderPainelEmissao();
          return null;
        }
      }

      $('#ffdBtnEmitir').text('Emitir fechamento');
      const confirmado = await ffdConfirmarEmissaoModal();
      if (!confirmado) {
        ffdNotify('Emissão cancelada. Nenhuma transmissão foi enviada.', 'info');
        return null;
      }

      $('#ffdBtnEmitir').text('Transmitindo…');
      return await ffdTransmitirSefaz({ confirmado: true });
    } catch (err) {
      ffdNotify(err.message || 'Falha ao emitir o fechamento.', 'danger');
      ffdRenderPainelEmissao();
      return null;
    }
  });
}

async function ffdValidarFiscal() {
  return ffdComLock('validar', '#ffdBtnValidar', 'Validando…', async () => {
    try {
      const r = await ffdExecutarValidacaoCore();
      if (r.ok) ffdNotify(r.body?.mensagem_usuario || 'Validação fiscal OK.', 'success');
      else ffdNotify(r.erro || 'Pendências fiscais encontradas.', 'warning');
      ffdRenderPainelEmissao();
      return r;
    } catch (err) {
      ffdNotify(err.message || 'Falha na validação fiscal.', 'danger');
      $('#ffdValStatus').text('ERRO');
      return { ok: false, erro: err.message };
    }
  });
}

async function ffdPrepararEmissao() {
  return ffdComLock('preparar', '#ffdBtnPreparar', 'Preparando…', async () => {
    try {
      if (!(__ffdEstado.validacao && __ffdEstado.validacao.ok) && __ffdEstado.statusFiscal !== 'PRONTO_EMISSAO') {
        const val = await ffdExecutarValidacaoCore();
        if (!val.ok) {
          ffdNotify(val.erro || 'Execute a validação fiscal antes de preparar para emissão.', 'warning');
          return val;
        }
      }
      const r = await ffdExecutarPreparacaoCore();
      if (r.ok) ffdNotify(r.body?.mensagem || 'Documento pronto para emissão.', 'success');
      else ffdNotify(r.erro || 'Não foi possível preparar o fechamento.', 'danger');
      ffdRenderPainelEmissao();
      return r;
    } catch (err) {
      ffdNotify(err.message || 'Não foi possível preparar o fechamento.', 'danger');
      $('#ffdValStatus').text('ERRO');
      return { ok: false, erro: err.message };
    }
  });
}

function ffdToggleXml() {
  const box = document.getElementById('ffdXmlPreview');
  const ta = document.getElementById('ffdXmlText');
  if (!box || !ta) return;
  const doc = (__ffdEstado.documentos || []).find((d) => d.xml_preparado);
  if (!doc) {
    ffdNotify('Nenhum XML preparado ainda.', 'warning');
    return;
  }
  ta.value = doc.xml_preparado;
  box.classList.toggle('d-none');
}

function ffdCorrigirPendencias() {
  ffdNotify('Corrija NCM/CFOP/CSOSN no cadastro do produto e execute novamente a validação. O fechamento não altera o cadastro automaticamente.', 'info');
}

async function ffdGarantirRascunho() {
  if (__ffdEstado.fechamentoId) return __ffdEstado.fechamentoId;
  const data = String($('#ffdData').val() || ffdHojeISO());
  const resp = await fetch(`${ffdApi()}/fiscal/fechamentos`, {
    method: 'POST',
    headers: ffdHeaders(),
    body: JSON.stringify({
      data_fechamento: data,
      data,
      valor_alvo: Number($('#ffdValorAlvo').val() || 250),
      valor_min: Number($('#ffdValorMin').val() || 8),
      valor_max: Number($('#ffdValorMax').val() || 400),
      distribuicao_automatica: $('#ffdAuto').is(':checked')
    })
  });
  const body = await resp.json().catch(() => ({}));
  if (resp.status === 409 && body.fechamento) {
    __ffdEstado.fechamentoId = body.fechamento.id;
    ffdNotify(body.error || 'Já existe um fechamento fiscal para esta data.', 'warning');
    return __ffdEstado.fechamentoId;
  }
  if (!resp.ok) throw new Error(ffdErroApi(body, `HTTP ${resp.status}`));
  __ffdEstado.fechamentoId = body.id;
  return body.id;
}

async function ffdSincronizarRecebimentos(fechamentoId) {
  const porComprovante = __ffdEstado.modoRecebimento === 'por_comprovante';
  const lista = (__ffdEstado.recebimentos || []).map((r) => ({
    operadora: r.operadora,
    cnpj: r.cnpj || '',
    valor: Number(r.valor)
  }));
  const endpoint = porComprovante
    ? `${ffdApi()}/fiscal/fechamentos/${fechamentoId}/recebimentos-comprovantes`
    : `${ffdApi()}/fiscal/fechamentos/${fechamentoId}/recebimentos`;
  const payload = porComprovante
    ? { comprovantes: lista.map((r) => Number(r.valor)).filter((valor) => Number.isFinite(valor) && valor > 0) }
    : { recebimentos: lista };

  const resp = await fetch(endpoint, {
    method: 'PUT',
    headers: ffdHeaders(),
    body: JSON.stringify(payload)
  });
  const body = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(ffdErroApi(body, 'Falha ao salvar recebimentos'));
  if (porComprovante) {
    __ffdEstado.recebimentos = (body.comprovantes || []).map((r, idx) => ({
      id: r.id,
      operadora: r.operadora || `Comprovante ${idx + 1}`,
      cnpj: '',
      valor: Number(r.valor || 0)
    }));
    return;
  }
  __ffdEstado.recebimentos = (body.recebimentos || []).map((r) => ({
    id: r.id, operadora: r.operadora, cnpj: r.cnpj, valor: Number(r.valor)
  }));
}

async function ffdSalvarRascunho() {
  return ffdComLock('salvar', '#ffdBtnSalvarRascunho', 'Salvando…', async () => {
    try {
      const id = await ffdGarantirRascunho();
      if (__ffdEstado.modoRecebimento !== 'por_venda') {
        await ffdSincronizarRecebimentos(id);
      }
      ffdNotify('Rascunho salvo.', 'success');
      await ffdCarregarDia();
    } catch (err) {
      ffdNotify(err.message || 'Falha ao salvar rascunho.', 'danger');
    }
  });
}

async function ffdAtualizarPrevia() {
  return ffdComLock('previa', '#ffdBtnAtualizarPrevia', 'Atualizando prévia…', async () => {
    const inicioClique = ffdPreviaClickAt || performance.now();
    ffdPreviaClickAt = null;
    const tentativa = ++ffdPreviaAttemptCounter;
    try {
      const porVenda = __ffdEstado.modoRecebimento === 'por_venda';
      if (porVenda && !ffdComprovantesPorVendaValidos()) {
        ffdNotify('Aguarde o carregamento das vendas e corrija os valores inválidos antes de conciliar.', 'warning');
        return;
      }
      const total = Math.round(ffdTotalRecebimentos() * 100) / 100;
      if (!(total > 0) && !porVenda) {
        ffdRenderPrevia({
          vendas: [],
          valor_informado: 0,
          valor_distribuido: 0,
          diferenca: 0,
          quantidade_vendas: 0,
          perfeita: false,
          incompleta: false,
          codigo: 'VALOR_ZERO',
          mensagem: 'Informe um valor recebido nas máquinas para gerar a prévia.'
        });
        return;
      }
      const data = String($('#ffdData').val() || __ffdEstado.data || ffdHojeISO());
      const id = await ffdGarantirRascunho();
      const inicioSincronizacao = performance.now();
      try {
        if (porVenda) {
          const comprovantesSalvos = await ffdSalvarComprovantes({ silencioso: true });
          if (!comprovantesSalvos) return;
        } else {
          await ffdSincronizarRecebimentos(id);
        }
      } finally {
        ffdLogDesenvolvimento('PREVIA RECEBIMENTOS SINCRONIZADOS', {
          elapsed_ms: Number((performance.now() - inicioSincronizacao).toFixed(1)),
          modo: __ffdEstado.modoRecebimento
        });
      }

      const comprovantesParaPrevia = __ffdEstado.modoRecebimento === 'por_comprovante'
        ? (__ffdEstado.recebimentos || []).map((item) => Number(item.valor || 0)).filter((valor) => Number.isFinite(valor) && valor > 0)
        : [];

      const payloadPrevia = {
        data,
        data_fechamento: data,
        valor_informado: total,
        valor_alvo: Number($('#ffdValorAlvo').val() || 250),
        valor_min: Number($('#ffdValorMin').val() || 8),
        valor_max: Number($('#ffdValorMax').val() || 400),
        distribuicao_automatica: $('#ffdAuto').is(':checked'),
        modo: __ffdEstado.vista || 'venda',
        ...( __ffdEstado.modoRecebimento === 'por_comprovante' && comprovantesParaPrevia.length ? { comprovantes: comprovantesParaPrevia } : {} )
      };
      ffdLogDesenvolvimento('PREVIA REQUEST', {
        fechamento_id: id,
        elapsed_before_request_ms: Number((performance.now() - inicioClique).toFixed(1)),
        ...payloadPrevia
      });
      const request = fetch(`${ffdApi()}/fiscal/fechamentos/${id}/previa`, {
        method: 'POST',
        headers: ffdHeaders(),
        body: JSON.stringify(payloadPrevia)
      }).then(async (resp) => {
        const body = await resp.json().catch(() => ({}));
        if (!resp.ok) throw new Error(ffdErroApi(body, `HTTP ${resp.status}`));
        return body;
      });
      const processarResposta = (body) => {
        __ffdEstado.indicadores = body.indicadores;
        if (body.fechamento && body.fechamento.status) {
          __ffdEstado.statusFiscal = body.fechamento.status;
        }
        if (!body.previa) {
          throw new Error('A API não retornou a prévia. Tente novamente.');
        }
        __ffdEstado.complementacao = body.complementacao || (body.fechamento && body.fechamento.complementacao) || null;
        ffdRenderComplementacao(__ffdEstado.complementacao);
        ffdRenderPrevia(body.previa);
        ffdLogDesenvolvimento('PREVIA RENDERIZADA', {
          elapsed_ms: Number((performance.now() - inicioClique).toFixed(1)),
          tentativa
        });
        if (body.previa.perfeita) {
          ffdNotify('Prévia atualizada — distribuição concluída. Conciliação não substitui a validação fiscal.', 'success');
        } else {
          ffdNotify(body.previa.mensagem || 'Prévia atualizada com pendência de distribuição.', 'warning');
        }
      };

      let timeoutId;
      try {
        const timeout = new Promise((_, reject) => {
          timeoutId = setTimeout(() => {
            const err = new Error(
              'A prévia ainda pode estar sendo processada no servidor. A interface liberou a tela; repetir o mesmo pedido não inicia uma segunda geração.'
            );
            err.code = 'PREVIA_FRONTEND_TIMEOUT';
            reject(err);
          }, FFD_PREVIA_TIMEOUT_MS);
        });
        const body = await Promise.race([request, timeout]);
        ffdLogDesenvolvimento('PREVIA RESPONSE', {
          elapsed_ms: Number((performance.now() - inicioClique).toFixed(1)),
          tentativa
        });
        processarResposta(body);
      } catch (err) {
        if (err.code === 'PREVIA_FRONTEND_TIMEOUT') {
          request.then((body) => {
            if (tentativa !== ffdPreviaAttemptCounter) return;
            processarResposta(body);
            ffdNotify('A prévia terminou após o limite de espera da interface.', 'info');
          }).catch((erroTardio) => {
            if (tentativa === ffdPreviaAttemptCounter) {
              ffdNotify(erroTardio.message || 'Falha tardia ao gerar a prévia.', 'danger');
            }
          });
        }
        throw err;
      } finally {
        clearTimeout(timeoutId);
      }
    } catch (err) {
      ffdNotify(err.message || 'Falha ao atualizar prévia.', 'danger');
    }
  });
}

async function ffdCancelar() {
  if (!__ffdEstado.fechamentoId) {
    ffdNotify('Nenhum fechamento para cancelar.', 'info');
    return;
  }
  const ok = await ffdConfirm('Cancelar o fechamento fiscal desta data?');
  if (!ok) return;
  try {
    const resp = await fetch(`${ffdApi()}/fiscal/fechamentos/${__ffdEstado.fechamentoId}/cancelar`, {
      method: 'POST', headers: ffdHeaders()
    });
    const body = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(body.error || `HTTP ${resp.status}`);
    __ffdEstado.fechamentoId = null;
    __ffdEstado.recebimentos = [];
    __ffdEstado.recebimentosLocais = false;
    __ffdEstado.previa = null;
    ffdRenderMaquinas();
    ffdRenderPrevia(null);
    document.getElementById('ffdPreviaConteudo').innerHTML = '<span class="text-muted">Atualize a prévia para visualizar a composição.</span>';
    ffdNotify('Fechamento cancelado.', 'success');
  } catch (err) {
    ffdNotify(err.message || 'Falha ao cancelar.', 'danger');
  }
}

async function ffdLimparTudoDoDia() {
  return ffdComLock('limpar', '#ffdBtnLimparTudo', 'Limpando…', async () => {
    const data = String($('#ffdData').val() || __ffdEstado.data || ffdHojeISO());
    const confirmado = await ffdConfirm(
      `Isso remove prévias, recebimentos e documentos fiscais ainda não autorizados de ${data}, desde que não exista tentativa de transmissão.\n\n` +
      'Fechamentos autorizados, tentativas de transmissão, vendas originais e saldo fiscal dos produtos serão preservados. Deseja continuar?',
      'Limpar dados fiscais do dia',
      { rotuloConfirmar: 'Limpar tudo', rotuloCancelar: 'Manter dados' }
    );
    if (!confirmado) return;

    try {
      const resp = await fetch(`${ffdApi()}/fiscal/fechamentos/limpar-dia`, {
        method: 'POST',
        headers: ffdHeaders(),
        body: JSON.stringify({ data })
      });
      const body = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(ffdErroApi(body, `HTTP ${resp.status}`));

      __ffdEstado.fechamentoId = null;
      __ffdEstado.statusFiscal = null;
      __ffdEstado.previa = null;
      __ffdEstado.indicadores = null;
      __ffdEstado.complementacao = null;
      __ffdEstado.recebimentos = [];
      __ffdEstado.recebimentosLocais = false;
      __ffdEstado.saldo = null;
      __ffdEstado.documentos = [];
      __ffdEstado.validacao = null;
      ffdRenderMaquinas();
      ffdRenderPrevia(null);
      ffdRenderSaldo(null);
      ffdRenderComplementacao(null);
      const conteudo = document.getElementById('ffdPreviaConteudo');
      if (conteudo) conteudo.innerHTML = '<span class="text-muted">Atualize a prévia para visualizar a composição.</span>';
      await ffdCarregarDia();

      const protegidos = Number(body.fechamentos_preservados || 0);
      ffdNotify(
        `${body.fechamentos_limpos || 0} rascunho(s)/prévia(s) limpo(s).` +
        (protegidos ? ` ${protegidos} fechamento(s) com autorização, processamento ou histórico de transmissão foram preservados.` : ''),
        'success'
      );
    } catch (err) {
      ffdNotify(err.message || 'Falha ao limpar os dados fiscais do dia.', 'danger');
    }
  });
}

window.loadFechamentoFiscalDoDia = loadFechamentoFiscalDoDia;
window.ffdPararPolling = ffdPararPolling;
window.ffdBlurSeDentro = ffdBlurSeDentro;
window.ffdFocoSeguro = ffdFocoSeguro;
window.ffdPrepararModalAcessivel = ffdPrepararModalAcessivel;
window.ffdErroApi = ffdErroApi;
window.ffdComLock = ffdComLock;
