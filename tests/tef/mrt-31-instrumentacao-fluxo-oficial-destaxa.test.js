'use strict';

/**
 * MRT-31 — Instrumentação do fluxo oficial Destaxa
 * Somente unitários/mocks. Sem INIT, ENABLE_REAL, TX, DLL, Native Host, V$Pague.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const REPORT_PATH = path.join(__dirname, '../../docs/build/mrt-31-instrumentacao-fluxo-oficial-destaxa-report.json');

const {
  ETAPAS_FLUXO,
  CAMPOS_IDENTIDADE,
  montarContextoEvidencia,
  formatarLinhaEvidencia,
  registrarEtapaFluxo,
  descreverCaminhoOficial,
  montarEnvelopeIpcTxStart,
  sanitizarEvidencia,
  instalarColetorTeste
} = require('../../backend/services/tef/destaxa/destaxaFluxoInstrumentacao');
const {
  validarPersistenciaAntesEnvioFinanceiro,
  garantirIdentidadeOperacao
} = require('../../backend/services/tef/tefPersistenciaObrigatoria');
const DestaxaRealAdapter = require('../../backend/services/tef/adapters/DestaxaRealAdapter');
const {
  REAL_TRANSACTION_ENV,
  ERROS,
  transacaoRealHabilitada
} = require('../../backend/services/tef/destaxa/destaxaConstantes');

function ler(rel) {
  return fs.readFileSync(path.join(__dirname, '../..', rel), 'utf8');
}

function ok(nome, cond, evidencias = {}) {
  if (!cond) throw new Error(`FAIL — ${nome}: ${JSON.stringify(evidencias)}`);
  console.log(`  OK — ${nome}`);
  return { nome, ok: true, ...evidencias };
}

async function main() {
  const geradoEm = new Date().toISOString();
  console.log('=== MRT-31 — Instrumentação fluxo oficial Destaxa (sem DLL) ===\n');

  delete process.env[REAL_TRANSACTION_ENV];
  assert.strictEqual(transacaoRealHabilitada(), false);

  const resultados = [];
  const eventosColetados = [];
  const removerColetor = instalarColetorTeste((ev) => eventosColetados.push(ev));

  // --- Etapas / formatação ---
  console.log('1. Formatação e etapas');
  const etapas = Object.values(ETAPAS_FLUXO);
  resultados.push(ok('Sete etapas canônicas definidas',
    etapas.length === 7
    && etapas.includes('PERSISTENCIA_CONFIRMADA')
    && etapas.includes('KOFFI_CALL_BEGIN')
    && etapas.includes('TX_START_RESULT'),
    { etapas }));

  const ctx = montarContextoEvidencia({
    operation_id: 'op_test',
    transactionId: '9001',
    venda_id: 42,
    pdvId: 'pdv-1',
    terminalTefId: 'term-1',
    fingerprint: 'abc',
    idempotency_key: 'idem-1'
  });
  resultados.push(ok('Contexto inclui identidade + pid/ppid/timestamp',
    ctx.operation_id === 'op_test'
    && ctx.transactionId === '9001'
    && ctx.venda_id === 42
    && ctx.pdvId === 'pdv-1'
    && ctx.terminalTefId === 'term-1'
    && ctx.pid === process.pid
    && ctx.timestamp,
    { ctx }));

  const linha = formatarLinhaEvidencia(ETAPAS_FLUXO.PERSISTENCIA_CONFIRMADA, ctx, {
    resultadoPersistencia: 'INSERT_OK',
    pan: '4111111111111111',
    senha: '1234'
  });
  resultados.push(ok('Sanitização oculta pan/senha',
    linha.pan === '[REDACTED]'
    && linha.senha === '[REDACTED]'
    && linha.etapa === 'PERSISTENCIA_CONFIRMADA'
    && linha.resultadoPersistencia === 'INSERT_OK',
    { linha }));

  registrarEtapaFluxo(ETAPAS_FLUXO.PERSISTENCIA_CONFIRMADA, ctx, { resultadoPersistencia: 'INSERT_OK' });
  registrarEtapaFluxo(ETAPAS_FLUXO.ADAPTER_AUTORIZADO, ctx, { gateFinanceiro: false });
  resultados.push(ok('registrarEtapaFluxo coleta sem lançar',
    eventosColetados.length >= 2
    && eventosColetados[0].etapa === 'PERSISTENCIA_CONFIRMADA'
    && eventosColetados[1].etapa === 'ADAPTER_AUTORIZADO',
    { eventos: eventosColetados.map((e) => e.etapa) }));

  // --- Identidade / persistência ---
  console.log('\n2. Identidade e persistência obrigatória');
  const id = garantirIdentidadeOperacao({
    tipo: 'credito',
    valor: 1,
    venda_id: 42,
    operation_id: 'op_cliente'
  }, { pdvId: 'pdv-1', terminalTefId: 'term-1', provedor: 'destaxa' });
  resultados.push(ok('Identidade estável sem Date.now exclusivo',
    id.operation_id && id.fingerprint && id.idempotency_key
    && id.identidadeExclusivaDateNow === false,
    { id }));

  const semPers = validarPersistenciaAntesEnvioFinanceiro(null, { tipo: 'credito', valor: 1 });
  resultados.push(ok('Sem persistência → bloqueio',
    semPers.ok === false,
    { semPers }));

  const comPers = validarPersistenciaAntesEnvioFinanceiro({
    transactionId: '9001',
    persistenciaConfirmada: true,
    operation_id: id.operation_id
  }, {});
  resultados.push(ok('Com persistência → ok caminho TefManager',
    comPers.ok === true && comPers.transactionId === '9001',
    { comPers }));

  // --- Envelope IPC ---
  console.log('\n3. Envelope IPC (serialização estática)');
  const envelope = montarEnvelopeIpcTxStart({
    operacao: 'CRT',
    campos: { transacao_valor: '1.00' },
    transactionId: '9001'
  });
  resultados.push(ok('transactionId separado dos campos DLL',
    envelope.transactionId === '9001'
    && envelope.payload.campos.transacao_valor === '1.00'
    && !('transactionId' in envelope.payload.campos)
    && envelope.operation === 'TX_START',
    { envelope }));

  const sanEntrada = sanitizarEvidencia({
    entrada: 'transacao_valor=1.00;outro=x',
    pan: '4111'
  });
  resultados.push(ok('entrada DLL não é espelhada completa',
    sanEntrada.tamanhoEntrada === 'transacao_valor=1.00;outro=x'.length
    && Array.isArray(sanEntrada.chavesEntrada)
    && sanEntrada.pan === '[REDACTED]'
    && sanEntrada.entrada == null,
    { sanEntrada }));

  // --- Gate OFF + Adapter sem Koffi ---
  console.log('\n4. Gate OFF bloqueia financeiro; sem Koffi');
  let koffiChamadas = 0;
  const bridgeMock = {
    async habilitarTransacaoReal() {
      return {
        sucesso: false,
        codigo: ERROS.DESTAXA_REAL_TRANSACTION_DISABLED,
        mensagem: 'gate off'
      };
    },
    async iniciarTransacaoDestaxa() {
      koffiChamadas += 1;
      throw new Error('Koffi/DLL não deve ser chamada na MRT-31');
    }
  };
  const adapter = new DestaxaRealAdapter(
    { provedor: 'destaxa', ambiente: 'homologacao' },
    { bridge: bridgeMock, executionMode: 'in-process' }
  );
  const preparo = {
    pronto: true,
    transactionId: '9001',
    persistenciaConfirmada: true,
    operation_id: id.operation_id,
    fingerprint: id.fingerprint,
    contexto: {
      operacao: 'CRT',
      camposEntrada: { transacao_valor: '1.00' },
      checks: { mrt31: true }
    }
  };
  const antes = eventosColetados.length;
  const r = await adapter.autorizarPagamento({ tipo: 'credito', valor: 1, venda_id: 42 }, preparo);
  resultados.push(ok('Adapter com persistência + gate OFF → bloqueio financeiro',
    r.sucesso === false
    && r.codigo === ERROS.DESTAXA_REAL_TRANSACTION_DISABLED
    && r.transactionAttempted === false,
    { codigo: r.codigo }));
  resultados.push(ok('Nenhuma chamada iniciarTransacaoDestaxa/Koffi',
    koffiChamadas === 0,
    { koffiChamadas }));
  const etapasPosAdapter = eventosColetados.slice(antes).map((e) => e.etapa);
  resultados.push(ok('ADAPTER_AUTORIZADO emitido; sem KOFFI_* / TX_START_RESULT',
    etapasPosAdapter.includes('ADAPTER_AUTORIZADO')
    && !etapasPosAdapter.includes('KOFFI_CALL_BEGIN')
    && !etapasPosAdapter.includes('HOST_RECEBEU_TX_START')
    && !etapasPosAdapter.includes('TX_START_RESULT'),
    { etapasPosAdapter }));

  // --- Exceção simulada no formatador ---
  console.log('\n5. Tratamento best-effort');
  const nulo = registrarEtapaFluxo('', {});
  resultados.push(ok('Etapa vazia não quebra', nulo === null, {}));

  // --- Estático: ganchos no código ---
  console.log('\n6. Ganchos estáticos no caminho oficial');
  const tm = ler('backend/services/tef/TefManager.js');
  const ad = ler('backend/services/tef/adapters/DestaxaRealAdapter.js');
  const hb = ler('backend/services/tef/destaxa/DestaxaHostBridge.js');
  const nh = ler('backend/services/tef/destaxa/DestaxaNativeHost.js');
  const orq = ler('backend/services/tef/destaxa/destaxaTransacaoOrquestrador.js');
  const nb = ler('backend/services/tef/destaxa/DestaxaNativeBridge.js');
  const koffi = ler('backend/services/tef/destaxa/destaxaKoffiLoader.js');

  resultados.push(ok('TefManager emite PERSISTENCIA_CONFIRMADA',
    /PERSISTENCIA_CONFIRMADA/.test(tm) && /destaxaFluxoInstrumentacao/.test(tm), {}));
  resultados.push(ok('Adapter emite ADAPTER_AUTORIZADO',
    /ADAPTER_AUTORIZADO/.test(ad), {}));
  resultados.push(ok('HostBridge documenta envelope IPC',
    /IPC_TX_START_ENVELOPE|montarEnvelopeIpcTxStart/.test(hb), {}));
  resultados.push(ok('NativeHost emite HOST_RECEBEU_TX_START',
    /HOST_RECEBEU_TX_START/.test(nh), {}));
  resultados.push(ok('Orquestrador emite ORQUESTRADOR_ENTROU e TX_START_RESULT',
    /ORQUESTRADOR_ENTROU/.test(orq) && /TX_START_RESULT/.test(orq), {}));
  resultados.push(ok('NativeBridge emite KOFFI_CALL_BEGIN/END',
    /KOFFI_CALL_BEGIN/.test(nb) && /KOFFI_CALL_END/.test(nb), {}));
  resultados.push(ok('Assinatura Koffi inalterada',
    /iniciaTransacaoDestaxa:\s*'void iniciaTransacaoDestaxa\(uint8 \*resultado, const char \*operacao/.test(koffi),
    {}));

  const caminho = descreverCaminhoOficial();
  resultados.push(ok('Caminho oficial documentado',
    Array.isArray(caminho.caminho) && caminho.caminho.includes('TefManager.autorizar'),
    { passos: caminho.caminho.length }));

  resultados.push(ok('Gate financeiro OFF',
    transacaoRealHabilitada() === false, {}));
  resultados.push(ok('Campos de identidade documentados',
    CAMPOS_IDENTIDADE.includes('operation_id') && CAMPOS_IDENTIDADE.includes('transactionId'),
    { CAMPOS_IDENTIDADE }));

  removerColetor();

  const classificacao = resultados.every((r) => r.ok)
    ? 'INSTRUMENTACAO_FLUXO_OFICIAL_APROVADA'
    : 'INSTRUMENTACAO_FLUXO_OFICIAL_REPROVADA';

  const relatorio = {
    sprint: 'MRT-31',
    title: 'Instrumentação do fluxo oficial TEF Destaxa',
    generatedAt: geradoEm,
    classificacao,
    restricoesObservadas: {
      init: false,
      enableReal: false,
      txStart: false,
      crt: false,
      continueFinanceiro: false,
      finalizeFinanceiro: false,
      est: false,
      cancelamento: false,
      dllCarregada: false,
      nativeHostIniciado: false,
      vspagueReiniciado: false,
      gateOff: true,
      bancoAlterado: false,
      configProducaoAlterada: false,
      novaOperacaoFinanceira: false,
      novaIdempotencyKey: false,
      assinaturaKoffiAlterada: false,
      correcaoFuncional: false
    },
    caminhoOficial: caminho,
    instrumentacaoPreparada: {
      modulo: 'backend/services/tef/destaxa/destaxaFluxoInstrumentacao.js',
      etapas: { ...ETAPAS_FLUXO },
      ganchos: {
        TefManager: 'PERSISTENCIA_CONFIRMADA pós INSERT',
        DestaxaRealAdapter: 'ADAPTER_AUTORIZADO pós guard persistência',
        DestaxaHostBridge: 'IPC_TX_START_ENVELOPE (transactionId ≠ campos)',
        DestaxaNativeHost: 'HOST_RECEBEU_TX_START',
        DestaxaTransacaoOrquestrador: 'ORQUESTRADOR_ENTROU + TX_START_RESULT',
        DestaxaNativeBridge: 'KOFFI_CALL_BEGIN / KOFFI_CALL_END'
      },
      nota: 'Etapas 3–7 só aparecem em execução futura autorizada; nesta sprint não foram produzidas por TX real'
    },
    arquivosAuditados: [
      'backend/services/tef/TefManager.js',
      'backend/services/tef/adapters/DestaxaRealAdapter.js',
      'backend/services/tef/destaxa/DestaxaHostBridge.js',
      'backend/services/tef/destaxa/DestaxaNativeHost.js',
      'backend/services/tef/destaxa/DestaxaNativeBridge.js',
      'backend/services/tef/destaxa/destaxaTransacaoOrquestrador.js',
      'backend/services/tef/destaxa/destaxaKoffiLoader.js',
      'backend/services/tef/tefPersistenciaObrigatoria.js',
      'docs/build/mrt-27-persistencia-obrigatoria-tef-report.json',
      'docs/build/mrt-30-auditoria-disparo-inicia-transacao-destaxa-report.json'
    ],
    arquivosAlterados: [
      'backend/services/tef/destaxa/destaxaFluxoInstrumentacao.js',
      'backend/services/tef/TefManager.js',
      'backend/services/tef/adapters/DestaxaRealAdapter.js',
      'backend/services/tef/destaxa/DestaxaHostBridge.js',
      'backend/services/tef/destaxa/DestaxaNativeHost.js',
      'backend/services/tef/destaxa/DestaxaNativeBridge.js',
      'backend/services/tef/destaxa/destaxaTransacaoOrquestrador.js',
      'tests/tef/mrt-31-instrumentacao-fluxo-oficial-destaxa.test.js',
      'docs/build/mrt-31-instrumentacao-fluxo-oficial-destaxa-report.json'
    ],
    testes: resultados,
    mrt24: {
      estado: 'UNKNOWN',
      preservado: true,
      repetida: false
    },
    pendenciasHomologacaoFutura: [
      'Tech Lead autorizar sprint de CRT homologação com TefManager + persistência',
      'Gate ENABLE_REAL pontual somente na janela autorizada',
      'Confirmar novas linhas em destaxa-dll.log após KOFFI_CALL_BEGIN/END',
      'Validar sequência completa PERSISTENCIA→…→TX_START_RESULT nos logs estruturados',
      'Não repetir MRT-24; nova identidade persistida'
    ],
    confirmacoes: {
      dllNaoCarregada: true,
      operacaoFinanceira: false,
      gateFinanceiroOff: true,
      mrt24Unknown: true,
      koffiChamadasNosTestes: koffiChamadas
    }
  };

  fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
  fs.writeFileSync(REPORT_PATH, JSON.stringify(relatorio, null, 2), 'utf8');

  console.log(`\n  Relatório: ${REPORT_PATH}`);
  console.log(`  Classificação: ${classificacao}`);
  console.log(`  Koffi chamadas: ${koffiChamadas}`);
  console.log(`  Gate OFF: true | MRT-24 UNKNOWN preservado`);
  console.log(`\n  MRT-31 CONCLUÍDA — ${classificacao}\n`);
  console.log('  Aguardando revisão do Tech Lead antes de nova etapa.\n');

  if (classificacao !== 'INSTRUMENTACAO_FLUXO_OFICIAL_APROVADA') process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
