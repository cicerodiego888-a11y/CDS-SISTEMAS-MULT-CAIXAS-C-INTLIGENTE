'use strict';

/**
 * MRT-27 — Persistência obrigatória das operações TEF
 * Simulado / read-only financeiro: sem INIT, TX_START real, CRT, ENABLE_REAL, EST.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const REPORT_PATH = path.join(__dirname, '../../docs/build/mrt-27-persistencia-obrigatoria-tef-report.json');

const {
  garantirIdentidadeOperacao,
  montarFingerprintOperacao,
  montarBlocoPersistenciaPreEnvio,
  classificarIdempotencia,
  validarPersistenciaAntesEnvioFinanceiro,
  validarTxStartComPersistencia,
  projetarRecuperacaoIdentidade,
  ERROS_PERSISTENCIA,
  CAMINHOS
} = require('../../backend/services/tef/tefPersistenciaObrigatoria');
const DestaxaRealAdapter = require('../../backend/services/tef/adapters/DestaxaRealAdapter');
const {
  REAL_TRANSACTION_ENV,
  ERROS,
  transacaoRealHabilitada
} = require('../../backend/services/tef/destaxa/destaxaConstantes');
const { FINANCIAL_STATES } = require('../../backend/services/tef/tefFinancialSafetyPolicy');
const { executarCicloCrt } = require('../../backend/services/tef/destaxa/destaxaCrtCicloOrquestracao');

function ler(rel) {
  return fs.readFileSync(path.join(__dirname, '../..', rel), 'utf8');
}

function ok(nome, cond, evidencias = {}) {
  if (!cond) {
    const err = new Error(`FAIL — ${nome}`);
    err.evidencias = evidencias;
    throw err;
  }
  console.log(`  OK — ${nome}`);
  return { nome, ok: true, ...evidencias };
}

async function main() {
  const geradoEm = new Date().toISOString();
  console.log('=== MRT-27 — Persistência obrigatória TEF (simulado) ===\n');

  delete process.env[REAL_TRANSACTION_ENV];
  assert.strictEqual(transacaoRealHabilitada(), false);

  const resultados = [];
  const arquivosAnalisados = [
    'backend/services/tef/TefManager.js',
    'backend/services/tef/tefRepository.js',
    'backend/services/tef/tefPersistenciaObrigatoria.js',
    'backend/services/tef/adapters/DestaxaRealAdapter.js',
    'backend/services/tef/destaxa/DestaxaHostBridge.js',
    'backend/services/tef/destaxa/destaxaCrtCicloOrquestracao.js',
    'backend/services/tef/destaxa/destaxaHomologacaoCrtHarness.js',
    'backend/database.js (schema tef_transacoes — reutilizado, sem migration)'
  ];
  const arquivosAlterados = [
    'backend/services/tef/tefPersistenciaObrigatoria.js',
    'backend/services/tef/TefManager.js',
    'backend/services/tef/tefRepository.js',
    'backend/services/tef/adapters/DestaxaRealAdapter.js',
    'backend/services/tef/destaxa/DestaxaHostBridge.js',
    'backend/services/tef/destaxa/destaxaCrtCicloOrquestracao.js',
    'backend/services/tef/destaxa/destaxaConstantes.js',
    'backend/services/tef/destaxa/destaxaHomologacaoCrtHarness.js',
    'tests/tef/mrt-27-persistencia-obrigatoria-tef.test.js',
    'docs/build/mrt-27-persistencia-obrigatoria-tef-report.json'
  ];

  // --- 1. Identidade / fingerprint (sem Date.now exclusivo) ---
  console.log('1. Identidade e fingerprint');
  const id1 = garantirIdentidadeOperacao({
    tipo: 'credito',
    valor: 1,
    venda_id: 42,
    provedor: 'destaxa',
    operation_id: 'op-cliente-abc'
  }, { pdvId: 'pdv-1', terminalTefId: 'term-1' });
  resultados.push(ok('Identidade não usa Date.now exclusivo',
    id1.identidadeExclusivaDateNow === false
    && !String(id1.operation_id).match(/^tef_\d{13}$/)
    && id1.fingerprint.length === 32
    && id1.idempotency_key.length > 8,
    { operation_id: id1.operation_id, fingerprint: id1.fingerprint, idempotency_key: id1.idempotency_key }));

  const fpA = montarFingerprintOperacao({
    tipo: 'credito', valor: 1, venda_id: 42, operation_id: 'op-cliente-abc', provedor: 'destaxa'
  }, { pdvId: 'pdv-1', terminalTefId: 'term-1' });
  const fpB = montarFingerprintOperacao({
    tipo: 'credito', valor: 1, venda_id: 42, operation_id: 'op-cliente-abc', provedor: 'destaxa'
  }, { pdvId: 'pdv-1', terminalTefId: 'term-1' });
  resultados.push(ok('Mesma operação → mesmo fingerprint', fpA === fpB, { fpA, fpB }));

  const bloco = montarBlocoPersistenciaPreEnvio({
    operationId: id1.operation_id,
    fingerprint: id1.fingerprint,
    idempotencyKey: id1.idempotency_key,
    vendaId: 42,
    pdvId: 'pdv-1',
    terminalTefId: 'term-1',
    provedor: 'destaxa',
    valor: 1,
    tipo: 'credito',
    estadoFinanceiroInicial: FINANCIAL_STATES.UNKNOWN
  });
  resultados.push(ok('1. Persistência pré-envio contém campos obrigatórios',
    bloco.persistidoAntesDll === true
    && bloco.operation_id
    && bloco.fingerprint
    && bloco.idempotency_key
    && bloco.venda_id === 42
    && bloco.pdvId === 'pdv-1'
    && bloco.terminalTefId === 'term-1'
    && bloco.provedor === 'destaxa'
    && bloco.valor === 1
    && bloco.tipo === 'credito'
    && bloco.estadoFinanceiroInicial === FINANCIAL_STATES.UNKNOWN
    && bloco.dataHora,
    { bloco }));

  // --- 2. Falha de persistência bloqueia Adapter ---
  console.log('\n2. Falha de persistência / bypass Adapter');
  const guardSemPersistencia = validarPersistenciaAntesEnvioFinanceiro(null, { tipo: 'credito', valor: 1 });
  resultados.push(ok('2. Sem persistência → bloqueio',
    guardSemPersistencia.ok === false
    && guardSemPersistencia.codigo === ERROS_PERSISTENCIA.OBRIGATORIA,
    { guardSemPersistencia }));

  const guardComPersistencia = validarPersistenciaAntesEnvioFinanceiro({
    pronto: true,
    transactionId: '9001',
    persistenciaConfirmada: true,
    operation_id: id1.operation_id,
    fingerprint: id1.fingerprint
  }, { tipo: 'credito', valor: 1 });
  resultados.push(ok('Com persistência confirmada → libera caminho TefManager',
    guardComPersistencia.ok === true
    && guardComPersistencia.caminho === CAMINHOS.PRODUCAO_TEF_MANAGER
    && guardComPersistencia.transactionId === '9001',
    { guardComPersistencia }));

  let bridgeChamadas = { inicia: 0, enable: 0 };
  const bridgeMock = {
    async habilitarTransacaoReal() {
      bridgeChamadas.enable += 1;
      return { sucesso: false, codigo: ERROS.DESTAXA_REAL_TRANSACTION_DISABLED, mensagem: 'gate off' };
    },
    async iniciarTransacaoDestaxa() {
      bridgeChamadas.inicia += 1;
      throw new Error('DLL financeira não deve ser chamada neste teste');
    }
  };
  const adapter = new DestaxaRealAdapter(
    { provedor: 'destaxa', ambiente: 'homologacao' },
    { bridge: bridgeMock, executionMode: 'in-process' }
  );
  // Forja preparo pronto sem passar pelo preparar real (evita DLL/PinPad)
  const preparoFalso = {
    pronto: true,
    contexto: {
      operacao: 'CRT',
      camposEntrada: { transacao_valor: '1.00' },
      checks: { forged: true }
    }
  };
  const bypass = await adapter.autorizarPagamento(
    { tipo: 'credito', valor: 1 },
    preparoFalso
  );
  resultados.push(ok('8. Chamada direta Adapter sem persistência → bloqueada',
    bypass.sucesso === false
    && (bypass.codigo === ERROS_PERSISTENCIA.OBRIGATORIA || bypass.codigo === ERROS.TEF_PERSISTENCIA_OBRIGATORIA)
    && bridgeChamadas.enable === 0
    && bridgeChamadas.inicia === 0
    && bypass.transactionAttempted === false,
    { codigo: bypass.codigo, bridgeChamadas }));

  const comPersistenciaGateOff = await adapter.autorizarPagamento(
    { tipo: 'credito', valor: 1 },
    { ...preparoFalso, transactionId: '9001', persistenciaConfirmada: true }
  );
  resultados.push(ok('Com persistência + gate OFF → não chama TX_START (gate bloqueia)',
    comPersistenciaGateOff.sucesso === false
    && comPersistenciaGateOff.codigo === ERROS.DESTAXA_REAL_TRANSACTION_DISABLED
    && bridgeChamadas.inicia === 0
    && bridgeChamadas.enable === 1,
    { codigo: comPersistenciaGateOff.codigo, bridgeChamadas: { ...bridgeChamadas } }));

  // --- 3. Idempotência ---
  console.log('\n3. Idempotência');
  const rowAprovada = {
    id: 10,
    status: 'aprovado',
    provedor: 'destaxa',
    idempotency_key: id1.idempotency_key,
    payload_retorno: { persistencia: bloco, financialState: FINANCIAL_STATES.CONFIRMED_SUCCESS }
  };
  const idemAprov = classificarIdempotencia(rowAprovada, id1.fingerprint);
  resultados.push(ok('4. Aprovada → preservar aprovação / bloquear reenvio',
    idemAprov.acao === 'PRESERVAR_APROVACAO' && idemAprov.bloquearEnvio === true,
    { idemAprov }));

  const rowNegada = {
    id: 11,
    status: 'negado',
    provedor: 'destaxa',
    idempotency_key: id1.idempotency_key,
    payload_retorno: { financialState: FINANCIAL_STATES.CONFIRMED_DENIED }
  };
  const idemNeg = classificarIdempotencia(rowNegada, id1.fingerprint);
  resultados.push(ok('Negada → preservar negativa conclusiva',
    idemNeg.acao === 'PRESERVAR_NEGATIVA' && idemNeg.bloquearEnvio === true,
    { idemNeg }));

  const rowInconclusiva = {
    id: 12,
    status: 'pendente',
    provedor: 'destaxa',
    idempotency_key: id1.idempotency_key,
    payload_retorno: {
      persistencia: bloco,
      financialState: FINANCIAL_STATES.UNKNOWN,
      inconclusivo: true
    }
  };
  const idemInc = classificarIdempotencia(rowInconclusiva, id1.fingerprint);
  resultados.push(ok('3/5. Mesma operation/fingerprint inconclusiva → reutiliza e bloqueia 2º envio',
    idemInc.acao === 'BLOQUEAR_REENVIAR'
    && idemInc.reutilizar === true
    && idemInc.bloquearEnvio === true
    && idemInc.preservarUnknown === true
    && idemInc.financialState === FINANCIAL_STATES.UNKNOWN,
    { idemInc }));

  // --- 4. Recuperação após reinício ---
  console.log('\n4. Recuperação');
  const recuperada = projetarRecuperacaoIdentidade({
    id: 12,
    status: 'pendente',
    provedor: 'destaxa',
    venda_id: 42,
    valor: 1,
    tipo: 'credito',
    idempotency_key: id1.idempotency_key,
    codigo_transacao: id1.operation_id,
    payload_retorno: {
      persistencia: bloco,
      financialState: FINANCIAL_STATES.UNKNOWN
    }
  });
  resultados.push(ok('6. Recuperação preserva transactionId / idempotency / provedor',
    recuperada.transacaoId === '12'
    && recuperada.idempotency_key === id1.idempotency_key
    && recuperada.provedor === 'destaxa'
    && recuperada.operation_id === id1.operation_id
    && recuperada.reenvioAutomaticoProibido === true,
    { recuperada }));
  resultados.push(ok('7. Provedor original preservado na recuperação',
    recuperada.provedor === 'destaxa',
    { provedor: recuperada.provedor }));
  resultados.push(ok('9. venda_id recuperável no vínculo',
    recuperada.venda_id === 42,
    { venda_id: recuperada.venda_id }));
  resultados.push(ok('10. UNKNOWN preservado sem evidência conclusiva',
    recuperada.financialState === FINANCIAL_STATES.UNKNOWN
    && recuperada.preservarUnknown === true,
    { financialState: recuperada.financialState }));

  // --- 5. TX_START / ciclo com exigência de persistência ---
  console.log('\n5. Proteção TX_START / ciclo');
  const txSemId = validarTxStartComPersistencia({ transactionId: null }, true);
  resultados.push(ok('TX_START gate ON sem transactionId → bloqueado',
    txSemId.ok === false && txSemId.codigo === ERROS_PERSISTENCIA.TX_START_SEM_IDENTIDADE,
    { txSemId }));
  const txComId = validarTxStartComPersistencia({ transactionId: '9001' }, true);
  resultados.push(ok('TX_START gate ON com transactionId → ok',
    txComId.ok === true && txComId.transactionId === '9001',
    { txComId }));

  const cicloBloqueado = await executarCicloCrt({
    bridge: bridgeMock,
    operacao: 'CRT',
    camposEntrada: { transacao_valor: '1.00' },
    transactionId: null,
    exigirPersistencia: true
  });
  resultados.push(ok('Ciclo CRT sem transactionId + exigirPersistencia → sem TX_START',
    cicloBloqueado.sucesso === false
    && (cicloBloqueado.codigo === ERROS.TEF_PERSISTENCIA_OBRIGATORIA || cicloBloqueado.codigo === 'TEF_PERSISTENCIA_OBRIGATORIA')
    && cicloBloqueado.ciclo?.txStartExecutado === false
    && bridgeChamadas.inicia === 0,
    { codigo: cicloBloqueado.codigo, ciclo: cicloBloqueado.ciclo }));

  // --- 6. Evidência estática no fluxo TefManager ---
  console.log('\n6. Fluxo TefManager (estático)');
  const tm = ler('backend/services/tef/TefManager.js');
  const adapterSrc = ler('backend/services/tef/adapters/DestaxaRealAdapter.js');
  const repo = ler('backend/services/tef/tefRepository.js');
  const harness = ler('backend/services/tef/destaxa/destaxaHomologacaoCrtHarness.js');

  resultados.push(ok('TefManager persiste antes de autorizarPagamento',
    /criarTransacaoExclusiva/.test(tm)
    && /persistenciaConfirmada:\s*true/.test(tm)
    && /montarBlocoPersistenciaPreEnvio/.test(tm)
    && tm.indexOf('criarTransacaoExclusiva') < tm.indexOf('autorizarPagamento('),
    {}));
  resultados.push(ok('TefManager: falha de persistência resolve TEF_PERSISTENCIA_FALHOU',
    /ERROS_PERSISTENCIA\.FALHOU/.test(tm) || /TEF_PERSISTENCIA_FALHOU/.test(tm),
    {}));
  resultados.push(ok('Adapter exige validarPersistenciaAntesEnvioFinanceiro',
    /validarPersistenciaAntesEnvioFinanceiro/.test(adapterSrc),
    {}));
  resultados.push(ok('Repository grava operation_id em codigo_transacao',
    /codigo_transacao/.test(repo) && /operation_id/.test(repo),
    {}));
  resultados.push(ok('Harness documenta separação PRODUCAO vs HARNESS',
    /PRODUCAO/.test(harness) && /HARNESS_SIMULADO/.test(harness) && /MRT-27/.test(harness),
    {}));
  resultados.push(ok('Idempotência classificada no TefManager',
    /classificarIdempotencia/.test(tm) && /garantirIdentidadeOperacao/.test(tm),
    {}));

  // Harness simulado path
  const harnessSim = validarPersistenciaAntesEnvioFinanceiro(
    { caminhoHarness: 'simulado' },
    { _caminhoHarness: 'simulado' },
    { gateOn: false }
  );
  resultados.push(ok('Caminho harness simulado (gate OFF) separado da produção',
    harnessSim.ok === true && harnessSim.caminho === CAMINHOS.HARNESS_SIMULADO,
    { harnessSim }));

  const gateOff = !transacaoRealHabilitada();
  resultados.push(ok('Gate financeiro OFF', gateOff, { REAL_TRANSACTION_ENV: process.env[REAL_TRANSACTION_ENV] || null }));

  const classificacao = resultados.every((r) => r.ok)
    ? 'PERSISTENCIA_OBRIGATORIA_APROVADA'
    : 'PERSISTENCIA_OBRIGATORIA_REPROVADA';

  const relatorio = {
    sprint: 'MRT-27',
    title: 'Persistência obrigatória das operações TEF',
    generatedAt: geradoEm,
    classificacao,
    restricoesObservadas: {
      init: false,
      txStart: false,
      crt: false,
      continueFinanceiro: false,
      finalizeFinanceiro: false,
      est: false,
      cancelamento: false,
      estorno: false,
      enableReal: false,
      gateOff: true,
      bancoProducao: false,
      mrt24Repetida: false,
      mrt24Liberada: false,
      operacaoFinanceira: false
    },
    fluxoAnterior: {
      descricao: 'MRT-24 chamou DestaxaRealAdapter.autorizarPagamento diretamente — sem TefManager.autorizar, sem INSERT em tef_transacoes; idempotency só em memória',
      risco: 'Identidade perdida após queda do processo; impossível reconciliar'
    },
    fluxoCorrigido: {
      passos: [
        'PDV/API',
        'TefManager.autorizar',
        'garantirIdentidadeOperacao (fingerprint/operation_id/idempotency_key)',
        'classificarIdempotencia (bloquear reenvio inconclusivo; preservar aprovado/negado)',
        'criarTransacaoExclusiva + payload.persistencia',
        'adapter.autorizarPagamento({ persistenciaConfirmada, transactionId })',
        'DestaxaRealAdapter valida persistência',
        'Native Host / DLL'
      ],
      bypassBloqueado: true
    },
    evidencias: {
      persistenciaAntesDll: bloco,
      bloqueioSemPersistencia: guardSemPersistencia,
      bloqueioChamadaDiretaAdapter: { codigo: bypass.codigo, bridgeChamadas },
      idempotenciaInconclusiva: idemInc,
      recuperacaoAposReinicio: recuperada,
      provedorPreservado: recuperada.provedor,
      unknownPreservado: recuperada.financialState === FINANCIAL_STATES.UNKNOWN
    },
    arquivosAnalisados,
    arquivosAlterados,
    migration: {
      criada: false,
      motivo: 'Schema tef_transacoes já possui idempotency_key, provedor, codigo_transacao, payload_retorno, venda_id — fingerprint/operation_id em payload.persistencia'
    },
    testes: resultados,
    confirmacoes: {
      operacaoFinanceira: false,
      gateFinanceiroOff: true,
      dllNaoChamada: bridgeChamadas.inicia === 0
    }
  };

  fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
  fs.writeFileSync(REPORT_PATH, JSON.stringify(relatorio, null, 2), 'utf8');

  console.log(`\n  Relatório: ${REPORT_PATH}`);
  console.log(`  Classificação: ${classificacao}`);
  console.log(`  Gate OFF: ${gateOff}`);
  console.log(`  DLL/TX_START chamadas: ${bridgeChamadas.inicia}`);
  console.log(`\n  MRT-27 CONCLUÍDA — ${classificacao}\n`);

  if (classificacao !== 'PERSISTENCIA_OBRIGATORIA_APROVADA') {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
