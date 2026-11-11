'use strict';

/**
 * TEF-DESTAXA-51.51 — liberação controlada (vínculo + anti-duplicidade + gate OFF).
 * Sem DLL / NativeHost / cobrança real.
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  REAL_TRANSACTION_ENV,
  ERROS,
  VALOR_HOMOLOGACAO_CENTAVOS
} = require('../../backend/services/tef/destaxa/destaxaConstantes');
const auth = require('../../backend/services/tef/destaxa/destaxaAutorizacaoExcepcional');

let passou = 0;
let falhou = 0;
const ledgerDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cds-tef-5151-'));
const ledgerPath = path.join(ledgerDir, 'ledger.json');

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

function resetLedger() {
  auth.configurarCaminhoLedgerParaTeste(ledgerPath);
  try { fs.unlinkSync(ledgerPath); } catch (_) { /* */ }
  try { fs.unlinkSync(`${ledgerPath}.lock`); } catch (_) { /* */ }
}

const VINCOLO = {
  provedor: 'destaxa',
  portaCom: 'COM4',
  pinpadCodigo: 'GERTEC_PPC930',
  canal: 'pdv_oficial'
};

async function main() {
  console.log('\nTEF-DESTAXA-51.51 — liberação controlada\n');
  process.env[REAL_TRANSACTION_ENV] = '0';
  resetLedger();

  await test('1) emite com vínculo Destaxa/COM4/Gertec/PDV', () => {
    const emitida = auth.emitirAutorizacaoExcepcional({
      motivo: 'teste-51-51',
      vinculo: VINCOLO
    });
    assert.strictEqual(emitida.ok, true);
    assert.strictEqual(emitida.autorizacao.vinculo.portaCom, 'COM4');
    assert.strictEqual(emitida.autorizacao.vinculo.pinpadCodigo, 'GERTEC_PPC930');
    assert.strictEqual(emitida.autorizacao.retryAllowed, false);
  });

  await test('2) anti-duplicidade: segundo ISSUED é recusado', () => {
    try {
      auth.emitirAutorizacaoExcepcional({ motivo: 'dup', vinculo: VINCOLO });
      assert.fail('deveria ter lançado DUPLICADA');
    } catch (error) {
      assert.strictEqual(error.codigo, ERROS.DESTAXA_AUTORIZACAO_EXCEPCIONAL_DUPLICADA);
    }
  });

  await test('3) vínculo divergente (COM3) não encontra/consome', () => {
    const achou = auth.encontrarAutorizacaoIssuidaCompativel({
      valorCentavos: VALOR_HOMOLOGACAO_CENTAVOS,
      tipoPdv: 'cartao_debito',
      operacao: 'CRT',
      vinculo: { ...VINCOLO, portaCom: 'COM3' }
    });
    assert.strictEqual(achou.ok, false);

    const ok = auth.encontrarAutorizacaoIssuidaCompativel({
      valorCentavos: VALOR_HOMOLOGACAO_CENTAVOS,
      tipoPdv: 'cartao_debito',
      operacao: 'CRT',
      vinculo: VINCOLO
    });
    assert.strictEqual(ok.ok, true);

    const consumoRuim = auth.consumirAutorizacaoExcepcionalAtomico({
      authorizationId: ok.autorizacao.authorizationId,
      valorCentavos: 100,
      tipoPdv: 'cartao_debito',
      operacao: 'CRT',
      vinculo: { ...VINCOLO, canal: 'api_direta' }
    });
    assert.strictEqual(consumoRuim.ok, false);
    assert.strictEqual(consumoRuim.codigo, ERROS.DESTAXA_AUTORIZACAO_EXCEPCIONAL_INVALIDA);
  });

  await test('4) consumo único com vínculo correto; retry bloqueado', () => {
    resetLedger();
    const emitida = auth.emitirAutorizacaoExcepcional({ vinculo: VINCOLO });
    const id = emitida.autorizacao.authorizationId;
    const c1 = auth.consumirAutorizacaoExcepcionalAtomico({
      authorizationId: id,
      valorCentavos: 100,
      tipoPdv: 'cartao_debito',
      operacao: 'CRT',
      vinculo: VINCOLO
    });
    assert.strictEqual(c1.ok, true);
    assert.strictEqual(c1.permit.retryAllowed, false);
    assert.strictEqual(c1.permit.oneShot, true);

    const c2 = auth.consumirAutorizacaoExcepcionalAtomico({
      authorizationId: id,
      valorCentavos: 100,
      tipoPdv: 'cartao_debito',
      operacao: 'CRT',
      vinculo: VINCOLO
    });
    assert.strictEqual(c2.ok, false);
    assert.strictEqual(c2.codigo, ERROS.DESTAXA_AUTORIZACAO_EXCEPCIONAL_CONSUMIDA);
  });

  await test('5) emissão recusada com gate global ON', () => {
    resetLedger();
    const anterior = process.env[REAL_TRANSACTION_ENV];
    process.env[REAL_TRANSACTION_ENV] = '1';
    try {
      auth.emitirAutorizacaoExcepcional({ vinculo: VINCOLO });
      assert.fail('deveria recusar gate global');
    } catch (error) {
      assert.strictEqual(error.codigo, ERROS.DESTAXA_AUTORIZACAO_EXCEPCIONAL_GATE_GLOBAL);
    } finally {
      process.env[REAL_TRANSACTION_ENV] = anterior;
    }
  });

  await test('6) crédito/PIX continuam bloqueados', () => {
    resetLedger();
    const emitida = auth.emitirAutorizacaoExcepcional({ vinculo: VINCOLO });
    const credito = auth.consumirAutorizacaoExcepcionalAtomico({
      authorizationId: emitida.autorizacao.authorizationId,
      valorCentavos: 100,
      tipoPdv: 'cartao_credito',
      operacao: 'CRT',
      vinculo: VINCOLO
    });
    assert.strictEqual(credito.ok, false);

    resetLedger();
    const emitida2 = auth.emitirAutorizacaoExcepcional({ vinculo: VINCOLO });
    const pix = auth.consumirAutorizacaoExcepcionalAtomico({
      authorizationId: emitida2.autorizacao.authorizationId,
      valorCentavos: 100,
      tipoPdv: 'pix',
      operacao: 'PIX',
      vinculo: VINCOLO
    });
    assert.strictEqual(pix.ok, false);
  });

  auth.limparCaminhoLedgerDeTeste();
  console.log(`\nResultado: ${passou} ok, ${falhou} falha(s)\n`);
  process.exit(falhou ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
