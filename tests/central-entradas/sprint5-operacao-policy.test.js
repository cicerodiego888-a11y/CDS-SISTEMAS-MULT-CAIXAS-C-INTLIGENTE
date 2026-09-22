/**
 * Sprint 5 — Política operacional ASSISTIDO / AUTOMÁTICO
 * node --test tests/central-entradas/sprint5-operacao-policy.test.js
 */
'use strict';

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '../..');

const {
  CentralOperationPolicy,
  CentralOperationConfigStore,
  CentralOperationOrchestrator,
  CentralActionQueue,
  CentralActionAuditoria,
  ModoOperacao,
  ClassificacaoAcao,
  StatusDecisao,
  TipoAcao,
  OrigemAcao,
  MODO_PADRAO,
  criarActionId,
  _resetSeqParaTestes
} = require('../../backend/services/fiscal/central');

const { AchadoCodigo } = require('../../backend/services/fiscal/descoberta-nsu/ReconcilicaoDfeAchados');

function ler(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

function criarOrch(overrides = {}) {
  const configStore = overrides.configStore || new CentralOperationConfigStore({});
  const actionQueue = overrides.actionQueue || new CentralActionQueue();
  const auditoria = overrides.auditoria || new CentralActionAuditoria({ max: 100 });
  const calls = { xml: [], sync: [], recon: [] };
  const orch = new CentralOperationOrchestrator({
    configStore,
    actionQueue,
    auditoria,
    avaliarProtecoes: overrides.avaliarProtecoes || (async () => ({})),
    recuperarXml: overrides.recuperarXml || (async (id, op) => {
      calls.xml.push({ id, op });
      return { sucesso: true, resultado: { recuperado: true, request_id: 'REQ-XML-1' } };
    }),
    sincronizar: overrides.sincronizar || (async (op) => {
      calls.sync.push(op);
      return { sucesso: true, codigo: 'SYNC_OK', requestId: 'REQ-SYNC-1' };
    }),
    reconciliar: overrides.reconciliar || (async () => ({
      cnpj: '14200166000187',
      ambiente: 1,
      status: 'ATENCAO',
      achados: [],
      reconciliationId: 'RECON-1'
    })),
    ...overrides
  });
  return { orch, configStore, actionQueue, auditoria, calls };
}

describe('Sprint 5 — contratos (não alterar motores)', () => {
  it('CentralOperationPolicy existe e não cria dual motors', () => {
    assert.ok(CentralOperationPolicy);
    assert.doesNotMatch(ler('backend/services/fiscal/central/index.js'), /CentralAssistidaService|CentralAutomaticaService/);
    assert.match(ler('backend/services/fiscal/central/CentralOperationPolicy.js'), /CentralOperationPolicy/);
  });

  it('não altera Gate / Nsu / XML / Reconciliação', () => {
    assert.match(ler('backend/services/fiscal/sefaz/SEFAZQueryGate.js'), /SEFAZQueryGate/);
    assert.match(ler('backend/motores/central-entradas/services/CentralNsuService.js'), /Único ponto oficial/);
    assert.match(ler('backend/motores/central-entradas/recuperacao-xml/MotorRecuperacaoXmlService.js'), /recuperacaoXml/);
    assert.match(ler('backend/services/fiscal/descoberta-nsu/MotorReconcilicaoDfe.js'), /somente diagnóstico/i);
  });
});

describe('Sprint 5 — Policy', () => {
  it('1. default = ASSISTIDO', () => {
    assert.equal(MODO_PADRAO, ModoOperacao.ASSISTIDO);
    const p = new CentralOperationPolicy({});
    assert.equal(p.obterConfig().modo, ModoOperacao.ASSISTIDO);
  });

  it('2. ASSISTIDO exige confirmação para SAFE', () => {
    const p = new CentralOperationPolicy({ config: { modo: ModoOperacao.ASSISTIDO } });
    const d = p.decidir({ acao: TipoAcao.RECUPERAR_XML });
    assert.equal(d.status, StatusDecisao.AGUARDAR_CONFIRMACAO);
    assert.equal(d.exigeConfirmacao, true);
    assert.equal(d.executarAutomatico, false);
  });

  it('3. AUTOMÁTICO executa SAFE', () => {
    const p = new CentralOperationPolicy({ config: { modo: ModoOperacao.AUTOMATICO } });
    const d = p.decidir({ acao: TipoAcao.RECUPERAR_XML });
    assert.equal(d.status, StatusDecisao.EXECUTAR);
    assert.equal(d.executarAutomatico, true);
    assert.equal(d.classificacao, ClassificacaoAcao.SAFE);
  });

  it('4. CONFIRMATION_REQUIRED exige confirmação mesmo em AUTOMÁTICO', () => {
    const p = new CentralOperationPolicy({ config: { modo: ModoOperacao.AUTOMATICO } });
    const d = p.decidir({ acao: TipoAcao.ANALISAR_LACUNA });
    assert.equal(d.status, StatusDecisao.ACAO_REQUER_CONFIRMACAO);
    assert.equal(d.exigeConfirmacao, true);
  });

  it('5. NEVER_AUTOMATIC nunca executa', () => {
    const p = new CentralOperationPolicy({ config: { modo: ModoOperacao.AUTOMATICO } });
    for (const acao of [
      TipoAcao.ALTERAR_ULTNSU,
      TipoAcao.EXCLUIR_DOCUMENTO,
      TipoAcao.ALTERAR_ESTADO_FISCAL
    ]) {
      const d = p.decidir({ acao, confirmado: true });
      assert.equal(d.status, StatusDecisao.BLOQUEADO);
      assert.equal(d.classificacao, ClassificacaoAcao.NEVER_AUTOMATIC);
      assert.equal(d.permitido, false);
    }
  });

  it('6. mudança ASSISTIDO → AUTOMÁTICO', async () => {
    const store = new CentralOperationConfigStore({});
    await store.salvar({ modo: ModoOperacao.ASSISTIDO });
    assert.equal((await store.obter()).modo, ModoOperacao.ASSISTIDO);
    await store.salvar({ modo: ModoOperacao.AUTOMATICO });
    assert.equal((await store.obter()).modo, ModoOperacao.AUTOMATICO);
  });

  it('7. mudança AUTOMÁTICO → ASSISTIDO', async () => {
    const store = new CentralOperationConfigStore({});
    await store.salvar({ modo: ModoOperacao.AUTOMATICO });
    await store.salvar({ modo: ModoOperacao.ASSISTIDO });
    assert.equal((await store.obter()).modo, ModoOperacao.ASSISTIDO);
  });
});

describe('Sprint 5 — XML', () => {
  beforeEach(() => {
    _resetSeqParaTestes();
  });

  it('8. XML pendente + ASSISTIDO → ação pendente', async () => {
    const { orch, actionQueue, calls } = criarOrch();
    await orch.salvarConfig({ modo: ModoOperacao.ASSISTIDO });
    const r = await orch.solicitarAcao({
      tipo: TipoAcao.RECUPERAR_XML,
      cnpj: '14200166000187',
      ambiente: 1,
      documentoId: 10,
      chave: '1'.repeat(44),
      origem: OrigemAcao.AUTOMATIC
    });
    assert.equal(r.enfileirado, true);
    assert.equal(r.executado, false);
    assert.equal(actionQueue.listarPendentes('14200166000187', 1).length, 1);
    assert.equal(calls.xml.length, 0);
  });

  it('9. XML pendente + AUTOMÁTICO → recuperação criada', async () => {
    const { orch, calls } = criarOrch();
    await orch.salvarConfig({ modo: ModoOperacao.AUTOMATICO });
    const r = await orch.solicitarAcao({
      tipo: TipoAcao.RECUPERAR_XML,
      cnpj: '14200166000187',
      ambiente: 1,
      documentoId: 10,
      chave: '1'.repeat(44),
      origem: OrigemAcao.AUTOMATIC
    });
    assert.equal(r.executado, true);
    assert.equal(r.enfileirado, false);
    assert.equal(calls.xml.length, 1);
    assert.equal(r.resultadoExecucao.request_id, 'REQ-XML-1');
  });
});

describe('Sprint 5 — distNSU', () => {
  it('10. sincronização necessária + ASSISTIDO → ação pendente', async () => {
    const { orch, actionQueue, calls } = criarOrch();
    await orch.salvarConfig({ modo: ModoOperacao.ASSISTIDO });
    const r = await orch.solicitarAcao({
      tipo: TipoAcao.SINCRONIZAR_DISTNSU,
      cnpj: '14200166000187',
      ambiente: 1,
      origem: OrigemAcao.AUTOMATIC
    });
    assert.equal(r.enfileirado, true);
    assert.equal(calls.sync.length, 0);
    assert.ok(actionQueue.listarPendentes('14200166000187', 1).some((a) => a.tipo === TipoAcao.SINCRONIZAR_DISTNSU));
  });

  it('11. sincronização necessária + AUTOMÁTICO → sincronização solicitada', async () => {
    const { orch, calls } = criarOrch();
    await orch.salvarConfig({ modo: ModoOperacao.AUTOMATICO });
    const r = await orch.solicitarAcao({
      tipo: TipoAcao.SINCRONIZAR_DISTNSU,
      cnpj: '14200166000187',
      ambiente: 1,
      origem: OrigemAcao.AUTOMATIC
    });
    assert.equal(r.executado, true);
    assert.equal(calls.sync.length, 1);
  });
});

describe('Sprint 5 — proteções', () => {
  it('12. AUTOMÁTICO + cooldown → AGUARDANDO_PROXIMA_JANELA', async () => {
    const { orch, calls } = criarOrch({
      avaliarProtecoes: async () => ({ cooldown: true, motivo: 'Cooldown SEFAZ ativo' })
    });
    await orch.salvarConfig({ modo: ModoOperacao.AUTOMATICO });
    const r = await orch.solicitarAcao({
      tipo: TipoAcao.RECUPERAR_XML,
      cnpj: '14200166000187',
      ambiente: 1,
      documentoId: 1
    });
    assert.equal(r.status, StatusDecisao.AGUARDANDO_PROXIMA_JANELA);
    assert.equal(r.executado, false);
    assert.equal(calls.xml.length, 0);
  });

  it('13. AUTOMÁTICO + circuit breaker → AGUARDANDO_PROXIMA_JANELA', async () => {
    const { orch } = criarOrch({
      avaliarProtecoes: async () => ({ circuitOpen: true })
    });
    await orch.salvarConfig({ modo: ModoOperacao.AUTOMATICO });
    const r = await orch.solicitarAcao({ tipo: TipoAcao.SINCRONIZAR_DISTNSU, cnpj: '1', ambiente: 1 });
    assert.equal(r.status, StatusDecisao.AGUARDANDO_PROXIMA_JANELA);
  });

  it('14. AUTOMÁTICO + rate limit → AGUARDANDO_PROXIMA_JANELA', async () => {
    const { orch } = criarOrch({
      avaliarProtecoes: async () => ({ rateLimited: true })
    });
    await orch.salvarConfig({ modo: ModoOperacao.AUTOMATICO });
    const r = await orch.solicitarAcao({ tipo: TipoAcao.SINCRONIZAR_DISTNSU, cnpj: '1', ambiente: 1 });
    assert.equal(r.status, StatusDecisao.AGUARDANDO_PROXIMA_JANELA);
  });

  it('15. AUTOMÁTICO + lock → BLOQUEADO', async () => {
    const { orch, calls } = criarOrch({
      avaliarProtecoes: async () => ({ lockAtivo: true })
    });
    await orch.salvarConfig({ modo: ModoOperacao.AUTOMATICO });
    const r = await orch.solicitarAcao({ tipo: TipoAcao.SINCRONIZAR_DISTNSU, cnpj: '1', ambiente: 1 });
    assert.equal(r.status, StatusDecisao.BLOQUEADO);
    assert.equal(calls.sync.length, 0);
  });
});

describe('Sprint 5 — ações bloqueadas', () => {
  it('16–18. AUTOMÁTICO + cursor/exclusão/correção fiscal → BLOQUEADO', async () => {
    const { orch } = criarOrch();
    await orch.salvarConfig({ modo: ModoOperacao.AUTOMATICO });
    for (const tipo of [
      TipoAcao.ALTERAR_ULTNSU,
      TipoAcao.EXCLUIR_DOCUMENTO,
      TipoAcao.ALTERAR_ESTADO_FISCAL
    ]) {
      const r = await orch.solicitarAcao({ tipo, cnpj: '14200166000187', ambiente: 1 });
      assert.equal(r.status, StatusDecisao.BLOQUEADO);
      assert.equal(r.executado, false);
    }
  });
});

describe('Sprint 5 — isolamento CNPJ', () => {
  it('19–20. CNPJ A automático e CNPJ B assistido são independentes', async () => {
    const store = new CentralOperationConfigStore({});
    store.definirParaEmpresa('11111111000111', 1, { modo: ModoOperacao.AUTOMATICO });
    store.definirParaEmpresa('22222222000122', 1, { modo: ModoOperacao.ASSISTIDO });
    assert.equal((await store.obter('11111111000111', 1)).modo, ModoOperacao.AUTOMATICO);
    assert.equal((await store.obter('22222222000122', 1)).modo, ModoOperacao.ASSISTIDO);

    const { orch } = criarOrch({ configStore: store });
    const a = await orch.solicitarAcao({
      tipo: TipoAcao.RECUPERAR_XML, cnpj: '11111111000111', ambiente: 1, documentoId: 1
    });
    const b = await orch.solicitarAcao({
      tipo: TipoAcao.RECUPERAR_XML, cnpj: '22222222000122', ambiente: 1, documentoId: 2
    });
    assert.equal(a.executado, true);
    assert.equal(b.enfileirado, true);
  });
});

describe('Sprint 5 — auditoria', () => {
  it('21–24. ação automática/manual + action_id + request_id', async () => {
    _resetSeqParaTestes();
    const auditoria = new CentralActionAuditoria({ max: 50 });
    const { orch } = criarOrch({ auditoria });
    await orch.salvarConfig({ modo: ModoOperacao.AUTOMATICO });
    const actionId = criarActionId();
    const r = await orch.solicitarAcao({
      tipo: TipoAcao.RECUPERAR_XML,
      cnpj: '14200166000187',
      ambiente: 1,
      documentoId: 9,
      action_id: actionId,
      origem: OrigemAcao.AUTOMATIC,
      request_id: 'REQ-PRESERVE'
    });
    assert.equal(r.action_id, actionId);
    const regs = auditoria.listar({ action_id: actionId });
    assert.ok(regs.length >= 1);
    assert.equal(regs[0].origem, OrigemAcao.AUTOMATIC);
    assert.equal(regs[0].modo, ModoOperacao.AUTOMATICO);
    assert.ok(regs[0].request_id === 'REQ-XML-1' || regs[0].request_id === 'REQ-PRESERVE');

    await orch.salvarConfig({ modo: ModoOperacao.ASSISTIDO });
    const m = await orch.solicitarAcao({
      tipo: TipoAcao.SINCRONIZAR_DISTNSU,
      cnpj: '14200166000187',
      ambiente: 1,
      origem: OrigemAcao.MANUAL,
      usuarioId: 7
    });
    assert.equal(m.enfileirado, true);
    const regsM = auditoria.listar({ action_id: m.action_id });
    assert.equal(regsM[0].origem, OrigemAcao.MANUAL);
    assert.equal(regsM[0].usuarioId, 7);
  });
});

describe('Sprint 5 — reconciliação → propostas', () => {
  it('XML_PENDENTE e DOCUMENTOS_POSTERIORES mapeiam ações; lacuna exige confirmação', async () => {
    const { orch } = criarOrch();
    await orch.salvarConfig({ modo: ModoOperacao.AUTOMATICO });
    const propostas = orch.proporAcoesDeReconcilicao({
      cnpj: '14200166000187',
      ambiente: 1,
      achados: [
        { codigo: AchadoCodigo.XML_PENDENTE, documentoId: 1, chave: '1'.repeat(44) },
        { codigo: AchadoCodigo.DOCUMENTOS_POSTERIORES_DISPONIVEIS, mensagem: 'NSU posteriores' },
        { codigo: AchadoCodigo.POSSIVEL_LACUNA_NSU }
      ]
    });
    assert.equal(propostas.length, 3);
    const processados = await orch.processarPropostas(propostas, { origem: OrigemAcao.AUTOMATIC });
    const xml = processados.find((p) => p.acao === TipoAcao.RECUPERAR_XML);
    const sync = processados.find((p) => p.acao === TipoAcao.SINCRONIZAR_DISTNSU);
    const lacuna = processados.find((p) => p.acao === TipoAcao.ANALISAR_LACUNA);
    assert.equal(xml.executado, true);
    assert.equal(sync.executado, true);
    assert.equal(lacuna.enfileirado, true);
    assert.equal(lacuna.status, StatusDecisao.ACAO_REQUER_CONFIRMACAO);
  });
});
