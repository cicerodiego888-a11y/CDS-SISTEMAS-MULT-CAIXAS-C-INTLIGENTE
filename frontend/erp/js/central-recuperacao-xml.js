/**
 * RC3.6.1 — Assistente de Recuperação CDS.
 * Acompanha em tempo real todas as etapas até a recuperação completa.
 *
 * @module frontend/erp/js/central-recuperacao-xml
 */
(function (global) {
  'use strict';

  const ETAPAS = [
    { id: 'portal', label: 'Abrindo Portal Nacional', percentual: 10 },
    { id: 'download', label: 'Aguardando Download', percentual: 20 },
    { id: 'xml_detectado', label: 'XML Detectado', percentual: 30 },
    { id: 'validando', label: 'Validando XML', percentual: 40 },
    { id: 'importando', label: 'Importando XML', percentual: 50 },
    { id: 'parser', label: 'Executando Parser', percentual: 60 },
    { id: 'miip', label: 'Executando MIIP', percentual: 70 },
    { id: 'compra', label: 'Criando Compra', percentual: 80 },
    { id: 'atualizando', label: 'Atualizando Central', percentual: 90 },
    { id: 'recuperado', label: 'Documento Recuperado', percentual: 100 }
  ];

  const STATUS_ICONE = {
    aguardando: { simbolo: '○', classe: 'is-aguardando' },
    executando: { simbolo: '🟡', classe: 'is-executando' },
    concluido: { simbolo: '🟢', classe: 'is-concluido' },
    erro: { simbolo: '🔴', classe: 'is-erro' }
  };

  function criarEstadoInicial() {
    const etapasStatus = {};
    ETAPAS.forEach((e) => { etapasStatus[e.id] = 'aguardando'; });
    return {
      aberto: false,
      documento: null,
      etapaAtual: null,
      etapasStatus,
      percentual: 0,
      mensagem: '',
      erro: false,
      emConsulta: false,
      correlationId: null,
      logTecnico: [],
      tentativas: [],
      tentativaAtual: 0,
      xmlCaminho: null,
      xmlNomeArquivo: null,
      logAberto: false
    };
  }

  let state = criarEstadoInicial();

  function esc(texto) {
    if (typeof global.escapeHtmlCentralEntradas === 'function') {
      return global.escapeHtmlCentralEntradas(texto);
    }
    if (texto === null || texto === undefined) return '';
    return String(texto)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function moeda(valor) {
    if (typeof global.formatarMoedaCentral === 'function') {
      return global.formatarMoedaCentral(valor);
    }
    return Number(valor || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  }

  function dataEmissao(data) {
    if (typeof global.formatarDataEmissaoCurtaListaCentral === 'function') {
      return global.formatarDataEmissaoCurtaListaCentral(data);
    }
    if (!data) return '—';
    const m = String(data).match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return `${m[3]}/${m[2]}/${m[1].slice(-2)}`;
    return String(data);
  }

  function labelSituacao(doc) {
    const status = doc?.status || '';
    if (status === 'XML_INDISPONIVEL') return 'XML indisponível na SEFAZ';
    if (status === 'ERRO') return 'Erro na recuperação automática';
    if (status === 'AGUARDANDO_XML_COMPLETO') return 'Aguardando XML completo';
    if (typeof global.obterLabelStatusCentral === 'function') {
      return global.obterLabelStatusCentral(status) || status || '—';
    }
    return status || '—';
  }

  function formatarChave(chave) {
    const digitos = String(chave || '').replace(/\D/g, '');
    if (digitos.length !== 44) return digitos || '—';
    return digitos.replace(/(\d{4})(?=\d)/g, '$1 ').trim();
  }

  function horaLog() {
    const d = new Date();
    return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }

  function idxEtapa(id) {
    return ETAPAS.findIndex((e) => e.id === id);
  }

  function calcularPercentual() {
    if (state.etapaAtual) {
      const etapa = ETAPAS.find((e) => e.id === state.etapaAtual);
      if (etapa) return etapa.percentual;
    }
    const concluidas = ETAPAS.filter((e) => state.etapasStatus[e.id] === 'concluido');
    if (concluidas.length) return concluidas[concluidas.length - 1].percentual;
    return 0;
  }

  function registrarLog(evento, resultado) {
    state.logTecnico.push({
      hora: horaLog(),
      evento: String(evento || ''),
      resultado: String(resultado || 'OK')
    });
    if (state.logTecnico.length > 80) state.logTecnico.shift();
  }

  function registrarTentativaFalha(motivo) {
    const num = state.tentativaAtual || state.tentativas.length + 1;
    state.tentativas.push({
      numero: num,
      resultado: 'falha',
      motivo: String(motivo || 'Falha na recuperação')
    });
  }

  function registrarTentativaSucesso() {
    const num = state.tentativaAtual || state.tentativas.length + 1;
    state.tentativas.push({
      numero: num,
      resultado: 'sucesso',
      motivo: 'Sucesso'
    });
  }

  function resetarEtapas() {
    ETAPAS.forEach((e) => { state.etapasStatus[e.id] = 'aguardando'; });
    state.etapaAtual = null;
    state.percentual = 0;
    state.erro = false;
  }

  function definirEtapa(etapaId, mensagem, opcoes) {
    const idx = idxEtapa(etapaId);
    if (idx < 0) return;

    if (opcoes && opcoes.erro === true) {
      state.erro = true;
      state.etapasStatus[etapaId] = 'erro';
      if (mensagem != null) state.mensagem = mensagem;
      state.percentual = calcularPercentual();
      atualizarUi();
      return;
    }

    if (opcoes && opcoes.erro === false) state.erro = false;

    for (let i = 0; i < idx; i += 1) {
      const id = ETAPAS[i].id;
      if (state.etapasStatus[id] !== 'erro') {
        state.etapasStatus[id] = 'concluido';
      }
    }

    state.etapaAtual = etapaId;
    state.etapasStatus[etapaId] = 'executando';
    if (mensagem != null) state.mensagem = mensagem;
    state.percentual = calcularPercentual();
    atualizarUi();
  }

  function concluirEtapa(etapaId, mensagem) {
    const idx = idxEtapa(etapaId);
    if (idx < 0) return;
    state.etapasStatus[etapaId] = 'concluido';
    if (mensagem != null) state.mensagem = mensagem;
    if (state.etapaAtual === etapaId) {
      const prox = ETAPAS[idx + 1];
      state.etapaAtual = prox ? prox.id : etapaId;
    }
    state.percentual = calcularPercentual();
    atualizarUi();
  }

  function renderChecklistEtapas() {
    const lista = ETAPAS.map((etapa) => {
      const status = state.etapasStatus[etapa.id] || 'aguardando';
      const meta = STATUS_ICONE[status] || STATUS_ICONE.aguardando;
      const ativa = state.etapaAtual === etapa.id && status === 'executando';
      return `<li class="central-recuperacao-assistente-etapa ${meta.classe} ${ativa ? 'is-ativa' : ''}">
        <span class="central-recuperacao-assistente-icone" aria-hidden="true">${meta.simbolo}</span>
        <span class="central-recuperacao-assistente-label">${esc(etapa.label)}</span>
      </li>`;
    }).join('');

    return `<section class="central-recuperacao-assistente-etapas-bloco">
      <h3 class="central-recuperacao-sec-titulo">Etapas da Recuperação</h3>
      <ul class="central-recuperacao-assistente-lista">${lista}</ul>
    </section>`;
  }

  function renderProgressoPercentual() {
    const pct = state.percentual || 0;
    return `<div class="central-recuperacao-assistente-progresso" aria-live="polite">
      <div class="central-recuperacao-assistente-progresso-topo">
        <span class="central-recuperacao-assistente-pct">${pct}%</span>
        <span class="central-recuperacao-assistente-pct-label">concluído</span>
      </div>
      <div class="central-recuperacao-progresso-barra">
        <div class="central-recuperacao-progresso-fill ${state.erro ? 'is-erro' : ''}" style="width:${pct}%"></div>
      </div>
    </div>`;
  }

  function renderStatusAtual() {
    const texto = state.mensagem
      || (state.emConsulta ? 'Aguardando download do XML…' : 'Pronto para iniciar a recuperação.');
    return `<section class="central-recuperacao-assistente-status">
      <h3 class="central-recuperacao-sec-titulo">Status atual</h3>
      <div class="central-recuperacao-assistente-status-texto ${state.erro ? 'is-erro' : ''}">${esc(texto)}</div>
    </section>`;
  }

  function renderLogTecnico() {
    const linhas = state.logTecnico.length
      ? state.logTecnico.slice().reverse().map((l) => `
        <tr>
          <td class="font-monospace small">${esc(l.hora)}</td>
          <td>${esc(l.evento)}</td>
          <td class="small text-muted">${esc(l.resultado)}</td>
        </tr>`).join('')
      : '<tr><td colspan="3" class="text-muted small">Nenhum evento registrado ainda.</td></tr>';

    return `<details class="central-recuperacao-assistente-log" ${state.logAberto ? 'open' : ''}>
      <summary>Detalhes Técnicos</summary>
      <div class="table-responsive">
        <table class="table table-sm table-borderless mb-0">
          <thead><tr><th>Horário</th><th>Evento</th><th>Resultado</th></tr></thead>
          <tbody>${linhas}</tbody>
        </table>
      </div>
    </details>`;
  }

  function renderHistoricoTentativas() {
    if (!state.tentativas.length) return '';
    const itens = state.tentativas.map((t) => {
      const classe = t.resultado === 'sucesso' ? 'is-ok' : 'is-falha';
      return `<li class="central-recuperacao-tentativa ${classe}">
        <strong>Tentativa ${t.numero}</strong>
        <span>${esc(t.motivo)}</span>
      </li>`;
    }).join('');
    return `<section class="central-recuperacao-tentativas-bloco">
      <h3 class="central-recuperacao-sec-titulo">Tentativas de Recuperação</h3>
      <ul class="central-recuperacao-tentativas-lista">${itens}</ul>
    </section>`;
  }

  function renderBody() {
    const doc = state.documento || {};
    const chaveFmt = formatarChave(doc.chave);
    const situacao = labelSituacao(doc);
    const mostrarAssistente = state.emConsulta || state.erro || state.etapaAtual === 'recuperado'
      || state.etapasStatus.recuperado === 'concluido';

    let instrucao = '';
    if (!mostrarAssistente) {
      instrucao = `<div class="central-recuperacao-instrucao">
        <p>O XML deste documento não pôde ser recuperado automaticamente.</p>
        <p>Clique em <strong>Consultar no Portal Nacional</strong> para obter o XML oficial.</p>
        <p class="mb-0 text-muted">Após o download o CDS continuará automaticamente o processamento.</p>
      </div>`;
    }

    return `<section class="central-recuperacao-doc central-recuperacao-doc--compacto">
      <div class="central-recuperacao-grid central-recuperacao-grid--compacto">
        <div><span class="central-recuperacao-label">Fornecedor</span><strong title="${esc(doc.fornecedor || '')}">${esc(doc.fornecedor || '—')}</strong></div>
        <div><span class="central-recuperacao-label">NF</span><strong>${esc(doc.numero || '—')}</strong></div>
        <div><span class="central-recuperacao-label">Série</span><strong>${esc(doc.serie || '—')}</strong></div>
        <div><span class="central-recuperacao-label">Emissão</span><strong>${esc(dataEmissao(doc.dataEmissao || doc.data_emissao))}</strong></div>
        <div><span class="central-recuperacao-label">Valor</span><strong>${esc(moeda(doc.valor || doc.valorTotal || doc.valor_total))}</strong></div>
      </div>
      <div class="central-recuperacao-chave-bloco">
        <label class="central-recuperacao-label" for="centralRecuperacaoChave">Chave de Acesso</label>
        <input type="text" id="centralRecuperacaoChave" class="form-control central-recuperacao-chave"
          value="${esc(chaveFmt)}" readonly tabindex="0"
          title="Preenchida automaticamente — não editável">
      </div>
      <div class="central-recuperacao-situacao">
        <span class="central-recuperacao-label">Situação</span>
        <div class="central-recuperacao-situacao-texto">${esc(situacao)}</div>
      </div>
    </section>
    ${instrucao}
    ${mostrarAssistente ? renderChecklistEtapas() : ''}
    ${mostrarAssistente ? renderProgressoPercentual() : ''}
    ${mostrarAssistente ? renderStatusAtual() : ''}
    ${mostrarAssistente ? renderHistoricoTentativas() : ''}
    ${mostrarAssistente ? renderLogTecnico() : ''}`;
  }

  function renderFooter() {
    const emAndamento = Boolean(state.emConsulta) && !state.erro
      && state.etapasStatus.recuperado !== 'concluido';
    const concluido = state.etapasStatus.recuperado === 'concluido'
      || state.etapaAtual === 'recuperado';
    const temXml = Boolean(state.xmlCaminho);

    if (concluido) {
      return `
        ${temXml ? `<button type="button" class="btn btn-outline-secondary" id="centralRecuperacaoBtnAbrirPasta">
          <i class="fas fa-folder-open me-1"></i> Abrir Pasta do XML
        </button>` : ''}
        <button type="button" class="btn btn-primary" id="centralRecuperacaoBtnFechar">
          <i class="fas fa-check me-1"></i> Fechar
        </button>`;
    }

    if (state.erro) {
      return `
        <button type="button" class="btn btn-outline-secondary" data-central-recuperacao-cancelar="1">Cancelar</button>
        ${temXml ? `<button type="button" class="btn btn-outline-secondary" id="centralRecuperacaoBtnAbrirPasta">
          <i class="fas fa-folder-open me-1"></i> Abrir Pasta do XML
        </button>` : ''}
        <button type="button" class="btn btn-warning" id="centralRecuperacaoBtnRetry">
          <i class="fas fa-redo me-1"></i> Tentar Novamente
        </button>`;
    }

    return `
      <button type="button" class="btn btn-outline-secondary" data-central-recuperacao-cancelar="1" ${emAndamento ? 'disabled' : ''}>Cancelar</button>
      <button type="button" class="btn btn-primary" id="centralRecuperacaoBtnConsultar" ${emAndamento ? 'disabled' : ''}>
        <i class="fas fa-cloud-download-alt me-1"></i> Consultar no Portal Nacional
      </button>`;
  }

  function garantirOverlay() {
    let el = document.getElementById('centralRecuperacaoOverlay');
    if (el) return el;
    el = document.createElement('div');
    el.id = 'centralRecuperacaoOverlay';
    el.className = 'central-recuperacao-overlay d-none';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'true');
    el.setAttribute('aria-labelledby', 'centralRecuperacaoTitulo');
    el.innerHTML = `
      <div class="central-recuperacao-backdrop" data-central-recuperacao-cancelar="1"></div>
      <div class="central-recuperacao-dialog central-recuperacao-dialog--assistente" role="document">
        <div class="central-recuperacao-header">
          <div>
            <div class="central-recuperacao-eyebrow">CDS Sistemas · Assistente de Recuperação</div>
            <h2 id="centralRecuperacaoTitulo" class="central-recuperacao-titulo">Recuperação Oficial de XML</h2>
          </div>
          <button type="button" class="btn btn-sm btn-outline-light" title="Fechar"
            data-central-recuperacao-cancelar="1" aria-label="Fechar"><i class="fas fa-times"></i></button>
        </div>
        <div class="central-recuperacao-body" id="centralRecuperacaoBody"></div>
        <div class="central-recuperacao-footer" id="centralRecuperacaoFooter"></div>
      </div>`;
    document.body.appendChild(el);

    el.addEventListener('toggle', (ev) => {
      if (ev.target.classList && ev.target.classList.contains('central-recuperacao-assistente-log')) {
        state.logAberto = ev.target.open;
      }
    }, true);

    return el;
  }

  function atualizarUi() {
    const overlay = garantirOverlay();
    const body = document.getElementById('centralRecuperacaoBody');
    const footer = document.getElementById('centralRecuperacaoFooter');
    if (body) body.innerHTML = renderBody();
    if (footer) footer.innerHTML = renderFooter();
    overlay.classList.toggle('d-none', !state.aberto);
    document.body.classList.toggle('central-recuperacao-aberta', state.aberto);
  }

  function fechar() {
    state = criarEstadoInicial();
    atualizarUi();
  }

  function abrir(doc) {
    state = criarEstadoInicial();
    state.aberto = true;
    state.documento = doc || null;
    state.mensagem = 'Pronto para iniciar a recuperação.';
    registrarLog('Assistente aberto', 'Aguardando confirmação');
    atualizarUi();
  }

  function iniciarConsulta() {
    resetarEtapas();
    state.emConsulta = true;
    state.erro = false;
    if (!state.tentativaAtual) state.tentativaAtual = 1;
    state.mensagem = 'Preparando Portal…';
    registrarLog('Consulta iniciada', `Tentativa ${state.tentativaAtual}`);
    atualizarUi();
  }

  function reiniciarFluxo() {
    const doc = state.documento;
    const correlationId = state.correlationId;
    const tentativas = state.tentativas.slice();
    const logTecnico = state.logTecnico.slice();
    const tentativaAtual = (state.tentativaAtual || state.tentativas.length) + 1;

    state = criarEstadoInicial();
    state.aberto = true;
    state.documento = doc;
    state.correlationId = correlationId;
    state.tentativas = tentativas;
    state.logTecnico = logTecnico;
    state.tentativaAtual = tentativaAtual;
    state.emConsulta = false;
    state.erro = false;
    state.mensagem = `Tentativa ${tentativaAtual} — pronto para consultar o Portal.`;
    registrarLog('Fluxo reiniciado', `Tentativa ${tentativaAtual}`);
    atualizarUi();
  }

  function setXmlDownload(caminho, nomeArquivo) {
    state.xmlCaminho = caminho || null;
    state.xmlNomeArquivo = nomeArquivo || null;
    atualizarUi();
  }

  async function abrirPastaXml() {
    const api = global.electronAPI?.portalNfe;
    if (api?.abrirPasta) {
      await api.abrirPasta({ caminho: state.xmlCaminho || null });
      return;
    }
    if (api?.dirDownloads) {
      const info = await api.dirDownloads().catch(() => null);
      if (info?.caminho) {
        global.alert?.('Pasta de downloads:\n' + info.caminho);
      }
    }
  }

  function obterEstado() {
    return state;
  }

  function setCorrelationId(id) {
    state.correlationId = id || null;
  }

  function setEmConsulta(v) {
    state.emConsulta = Boolean(v);
    atualizarUi();
  }

  function setErro(v) {
    state.erro = Boolean(v);
    atualizarUi();
  }

  global.CentralRecuperacaoXml = {
    ETAPAS,
    abrir,
    fechar,
    atualizarUi,
    definirEtapa,
    concluirEtapa,
    reiniciarFluxo,
    iniciarConsulta,
    registrarLog,
    registrarTentativaFalha,
    registrarTentativaSucesso,
    setXmlDownload,
    abrirPastaXml,
    obterEstado,
    setCorrelationId,
    setEmConsulta,
    setErro,
    formatarChave,
    renderBody,
    renderFooter,
    renderEtapas: renderChecklistEtapas,
    garantirOverlay,
    calcularPercentual
  };
})(typeof window !== 'undefined' ? window : global);
