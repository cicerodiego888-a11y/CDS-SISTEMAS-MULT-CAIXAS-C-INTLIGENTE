'use strict';

/**
 * TEF-DESTAXA-51.54 — CNPJ credenciadora Destaxa (transacao_rede_cnpj) + validação fiscal.
 * Sem DLL / CRT / SEFAZ.
 */

const assert = require('assert');
const {
  extrairEvidenciasRetorno00,
  extrairCnpjCredenciadoraDeParametros,
  normalizarCnpjCredenciadoraDestaxa,
  parseParametrosDestaxa
} = require('../../backend/services/tef/destaxa/destaxaProtocolo');
const DestaxaRealAdapter = require('../../backend/services/tef/adapters/DestaxaRealAdapter');
const { montarPagamentos } = require('../../backend/services/fiscal/xmlBuilder');
const { validarPagamentosETroco } = require('../../backend/services/fiscal/validarXmlFiscal');
const {
  resolverCnpjCredenciadoraDoPayload
} = require('../../backend/services/fiscal/tefPagamentoHydrator');

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

const SAIDA_DEBITO = [
  'transacao_valor=1',
  'transacao_tipo_cartao=Debito',
  'transacao_rede_cnpj=01.425.787/0001-04',
  'transacao_rede=Userede',
  'transacao_nsu=2348',
  'transacao_autorizacao=211139',
  'transacao_administradora=Visa',
  'transacao_comprovante_1via=/\\/\\/ Destaxa 18.760.540/0001-39\\/\\/\\/',
  'transacao_comprovante_2via=/\\/\\/ Destaxa 18.760.540/0001-39\\/\\/\\/'
].join(';');

const SAIDA_CREDITO = [
  'transacao_valor=1',
  'transacao_tipo_cartao=Credito',
  'transacao_rede_cnpj=01.425.787/0001-04',
  'transacao_rede=Userede',
  'transacao_nsu=9999',
  'transacao_autorizacao=ABC123',
  'transacao_administradora=Mastercard',
  'transacao_comprovante_1via=via1',
  'transacao_comprovante_2via=via2'
].join(';');

function xmlComCard({ tPag, tpIntegra, cnpj, cAut, tBand }) {
  let card = `<card><tpIntegra>${tpIntegra}</tpIntegra>`;
  if (cnpj) card += `<CNPJ>${cnpj}</CNPJ>`;
  if (tBand) card += `<tBand>${tBand}</tBand>`;
  if (cAut) card += `<cAut>${cAut}</cAut>`;
  card += '</card>';
  return `<pag><detPag><tPag>${tPag}</tPag><vPag>1.00</vPag>${card}</detPag></pag>`;
}

async function main() {
  console.log('\nTEF-DESTAXA-51.54 — CNPJ credenciadora / cartão fiscal\n');

  await test('1) normaliza transacao_rede_cnpj para 14 dígitos', () => {
    assert.strictEqual(
      normalizarCnpjCredenciadoraDestaxa('01.425.787/0001-04'),
      '01425787000104'
    );
    assert.strictEqual(normalizarCnpjCredenciadoraDestaxa('01425787000104'), '01425787000104');
    assert.strictEqual(normalizarCnpjCredenciadoraDestaxa('123'), null);
    assert.strictEqual(normalizarCnpjCredenciadoraDestaxa(null), null);
  });

  await test('2) não usa CNPJ Destaxa do comprovante como credenciadora', () => {
    const params = parseParametrosDestaxa(SAIDA_DEBITO);
    assert.ok(String(params.transacao_comprovante_1via || '').includes('18.760.540/0001-39'));
    assert.strictEqual(extrairCnpjCredenciadoraDeParametros(params), '01425787000104');
    assert.strictEqual(
      extrairCnpjCredenciadoraDeParametros({}),
      null
    );
    assert.strictEqual(
      extrairCnpjCredenciadoraDeParametros({
        // sem transacao_rede_cnpj — mesmo com texto Destaxa em outro campo
        comprovante: 'Destaxa 18.760.540/0001-39'
      }),
      null
    );
  });

  await test('3) evidências 00 expõem cnpj_credenciadora + rede + bandeira', () => {
    const ev = extrairEvidenciasRetorno00(SAIDA_DEBITO);
    assert.strictEqual(ev.cnpj_credenciadora, '01425787000104');
    assert.strictEqual(ev.adquirente, 'Userede');
    assert.strictEqual(ev.bandeira, 'Visa');
    assert.strictEqual(ev.nsu, '2348');
    assert.strictEqual(ev.autorizacao, '211139');
  });

  await test('4) _mapearResultadoCrt débito persiste CNPJ Userede (não Destaxa)', () => {
    const adapter = new DestaxaRealAdapter(
      { provedor: 'destaxa', ambiente: 'homologacao' },
      { bridge: {}, executionMode: 'in-process' }
    );
    const mapped = adapter._mapearResultadoCrt({
      sucesso: true,
      classificacao: 'SUCCESS',
      codigoDestaxa: '00',
      saida: SAIDA_DEBITO,
      financialState: 'CONFIRMED_SUCCESS'
    }, { clientInitializationCode: '00' });

    assert.strictEqual(mapped.cnpj_credenciadora, '01425787000104');
    assert.strictEqual(mapped.adquirente, 'Userede');
    assert.strictEqual(mapped.bandeira, 'Visa');
    assert.strictEqual(mapped.nsu, '2348');
    assert.strictEqual(mapped.autorizacao, '211139');
    assert.notStrictEqual(mapped.cnpj_credenciadora, '18760540000139');
    assert.strictEqual(mapped.payloadRetorno.cnpj_credenciadora, '01425787000104');
  });

  await test('5) _mapearResultadoCrt crédito mapeia administradora Mastercard', () => {
    const adapter = new DestaxaRealAdapter(
      { provedor: 'destaxa', ambiente: 'homologacao' },
      { bridge: {}, executionMode: 'in-process' }
    );
    const mapped = adapter._mapearResultadoCrt({
      sucesso: true,
      classificacao: 'SUCCESS',
      codigoDestaxa: '00',
      saida: SAIDA_CREDITO
    }, {});
    assert.strictEqual(mapped.cnpj_credenciadora, '01425787000104');
    assert.strictEqual(mapped.bandeira, 'Mastercard');
    assert.strictEqual(mapped.autorizacao, 'ABC123');
  });

  await test('6) sem transacao_rede_cnpj → cnpj_credenciadora null', () => {
    const adapter = new DestaxaRealAdapter(
      { provedor: 'destaxa', ambiente: 'homologacao' },
      { bridge: {}, executionMode: 'in-process' }
    );
    const saida = 'transacao_nsu=1;transacao_autorizacao=X;transacao_comprovante_1via=Destaxa 18.760.540/0001-39';
    const mapped = adapter._mapearResultadoCrt({
      sucesso: true,
      classificacao: 'SUCCESS',
      codigoDestaxa: '00',
      saida
    }, {});
    assert.strictEqual(mapped.cnpj_credenciadora, null);
  });

  await test('7) hydrator resolve CNPJ a partir de parametros legados', () => {
    const cnpj = resolverCnpjCredenciadoraDoPayload({
      parametros: { transacao_rede_cnpj: '01.425.787/0001-04' }
    });
    assert.strictEqual(cnpj, '01425787000104');
    assert.strictEqual(resolverCnpjCredenciadoraDoPayload({
      comprovanteCliente: 'Destaxa 18.760.540/0001-39'
    }), null);
  });

  await test('8) XML débito integrado com CNPJ Userede', () => {
    const xml = montarPagamentos([{
      forma_pagamento: 'cartao_debito',
      valor: 1,
      tef: {
        transacao_id: '4',
        status: 'aprovado',
        cnpj_credenciadora: '01425787000104',
        bandeira: 'Visa',
        autorizacao: '211139'
      }
    }]);
    assert.match(xml, /<tPag>04<\/tPag>/);
    assert.match(xml, /<tpIntegra>1<\/tpIntegra>/);
    assert.match(xml, /<CNPJ>01425787000104<\/CNPJ>/);
    assert.match(xml, /<tBand>01<\/tBand>/);
    assert.match(xml, /<cAut>211139<\/cAut>/);
    assert.ok(!xml.includes('18760540000139'));
  });

  await test('9) XML crédito integrado com CNPJ Userede', () => {
    const xml = montarPagamentos([{
      forma_pagamento: 'cartao_credito',
      valor: 1,
      tef: {
        transacao_id: '99',
        status: 'aprovado',
        cnpj_credenciadora: '01425787000104',
        bandeira: 'Mastercard',
        autorizacao: 'ABC123'
      }
    }]);
    assert.match(xml, /<tPag>03<\/tPag>/);
    assert.match(xml, /<CNPJ>01425787000104<\/CNPJ>/);
    assert.match(xml, /<tBand>02<\/tBand>/);
    assert.match(xml, /<cAut>ABC123<\/cAut>/);
  });

  await test('10) validação local bloqueia cartão tpIntegra=1 sem CNPJ', () => {
    const xml = xmlComCard({
      tPag: '04',
      tpIntegra: '1',
      cAut: '211139',
      tBand: '99'
    });
    // envelopar totais mínimos para soma vPag
    const completo = `<NFe>${xml}<ICMSTot><vNF>1.00</vNF></ICMSTot></NFe>`;
    let erro = null;
    try {
      validarPagamentosETroco(completo, { vNF: 1, vTroco: 0 });
    } catch (e) {
      erro = e;
    }
    assert.ok(erro);
    assert.strictEqual(erro.code, 'XML_PAGAMENTO_CNPJ_CREDENCIADORA_AUSENTE');
  });

  await test('11) validação local aceita cartão integrado completo', () => {
    const xml = xmlComCard({
      tPag: '04',
      tpIntegra: '1',
      cnpj: '01425787000104',
      cAut: '211139',
      tBand: '01'
    });
    const completo = `<NFe>${xml}<ICMSTot><vNF>1.00</vNF></ICMSTot></NFe>`;
    assert.strictEqual(validarPagamentosETroco(completo, { vNF: 1, vTroco: 0 }), true);
  });

  await test('12) PIX TEF sem CNPJ não é bloqueado pela regra de cartão', () => {
    const xml = xmlComCard({
      tPag: '17',
      tpIntegra: '1',
      cAut: 'PIX001'
    });
    const completo = `<NFe>${xml}<ICMSTot><vNF>1.00</vNF></ICMSTot></NFe>`;
    assert.strictEqual(validarPagamentosETroco(completo, { vNF: 1, vTroco: 0 }), true);
  });

  console.log(`\nResultado: ${passou} ok, ${falhou} falha(s)\n`);
  process.exit(falhou ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
