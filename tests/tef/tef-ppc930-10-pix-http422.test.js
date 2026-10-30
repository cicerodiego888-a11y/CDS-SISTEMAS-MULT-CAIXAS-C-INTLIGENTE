'use strict';

/**
 * TEF-PPC930-10 — PIX rejeitado com HTTP 422; sem conversão silenciosa para CRT;
 * sem chamada financeira na validação de modalidade.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { describe, it, before } = require('node:test');

const {
  normalizarTipoTef,
  formaPagamentoUsaTEF
} = require('../../backend/services/tef/tefFluxoPagamento');
const DestaxaRealAdapter = require('../../backend/services/tef/adapters/DestaxaRealAdapter');
const tefContrato = require('../../backend/services/tef/tefContrato');
const {
  ERROS,
  OPERACOES,
  OPERACOES_REAIS_PERMITIDAS,
  REAL_TRANSACTION_ENV,
  transacaoRealHabilitada
} = require('../../backend/services/tef/destaxa/destaxaConstantes');

function criarBridgeArmadilha() {
  const chamadas = [];
  const proxy = new Proxy({}, {
    get(_t, prop) {
      if (prop === 'then') return undefined;
      return (...args) => {
        chamadas.push({ metodo: String(prop), args });
        throw new Error(`bridge.${String(prop)} não deve ser chamado na rejeição de modalidade`);
      };
    }
  });
  return { proxy, chamadas };
}

function mapearHttpComoRotaPagar(resultado) {
  if (resultado.codigo === 'TRANSACAO_DUPLICADA' && !resultado.aprovado && resultado.sucesso !== true) {
    return 409;
  }
  if (resultado.sucesso === false && resultado.codigo && !tefContrato.estaAprovado(resultado)) {
    return 422;
  }
  return 200;
}

describe('TEF-PPC930-10 PIX HTTP 422 Destaxa', () => {
  let adapter;
  let armadilha;

  before(() => {
    process.env[REAL_TRANSACTION_ENV] = '0';
    armadilha = criarBridgeArmadilha();
    const detectorArmadilha = new Proxy({}, {
      get: () => () => {
        throw new Error('sdkDetector não deve ser chamado na rejeição de modalidade');
      }
    });
    adapter = new DestaxaRealAdapter(
      { provedor: 'destaxa', ambiente: 'homologacao' },
      {
        bridge: armadilha.proxy,
        sdkDetector: detectorArmadilha,
        configService: {
          obterConfiguracao: async () => {
            throw new Error('obterConfiguracao não deve rodar após rejeição de operação');
          },
          validarConfiguracao: () => {
            throw new Error('validarConfiguracao não deve rodar após rejeição de operação');
          }
        }
      }
    );
  });

  it('normaliza forma PDV "pix" para tipo TEF "pix_tef" (não CRT)', () => {
    assert.strictEqual(normalizarTipoTef('pix'), 'pix_tef');
    assert.strictEqual(normalizarTipoTef('PIX'), 'pix_tef');
    assert.notStrictEqual(normalizarTipoTef('pix'), 'credito');
    assert.notStrictEqual(normalizarTipoTef('pix'), 'debito');
    assert.ok(formaPagamentoUsaTEF('pix'));
  });

  it('config genérica pix=true não autoriza operação PIX no adapter Destaxa', async () => {
    assert.deepStrictEqual([...OPERACOES_REAIS_PERMITIDAS], ['CRT']);
    assert.ok(!OPERACOES_REAIS_PERMITIDAS.includes(OPERACOES.PIX));

    const prep = await adapter.prepararAutorizacao({
      tipo: 'pix_tef',
      valor: 1,
      // simula confusão com flag de operações da UI
      pix: 'true',
      operacoes: { pix: true }
    });
    assert.strictEqual(prep.pronto, false);
    assert.strictEqual(prep.resposta.codigo, ERROS.DESTAXA_OPERACAO_NAO_PERMITIDA);
    assert.match(prep.resposta.mensagem, /PIX não permitida; somente CRT/);
    assert.strictEqual(prep.resposta.transactionAttempted, false);
    assert.strictEqual(prep.resposta.retryAllowed, false);
    assert.deepStrictEqual(armadilha.chamadas, []);
  });

  it('autorizarPagamento PIX não chama iniciaTransacaoDestaxa nem converte para CRT', async () => {
    const retorno = await adapter.autorizarPagamento({ tipo: 'pix', valor: 1, parcelas: 1 });
    assert.strictEqual(retorno.sucesso, false);
    assert.strictEqual(retorno.codigo, ERROS.DESTAXA_OPERACAO_NAO_PERMITIDA);
    assert.match(retorno.mensagem, /Operação PIX não permitida; somente CRT/);
    assert.strictEqual(retorno.transactionAttempted, false);
    assert.strictEqual(retorno.transacaoId, null);
    assert.ok(!armadilha.chamadas.some((c) => /iniciaTransacao|continuaTransacao|finalizaTransacao|habilitarTransacao/i.test(c.metodo)));
    assert.deepStrictEqual(armadilha.chamadas, []);
  });

  it('resposta de rejeição mapeia para HTTP 422 e não marca aprovado', () => {
    const bloqueio = {
      sucesso: false,
      aprovado: false,
      status: tefContrato.STATUS.ERRO,
      codigo: ERROS.DESTAXA_OPERACAO_NAO_PERMITIDA,
      mensagem: 'Operação PIX não permitida; somente CRT',
      nsu: null
    };
    const api = tefContrato.paraRespostaApi(bloqueio, null);
    assert.strictEqual(api.aprovado, false);
    assert.strictEqual(api.sucesso, false);
    assert.strictEqual(mapearHttpComoRotaPagar(api), 422);
  });

  it('cartão/CRT não é reescrito para PIX; PIX permanece PIX', () => {
    assert.strictEqual(adapter._resolverOperacao({ tipo: 'credito' }), OPERACOES.CRT);
    assert.strictEqual(adapter._resolverOperacao({ tipo: 'debito' }), OPERACOES.CRT);
    assert.strictEqual(adapter._resolverOperacao({ tipo: 'pix_tef' }), OPERACOES.PIX);
    assert.strictEqual(adapter._resolverOperacao({ tipo: 'pix' }), OPERACOES.PIX);
  });

  it('gate financeiro permanece desligado neste teste', () => {
    assert.strictEqual(String(process.env[REAL_TRANSACTION_ENV] || '').trim(), '0');
    assert.strictEqual(transacaoRealHabilitada(), false);
  });

  it('PDV envia tipo normalizado e trata HTTP não-ok como não aprovado (evidência estática)', () => {
    const pdv = fs.readFileSync(path.join(__dirname, '../../frontend/pdv/js/pdv.js'), 'utf8');
    assert.ok(pdv.includes("fetch(`${API_URL}/tef/pagar`"));
    assert.ok(pdv.includes('tipo: tipoTef'));
    assert.ok(pdv.includes('TefFluxoPagamento.normalizarTipoTef(tipo)'));
    assert.ok(pdv.includes('Recebimento A não aprovado.'));
    assert.ok(pdv.includes('if (!response.ok)'));

    const rota = fs.readFileSync(path.join(__dirname, '../../backend/rotas/tef.js'), 'utf8');
    assert.ok(rota.includes('res.status(422).json(resultado)'));
    assert.ok(rota.includes("router.post('/pagar'"));
  });
});
