/**
 * TEF-DESTAXA-06B — caminho CRT real controlado (sem transação financeira).
 *
 * Permitido: carregar DLL, validar exports, iniciaClientDestaxa(), detectar
 * VSPague/PPC930 e provar que o gate financeiro bloqueia antes da DLL.
 * Proibido: iniciaTransacaoDestaxa / continuaTransacaoDestaxa / finalizaTransacaoDestaxa reais.
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const REAL_TRANSACTION_ENV = 'DESTAXA_REAL_TRANSACTION_ENABLED';
if (String(process.env[REAL_TRANSACTION_ENV] || '').trim() === '1') {
  console.error(`BLOQUEADO: ${REAL_TRANSACTION_ENV} deve permanecer desabilitada na 06B`);
  process.exit(2);
}

const DestaxaRealAdapter = require('../../backend/services/tef/adapters/DestaxaRealAdapter');
const DestaxaNativeBridge = require('../../backend/services/tef/destaxa/DestaxaNativeBridge');
const DestaxaTransacaoOrquestrador = require('../../backend/services/tef/destaxa/destaxaTransacaoOrquestrador');
const DestaxaTransacaoMockDriver = require('../../backend/services/tef/destaxa/destaxaTransacaoMockDriver');
const { criarDriverTransacaoNativo } = DestaxaNativeBridge;
const {
  buildCrtInput,
  valorReaisParaCentavos,
  parseParametrosDestaxa
} = require('../../backend/services/tef/destaxa/destaxaProtocolo');
const {
  ERROS,
  OPERACOES,
  TIPOS_ACAO,
  ESTADOS_TRANSACAO,
  CAMPOS_ENTRADA_CRT_DOCUMENTADOS,
  BUFFER_SAIDA_BYTES_SUGERIDO,
  ENCODING_DESTAXA,
  VALOR_HOMOLOGACAO_CENTAVOS,
  FINALIZACAO_CONFIRMAR,
  FINALIZACAO_CANCELAR
} = require('../../backend/services/tef/destaxa/destaxaConstantes');
const { FINANCIAL_STATES } = require('../../backend/services/tef/tefFinancialSafetyPolicy');

let passou = 0;
let falhou = 0;

async function test(nome, fn) {
  try {
    await fn();
    passou += 1;
    console.log(`  OK  ${nome}`);
  } catch (error) {
    falhou += 1;
    console.error(`  FALHOU  ${nome}`);
    console.error(`         ${error.stack || error.message}`);
  }
}

/** Exports em memória — nenhuma DLL envolvida. */
function criarLoaderFake({ codigoClient = '00' } = {}) {
  const contadores = { client: 0, inicia: 0, continua: 0, finaliza: 0 };
  const falhar = (chave) => () => {
    contadores[chave] += 1;
    throw new Error(`${chave} não deveria ser chamado`);
  };
  return {
    contadores,
    carregarBiblioteca() {
      return {
        exports: {
          iniciaClientDestaxa(resultado) {
            contadores.client += 1;
            resultado.write(codigoClient, 0, 'latin1');
          },
          iniciaTransacaoDestaxa: falhar('inicia'),
          continuaTransacaoDestaxa: falhar('continua'),
          finalizaTransacaoDestaxa: falhar('finaliza')
        },
        unload() {}
      };
    }
  };
}

const resolverFake = {
  resolverDll: () => ({ dllPath: 'memoria/libdll-integracao-tef.dll', dllExists: true, origem: 'teste' })
};

function criarConfigServiceFake(sobrescrever = {}) {
  return {
    async obterConfiguracao() {
      return { tefProvedor: 'destaxa', pinpadHabilitado: 'true', portaCom: 'COM3', ...sobrescrever };
    },
    validarConfiguracao() {
      return { valida: true, pendencias: [] };
    }
  };
}

function criarDetectorFake({ vspague = {}, pinpad = {} } = {}) {
  const chamadas = { vspague: 0, pinpad: 0 };
  return {
    chamadas,
    detectarVsPagueClient() {
      chamadas.vspague += 1;
      return { detectado: true, executando: true, responding: true, pid: 1234, ...vspague };
    },
    detectarGertecPPC930() {
      chamadas.pinpad += 1;
      return { detectado: true, estado: 'DETECTADO', porta: 'COM3', modelo: 'Gertec PPC930', usb: true, ...pinpad };
    }
  };
}

function criarAdapterControlado(opcoes = {}) {
  const loader = criarLoaderFake(opcoes.loader);
  const detector = criarDetectorFake(opcoes.detector);
  const adapter = new DestaxaRealAdapter(
    { provedor: 'destaxa', ambiente: 'homologacao', ...(opcoes.config || {}) },
    {
      nativeLoader: loader,
      resolver: resolverFake,
      configService: criarConfigServiceFake(opcoes.configTef),
      sdkDetector: detector
    }
  );
  return { adapter, loader, detector };
}

function orquestradorMock(passos, opcoes = {}) {
  const mock = new DestaxaTransacaoMockDriver(passos);
  return { mock, orq: new DestaxaTransacaoOrquestrador({ driver: mock, ...opcoes }) };
}

async function main() {
  console.log('\nTEF-DESTAXA-06B — CAMINHO CRT REAL CONTROLADO (sem transação)\n');

  // ---------------------------------------------------------------- builder
  await test('builder CRT: 100 centavos → transacao_valor=1.00 (formato oficial docs/06)', () => {
    const entrada = buildCrtInput({ valorCentavos: 100 });
    assert.strictEqual(entrada.texto, 'transacao_valor=1.00');
    assert.deepStrictEqual(entrada.chaves, ['transacao_valor']);
  });

  await test('builder CRT: operacao=CRT fica fora do input', () => {
    const entrada = buildCrtInput({ valorCentavos: 100 });
    assert.strictEqual(/operacao/i.test(entrada.texto), false);
    assert.strictEqual(/funcao/i.test(entrada.texto), false);
  });

  await test('builder CRT: somente campos documentados (docs/06)', () => {
    const entrada = buildCrtInput({ valorCentavos: 100 });
    const chaves = Object.keys(parseParametrosDestaxa(entrada.texto));
    for (const chave of chaves) {
      assert.ok(Object.prototype.hasOwnProperty.call(CAMPOS_ENTRADA_CRT_DOCUMENTADOS, chave), `campo inventado: ${chave}`);
    }
  });

  await test('builder CRT: formato chave=valor com separador ;', () => {
    const entrada = buildCrtInput({ valorCentavos: 100 });
    for (const par of entrada.texto.split(';')) {
      assert.match(par, /^[a-z_]+=[^;=]+$/);
    }
  });

  await test('builder CRT: encoding latin1 compatível (1 byte por caractere)', () => {
    const entrada = buildCrtInput({ valorCentavos: 100 });
    assert.strictEqual(ENCODING_DESTAXA, 'latin1');
    const bytes = Buffer.from(entrada.texto, ENCODING_DESTAXA);
    assert.strictEqual(bytes.length, entrada.texto.length);
    assert.strictEqual(bytes.toString(ENCODING_DESTAXA), entrada.texto);
  });

  await test('builder CRT: sem dados sensíveis', () => {
    const texto = buildCrtInput({ valorCentavos: 100 }).texto;
    assert.strictEqual(/pan|cartao_numero|cvv|senha|trilha|validade|pin/i.test(texto), false);
  });

  await test('builder CRT: rejeita valor não inteiro/zero/negativo', () => {
    for (const valor of [0, -100, 1.5, '100', null, undefined]) {
      assert.throws(() => buildCrtInput({ valorCentavos: valor }), (e) => e.codigo === ERROS.DESTAXA_VALOR_NAO_PERMITIDO);
    }
  });

  await test('valor em reais → centavos consistente (R$1,00 → 100)', () => {
    assert.strictEqual(valorReaisParaCentavos(1), 100);
    assert.strictEqual(valorReaisParaCentavos(1.0), 100);
    assert.strictEqual(valorReaisParaCentavos('1.00'), 100);
    assert.strictEqual(valorReaisParaCentavos('1,00'), 100);
    assert.strictEqual(valorReaisParaCentavos('1.005'), null);
    assert.strictEqual(valorReaisParaCentavos(0), null);
    assert.strictEqual(valorReaisParaCentavos('abc'), null);
    assert.strictEqual(VALOR_HOMOLOGACAO_CENTAVOS, 100);
  });

  // ------------------------------------------- driver nativo (exports falsos)
  await test('driver nativo: contrato de buffers com exports em memória (sem DLL)', () => {
    const capturado = {};
    const exportsFalsos = {
      iniciaTransacaoDestaxa(resultado, operacao, entrada, tamanhoEntrada, saida, tamanhoSaida) {
        capturado.operacao = operacao;
        capturado.entrada = entrada.toString('latin1', 0, tamanhoEntrada);
        capturado.terminador = entrada[tamanhoEntrada];
        capturado.capacidade = saida.length;
        capturado.tamanhoInicial = tamanhoSaida[0];
        resultado.write('99', 0, 'latin1');
        const texto = 'mensagem=Insira o cartão';
        const n = saida.write(texto, 0, 'latin1');
        tamanhoSaida[0] = n;
      },
      continuaTransacaoDestaxa(resultado, entrada, tamanhoEntrada, saida, tamanhoSaida) {
        capturado.continua = entrada.toString('latin1', 0, tamanhoEntrada);
        resultado.write('00', 0, 'latin1');
        tamanhoSaida[0] = saida.write('transacao_nsu=1', 0, 'latin1');
      },
      finalizaTransacaoDestaxa(resultado, confirmacao) {
        capturado.confirmacao = confirmacao;
        resultado.write('00', 0, 'latin1');
      }
    };
    const driver = criarDriverTransacaoNativo(exportsFalsos);
    assert.strictEqual(driver.nome, 'native');

    const r1 = driver.iniciaTransacaoDestaxa('CRT', 'transacao_valor=1.00');
    assert.strictEqual(capturado.operacao, 'CRT');
    assert.strictEqual(capturado.entrada, 'transacao_valor=1.00');
    assert.strictEqual(capturado.terminador, 0);
    assert.strictEqual(capturado.capacidade, BUFFER_SAIDA_BYTES_SUGERIDO);
    assert.strictEqual(capturado.tamanhoInicial, 99000);
    assert.strictEqual(r1.codigo, '99');
    assert.strictEqual(r1.saida, 'mensagem=Insira o cartão');

    const r2 = driver.continuaTransacaoDestaxa('informacao=1');
    assert.strictEqual(capturado.continua, 'informacao=1');
    assert.strictEqual(r2.codigo, '00');
    assert.strictEqual(r2.saida, 'transacao_nsu=1');

    const r3 = driver.finalizaTransacaoDestaxa(FINALIZACAO_CANCELAR);
    assert.strictEqual(capturado.confirmacao, 9);
    assert.strictEqual(r3.codigo, '00');
  });

  // ------------------------------------------------------ orquestrador + gate
  await test('gate: orquestrador com driver nativo recusa iniciar sem flag e sem transactionId', () => {
    const chamadas = { inicia: 0 };
    const driver = criarDriverTransacaoNativo({
      iniciaTransacaoDestaxa() { chamadas.inicia += 1; }
    });
    const orq = new DestaxaTransacaoOrquestrador({ driver, permitirTransacaoReal: true });
    const r = orq.iniciarTransacaoCRT(buildCrtInput({ valorCentavos: 100 }).campos);
    assert.strictEqual(r.codigo, ERROS.DESTAXA_REAL_TRANSACTION_DISABLED);
    assert.strictEqual(r.contexto, null);
    assert.strictEqual(orq.getContexto(), null);
    assert.strictEqual(chamadas.inicia, 0);
  });

  await test('gate: continua/finaliza nativos bloqueados e contexto preservado', () => {
    const { orq } = orquestradorMock([{ fn: 'inicia', codigo: '99', saida: 'mensagem=Aguarde' }]);
    const r1 = orq.iniciarTransacaoCRT({}, { transactionId: 'tx-06b' });
    const chamadas = { continua: 0, finaliza: 0 };
    orq.definirDriver(criarDriverTransacaoNativo({
      continuaTransacaoDestaxa() { chamadas.continua += 1; },
      finalizaTransacaoDestaxa() { chamadas.finaliza += 1; }
    }));
    orq.definirPermissaoTransacaoReal(true);

    const c = orq.continuarTransacao({ displayAck: true });
    const f = orq.finalizarTransacao(FINALIZACAO_CONFIRMAR);
    assert.strictEqual(c.codigo, ERROS.DESTAXA_REAL_TRANSACTION_DISABLED);
    assert.strictEqual(f.codigo, ERROS.DESTAXA_REAL_TRANSACTION_DISABLED);
    assert.strictEqual(orq.getContexto().transactionId, r1.contexto.transactionId);
    assert.strictEqual(orq.getContexto().estado, ESTADOS_TRANSACAO.DISPLAY);
    assert.deepStrictEqual(chamadas, { continua: 0, finaliza: 0 });
  });

  await test('bridge.habilitarTransacaoReal recusa sem flag (driver nativo não instalado)', () => {
    const loader = criarLoaderFake();
    const bridge = new DestaxaNativeBridge({ config: {}, nativeLoader: loader, resolver: resolverFake });
    bridge.load();
    bridge.iniciarClient({});
    const h = bridge.habilitarTransacaoReal();
    assert.strictEqual(h.sucesso, false);
    assert.strictEqual(h.codigo, ERROS.DESTAXA_REAL_TRANSACTION_DISABLED);
    const r = bridge.iniciarTransacaoDestaxa(OPERACOES.CRT, { transacao_valor: '1.00' });
    assert.strictEqual(r.codigo, ERROS.DESTAXA_TRANSACAO_REAL_BLOQUEADA);
    assert.deepStrictEqual(
      { inicia: loader.contadores.inicia, continua: loader.contadores.continua, finaliza: loader.contadores.finaliza },
      { inicia: 0, continua: 0, finaliza: 0 }
    );
  });

  // ------------------------------------------------ adapter: validações + gate
  await test('autorizarPagamento: validações OK → DESTAXA_REAL_TRANSACTION_DISABLED', async () => {
    const { adapter, loader, detector } = criarAdapterControlado();
    const r = await adapter.autorizarPagamento({ tipo: 'credito', valor: 1.0 });
    assert.strictEqual(r.sucesso, false);
    assert.strictEqual(r.codigo, ERROS.DESTAXA_REAL_TRANSACTION_DISABLED);
    assert.strictEqual(r.tipo_erro, 'gate_financeiro');
    assert.strictEqual(r.readiness, 'READY_FOR_REAL_TRANSACTION');
    assert.strictEqual(r.transacaoId, null);
    assert.strictEqual(r.transactionAttempted, false);
    assert.strictEqual(r.retryAllowed, false);
    assert.strictEqual(r.preparacao.client.clientInitializationCode, '00');
    assert.strictEqual(r.preparacao.crt.input, 'transacao_valor=1.00');
    assert.strictEqual(r.preparacao.realTransactionGate.enabled, false);
    assert.strictEqual(r.preparacao.pinpad.port, 'COM3');
    assert.strictEqual(loader.contadores.client, 1);
    assert.deepStrictEqual(detector.chamadas, { vspague: 1, pinpad: 1 });
    assert.strictEqual(adapter.bridge.getTransacaoContexto(), null);
    assert.deepStrictEqual(
      { inicia: loader.contadores.inicia, continua: loader.contadores.continua, finaliza: loader.contadores.finaliza },
      { inicia: 0, continua: 0, finaliza: 0 }
    );
  });

  await test('autorizarPagamento: preparação forjada como pronta ainda é barrada pelo bridge', async () => {
    const { adapter, loader } = criarAdapterControlado();
    const preparo = await adapter.prepararAutorizacao({ tipo: 'credito', valor: 1 });
    const r = await adapter.autorizarPagamento({ tipo: 'credito', valor: 1 }, { ...preparo, pronto: true, transactionId: '77' });
    assert.strictEqual(r.codigo, ERROS.DESTAXA_REAL_TRANSACTION_DISABLED);
    assert.strictEqual(r.transacaoId, null);
    assert.strictEqual(adapter.bridge.getTransacaoContexto(), null);
    assert.strictEqual(loader.contadores.inicia, 0);
  });

  const bloqueios = [
    ['PIX não permitido', { dados: { tipo: 'pix', valor: 1 } }, ERROS.DESTAXA_OPERACAO_NAO_PERMITIDA],
    ['EST não permitido', { dados: { operacao: 'EST', valor: 1 } }, ERROS.DESTAXA_OPERACAO_NAO_PERMITIDA],
    ['valor R$2,00 bloqueado', { dados: { tipo: 'credito', valor: 2 } }, ERROS.DESTAXA_VALOR_NAO_PERMITIDO],
    ['valor ausente bloqueado', { dados: { tipo: 'credito' } }, ERROS.DESTAXA_VALOR_NAO_PERMITIDO],
    ['valorCentavos divergente do valor', { dados: { tipo: 'credito', valor: 2, valorCentavos: 100 } }, ERROS.DESTAXA_VALOR_NAO_PERMITIDO],
    ['ambiente produção bloqueado', { config: { ambiente: 'producao' } }, ERROS.DESTAXA_AMBIENTE_NAO_PERMITIDO],
    ['ambiente simulação bloqueado', { config: { ambiente: 'simulacao' } }, ERROS.DESTAXA_AMBIENTE_NAO_PERMITIDO],
    ['provider diferente bloqueado', { config: { provedor: 'paygo' } }, ERROS.DESTAXA_PROVIDER_INVALIDO],
    ['configuração sem porta COM', { configTef: { portaCom: '' } }, ERROS.DESTAXA_INVALID_CONFIGURATION],
    ['Client ≠ 00 bloqueado', { loader: { codigoClient: '06' } }, ERROS.DESTAXA_CLIENT_INIT_FAILED],
    ['VSPague parado bloqueado', { detector: { vspague: { executando: false } } }, ERROS.DESTAXA_VSPAGUE_INDISPONIVEL],
    ['PinPad ausente bloqueado', { detector: { pinpad: { detectado: false, porta: null } } }, ERROS.DESTAXA_PINPAD_NAO_DETECTADO],
    ['PinPad em porta divergente bloqueado', { detector: { pinpad: { porta: 'COM4' } } }, ERROS.DESTAXA_PINPAD_NAO_DETECTADO]
  ];
  for (const [nome, cenario, codigo] of bloqueios) {
    await test(`pré-condição: ${nome} → ${codigo}`, async () => {
      const { adapter, loader } = criarAdapterControlado(cenario);
      const r = await adapter.autorizarPagamento(cenario.dados || { tipo: 'credito', valor: 1 });
      assert.strictEqual(r.sucesso, false);
      assert.strictEqual(r.codigo, codigo);
      assert.strictEqual(r.transacaoId, null);
      assert.strictEqual(r.transactionAttempted, false);
      assert.strictEqual(loader.contadores.inicia + loader.contadores.continua + loader.contadores.finaliza, 0);
    });
  }

  // ------------------------------------------- 99 / continuação / transactionId
  await test('transactionId único: 99 DISPLAY → COLETA → OPÇÃO → 00 → finaliza', () => {
    const { orq, mock } = orquestradorMock([
      { fn: 'inicia', codigo: '99', saida: 'mensagem=Insira o cartão' },
      { fn: 'continua', codigo: '99', saida: 'mensagem=Digite;tipo=N;mascara=.##' },
      { fn: 'continua', codigo: '99', saida: 'mensagem=Forma;opcao=Debito|Credito;tipo=X' },
      { fn: 'continua', codigo: '00', saida: 'transacao_nsu=10' },
      { fn: 'finaliza', codigo: '00', saida: '' }
    ]);
    const r1 = orq.iniciarTransacaoCRT(buildCrtInput({ valorCentavos: 100 }).campos, { transactionId: '42' });
    assert.strictEqual(r1.acao.tipo, TIPOS_ACAO.DISPLAY);
    const r2 = orq.continuarTransacao({ displayAck: true });
    assert.strictEqual(r2.acao.tipo, TIPOS_ACAO.COLETA);
    const r3 = orq.continuarTransacao({ informacao: '1.00' });
    assert.strictEqual(r3.acao.tipo, TIPOS_ACAO.OPCAO);
    assert.deepStrictEqual(r3.acao.opcoes, ['Debito', 'Credito']);
    const r4 = orq.continuarTransacao({ informacao: 'Credito' });
    assert.strictEqual(r4.sucesso, true);
    const f = orq.finalizarTransacao(FINALIZACAO_CONFIRMAR);
    assert.strictEqual(f.confirmacaoDescricao, 'confirma');
    for (const r of [r1, r2, r3, r4, f]) {
      assert.strictEqual(r.contexto.transactionId, '42');
    }
    assert.strictEqual(orq.getContexto().entradaInicial, 'transacao_valor=1.00');
    assert.strictEqual(mock.contadores.iniciaTransacaoDestaxa, 1);
  });

  await test('finalização: 9 = cancelamento; outro valor rejeitado', () => {
    const { orq } = orquestradorMock([
      { fn: 'inicia', codigo: '00', saida: '' },
      { fn: 'finaliza', codigo: '00', saida: '' }
    ]);
    orq.iniciarTransacaoCRT({});
    const invalido = orq.finalizarTransacao(1);
    assert.strictEqual(invalido.codigo, ERROS.DESTAXA_INVALID_CONFIGURATION);
    const cancela = orq.finalizarTransacao(FINALIZACAO_CANCELAR);
    assert.strictEqual(cancela.confirmacaoDescricao, 'cancela_desfaz');
  });

  // ---------------------------------------------- estados financeiros / retry
  const mapeamentos = [
    ['00', 'aprovado', FINANCIAL_STATES.CONFIRMED_SUCCESS],
    ['03', 'negado', FINANCIAL_STATES.CONFIRMED_DENIED],
    ['08', 'pendente', FINANCIAL_STATES.UNKNOWN],
    ['A0', 'pendente', FINANCIAL_STATES.UNCONFIRMED],
    ['A1', 'pendente', FINANCIAL_STATES.BLOCKED],
    ['99', 'pendente', FINANCIAL_STATES.PENDING]
  ];
  for (const [codigo, status, financialState] of mapeamentos) {
    await test(`mapeamento CRT ${codigo} → ${status}/${financialState}, sem retry`, () => {
      const { orq, mock } = orquestradorMock([
        { fn: 'inicia', codigo, saida: codigo === '99' ? 'mensagem=Aguarde' : '' }
      ]);
      const resultado = orq.iniciarTransacaoCRT({}, { transactionId: 'tx-map' });
      const { adapter } = criarAdapterControlado();
      const r = adapter._mapearResultadoCrt(resultado, { clientInitializationCode: '00' });
      assert.strictEqual(r.status, status);
      assert.strictEqual(r.financialState, financialState);
      assert.strictEqual(r.retryAllowed, false);
      assert.strictEqual(r.transacaoId, 'tx-map');
      assert.strictEqual(r.transactionCode, codigo);
      assert.strictEqual(r.clientInitializationCode, '00');
      assert.strictEqual(r.requerFinalizacao, codigo === '00');
      assert.strictEqual(r.requerContinuacao, codigo === '99');
      assert.strictEqual(mock.contadores.iniciaTransacaoDestaxa, 1);

      const nova = orq.iniciarTransacaoCRT({});
      if (['08', 'A0', 'A1', '99'].includes(codigo)) {
        assert.strictEqual(nova.codigoDestaxa, ERROS.DESTAXA_TRANSACAO_EM_ANDAMENTO);
        assert.strictEqual(nova.contexto.transactionId, 'tx-map');
        assert.strictEqual(mock.contadores.iniciaTransacaoDestaxa, 1);
      }
    });
  }

  // ------------------------------------------------ integração real (Node)
  process.env.DESTAXA_CRT_PATH_CHECK = '1';
  const {
    DestaxaCrtRealPathVerifier,
    RESULT_READY,
    caminhoRelatorio
  } = require('../../backend/services/tef/destaxa/destaxaCrtRealPathVerifier');

  await test('verificador recusa execução com gate financeiro habilitado', () => {
    const anterior = process.env[REAL_TRANSACTION_ENV];
    process.env[REAL_TRANSACTION_ENV] = '1';
    try {
      assert.throws(
        () => new DestaxaCrtRealPathVerifier({ configRepository: {} }).validarGate(),
        (e) => e.code === 'DESTAXA_REAL_TRANSACTION_FLAG_MUST_BE_DISABLED'
      );
    } finally {
      if (anterior === undefined) delete process.env[REAL_TRANSACTION_ENV];
      else process.env[REAL_TRANSACTION_ENV] = anterior;
    }
    assert.notStrictEqual(String(process.env[REAL_TRANSACTION_ENV] || '').trim(), '1');
  });

  let nodeReport = null;
  await test('Node real: TefManager → Factory → DestaxaRealAdapter → gate bloqueia antes da DLL', async () => {
    const db = require('../../backend/database');
    await new Promise((resolve, reject) => db.whenReady((e) => (e ? reject(e) : resolve())));
    const execucao = await new DestaxaCrtRealPathVerifier().executar();
    nodeReport = execucao.relatorio;
    assert.strictEqual(nodeReport.result, RESULT_READY, JSON.stringify(nodeReport, null, 2));
  });

  if (nodeReport) {
    await test('Node real: provider/ambiente/adapter', () => {
      assert.strictEqual(nodeReport.provider, 'destaxa');
      assert.strictEqual(nodeReport.environment, 'homologacao');
      assert.strictEqual(nodeReport.adapterMode, 'real');
      assert.strictEqual(nodeReport.configuration.valid, true);
    });
    await test('Node real: DLL carregada com 4 exports', () => {
      assert.strictEqual(nodeReport.dll.loaded, true);
      assert.strictEqual(nodeReport.dll.exports, 4);
      assert.match(String(nodeReport.dll.path).replace(/\\/g, '/'), /resources\/tef\/destaxa\/win-x64\/libdll-integracao-tef\.dll$/);
    });
    await test('Node real: Client inicializado com 00', () => {
      assert.strictEqual(nodeReport.client.initialized, true);
      assert.strictEqual(nodeReport.client.code, '00');
    });
    await test('Node real: VSPague ativo e respondendo', () => {
      assert.strictEqual(nodeReport.vspague.running, true);
      assert.strictEqual(nodeReport.vspague.responding, true);
    });
    await test('Node real: PPC930 detectado em COM3', () => {
      assert.strictEqual(nodeReport.pinpad.model, 'PPC930');
      assert.strictEqual(nodeReport.pinpad.port, 'COM3');
      assert.strictEqual(nodeReport.pinpad.detected, true);
    });
    await test('Node real: CRT pronto (100 centavos) e gate desabilitado', () => {
      assert.strictEqual(nodeReport.crt.operation, 'CRT');
      assert.strictEqual(nodeReport.crt.valueCents, 100);
      assert.strictEqual(nodeReport.crt.input, 'transacao_valor=1.00');
      assert.strictEqual(nodeReport.realTransactionGate.enabled, false);
      assert.strictEqual(nodeReport.realTransactionGate.blockedCode, ERROS.DESTAXA_REAL_TRANSACTION_DISABLED);
    });
    await test('Node real: zero chamadas transacionais e nenhum transactionId', () => {
      assert.strictEqual(nodeReport.transaction.attempted, false);
      assert.strictEqual(nodeReport.transaction.financialTransactionId, null);
      assert.strictEqual(nodeReport.transaction.iniciaCalls, 0);
      assert.strictEqual(nodeReport.transaction.continuaCalls, 0);
      assert.strictEqual(nodeReport.transaction.finalizaCalls, 0);
    });
  }

  // ---------------------------------------------- integração real (Electron)
  await test('Electron real: mesma verificação no runtime do CDS', () => {
    const electronPath = require('electron');
    const resultado = spawnSync(electronPath, ['.'], {
      cwd: path.resolve(__dirname, '../..'),
      env: {
        ...process.env,
        DESTAXA_CRT_PATH_CHECK: '1',
        DESTAXA_CRT_PATH_CHECK_ELECTRON: '1',
        [REAL_TRANSACTION_ENV]: '0'
      },
      encoding: 'utf8',
      windowsHide: true,
      timeout: 180000,
      maxBuffer: 10 * 1024 * 1024
    });
    const linha = String(resultado.stdout || '').split(/\r?\n/).find((l) => l.includes('[TEF-DESTAXA-06B-ELECTRON]'));
    if (linha) console.log(`         ${linha}`);
    if (resultado.status !== 0) {
      process.stdout.write(resultado.stdout || '');
      process.stderr.write(resultado.stderr || '');
    }
    assert.strictEqual(resultado.error, undefined);
    assert.strictEqual(resultado.status, 0);
  });

  await test('relatório 06B: runs Node + Electron 22.3.27/16.17.1/ABI 110, zero chamadas', () => {
    const report = JSON.parse(fs.readFileSync(caminhoRelatorio(), 'utf8'));
    assert.strictEqual(report.sprint, 'TEF-DESTAXA-06B');
    assert.ok(report.timestamp);
    assert.strictEqual(report.result, RESULT_READY);
    assert.ok(report.runs.node);
    assert.ok(report.runs.electron);
    const e = report.runs.electron.runtime;
    assert.strictEqual(e.electron, '22.3.27');
    assert.strictEqual(e.node, '16.17.1');
    assert.strictEqual(e.abi, '110');
    assert.strictEqual(e.platform, 'win32');
    assert.strictEqual(e.arch, 'x64');
    for (const run of [report.runs.node, report.runs.electron]) {
      assert.strictEqual(run.result, RESULT_READY);
      assert.strictEqual(run.realTransactionGate.enabled, false);
      assert.strictEqual(run.transaction.attempted, false);
      assert.strictEqual(run.transaction.iniciaCalls + run.transaction.continuaCalls + run.transaction.finalizaCalls, 0);
    }
  });

  console.log(`\nResultado: ${passou} ok, ${falhou} falhou\n`);
  process.exit(falhou > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
