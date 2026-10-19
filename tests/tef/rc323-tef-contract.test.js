'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const tefContrato = require('../../backend/services/tef/tefContrato');
const DestaxaAdapter = require('../../backend/services/tef/adapters/destaxaAdapter');
const DestaxaRealAdapter = require('../../backend/services/tef/adapters/DestaxaRealAdapter');

describe('RC3.23 — contrato TEF sem aquisição presumida', () => {
  it('mantém provedor e CNPJ explícito sem atribuir adquirente', () => {
    const retorno = tefContrato.criarRespostaAutorizacao({
      sucesso: true,
      status: 'aprovado',
      provedor: 'Destaxa',
      cnpj_credenciadora: '12345678000190',
      payloadRetorno: { nsu_destaxa: '55' }
    });

    assert.equal(retorno.provedor, 'Destaxa');
    assert.equal(retorno.adquirente, null);
    assert.equal(retorno.cnpj_credenciadora, '12345678000190');
    assert.deepEqual(tefContrato.paraRespostaApi(retorno).cnpj_credenciadora, '12345678000190');
    assert.deepEqual(tefContrato.paraRespostaApi(retorno).provedor, 'Destaxa');
    assert.deepEqual(tefContrato.paraPersistencia(retorno).payload_retorno, {
      nsu_destaxa: '55',
      cnpj_credenciadora: '12345678000190'
    });
  });

  it('não cria CNPJ ou adquirente se o adapter não os fornecer', () => {
    const retorno = tefContrato.criarRespostaAutorizacao({
      sucesso: true,
      status: 'aprovado',
      provedor: 'Destaxa'
    });

    assert.equal(retorno.cnpj_credenciadora, null);
    assert.equal(retorno.adquirente, null);
    assert.equal(tefContrato.paraPersistencia(retorno).payload_retorno.cnpj_credenciadora, null);
  });

  it('Destaxa real e simulado são identificados como provedor, não adquirente', () => {
    const simulado = new DestaxaAdapter({});
    const real = new DestaxaRealAdapter({}, { bridge: {} });
    const respostaReal = real._mapearResultadoCrt({
      sucesso: true,
      classificacao: 'SUCCESS',
      codigoDestaxa: '00',
      saida: 'transacao_nsu=55',
      contexto: { transactionId: 'internal-1' }
    }, { clientInitializationCode: '00' });

    assert.equal(simulado.adquirente, null);
    assert.equal(respostaReal.provedor, 'DESTAXA');
    assert.equal(respostaReal.adquirente, null);
  });
});
