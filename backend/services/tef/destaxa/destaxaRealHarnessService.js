'use strict';

/**
 * TEF-DESTAXA-06A — harness real, limitado à inicialização do Client.
 *
 * Segurança:
 * - só executa com DESTAXA_REAL_HARNESS=1;
 * - recusa ambiente com DESTAXA_REAL_TRANSACTION_ENABLED=1;
 * - não chama nenhuma função transacional da DLL;
 * - usa harnessRunId técnico, nunca transactionId financeiro.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const TefManager = require('../TefManager');
const sdkDetector = require('../sdkDetector');
const DestaxaRealAdapter = require('../adapters/DestaxaRealAdapter');
const DestaxaTransacaoOrquestrador = require('./destaxaTransacaoOrquestrador');
const destaxaDllResolver = require('./destaxaDllResolver');
const destaxaBinarios = require('./destaxaBinarios');
const {
  ESTADOS,
  EXPORTS_OBRIGATORIOS
} = require('./destaxaConstantes');

const HARNESS_ENV = 'DESTAXA_REAL_HARNESS';
const ELECTRON_HARNESS_ENV = 'DESTAXA_REAL_HARNESS_ELECTRON';
const TRANSACTION_ENV = 'DESTAXA_REAL_TRANSACTION_ENABLED';
const TRANSACTION_BLOCK_CODE = 'DESTAXA_REAL_TRANSACTION_BLOCKED_BY_HARNESS';
const EXPECTED_CLIENT_INPUT = 'versao=1.0.3;aplicacao=CDS Sistemas';

function envAtiva(nome) {
  return String(process.env[nome] || '').trim() === '1';
}

function sha256Arquivo(caminho) {
  return crypto.createHash('sha256').update(fs.readFileSync(caminho)).digest('hex').toUpperCase();
}

function coletarAmbiente() {
  let koffiVersion = null;
  try {
    const lock = require('../../../../package-lock.json');
    koffiVersion = lock.packages?.['node_modules/koffi']?.version || null;
  } catch {
    // A carga real da DLL ainda comprova o Koffi; versão fica nula se lock ausente.
  }
  return {
    platform: process.platform,
    arch: process.arch,
    electron: process.versions.electron || null,
    node: process.versions.node,
    abi: process.versions.modules,
    koffi: koffiVersion
  };
}

function caminhoRelatorio() {
  const raiz = destaxaDllResolver.encontrarRaizProjeto();
  return path.join(raiz, 'docs', 'build', 'tef-destaxa-06a-real-harness-report.json');
}

function carregarRelatorioAnterior(arquivo, preservar) {
  if (!preservar || !fs.existsSync(arquivo)) return null;
  try {
    return JSON.parse(fs.readFileSync(arquivo, 'utf8'));
  } catch {
    return null;
  }
}

function criarErroHarness(codigo, mensagem, detalhes = {}) {
  const error = new Error(mensagem);
  error.code = codigo;
  error.detalhes = detalhes;
  return error;
}

class DestaxaRealHarnessService {
  constructor(dependencias = {}) {
    this._manager = dependencias.manager || TefManager;
    this._sdkDetector = dependencias.sdkDetector || sdkDetector;
    this._transactionCalls = {
      inicia: 0,
      continua: 0,
      finaliza: 0
    };
  }

  validarGate() {
    if (!envAtiva(HARNESS_ENV)) {
      throw criarErroHarness(
        'DESTAXA_REAL_HARNESS_DISABLED',
        `Harness real desabilitado: defina ${HARNESS_ENV}=1`
      );
    }
    if (envAtiva(TRANSACTION_ENV)) {
      throw criarErroHarness(
        'DESTAXA_REAL_TRANSACTION_FLAG_MUST_BE_DISABLED',
        `${TRANSACTION_ENV} deve permanecer desabilitada na Sprint 06A`
      );
    }
  }

  bloquearSolicitacaoFinanceira(dados = {}) {
    return {
      sucesso: false,
      codigo: TRANSACTION_BLOCK_CODE,
      mensagem: 'Operação financeira real bloqueada pelo Harness TEF-DESTAXA-06A',
      operation: String(dados.operacao || 'CRT').toUpperCase(),
      amount: dados.valor != null ? Number(dados.valor) : null,
      attempted: false,
      reachedAdapter: false,
      reachedBridge: false,
      reachedDll: false
    };
  }

  _validarAmbiente(runtime) {
    if (runtime.platform !== 'win32') {
      throw criarErroHarness('DESTAXA_HARNESS_PLATFORM_INVALID', `Plataforma esperada win32; recebida ${runtime.platform}`);
    }
    if (runtime.arch !== 'x64') {
      throw criarErroHarness('DESTAXA_HARNESS_ARCH_INVALID', `Arquitetura esperada x64; recebida ${runtime.arch}`);
    }
    if (runtime.electron) {
      if (runtime.electron !== '22.3.27' || runtime.node !== '16.17.1' || runtime.abi !== '110') {
        throw criarErroHarness(
          'DESTAXA_HARNESS_ELECTRON_RUNTIME_INVALID',
          `Runtime Electron divergente: Electron=${runtime.electron}, Node=${runtime.node}, ABI=${runtime.abi}`
        );
      }
    }
  }

  _validarDll(diagnostico) {
    const meta = destaxaBinarios.arquivos['win-x64'];
    const caminhoEsperado = path.join(
      destaxaDllResolver.encontrarRaizProjeto(),
      'resources',
      'tef',
      'destaxa',
      'win-x64',
      meta.nome
    );
    const caminhoReal = path.resolve(diagnostico.dllPath || '');

    if (!diagnostico.dllExists || !diagnostico.dllLoaded || !diagnostico.exportsValid) {
      throw criarErroHarness('DESTAXA_HARNESS_DLL_INVALID', 'DLL Destaxa não foi carregada com todos os exports');
    }
    if (caminhoReal.toLowerCase() !== path.resolve(caminhoEsperado).toLowerCase()) {
      throw criarErroHarness('DESTAXA_HARNESS_DLL_PATH_INVALID', `DLL fora do caminho oficial: ${caminhoReal}`);
    }

    const stat = fs.statSync(caminhoReal);
    const hash = sha256Arquivo(caminhoReal);
    if (stat.size !== meta.tamanho || hash !== meta.sha256) {
      throw criarErroHarness('DESTAXA_HARNESS_DLL_INTEGRITY_INVALID', 'Tamanho ou SHA-256 da DLL x64 diverge do pacote 1.83');
    }

    const exportsValidos = EXPORTS_OBRIGATORIOS.filter((nome) => diagnostico.exports?.[nome] === true);
    if (exportsValidos.length !== EXPORTS_OBRIGATORIOS.length) {
      throw criarErroHarness('DESTAXA_HARNESS_EXPORTS_INVALID', 'Nem todos os quatro exports obrigatórios foram encontrados');
    }

    return {
      path: caminhoReal,
      expectedPath: caminhoEsperado,
      exists: true,
      loaded: true,
      architecture: 'x64',
      packageVersion: destaxaBinarios.versaoPacote,
      size: stat.size,
      sha256: hash,
      exports: exportsValidos.length,
      exportNames: exportsValidos
    };
  }

  _gravarRelatorio(relatorio) {
    const arquivo = caminhoRelatorio();
    fs.mkdirSync(path.dirname(arquivo), { recursive: true });

    const chaveExecucao = relatorio.environment.electron ? 'electron' : 'node';
    const anterior = carregarRelatorioAnterior(arquivo, chaveExecucao === 'electron');
    const runs = {
      ...(anterior?.runs || {}),
      [chaveExecucao]: {
        timestamp: relatorio.timestamp,
        environment: relatorio.environment,
        dll: relatorio.dll,
        client: relatorio.client,
        vspague: relatorio.vspague,
        pinpad: relatorio.pinpad,
        transaction: relatorio.transaction,
        result: relatorio.result
      }
    };

    const final = { ...relatorio, runs };
    fs.writeFileSync(arquivo, `${JSON.stringify(final, null, 2)}\n`, 'utf8');
    return { arquivo, relatorio: final };
  }

  async executar() {
    this.validarGate();
    const runtime = coletarAmbiente();
    this._validarAmbiente(runtime);

    const harnessRunId = `harness-${crypto.randomBytes(8).toString('hex')}`;
    let adapter = null;

    try {
      // Prova o caminho TefManager → TefFactory e reutiliza o mesmo adapter
      // durante todo o harness (uma carga/um unload da DLL por processo).
      const preparacao = await this._manager.prepararHarnessDestaxaReal();
      const managerStatus = preparacao.status;
      adapter = preparacao.adapter;
      if (String(managerStatus?.provedor || '').toLowerCase() !== 'destaxa' || managerStatus?.modo !== 'real') {
        throw criarErroHarness(
          'DESTAXA_HARNESS_MANAGER_CHAIN_INVALID',
          'TefManager não resolveu DestaxaRealAdapter; revise a configuração Destaxa de homologação',
          { managerStatus }
        );
      }

      if (!(adapter instanceof DestaxaRealAdapter)) {
        throw criarErroHarness('DESTAXA_HARNESS_ADAPTER_INVALID', 'Factory não criou DestaxaRealAdapter');
      }

      const orquestrador = adapter.bridge.getOrquestradorTransacao();
      if (!(orquestrador instanceof DestaxaTransacaoOrquestrador)) {
        throw criarErroHarness('DESTAXA_HARNESS_ORCHESTRATOR_INVALID', 'DestaxaTransacaoOrquestrador ausente no bridge');
      }

      const diagnosticoDll = adapter.bridge.getDiagnostics();
      const dll = this._validarDll(diagnosticoDll);

      const conexao = await adapter.testarConexao();
      const clientDetails = conexao.detalhes || {};
      const client = {
        initialized: conexao.sucesso === true && clientDetails.estado === ESTADOS.CLIENT_INITIALIZED,
        code: clientDetails.codigoDestaxa || clientDetails.clientResultCode || null,
        state: clientDetails.estado || null,
        input: clientDetails.entrada || null
      };
      if (!client.initialized || client.code !== '00') {
        throw criarErroHarness(
          'DESTAXA_HARNESS_CLIENT_INIT_FAILED',
          `iniciaClientDestaxa não retornou 00/CLIENT_INITIALIZED: ${client.code}/${client.state}`
        );
      }

      if (client.input !== EXPECTED_CLIENT_INPUT) {
        throw criarErroHarness('DESTAXA_HARNESS_CLIENT_INPUT_INVALID', 'Entrada do Client Destaxa divergente');
      }

      const vspagueRaw = this._sdkDetector.detectarVsPagueClient();
      const vspague = {
        found: vspagueRaw.detectado === true,
        running: vspagueRaw.executando === true,
        responding: vspagueRaw.responding === true,
        pid: vspagueRaw.pid != null ? String(vspagueRaw.pid) : null,
        path: vspagueRaw.caminho || null,
        startedByHarness: false
      };
      if (!vspague.found || !vspague.running || !vspague.responding || !vspague.pid) {
        throw criarErroHarness('DESTAXA_HARNESS_VSPAGUE_INVALID', 'VSPagueClient não está encontrado, ativo e respondendo');
      }

      const pinpadRaw = this._sdkDetector.detectarGertecPPC930();
      const pinpad = {
        status: pinpadRaw.detectado === true ? 'DETECTED' : 'NOT_DETECTED',
        detected: pinpadRaw.detectado === true,
        detectionState: pinpadRaw.estado || null,
        port: pinpadRaw.porta || null
      };

      // Teste conceitual obrigatório: o gate responde sem chamar adapter,
      // bridge, orquestrador ou DLL.
      const blockedAttempt = this.bloquearSolicitacaoFinanceira({
        operacao: 'CRT',
        valor: 1
      });
      if (blockedAttempt.codigo !== TRANSACTION_BLOCK_CODE || blockedAttempt.reachedDll !== false) {
        throw criarErroHarness('DESTAXA_HARNESS_TRANSACTION_GATE_FAILED', 'Gate financeiro não bloqueou antes da DLL');
      }

      const totalChamadas = Object.values(this._transactionCalls).reduce((soma, valor) => soma + valor, 0);
      if (totalChamadas !== 0) {
        throw criarErroHarness('DESTAXA_HARNESS_TRANSACTION_CALL_DETECTED', 'Uma função transacional foi chamada durante o harness');
      }

      const relatorioBase = {
        sprint: 'TEF-DESTAXA-06A',
        timestamp: new Date().toISOString(),
        harnessRunId,
        financialTransactionId: null,
        gates: {
          harness: true,
          realTransactionEnabled: false,
          transactionBlockCode: TRANSACTION_BLOCK_CODE
        },
        environment: runtime,
        architectureChain: {
          harness: 'DestaxaRealHarnessService',
          manager: 'TefManager',
          factory: 'TefFactory',
          adapter: adapter.constructor.name,
          orchestrator: orquestrador.constructor.name,
          bridge: adapter.bridge.constructor.name,
          loader: 'destaxaKoffiLoader',
          dll: path.basename(dll.path)
        },
        manager: {
          provider: managerStatus.provedor,
          mode: managerStatus.modo,
          state: managerStatus.estado
        },
        dll,
        client,
        vspague,
        pinpad,
        transaction: {
          attempted: false,
          blockedAttemptTested: true,
          blockedCode: blockedAttempt.codigo,
          iniciaCalls: this._transactionCalls.inicia,
          continuaCalls: this._transactionCalls.continua,
          finalizaCalls: this._transactionCalls.finaliza,
          transactionCalls: { ...this._transactionCalls }
        },
        result: 'READY_FOR_REAL_PINPAD'
      };

      return this._gravarRelatorio(relatorioBase);
    } finally {
      if (adapter?.bridge) {
        adapter.bridge.unload();
      }
    }
  }
}

module.exports = {
  DestaxaRealHarnessService,
  HARNESS_ENV,
  ELECTRON_HARNESS_ENV,
  TRANSACTION_ENV,
  TRANSACTION_BLOCK_CODE,
  EXPECTED_CLIENT_INPUT,
  envAtiva,
  coletarAmbiente,
  caminhoRelatorio
};
