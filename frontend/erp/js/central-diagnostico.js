/**
 * Diagnóstico da Central Inteligente de Entradas — RC2
 * Acesso: ADMIN, SUPER_ADMIN, SUPORTE
 */

const centralDiagnosticoState = {
  carregando: false,
  dados: null,
  ultimaAtualizacao: null
};

function centralDiagnosticoFetch(path, options = {}) {
  const token = localStorage.getItem('token');
  return fetch(`${API_URL}/central-entradas${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...(options.headers || {})
    }
  }).then(async (response) => {
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const erro = new Error(data.error || data.message || 'Erro na requisição');
      erro.status = response.status;
      throw erro;
    }
    return data;
  });
}

function formatarMsCentral(ms) {
  if (ms == null || Number.isNaN(Number(ms))) return '—';
  const valor = Number(ms);
  if (valor < 1000) return `${Math.round(valor)} ms`;
  if (valor < 60000) return `${(valor / 1000).toFixed(1)} s`;
  return `${(valor / 60000).toFixed(1)} min`;
}

function formatarBytesCentral(bytes) {
  if (bytes == null) return '—';
  const valor = Number(bytes);
  if (valor < 1024) return `${valor} B`;
  if (valor < 1024 * 1024) return `${(valor / 1024).toFixed(1)} KB`;
  return `${(valor / (1024 * 1024)).toFixed(2)} MB`;
}

function badgeStatusCentral(valor, mapaOk = null) {
  const texto = String(valor || '—');
  const normalizado = texto.toLowerCase();
  let classe = 'central-diag-badge--neutral';

  if (mapaOk) {
    classe = mapaOk.includes(normalizado) ? 'central-diag-badge--ok' : 'central-diag-badge--error';
  } else if (['ok', 'online', 'ativo', 'executando', 'conectado', 'válido', 'valido'].includes(normalizado)) {
    classe = 'central-diag-badge--ok';
  } else if (['erro', 'offline', 'inativo', 'parado', 'desabilitado', 'expirado'].includes(normalizado)) {
    classe = 'central-diag-badge--error';
  } else if (['warn', 'aviso', 'aguardando'].includes(normalizado)) {
    classe = 'central-diag-badge--warn';
  }

  return `<span class="central-diag-badge ${classe}">${texto}</span>`;
}

function renderSecaoCentral(titulo, conteudo, icone = 'fa-stethoscope') {
  return `
    <section class="central-diag-section card shadow-sm mb-3">
      <div class="card-header central-diag-section__header">
        <h5 class="mb-0"><i class="fas ${icone} me-2"></i>${titulo}</h5>
      </div>
      <div class="card-body">${conteudo}</div>
    </section>`;
}

function renderGridItensCentral(itens) {
  return `
    <div class="row g-3 central-diag-grid">
      ${itens.map((item) => `
        <div class="col-md-4 col-lg-3">
          <div class="central-diag-item">
            <div class="central-diag-item__label">${item.label}</div>
            <div class="central-diag-item__value">${item.valor}</div>
            ${item.detalhe ? `<div class="central-diag-item__detalhe">${item.detalhe}</div>` : ''}
          </div>
        </div>
      `).join('')}
    </div>`;
}

function renderStatusGeralCentral(status) {
  const itens = [
    { label: 'Central Inteligente', valor: badgeStatusCentral(status.centralInteligente) },
    { label: 'Background Service', valor: badgeStatusCentral(status.backgroundService) },
    { label: 'Orchestrator', valor: badgeStatusCentral(status.orchestrator) },
    { label: 'Máquina de Estados', valor: badgeStatusCentral(status.maquinaEstados) },
    { label: 'Parser Oficial', valor: badgeStatusCentral(status.parserOficial) },
    { label: 'MIIP', valor: badgeStatusCentral(status.miip) },
    { label: 'Central de Revisão', valor: badgeStatusCentral(status.centralRevisao) }
  ];
  return renderGridItensCentral(itens);
}

function renderPipelineCentral(pipeline) {
  const linhas = (pipeline || []).map((etapa, idx) => `
    <tr>
      <td>${idx > 0 ? '<span class="central-diag-pipe">↓</span>' : ''} ${etapa.label}</td>
      <td>${formatarMsCentral(etapa.tempoMs)}</td>
      <td>${badgeStatusCentral(etapa.status)}</td>
      <td>${etapa.ultimaExecucao ? new Date(etapa.ultimaExecucao).toLocaleString('pt-BR') : '—'}</td>
      <td>${etapa.quantidadeProcessada ?? 0}</td>
    </tr>
  `).join('');

  return `
    <div class="table-responsive">
      <table class="table table-sm table-hover central-diag-table mb-0">
        <thead>
          <tr>
            <th>Etapa</th>
            <th>Tempo</th>
            <th>Status</th>
            <th>Última execução</th>
            <th>Qtd.</th>
          </tr>
        </thead>
        <tbody>${linhas}</tbody>
      </table>
    </div>`;
}

function renderHealthCheckCentral(health) {
  const itens = (health?.itens || []).map((item) => `
    <div class="col-md-4 col-lg-3">
      <div class="central-diag-health-item ${item.status === 'OK' ? 'is-ok' : 'is-error'}">
        <strong>${item.componente}</strong>
        <div>${badgeStatusCentral(item.status)}</div>
        <small class="text-muted">${item.detalhe || ''}</small>
      </div>
    </div>
  `).join('');

  return `<div class="row g-2">${itens}</div>`;
}

function renderLogsCentral(logs) {
  const linhas = (logs || []).map((log) => `
    <tr>
      <td>${log.data || '—'}</td>
      <td>${log.hora || '—'}</td>
      <td>${log.modulo || '—'}</td>
      <td class="central-diag-log-msg">${log.mensagem || '—'}</td>
      <td>${badgeStatusCentral(log.nivel, ['info'])}
        ${log.nivel === 'WARN' ? badgeStatusCentral('WARN') : ''}
        ${log.nivel === 'ERROR' ? badgeStatusCentral('Erro') : ''}
      </td>
    </tr>
  `).join('');

  return `
    <div class="table-responsive" style="max-height: 360px; overflow-y: auto;">
      <table class="table table-sm table-striped central-diag-table mb-0">
        <thead>
          <tr>
            <th>Data</th><th>Hora</th><th>Módulo</th><th>Mensagem</th><th>Nível</th>
          </tr>
        </thead>
        <tbody>${linhas || '<tr><td colspan="5" class="text-muted">Nenhum evento registrado.</td></tr>'}</tbody>
      </table>
    </div>`;
}

function renderComunicacaoSoapCentral(com) {
  const c = com || {};
  const u = c.ultimaComunicacao || {};
  return renderGridItensCentral([
    { label: 'Última comunicação', valor: u.timestampFim || u.timestampInicio
      ? new Date(u.timestampFim || u.timestampInicio).toLocaleString('pt-BR')
      : '—' },
    { label: 'Último endpoint', valor: c.ultimoEndpoint || u.endpoint || '—' },
    { label: 'Último cStat', valor: c.ultimoCStat || u.cStat || '—' },
    { label: 'Último HTTP', valor: c.ultimoHttpStatus ?? u.httpStatus ?? '—' },
    { label: 'Tempo médio', valor: formatarMsCentral(c.tempoMedioMs) },
    { label: 'Tempo máximo', valor: formatarMsCentral(c.tempoMaximoMs) },
    { label: 'Tempo médio SOAP', valor: formatarMsCentral(c.tempoMedioSoapMs) },
    { label: 'Retries', valor: c.retries ?? 0 },
    { label: 'Documentos (telemetria)', valor: c.quantidadeDocumentos ?? 0 },
    { label: 'Totais OK / Falha / Timeout', valor: `${c.totais?.sucesso ?? 0} / ${c.totais?.falha ?? 0} / ${c.totais?.timeout ?? 0}` },
    { label: 'CorrelationId', valor: u.correlationId || '—' },
    { label: 'RequestId', valor: u.requestId || '—' },
    { label: 'Resultado', valor: u.resultado || '—' }
  ]);
}

function renderPainelDiagnosticoCentral(dados) {
  const s = dados.statusGeral || {};
  const sefaz = dados.sefaz || {};
  const cert = dados.certificado || {};
  const docs = dados.documentos || {};
  const miip = dados.miip || {};
  const serv = dados.servicos || {};
  const banco = dados.banco || {};
  const perf = dados.performance || {};
  const sistema = dados.sistema || {};

  // RC3.7.5.3 — UX cooldown 656 (somente apresentação)
  const cooldownAteMs = sefaz.cooldownNsuAte ? new Date(sefaz.cooldownNsuAte).getTime() : 0;
  const cooldownAtivo = Boolean(
    cooldownAteMs > Date.now()
    && (String(sefaz.ultimoCstat || sefaz.codigoRejeicao || '') === '656'
      || /Aguardando cooldown|Atualizado automaticamente/i.test(String(sefaz.statusNsu || '')))
  );
  const restanteMin = cooldownAtivo
    ? Math.max(1, Math.ceil((cooldownAteMs - Date.now()) / 60000))
    : 0;
  const proximaHora = cooldownAtivo
    ? new Date(cooldownAteMs).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
    : '—';
  const statusNsuLabel = cooldownAtivo
    ? 'AGUARDANDO COOLDOWN DA SEFAZ'
    : (sefaz.statusNsu || '—');

  return `
    <div class="central-diag-page central-entradas-anim-in">
      <div class="central-diag-hero d-flex flex-wrap justify-content-between align-items-center mb-4">
        <div>
          <h2 class="mb-1"><i class="fas fa-heartbeat me-2"></i>Saúde da Central</h2>
          <p class="text-muted mb-0">Ferramenta de suporte técnico — somente leitura e ações operacionais seguras.</p>
          <small class="text-muted">Atualizado: ${dados.geradoEm ? new Date(dados.geradoEm).toLocaleString('pt-BR') : '—'}</small>
          ${cooldownAtivo ? `
          <div class="alert alert-warning py-2 px-3 mt-2 mb-0" role="status">
            🟡 Aguardando liberação da SEFAZ · Próxima tentativa: <strong>${proximaHora}</strong>
            · Tempo restante: <strong>${restanteMin} minuto${restanteMin === 1 ? '' : 's'}</strong>
          </div>` : ''}
        </div>
        <div class="central-diag-actions d-flex flex-wrap gap-2 mt-2 mt-md-0">
          <button class="btn btn-outline-primary btn-sm" id="btnDiagSync"
            ${cooldownAtivo ? 'disabled' : ''}
            title="${cooldownAtivo ? 'A SEFAZ bloqueia novas consultas durante o período de espera.' : 'Sincronizar com a SEFAZ'}">
            <i class="fas fa-sync"></i> Sincronizar
          </button>
          <button class="btn btn-outline-secondary btn-sm" id="btnDiagReprocessar"><i class="fas fa-redo"></i> Reprocessar pendências</button>
          <button class="btn btn-outline-secondary btn-sm" id="btnDiagAtualizar"><i class="fas fa-refresh"></i> Atualizar</button>
          <button class="btn btn-outline-info btn-sm" id="btnDiagCert"><i class="fas fa-certificate"></i> Testar certificado</button>
          <button class="btn btn-outline-info btn-sm" id="btnDiagSefaz"><i class="fas fa-cloud"></i> Testar SEFAZ</button>
          <button class="btn btn-outline-warning btn-sm" id="btnDiagCache"><i class="fas fa-broom"></i> Limpar cache</button>
          <button class="btn btn-success btn-sm" id="btnDiagHealth"><i class="fas fa-heartbeat"></i> Health Check</button>
        </div>
      </div>

      ${renderSecaoCentral('Status Geral', renderStatusGeralCentral(s), 'fa-heartbeat')}
      ${renderSecaoCentral('SEFAZ', renderGridItensCentral([
        { label: 'Ambiente', valor: sefaz.ambiente || '—' },
        { label: 'Última sincronização', valor: sefaz.ultimaSincronizacao ? new Date(sefaz.ultimaSincronizacao).toLocaleString('pt-BR') : '—' },
        { label: 'Próxima sincronização', valor: sefaz.proximaSincronizacao ? new Date(sefaz.proximaSincronizacao).toLocaleString('pt-BR') : '—' },
        { label: 'Tempo última consulta', valor: formatarMsCentral(sefaz.tempoUltimaConsultaMs) },
        { label: 'Documentos encontrados', valor: sefaz.documentosEncontrados ?? 0 },
        { label: 'NSU Local', valor: sefaz.nsuLocal || sefaz.ultimoNsuSalvo || '—' },
        { label: 'NSU SEFAZ', valor: sefaz.nsuSefaz || sefaz.ultimoNsuRecebido || '—' },
        { label: 'Último cStat', valor: sefaz.ultimoCstat || sefaz.codigoRejeicao || '—' },
        { label: 'Status NSU', valor: statusNsuLabel },
        { label: 'Cooldown NSU até', valor: sefaz.cooldownNsuAte ? new Date(sefaz.cooldownNsuAte).toLocaleString('pt-BR') : '—' },
        { label: 'Último NSU recebido', valor: sefaz.ultimoNsuRecebido || '—' },
        { label: 'Último NSU processado', valor: sefaz.ultimoNsuProcessado || '—' },
        { label: 'Último NSU salvo', valor: sefaz.ultimoNsuSalvo || '—' },
        { label: 'Último erro SEFAZ', valor: sefaz.ultimoErroSefaz || '—' },
        { label: 'Código rejeição', valor: sefaz.codigoRejeicao || '—' },
        { label: 'Mensagem rejeição', valor: sefaz.mensagemRejeicao || '—' }
      ]), 'fa-cloud')}
      ${renderSecaoCentral('Comunicação SOAP (RC6.6)', renderComunicacaoSoapCentral(dados.comunicacao), 'fa-exchange-alt')}
      ${renderSecaoCentral('Certificado Digital', renderGridItensCentral([
        { label: 'Nome', valor: cert.nome || '—' },
        { label: 'CNPJ', valor: cert.cnpj || '—' },
        { label: 'Validade', valor: cert.validade ? new Date(cert.validade).toLocaleDateString('pt-BR') : '—' },
        { label: 'Dias restantes', valor: cert.diasRestantes != null ? cert.diasRestantes : '—' },
        { label: 'Tipo', valor: cert.tipo || 'A1' },
        { label: 'Status', valor: badgeStatusCentral(cert.status) },
        { label: 'Senha configurada', valor: cert.senhaConfigurada || 'NÃO' }
      ]), 'fa-certificate')}
      ${renderSecaoCentral('Pipeline', renderPipelineCentral(dados.pipeline), 'fa-project-diagram')}
      ${renderSecaoCentral('Documentos', renderGridItensCentral([
        { label: 'Sincronizados hoje', valor: docs.sincronizadosHoje ?? 0 },
        { label: 'Importados', valor: docs.importados ?? 0 },
        { label: 'Pendentes', valor: docs.pendentes ?? 0 },
        { label: 'Com erro', valor: docs.comErro ?? 0 },
        { label: 'Cancelados', valor: docs.cancelados ?? 0 },
        { label: 'Duplicados', valor: docs.duplicados ?? 0 },
        { label: 'Aguardando revisão', valor: docs.aguardandoRevisao ?? 0 },
        { label: 'Aguardando compra', valor: docs.aguardandoCompra ?? 0 }
      ]), 'fa-file-invoice')}
      ${renderSecaoCentral('MIIP', renderGridItensCentral([
        { label: 'Identificados automaticamente', valor: miip.produtosIdentificadosAutomaticamente ?? 0 },
        { label: 'Confirmados', valor: miip.produtosConfirmados ?? 0 },
        { label: 'Produtos novos', valor: miip.produtosNovos ?? 0 },
        { label: 'Precisão média', valor: miip.precisaoMedia != null ? `${miip.precisaoMedia}%` : '—' },
        { label: 'Tempo médio', valor: formatarMsCentral(miip.tempoMedioMs) },
        { label: 'Motores utilizados', valor: (miip.motoresUtilizados || []).join(', ') || '—' },
        { label: 'Última execução', valor: miip.ultimaExecucao ? new Date(miip.ultimaExecucao).toLocaleString('pt-BR') : '—' }
      ]), 'fa-brain')}
      ${renderSecaoCentral('Serviços', `
        ${renderGridItensCentral([
          { label: 'Background', valor: badgeStatusCentral(serv.background?.status), detalhe: serv.background?.ultimaExecucao },
          { label: 'Scheduler', valor: badgeStatusCentral(serv.scheduler?.status) },
          { label: 'Timer', valor: badgeStatusCentral(serv.timer?.status) },
          { label: 'Sync', valor: badgeStatusCentral(serv.sync?.status), detalhe: formatarMsCentral(serv.sync?.tempoMs) },
          { label: 'SOAP', valor: badgeStatusCentral(serv.soap?.status) },
          { label: 'Parser', valor: badgeStatusCentral(serv.parser?.status) }
        ])}
      `, 'fa-cogs')}
      ${renderSecaoCentral('Banco de Dados', renderGridItensCentral([
        { label: 'Documentos', valor: banco.quantidadeDocumentos ?? 0 },
        { label: 'Pendências', valor: banco.pendencias ?? 0 },
        { label: 'Notas importadas', valor: banco.notasImportadas ?? 0 },
        { label: 'NSU salvo', valor: banco.nsuSalvo || '—' },
        { label: 'Tamanho aproximado', valor: formatarBytesCentral(banco.tamanhoAproximadoBytes) },
        { label: 'Última limpeza', valor: banco.ultimaLimpeza ? new Date(banco.ultimaLimpeza).toLocaleString('pt-BR') : '—' }
      ]), 'fa-database')}
      ${renderSecaoCentral('Performance', renderGridItensCentral([
        { label: 'Tempo médio sincronização', valor: formatarMsCentral(perf.tempoMedioSincronizacaoMs) },
        { label: 'Tempo médio Parser', valor: formatarMsCentral(perf.tempoMedioParserMs) },
        { label: 'Tempo médio MIIP', valor: formatarMsCentral(perf.tempoMedioMiipMs) },
        { label: 'Tempo médio Compra', valor: formatarMsCentral(perf.tempoMedioCompraMs) },
        { label: 'Tempo médio geral', valor: formatarMsCentral(perf.tempoMedioGeralMs) }
      ]), 'fa-tachometer-alt')}
      ${renderSecaoCentral('Health Check', renderHealthCheckCentral(dados.healthCheck), 'fa-check-circle')}
      ${renderSecaoCentral('Logs (últimos 50)', renderLogsCentral(dados.logs), 'fa-list')}
      ${renderSecaoCentral('Informações do Sistema', renderGridItensCentral([
        { label: 'Versão CDS', valor: sistema.versaoCds || '—' },
        { label: 'Versão Central', valor: sistema.versaoCentral || '—' },
        { label: 'Versão MIIP', valor: sistema.versaoMiip || '—' },
        { label: 'Versão Banco', valor: sistema.versaoBanco || '—' },
        { label: 'Build', valor: sistema.build || '—' },
        { label: 'Data compilação', valor: sistema.dataCompilacao ? new Date(sistema.dataCompilacao).toLocaleString('pt-BR') : '—' }
      ]), 'fa-info-circle')}
    </div>`;
}

function bindEventosDiagnosticoCentral() {
  $('#btnDiagAtualizar').off('click').on('click', () => carregarDiagnosticoCentral(true));
  $('#btnDiagSync').off('click').on('click', () => executarAcaoDiagnostico('/diagnostico/acoes/sincronizar', 'Sincronização iniciada.'));
  $('#btnDiagReprocessar').off('click').on('click', () => executarAcaoDiagnostico('/diagnostico/acoes/reprocessar-pendencias', 'Reprocessamento de pendências iniciado.'));
  $('#btnDiagCert').off('click').on('click', () => executarAcaoDiagnostico('/diagnostico/acoes/testar-certificado', 'Teste de certificado concluído.'));
  $('#btnDiagSefaz').off('click').on('click', () => executarAcaoDiagnostico('/diagnostico/acoes/testar-sefaz', 'Teste SEFAZ concluído.'));
  $('#btnDiagCache').off('click').on('click', () => executarAcaoDiagnostico('/diagnostico/acoes/limpar-cache', 'Cache limpo.'));
  $('#btnDiagHealth').off('click').on('click', async () => {
    try {
      const health = await centralDiagnosticoFetch('/diagnostico/health-check', { method: 'POST' });
      showNotification(health.todosOk ? 'Health Check: todos os componentes OK.' : 'Health Check: verifique componentes com erro.', health.todosOk ? 'success' : 'warning');
      await carregarDiagnosticoCentral(true);
    } catch (error) {
      showNotification(error.message, 'error');
    }
  });
}

async function executarAcaoDiagnostico(path, mensagemSucesso) {
  try {
    const resultado = await centralDiagnosticoFetch(path, { method: 'POST' });
    const ok = resultado.sucesso !== false;
    showNotification(ok ? mensagemSucesso : (resultado.mensagem || resultado.error || 'Ação concluída com avisos.'), ok ? 'success' : 'warning');
    await carregarDiagnosticoCentral(true);
  } catch (error) {
    showNotification(error.message, 'error');
  }
}

async function carregarDiagnosticoCentral(forcar = false) {
  if (centralDiagnosticoState.carregando) return;
  centralDiagnosticoState.carregando = true;

  const $content = $('#page-content');
  if (!centralDiagnosticoState.dados) {
    $content.html('<div class="text-center py-5"><div class="spinner-border text-primary"></div><p class="mt-2 text-muted">Carregando diagnóstico...</p></div>');
  }

  try {
    const query = forcar ? '?forcar=true' : '';
    const dados = await centralDiagnosticoFetch(`/diagnostico${query}`);
    centralDiagnosticoState.dados = dados;
    centralDiagnosticoState.ultimaAtualizacao = new Date();
    $content.html(renderPainelDiagnosticoCentral(dados));
    bindEventosDiagnosticoCentral();
  } catch (error) {
    if (error.status === 403) {
      $content.html('<div class="alert alert-warning">Acesso restrito: apenas ADMIN, SUPER_ADMIN ou SUPORTE.</div>');
    } else {
      $content.html(`<div class="alert alert-danger">Erro ao carregar diagnóstico: ${error.message}</div>`);
    }
  } finally {
    centralDiagnosticoState.carregando = false;
  }
}

function loadCentralDiagnostico() {
  if (typeof usuarioPodeAcessarDiagnosticoCentral === 'function' && !usuarioPodeAcessarDiagnosticoCentral()) {
    $('#page-content').html('<div class="alert alert-warning">Acesso restrito ao painel de diagnóstico.</div>');
    return;
  }
  carregarDiagnosticoCentral(false);
}

window.loadCentralDiagnostico = loadCentralDiagnostico;
window.carregarDiagnosticoCentral = carregarDiagnosticoCentral;
