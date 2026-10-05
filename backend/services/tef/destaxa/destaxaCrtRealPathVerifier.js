'use strict';

/**
 * TEF-DESTAXA-06B — verificação do caminho CRT real até o gate financeiro.
 *
 * Segurança:
 * - só executa com DESTAXA_CRT_PATH_CHECK=1;
 * - recusa ambiente com DESTAXA_REAL_TRANSACTION_ENABLED=1;
 * - os três exports transacionais da DLL real são substituídos por tripwires
 *   que contam a chamada e lançam erro — nunca alcançam a DLL;
 * - o ambiente é o persistido no banco (tef_configuracao); nenhuma
 *   configuração é forçada em memória nem escrita pela verificação.
 */

const fs = require('fs');
const path = require('path');
const TefManager = require('../TefManager');
const destaxaKoffiLoader = require('./destaxaKoffiLoader');
const destaxaDllResolver = require('./destaxaDllResolver');
const { coletarAmbiente } = require('./destaxaRealHarnessService');
const { obterClienteCompartilhado, ESTADOS_CLIENTE } = require('./DestaxaNativeHostClient');
const { TRIPWIRE_ENV } = require('./DestaxaNativeHost');
const { OPERACOES_HOST } = require('./destaxaNativeHostProtocolo');
const {
  ERROS,
  OPERACOES,
  REAL_TRANSACTION_ENV,
  VALOR_HOMOLOGACAO_CENTAVOS,
  FORMATO_VALOR_DESTAXA,
  transacaoRealHabilitada
} = require('./destaxaConstantes');

const CHECK_ENV = 'DESTAXA_CRT_PATH_CHECK';
const ELECTRON_CHECK_ENV = 'DESTAXA_CRT_PATH_CHECK_ELECTRON';
const RESULT_READY = 'READY_FOR_REAL_TRANSACTION';
const RESULT_NOT_READY = 'NOT_READY_FOR_REAL_TRANSACTION';

const TRIPWIRES = Object.freeze({
  iniciaTransacaoDestaxa: 'inicia',
  continuaTransacaoDestaxa: 'continua',
  finalizaTransacaoDestaxa: 'finaliza'
});

function envAtiva(nome) {
  return String(process.env[nome] || '').trim() === '1';
}

function criarErroVerificacao(codigo, mensagem) {
  const error = new Error(mensagem);
  error.code = codigo;
  return error;
}

function caminhoRelatorio() {
  return path.join(
    destaxaDllResolver.encontrarRaizProjeto(),
    'docs',
    'build',
    'tef-destaxa-06b-crt-real-path-report.json'
  );
}

function modeloPinpad(modelo) {
  return /PPC\s*930/i.test(String(modelo || '')) ? 'PPC930' : (modelo || null);
}

class DestaxaCrtRealPathVerifier {
  constructor(dependencias = {}) {
    this._manager = dependencias.manager || TefManager;
    this._loader = dependencias.loader || destaxaKoffiLoader;
    this._configRepository = dependencias.configRepository
      || require('../../../repositories/tefConfigRepository');
    this.transactionCalls = { inicia: 0, continua: 0, finaliza: 0 };
    this.mainDllLoads = 0;
  }

  /** Host novo com tripwire: as funções transacionais da DLL no host nunca alcançam a DLL. */
  async _prepararHostComTripwire() {
    const cliente = obterClienteCompartilhado();
    await cliente.encerrar();
    const anterior = process.env[TRIPWIRE_ENV];
    process.env[TRIPWIRE_ENV] = '1';
    const ok = cliente.estado === ESTADOS_CLIENTE.CRASHED
      ? (await cliente.reiniciar()).sucesso
      : await cliente.iniciar();
    if (anterior === undefined) delete process.env[TRIPWIRE_ENV];
    else process.env[TRIPWIRE_ENV] = anterior;
    if (!ok) {
      throw criarErroVerificacao('DESTAXA_NATIVE_HOST_UNAVAILABLE', `TEF Native Host indisponível: ${JSON.stringify(cliente.getEstado().ultimaSaida)}`);
    }
    return cliente;
  }

  async _coletarHost(cliente) {
    const estado = cliente.getEstado();
    const status = await cliente.enviar(OPERACOES_HOST.STATUS);
    await cliente.encerrar();
    return {
      used: true,
      pid: estado.pid,
      processType: estado.processType,
      versions: estado.versions,
      tripwire: status.output?.tripwire === true,
      counters: status.output?.contadores || null,
      error: status.error || null
    };
  }

  validarGate() {
    if (!envAtiva(CHECK_ENV)) {
      throw criarErroVerificacao('DESTAXA_CRT_PATH_CHECK_DISABLED', `Verificação 06B desabilitada: defina ${CHECK_ENV}=1`);
    }
    if (transacaoRealHabilitada()) {
      throw criarErroVerificacao(
        'DESTAXA_REAL_TRANSACTION_FLAG_MUST_BE_DISABLED',
        `${REAL_TRANSACTION_ENV} deve permanecer desabilitada na Sprint 06B`
      );
    }
  }

  _validarRuntime(runtime) {
    if (runtime.platform !== 'win32' || runtime.arch !== 'x64') {
      throw criarErroVerificacao('DESTAXA_CRT_PATH_RUNTIME_INVALID', `Esperado win32/x64; recebido ${runtime.platform}/${runtime.arch}`);
    }
    if (runtime.electron
      && (runtime.electron !== '22.3.27' || runtime.node !== '16.17.1' || runtime.abi !== '110')) {
      throw criarErroVerificacao(
        'DESTAXA_CRT_PATH_ELECTRON_RUNTIME_INVALID',
        `Runtime Electron divergente: Electron=${runtime.electron}, Node=${runtime.node}, ABI=${runtime.abi}`
      );
    }
  }

  _instalarInstrumentacao() {
    const loader = this._loader;
    const carregarOriginal = loader.carregarBiblioteca;
    const contadores = this.transactionCalls;
    const bibliotecas = [];

    const verificador = this;
    loader.carregarBiblioteca = function carregarComTripwire(dllPath) {
      const lib = carregarOriginal.call(this, dllPath);
      verificador.mainDllLoads += 1;
      for (const [nome, chave] of Object.entries(TRIPWIRES)) {
        lib.exports[nome] = function tripwire() {
          contadores[chave] += 1;
          throw criarErroVerificacao('DESTAXA_06B_TRIPWIRE', `${nome} chamado durante a verificação 06B`);
        };
      }
      bibliotecas.push(lib);
      return lib;
    };

    return () => {
      loader.carregarBiblioteca = carregarOriginal;
      for (const lib of bibliotecas) lib.unload();
    };
  }

  _gravarRelatorio(relatorio) {
    const arquivo = caminhoRelatorio();
    fs.mkdirSync(path.dirname(arquivo), { recursive: true });
    let anterior = null;
    if (fs.existsSync(arquivo)) {
      try {
        anterior = JSON.parse(fs.readFileSync(arquivo, 'utf8'));
      } catch {
        anterior = null;
      }
    }
    const chave = relatorio.runtime.electron ? 'electron' : 'node';
    const runs = { ...(anterior?.runs || {}), [chave]: { ...relatorio } };
    const final = { ...relatorio, runs };
    fs.writeFileSync(arquivo, `${JSON.stringify(final, null, 2)}\n`, 'utf8');
    return { arquivo, relatorio: final };
  }

  async executar() {
    this.validarGate();
    const runtime = coletarAmbiente();
    this._validarRuntime(runtime);

    const cliente = await this._prepararHostComTripwire();
    const restaurar = this._instalarInstrumentacao();
    let resposta;
    let nativeHost;
    try {
      resposta = await this._manager.autorizar({
        tipo: 'credito',
        valor: VALOR_HOMOLOGACAO_CENTAVOS / 100,
        parcelas: 1
      });
    } finally {
      restaurar();
      nativeHost = await this._coletarHost(cliente);
    }

    const checks = resposta?.preparacao || {};
    const contadoresHost = nativeHost.counters || {};
    const chamadas = {
      inicia: this.transactionCalls.inicia + (contadoresHost.inicia || 0),
      continua: this.transactionCalls.continua + (contadoresHost.continua || 0),
      finaliza: this.transactionCalls.finaliza + (contadoresHost.finaliza || 0)
    };
    const totalChamadas = chamadas.inicia + chamadas.continua + chamadas.finaliza;

    const pronto = resposta?.codigo === ERROS.DESTAXA_REAL_TRANSACTION_DISABLED
      && resposta?.readiness === RESULT_READY
      && resposta?.transactionAttempted === false
      && resposta?.transacaoId == null
      && totalChamadas === 0
      && nativeHost.tripwire === true
      && this.mainDllLoads === 0
      && checks.realTransactionGate?.enabled === false;

    const relatorio = {
      sprint: 'TEF-DESTAXA-06B',
      timestamp: new Date().toISOString(),
      provider: checks.provider || null,
      environment: checks.environment || null,
      adapterMode: checks.adapterMode || null,
      runtime,
      architectureChain: {
        manager: 'TefManager.autorizar',
        factory: 'TefFactory.obterAdapter',
        adapter: 'DestaxaRealAdapter.prepararAutorizacao',
        orchestrator: 'DestaxaTransacaoOrquestrador',
        bridge: 'DestaxaNativeBridge',
        loader: 'destaxaKoffiLoader'
      },
      configuration: checks.configuration || null,
      nativeHost: {
        ...nativeHost,
        mainProcessDllLoads: this.mainDllLoads,
        adapterExecution: checks.nativeExecution || null
      },
      dll: {
        loaded: checks.dll?.loaded === true,
        exports: checks.dll?.exports || 0,
        path: checks.dll?.path || null
      },
      client: {
        initialized: checks.client?.initialized === true,
        code: checks.client?.clientInitializationCode || null
      },
      vspague: {
        running: checks.vspague?.running === true,
        responding: checks.vspague?.responding === true,
        pid: checks.vspague?.pid || null
      },
      pinpad: {
        model: modeloPinpad(checks.pinpad?.model),
        port: checks.pinpad?.port || null,
        detected: checks.pinpad?.detected === true,
        usb: checks.pinpad?.usb === true
      },
      crt: {
        implemented: true,
        operation: checks.crt?.operation || OPERACOES.CRT,
        valueCents: checks.crt?.valueCents ?? null,
        input: checks.crt?.input || null,
        operationParameterSeparate: true,
        valueFormat: {
          sent: checks.crt?.input || null,
          confirmed: FORMATO_VALOR_DESTAXA.confirmed,
          format: FORMATO_VALOR_DESTAXA.format,
          source: FORMATO_VALOR_DESTAXA.source
        }
      },
      realTransactionGate: {
        env: REAL_TRANSACTION_ENV,
        enabled: checks.realTransactionGate?.enabled === true,
        blockedCode: resposta?.codigo || null
      },
      transaction: {
        attempted: resposta?.transactionAttempted === true,
        financialTransactionId: resposta?.transacaoId || null,
        clientInitializationCode: checks.client?.clientInitializationCode || null,
        transactionCode: null,
        iniciaCalls: chamadas.inicia,
        continuaCalls: chamadas.continua,
        finalizaCalls: chamadas.finaliza
      },
      retry: {
        tentativas: 1,
        retry: false,
        policy: 'tefRetryService.autorizarComRetry + tefFinancialSafetyPolicy (TEF-DESTAXA-05)'
      },
      result: pronto ? RESULT_READY : RESULT_NOT_READY
    };

    return this._gravarRelatorio(relatorio);
  }
}

module.exports = {
  DestaxaCrtRealPathVerifier,
  CHECK_ENV,
  ELECTRON_CHECK_ENV,
  RESULT_READY,
  RESULT_NOT_READY,
  caminhoRelatorio
};
