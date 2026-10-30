'use strict';

/**
 * TEF-PPC930-11 — validação do fluxo CRT sem transação financeira.
 * - Aceita CRT na preparação; rejeita PIX sem converter para CRT.
 * - Não chama inicia/continua/finalizaTransacaoDestaxa.
 * - Não repete INIT_CLIENT (bridge com Client já inicializado).
 * - Gate DESTAXA_REAL_TRANSACTION_ENABLED permanece desligado.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { describe, it, before } = require('node:test');

const DestaxaRealAdapter = require('../../backend/services/tef/adapters/DestaxaRealAdapter');
const tefConfigService = require('../../backend/services/tef/tefConfigService');
const { normalizarTipoTef } = require('../../backend/services/tef/tefFluxoPagamento');
const {
  avaliarEvidenciasDestaxa,
  ESTADOS_INDICADOR
} = require('../../backend/services/tef/destaxa/destaxaEvidenciasOperacionais');
const {
  ERROS,
  OPERACOES,
  OPERACOES_REAIS_PERMITIDAS,
  VALOR_HOMOLOGACAO_CENTAVOS,
  ESTADOS,
  EXPORTS_OBRIGATORIOS,
  REAL_TRANSACTION_ENV,
  transacaoRealHabilitada
} = require('../../backend/services/tef/destaxa/destaxaConstantes');

const TIPOS_PDV_CRT = Object.freeze([
  'credito',
  'debito',
  'cartao',
  'cartao_credito',
  'cartao_debito',
  'tef'
]);

function criarBridgeSemInitNemFinanceiro() {
  const chamadas = [];
  const exports = Object.fromEntries(EXPORTS_OBRIGATORIOS.map((n) => [n, true]));
  return {
    chamadas,
    bridge: {
      async isLoaded() {
        chamadas.push('isLoaded');
        return true;
      },
      async load() {
        chamadas.push('load');
        return { sucesso: true };
      },
      async getDiagnostics() {
        chamadas.push('getDiagnostics');
        return {
          dllLoaded: true,
          exportsValid: true,
          exports,
          dllPath: 'memoria://libdll-integracao-tef.dll',
          clientInitialized: true,
          estado: ESTADOS.CLIENT_INITIALIZED,
          clientResultCode: '00'
        };
      },
      async iniciarClient() {
        chamadas.push('iniciarClient');
        throw new Error('INIT_CLIENT não deve ser repetido nesta sprint');
      },
      async habilitarTransacaoReal() {
        chamadas.push('habilitarTransacaoReal');
        throw new Error('habilitarTransacaoReal não deve ser chamado na preparação bloqueada pelo gate');
      },
      async iniciarTransacaoDestaxa() {
        chamadas.push('iniciarTransacaoDestaxa');
        throw new Error('iniciaTransacaoDestaxa proibida');
      },
      async continuarTransacaoDestaxa() {
        chamadas.push('continuarTransacaoDestaxa');
        throw new Error('continuaTransacaoDestaxa proibida');
      },
      async finalizarTransacaoDestaxa() {
        chamadas.push('finalizarTransacaoDestaxa');
        throw new Error('finalizaTransacaoDestaxa proibida');
      }
    }
  };
}

function criarDetectorOk() {
  return {
    detectarVsPagueClient() {
      return { detectado: true, executando: true, responding: true, pid: 4242 };
    },
    detectarGertecPPC930() {
      return {
        detectado: true,
        estado: 'DETECTADO',
        porta: 'COM3',
        modelo: 'Gertec PPC930',
        usb: true
      };
    }
  };
}

function criarConfigServiceOk(extra = {}) {
  return {
    async obterConfiguracao() {
      return {
        tefProvedor: 'destaxa',
        tefHabilitado: 'true',
        tefAmbiente: 'homologacao',
        pinpadHabilitado: 'true',
        pinpadModelo: 'GERTEC_PPC930',
        portaCom: 'COM3',
        tipoConexao: 'serial',
        empresaCodigo: '',
        lojaCodigo: '',
        terminalCodigo: '',
        pdvCodigo: '',
        caixaCodigo: '',
        pix: 'true',
        ...extra
      };
    },
    validarConfiguracao(config, opcoes) {
      return tefConfigService.validarConfiguracao(config, opcoes);
    }
  };
}

describe('TEF-PPC930-11 CRT preparação sem transação financeira', () => {
  before(() => {
    process.env[REAL_TRANSACTION_ENV] = '0';
  });

  it('contrato CRT: tipos PDV cartão mapeiam para OPERACOES.CRT; somente CRT permitido', () => {
    assert.deepStrictEqual([...OPERACOES_REAIS_PERMITIDAS], ['CRT']);
    assert.strictEqual(VALOR_HOMOLOGACAO_CENTAVOS, 100);

    const { bridge } = criarBridgeSemInitNemFinanceiro();
    const adapter = new DestaxaRealAdapter(
      { provedor: 'destaxa', ambiente: 'homologacao' },
      { bridge, sdkDetector: criarDetectorOk(), configService: criarConfigServiceOk() }
    );

    for (const tipo of TIPOS_PDV_CRT) {
      assert.strictEqual(adapter._resolverOperacao({ tipo }), OPERACOES.CRT, tipo);
      assert.strictEqual(normalizarTipoTef(tipo), tipo);
    }
    assert.strictEqual(adapter._resolverOperacao({ tipo: 'pix' }), OPERACOES.PIX);
    assert.strictEqual(adapter._resolverOperacao({ tipo: 'pix_tef' }), OPERACOES.PIX);
  });

  it('PDV envia tipo cartão (não CRT literal) em /tef/pagar — evidência estática', () => {
    const pdv = fs.readFileSync(path.join(__dirname, '../../frontend/pdv/js/pdv.js'), 'utf8');
    assert.ok(pdv.includes("fetch(`${API_URL}/tef/pagar`"));
    assert.ok(pdv.includes('tipo: tipoTef'));
    const adapterSrc = fs.readFileSync(
      path.join(__dirname, '../../backend/services/tef/adapters/DestaxaRealAdapter.js'),
      'utf8'
    );
    assert.ok(adapterSrc.includes("TIPOS_CRT = new Set(["));
    assert.ok(adapterSrc.includes("'credito'"));
    assert.ok(adapterSrc.includes('OPERACOES.CRT'));
  });

  it('prepararAutorizacao CRT R$1,00 chega ao gate sem INIT e sem funções financeiras', async () => {
    const { bridge, chamadas } = criarBridgeSemInitNemFinanceiro();
    const adapter = new DestaxaRealAdapter(
      { provedor: 'destaxa', ambiente: 'homologacao' },
      { bridge, sdkDetector: criarDetectorOk(), configService: criarConfigServiceOk() }
    );

    const prep = await adapter.prepararAutorizacao({ tipo: 'credito', valor: 1 });
    assert.strictEqual(prep.pronto, false);
    assert.strictEqual(prep.readiness, 'READY_FOR_REAL_TRANSACTION');
    assert.strictEqual(prep.resposta.codigo, ERROS.DESTAXA_REAL_TRANSACTION_DISABLED);
    assert.strictEqual(prep.resposta.transactionAttempted, false);
    assert.strictEqual(prep.resposta.tipo_erro, 'gate_financeiro');
    assert.strictEqual(prep.contexto.operacao, OPERACOES.CRT);
    assert.strictEqual(prep.contexto.valorCentavos, 100);
    assert.strictEqual(prep.contexto.checks.operation, OPERACOES.CRT);
    assert.strictEqual(prep.contexto.checks.crt.input, 'transacao_valor=1.00');
    assert.strictEqual(prep.contexto.checks.realTransactionGate.enabled, false);
    assert.ok(!chamadas.includes('iniciarClient'));
    assert.ok(!chamadas.includes('iniciarTransacaoDestaxa'));
    assert.ok(!chamadas.includes('continuarTransacaoDestaxa'));
    assert.ok(!chamadas.includes('finalizarTransacaoDestaxa'));
    assert.ok(!chamadas.includes('habilitarTransacaoReal'));
  });

  it('autorizarPagamento CRT com gate off não chama DLL financeira', async () => {
    const { bridge, chamadas } = criarBridgeSemInitNemFinanceiro();
    const adapter = new DestaxaRealAdapter(
      { provedor: 'destaxa', ambiente: 'homologacao' },
      { bridge, sdkDetector: criarDetectorOk(), configService: criarConfigServiceOk() }
    );
    const r = await adapter.autorizarPagamento({ tipo: 'debito', valor: 1 });
    assert.strictEqual(r.codigo, ERROS.DESTAXA_REAL_TRANSACTION_DISABLED);
    assert.strictEqual(r.transactionAttempted, false);
    assert.strictEqual(r.transacaoId, null);
    assert.ok(!chamadas.some((c) => /TransacaoDestaxa|habilitarTransacaoReal|iniciarClient/.test(c)));
  });

  it('PIX continua rejeitado; pix:true da config não libera PIX; sem conversão para CRT', async () => {
    const { bridge, chamadas } = criarBridgeSemInitNemFinanceiro();
    const adapter = new DestaxaRealAdapter(
      { provedor: 'destaxa', ambiente: 'homologacao' },
      { bridge, sdkDetector: criarDetectorOk(), configService: criarConfigServiceOk({ pix: 'true' }) }
    );
    const r = await adapter.autorizarPagamento({ tipo: 'pix', valor: 1, pix: 'true' });
    assert.strictEqual(r.codigo, ERROS.DESTAXA_OPERACAO_NAO_PERMITIDA);
    assert.match(r.mensagem, /PIX não permitida; somente CRT/);
    assert.strictEqual(r.transactionAttempted, false);
    assert.deepStrictEqual(chamadas, []);
  });

  it('empresa/loja/terminal vazios NÃO invalidam validarConfiguracao Destaxa; diagnóstico marca mapeamento pendente', () => {
    const config = {
      tefHabilitado: 'true',
      tefProvedor: 'destaxa',
      tefAmbiente: 'homologacao',
      pinpadHabilitado: 'true',
      pinpadModelo: 'GERTEC_PPC930',
      tipoConexao: 'serial',
      portaCom: 'COM3',
      empresaCodigo: '',
      lojaCodigo: '',
      terminalCodigo: '',
      pdvCodigo: '',
      caixaCodigo: ''
    };
    const val = tefConfigService.validarConfiguracao(config, { modoAdapter: 'real' });
    assert.strictEqual(val.valida, true, val.pendencias.join('; '));
    assert.ok(!val.pendencias.some((p) => /empresa|loja|terminal/i.test(p)));

    const evid = avaliarEvidenciasDestaxa({
      config,
      estadosIntegracao: {
        dll: { loaded: true, exportsValidated: true },
        vspague: { detected: true, running: true },
        pinpad: { configuredPort: 'COM3', detectedPort: 'COM3', comConsistent: true },
        client: { initialized: true, initClientExecuted: 'EXECUTADO', code: '00', codeStatus: 'INFORMADO' },
        transactionCommunication: { validated: false },
        authorization: { available: false }
      }
    });
    assert.strictEqual(evid.tefProntoParaVenda, false);
    assert.strictEqual(
      evid.indicadores.mapeamentoEstabelecimentoLojaTerminal.estado,
      ESTADOS_INDICADOR.BLOQUEADO
    );
    assert.ok(evid.bloqueios.some((b) => b.codigo === 'MAPEAMENTO_OFICIAL_PENDENTE'));
  });

  it('tipos cartão CRT não são reescritos para PIX; débito/crédito permanecem CRT', () => {
    const { bridge } = criarBridgeSemInitNemFinanceiro();
    const adapter = new DestaxaRealAdapter(
      { provedor: 'destaxa', ambiente: 'homologacao' },
      { bridge, sdkDetector: criarDetectorOk(), configService: criarConfigServiceOk() }
    );
    assert.strictEqual(adapter._resolverOperacao({ tipo: 'credito' }), 'CRT');
    assert.strictEqual(adapter._resolverOperacao({ tipo: 'debito' }), 'CRT');
    assert.strictEqual(adapter._resolverOperacao({ tipo: 'cartao' }), 'CRT');
    assert.notStrictEqual(adapter._resolverOperacao({ tipo: 'credito' }), 'PIX');
  });

  it('gate financeiro permanece desligado', () => {
    assert.strictEqual(String(process.env[REAL_TRANSACTION_ENV] || '').trim(), '0');
    assert.strictEqual(transacaoRealHabilitada(), false);
  });
});
