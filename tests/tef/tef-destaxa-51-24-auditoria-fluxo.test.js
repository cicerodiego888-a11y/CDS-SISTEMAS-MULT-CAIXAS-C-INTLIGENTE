'use strict';

/**
 * TEF-DESTAXA-51.24 — testes isolados de auditoria (sem DLL / sem TX real).
 * Não inicializa NativeHost, V$Pague, COM4 ou PinPad.
 * Não toca tef_transacoes.id=1 nem banco oficial.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..', '..');
const TEF_MGR = path.join(ROOT, 'backend', 'services', 'tef', 'TefManager.js');
const HASH_5120 = '57E5C5172511E2991DEC1A5F6B003C24D8DF6868B5E82A8EA90369D64D73C132';

const {
  CODIGOS_RESULTADO,
  FINALIZACAO_CONFIRMAR,
  FINALIZACAO_CANCELAR,
  inspecionarGateFinanceiro,
  transacaoRealHabilitada
} = require('../../backend/services/tef/destaxa/destaxaConstantes');
const {
  classificarCodigoTransacao,
  parseParametrosDestaxa,
  parseAcaoSolicitada,
  buildContinuaInput
} = require('../../backend/services/tef/destaxa/destaxaProtocolo');
const {
  classificarCodigoFinanceiro,
  FINANCIAL_STATES
} = require('../../backend/services/tef/tefFinancialSafetyPolicy');
const {
  resolverRespostaContinuidade,
  FINALIZACAO_CONFIRMAR: CICLO_CONFIRMAR,
  FINALIZACAO_CANCELAR: CICLO_CANCELAR
} = require('../../backend/services/tef/destaxa/destaxaCrtCicloOrquestracao');
const { TIPOS_ACAO } = require('../../backend/services/tef/destaxa/destaxaConstantes');

let passed = 0;
function test(nome, fn) {
  try {
    fn();
    passed += 1;
    console.log(`  OK  ${nome}`);
  } catch (error) {
    console.error(`  FAIL ${nome}`);
    console.error(error);
    process.exitCode = 1;
  }
}

console.log('\nTEF-DESTAXA-51.24 — auditoria fluxo Destaxa (isolado)\n');

test('0) gate DESTAXA_REAL_TRANSACTION_ENABLED permanece OFF', () => {
  const gate = inspecionarGateFinanceiro();
  assert.strictEqual(gate.habilitado, false);
  assert.strictEqual(transacaoRealHabilitada(), false);
});

test('1) hash TefManager preserva correção 51.20/51.41', () => {
  const buf = fs.readFileSync(TEF_MGR);
  const hash = crypto.createHash('sha256').update(buf).digest('hex').toUpperCase();
  assert.strictEqual(hash, HASH_5120);
  const src = buf.toString('utf8');
  assert.ok(src.includes('intentCicloAutomaticoContinue'));
  assert.ok(src.includes('intentCicloAutomaticoFinalize'));
  assert.ok(src.includes('TEF-DESTAXA-51.41'));
});

test('2) códigos oficiais 00/99/A1/A0/08 espelhados em CODIGOS_RESULTADO', () => {
  assert.ok(CODIGOS_RESULTADO['00']);
  assert.ok(CODIGOS_RESULTADO['99']);
  assert.ok(CODIGOS_RESULTADO.A1);
  assert.ok(CODIGOS_RESULTADO.A0);
  assert.ok(CODIGOS_RESULTADO['08']);
  assert.match(CODIGOS_RESULTADO.A1.descricao, /não confirmada/i);
});

test('3) finalização: 0 confirma / 9 cancela (docs/08 + exemplos)', () => {
  assert.strictEqual(FINALIZACAO_CONFIRMAR, 0);
  assert.strictEqual(FINALIZACAO_CANCELAR, 9);
  assert.strictEqual(CICLO_CONFIRMAR, 0);
  assert.strictEqual(CICLO_CANCELAR, 9);
});

test('4) A1 classificado como BLOCKED sem retry', () => {
  const proto = classificarCodigoTransacao('A1');
  assert.strictEqual(proto.classificacao, 'BLOCKED');
  assert.strictEqual(proto.estadoTransacao, 'BLOCKED');
  const fin = classificarCodigoFinanceiro('A1');
  assert.strictEqual(fin.financialState, FINANCIAL_STATES.BLOCKED);
  assert.strictEqual(fin.retryAllowed, false);
  assert.strictEqual(fin.retryReason, 'TEF_A1_BLOCKED_NO_RETRY');
});

test('5) 99 é ACTION_REQUIRED / PENDING — não é aprovação', () => {
  const proto = classificarCodigoTransacao('99');
  assert.strictEqual(proto.classificacao, 'ACTION_REQUIRED');
  const fin = classificarCodigoFinanceiro('99');
  assert.strictEqual(fin.financialState, FINANCIAL_STATES.PENDING);
  assert.strictEqual(fin.retryAllowed, false);
});

test('6) 00 é SUCCESS / CONFIRMED_SUCCESS', () => {
  const proto = classificarCodigoTransacao('00');
  assert.strictEqual(proto.classificacao, 'SUCCESS');
  const fin = classificarCodigoFinanceiro('00');
  assert.strictEqual(fin.financialState, FINANCIAL_STATES.CONFIRMED_SUCCESS);
});

test('7) DISPLAY 99 → display_ack (entrada vazia) para continuaTransacao', () => {
  const acao = parseAcaoSolicitada('mensagem=Insira/passe/aproxime o cartao');
  assert.strictEqual(acao.tipo, TIPOS_ACAO.DISPLAY);
  const resolucao = resolverRespostaContinuidade(acao, []);
  assert.strictEqual(resolucao.ok, true);
  assert.strictEqual(resolucao.origem, 'display_ack');
  const entrada = buildContinuaInput(resolucao.resposta);
  assert.strictEqual(entrada.texto, '');
});

test('8) saída 00 oficial: NSU/autorização/comprovantes parseáveis', () => {
  const saida = [
    'transacao_nsu=123456',
    'transacao_autorizacao=AB12CD',
    'transacao_comprovante_1via=VIA CLIENTE',
    'transacao_comprovante_2via=VIA LOJA',
    'transacao_tipo_cartao=Debito',
    'transacao_valor=1.00'
  ].join(';');
  const p = parseParametrosDestaxa(saida);
  assert.strictEqual(p.transacao_nsu, '123456');
  assert.strictEqual(p.transacao_autorizacao, 'AB12CD');
  assert.strictEqual(p.transacao_comprovante_1via, 'VIA CLIENTE');
  assert.strictEqual(p.transacao_comprovante_2via, 'VIA LOJA');
});

test('9) DestaxaRealAdapter promove NSU/autorizacao/comprovantes (corrigido 51.25)', () => {
  const adapterSrc = fs.readFileSync(
    path.join(ROOT, 'backend', 'services', 'tef', 'adapters', 'DestaxaRealAdapter.js'),
    'utf8'
  );
  assert.ok(adapterSrc.includes('extrairEvidenciasRetorno00'));
  assert.ok(adapterSrc.includes('autorizacao: evidencias.autorizacao || parametros.transacao_autorizacao'));
  assert.ok(adapterSrc.includes('comprovanteCliente: evidencias.comprovanteCliente'));
  assert.ok(adapterSrc.includes('resultadoInicio'));
  assert.ok(adapterSrc.includes('persistirEvidenciasAntesFinalize'));
});

test('10) ciclo CRT chama FINALIZACAO_CONFIRMAR=0 após evidências 00 (51.25)', () => {
  const cicloSrc = fs.readFileSync(
    path.join(ROOT, 'backend', 'services', 'tef', 'destaxa', 'destaxaCrtCicloOrquestracao.js'),
    'utf8'
  );
  assert.ok(cicloSrc.includes("emitir('TX_FINALIZE', { confirmacao: FINALIZACAO_CONFIRMAR })"));
  assert.ok(cicloSrc.includes('bridge.finalizarTransacaoDestaxa(FINALIZACAO_CONFIRMAR'));
  assert.ok(cicloSrc.includes('_confirmarPersistenciaEvidencias00'));
  assert.ok(cicloSrc.includes("emitir('PERSISTIR_EVIDENCIAS'"));
  // Negado não chama finalize no mesmo bloco
  const idxNegado = cicloSrc.indexOf('if (ehNegado(atual))');
  const idxFinalize = cicloSrc.indexOf("emitir('TX_FINALIZE'");
  assert.ok(idxNegado > 0 && idxFinalize > idxNegado);
  const blocoNegado = cicloSrc.slice(idxNegado, idxFinalize);
  assert.ok(!blocoNegado.includes('finalizarTransacaoDestaxa'));
});

test('11) sequência contratual documentada no orquestrador: START→CONTINUE*→FINALIZE', () => {
  const cicloSrc = fs.readFileSync(
    path.join(ROOT, 'backend', 'services', 'tef', 'destaxa', 'destaxaCrtCicloOrquestracao.js'),
    'utf8'
  );
  assert.ok(cicloSrc.includes('TX_START → (99 → TX_CONTINUE)* → TX_FINALIZE'));
  assert.ok(/99 NÃO é aprovação/i.test(cicloSrc));
});

test('12) TefManager bloqueia nova autorização com pendência (criarTransacaoExclusiva + trava)', () => {
  const src = fs.readFileSync(TEF_MGR, 'utf8');
  assert.ok(src.includes('criarTransacaoExclusiva'));
  assert.ok(src.includes('_bloquearNovaAutorizacaoSePendente') || src.includes('Existe transação TEF pendente'));
  assert.ok(src.includes('RECONCILIACAO_PENDENTE'));
});

test('13) A1 bloqueia sem finalizaTransacao automático (ciclo + Client init)', () => {
  const cicloSrc = fs.readFileSync(
    path.join(ROOT, 'backend', 'services', 'tef', 'destaxa', 'destaxaCrtCicloOrquestracao.js'),
    'utf8'
  );
  assert.ok(cicloSrc.includes('fecharBloqueioA1'));
  assert.ok(cicloSrc.includes("origemApi: 'iniciaTransacaoDestaxa'"));
  assert.ok(!cicloSrc.includes('finalizarTransacaoDestaxa(FINALIZACAO_CANCELAR'));
  const bridgeSrc = fs.readFileSync(
    path.join(ROOT, 'backend', 'services', 'tef', 'destaxa', 'DestaxaNativeBridge.js'),
    'utf8'
  );
  assert.ok(bridgeSrc.includes("origemApi: 'iniciaClientDestaxa'") || bridgeSrc.includes("classificarRetornoA1('iniciaClientDestaxa'"));
  assert.ok(bridgeSrc.includes('finalizacaoAutomaticaA1: false'));
  assert.ok(!/A1[\s\S]{0,200}finalizaTransacaoDestaxa/.test(bridgeSrc));
});

console.log(`\nResultado: ${passed} testes OK\n`);
