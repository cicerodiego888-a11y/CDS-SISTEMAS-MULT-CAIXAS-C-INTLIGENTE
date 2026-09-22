/**
 * TEF-DESTAXA-03 / 03A — Protocolo CRT alinhado à documentação Destaxa 1.83.
 * Formato 99: docs/07 + Anexo I (docs/10). Sem chamada DLL de transação.
 * Executar: node tests/tef/tef-destaxa-03-crt-protocolo.test.js
 */
'use strict';

const assert = require('assert');
const DestaxaRealAdapter = require('../../backend/services/tef/adapters/DestaxaRealAdapter');
const DestaxaNativeBridge = require('../../backend/services/tef/destaxa/DestaxaNativeBridge');
const DestaxaTransacaoOrquestrador = require('../../backend/services/tef/destaxa/destaxaTransacaoOrquestrador');
const DestaxaTransacaoMockDriver = require('../../backend/services/tef/destaxa/destaxaTransacaoMockDriver');
const {
  buildTransactionInput,
  buildContinuaInput,
  parseAcaoSolicitada,
  classificarCodigoTransacao
} = require('../../backend/services/tef/destaxa/destaxaProtocolo');
const {
  OPERACOES,
  ESTADOS_TRANSACAO,
  CLASSIFICACAO_CODIGO,
  TIPOS_ACAO,
  ERROS,
  FINALIZACAO_CONFIRMAR,
  BUFFER_SAIDA_BYTES_SUGERIDO,
  BUFFER_RESULTADO_BYTES,
  ENCODING_DESTAXA
} = require('../../backend/services/tef/destaxa/destaxaConstantes');

let passou = 0;
let falhou = 0;

function test(nome, fn) {
  return Promise.resolve()
    .then(() => fn())
    .then(() => {
      passou += 1;
      console.log(`  OK  ${nome}`);
    })
    .catch((error) => {
      falhou += 1;
      console.error(`  FALHOU  ${nome}`);
      console.error(`         ${error.stack || error.message}`);
    });
}

function criarAdapterComCenario(passos) {
  const bridge = new DestaxaNativeBridge({ config: {} });
  const mock = bridge.configurarDriverTransacaoMock(passos);
  const adapter = new DestaxaRealAdapter({}, { bridge });
  return { adapter, bridge, mock };
}

async function main() {
  console.log('\nTEF-DESTAXA-03A — CRT / 99 / mock (formato docs 1.83)\n');

  await test('buildTransactionInput — chave=valor;chave=valor (doc 04/06)', () => {
    const entrada = buildTransactionInput({
      operacao: OPERACOES.CRT,
      transacao_valor: '99.99',
      transacao_tipo_cartao: 'Credito'
    });
    assert.strictEqual(entrada.texto.includes('operacao='), false);
    assert.strictEqual(entrada.texto, 'transacao_valor=99.99;transacao_tipo_cartao=Credito');
  });

  await test('constantes buffer/encoding documentados', () => {
    assert.strictEqual(BUFFER_RESULTADO_BYTES, 2);
    assert.strictEqual(BUFFER_SAIDA_BYTES_SUGERIDO, 99000);
    assert.strictEqual(ENCODING_DESTAXA, 'latin1');
  });

  await test('classificarCodigoTransacao — 00 SUCCESS', () => {
    assert.strictEqual(classificarCodigoTransacao('00').classificacao, CLASSIFICACAO_CODIGO.SUCCESS);
  });

  await test('classificarCodigoTransacao — 99 ACTION_REQUIRED', () => {
    assert.strictEqual(classificarCodigoTransacao('99').classificacao, CLASSIFICACAO_CODIGO.ACTION_REQUIRED);
  });

  await test('classificarCodigoTransacao — 08 TIMEOUT', () => {
    const c = classificarCodigoTransacao('08');
    assert.strictEqual(c.classificacao, CLASSIFICACAO_CODIGO.TIMEOUT);
    assert.strictEqual(c.estadoTransacao, ESTADOS_TRANSACAO.TIMEOUT);
  });

  await test('classificarCodigoTransacao — A0 UNCONFIRMED', () => {
    assert.strictEqual(classificarCodigoTransacao('A0').classificacao, CLASSIFICACAO_CODIGO.UNCONFIRMED);
  });

  await test('classificarCodigoTransacao — A1 BLOCKED', () => {
    assert.strictEqual(classificarCodigoTransacao('A1').classificacao, CLASSIFICACAO_CODIGO.BLOCKED);
  });

  await test('classificarCodigoTransacao — código desconhecido', () => {
    assert.strictEqual(classificarCodigoTransacao('ZZ').classificacao, CLASSIFICACAO_CODIGO.UNKNOWN);
  });

  await test('parser 99 — DISPLAY (somente mensagem, doc 07)', () => {
    const acao = parseAcaoSolicitada('mensagem=Insira/passe/aproxime o cartão');
    assert.strictEqual(acao.tipo, TIPOS_ACAO.DISPLAY);
    assert.strictEqual(acao.mensagem, 'Insira/passe/aproxime o cartão');
  });

  await test('parser 99 — COLETA (tipo+mensagem+mascara, doc 07/10)', () => {
    const acao = parseAcaoSolicitada('mensagem=Valor;tipo=N;mascara=.##');
    assert.strictEqual(acao.tipo, TIPOS_ACAO.COLETA);
    assert.strictEqual(acao.tipoDado, 'N');
    assert.strictEqual(acao.mascara, '.##');
  });

  await test('parser 99 — OPÇÃO (opcao|lista, doc 07)', () => {
    const acao = parseAcaoSolicitada('mensagem=Forma de Pagamento;opcao=Debito|Credito;tipo=X');
    assert.strictEqual(acao.tipo, TIPOS_ACAO.OPCAO);
    assert.deepStrictEqual(acao.opcoes, ['Debito', 'Credito']);
    assert.strictEqual(acao.tipoDado, 'X');
  });

  await test('parser 99 — NÃO usa acao=DISPLAY inventado', () => {
    const acao = parseAcaoSolicitada('acao=DISPLAY;mensagem=Aguarde');
    // Sem tipo/opcao → DISPLAY pela mensagem (acao= é ignorado / não documentado)
    assert.strictEqual(acao.tipo, TIPOS_ACAO.DISPLAY);
    assert.strictEqual(acao.mensagem, 'Aguarde');
  });

  await test('buildContinuaInput — coleta usa informacao=', () => {
    const e = buildContinuaInput({ informacao: '135.00' });
    assert.strictEqual(e.texto, 'informacao=135.00');
  });

  await test('buildContinuaInput — display usa entrada vazia', () => {
    const e = buildContinuaInput({ displayAck: true });
    assert.strictEqual(e.texto, '');
  });

  await test('CENÁRIO 1 — inicia CRT → 00', async () => {
    const { adapter } = criarAdapterComCenario([
      { fn: 'inicia', codigo: '00', saida: 'transacao_nsu=1' }
    ]);
    const r = await adapter.iniciarTransacao({
      operacao: OPERACOES.CRT,
      transacao_valor: '1.00'
    });
    assert.strictEqual(r.sucesso, true);
    assert.strictEqual(r.codigoDestaxa, '00');
  });

  await test('CENÁRIO 2 — 99 DISPLAY → continua (entrada vazia) → 00', async () => {
    const { adapter, mock } = criarAdapterComCenario([
      { fn: 'inicia', codigo: '99', saida: 'mensagem=Insira ou Passe o Cartão' },
      { fn: 'continua', codigo: '00', saida: 'transacao_nsu=2' }
    ]);
    const r1 = await adapter.iniciarTransacao({ operacao: OPERACOES.CRT });
    assert.strictEqual(r1.sucesso, false);
    assert.strictEqual(r1.requerContinuacao, true);
    assert.strictEqual(r1.acao.tipo, TIPOS_ACAO.DISPLAY);
    assert.strictEqual(r1.estado, ESTADOS_TRANSACAO.DISPLAY);

    const ctxId = r1.contexto.transactionId;
    const r2 = await adapter.continuarTransacao({ displayAck: true });
    assert.strictEqual(r2.sucesso, true);
    assert.strictEqual(r2.contexto.transactionId, ctxId);
    assert.strictEqual(mock.contadores.continuaTransacaoDestaxa, 1);
  });

  await test('CENÁRIO 3 — COLETA → OPÇÃO → 00', async () => {
    const { adapter } = criarAdapterComCenario([
      { fn: 'inicia', codigo: '99', saida: 'mensagem=Digite o valor;tipo=N;mascara=.##' },
      { fn: 'continua', codigo: '99', saida: 'mensagem=Forma de Pagamento;opcao=Debito|Credito;tipo=X' },
      { fn: 'continua', codigo: '00', saida: 'transacao_nsu=3' }
    ]);
    const r1 = await adapter.iniciarTransacao({ operacao: OPERACOES.CRT });
    assert.strictEqual(r1.acao.tipo, TIPOS_ACAO.COLETA);
    const r2 = await adapter.continuarTransacao({ informacao: '135.00' });
    assert.strictEqual(r2.acao.tipo, TIPOS_ACAO.OPCAO);
    const r3 = await adapter.continuarTransacao({ informacao: 'Debito' });
    assert.strictEqual(r3.sucesso, true);
  });

  await test('CENÁRIO 4 — timeout 08', async () => {
    const { adapter } = criarAdapterComCenario([
      { fn: 'inicia', codigo: '08', saida: '' }
    ]);
    const r = await adapter.iniciarTransacao({ operacao: OPERACOES.CRT });
    assert.strictEqual(r.classificacao, CLASSIFICACAO_CODIGO.TIMEOUT);
  });

  await test('CENÁRIO 5 — A0', async () => {
    const { adapter } = criarAdapterComCenario([
      { fn: 'inicia', codigo: 'A0', saida: '' }
    ]);
    const r = await adapter.iniciarTransacao({ operacao: OPERACOES.CRT });
    assert.strictEqual(r.classificacao, CLASSIFICACAO_CODIGO.UNCONFIRMED);
  });

  await test('CENÁRIO 6 — A1', async () => {
    const { adapter } = criarAdapterComCenario([
      { fn: 'inicia', codigo: 'A1', saida: '' }
    ]);
    const r = await adapter.iniciarTransacao({ operacao: OPERACOES.CRT });
    assert.strictEqual(r.classificacao, CLASSIFICACAO_CODIGO.BLOCKED);
  });

  await test('finalizaTransacao — confirmacao 0 (doc 08)', async () => {
    const { adapter } = criarAdapterComCenario([
      { fn: 'inicia', codigo: '00', saida: 'transacao_nsu=9' },
      { fn: 'finaliza', codigo: '00', saida: '' }
    ]);
    await adapter.iniciarTransacao({ operacao: OPERACOES.CRT });
    const f = await adapter.finalizarTransacao({ confirmacao: FINALIZACAO_CONFIRMAR });
    assert.strictEqual(f.sucesso, true);
    assert.strictEqual(f.confirmacaoDescricao, 'confirma');
  });

  await test('continuar sem contexto', async () => {
    const bridge = new DestaxaNativeBridge({ config: {} });
    const adapter = new DestaxaRealAdapter({}, { bridge });
    const r = await adapter.continuarTransacao({});
    assert.strictEqual(r.codigoDestaxa, ERROS.DESTAXA_TRANSACAO_NAO_ENCONTRADA);
  });

  await test('iniciar sem mock — CRT real bloqueada', async () => {
    const bridge = new DestaxaNativeBridge({ config: {} });
    const adapter = new DestaxaRealAdapter({}, { bridge });
    const r = await adapter.iniciarTransacao({ operacao: OPERACOES.CRT });
    assert.strictEqual(r.codigoDestaxa, ERROS.DESTAXA_TRANSACAO_REAL_BLOQUEADA);
  });

  await test('segurança — dupla transação bloqueada', async () => {
    const { adapter } = criarAdapterComCenario([
      { fn: 'inicia', codigo: '99', saida: 'mensagem=Espere' }
    ]);
    const a = await adapter.iniciarTransacao({ operacao: OPERACOES.CRT });
    assert.strictEqual(a.estado, ESTADOS_TRANSACAO.DISPLAY);
    const b = await adapter.iniciarTransacao({ operacao: OPERACOES.CRT, transacao_valor: '2.00' });
    assert.strictEqual(b.codigoDestaxa, ERROS.DESTAXA_TRANSACAO_EM_ANDAMENTO);
    assert.strictEqual(adapter.bridge.getTransacaoContexto().transactionId, a.contexto.transactionId);
  });

  await test('retry proibido — CRT timeout: inicia uma vez, sem continua', async () => {
    const mock = new DestaxaTransacaoMockDriver([
      { fn: 'inicia', codigo: '08', saida: '' }
    ]);
    const orq = new DestaxaTransacaoOrquestrador({ driver: mock });
    const r = orq.iniciarTransacaoCRT({});
    assert.strictEqual(r.classificacao, CLASSIFICACAO_CODIGO.TIMEOUT);
    assert.strictEqual(mock.contadores.iniciaTransacaoDestaxa, 1);
    assert.strictEqual(mock.contadores.continuaTransacaoDestaxa, 0);
  });

  console.log(`\nResultado: ${passou} ok, ${falhou} falhou\n`);
  if (falhou > 0) process.exit(1);
}

main();
