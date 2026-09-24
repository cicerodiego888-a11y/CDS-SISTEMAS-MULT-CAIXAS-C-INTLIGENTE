/**
 * CupomPrintPolicy — pergunta, vias e envio à impressora.
 * Não altera venda, pagamento, NFC-e nem motores.
 */
(function (global) {
  'use strict';

  const MODOS = {
    PERGUNTAR: 'PERGUNTAR',
    AUTOMATICO: 'AUTOMATICO',
    NAO_IMPRIMIR: 'NAO_IMPRIMIR'
  };
  const DESTINOS = {
    CLIENTE: 'CLIENTE',
    ESTABELECIMENTO: 'ESTABELECIMENTO',
    COPIA: 'COPIA'
  };
  const ESTADOS = {
    AGUARDANDO_DECISAO: 'AGUARDANDO_DECISAO',
    IMPRIMINDO: 'IMPRIMINDO',
    IMPRESSO: 'IMPRESSO',
    ERRO_IMPRESSAO: 'ERRO_IMPRESSAO',
    NAO_IMPRIMIR: 'NAO_IMPRIMIR'
  };
  const MAX_VIAS = 4;

  let cachePolitica = null;
  let impressaoEmAndamento = false;
  let estadoAtual = ESTADOS.AGUARDANDO_DECISAO;

  function padraoBloco() {
    return { modo: MODOS.PERGUNTAR, vias: 2, destinos: [DESTINOS.CLIENTE, DESTINOS.ESTABELECIMENTO] };
  }

  function normalizarModo(valor, fallback) {
    const v = String(valor || '').trim().toUpperCase();
    if (v === MODOS.PERGUNTAR || v === 'ASK') return MODOS.PERGUNTAR;
    if (v === MODOS.AUTOMATICO || v === 'AUTO') return MODOS.AUTOMATICO;
    if (v === MODOS.NAO_IMPRIMIR || v === 'NUNCA' || v === 'OFF') return MODOS.NAO_IMPRIMIR;
    return fallback || MODOS.PERGUNTAR;
  }

  function normalizarDestino(valor, indice) {
    const v = String(valor || '').trim().toUpperCase();
    if (v === DESTINOS.CLIENTE) return DESTINOS.CLIENTE;
    if (v === DESTINOS.ESTABELECIMENTO || v === 'MERCANTIL') return DESTINOS.ESTABELECIMENTO;
    if (v === DESTINOS.COPIA) return DESTINOS.COPIA;
    return indice === 0 ? DESTINOS.CLIENTE : (indice === 1 ? DESTINOS.ESTABELECIMENTO : DESTINOS.COPIA);
  }

  function normalizarVias(valor) {
    const n = parseInt(valor, 10);
    if (!Number.isFinite(n) || n < 1) return 2;
    return Math.min(MAX_VIAS, n);
  }

  function completarDestinos(lista, vias) {
    const base = Array.isArray(lista) ? lista.map((item, i) => normalizarDestino(item, i)) : [];
    const destinos = [];
    for (let i = 0; i < vias; i += 1) {
      destinos.push(base[i] || (i === 0 ? DESTINOS.CLIENTE : (i === 1 ? DESTINOS.ESTABELECIMENTO : DESTINOS.COPIA)));
    }
    return destinos;
  }

  function normalizar(entrada) {
    const raw = entrada && typeof entrada === 'object' ? entrada : {};
    const modo = normalizarModo(raw.modo, MODOS.PERGUNTAR);
    const bloco = (origem) => {
      const o = origem && typeof origem === 'object' ? origem : {};
      const vias = normalizarVias(o.vias);
      return { modo: normalizarModo(o.modo, modo), vias, destinos: completarDestinos(o.destinos, vias) };
    };
    return {
      modo,
      max_vias: MAX_VIAS,
      fiscal: bloco(raw.fiscal),
      nao_fiscal: bloco(raw.nao_fiscal),
      terminais: raw.terminais && typeof raw.terminais === 'object' ? raw.terminais : {},
      empresas: raw.empresas && typeof raw.empresas === 'object' ? raw.empresas : {}
    };
  }

  function rotuloVia(destino) {
    if (destino === DESTINOS.CLIENTE) return 'VIA DO CLIENTE';
    if (destino === DESTINOS.ESTABELECIMENTO) return 'VIA DO ESTABELECIMENTO';
    return 'VIA ADICIONAL';
  }

  function impressaoMasterAtiva() {
    if (typeof global.pdvImprimirCupomAtivo === 'function') {
      return global.pdvImprimirCupomAtivo() !== false;
    }
    return true;
  }

  function resolver(tipo, contexto) {
    const cfg = normalizar(cachePolitica || {});
    const fiscal = String(tipo || '').toUpperCase() === 'FISCAL';
    let bloco = fiscal ? { ...cfg.fiscal } : { ...cfg.nao_fiscal };
    const empresaId = contexto && contexto.empresa_id != null ? String(contexto.empresa_id) : '';
    const terminalId = contexto && (contexto.terminal_id != null ? contexto.terminal_id : global.terminalId);
    const tId = terminalId != null ? String(terminalId) : '';
    if (empresaId && cfg.empresas[empresaId]) Object.assign(bloco, cfg.empresas[empresaId]);
    if (tId && cfg.terminais[tId]) Object.assign(bloco, cfg.terminais[tId]);
    const vias = normalizarVias(bloco.vias);
    const destinos = completarDestinos(bloco.destinos, vias);
    const modo = !impressaoMasterAtiva() ? MODOS.NAO_IMPRIMIR : normalizarModo(bloco.modo, cfg.modo);
    return {
      tipo: fiscal ? 'FISCAL' : 'NAO_FISCAL',
      modo,
      vias,
      destinos,
      rotulos: destinos.map(rotuloVia),
      perguntar: modo === MODOS.PERGUNTAR,
      imprimir: modo !== MODOS.NAO_IMPRIMIR,
      automatico: modo === MODOS.AUTOMATICO
    };
  }

  async function carregar(forcar) {
    if (cachePolitica && !forcar) return normalizar(cachePolitica);
    try {
      const token = (typeof localStorage !== 'undefined' && localStorage.getItem('token')) || '';
      const api = typeof API_URL !== 'undefined' ? API_URL : '/api';
      const resp = await fetch(`${api}/configuracoes/cupom_impressao_politica`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: 'no-store'
      });
      const data = await resp.json().catch(() => ({}));
      cachePolitica = normalizar(data.valor || data);
    } catch (_) {
      cachePolitica = normalizar({});
    }
    return cachePolitica;
  }

  function aplicarCache(valor) {
    cachePolitica = normalizar(valor);
    return cachePolitica;
  }

  function enveloparVia(html, destino) {
    const titulo = rotuloVia(destino);
    return `<div class="cds-ui-cupom-via" style="font-family:monospace;font-size:13px;text-align:center;font-weight:700;padding:4px 0 8px;">
--------------------------------
${titulo}
--------------------------------
</div>${html || ''}`;
  }

  function removerDialogos() {
    document.querySelectorAll('.cds-ui-cupom-print-overlay').forEach((el) => el.remove());
  }

  function focarPrincipal(botao) {
    if (botao && typeof botao.focus === 'function') botao.focus();
  }

  function perguntarImpressao() {
    return new Promise((resolve) => {
      removerDialogos();
      estadoAtual = ESTADOS.AGUARDANDO_DECISAO;
      const overlay = document.createElement('div');
      overlay.className = 'cds-ui-cupom-print-overlay';
      overlay.innerHTML = `
        <div class="cds-ui-cupom-print-dialog" role="dialog" aria-modal="true" aria-labelledby="cds-cupom-print-title">
          <h3 id="cds-cupom-print-title">Você deseja imprimir o cupom?</h3>
          <p>O cupom já está disponível na tela.</p>
          <div class="cds-ui-cupom-print-actions">
            <button type="button" class="btn btn-outline-secondary" data-act="nao">Não</button>
            <button type="button" class="btn cds-ui-fc-btn-primary" data-act="sim">Sim, imprimir</button>
          </div>
        </div>
      `;
      const fechar = (valor) => {
        document.removeEventListener('keydown', onKey, true);
        overlay.remove();
        resolve(valor);
      };
      const onKey = (ev) => {
        if (ev.key === 'Escape') {
          ev.preventDefault();
          fechar(false);
        } else if (ev.key === 'Enter') {
          ev.preventDefault();
          fechar(true);
        }
      };
      overlay.querySelector('[data-act="nao"]').addEventListener('click', () => fechar(false));
      overlay.querySelector('[data-act="sim"]').addEventListener('click', () => fechar(true));
      document.addEventListener('keydown', onKey, true);
      document.body.appendChild(overlay);
      focarPrincipal(overlay.querySelector('[data-act="sim"]'));
    });
  }

  function perguntarErro(mensagem, detalhe) {
    return new Promise((resolve) => {
      removerDialogos();
      const overlay = document.createElement('div');
      overlay.className = 'cds-ui-cupom-print-overlay';
      overlay.innerHTML = `
        <div class="cds-ui-cupom-print-dialog" role="dialog" aria-modal="true">
          <h3>Não foi possível imprimir o cupom.</h3>
          <p>${detalhe || 'Verifique se a impressora está ligada e conectada.'}</p>
          ${mensagem ? `<p class="text-muted small">${mensagem}</p>` : ''}
          <div class="cds-ui-cupom-print-actions">
            <button type="button" class="btn btn-outline-secondary" data-act="nao">Cancelar</button>
            <button type="button" class="btn cds-ui-fc-btn-primary" data-act="sim">Tentar novamente</button>
          </div>
        </div>
      `;
      const fechar = (valor) => {
        document.removeEventListener('keydown', onKey, true);
        overlay.remove();
        resolve(valor);
      };
      const onKey = (ev) => {
        if (ev.key === 'Escape') { ev.preventDefault(); fechar(false); }
        else if (ev.key === 'Enter') { ev.preventDefault(); fechar(true); }
      };
      overlay.querySelector('[data-act="nao"]').addEventListener('click', () => fechar(false));
      overlay.querySelector('[data-act="sim"]').addEventListener('click', () => fechar(true));
      document.addEventListener('keydown', onKey, true);
      document.body.appendChild(overlay);
      focarPrincipal(overlay.querySelector('[data-act="sim"]'));
    });
  }

  function perguntarSemImpressora() {
    return new Promise((resolve) => {
      removerDialogos();
      const overlay = document.createElement('div');
      overlay.className = 'cds-ui-cupom-print-overlay';
      overlay.innerHTML = `
        <div class="cds-ui-cupom-print-dialog" role="dialog" aria-modal="true">
          <h3>Não há uma impressora configurada para este cupom.</h3>
          <p>O cupom continua disponível na tela.</p>
          <div class="cds-ui-cupom-print-actions">
            <button type="button" class="btn btn-outline-secondary" data-act="nao">Agora não</button>
            <button type="button" class="btn cds-ui-fc-btn-primary" data-act="sim">Configurar impressora</button>
          </div>
        </div>
      `;
      const fechar = (valor) => {
        document.removeEventListener('keydown', onKey, true);
        overlay.remove();
        resolve(valor);
      };
      const onKey = (ev) => {
        if (ev.key === 'Escape') { ev.preventDefault(); fechar(false); }
        else if (ev.key === 'Enter') { ev.preventDefault(); fechar(true); }
      };
      overlay.querySelector('[data-act="nao"]').addEventListener('click', () => fechar(false));
      overlay.querySelector('[data-act="sim"]').addEventListener('click', () => fechar(true));
      document.addEventListener('keydown', onKey, true);
      document.body.appendChild(overlay);
      focarPrincipal(overlay.querySelector('[data-act="sim"]'));
    });
  }

  function marcarImprimindo(ativo) {
    impressaoEmAndamento = !!ativo;
    const btn = document.querySelector('.cds-ui-cupom-print-dialog [data-act="sim"]');
    if (btn) {
      btn.disabled = !!ativo;
      btn.textContent = ativo ? 'Imprimindo...' : 'Sim, imprimir';
    }
  }

  async function obterImpressora() {
    if (typeof global.obterDeviceNameImpressoraCupom === 'function') {
      return global.obterDeviceNameImpressoraCupom();
    }
    return null;
  }

  async function imprimirUmaVia(html, deviceName) {
    if (global.electronAPI && typeof global.electronAPI.imprimirDANFESilencioso === 'function') {
      const r = await global.electronAPI.imprimirDANFESilencioso(html, deviceName);
      if (r && r.sucesso === false) {
        const err = new Error(r.motivo === 'sem-impressora-termica'
          ? 'sem-impressora'
          : (r.motivo || 'Falha na impressão'));
        err.codigo = r.motivo;
        throw err;
      }
      return r || { sucesso: true };
    }
    const janela = window.open('', '_blank', 'width=420,height=720');
    if (!janela) throw new Error('popup');
    janela.document.open();
    janela.document.write(html);
    janela.document.close();
    janela.focus();
    janela.print();
    return { sucesso: true };
  }

  async function imprimirVias(html, decisao) {
    const deviceName = await obterImpressora();
    if (!deviceName && global.electronAPI) {
      const configurar = await perguntarSemImpressora();
      if (configurar && typeof global.configurarImpressoraCupom === 'function') {
        await global.configurarImpressoraCupom();
      }
      estadoAtual = ESTADOS.ERRO_IMPRESSAO;
      return { ok: false, motivo: 'sem-impressora', impressas: 0 };
    }
    const destinos = decisao.destinos || [DESTINOS.CLIENTE, DESTINOS.ESTABELECIMENTO];
    let impressas = 0;
    for (let i = 0; i < destinos.length; i += 1) {
      await imprimirUmaVia(enveloparVia(html, destinos[i]), deviceName);
      impressas += 1;
    }
    return { ok: true, impressas, solicitadas: destinos.length };
  }

  function registrarEvento(payload) {
    try {
      const token = (typeof localStorage !== 'undefined' && localStorage.getItem('token')) || '';
      const api = typeof API_URL !== 'undefined' ? API_URL : '/api';
      fetch(`${api}/configuracoes/cupom_impressao_evento`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload || {})
      }).catch(() => {});
    } catch (_) { /* ignore */ }
  }

  async function executarImpressao(html, decisao, meta) {
    if (impressaoEmAndamento) return { ok: false, motivo: 'ocupado' };
    marcarImprimindo(true);
    estadoAtual = ESTADOS.IMPRIMINDO;
    if (global.electronAPI && typeof global.electronAPI.fecharComprovante === 'function') {
      global.electronAPI.fecharComprovante();
    }
    try {
      const r = await imprimirVias(html, decisao);
      if (r.ok) {
        estadoAtual = ESTADOS.IMPRESSO;
        if (typeof showNotification === 'function') {
          showNotification('Impressão concluída.', 'success');
        }
      }
      registrarEvento({
        tipo: meta && meta.tipo,
        venda_id: meta && meta.vendaId,
        decisao: 'SIM',
        quantidade_solicitada: decisao.vias,
        quantidade_impressa: r.impressas || 0,
        resultado: r.ok ? 'IMPRESSO' : (r.motivo || 'ERRO')
      });
      return r;
    } catch (err) {
      estadoAtual = ESTADOS.ERRO_IMPRESSAO;
      registrarEvento({
        tipo: meta && meta.tipo,
        venda_id: meta && meta.vendaId,
        decisao: 'SIM',
        quantidade_solicitada: decisao.vias,
        quantidade_impressa: 0,
        resultado: 'ERRO',
        erro: String(err && err.message || err).slice(0, 180)
      });
      const retry = await perguntarErro(err && err.message);
      if (retry) {
        marcarImprimindo(false);
        return executarImpressao(html, decisao, meta);
      }
      return { ok: false, motivo: 'erro' };
    } finally {
      marcarImprimindo(false);
    }
  }

  async function aposCupomNaTela(opcoes) {
    const opts = opcoes || {};
    await carregar();
    const decisaoBase = resolver(opts.tipo, opts);
    const viasOverride = opts.vias != null ? normalizarVias(opts.vias) : null;
    const decisao = {
      ...decisaoBase,
      vias: viasOverride || decisaoBase.vias,
      destinos: Array.isArray(opts.destinos) && opts.destinos.length
        ? completarDestinos(opts.destinos, viasOverride || opts.destinos.length)
        : (viasOverride ? completarDestinos(decisaoBase.destinos, viasOverride) : decisaoBase.destinos)
    };
    const html = opts.html || '';
    const reimpressao = opts.reimpressao === true;
    const automatico = opts.automatico === true;

    if (!decisao.imprimir && opts.forcarImpressora !== true) {
      estadoAtual = ESTADOS.NAO_IMPRIMIR;
      return { estado: estadoAtual, impressas: 0 };
    }

    if (reimpressao || opts.forcarImpressora === true || (automatico && decisao.automatico)) {
      return executarImpressao(html, decisao, opts);
    }

    if (automatico && decisao.perguntar) {
      const sim = await perguntarImpressao();
      if (!sim) {
        estadoAtual = ESTADOS.NAO_IMPRIMIR;
        registrarEvento({
          tipo: decisao.tipo,
          venda_id: opts.vendaId,
          decisao: 'NAO',
          quantidade_solicitada: 0,
          quantidade_impressa: 0,
          resultado: 'NAO_IMPRIMIR'
        });
        return { estado: estadoAtual, impressas: 0 };
      }
      return executarImpressao(html, decisao, opts);
    }

    if (!automatico && !reimpressao && decisao.perguntar) {
      const sim = await perguntarImpressao();
      if (!sim) {
        estadoAtual = ESTADOS.NAO_IMPRIMIR;
        return { estado: estadoAtual, impressas: 0 };
      }
      return executarImpressao(html, decisao, opts);
    }

    return executarImpressao(html, decisao, opts);
  }

  const api = {
    MODOS,
    DESTINOS,
    ESTADOS,
    MAX_VIAS,
    normalizar,
    resolver,
    rotuloVia,
    enveloparVia,
    carregar,
    aplicarCache,
    perguntarImpressao,
    aposCupomNaTela,
    estado: () => estadoAtual,
    ocupada: () => impressaoEmAndamento
  };

  global.CupomPrintPolicy = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : global);
