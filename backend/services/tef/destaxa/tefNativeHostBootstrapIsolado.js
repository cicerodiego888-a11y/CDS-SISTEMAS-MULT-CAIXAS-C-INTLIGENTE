'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const cryptoService = require('../../crypto/cryptoService');
const { resolverDirBanco } = require('../../../diagnostics/databasePath');
const {
  validarPerfilTefExistente
} = require('../tefCryptoProfileProvisioner');
const { lerChaveTefPersistida } = require('../tefSigningKeyProvisioner');
const evidenceModuleDefault = require('../tefReconciliationEvidence');
const { DestaxaNativeHostClient } = require('./DestaxaNativeHostClient');
const { transacaoRealHabilitada } = require('./destaxaConstantes');
const {
  PROTOCOLO,
  OPERACOES_HOST,
  ESTADOS_BOOTSTRAP
} = require('./destaxaNativeHostProtocolo');

function criarErro(code, message, cause) {
  const error = new Error(message);
  error.code = code;
  if (cause) error.cause = cause;
  return error;
}

function comChaveTemporaria(segredo, executar) {
  const anterior = process.env.TEF_ENCRYPTION_KEY;
  process.env.TEF_ENCRYPTION_KEY = segredo;
  try {
    return executar();
  } finally {
    if (anterior === undefined) delete process.env.TEF_ENCRYPTION_KEY;
    else process.env.TEF_ENCRYPTION_KEY = anterior;
  }
}

function estatDoArquivo(caminho, fsApi, opcional = false) {
  try {
    return fsApi.statSync(caminho);
  } catch (error) {
    if (opcional && error && error.code === 'ENOENT') return null;
    throw error;
  }
}

function capturarSnapshotBanco(databasePath, fsApi) {
  let databaseStat;
  try {
    databaseStat = estatDoArquivo(databasePath, fsApi);
  } catch (error) {
    throw criarErro(
      'TEF_BOOTSTRAP_DB_INDISPONIVEL',
      'O banco TEF não pôde ser validado para leitura somente leitura.',
      error
    );
  }
  if (!databaseStat || !databaseStat.isFile()) {
    throw criarErro(
      'TEF_BOOTSTRAP_DB_INDISPONIVEL',
      'O arquivo do banco TEF não existe ou não é um arquivo regular.'
    );
  }

  for (const sufixo of ['-wal', '-journal']) {
    let sidecar;
    try {
      sidecar = estatDoArquivo(`${databasePath}${sufixo}`, fsApi, true);
    } catch (error) {
      throw criarErro(
        'TEF_BOOTSTRAP_DB_SIDECAR_INVALIDO',
        'Não foi possível validar os arquivos auxiliares do banco TEF.',
        error
      );
    }
    if (sidecar && sidecar.size > 0) {
      throw criarErro(
        'TEF_BOOTSTRAP_DB_NAO_QUIESCENTE',
        'O banco TEF possui WAL ou journal não vazio; a leitura imutável foi bloqueada.'
      );
    }
  }

  return { size: databaseStat.size, mtimeMs: databaseStat.mtimeMs };
}

function listarPendenciasSomenteLeitura({
  databasePath,
  fsApi = fs,
  sqlite3: sqlite3Injetado
} = {}) {
  if (typeof databasePath !== 'string' || !databasePath.trim()) {
    return Promise.reject(criarErro(
      'TEF_BOOTSTRAP_DB_INDISPONIVEL',
      'O caminho do banco TEF não está configurado.'
    ));
  }

  let snapshotInicial;
  try {
    snapshotInicial = capturarSnapshotBanco(databasePath, fsApi);
  } catch (error) {
    return Promise.reject(error);
  }

  let sqlite3;
  try {
    sqlite3 = sqlite3Injetado || require('sqlite3').verbose();
  } catch (error) {
    return Promise.reject(criarErro(
      'TEF_BOOTSTRAP_SQLITE_INDISPONIVEL',
      'O driver SQLite não está disponível para a leitura TEF.',
      error
    ));
  }
  if (!Number.isInteger(sqlite3.OPEN_READONLY) || !Number.isInteger(sqlite3.OPEN_URI)) {
    return Promise.reject(criarErro(
      'TEF_BOOTSTRAP_SQLITE_READONLY_NAO_SUPORTADO',
      'O driver SQLite não oferece abertura URI estritamente somente leitura.'
    ));
  }

  const uri = `${pathToFileURL(path.resolve(databasePath)).href}?mode=ro&immutable=1`;
  const flags = sqlite3.OPEN_READONLY | sqlite3.OPEN_URI;
  const query = `
    SELECT id, status, idempotency_key, codigo_transacao, payload_retorno
    FROM tef_transacoes
    WHERE status = 'pendente'
    ORDER BY id ASC
  `;

  return new Promise((resolve, reject) => {
    let database;
    let concluido = false;

    const finalizar = (erroConsulta, rows) => {
      if (concluido) return;
      concluido = true;
      if (!database) {
        reject(erroConsulta);
        return;
      }

      database.close((erroFechamento) => {
        if (erroConsulta || erroFechamento) {
          const erro = criarErro(
            'TEF_BOOTSTRAP_DB_LEITURA_FALHOU',
            'A leitura somente leitura das transações TEF falhou.',
            erroConsulta || erroFechamento
          );
          if (erroConsulta && erroFechamento) erro.erroFechamento = erroFechamento;
          reject(erro);
          return;
        }
        if (!Array.isArray(rows)) {
          reject(criarErro(
            'TEF_BOOTSTRAP_DB_RESULTADO_INVALIDO',
            'A consulta somente leitura do banco TEF retornou um resultado inválido.'
          ));
          return;
        }

        try {
          const snapshotFinal = capturarSnapshotBanco(databasePath, fsApi);
          if (snapshotFinal.size !== snapshotInicial.size
              || snapshotFinal.mtimeMs !== snapshotInicial.mtimeMs) {
            throw criarErro(
              'TEF_BOOTSTRAP_DB_ALTERADO_DURANTE_LEITURA',
              'O arquivo do banco TEF mudou durante a leitura somente leitura.'
            );
          }
          resolve(rows);
        } catch (error) {
          reject(error);
        }
      });
    };

    try {
      database = new sqlite3.Database(uri, flags, (erroAbertura) => {
        if (erroAbertura) {
          finalizar(criarErro(
            'TEF_BOOTSTRAP_DB_ABERTURA_FALHOU',
            'Não foi possível abrir o banco TEF em modo imutável somente leitura.',
            erroAbertura
          ));
          return;
        }
        database.all(query, [], (erroConsulta, rows) => finalizar(erroConsulta, rows));
      });
    } catch (error) {
      finalizar(criarErro(
        'TEF_BOOTSTRAP_DB_ABERTURA_FALHOU',
        'Não foi possível abrir o banco TEF em modo imutável somente leitura.',
        error
      ));
    }
  });
}

function textoOpcional(valor) {
  if (valor == null || valor === '') return null;
  return String(valor);
}

function mapearIdentidadesBloqueadas(rows, descriptografarObjeto) {
  if (!Array.isArray(rows)) {
    throw criarErro(
      'TEF_BOOTSTRAP_PENDENCIAS_INVALIDAS',
      'A fonte somente leitura de pendências TEF retornou um formato inválido.'
    );
  }
  if (typeof descriptografarObjeto !== 'function') {
    throw criarErro(
      'TEF_BOOTSTRAP_DESCRIPTOGRAFADOR_INVALIDO',
      'O descriptografador do payload TEF não está disponível.'
    );
  }

  const vistos = new Set();
  const identidades = rows.map((row) => {
    const transactionId = String(row?.id ?? '').trim();
    if (!transactionId || row?.status !== 'pendente' || vistos.has(transactionId)) {
      throw criarErro(
        'TEF_BOOTSTRAP_IDENTIDADE_PENDENTE_INVALIDA',
        'Uma transação pendente não possui identidade persistida válida.'
      );
    }
    vistos.add(transactionId);

    let payload = {};
    if (row.payload_retorno) {
      payload = descriptografarObjeto(row.payload_retorno);
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
        throw criarErro(
          'TEF_BOOTSTRAP_PAYLOAD_PENDENTE_INVALIDO',
          `O payload da transação pendente ${transactionId} é inválido.`
        );
      }
    }
    const persistencia = payload.persistencia || {};
    if (typeof persistencia !== 'object' || Array.isArray(persistencia)) {
      throw criarErro(
        'TEF_BOOTSTRAP_IDENTIDADE_PENDENTE_INVALIDA',
        `A identidade persistida da transação ${transactionId} é inválida.`
      );
    }

    return {
      transactionId,
      operation_id: textoOpcional(persistencia.operation_id || row.codigo_transacao),
      idempotency_key: textoOpcional(row.idempotency_key || persistencia.idempotency_key),
      fingerprint: textoOpcional(persistencia.fingerprint),
      status: 'pendente',
      financialState: String(
        payload.resultadoTardio?.financialState
        || payload.financialState
        || 'UNKNOWN'
      )
    };
  });

  return identidades.sort((a, b) => a.transactionId.localeCompare(b.transactionId));
}

function criarClaimsBootstrap({ hostSessionId, revision, blockedIdentities }) {
  if (typeof hostSessionId !== 'string' || !hostSessionId.trim()
      || !Number.isSafeInteger(revision) || revision < 1) {
    throw criarErro(
      'TEF_BOOTSTRAP_CONTEXTO_INVALIDO',
      'Sessão ou revisão inválida para construir o bootstrap de segurança TEF.'
    );
  }
  const identidades = blockedIdentities.slice();
  const bootstrapId = crypto.randomBytes(16).toString('hex');
  return {
    version: 1,
    protocol: PROTOCOLO,
    hostSessionId,
    bootstrapId,
    revision,
    issuedAt: Date.now(),
    // O protocolo marca como completa a leitura de segurança; nenhuma transação é recuperada aqui.
    recoveryComplete: true,
    recoveryResult: 'SUCCESS',
    securityState: identidades.length
      ? ESTADOS_BOOTSTRAP.BLOCKED
      : ESTADOS_BOOTSTRAP.VALIDATED,
    blockedIdentities: identidades,
    permit: null
  };
}

async function encerrarAposFalha(client, erro) {
  try {
    const resultado = await client.encerrar();
    if (!resultado?.encerrado) erro.encerramento = resultado;
  } catch (erroFechamento) {
    erro.erroFechamento = erroFechamento;
  }
  throw erro;
}

/**
 * Após app.whenReady(), valida o perfil e inicializa somente o NativeHost.
 * O chamador deve selecionar o perfil antes de app.whenReady(); o handle não
 * expõe operações financeiras, não carrega a DLL e encerra o Host explicitamente.
 */
async function inicializarNativeHostIsolado(opcoes = {}) {
  const validarPerfil = opcoes.validarPerfilTef || validarPerfilTefExistente;
  const recuperarChave = opcoes.lerChaveTef || lerChaveTefPersistida;
  const evidenceModule = opcoes.evidenceModule || evidenceModuleDefault;
  const env = opcoes.env || process.env;
  const dbDir = opcoes.dbDir || resolverDirBanco({ env });
  const databasePath = opcoes.databasePath || path.join(dbDir, 'mercadao.db');

  if (!['erp', 'pdv'].includes(opcoes.modulo)) {
    throw criarErro(
      'TEF_BOOTSTRAP_MODULO_INVALIDO',
      'O perfil do módulo Electron deve ser informado explicitamente como erp ou pdv.'
    );
  }
  if (transacaoRealHabilitada()) {
    throw criarErro(
      'TEF_BOOTSTRAP_GATE_REAL_ATIVO',
      'A inicialização isolada exige DESTAXA_REAL_TRANSACTION_ENABLED desligado.'
    );
  }
  if (path.basename(databasePath).toLowerCase() !== 'mercadao.db'
      || path.resolve(path.dirname(databasePath)).toLowerCase() !== path.resolve(dbDir).toLowerCase()) {
    throw criarErro(
      'TEF_BOOTSTRAP_DB_PATH_DIVERGENTE',
      'O banco de transações e o armazenamento protegido da chave devem usar o mesmo diretório de dados.'
    );
  }
  if (opcoes.app && typeof opcoes.app.isReady === 'function' && !opcoes.app.isReady()) {
    throw criarErro(
      'TEF_BOOTSTRAP_ELECTRON_NAO_PRONTO',
      'Selecione e valide o perfil TEF antes de app.whenReady(); inicialize o NativeHost após app.whenReady().'
    );
  }
  validarPerfil({
    app: opcoes.app,
    modulo: opcoes.modulo,
    fsApi: opcoes.fsApi || fs
  });
  const segredo = recuperarChave({
    safeStorage: opcoes.safeStorage,
    dbDir,
    env,
    fsApi: opcoes.fsApi || fs,
    evidenceModule
  });
  if (typeof segredo !== 'string' || !/^[a-f0-9]{64}$/i.test(segredo)) {
    throw criarErro(
      'TEF_BOOTSTRAP_CHAVE_INVALIDA',
      'A chave TEF persistida não atende ao contrato criptográfico.'
    );
  }

  const chavePublica = comChaveTemporaria(
    segredo,
    () => evidenceModule.obterChavePublica()
  );
  const lerPendentes = opcoes.listarTransacoesPendentes
    || (() => listarPendenciasSomenteLeitura({
      databasePath,
      fsApi: opcoes.fsApi || fs,
      sqlite3: opcoes.sqlite3
    }));
  const descriptografarObjeto = opcoes.descriptografarObjeto
    || cryptoService.descriptografarObjeto.bind(cryptoService);
  let claimsEmitidos = null;

  const securityBootstrapProvider = async ({ hostSessionId, revision }) => {
    const rows = await lerPendentes();
    const blockedIdentities = comChaveTemporaria(
      segredo,
      () => mapearIdentidadesBloqueadas(rows, descriptografarObjeto)
    );
    const claims = criarClaimsBootstrap({ hostSessionId, revision, blockedIdentities });
    if (claims.permit !== null) {
      throw criarErro(
        'TEF_BOOTSTRAP_PERMISSAO_INDEVIDA',
        'O bootstrap isolado não pode emitir permissões de operação TEF.'
      );
    }
    const autorizacao = comChaveTemporaria(
      segredo,
      () => evidenceModule.assinarBootstrapSeguranca(claims)
    );
    claimsEmitidos = claims;
    return autorizacao;
  };

  const clientFactory = opcoes.clientFactory
    || ((clientOptions) => new DestaxaNativeHostClient(clientOptions));
  const client = clientFactory({
    reconciliationPublicKey: chavePublica,
    securityBootstrapProvider
  });
  if (!client || typeof client.iniciar !== 'function'
      || typeof client.enviar !== 'function'
      || typeof client.encerrar !== 'function') {
    throw criarErro(
      'TEF_BOOTSTRAP_CLIENTE_INVALIDO',
      'O cliente NativeHost não oferece o contrato mínimo de inicialização segura.'
    );
  }

  let iniciado;
  try {
    iniciado = await client.iniciar();
  } catch (error) {
    return encerrarAposFalha(
      client,
      criarErro(
        'TEF_BOOTSTRAP_NATIVEHOST_FALHOU',
        'O NativeHost não confirmou o bootstrap de segurança.',
        error
      )
    );
  }
  if (!iniciado) {
    const motivo = client.getEstado?.().ultimaSaida?.motivo;
    return encerrarAposFalha(
      client,
      criarErro(
        'TEF_BOOTSTRAP_NATIVEHOST_FALHOU',
        `O NativeHost não confirmou o bootstrap de segurança${motivo ? `: ${motivo}` : '.'}`
      )
    );
  }

  let respostaStatus;
  try {
    respostaStatus = await client.enviar(OPERACOES_HOST.STATUS);
  } catch (error) {
    return encerrarAposFalha(
      client,
      criarErro(
        'TEF_BOOTSTRAP_STATUS_FALHOU',
        'O NativeHost iniciou, mas a consulta de status falhou.',
        error
      )
    );
  }
  if (respostaStatus.error) {
    return encerrarAposFalha(
      client,
      criarErro(
        'TEF_BOOTSTRAP_STATUS_FALHOU',
        'O NativeHost iniciou, mas não respondeu ao status pós-bootstrap.',
        respostaStatus.error
      )
    );
  }

  const status = respostaStatus.output;
  const estadosValidos = [ESTADOS_BOOTSTRAP.VALIDATED, ESTADOS_BOOTSTRAP.BLOCKED];
  const idsEsperados = claimsEmitidos?.blockedIdentities.map((identity) => identity.transactionId);
  const idsObservados = status?.blockedFinancialIdentities;
  const statusSeguro = status
    && status.securityBootstrapRevision === 1
    && estadosValidos.includes(status.securityBootstrapState)
    && Array.isArray(idsEsperados)
    && Array.isArray(idsObservados)
    && idsEsperados.length === idsObservados.length
    && idsEsperados.every((id, index) => id === idsObservados[index])
    && status.gateReal === false
    && status.operacaoAtiva === null
    && status.diagnostics?.dllLoaded === false
    && status.contadores?.dllLoads === 0;
  if (!statusSeguro) {
    return encerrarAposFalha(
      client,
      criarErro(
        'TEF_BOOTSTRAP_STATUS_INSEGURO',
        'O estado pós-bootstrap não comprova revisão, bloqueios, gate financeiro desligado e DLL não carregada.'
      )
    );
  }

  const snapshot = Object.freeze(JSON.parse(JSON.stringify(status)));
  const encerrarHost = async () => {
    const resultado = await client.encerrar();
    if (!resultado?.adiado) return resultado;

    const aguardarSaida = () => new Promise((resolve) => {
      const verificarEstado = () => {
        const estado = client.getEstado?.();
        if (['STOPPED', 'CRASHED', 'OFFLINE'].includes(estado?.estado)) {
          resolve(estado);
          return;
        }
        setTimeout(verificarEstado, 100);
      };
      verificarEstado();
    });
    const estadoFinal = await aguardarSaida();
    return {
      ...resultado,
      encerrado: estadoFinal.estado === 'STOPPED',
      estado: estadoFinal.estado
    };
  };
  const handle = {
    status: snapshot,
    encerrar: encerrarHost
  };

  if (opcoes.permitirInicializacaoClientDestaxa === true) {
    let inicializacaoClientTentada = false;
    const enviarOperacaoControlada = async (operacao, payload = {}) => {
      let resposta;
      try {
        resposta = await client.enviar(operacao, payload);
      } catch (error) {
        throw criarErro(
          `TEF_BOOTSTRAP_${operacao}_IPC_FALHOU`,
          `A operação controlada ${operacao} falhou no transporte IPC.`,
          error
        );
      }
      if (resposta.error) {
        const erro = criarErro(
          `TEF_BOOTSTRAP_${operacao}_FALHOU`,
          resposta.error.message || `A operação controlada ${operacao} foi recusada.`
        );
        erro.detalhes = {
          codigo: resposta.error.code || null,
          mensagem: resposta.error.message || null
        };
        throw erro;
      }
      return resposta.output;
    };

    handle.inicializarClientDestaxa = async (config = {}) => {
      if (inicializacaoClientTentada) {
        throw criarErro(
          'TEF_BOOTSTRAP_CLIENT_INIT_JA_TENTADA',
          'A inicialização do Client já foi tentada neste processo; não será repetida.'
        );
      }
      inicializacaoClientTentada = true;
      if (transacaoRealHabilitada()) {
        throw criarErro(
          'TEF_BOOTSTRAP_GATE_REAL_ATIVO',
          'A inicialização isolada do Client exige o gate financeiro desligado.'
        );
      }
      if (!config || typeof config !== 'object' || Array.isArray(config)) {
        throw criarErro(
          'TEF_BOOTSTRAP_CONFIG_CLIENT_INVALIDA',
          'A configuração não financeira do Client deve ser um objeto.'
        );
      }

      const resultadoLoad = await enviarOperacaoControlada(
        OPERACOES_HOST.LOAD,
        { config }
      );
      if (!resultadoLoad || resultadoLoad.sucesso !== true) {
        const erro = criarErro(
          resultadoLoad?.codigo || 'TEF_BOOTSTRAP_DLL_LOAD_FALHOU',
          resultadoLoad?.mensagem || 'A DLL Destaxa não foi carregada.'
        );
        erro.detalhes = resultadoLoad || null;
        throw erro;
      }

      const statusAposLoad = await enviarOperacaoControlada(OPERACOES_HOST.STATUS);
      const diagnosticoLoad = statusAposLoad?.diagnostics;
      const caminhoDllEsperado = config.sdkPath || config.sdk_path || config.dllPath || config.dll_path || null;
      const caminhoDllConfere = !caminhoDllEsperado
        || (diagnosticoLoad?.dllPath
          && path.resolve(diagnosticoLoad.dllPath).toLowerCase()
            === path.resolve(caminhoDllEsperado).toLowerCase());
      if (!diagnosticoLoad
          || diagnosticoLoad.dllLoaded !== true
          || diagnosticoLoad.exportsValid !== true
          || diagnosticoLoad.processArch !== process.arch
          || diagnosticoLoad.dllArch !== process.arch
          || !caminhoDllConfere
          || statusAposLoad.contadores?.dllLoads !== 1
          || statusAposLoad.gateReal !== false
          || statusAposLoad.operacaoAtiva !== null) {
        throw criarErro(
          'TEF_BOOTSTRAP_DLL_STATUS_INVALIDO',
          'O status do NativeHost não confirmou uma única carga válida da DLL.'
        );
      }

      const resultadoClient = await enviarOperacaoControlada(
        OPERACOES_HOST.INIT_CLIENT,
        { config }
      );
      const statusAposClient = await enviarOperacaoControlada(OPERACOES_HOST.STATUS);
      const sucesso = resultadoClient?.sucesso === true
        && statusAposClient?.diagnostics?.clientInitialized === true
        && statusAposClient?.diagnostics?.clientResultCode === '00'
        && statusAposClient?.gateReal === false
        && statusAposClient?.diagnostics?.dllLoaded === true
        && statusAposClient?.diagnostics?.processArch === process.arch
        && statusAposClient?.diagnostics?.dllArch === process.arch
        && caminhoDllConfere
        && statusAposClient?.contadores?.dllLoads === 1
        && statusAposClient?.operacaoAtiva === null;

      return Object.freeze({
        sucesso,
        dll: resultadoLoad,
        statusAposLoad,
        client: resultadoClient || null,
        statusAposClient
      });
    };
  }

  return Object.freeze(handle);
}

module.exports = {
  inicializarNativeHostIsolado,
  listarPendenciasSomenteLeitura
};
