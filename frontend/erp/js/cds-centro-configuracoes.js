/**
 * CDS Centro de Configurações — shell UX RC3.2
 * Somente interface: não altera regras fiscais, APIs nem persistência.
 * Depende de funções existentes em configuracoes.js / fiscal.js.
 */
(function (global) {
  'use strict';

  const CATEGORIAS = Object.freeze([
    { id: 'empresa', icon: 'fa-building', label: 'Empresa', keywords: 'implantação tipo erp cfop csosn origem cest padrão fiscal empresa validade controlar lote fefo' },
    { id: 'plataformaFiscal', icon: 'fa-university', label: 'Plataforma Fiscal', keywords: 'ambiente produção homologação certificado csc uf sefaz urls qrcode nfc-e nf-e contingência webservices diagnóstico fiscal', fiscal: true },
    { id: 'modulosLicenciados', icon: 'fa-puzzle-piece', label: 'Módulos Licenciados', keywords: 'pdv pedidos expedição faturamento entregas nfe nfce compra fácil marketplace crm invisibilidade' },
    { id: 'motores', icon: 'fa-brain', label: 'Motores Inteligentes', keywords: 'midp miip mib motor busca distribuição pagamentos ativar transferência estoque não fiscal fiscal pdv' },
    { id: 'equipamentos', icon: 'fa-cash-register', label: 'Equipamentos', keywords: 'tef pinpad equipamento' },
    { id: 'integracoes', icon: 'fa-plug', label: 'Integrações', keywords: 'pix tef pinpad automação bancária' },
    { id: 'licenciamentoCds', icon: 'fa-id-card', label: 'Licenciamento CDS', keywords: 'assinatura pix whatsapp renovação aviso dias mensagem qr code' },
    { id: 'seguranca', icon: 'fa-shield-alt', label: 'Segurança', keywords: 'confirmação fiscal tef manual certificado senha', fiscal: true },
    { id: 'bancoDados', icon: 'fa-database', label: 'Banco de Dados', keywords: 'rede ip porta cliente servidor local modo operação' },
    { id: 'performance', icon: 'fa-tachometer-alt', label: 'Performance', keywords: 'timeout retry sync performance' },
    { id: 'backup', icon: 'fa-hdd', label: 'Backup', keywords: 'backup restauração' },
    { id: 'implantacao', icon: 'fa-file-import', label: 'Implantação', keywords: 'importação inicial produtos xlsx migração implantação cliente base avançadas ferramentas validade controlar lote fefo' },
    { id: 'diagnostico', icon: 'fa-stethoscope', label: 'Diagnóstico', keywords: 'central sync nsu scheduler logs debug sefaz saúde mib busca', fiscal: true }
  ]);

  function configPermiteFiscalUi() {
    if (typeof global.fiscalHabilitado === 'function' && global.fiscalHabilitado()) return true;
    try {
      const sel = document.querySelector('input[name="tipoImplantacao"]:checked');
      const tipo = String(sel && sel.value || (global.configuracaoAvancadaServidor && global.configuracaoAvancadaServidor.tipoImplantacao) || '').toUpperCase();
      return tipo === 'ERP_FISCAL' || tipo === 'ERP_MULTICAIXA';
    } catch (e) {
      return false;
    }
  }

  function categoriasVisiveis() {
    const fiscalOn = configPermiteFiscalUi();
    return CATEGORIAS.filter((c) => !c.fiscal || fiscalOn);
  }

  let estadoExecutivo = {
    empresa: '—',
    cnpj: '—',
    ambiente: null,
    certificado: null,
    central: null,
    versao: '1.0.3',
    usuario: '—',
    ultimaAlteracao: '—'
  };

  function escapeHtml(value) {
    if (typeof global.escapeHtml === 'function') return global.escapeHtml(String(value ?? ''));
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function badge(texto, tone) {
    return `<span class="cds-cfg-badge cds-cfg-badge--${tone || 'neutral'}">${escapeHtml(texto)}</span>`;
  }

  function obterUsuarioNome() {
    try {
      const u = typeof global.obterUsuarioLogado === 'function' ? global.obterUsuarioLogado() : {};
      return u?.nome || u?.username || u?.usuario || '—';
    } catch {
      return '—';
    }
  }

  function toneAmbiente(code) {
    return Number(code) === 1 ? 'warn' : 'info';
  }

  function labelAmbiente(code) {
    return Number(code) === 1 ? 'Produção' : 'Homologação';
  }

  function renderKpi(id, label, value, detail, tone) {
    return `
      <div class="cds-cfg-kpi" data-exec-kpi="${escapeHtml(id)}">
        <div class="cds-cfg-kpi__head">
          <p class="cds-cfg-kpi__label">${escapeHtml(label)}</p>
          <span class="cds-cfg-dot" data-tone="${escapeHtml(tone || 'neutral')}"></span>
        </div>
        <p class="cds-cfg-kpi__value">${value}</p>
        <p class="cds-cfg-kpi__detail">${detail || ''}</p>
      </div>`;
  }

  function renderPainelExecutivo() {
    const e = estadoExecutivo;
    const amb = e.ambiente;
    const cert = e.certificado || {};
    const cen = e.central || {};
    const ambCode = amb != null ? Number(amb) : null;
    const certTone = cert.status === 'OK' ? 'ok' : (cert.status === 'A_VENCER' ? 'warn' : (cert.presente ? 'error' : 'neutral'));
    const certLabel = cert.status === 'OK' ? 'Válido' : (cert.status || (cert.presente ? 'Atenção' : 'Ausente'));
    const sefazOnline = cen.diagnostico?.ultimoErro ? 'warn' : 'ok';
    const syncLabel = cen.sincronizacao?.syncAutomaticaHabilitada ? 'Scheduler ativo' : 'Scheduler off';
    const fiscalUi = configPermiteFiscalUi();

    return `
      <div class="cds-cfg-exec" id="cdsCfgExecPanel" aria-label="Painel executivo da plataforma">
        ${renderKpi('empresa', 'Empresa', escapeHtml(e.empresa || '—'), `CNPJ ${escapeHtml(e.cnpj || '—')}`, e.cnpj && e.cnpj !== '—' ? 'ok' : 'warn')}
        ${fiscalUi ? `
        ${renderKpi('ambiente', 'Ambiente Fiscal', ambCode != null ? escapeHtml(labelAmbiente(ambCode)) : '—', 'Origem: Centro de Configurações', toneAmbiente(ambCode))}
        ${renderKpi('sefaz', 'SEFAZ', badge(cen.ambiente?.label || '—', sefazOnline === 'ok' ? 'ok' : 'warn'), 'Visão via Central / DF-e', sefazOnline)}
        ${renderKpi('cert', 'Certificado Digital', badge(certLabel, certTone), cert.validade ? `Validade: ${escapeHtml(String(cert.validade).slice(0, 10))} · ${cert.diasRestantes != null ? cert.diasRestantes + ' dias' : ''}` : (cert.mensagem || 'Configure na aba Fiscal'), certTone)}
        ${renderKpi('miip', 'MIIP', badge(cen.diagnostico?.versaoMiip || 'RC1', 'info'), 'Health via pipeline Central', 'ok')}
        ${renderKpi('plataforma', 'Plataforma Fiscal', badge('RC1.1', 'prep'), 'Registry · Resolver · SoapTransport', 'ok')}
        ${renderKpi('central', 'Central Inteligente', badge(syncLabel, cen.sincronizacao?.syncAutomaticaHabilitada ? 'ok' : 'neutral'), cen.diagnostico?.ultimaSincronizacao ? `Última sync: ${escapeHtml(String(cen.diagnostico.ultimaSincronizacao).slice(0, 19).replace('T', ' '))}` : 'Consome config fiscal oficial', 'ok')}
        ` : ''}
        ${renderKpi('servicos', 'Serviços', badge('Operacional', 'ok'), fiscalUi ? 'Parser · Motor Fiscal · Financeiro · Equipamentos' : 'Financeiro · Equipamentos · Comercial', 'ok')}
      </div>`;
  }

  function renderNav(ativa) {
    const cats = categoriasVisiveis();
    const ativaOk = cats.some((c) => c.id === ativa) ? ativa : (cats[0] && cats[0].id);
    return cats.map((c) => `
      <button type="button" class="cds-cfg-nav__item${c.id === ativaOk ? ' is-active' : ''}"
        data-cfg-nav="${c.id}" data-cfg-keywords="${escapeHtml(c.keywords)} ${escapeHtml(c.label)}">
        <i class="fas ${c.icon}"></i><span>${escapeHtml(c.label)}</span>
      </button>`).join('');
  }

  function card(title, body, search, extraClass) {
    return `
      <div class="cds-cfg-card${extraClass ? ' ' + extraClass : ''}" data-cfg-search="${escapeHtml(search || title)}">
        <div class="cds-cfg-card__title">${title}</div>
        ${body}
      </div>`;
  }

  function renderPanes(config) {
    const tipo = String(config.tipoImplantacao || 'ERP_SEM_FISCAL').toUpperCase();
    const modo = String(config.modoOperacao || 'LOCAL').toUpperCase();
    const modoConfirmacaoFiscal = String(config.modo_confirmacao_fiscal || 'TEF').toUpperCase();
    const ipServidor = config.ipServidor || '';
    const porta = Number(config.porta) > 0 ? Number(config.porta) : 3001;
    const clienteServidorDisponivel = tipo === 'ERP_MULTICAIXA';
    const vendasEntregaOn = config.habilitar_vendas_entrega === true
      || (config.recursos && config.recursos.vendasEntrega === true);
    const faturamentoOn = (config.recursos && (config.recursos.expedicao === true || config.recursos.faturamento === true))
      || config.habilitar_expedicao === true
      || config.habilitar_faturamento === true;
    const midpOn = config.ativar_midp === true;
    const rec = config.recursos || {};
    const pdvOn = rec.pdv !== false && config.modulo_pdv !== false;
    const pedidosOn = rec.pedidos === true || (config.modulo_pedidos === true) || (config.modulo_pedidos == null && faturamentoOn);
    // Histórico acompanha PDV quando a flag ainda não foi definida.
    const historicoOn = rec.historicoVendas === true
      || config.modulo_historico_vendas === true
      || (rec.historicoVendas == null && config.modulo_historico_vendas == null && pdvOn);
    const nfeOn = rec.nfe === true || config.modulo_nfe === true;
    const nfceOn = rec.nfce === true || config.modulo_nfce === true;
    const compraFacilOn = config.modulo_compra_facil === true || rec.compraFacil === true;
    const marketplaceOn = config.modulo_marketplace === true || rec.marketplace === true;
    const crmOn = config.modulo_crm === true || rec.crm === true;
    const licDias = Number(config.licenca_dias_aviso || 3);
    const licPix = config.licenca_chave_pix || '';
    const licWa = config.licenca_whatsapp_url || '';
    const licMsg = config.licenca_mensagem_renovacao
      || 'Sua assinatura do CDS Sistemas expira em {dias} dias.';
    const licPlano = config.licenca_plano || '';
    const fiscalUi = configPermiteFiscalUi();

    return `
      <div class="cds-cfg-pane is-active" data-cfg-pane="empresa">
        <h2 class="cds-cfg-pane__title">Empresa</h2>
        <p class="cds-cfg-pane__sub">Tipo de implantação e padrões contábeis.${fiscalUi ? ' Cadastro fiscal oficial fica em Plataforma Fiscal.' : ''}</p>
        ${card('<i class="fas fa-layer-group"></i> Tipo de Implantação', `
          <div class="form-check mb-2" data-cfg-search="erp sem fiscal">
            <input class="form-check-input" type="radio" name="tipoImplantacao" id="tipoSemFiscal" value="ERP_SEM_FISCAL" ${tipo === 'ERP_SEM_FISCAL' ? 'checked' : ''}>
            <label class="form-check-label" for="tipoSemFiscal">ERP Sem Fiscal</label>
          </div>
          <div class="form-check mb-2" data-cfg-search="erp fiscal">
            <input class="form-check-input" type="radio" name="tipoImplantacao" id="tipoFiscal" value="ERP_FISCAL" ${tipo === 'ERP_FISCAL' ? 'checked' : ''}>
            <label class="form-check-label" for="tipoFiscal">ERP Fiscal</label>
          </div>
          <div class="form-check" data-cfg-search="multi-caixa multicaixa">
            <input class="form-check-input" type="radio" name="tipoImplantacao" id="tipoMulticaixa" value="ERP_MULTICAIXA" ${tipo === 'ERP_MULTICAIXA' ? 'checked' : ''}>
            <label class="form-check-label" for="tipoMulticaixa">ERP Multi-Caixa</label>
          </div>
        `, 'implantação tipo erp')}
        ${card('<i class="fas fa-calendar-times"></i> Validade de produtos', `
          <p class="cds-cfg-hint mb-3">
            Somente <strong>Super Usuário</strong>.
            <strong>ATIVADO</strong> (padrão): cada produto marca “Controlar validade”.
            <strong>DESATIVADO</strong>: a empresa não controla validade — produtos marcados são desmarcados na hora (continuam à venda).
          </p>
          <label class="form-label" for="cfgEmpresaControlaValidade">Empresa controla validade</label>
          <select class="form-select mb-2" id="cfgEmpresaControlaValidade" data-cfg-search="validade controlar lote fefo">
            <option value="ATIVADO">ATIVADO — controla validade (produto a produto)</option>
            <option value="DESATIVADO">DESATIVADO — não controla validade</option>
          </select>
          <div class="cds-cfg-actions">
            <button type="button" class="btn btn-warning btn-sm" id="btnNaoControlarValidadeEmpresa">
              <i class="fas fa-ban"></i> Não controlar validade
            </button>
            <button type="button" class="btn btn-primary btn-sm" id="btnSalvarEmpresaControlaValidade">
              <i class="fas fa-save"></i> Salvar
            </button>
          </div>
        `, 'validade controlar lote fefo empresa')}
        ${fiscalUi ? `<div class="cds-cfg-note">Razão social, CNPJ, IE e certificado são editados em <strong>Plataforma Fiscal</strong> (Super Usuário).</div>
        <div id="secaoPadraoFiscalEmpresa">
          ${card('<i class="fas fa-file-invoice"></i> Padrão Fiscal da Empresa', `
            <p class="cds-cfg-hint mb-3">
              Ao salvar, o <strong>CFOP</strong> e o <strong>CSOSN</strong> são gravados em <strong>todos os produtos cadastrados</strong>.
              Origem e CEST continuam só como padrão para novos produtos.
            </p>
            <div class="row g-3">
              <div class="col-md-3" data-cfg-search="cfop">
                <label for="padraoCfop" class="cds-cfg-label">CFOP</label>
                <input type="text" class="form-control" id="padraoCfop" value="${escapeHtml(config.cfop_padrao || '')}" placeholder="Ex.: 5405">
              </div>
              <div class="col-md-3" data-cfg-search="csosn">
                <label for="padraoCsosn" class="cds-cfg-label">CSOSN</label>
                <input type="text" class="form-control" id="padraoCsosn" value="${escapeHtml(config.csosn_padrao || '')}" placeholder="Ex.: 500">
              </div>
              <div class="col-md-3" data-cfg-search="origem">
                <label for="padraoOrigem" class="cds-cfg-label">Origem</label>
                <input type="text" class="form-control" id="padraoOrigem" value="${escapeHtml(config.origem_padrao || '')}" placeholder="Ex.: 0">
              </div>
              <div class="col-md-3" data-cfg-search="cest">
                <label for="padraoCest" class="cds-cfg-label">CEST</label>
                <input type="text" class="form-control" id="padraoCest" value="${escapeHtml(config.cest_padrao || '')}" placeholder="Ex.: 0300100">
              </div>
            </div>
            <div class="cds-cfg-actions">
              <button type="button" class="btn btn-success btn-sm" onclick="salvarPadraoFiscalEmpresa()">
                <i class="fas fa-save"></i> Salvar padrão
              </button>
            </div>
          `, 'cfop csosn origem cest padrão fiscal')}
          ${card('<i class="fas fa-gift"></i> Entrada por Bonificação', `
            <p class="cds-cfg-hint mb-3">Parâmetros aplicados a itens bonificados (CFOP 5910/5949 ou tipo Bonificação).</p>
            <div class="row g-3">
              <div class="col-md-2" data-cfg-search="bonificação cfop">
                <label for="bonifCfopPadrao" class="cds-cfg-label">CFOP padrão</label>
                <input type="text" class="form-control" id="bonifCfopPadrao" maxlength="4"
                  value="${escapeHtml(config.entrada_bonificacao_cfop_padrao || '5910')}" placeholder="5910">
              </div>
              <div class="col-md-2" data-cfg-search="bonificação csosn cst">
                <label for="bonifCsosnPadrao" class="cds-cfg-label">CSOSN/CST padrão</label>
                <input type="text" class="form-control" id="bonifCsosnPadrao"
                  value="${escapeHtml(config.entrada_bonificacao_csosn_padrao || '')}" placeholder="Ex.: 400">
              </div>
              <div class="col-md-4" data-cfg-search="bonificação natureza operação">
                <label for="bonifNatureza" class="cds-cfg-label">Natureza da operação</label>
                <input type="text" class="form-control" id="bonifNatureza"
                  value="${escapeHtml(config.entrada_bonificacao_natureza || 'Bonificação recebida')}"
                  placeholder="Bonificação recebida">
              </div>
              <div class="col-md-2" data-cfg-search="bonificação estoque">
                <div class="form-check mt-4">
                  <input class="form-check-input" type="checkbox" id="bonifGerarEstoque"
                    ${config.entrada_bonificacao_gerar_estoque !== false ? 'checked' : ''}>
                  <label class="form-check-label" for="bonifGerarEstoque">Gerar estoque</label>
                </div>
              </div>
              <div class="col-md-2" data-cfg-search="bonificação custo">
                <div class="form-check mt-4">
                  <input class="form-check-input" type="checkbox" id="bonifAtualizarCusto"
                    ${config.entrada_bonificacao_atualizar_custo === true ? 'checked' : ''}>
                  <label class="form-check-label" for="bonifAtualizarCusto">Atualizar custo</label>
                </div>
              </div>
            </div>
            <div class="cds-cfg-actions">
              <button type="button" class="btn btn-success btn-sm" onclick="salvarPadraoFiscalEmpresa()">
                <i class="fas fa-save"></i> Salvar padrão
              </button>
            </div>
          `, 'bonificação brinde entrada estoque custo cfop')}
        </div>` : ''}
      </div>

      ${fiscalUi ? `
      <div class="cds-cfg-pane" data-cfg-pane="plataformaFiscal">
        <h2 class="cds-cfg-pane__title">Plataforma Fiscal</h2>
        <p class="cds-cfg-pane__sub">Única fonte oficial — Super Usuário. Ambiente, série, CSC, certificado, contingência e WebServices.</p>
        <div class="cds-cfg-note">
          ${badge('Fonte oficial Sprint 3.9', 'ok')}
          <span class="ms-2">Acesso restrito a SUPER_ADMIN.</span>
        </div>
        <div id="secaoConfigFiscalAvancadas">
          <p class="text-muted small" id="msgConfigFiscalIndisponivel" style="display:none;">
            Selecione ERP Fiscal ou ERP Multi-Caixa em Empresa para configurar os parâmetros fiscais.
          </p>
          <div class="cds-cfg-card mb-3" id="cdsCfgFechamentoFiscalDia"
               data-cfg-search="fechamento fiscal do dia permitir on off">
            <div class="cds-cfg-card__title"><i class="fas fa-balance-scale"></i> Fechamento Fiscal do Dia</div>
            <p class="cds-cfg-hint mb-3">
              Única chave ON/OFF do módulo completo (prévia, preparação e transmissão).
              Em PRODUÇÃO a transmissão usa o Motor Fiscal oficial quando a configuração estiver válida.
              Homologação permanece disponível para testes.
            </p>
            <div class="form-check form-switch mb-2">
              <input class="form-check-input" type="checkbox" id="cfgFechamentoFiscalDiaOn">
              <label class="form-check-label" for="cfgFechamentoFiscalDiaOn">Permitir Fechamento Fiscal do Dia</label>
            </div>
            <div class="cds-cfg-actions">
              <button type="button" class="btn btn-success btn-sm" id="btnSalvarFechamentoFiscalDia">
                <i class="fas fa-save"></i> Salvar
              </button>
              <span id="cdsFfDiaSaveFeedback" class="cds-cfg-hint ms-2"></span>
            </div>
          </div>
          <div id="fiscal-config-form-area-avancadas" class="cds-cfg-fiscal-grid" data-cfg-search="ambiente certificado csc produção homologação série token contingência">
            <div class="text-center py-4 text-muted">
              <i class="fas fa-spinner fa-spin me-2"></i> Carregando configuração fiscal...
            </div>
          </div>
        </div>
        <div class="mt-3" id="cdsCfgSecaoManifestacao">
          <div class="cds-cfg-card cds-cfg-card--manifestacao" id="cdsCfgCardManifestacao"
               data-cfg-search="manifestação destinatário ciência 210210 automática manual confirmação">
            <div class="cds-cfg-card__title"><i class="fas fa-file-signature"></i> Manifestação do Destinatário</div>
            <p class="cds-cfg-hint mb-3">
              Define como a Central Inteligente enviará o evento Ciência da Emissão (210210) durante o ciclo DF-e.
              Esta configuração afeta apenas futuras sincronizações.
            </p>
            <p class="cds-cfg-label mb-2">Modo da Manifestação</p>
            <div class="form-check mb-2" data-cfg-search="manifestação manual">
              <input class="form-check-input" type="radio" name="cdsPoliticaManifestacao" id="cdsManifManual" value="MANUAL">
              <label class="form-check-label" for="cdsManifManual">Manual</label>
            </div>
            <div class="form-check mb-2" data-cfg-search="manifestação automática ciência">
              <input class="form-check-input" type="radio" name="cdsPoliticaManifestacao" id="cdsManifAuto" value="AUTOMATICA_CIENCIA">
              <label class="form-check-label" for="cdsManifAuto">Automática (Ciência da Emissão)</label>
            </div>
            <div class="form-check mb-3" data-cfg-search="manifestação confirmação operador">
              <input class="form-check-input" type="radio" name="cdsPoliticaManifestacao" id="cdsManifConfirmar" value="CONFIRMAR_OPERADOR">
              <label class="form-check-label" for="cdsManifConfirmar">Solicitar confirmação do operador</label>
            </div>
            <div class="cds-cfg-note mb-3">
              Persistência oficial: <code>central_entradas_config</code> → <code>manifestacao_destinatario_politica</code>
              · API <code>PUT /api/central-entradas/configuracao</code>
            </div>
            <div class="cds-cfg-actions">
              <button type="button" class="btn btn-success btn-sm" id="btnSalvarPoliticaManifestacao">
                <i class="fas fa-save"></i> Salvar política
              </button>
              <span id="cdsManifSaveFeedback" class="cds-cfg-hint ms-2"></span>
            </div>
          </div>
        </div>
      </div>

      <div class="cds-cfg-pane" data-cfg-pane="plataformaFiscalRuntime" style="display:none" aria-hidden="true">
        <h2 class="cds-cfg-pane__title">Runtime Fiscal</h2>
        <p class="cds-cfg-pane__sub">Visão somente leitura da plataforma (Registry, Resolver, Transport).</p>
        <div class="row g-3">
          <div class="col-md-6">${card('Registry', `<div class="cds-cfg-kpi__value">Ativo</div><p class="cds-cfg-hint mb-0">Catálogo de endpoints SEFAZ por modelo/operação/ambiente.</p>`, 'registry')}</div>
          <div class="col-md-6">${card('UrlResolver', `<div class="cds-cfg-kpi__value">Ativo</div><p class="cds-cfg-hint mb-0">Resolve URL a partir do contexto (recebe ambiente por parâmetro).</p>`, 'resolver')}</div>
          <div class="col-md-6">${card('SoapTransport', `<div class="cds-cfg-kpi__value">Ativo</div><p class="cds-cfg-hint mb-0">Transporte SOAP oficial. Sem edição nesta tela.</p>`, 'soap transport')}</div>
          <div class="col-md-6">${card('Enablement / Health', `${badge('RC1.1', 'prep')} ${badge('Somente leitura', 'neutral')}<p class="cds-cfg-hint mt-2 mb-0">Fallback e Confidence Score são internos da plataforma — não editáveis.</p>`, 'fallback confidence enablement health')}</div>
        </div>
        <div class="cds-cfg-note">Ambiente SEFAZ utilizado pela plataforma: o mesmo de <strong>Fiscal</strong> (getFiscalConfig).</div>
      </div>

      <div class="cds-cfg-pane" data-cfg-pane="diagnostico">
        <h2 class="cds-cfg-pane__title">Diagnóstico</h2>
        <p class="cds-cfg-pane__sub">Central Inteligente e saúde da plataforma (somente leitura operacional).</p>
        <div class="cds-cfg-note">
          Ambiente, UF, certificado e Manifestação: origem em <strong>Plataforma Fiscal</strong>.
        </div>
        <div class="row g-3" id="cdsCfgCentralReadonly">
          <div class="col-md-6">${card('Ambiente (somente leitura)', `<div id="cdsCfgCentralAmbiente">—</div>`, 'ambiente produção homologação')}</div>
          <div class="col-md-6">${card('UF emitente (somente leitura)', `<div id="cdsCfgCentralUf">—</div>`, 'uf')}</div>
          <div class="col-md-6">${card('Certificado (visão)', `<div id="cdsCfgCentralCert">—</div>`, 'certificado')}</div>
          <div class="col-md-6">${card('Sincronização / Scheduler', `<div id="cdsCfgCentralSync">—</div>`, 'scheduler sync nsu timeout')}</div>
        </div>
        <div class="cds-cfg-actions">
          <button type="button" class="btn btn-primary btn-sm" id="btnAbrirConfigFiscalOficial">
            <i class="fas fa-file-invoice"></i> Abrir Plataforma Fiscal
          </button>
          <button type="button" class="btn btn-outline-secondary btn-sm" onclick="typeof loadPage==='function'&&loadPage('central-entradas')">
            <i class="fas fa-inbox"></i> Abrir Central Inteligente
          </button>
        </div>

        <hr class="my-4">
        <h3 class="h6 mb-2"><i class="fas fa-search me-1"></i> Motor Cognitivo de Busca (MIB)</h3>
        <p class="cds-cfg-hint mb-3">MIB-RC2.0 — aprendizado, fuzzy, sinônimos, ranking adaptativo e SearchAI.</p>
        <ul class="nav nav-tabs mb-3" id="mibDiagTabs" role="tablist">
          <li class="nav-item"><button class="nav-link active" data-mib-tab="basico" type="button">Geral</button></li>
          <li class="nav-item"><button class="nav-link" data-mib-tab="avancado" type="button">MIB Avançado</button></li>
          <li class="nav-item"><button class="nav-link" data-mib-tab="cognitivo" type="button">Cognitivo RC2</button></li>
        </ul>
        <div id="mibPaneBasico">
          <div class="row g-3" id="cdsCfgMibDiag">
            <div class="col-md-3">${card('Status', `<div class="cds-cfg-kpi__value" id="mibDiagStatus">—</div>`, 'mib health')}</div>
            <div class="col-md-3">${card('Tempo médio', `<div class="cds-cfg-kpi__value" id="mibDiagTempoMedio">—</div>`, 'mib tempo')}</div>
            <div class="col-md-3">${card('Cache Hit / Miss', `<div class="cds-cfg-kpi__value" id="mibDiagCache">—</div>`, 'mib cache')}</div>
            <div class="col-md-3">${card('Produtos em RAM', `<div class="cds-cfg-kpi__value" id="mibDiagProdutos">—</div>`, 'mib catalogo')}</div>
            <div class="col-md-3">${card('HotCache hits', `<div class="cds-cfg-kpi__value" id="mibDiagHot">—</div>`, 'mib hotcache')}</div>
            <div class="col-md-3">${card('Consultas / min', `<div class="cds-cfg-kpi__value" id="mibDiagCpm">—</div>`, 'mib consultas')}</div>
            <div class="col-md-3">${card('RAM (heap)', `<div class="cds-cfg-kpi__value" id="mibDiagRam">—</div>`, 'mib ram')}</div>
            <div class="col-md-3">${card('Versão catálogo', `<div class="cds-cfg-kpi__value" id="mibDiagVersao">—</div>`, 'mib versao')}</div>
          </div>
        </div>
        <div id="mibPaneAvancado" class="d-none">
          <div class="row g-3">
            <div class="col-md-3">${card('Tempo construção', `<div class="cds-cfg-kpi__value" id="mibAdvBuild">—</div>`, 'mib build')}</div>
            <div class="col-md-3">${card('Tempo médio SQL', `<div class="cds-cfg-kpi__value" id="mibAdvSql">—</div>`, 'mib sql')}</div>
            <div class="col-md-3">${card('Tempo médio Cache', `<div class="cds-cfg-kpi__value" id="mibAdvCacheMs">—</div>`, 'mib cache ms')}</div>
            <div class="col-md-3">${card('Swaps', `<div class="cds-cfg-kpi__value" id="mibAdvSwaps">—</div>`, 'mib swap')}</div>
            <div class="col-md-3">${card('Atualizações', `<div class="cds-cfg-kpi__value" id="mibAdvUpdates">—</div>`, 'mib updates')}</div>
            <div class="col-md-3">${card('HotCache size', `<div class="cds-cfg-kpi__value" id="mibAdvHotSize">—</div>`, 'mib hot size')}</div>
            <div class="col-md-3">${card('Estado Engine', `<div class="cds-cfg-kpi__value" id="mibAdvEstado">—</div>`, 'mib estado')}</div>
            <div class="col-md-3">${card('Last Swap', `<div class="cds-cfg-kpi__value small" id="mibAdvLastSwap">—</div>`, 'mib last swap')}</div>
          </div>
          <div class="mt-3" id="mibConfigForm">
            <h4 class="h6">Configurações</h4>
            <div class="row g-2">
              <div class="col-md-3"><label class="form-label small">Refresh (ms)</label><input type="number" class="form-control form-control-sm" id="mibCfgRefresh" min="50"></div>
              <div class="col-md-3"><label class="form-label small">Limite Cache</label><input type="number" class="form-control form-control-sm" id="mibCfgCache" min="50"></div>
              <div class="col-md-3"><label class="form-label small">Limite RAM (MB)</label><input type="number" class="form-control form-control-sm" id="mibCfgRam" min="128"></div>
              <div class="col-md-3"><label class="form-label small">HotCache</label><input type="number" class="form-control form-control-sm" id="mibCfgHot" min="10"></div>
            </div>
            <div class="form-check form-check-inline mt-2"><input class="form-check-input" type="checkbox" id="mibCfgAuto"><label class="form-check-label small" for="mibCfgAuto">Atualização automática</label></div>
            <div class="form-check form-check-inline mt-2"><input class="form-check-input" type="checkbox" id="mibCfgStats"><label class="form-check-label small" for="mibCfgStats">Estatísticas</label></div>
            <div class="form-check form-check-inline mt-2"><input class="form-check-input" type="checkbox" id="mibCfgBench"><label class="form-check-label small" for="mibCfgBench">Benchmark</label></div>
            <div class="form-check form-check-inline mt-2"><input class="form-check-input" type="checkbox" id="mibCfgDev"><label class="form-check-label small" for="mibCfgDev">Modo desenvolvimento</label></div>
            <button type="button" class="btn btn-sm btn-primary ms-2" id="btnMibSalvarConfig">Salvar config</button>
          </div>
          <pre class="small bg-light border rounded p-2 mt-2" id="mibHistBench" style="max-height:160px;overflow:auto">Histórico benchmark…</pre>
        </div>
        <div id="mibPaneCognitivo" class="d-none">
          <h4 class="h6">Motor Cognitivo</h4>
          <div class="form-check form-check-inline mt-1"><input class="form-check-input" type="checkbox" id="mibCfgAprendizado"><label class="form-check-label small" for="mibCfgAprendizado">Ativar Aprendizado</label></div>
          <div class="form-check form-check-inline mt-1"><input class="form-check-input" type="checkbox" id="mibCfgFuzzy"><label class="form-check-label small" for="mibCfgFuzzy">Ativar Fuzzy</label></div>
          <div class="form-check form-check-inline mt-1"><input class="form-check-input" type="checkbox" id="mibCfgSinonimos"><label class="form-check-label small" for="mibCfgSinonimos">Ativar Sinônimos</label></div>
          <div class="form-check form-check-inline mt-1"><input class="form-check-input" type="checkbox" id="mibCfgAutoCorr"><label class="form-check-label small" for="mibCfgAutoCorr">Ativar Auto Correção</label></div>
          <div class="row g-2 mt-2">
            <div class="col-md-3"><label class="form-label small">Sensibilidade Levenshtein</label><input type="number" class="form-control form-control-sm" id="mibCfgLevenshtein" min="1" max="5"></div>
            <div class="col-md-3"><label class="form-label small">Limite Histórico</label><input type="number" class="form-control form-control-sm" id="mibCfgHist" min="100"></div>
            <div class="col-md-3"><label class="form-label small">Retenção (dias)</label><input type="number" class="form-control form-control-sm" id="mibCfgRetencao" min="7"></div>
            <div class="col-md-3"><label class="form-label small">Limite Preferência</label><input type="number" class="form-control form-control-sm" id="mibCfgPref" min="2" max="20"></div>
          </div>
          <div class="cds-cfg-actions mt-3">
            <button type="button" class="btn btn-sm btn-primary" id="btnMibSalvarCognitivo">Salvar cognitivo</button>
            <button type="button" class="btn btn-sm btn-outline-secondary" id="btnMibRetrain">Retrain</button>
            <button type="button" class="btn btn-sm btn-outline-danger" id="btnMibResetLearn">Reset Aprendizado</button>
            <button type="button" class="btn btn-sm btn-outline-primary" onclick="typeof loadPage==='function'&&loadPage('mib-analytics')"><i class="fas fa-chart-bar"></i> MIB Analytics</button>
          </div>
        </div>
        <div class="cds-cfg-actions mt-2">
          <button type="button" class="btn btn-outline-primary btn-sm" id="btnMibAtualizarDiag"><i class="fas fa-sync"></i> Atualizar</button>
          <button type="button" class="btn btn-outline-secondary btn-sm" id="btnMibBenchmark"><i class="fas fa-tachometer-alt"></i> Benchmark</button>
          <button type="button" class="btn btn-outline-secondary btn-sm" id="btnMibRefresh"><i class="fas fa-bolt"></i> Refresh</button>
          <button type="button" class="btn btn-outline-secondary btn-sm" id="btnMibRecarregarCat"><i class="fas fa-database"></i> Rebuild</button>
          <button type="button" class="btn btn-outline-secondary btn-sm" id="btnMibHotRebuild"><i class="fas fa-fire"></i> HotCache</button>
        </div>
        <pre class="small bg-light border rounded p-2 mt-2 d-none" id="mibBenchmarkOut" style="max-height:220px;overflow:auto"></pre>
      </div>
      ` : ''}

      <div class="cds-cfg-pane" data-cfg-pane="equipamentos">
        <h2 class="cds-cfg-pane__title">Equipamentos</h2>
        <p class="cds-cfg-pane__sub">Atalhos para módulos de equipamentos (sem alterar regras).</p>
        ${card('<i class="fas fa-credit-card"></i> TEF e PinPad', `
          <p class="cds-cfg-hint">Configuração de adquirentes, APIs e PinPads.</p>
          <button type="button" class="btn btn-primary btn-sm" id="btnConfiguracaoTEF">
            <i class="fas fa-credit-card"></i> Abrir configuração TEF
          </button>
        `, 'tef pinpad equipamento')}
      </div>

      <div class="cds-cfg-pane" data-cfg-pane="integracoes">
        <h2 class="cds-cfg-pane__title">Integrações</h2>
        <p class="cds-cfg-pane__sub">Pix automático e TEF.</p>
        ${card('<i class="fas fa-qrcode"></i> Pix Automático', `
          <div class="form-check form-switch mb-3" data-cfg-search="pix automático">
            <input class="form-check-input" type="checkbox" id="togglePixAutomatico" onchange="alterarPixAutomatico()">
            <label class="form-check-label fw-bold" for="togglePixAutomatico">Ativar automação bancária Pix</label>
          </div>
          <p class="cds-cfg-hint">Quando ativado, o sistema gera QR Code Pix automático e confirma o pagamento.</p>
          <div id="containerBotaoPixAutomatico" style="display:none;">
            <button type="button" class="btn btn-success btn-sm" onclick="abrirModalPixAutomatico()">
              <i class="fas fa-qrcode"></i> Configurar Pix Automático
            </button>
          </div>
        `, 'pix')}
        ${card('<i class="fas fa-credit-card"></i> TEF', `
          <button type="button" class="btn btn-outline-primary btn-sm" id="btnConfiguracaoTEFIntegracoes">
            <i class="fas fa-credit-card"></i> Abrir TEF
          </button>
        `, 'tef')}
      </div>

      ${fiscalUi ? `
      <div class="cds-cfg-pane" data-cfg-pane="seguranca">
        <h2 class="cds-cfg-pane__title">Segurança</h2>
        <p class="cds-cfg-pane__sub">Confirmação fiscal no PDV. Certificado digital na aba Fiscal.</p>
        ${card('Confirmação Fiscal', `
          <p class="cds-cfg-hint mb-2">Define como o PDV confirma o recebimento fiscal antes da NFC-e.</p>
          <div class="form-check" data-cfg-search="confirmação tef">
            <input class="form-check-input" type="radio" name="modoConfirmacaoFiscal" id="confirmacaoFiscalTef" value="TEF" ${modoConfirmacaoFiscal === 'TEF' ? 'checked' : ''}>
            <label class="form-check-label" for="confirmacaoFiscalTef">TEF</label>
          </div>
          <div class="form-check" data-cfg-search="confirmação manual">
            <input class="form-check-input" type="radio" name="modoConfirmacaoFiscal" id="confirmacaoFiscalManual" value="MANUAL" ${modoConfirmacaoFiscal === 'MANUAL' ? 'checked' : ''}>
            <label class="form-check-label" for="confirmacaoFiscalManual">Manual</label>
          </div>
        `, 'confirmação fiscal segurança')}
        <div class="cds-cfg-note">Certificado A1 e senha: edite em <strong>Fiscal</strong> (fonte oficial).</div>
      </div>
      ` : ''}

      <div class="cds-cfg-pane" data-cfg-pane="performance">
        <h2 class="cds-cfg-pane__title">Performance</h2>
        <p class="cds-cfg-pane__sub">Visão dos timeouts operacionais (editáveis na Central Inteligente).</p>
        <div id="cdsCfgPerformanceCards">
          ${card('Timeouts / Retries', `<div id="cdsCfgPerfTimeouts" class="text-muted">Carregando…</div>`, 'timeout retry performance')}
        </div>
        <div class="cds-cfg-actions">
          <button type="button" class="btn btn-outline-secondary btn-sm" onclick="typeof loadPage==='function'&&loadPage('central-entradas')">
            Ajustar na Central Inteligente
          </button>
        </div>
      </div>

      <div class="cds-cfg-pane" data-cfg-pane="backup">
        <h2 class="cds-cfg-pane__title">Backup</h2>
        <p class="cds-cfg-pane__sub">Rotinas de backup e manutenção da base (Super Usuário).</p>
        ${card('<i class="fas fa-database"></i> Backup e Manutenção', `
          <div class="d-flex flex-wrap gap-2 mb-2">
            <button type="button" id="btnBackupManual" class="btn btn-success btn-sm">
              <i class="fas fa-database"></i> Backup Manual DB
            </button>
            <button type="button" id="btnEscolherPasta" class="btn btn-info btn-sm" onclick="escolherPastaBackup()">
              <i class="fas fa-folder-open"></i> Escolher Pasta
            </button>
            <button type="button" class="btn btn-warning btn-sm" onclick="limparCache()">
              <i class="fas fa-trash"></i> Limpar Cache
            </button>
          </div>
          <div id="pastaAtual" class="cds-cfg-hint"></div>
          <div id="resultadoBackup" class="mt-2"></div>
        `, 'backup restauração pasta')}
      </div>

      <div class="cds-cfg-pane" data-cfg-pane="implantacao">
        <h2 class="cds-cfg-pane__title">Implantação</h2>
        <p class="cds-cfg-pane__sub">Ferramentas avançadas de implantação inicial do cliente (Super Usuário).</p>
        ${card('<i class="fas fa-file-excel text-success"></i> Importação Inicial de Produtos', `
          <p class="cds-cfg-hint mb-3">Importe produtos e registre o estoque inicial informado no arquivo XLSX.</p>
          <button type="button" class="btn btn-success btn-sm" id="btnAbrirImportacaoInicialProdutos"
            onclick="typeof loadPage==='function'&&loadPage('importacao-inicial-produtos')">
            <i class="fas fa-file-excel"></i> Abrir Importação Inicial de Produtos
          </button>
        `, 'importação inicial produtos xlsx implantação')}
        ${card('<i class="fas fa-calendar-times"></i> Validade de produtos', `
          <p class="cds-cfg-hint mb-0">O botão <strong>Não controlar validade</strong> fica na aba <strong>Empresa</strong> (primeira tela deste Centro).</p>
        `, 'validade controlar lote fefo empresa')}
        ${card('<i class="fas fa-database"></i> Próximas ferramentas', `
          <p class="cds-cfg-hint mb-2 text-muted">Em breve (não disponíveis nesta versão):</p>
          <ul class="cds-cfg-hint mb-0 text-muted">
            <li>Migração de Banco Antigo</li>
            <li>Importação de CSV</li>
            <li>Importação de XML</li>
          </ul>
        `, 'migração banco antigo csv xml futuro')}
      </div>

      <div class="cds-cfg-pane" data-cfg-pane="modulosLicenciados">
        <h2 class="cds-cfg-pane__title">Módulos Licenciados</h2>
        <p class="cds-cfg-pane__sub">Princípio da invisibilidade: módulo desligado desaparece de menus, APIs e widgets.</p>
        ${card('<i class="fas fa-puzzle-piece"></i> Checklist de módulos', `
          <p class="cds-cfg-hint mb-3">Desmarque para ocultar o módulo em todo o sistema (403 MODULO_NAO_LICENCIADO nas APIs).</p>
          <p class="cds-cfg-hint mb-3"><strong>Expedição</strong> é módulo comercial (Pedido → Venda). Não depende de Fiscal, NF-e ou NFC-e.</p>
          <div class="row g-2">
            <div class="col-md-6"><div class="form-check"><input class="form-check-input" type="checkbox" id="cfgModuloPdv" ${pdvOn ? 'checked' : ''}><label class="form-check-label" for="cfgModuloPdv">PDV</label></div></div>
            <div class="col-md-6"><div class="form-check"><input class="form-check-input" type="checkbox" id="cfgModuloHistoricoVendas" ${historicoOn ? 'checked' : ''}><label class="form-check-label" for="cfgModuloHistoricoVendas">Histórico de Vendas</label></div></div>
            <div class="col-md-6"><div class="form-check"><input class="form-check-input" type="checkbox" id="cfgModuloPedidos" ${pedidosOn ? 'checked' : ''}><label class="form-check-label" for="cfgModuloPedidos">Pedidos</label></div></div>
            <div class="col-md-6"><div class="form-check"><input class="form-check-input" type="checkbox" id="cfgHabilitarFaturamento" ${faturamentoOn ? 'checked' : ''}><label class="form-check-label" for="cfgHabilitarFaturamento">Expedição</label></div></div>
            <div class="col-md-6"><div class="form-check"><input class="form-check-input" type="checkbox" id="cfgHabilitarVendasEntrega" ${vendasEntregaOn ? 'checked' : ''}><label class="form-check-label" for="cfgHabilitarVendasEntrega">Entregas</label></div></div>
            ${fiscalUi ? `
            <div class="col-md-6"><div class="form-check"><input class="form-check-input" type="checkbox" id="cfgModuloNfe" ${nfeOn ? 'checked' : ''}><label class="form-check-label" for="cfgModuloNfe">NF-e</label></div></div>
            <div class="col-md-6"><div class="form-check"><input class="form-check-input" type="checkbox" id="cfgModuloNfce" ${nfceOn ? 'checked' : ''}><label class="form-check-label" for="cfgModuloNfce">NFC-e</label></div></div>
            ` : ''}
            <div class="col-md-6"><div class="form-check"><input class="form-check-input" type="checkbox" id="cfgModuloCompraFacil" ${compraFacilOn ? 'checked' : ''}><label class="form-check-label" for="cfgModuloCompraFacil">Compra Fácil</label></div></div>
            <div class="col-md-6"><div class="form-check"><input class="form-check-input" type="checkbox" id="cfgModuloMarketplace" ${marketplaceOn ? 'checked' : ''}><label class="form-check-label" for="cfgModuloMarketplace">Marketplace</label></div></div>
            <div class="col-md-6"><div class="form-check"><input class="form-check-input" type="checkbox" id="cfgModuloCrm" ${crmOn ? 'checked' : ''}><label class="form-check-label" for="cfgModuloCrm">CRM</label></div></div>
          </div>
          <div class="mt-3 ${vendasEntregaOn ? '' : 'opacity-50'}" id="cfgEntregaImpressaoBox">
            <div class="fw-semibold mb-2">Opções de Entrega</div>
            <div class="form-check"><input class="form-check-input" type="checkbox" id="cfgImpComprovanteEntrega" ${config.imprimir_comprovante_entrega !== false ? 'checked' : ''}><label class="form-check-label" for="cfgImpComprovanteEntrega">Comprovante de Entrega</label></div>
            <div class="form-check"><input class="form-check-input" type="checkbox" id="cfgImpComprovantePrestacao" ${config.imprimir_comprovante_prestacao !== false ? 'checked' : ''}><label class="form-check-label" for="cfgImpComprovantePrestacao">Comprovante de Prestação</label></div>
            <div class="form-check"><input class="form-check-input" type="checkbox" id="cfgImpDanfeEntrega" ${config.imprimir_danfe_nfce_entrega !== false ? 'checked' : ''}><label class="form-check-label" for="cfgImpDanfeEntrega">DANFE NFC-e</label></div>
            <div class="form-check"><input class="form-check-input" type="checkbox" id="cfgImpCupomNaoFiscalEntrega" ${config.imprimir_cupom_nao_fiscal_entrega === true ? 'checked' : ''}><label class="form-check-label" for="cfgImpCupomNaoFiscalEntrega">Cupom Não Fiscal</label></div>
            <div class="row g-2 mt-2">
              <div class="col-4"><label class="form-label small">Alerta aguardando (h)</label><input type="number" min="1" class="form-control form-control-sm" id="cfgAlertaAguardando" value="${Number(config.entrega_alerta_horas_aguardando || 2)}"></div>
              <div class="col-4"><label class="form-label small">Alerta reserva (h)</label><input type="number" min="1" class="form-control form-control-sm" id="cfgAlertaReserva" value="${Number(config.entrega_alerta_horas_reserva || 4)}"></div>
              <div class="col-4"><label class="form-label small">Alerta parado (h)</label><input type="number" min="1" class="form-control form-control-sm" id="cfgAlertaParado" value="${Number(config.entrega_alerta_horas_parado || 3)}"></div>
            </div>
          </div>
        `, 'módulos pdv histórico vendas pedidos expedição entregas nfe nfce')}
      </div>

      <div class="cds-cfg-pane" data-cfg-pane="licenciamentoCds">
        <h2 class="cds-cfg-pane__title">Licenciamento CDS</h2>
        <p class="cds-cfg-pane__sub">Aviso no login (não bloqueia). Preparado para renovação automática futura via PIX.</p>
        ${card('<i class="fas fa-id-card"></i> Central de Licenciamento', `
          <div class="row g-3">
            <div class="col-md-4" data-cfg-search="dias aviso">
              <label class="cds-cfg-label" for="cfgLicencaDiasAviso">Dias para aviso</label>
              <input type="number" min="1" max="30" class="form-control" id="cfgLicencaDiasAviso" value="${licDias}">
            </div>
            <div class="col-md-4" data-cfg-search="plano assinatura enterprise">
              <label class="cds-cfg-label" for="cfgLicencaPlano">Plano</label>
              <input type="text" class="form-control" id="cfgLicencaPlano" value="${escapeHtml(licPlano)}" placeholder="Ex.: Enterprise (ou deixe vazio para derivar)">
            </div>
            <div class="col-md-4" data-cfg-search="chave pix renovação copia cola">
              <label class="cds-cfg-label" for="cfgLicencaChavePix">PIX Renovação</label>
              <input type="text" class="form-control" id="cfgLicencaChavePix" value="${escapeHtml(licPix)}" placeholder="Chave PIX ou PIX Copia e Cola">
            </div>
            <div class="col-12" data-cfg-search="whatsapp">
              <label class="cds-cfg-label" for="cfgLicencaWhatsapp">WhatsApp Comercial (URL)</label>
              <input type="url" class="form-control" id="cfgLicencaWhatsapp" value="${escapeHtml(licWa)}" placeholder="https://wa.me/5588...">
            </div>
            <div class="col-12" data-cfg-search="mensagem renovação">
              <label class="cds-cfg-label" for="cfgLicencaMensagem">Mensagem de renovação</label>
              <textarea class="form-control" id="cfgLicencaMensagem" rows="2">${escapeHtml(licMsg)}</textarea>
              <small class="cds-cfg-hint">Use {dias} para o número de dias restantes. PIX: o QR Code é gerado automaticamente (QRCodeService).</small>
            </div>
          </div>
          <div class="cds-cfg-note mt-3">QR Code PIX gerado automaticamente (Hotfix RC1.1) — sem imagens estáticas. Preparado para PIX Dinâmico futuro.</div>
        `, 'licenciamento pix whatsapp renovação')}
      </div>

      <div class="cds-cfg-pane" data-cfg-pane="bancoDados">
        <h2 class="cds-cfg-pane__title">Banco de Dados</h2>
        <p class="cds-cfg-pane__sub">Rede e operação multi-estação.</p>
        <div id="bannerEstacaoClienteRemoto"></div>
        ${card('Modo de Operação', `
          <div class="form-check mb-2" data-cfg-search="banco local">
            <input class="form-check-input" type="radio" name="modoOperacao" id="modoLocal" value="LOCAL" ${modo === 'LOCAL' ? 'checked' : ''}>
            <label class="form-check-label" for="modoLocal">Banco Local</label>
          </div>
          <div class="form-check mb-2" data-cfg-search="cliente servidor">
            <input class="form-check-input" type="radio" name="modoOperacao" id="modoClienteServidor" value="CLIENTE_SERVIDOR" ${modo === 'CLIENTE_SERVIDOR' ? 'checked' : ''} ${clienteServidorDisponivel ? '' : 'disabled'}>
            <label class="form-check-label ${clienteServidorDisponivel ? '' : 'text-muted'}" for="modoClienteServidor">Cliente/Servidor</label>
          </div>
          <small class="cds-cfg-hint">Cliente/Servidor disponível apenas para ERP Multi-Caixa.</small>
          <div id="containerIpServidor" class="mt-3 mb-2">
            <label for="cfgIpServidor" class="cds-cfg-label">IP do Servidor</label>
            <input type="text" class="form-control" id="cfgIpServidor" value="${escapeHtml(ipServidor)}" placeholder="Ex.: 192.168.0.100" data-cfg-search="ip servidor">
          </div>
          <div class="mb-2" data-cfg-search="porta">
            <label for="cfgPorta" class="cds-cfg-label">Porta</label>
            <input type="number" class="form-control" id="cfgPorta" value="${escapeHtml(String(porta))}" min="1" max="65535">
          </div>
          <div id="containerVoltarServidorLocal" class="alert alert-warning mb-0 mt-3" style="display:none;">
            <div class="d-flex flex-wrap align-items-center justify-content-between gap-2">
              <div>
                <strong id="tituloModoRedeEstacaoInline">Estação em modo cliente</strong>
                <div class="small mb-0">
                  <span id="descricaoModoRedeEstacaoInline">Use o botão para voltar ao backend local deste computador.</span>
                  <span class="d-block mt-1">Servidor remoto: <span id="lblServidorRemotoEstacao">-</span></span>
                </div>
              </div>
              <button type="button" class="btn btn-primary btn-sm" id="btnVoltarServidorLocal" onclick="voltarServidorLocalEstacao()" disabled>
                <i class="fas fa-home"></i> Voltar ao servidor local
              </button>
            </div>
          </div>
          <div class="cds-cfg-actions">
            <button type="button" class="btn btn-outline-secondary btn-sm" id="btnConfiguracaoRede">
              <i class="fas fa-network-wired"></i> Painel de Rede
            </button>
          </div>
        `, 'rede ip porta cliente servidor')}
      </div>

      <div class="cds-cfg-pane" data-cfg-pane="motores">
        <h2 class="cds-cfg-pane__title">Motores Inteligentes</h2>
        <p class="cds-cfg-pane__sub">Infraestrutura oficial dos motores do Núcleo Transacional.</p>
        ${card('<i class="fas fa-money-check-alt"></i> MIDP — Distribuição de Pagamentos', `
          <p class="cds-cfg-hint mb-3">
            MIDP V1 — política oficial <strong>Preservar Dinheiro</strong> (Sprint 3.8C).
            Quando <strong>ativado</strong>, o Motor F×NF pode reduzir o Valor Fiscal Efetivo
            (dentro da faixa válida) para preservar dinheiro físico na parcela Não Fiscal.
            O MIDP apenas distribui os meios sobre esse resultado — não decide valores fiscais.
          </p>
          <div class="form-check" data-cfg-search="ativar midp motor pagamentos">
            <input class="form-check-input" type="checkbox" id="cfgAtivarMidp" ${midpOn ? 'checked' : ''}>
            <label class="form-check-label" for="cfgAtivarMidp">Ativar MIDP</label>
          </div>
          <small class="cds-cfg-hint d-block mt-2">Desativado = algoritmo 100% legado (Valor Fiscal Máximo).</small>
        `, 'midp motor distribuição pagamentos ativar')}
        ${card('<i class="fas fa-search"></i> MIB — Motor Cognitivo de Busca', `
          <p class="cds-cfg-hint mb-3">
            MIB-RC2.0 — aprendizado contínuo, fuzzy, sinônimos, ranking adaptativo e SearchAI.
            Diagnóstico em <strong>Diagnóstico</strong>; métricas em <strong>MIB Analytics</strong>.
          </p>
          <div class="cds-cfg-actions">
            <button type="button" class="btn btn-outline-primary btn-sm" id="btnCfgAbrirDiagMib">
              <i class="fas fa-stethoscope"></i> Abrir Diagnóstico MIB
            </button>
            <button type="button" class="btn btn-outline-secondary btn-sm" onclick="typeof loadPage==='function'&&loadPage('mib-analytics')">
              <i class="fas fa-brain"></i> MIB Analytics
            </button>
          </div>
        `, 'mib motor busca produtos cache ranking fuzzy aprendizado')}
        ${card('<i class="fas fa-exchange-alt"></i> PDV — Transferência não fiscal → fiscal', `
          <p class="cds-cfg-hint mb-3">
            Somente <strong>Super Usuário</strong> controla esta opção.
            Quando <strong>DESATIVADO</strong> (padrão), o PDV não pergunta “Transferir estoque?”
            e não registra intenção de transferência.
            Quando <strong>ATIVADO</strong>, o fluxo atual de transferência na venda permanece.
          </p>
          <label class="form-label" for="cfgPdvTransferenciaNfFiscal">Permitir transferência de estoque não fiscal para fiscal</label>
          <select class="form-select" id="cfgPdvTransferenciaNfFiscal" data-cfg-search="transferência estoque não fiscal fiscal pdv">
            <option value="DESATIVADO">DESATIVADO</option>
            <option value="ATIVADO">ATIVADO</option>
          </select>
          <div class="cds-cfg-actions mt-2">
            <button type="button" class="btn btn-primary btn-sm" id="btnSalvarPdvTransferenciaNfFiscal">
              <i class="fas fa-save"></i> Salvar
            </button>
          </div>
        `, 'transferência estoque não fiscal fiscal pdv super usuário')}
        ${card('<i class="fas fa-edit"></i> PDV — Editar preço unitário', `
          <p class="cds-cfg-hint mb-3">
            Somente <strong>Super Usuário</strong> controla esta opção.
            Quando <strong>DESATIVADO</strong> (padrão), o campo <strong>Unitário</strong> no carrinho do PDV permanece somente leitura.
            Quando <strong>ATIVADO</strong>, o operador pode editar o unitário na venda e o sistema atualiza automaticamente o preço no cadastro do produto (estoque).
          </p>
          <label class="form-label" for="cfgPdvEditarPrecoUnitario">Permitir editar unitário no PDV e atualizar cadastro</label>
          <select class="form-select" id="cfgPdvEditarPrecoUnitario" data-cfg-search="editar preço unitário pdv cadastro produto estoque">
            <option value="DESATIVADO">DESATIVADO</option>
            <option value="ATIVADO">ATIVADO</option>
          </select>
          <div class="cds-cfg-actions mt-2">
            <button type="button" class="btn btn-primary btn-sm" id="btnSalvarPdvEditarPrecoUnitario">
              <i class="fas fa-save"></i> Salvar
            </button>
          </div>
        `, 'editar preço unitário pdv cadastro produto estoque super usuário')}
      </div>
    `;
  }

  function headersCfgApi() {
    const token = (typeof localStorage !== 'undefined' && localStorage.getItem('token')) || '';
    return {
      Authorization: 'Bearer ' + token,
      'Content-Type': 'application/json'
    };
  }

  function hidratarTransferenciaPdvNfFiscal() {
    const sel = document.getElementById('cfgPdvTransferenciaNfFiscal');
    if (!sel) return;
    const api = typeof API_URL !== 'undefined' ? API_URL : '/api';
    fetch(`${api}/configuracoes/pdv_permitir_transferencia_nao_fiscal_fiscal`, {
      headers: headersCfgApi()
    }).then((r) => r.ok ? r.json() : { valor: 'DESATIVADO' }).then((data) => {
      sel.value = data && data.valor === 'ATIVADO' ? 'ATIVADO' : 'DESATIVADO';
    }).catch(() => {
      sel.value = 'DESATIVADO';
    });
  }

  async function salvarTransferenciaPdvNfFiscal() {
    const sel = document.getElementById('cfgPdvTransferenciaNfFiscal');
    if (!sel) return;
    const api = typeof API_URL !== 'undefined' ? API_URL : '/api';
    try {
      const resp = await fetch(`${api}/configuracoes/pdv_permitir_transferencia_nao_fiscal_fiscal`, {
        method: 'PUT',
        headers: headersCfgApi(),
        body: JSON.stringify({ valor: sel.value })
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        throw new Error(data.error || data.erro || 'Não foi possível salvar.');
      }
      sel.value = data.valor === 'ATIVADO' ? 'ATIVADO' : 'DESATIVADO';
      if (typeof global.showNotification === 'function') {
        global.showNotification(
          data.valor === 'ATIVADO'
            ? 'Transferência NF → Fiscal ATIVADA no PDV.'
            : 'Transferência NF → Fiscal DESATIVADA no PDV.',
          'success'
        );
      }
    } catch (err) {
      if (typeof global.showNotification === 'function') {
        global.showNotification(err.message || 'Erro ao salvar configuração.', 'danger');
      }
    }
  }

  function hidratarEditarPrecoUnitarioPdv() {
    const sel = document.getElementById('cfgPdvEditarPrecoUnitario');
    if (!sel) return;
    const api = typeof API_URL !== 'undefined' ? API_URL : '/api';
    fetch(`${api}/configuracoes/pdv_permitir_editar_preco_unitario`, {
      headers: headersCfgApi()
    }).then((r) => r.ok ? r.json() : { valor: 'DESATIVADO' }).then((data) => {
      sel.value = data && data.valor === 'ATIVADO' ? 'ATIVADO' : 'DESATIVADO';
    }).catch(() => {
      sel.value = 'DESATIVADO';
    });
  }

  function hidratarFechamentoFiscalDia() {
    const chk = document.getElementById('cfgFechamentoFiscalDiaOn');
    if (!chk) return;
    const api = typeof API_URL !== 'undefined' ? API_URL : '/api';
    fetch(`${api}/configuracoes/fechamento_fiscal_do_dia`, {
      headers: headersCfgApi()
    }).then((r) => r.ok ? r.json() : { valor: 'DESATIVADO' }).then((data) => {
      chk.checked = data && data.valor === 'ATIVADO';
    }).catch(() => {
      chk.checked = false;
    });
  }

  async function salvarFechamentoFiscalDia() {
    const chk = document.getElementById('cfgFechamentoFiscalDiaOn');
    const fb = document.getElementById('cdsFfDiaSaveFeedback');
    if (!chk) return;
    const api = typeof API_URL !== 'undefined' ? API_URL : '/api';
    const valor = chk.checked ? 'ATIVADO' : 'DESATIVADO';
    try {
      const resp = await fetch(`${api}/configuracoes/fechamento_fiscal_do_dia`, {
        method: 'PUT',
        headers: headersCfgApi(),
        body: JSON.stringify({ valor })
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        throw new Error(data.error || data.erro || 'Não foi possível salvar.');
      }
      chk.checked = data.valor === 'ATIVADO';
      if (typeof global.aplicarVisibilidadeMenuFechamentoFiscalDia === 'function') {
        global.aplicarVisibilidadeMenuFechamentoFiscalDia(data.valor === 'ATIVADO');
      }
      if (fb) fb.textContent = data.valor === 'ATIVADO' ? 'Módulo ATIVADO.' : 'Módulo DESATIVADO.';
      if (typeof global.showNotification === 'function') {
        global.showNotification(
          data.valor === 'ATIVADO'
            ? 'Fechamento Fiscal do Dia ATIVADO.'
            : 'Fechamento Fiscal do Dia DESATIVADO.',
          'success'
        );
      }
    } catch (err) {
      if (fb) fb.textContent = err.message || 'Erro ao salvar.';
      if (typeof global.showNotification === 'function') {
        global.showNotification(err.message || 'Erro ao salvar configuração.', 'danger');
      }
    }
  }

  async function salvarEditarPrecoUnitarioPdv() {
    const sel = document.getElementById('cfgPdvEditarPrecoUnitario');
    if (!sel) return;
    const api = typeof API_URL !== 'undefined' ? API_URL : '/api';
    try {
      const resp = await fetch(`${api}/configuracoes/pdv_permitir_editar_preco_unitario`, {
        method: 'PUT',
        headers: headersCfgApi(),
        body: JSON.stringify({ valor: sel.value })
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        throw new Error(data.error || data.erro || 'Não foi possível salvar.');
      }
      sel.value = data.valor === 'ATIVADO' ? 'ATIVADO' : 'DESATIVADO';
      if (typeof global.showNotification === 'function') {
        global.showNotification(
          data.valor === 'ATIVADO'
            ? 'Edição de unitário no PDV ATIVADA (atualiza cadastro).'
            : 'Edição de unitário no PDV DESATIVADA.',
          'success'
        );
      }
    } catch (err) {
      if (typeof global.showNotification === 'function') {
        global.showNotification(err.message || 'Erro ao salvar configuração.', 'danger');
      }
    }
  }

  function hidratarEmpresaControlaValidade() {
    const sel = document.getElementById('cfgEmpresaControlaValidade');
    if (!sel) return;
    const api = typeof API_URL !== 'undefined' ? API_URL : '/api';
    fetch(`${api}/configuracoes/empresa_controla_validade`, {
      headers: headersCfgApi()
    }).then((r) => r.ok ? r.json() : { valor: 'ATIVADO' }).then((data) => {
      sel.value = data && data.valor === 'DESATIVADO' ? 'DESATIVADO' : 'ATIVADO';
    }).catch(() => {
      sel.value = 'ATIVADO';
    });
  }

  async function salvarEmpresaControlaValidade() {
    const sel = document.getElementById('cfgEmpresaControlaValidade');
    if (!sel) return;
    const valor = sel.value === 'DESATIVADO' ? 'DESATIVADO' : 'ATIVADO';
    if (valor === 'DESATIVADO') {
      const ok = window.confirm(
        'A empresa deixará de controlar validade.\n\n'
        + 'Todos os produtos marcados com “Controlar validade” serão desmarcados agora.\n'
        + 'Os cadastros continuam ativos para venda.\n\n'
        + 'Confirma?'
      );
      if (!ok) return;
    }
    const api = typeof API_URL !== 'undefined' ? API_URL : '/api';
    try {
      const resp = await fetch(`${api}/configuracoes/empresa_controla_validade`, {
        method: 'PUT',
        headers: headersCfgApi(),
        body: JSON.stringify({ valor })
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        throw new Error(data.error || data.erro || 'Não foi possível salvar.');
      }
      sel.value = data.valor === 'DESATIVADO' ? 'DESATIVADO' : 'ATIVADO';
      if (typeof global.showNotification === 'function') {
        const qtd = Number(data.produtos_desmarcados || 0);
        global.showNotification(
          data.valor === 'DESATIVADO'
            ? `Validade DESATIVADA. ${qtd} produto(s) desmarcado(s).`
            : 'Controle de validade da empresa ATIVADO.',
          'success'
        );
      }
    } catch (err) {
      if (typeof global.showNotification === 'function') {
        global.showNotification(err.message || 'Erro ao salvar configuração.', 'danger');
      }
    }
  }

  function hidratarPoliticaManifestacaoUi(politica) {
    const valor = ['MANUAL', 'AUTOMATICA_CIENCIA', 'CONFIRMAR_OPERADOR'].includes(politica)
      ? politica
      : 'MANUAL';
    document.querySelectorAll('input[name="cdsPoliticaManifestacao"]').forEach((el) => {
      el.checked = el.value === valor;
    });
  }

  async function salvarPoliticaManifestacaoCentro() {
    const selecionado = document.querySelector('input[name="cdsPoliticaManifestacao"]:checked');
    const politica = selecionado?.value || 'MANUAL';
    const feedback = document.getElementById('cdsManifSaveFeedback');
    if (feedback) feedback.textContent = 'Salvando…';

    try {
      const token = localStorage.getItem('token');
      const resp = await fetch(`${global.API_URL}/central-entradas/configuracao`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {})
        },
        body: JSON.stringify({ sefaz: { politicaManifestacao: politica } })
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(data.error || `HTTP ${resp.status}`);
      hidratarPoliticaManifestacaoUi(data.sefaz?.politicaManifestacao || politica);
      if (feedback) feedback.textContent = '✔ Política salva';
      if (typeof global.showNotification === 'function') {
        global.showNotification('Política de Manifestação atualizada.', 'success');
      }
      await atualizarPainelExecutivo();
    } catch (err) {
      if (feedback) feedback.textContent = '';
      if (typeof global.showNotification === 'function') {
        global.showNotification(err.message || 'Falha ao salvar política', 'danger');
      }
    }
  }

  function focarCardManifestacao() {
    ativarCategoria('plataformaFiscal');
    const tentar = (tentativa) => {
      const el = document.getElementById('cdsCfgCardManifestacao');
      if (el) {
        el.classList.add('is-highlight');
        try { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch { /* ignore */ }
        setTimeout(() => el.classList.remove('is-highlight'), 4000);
        return;
      }
      if (tentativa < 12) setTimeout(() => tentar(tentativa + 1), 250);
    };
    setTimeout(() => tentar(0), 200);
  }

  function ativarCategoria(id) {
    const cats = categoriasVisiveis();
    const cat = cats.find((c) => c.id === id) || cats[0] || CATEGORIAS[0];
    document.querySelectorAll('[data-cfg-nav]').forEach((el) => {
      el.classList.toggle('is-active', el.getAttribute('data-cfg-nav') === cat.id);
    });
    document.querySelectorAll('[data-cfg-pane]').forEach((el) => {
      el.classList.toggle('is-active', el.getAttribute('data-cfg-pane') === cat.id);
    });
    try {
      sessionStorage.setItem('cds_cfg_tab', cat.id);
    } catch { /* ignore */ }
  }

  function pesquisarConfiguracao(termo) {
    const q = String(termo || '').trim().toLowerCase();
    document.querySelectorAll('.cds-cfg-card.is-highlight, .cds-cfg-field-hit').forEach((el) => {
      el.classList.remove('is-highlight', 'cds-cfg-field-hit');
    });
    document.querySelectorAll('[data-cfg-nav]').forEach((el) => el.classList.remove('is-match'));

    if (!q) return;

    const cats = categoriasVisiveis();
    let destino = null;
    for (const cat of cats) {
      const blob = `${cat.label} ${cat.keywords}`.toLowerCase();
      if (blob.includes(q)) {
        destino = cat.id;
        break;
      }
    }

    if (!destino) {
      document.querySelectorAll('[data-cfg-search]').forEach((el) => {
        const keys = (el.getAttribute('data-cfg-search') || '').toLowerCase();
        if (!destino && keys.includes(q)) {
          const pane = el.closest('[data-cfg-pane]');
          if (pane) {
            const paneId = pane.getAttribute('data-cfg-pane');
            if (cats.some((c) => c.id === paneId)) destino = paneId;
          }
        }
      });
    }

    if (destino) {
      ativarCategoria(destino);
      const nav = document.querySelector(`[data-cfg-nav="${destino}"]`);
      if (nav) nav.classList.add('is-match');
    }

    document.querySelectorAll('[data-cfg-search]').forEach((el) => {
      const pane = el.closest('[data-cfg-pane]');
      const paneId = pane && pane.getAttribute('data-cfg-pane');
      if (paneId && !cats.some((c) => c.id === paneId)) return;
      const keys = (el.getAttribute('data-cfg-search') || '').toLowerCase();
      if (keys.includes(q)) {
        el.classList.add('is-highlight', 'cds-cfg-field-hit');
        if (destino && el.closest(`[data-cfg-pane="${destino}"]`)) {
          try { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch { /* ignore */ }
        }
      }
    });
  }

  async function atualizarPainelExecutivo() {
    const token = localStorage.getItem('token');
    const headers = token ? { Authorization: `Bearer ${token}` } : {};
    estadoExecutivo.usuario = obterUsuarioNome();
    const fiscalOn = configPermiteFiscalUi();

    if (fiscalOn) {
      try {
        const fiscalRes = await fetch(`${global.API_URL}/fiscal/config`, { headers });
        if (fiscalRes.ok) {
          const cfg = await fiscalRes.json();
          estadoExecutivo.empresa = cfg.nomeEmpresa || '—';
          estadoExecutivo.cnpj = cfg.cnpj || '—';
          estadoExecutivo.ambiente = cfg.ambiente;
        }
      } catch { /* ignore */ }

      try {
        const cenRes = await fetch(`${global.API_URL}/central-entradas/configuracao`, { headers });
        if (cenRes.ok) {
          const painel = await cenRes.json();
          estadoExecutivo.central = painel;
          estadoExecutivo.certificado = painel.certificado || null;
          if (painel.ambiente?.codigo != null) {
            estadoExecutivo.ambiente = painel.ambiente.codigo;
          }
          estadoExecutivo.ultimaAlteracao = painel.ambiente?.atualizadoEm
            || painel.diagnostico?.ultimaSincronizacao
            || estadoExecutivo.ultimaAlteracao;

          const ambEl = document.getElementById('cdsCfgCentralAmbiente');
          const ufEl = document.getElementById('cdsCfgCentralUf');
          const certEl = document.getElementById('cdsCfgCentralCert');
          const syncEl = document.getElementById('cdsCfgCentralSync');
          const perfEl = document.getElementById('cdsCfgPerfTimeouts');

          if (ambEl) {
            ambEl.innerHTML = `${badge(painel.ambiente?.label || '—', toneAmbiente(painel.ambiente?.codigo))}
              <div class="cds-cfg-hint mt-1">${escapeHtml(painel.ambiente?.origemLabel || 'Centro de Configurações')}</div>`;
          }
          if (ufEl) {
            ufEl.innerHTML = `<strong>${escapeHtml(painel.ambiente?.uf || '—')}</strong>
              <span class="cds-cfg-hint">Código ${escapeHtml(painel.ambiente?.codigoUf || '—')}</span>`;
          }
          if (certEl) {
            const c = painel.certificado || {};
            certEl.innerHTML = `${badge(c.status || 'AUSENTE', c.status === 'OK' ? 'ok' : 'warn')}
              <div class="cds-cfg-hint mt-1">${escapeHtml(c.mensagem || '')}</div>`;
          }
          if (syncEl) {
            const s = painel.sincronizacao || {};
            syncEl.innerHTML = `${badge(s.syncAutomaticaHabilitada ? 'Automática' : 'Manual', s.syncAutomaticaHabilitada ? 'ok' : 'neutral')}
              <div class="cds-cfg-hint mt-1">Intervalo: ${escapeHtml(String(s.syncIntervaloMinutos ?? '—'))} min · Max docs: ${escapeHtml(String(s.syncMaxDocumentos ?? '—'))}</div>`;
          }
          if (perfEl) {
            const sf = painel.sefaz || {};
            perfEl.innerHTML = `<div><strong>Timeout</strong>: ${escapeHtml(String(sf.timeoutMs ?? '—'))} ms</div>
              <div><strong>Max tentativas</strong>: ${escapeHtml(String(sf.maxTentativas ?? '—'))}</div>
              <div class="cds-cfg-hint">Edição em Central Inteligente → Configuração Enterprise</div>`;
          }

          hidratarPoliticaManifestacaoUi(painel.sefaz?.politicaManifestacao || 'MANUAL');
        }
      } catch { /* ignore */ }
    }

    const panel = document.getElementById('cdsCfgExecPanel');
    const wrap = document.getElementById('cdsCfgExecWrap');
    if (wrap) wrap.innerHTML = renderPainelExecutivo();

    const metaEmpresa = document.getElementById('cdsCfgMetaEmpresa');
    const metaUser = document.getElementById('cdsCfgMetaUsuario');
    const metaAlt = document.getElementById('cdsCfgMetaAlteracao');
    if (metaEmpresa) metaEmpresa.textContent = estadoExecutivo.empresa || '—';
    if (metaUser) metaUser.textContent = estadoExecutivo.usuario || '—';
    if (metaAlt) {
      const raw = estadoExecutivo.ultimaAlteracao;
      metaAlt.textContent = raw && raw !== '—'
        ? String(raw).slice(0, 19).replace('T', ' ')
        : '—';
    }

    void panel;
  }

  async function carregarDiagnosticoMib() {
    try {
      const token = localStorage.getItem('token');
      const headers = token ? { Authorization: `Bearer ${token}` } : {};
      const [respH, respD, respS, respC] = await Promise.all([
        fetch(`${global.API_URL}/produtos/mib/health`, { headers }),
        fetch(`${global.API_URL}/produtos/mib/diagnostico`, { headers }),
        fetch(`${global.API_URL}/produtos/mib/statistics`, { headers }),
        fetch(`${global.API_URL}/produtos/mib/config`, { headers })
      ]);
      const h = await respH.json().catch(() => ({}));
      const d = await respD.json().catch(() => ({}));
      const s = await respS.json().catch(() => ({}));
      const cfg = await respC.json().catch(() => ({}));
      if (!respH.ok && !respD.ok) throw new Error(d.error || h.error || 'Falha MIB');

      const set = (id, v) => {
        const el = document.getElementById(id);
        if (el) el.textContent = v;
      };
      const adv = d.avancado || {};
      set('mibDiagStatus', h.status || '—');
      set('mibDiagTempoMedio', `${h.avgSearch ?? d.tempoMedioMs ?? 0} ms`);
      set('mibDiagCache', `${h.cacheHits ?? d.cacheHit ?? 0} / ${h.cacheMiss ?? d.cacheMiss ?? 0}`);
      set('mibDiagProdutos', String(h.catalogSize ?? d.produtosCarregados ?? 0));
      set('mibDiagHot', String(h.hotCacheHits ?? 0));
      set('mibDiagCpm', String(d.consultasPorMinuto ?? 0));
      set('mibDiagRam', `${h.memoryUsage?.heapUsed ?? d.usoRamMb?.heapUsed ?? '—'} MB`);
      set('mibDiagVersao', String(h.catalogVersion ?? adv.catalogVersion ?? 0));
      set('mibAdvBuild', `${adv.tempoConstrucaoMs ?? 0} ms`);
      set('mibAdvSql', `${adv.tempoMedioSql ?? s.tempoMedioSqlMs ?? 0} ms`);
      set('mibAdvCacheMs', `${adv.tempoMedioCache ?? s.tempoMedioCacheMs ?? 0} ms`);
      set('mibAdvSwaps', String(adv.swaps ?? s.swaps ?? 0));
      set('mibAdvUpdates', String(adv.atualizacoes ?? s.atualizacoesCatalogo ?? 0));
      set('mibAdvHotSize', String(adv.hotCache ?? 0));
      set('mibAdvEstado', String(adv.estadoEngine || h.status || '—'));
      set('mibAdvLastSwap', String(h.lastSwap || '—').slice(0, 19).replace('T', ' '));

      const hist = document.getElementById('mibHistBench');
      if (hist && Array.isArray(s.historicoBenchmark)) {
        hist.textContent = s.historicoBenchmark.length
          ? s.historicoBenchmark.slice(0, 8).map((b) => `${b.criado_em || ''} · ${(b.resultados || []).length} amostras`).join('\n')
          : 'Sem histórico de benchmark ainda.';
      }

      const bindNum = (id, val) => {
        const el = document.getElementById(id);
        if (el && val != null) el.value = val;
      };
      bindNum('mibCfgRefresh', cfg.tempoRefreshMs);
      bindNum('mibCfgCache', cfg.limiteCache);
      bindNum('mibCfgRam', cfg.limiteRamMb);
      bindNum('mibCfgHot', cfg.hotCacheSize);
      const chk = (id, v) => { const el = document.getElementById(id); if (el) el.checked = !!v; };
      chk('mibCfgAuto', cfg.ativarAtualizacaoAutomatica);
      chk('mibCfgStats', cfg.ativarEstatisticas);
      chk('mibCfgBench', cfg.ativarBenchmark);
      chk('mibCfgDev', cfg.modoDesenvolvimento);
      chk('mibCfgAprendizado', cfg.ativarAprendizado);
      chk('mibCfgFuzzy', cfg.ativarFuzzy);
      chk('mibCfgSinonimos', cfg.ativarSinonimos);
      chk('mibCfgAutoCorr', cfg.ativarAutoCorrecao);
      bindNum('mibCfgLevenshtein', cfg.sensibilidadeLevenshtein);
      bindNum('mibCfgHist', cfg.limiteHistorico);
      bindNum('mibCfgRetencao', cfg.tempoRetencaoDias);
      bindNum('mibCfgPref', cfg.limitePreferencia);
    } catch (err) {
      if (typeof global.showNotification === 'function') {
        global.showNotification(err.message || 'Falha ao carregar diagnóstico MIB', 'warning');
      }
    }
  }

  async function executarBenchmarkMib() {
    const out = document.getElementById('mibBenchmarkOut');
    if (out) {
      out.classList.remove('d-none');
      out.textContent = 'Executando benchmark…';
    }
    try {
      const token = localStorage.getItem('token');
      const resp = await fetch(`${global.API_URL}/produtos/mib/benchmark`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {})
        },
        body: JSON.stringify({ termo: 'arroz', tamanhos: [10, 100, 1000, 10000] })
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(data.error || `HTTP ${resp.status}`);
      if (out) out.textContent = JSON.stringify(data, null, 2);
      await carregarDiagnosticoMib();
    } catch (err) {
      if (out) out.textContent = err.message || 'Falha no benchmark';
    }
  }

  function wireShell() {
    document.querySelectorAll('[data-cfg-nav]').forEach((btn) => {
      btn.addEventListener('click', () => ativarCategoria(btn.getAttribute('data-cfg-nav')));
    });

    const search = document.getElementById('cdsCfgSearch');
    if (search) {
      let timer = null;
      search.addEventListener('input', () => {
        clearTimeout(timer);
        timer = setTimeout(() => pesquisarConfiguracao(search.value), 180);
      });
    }

    document.querySelectorAll('[data-mib-tab]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const tab = btn.getAttribute('data-mib-tab');
        document.querySelectorAll('[data-mib-tab]').forEach((b) => b.classList.toggle('active', b === btn));
        document.getElementById('mibPaneBasico')?.classList.toggle('d-none', tab !== 'basico');
        document.getElementById('mibPaneAvancado')?.classList.toggle('d-none', tab !== 'avancado');
        document.getElementById('mibPaneCognitivo')?.classList.toggle('d-none', tab !== 'cognitivo');
      });
    });
    document.getElementById('btnMibAtualizarDiag')?.addEventListener('click', () => carregarDiagnosticoMib());
    document.getElementById('btnMibBenchmark')?.addEventListener('click', () => executarBenchmarkMib());
    const postMib = async (path, okMsg) => {
      try {
        const token = localStorage.getItem('token');
        const resp = await fetch(`${global.API_URL}${path}`, {
          method: 'POST',
          headers: token ? { Authorization: `Bearer ${token}` } : {}
        });
        const data = await resp.json().catch(() => ({}));
        if (!resp.ok) throw new Error(data.error || `HTTP ${resp.status}`);
        if (typeof global.showNotification === 'function') {
          global.showNotification(okMsg(data), 'success');
        }
        await carregarDiagnosticoMib();
      } catch (err) {
        if (typeof global.showNotification === 'function') {
          global.showNotification(err.message || 'Falha MIB', 'danger');
        }
      }
    };
    document.getElementById('btnMibRefresh')?.addEventListener('click', () => {
      postMib('/produtos/mib/refresh', (d) => `Refresh MIB v${d.versao ?? '—'} (${d.produtos ?? 0} produtos)`);
    });
    document.getElementById('btnMibRecarregarCat')?.addEventListener('click', () => {
      postMib('/produtos/mib/rebuild', (d) => `Rebuild OK (${d.catalogo?.produtos ?? d.produtos ?? 0} produtos)`);
    });
    document.getElementById('btnMibHotRebuild')?.addEventListener('click', () => {
      postMib('/produtos/mib/hotcache/rebuild', (d) => `HotCache ${d.produtos ?? 0} produtos`);
    });
    const salvarConfigMib = async (body, msg) => {
      const token = localStorage.getItem('token');
      const resp = await fetch(`${global.API_URL}/produtos/mib/config`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {})
        },
        body: JSON.stringify(body)
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(data.error || `HTTP ${resp.status}`);
      if (typeof global.showNotification === 'function') {
        global.showNotification(msg || 'Configuração MIB salva.', 'success');
      }
    };
    document.getElementById('btnMibSalvarConfig')?.addEventListener('click', async () => {
      try {
        await salvarConfigMib({
          tempoRefreshMs: Number(document.getElementById('mibCfgRefresh')?.value) || 400,
          limiteCache: Number(document.getElementById('mibCfgCache')?.value) || 300,
          limiteRamMb: Number(document.getElementById('mibCfgRam')?.value) || 512,
          hotCacheSize: Number(document.getElementById('mibCfgHot')?.value) || 100,
          ativarAtualizacaoAutomatica: !!document.getElementById('mibCfgAuto')?.checked,
          ativarEstatisticas: !!document.getElementById('mibCfgStats')?.checked,
          ativarBenchmark: !!document.getElementById('mibCfgBench')?.checked,
          modoDesenvolvimento: !!document.getElementById('mibCfgDev')?.checked
        });
      } catch (err) {
        if (typeof global.showNotification === 'function') {
          global.showNotification(err.message || 'Falha ao salvar config MIB', 'danger');
        }
      }
    });
    document.getElementById('btnMibSalvarCognitivo')?.addEventListener('click', async () => {
      try {
        await salvarConfigMib({
          ativarAprendizado: !!document.getElementById('mibCfgAprendizado')?.checked,
          ativarFuzzy: !!document.getElementById('mibCfgFuzzy')?.checked,
          ativarSinonimos: !!document.getElementById('mibCfgSinonimos')?.checked,
          ativarAutoCorrecao: !!document.getElementById('mibCfgAutoCorr')?.checked,
          sensibilidadeLevenshtein: Number(document.getElementById('mibCfgLevenshtein')?.value) || 2,
          limiteHistorico: Number(document.getElementById('mibCfgHist')?.value) || 5000,
          tempoRetencaoDias: Number(document.getElementById('mibCfgRetencao')?.value) || 180,
          limitePreferencia: Number(document.getElementById('mibCfgPref')?.value) || 3
        }, 'Configuração cognitiva MIB salva.');
      } catch (err) {
        if (typeof global.showNotification === 'function') {
          global.showNotification(err.message || 'Falha ao salvar config cognitiva', 'danger');
        }
      }
    });
    document.getElementById('btnMibRetrain')?.addEventListener('click', () => {
      postMib('/produtos/mib/retrain', () => 'Retrain MIB concluído');
    });
    document.getElementById('btnMibResetLearn')?.addEventListener('click', () => {
      if (!confirm('Zerar todo o aprendizado do MIB?')) return;
      postMib('/produtos/mib/reset-learning', () => 'Aprendizado MIB resetado');
    });
    document.getElementById('btnCfgAbrirDiagMib')?.addEventListener('click', () => {
      ativarCategoria('diagnostico');
      carregarDiagnosticoMib();
      try {
        document.getElementById('cdsCfgMibDiag')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      } catch { /* ignore */ }
    });
    carregarDiagnosticoMib();
    hidratarTransferenciaPdvNfFiscal();
    document.getElementById('btnSalvarPdvTransferenciaNfFiscal')?.addEventListener('click', () => {
      void salvarTransferenciaPdvNfFiscal();
    });
    hidratarEditarPrecoUnitarioPdv();
    document.getElementById('btnSalvarPdvEditarPrecoUnitario')?.addEventListener('click', () => {
      void salvarEditarPrecoUnitarioPdv();
    });
    hidratarFechamentoFiscalDia();
    document.getElementById('btnSalvarFechamentoFiscalDia')?.addEventListener('click', () => {
      void salvarFechamentoFiscalDia();
    });
    hidratarEmpresaControlaValidade();
    document.getElementById('btnSalvarEmpresaControlaValidade')?.addEventListener('click', () => {
      void salvarEmpresaControlaValidade();
    });
    document.getElementById('btnNaoControlarValidadeEmpresa')?.addEventListener('click', () => {
      const sel = document.getElementById('cfgEmpresaControlaValidade');
      if (sel) sel.value = 'DESATIVADO';
      void salvarEmpresaControlaValidade();
    });

    document.getElementById('btnAbrirConfigFiscalOficial')?.addEventListener('click', () => {
      ativarCategoria('plataformaFiscal');
      const area = document.getElementById('fiscal-config-form-area-avancadas');
      try { area?.scrollIntoView({ behavior: 'smooth', block: 'start' }); } catch { /* ignore */ }
    });

    document.getElementById('btnSalvarPoliticaManifestacao')?.addEventListener('click', () => {
      void salvarPoliticaManifestacaoCentro();
    });

    document.getElementById('btnCdsCfgSalvar')?.addEventListener('click', () => {
      if (typeof global.salvarConfiguracoesAvancadas === 'function') {
        global.salvarConfiguracoesAvancadas().then?.(() => atualizarPainelExecutivo());
      }
    });

    // Ao desligar PDV, sugere desligar Histórico de Vendas (ainda editável).
    document.getElementById('cfgModuloPdv')?.addEventListener('change', (ev) => {
      const hist = document.getElementById('cfgModuloHistoricoVendas');
      if (!hist) return;
      if (!ev.target.checked) hist.checked = false;
    });

    document.getElementById('btnCdsCfgCancelar')?.addEventListener('click', () => {
      if (typeof global.loadConfiguracoesAvancadas === 'function') {
        global.loadConfiguracoesAvancadas();
      }
    });

    document.getElementById('btnCdsCfgRestaurar')?.addEventListener('click', () => {
      if (confirm('Descartar alterações não salvas e recarregar as configurações do servidor?')) {
        if (typeof global.loadConfiguracoesAvancadas === 'function') {
          global.loadConfiguracoesAvancadas();
        }
      }
    });

    const abrirTefLazy = async () => {
      try {
        if (typeof global.abrirConfiguracaoTEF !== 'function' && global.CdsErpLazyLoader) {
          await global.CdsErpLazyLoader.loadFeature('configuracao-tef');
        }
        if (typeof global.abrirConfiguracaoTEF === 'function') global.abrirConfiguracaoTEF();
      } catch (error) {
        console.error('[ERP LAZY] Falha ao carregar configuração TEF:', error);
        if (typeof global.showNotification === 'function') {
          global.showNotification('Não foi possível carregar a configuração TEF.', 'danger');
        }
      }
    };
    document.getElementById('btnConfiguracaoTEF')?.addEventListener('click', abrirTefLazy);
    document.getElementById('btnConfiguracaoTEFIntegracoes')?.addEventListener('click', abrirTefLazy);
    document.getElementById('btnConfiguracaoRede')?.addEventListener('click', () => {
      if (typeof global.abrirModalConfiguracaoRede === 'function') global.abrirModalConfiguracaoRede();
    });

    let tab = 'empresa';
    try {
      tab = sessionStorage.getItem('cds_cfg_tab') || 'empresa';
    } catch { /* ignore */ }
    const legacyTabs = {
      geral: 'empresa',
      fiscal: 'plataformaFiscal',
      avancado: 'modulosLicenciados',
      aparencia: 'empresa',
      central: 'diagnostico',
      plataforma: 'plataformaFiscal'
    };
    if (legacyTabs[tab]) tab = legacyTabs[tab];
    if (!CATEGORIAS.some((c) => c.id === tab)) tab = 'empresa';
    if (global.__CDS_CFG_FORCE_TAB) {
      tab = global.__CDS_CFG_FORCE_TAB;
      global.__CDS_CFG_FORCE_TAB = null;
    }
    ativarCategoria(tab);

    const anchor = global.__CDS_CFG_FORCE_ANCHOR;
    global.__CDS_CFG_FORCE_ANCHOR = null;
    if (anchor === 'manifestacao') {
      focarCardManifestacao();
    }
  }

  function renderCentroConfiguracoesCDS(config) {
    global.configuracaoAvancadaServidor = config || {};
    estadoExecutivo.usuario = obterUsuarioNome();

    const html = `
      <div class="cds-cfg" id="cdsCentroConfiguracoes">
        <div class="cds-cfg-hero">
          <h1 class="cds-cfg-hero__title"><i class="fas fa-cogs"></i> Configurações do CDS Sistemas</h1>
          <p class="cds-cfg-hero__sub">Plataforma Inteligente de Gestão · Centro oficial de configuração</p>
          <div class="cds-cfg-hero__meta">
            <span><i class="fas fa-code-branch"></i> Versão <strong id="cdsCfgMetaVersao">1.0.3</strong></span>
            <span><i class="fas fa-building"></i> <strong id="cdsCfgMetaEmpresa">—</strong></span>
            <span><i class="fas fa-user"></i> <strong id="cdsCfgMetaUsuario">${escapeHtml(estadoExecutivo.usuario)}</strong></span>
            <span><i class="fas fa-clock"></i> Última alteração <strong id="cdsCfgMetaAlteracao">—</strong></span>
          </div>
          <div class="cds-cfg-hero__actions">
            <button type="button" class="btn btn-light btn-sm" id="btnCdsCfgSalvar"><i class="fas fa-save"></i> Salvar</button>
            <button type="button" class="btn btn-outline-light btn-sm" id="btnCdsCfgCancelar"><i class="fas fa-undo"></i> Cancelar</button>
            <button type="button" class="btn btn-outline-light btn-sm" id="btnCdsCfgRestaurar"><i class="fas fa-history"></i> Restaurar padrão</button>
            <div class="cds-cfg-search">
              <i class="fas fa-search"></i>
              <input type="search" class="form-control form-control-sm" id="cdsCfgSearch" placeholder="Pesquisar configuração..." autocomplete="off">
            </div>
          </div>
        </div>

        <div id="cdsCfgExecWrap">${renderPainelExecutivo()}</div>

        <form id="formConfigAvancadas" onsubmit="return false;">
          <div class="cds-cfg-shell">
            <nav class="cds-cfg-nav" aria-label="Categorias de configuração">${renderNav('empresa')}</nav>
            <div class="cds-cfg-main">${renderPanes(config || {})}</div>
          </div>
        </form>
      </div>
    `;

    $('#page-content').html(html);

    if (typeof global.configurarFormConfigAvancadas === 'function') {
      global.configurarFormConfigAvancadas();
    }
    if (typeof global.aplicarEstadoFormConfigAvancadas === 'function') {
      global.aplicarEstadoFormConfigAvancadas();
    }
    if (typeof global.carregarStatusPixAutomatico === 'function') {
      global.carregarStatusPixAutomatico();
    }

    wireShell();
    atualizarPainelExecutivo();
    if (typeof global.setupBackupManualListener === 'function') {
      global.setupBackupManualListener();
    }
    if (typeof global.carregarPastaBackup === 'function') {
      global.carregarPastaBackup();
    }
  }

  global.CATEGORIAS_CDS_CFG = CATEGORIAS;
  global.renderCentroConfiguracoesCDS = renderCentroConfiguracoesCDS;
  global.atualizarPainelExecutivoCentroCfg = atualizarPainelExecutivo;
  global.ativarCategoriaCentroCfg = ativarCategoria;
  global.pesquisarConfiguracaoCentroCfg = pesquisarConfiguracao;
  global.focarCardManifestacaoCentroCfg = focarCardManifestacao;
  global.salvarPoliticaManifestacaoCentroCfg = salvarPoliticaManifestacaoCentro;
})(typeof window !== 'undefined' ? window : global);
