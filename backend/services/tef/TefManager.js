const crypto = require('crypto');
const { AsyncLocalStorage } = require('async_hooks');
const { obterAdapter, criarAdapter } = require('./tefFactory');
const { selecionarAdapterPorRouteDecision } = require('./tefAdapterSelection');
const {
  obterAdapterDaTransacao,
  montarIdentidadeAdapterPersistencia,
  mesclarPayloadPreservandoIdentidade,
  hidratarTransacaoParaCiclo,
  lerPayloadTransacao
} = require('./tefAdapterCiclo');
const repository = require('./tefRepository');
const tefEvents = require('./tefEvents');
const tefContrato = require('./tefContrato');
const TefFiscalValidator = require('./tefFiscalValidator');
const tefFiscalContextService = require('./tefFiscalContextService');
const DataMaskingService = require('../crypto/dataMaskingService');
const {
  EVENTO_LIBERACAO,
  EVENTO_COMMIT,
  criarClaimsEvidencia,
  assinarEvidencia,
  assinarAutorizacaoReconciliacao: assinarClaimsAutorizacaoReconciliacao,
  assinarBootstrapSeguranca: assinarClaimsBootstrapSeguranca,
  validarEvidenciaTransacao,
  obterChavePublica
} = require('./tefReconciliationEvidence');
const tefLockService = require('./tefLockService');
const tefFraudDetectionService = require('./tefFraudDetectionService');
const tefRetryService = require('./tefRetryService');
const tefCircuitBreakerService = require('./tefCircuitBreakerService');
const tefFailureNotificationService = require('./tefFailureNotificationService');
const tefFluxoPagamento = require('./tefFluxoPagamento');
const tefRouterIntegration = require('./tefRouterIntegration');
const { obterTerminalRecoveryService } = require('./terminalRecovery');
const {
  ESTADOS_BOOTSTRAP,
  PROTOCOLO
} = require('./destaxa/destaxaNativeHostProtocolo');
const {
  FINANCIAL_STATES,
  classificarErroFinanceiro,
  classificarResultadoFinanceiro,
  decidirResultadoTardio,
  montarLogDecisao
} = require('./tefFinancialSafetyPolicy');
const {
  garantirIdentidadeOperacao,
  montarBlocoPersistenciaPreEnvio,
  classificarIdempotencia,
  projetarRecuperacaoIdentidade,
  ERROS_PERSISTENCIA
} = require('./tefPersistenciaObrigatoria');

const ESTADOS_TRAVA_RESULTADO_TARDIO = Object.freeze({
  AGUARDANDO_RESULTADO: 'AGUARDANDO_RESULTADO_TARDIO',
  RECONCILIACAO_PENDENTE: 'RECONCILIACAO_PENDENTE'
});

const STATUS_POR_RECONCILIACAO = Object.freeze({
  [FINANCIAL_STATES.CONFIRMED_SUCCESS]: tefContrato.STATUS.APROVADO,
  [FINANCIAL_STATES.CONFIRMED_DENIED]: tefContrato.STATUS.NEGADO,
  CANCELLED: tefContrato.STATUS.CANCELADO
});

function identidadeTransacaoPersistida(linha) {
  const payload = linha?.payload_retorno || {};
  const persistencia = payload.persistencia || {};
  if (linha?.idempotency_key
    && persistencia.idempotency_key
    && String(linha.idempotency_key) !== String(persistencia.idempotency_key)) {
    const error = new Error('idempotency_key divergente entre linha e payload TEF');
    error.code = 'TEF_RECONCILIACAO_IDENTIDADE_DIVERGENTE';
    throw error;
  }
  return {
    transactionId: linha?.id != null ? String(linha.id) : null,
    operation_id: persistencia.operation_id || linha?.codigo_transacao || null,
    idempotency_key: linha?.idempotency_key || persistencia.idempotency_key || null,
    fingerprint: persistencia.fingerprint || null
  };
}

function validarRegistroReconciliacao(linha, dados, statusEsperado) {
  const identidade = identidadeTransacaoPersistida(linha);
  const reconciliacao = linha?.payload_retorno?.reconciliacao;
  const statusFinal = STATUS_POR_RECONCILIACAO[dados?.financialState];
  const identidadeIncompleta = [
    identidade.transactionId,
    identidade.operation_id,
    identidade.idempotency_key,
    identidade.fingerprint
  ].some((valor) => typeof valor !== 'string' || !valor.trim());
  const diferencaIdentidade = !reconciliacao
    || String(reconciliacao.transactionId || '') !== identidade.transactionId
    || (identidade.operation_id != null
      && String(reconciliacao.operation_id || '') !== String(identidade.operation_id))
    || (identidade.idempotency_key != null
      && String(reconciliacao.idempotency_key || '') !== String(identidade.idempotency_key))
    || (identidade.fingerprint != null
      && String(reconciliacao.fingerprint || '') !== String(identidade.fingerprint));
  if (!linha
    || identidadeIncompleta
    || String(linha.id) !== identidade.transactionId
    || linha.status !== statusEsperado
    || diferencaIdentidade
    || reconciliacao.financialState !== dados.financialState
    || reconciliacao.resultStatus !== statusFinal
    || String(reconciliacao.usuario || '') !== String(dados.usuario || '')
    || String(reconciliacao.observacao || '') !== String(dados.observacao || '')
    || reconciliacao.confirmacao_explicita !== true) {
    const error = new Error('Registro TEF não confirma integralmente a identidade e o desfecho da reconciliação');
    error.code = 'TEF_RECONCILIACAO_PERSISTENCIA_DIVERGENTE';
    throw error;
  }
  return { identidade, reconciliacao };
}

function lerPayloadEvidencia(row) {
  try {
    if (typeof row?.payload === 'string') return JSON.parse(row.payload);
    if (row?.payload && typeof row.payload === 'object' && !Array.isArray(row.payload)) return row.payload;
  } catch (_) {
    return null;
  }
  return null;
}

function eventoPertenceATransacao(row, transactionId) {
  if (String(row?.transacao_id ?? '') === String(transactionId)) return true;
  const payload = lerPayloadEvidencia(row);
  const transactionIdDoPayload = payload?.claims?.transactionId
    || payload?.transactionId
    || payload?.transacao_id;
  return transactionIdDoPayload != null
    && String(transactionIdDoPayload) === String(transactionId);
}

function validarParEvidenciasReconciliacao(linha, reconciliacao, identidade, eventos) {
  const id = String(linha.id);
  const liberacoes = eventos.filter((row) =>
    row.tipo === EVENTO_LIBERACAO && eventoPertenceATransacao(row, id));
  const commits = eventos.filter((row) =>
    row.tipo === EVENTO_COMMIT && eventoPertenceATransacao(row, id));
  if (liberacoes.length !== 1 || commits.length !== 1) {
    throw new Error('Evidência de RELEASE/COMMIT ausente ou duplicada');
  }

  const eventoRelease = liberacoes[0];
  const eventoCommit = commits[0];
  const release = validarEvidenciaTransacao(
    lerPayloadEvidencia(eventoRelease),
    EVENTO_LIBERACAO,
    identidade
  );
  const commit = validarEvidenciaTransacao(
    lerPayloadEvidencia(eventoCommit),
    EVENTO_COMMIT,
    identidade
  );
  if (!release || !commit
    || String(eventoRelease.transacao_id ?? '') !== id
    || String(eventoCommit.transacao_id ?? '') !== id
    || release.transacao_id !== id
    || release.financialState !== reconciliacao.financialState
    || release.resultStatus !== linha.status
    || release.usuario !== String(reconciliacao.usuario || '')
    || commit.transacao_id !== id
    || commit.transactionId !== release.transactionId
    || commit.operation_id !== release.operation_id
    || commit.idempotency_key !== release.idempotency_key
    || commit.fingerprint !== release.fingerprint
    || commit.financialState !== release.financialState
    || commit.resultStatus !== release.resultStatus
    || commit.usuario !== release.usuario
    || commit.releaseEvidenceId !== release.evidenceId
    || commit.releaseTimestamp !== release.timestamp) {
    throw new Error('Evidência assinada não corresponde à identidade ou ao desfecho persistido');
  }
  return { release, commit };
}

function registrarLogPersistido(transacaoId, tipo, mensagem, payload) {
  return new Promise((resolve, reject) => {
    repository.registrarLog(transacaoId, tipo, mensagem, payload, (error, logId) => {
      if (error) return reject(error);
      if (logId == null) return reject(new Error(`Log TEF não foi persistido: ${tipo}`));
      resolve(logId);
    });
  });
}

function clienteTemReconciliacaoPendente(cliente, transactionId) {
  const pendente = cliente?.getEstado?.().reconciliacaoPendente;
  return String(pendente?.transactionId || '') === String(transactionId || '');
}

function assinarAutorizacaoReconciliacao(linha, registroValidado, hostSessionId, phase) {
  const { identidade, reconciliacao } = registroValidado;
  const claims = {
    version: 1,
    authorizationId: crypto.randomBytes(16).toString('hex'),
    hostSessionId: String(hostSessionId),
    transactionId: identidade.transactionId,
    operation_id: identidade.operation_id,
    idempotency_key: identidade.idempotency_key,
    fingerprint: identidade.fingerprint,
    financialState: reconciliacao.financialState,
    recordStatus: linha.status,
    resultStatus: reconciliacao.resultStatus,
    usuario: reconciliacao.usuario,
    observacao: reconciliacao.observacao,
    phase,
    issuedAt: Date.now()
  };
  return assinarClaimsAutorizacaoReconciliacao(claims);
}

function assinarBootstrapSeguranca(claims) {
  return assinarClaimsBootstrapSeguranca(claims);
}

function processoVivo(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
}

class TefManager {

  constructor(opcoes = {}) {
    // Timeout operacional do CDS (configurável via variável de ambiente). Não é
    // autoridade sobre o resultado: adapters com contratoTimeout.resultadoTardio
    // seguem executando e o desfecho tardio passa por _registrarResultadoTardio.
    this.timeout = Number(process.env.TEF_TIMEOUT_MS) || 30000; // 30 segundos padrão
    // Espelho em memória das linhas tef_transacoes com status `pendente`
    // (operação sem desfecho seguro). O banco é a fonte da verdade.
    this._pendencias = new Map();
    this._liberacoesBootstrapPendentes = new Set();
    this._emExecucao = new Set();
    this._escritasPendentes = new Set();
    this._idsRecuperadosRegistrados = new Set();
    this._recuperacao = null;
    this._autorizacaoEmCurso = false;
    /** MRT-22 — ciclo CRT aguardando COLETA/OPCAO do PDV (mesmo transactionId / sem novo TX_START). */
    this._continuidadeCrt = null;
    this._instanciaId = `${process.pid}-${crypto.randomBytes(4).toString('hex')}`;
    this._nativeHostIntent = new AsyncLocalStorage();
    const { obterClienteCompartilhado } = require('./destaxa/DestaxaNativeHostClient');
    this._nativeHostClient = opcoes.nativeHostClient || obterClienteCompartilhado();
    this._configuracaoCriptografica = {
      disponivel: false,
      codigo: 'TEF_CRIPTOGRAFIA_INDISPONIVEL'
    };
    try {
      this._nativeHostClient.configurarChavePublicaReconciliacao(obterChavePublica());
      this._configuracaoCriptografica = { disponivel: true, codigo: null };
    } catch (error) {
      this._configuracaoCriptografica = {
        disponivel: false,
        codigo: error.code || 'TEF_CRIPTOGRAFIA_INDISPONIVEL'
      };
      console.error(
        '[SEGURANÇA] TefManager indisponível por configuração criptográfica inválida:',
        this._configuracaoCriptografica.codigo
      );
    }
    if (typeof this._nativeHostClient.configurarProvedorBootstrapSeguranca === 'function') {
      this._nativeHostClient.configurarProvedorBootstrapSeguranca((contexto) =>
        this._criarBootstrapSeguranca(contexto));
    }
    if (opcoes.recuperarNoInicio !== false) {
      setImmediate(() => this.garantirRecuperacao().catch(() => {}));
    }
  }

  obterEstadoConfiguracaoCriptografica() {
    return {
      estado: this._configuracaoCriptografica.disponivel ? 'DISPONIVEL' : 'INDISPONIVEL',
      disponivel: this._configuracaoCriptografica.disponivel,
      codigo: this._configuracaoCriptografica.codigo
    };
  }

  _exigirConfiguracaoCriptografica() {
    if (this._configuracaoCriptografica.disponivel) return;
    const error = new Error('TEF indisponível: configuração criptográfica de assinatura ausente ou inválida');
    error.code = 'TEF_CRIPTOGRAFIA_INDISPONIVEL';
    error.configuracaoCodigo = this._configuracaoCriptografica.codigo;
    throw error;
  }

  _resultadoCriptografiaIndisponivel() {
    return {
      sucesso: false,
      codigo: 'TEF_CRIPTOGRAFIA_INDISPONIVEL',
      mensagem: 'TEF indisponível: configuração criptográfica de assinatura ausente ou inválida',
      retryAllowed: false,
      tefDisponivel: false
    };
  }

  _capturarSessaoNativeHost() {
    try {
      const { clienteCompartilhadoExistente } = require('./destaxa/DestaxaNativeHostClient');
      const cliente = clienteCompartilhadoExistente();
      if (!cliente) return null;
      const estado = cliente.getEstado();
      return {
        pid: estado.pid || null,
        estado: estado.estado || null,
        processType: estado.processType || null,
        capturadoEm: new Date().toISOString()
      };
    } catch (_) {
      return null;
    }
  }

  async _criarBootstrapSeguranca(contexto = {}) {
      this._exigirConfiguracaoCriptografica();
      await this.garantirRecuperacao();
      await this.recarregarPendencias();
      const linhas = await new Promise((resolve, reject) => {
        repository.listarTransacoesPendentes((err, rows) => (err ? reject(err) : resolve(rows || [])));
      });
      const porId = new Map(linhas.map((linha) => [String(linha.id), linha]));
      for (const trava of this._pendencias.values()) {
        if (trava.reconciliacaoPersistenciaIncompleta !== true || porId.has(trava.transacaoId)) continue;
        const identidade = trava.recuperacao || {};
        porId.set(trava.transacaoId, {
          id: trava.transacaoId,
          status: tefContrato.STATUS.PENDENTE,
          codigo_transacao: identidade.operation_id || null,
          idempotency_key: identidade.idempotency_key || null,
          payload_retorno: {
            financialState: FINANCIAL_STATES.UNKNOWN,
            persistencia: {
              operation_id: identidade.operation_id || null,
              idempotency_key: identidade.idempotency_key || null,
              fingerprint: identidade.fingerprint || null
            }
          }
        });
      }
      const linhasParaBloqueio = [...porId.values()];
      const transactionId = contexto.transactionId == null ? null : String(contexto.transactionId);
      const operation = contexto.operation || null;
      const linhaAtiva = transactionId
        ? linhasParaBloqueio.find((linha) => String(linha.id) === transactionId)
        : null;
      const continuidadeAtiva = this._continuidadeCrt
        && String(this._continuidadeCrt.transacaoId) === transactionId;
      const intent = this._nativeHostIntent.getStore();
      // TEF-DESTAXA-51.20 — ciclo automático autorizar (intent com TX_START+TX_CONTINUE)
      // pode emitir permit novo de TX_CONTINUE sem _continuidadeCrt.
      // TX_FINALIZE e o path PDV (intent só CONTINUE/FINALIZE) continuam exigindo
      // continuidadeAtiva. Permit permanece one-shot por operação/transactionId.
      const intentCicloAutomaticoContinue = operation === 'TX_CONTINUE'
        && Array.isArray(intent?.allowedOperations)
        && intent.allowedOperations.includes('TX_START')
        && intent.allowedOperations.includes('TX_CONTINUE');
      const execucaoAutorizada = Boolean(
        transactionId
        && linhaAtiva
        && linhaAtiva.reconciliacaoPersistenciaIncompleta !== true
        && this._emExecucao.has(transactionId)
        && String(intent?.transactionId || '') === transactionId
        && Array.isArray(intent?.allowedOperations)
        && intent.allowedOperations.includes(operation)
        && (operation === 'TX_START'
          || (continuidadeAtiva && ['TX_CONTINUE', 'TX_FINALIZE'].includes(operation))
          || intentCicloAutomaticoContinue)
      );
      const semOutrasPendencias = execucaoAutorizada
        && linhasParaBloqueio.every((linha) => String(linha.id) === transactionId);
      const bootstrapId = crypto.randomBytes(16).toString('hex');
      const permit = semOutrasPendencias
        ? {
          permitId: bootstrapId,
          operation,
          transactionId
        }
        : null;
      const blockedIdentities = linhasParaBloqueio
        .filter((linha) => !(permit && String(linha.id) === transactionId))
        .map((linha) => {
          const payload = linha.payload_retorno || {};
          const persistencia = payload.persistencia || {};
          return {
            transactionId: String(linha.id),
            operation_id: persistencia.operation_id || linha.codigo_transacao || null,
            idempotency_key: linha.idempotency_key || persistencia.idempotency_key || null,
            fingerprint: persistencia.fingerprint || null,
            status: 'pendente',
            financialState: payload.resultadoTardio?.financialState
              || payload.financialState
              || FINANCIAL_STATES.UNKNOWN
          };
        })
        .sort((a, b) => a.transactionId.localeCompare(b.transactionId));
      const claims = {
        version: 1,
        protocol: PROTOCOLO,
        hostSessionId: String(contexto.hostSessionId || ''),
        bootstrapId,
        revision: contexto.revision,
        issuedAt: Date.now(),
        recoveryComplete: true,
        recoveryResult: 'SUCCESS',
        securityState: blockedIdentities.length
          ? ESTADOS_BOOTSTRAP.BLOCKED
          : ESTADOS_BOOTSTRAP.VALIDATED,
        blockedIdentities,
        permit
      };
    return assinarBootstrapSeguranca(claims);
  }

  /**
   * MRT-23 — Continuidade exige o mesmo Native Host (PID) da marcação.
   * Adapter pode ser recriado; o processo host e a sessão Destaxa não.
   */
  _validarSessaoNativeHostContinuidade(sessaoMarcada) {
    if (!sessaoMarcada || sessaoMarcada.pid == null) {
      return { ok: true, motivo: 'sem_pid_ancora' };
    }
    const atual = this._capturarSessaoNativeHost();
    if (!atual || atual.pid == null) {
      return {
        ok: false,
        codigo: 'TEF_NATIVE_HOST_SESSAO_PERDIDA',
        mensagem: 'Native Host indisponível durante continuidade CRT — reconciliação obrigatória; sem nova cobrança'
      };
    }
    if (String(atual.pid) !== String(sessaoMarcada.pid)) {
      return {
        ok: false,
        codigo: 'TEF_NATIVE_HOST_SESSAO_REINICIADA',
        mensagem: `Native Host reiniciado (pid ${sessaoMarcada.pid}→${atual.pid}) — sessão Destaxa da continuidade perdida`
      };
    }
    if (['CRASHED', 'OFFLINE', 'STOPPED', 'SHUTTING_DOWN'].includes(String(atual.estado || ''))) {
      return {
        ok: false,
        codigo: 'TEF_NATIVE_HOST_SESSAO_PERDIDA',
        mensagem: `Native Host estado=${atual.estado} durante continuidade — reconciliação obrigatória`
      };
    }
    return { ok: true, sessao: atual };
  }

  _marcarContinuidadeCrt(transacaoId, dados = {}, retorno = {}) {
    this._continuidadeCrt = {
      transacaoId: String(transacaoId),
      idempotencyKey: dados.idempotency_key || null,
      vendaId: dados.venda_id != null ? dados.venda_id : null,
      acao: retorno.acao || null,
      solicitadaEm: retorno.solicitadaEm || null,
      desde: new Date().toISOString(),
      sessaoHost: this._capturarSessaoNativeHost()
    };
  }

  async _persistirSolicitacao99(transacaoId, retorno, dados = {}) {
    const persistencia = require('./destaxa/destaxaContinuidadePersistencia');
    const resultado = await persistencia.registrarSolicitacao99(transacaoId, {
      acao: retorno?.acao,
      solicitadaEm: retorno?.solicitadaEm,
      codigoDestaxa: retorno?.codigoDestaxa || retorno?.codigo || '99'
    });
    if (!resultado?.ok || resultado.duravel !== true || resultado.confirmada !== true) {
      const error = new Error(
        resultado?.mensagem || 'Solicitação 99 não confirmada em armazenamento durável'
      );
      error.codigo = resultado?.codigo || 'TEF_CONTINUIDADE_PERSISTENCIA_FALHOU';
      throw error;
    }
    this._marcarContinuidadeCrt(transacaoId, dados, retorno);
    return resultado;
  }

  _limparContinuidadeCrt(transacaoId = null) {
    if (!this._continuidadeCrt) return;
    if (transacaoId != null && String(this._continuidadeCrt.transacaoId) !== String(transacaoId)) return;
    this._continuidadeCrt = null;
  }

  async autorizar(dados, timeoutMs) {
    const dadosNormalizados = {
      ...dados,
      tipo: tefFluxoPagamento.normalizarTipoTef(dados.tipo)
    };

    if (!tefFiscalContextService.validarContextoFiscal(
      dadosNormalizados.contextoFiscal,
      dadosNormalizados
    )) {
      return {
        sucesso: false,
        codigo: 'TEF_CONTEXTO_FISCAL_INVALIDO',
        mensagem: 'A autorização TEF exige contexto fiscal validado no backend.'
      };
    }

    if (!this._configuracaoCriptografica.disponivel) {
      return this._resultadoCriptografiaIndisponivel();
    }
    const operacaoTimeout = timeoutMs || this.timeout;
    let transacaoEmCursoId = null;
    let provedorEmCurso = null;
    let mutexAdquirido = false;
    let leaseId = null;
    let leaseFechado = false;

    const fecharLeaseTerminal = (resultado, contextoLease = {}) => {
      if (!leaseId || leaseFechado) return null;
      leaseFechado = true;
      const classificacao = tefRouterIntegration.classificarPosAutorizacao(
        resultado || {},
        {
          transacaoId: contextoLease.transacaoId != null
            ? contextoLease.transacaoId
            : transacaoEmCursoId,
          ...contextoLease
        }
      );
      const aplicado = tefRouterIntegration.aplicarPosAutorizacao(leaseId, classificacao);
      try {
        repository.registrarLog(
          contextoLease.transacaoId != null ? contextoLease.transacaoId : transacaoEmCursoId,
          'MRT06_LEASE',
          classificacao.mensagem,
          { leaseId, acao: classificacao.acao, motivo: classificacao.motivo, aplicado }
        );
      } catch (_) { /* log best-effort */ }
      return aplicado;
    };

    const anexarContextoRota = (resposta) => ({
      ...resposta,
      routeDecision: dadosNormalizados._routeDecision || resposta.routeDecision || null,
      terminalLeaseId: leaseId,
      executionContext: dadosNormalizados._routeDecision?.executionContext || null,
      adapterSelection: dadosNormalizados._adapterSelection || resposta.adapterSelection || null
    });
    
    // MRT-27 — identidade estável antes do lock (não usa Date.now como identidade exclusiva)
    let identidadeOperacao = null;
    let lockKey = dadosNormalizados.idempotency_key || dadosNormalizados.venda_id || null;

    try {
      // Validar regras fiscais antes de autorizar
      const validacaoFiscal = TefFiscalValidator.validarTransacao(dadosNormalizados);
      if (!validacaoFiscal.valido) {
        return {
          sucesso: false,
          codigo: 'VALIDACAO_FISCAL_FALHOU',
          mensagem: 'Validação fiscal falhou',
          erros: validacaoFiscal.erros
        };
      }

      // MRT-06/12 — Router antes da execução financeira: resolve + allocate +
      // ExecutionContext. Bloqueia REMOTA_REQUERIDA (sem bridge). Adapter
      // de autorização vem do RouteDecision (MRT-12), não de obterAdapter cego.
      const rota = await tefRouterIntegration.resolverRotaAutorizacao(dadosNormalizados);
      const routeDecision = rota.routeDecision;
      dadosNormalizados._routeDecision = routeDecision;
      if (!rota.sucesso) {
        return anexarContextoRota({
          sucesso: false,
          codigo: routeDecision.codigo,
          mensagem: routeDecision.mensagem,
          routeDecision
        });
      }
      leaseId = rota.leaseId;

      identidadeOperacao = garantirIdentidadeOperacao(dadosNormalizados, {
        provedor: routeDecision.provedor || null,
        pdvId: routeDecision.pdvId || null,
        terminalTefId: routeDecision.terminalTefId || null
      });
      dadosNormalizados.idempotency_key = identidadeOperacao.idempotency_key;
      dadosNormalizados.operation_id = identidadeOperacao.operation_id;
      dadosNormalizados._fingerprint = identidadeOperacao.fingerprint;
      // TEF-13: chave financeira inalterada — lease de terminal é ortogonal.
      lockKey = identidadeOperacao.idempotency_key;

      // Detectar transações suspeitas (fraude)
      const contexto = {
        ip_address: dados.ip_address || null,
        user_agent: dados.user_agent || null
      };
      const analiseFraude = await tefFraudDetectionService.analisarTransacao(dadosNormalizados, contexto);
      
      if (analiseFraude.suspeita) {
        // Registrar alerta de fraude nos logs
        repository.registrarLog(null, 'ALERTA_FRAUDE', `Transação suspeita detectada: ${analiseFraude.alertas.join(', ')}`, {
          nivel_risco: analiseFraude.nivel_risco,
          alertas: analiseFraude.alertas
        });
        
        // Se risco alto, bloquear transação
        if (analiseFraude.nivel_risco === 'alto') {
          fecharLeaseTerminal({ sucesso: false, status: tefContrato.STATUS.ERRO, codigo: 'TRANSACAO_SUSPEITA' });
          return anexarContextoRota({
            sucesso: false,
            codigo: 'TRANSACAO_SUSPEITA',
            mensagem: 'Transação bloqueada por suspeita de fraude',
            alertas: analiseFraude.alertas,
            nivel_risco: analiseFraude.nivel_risco
          });
        }
      }

      // MRT-27 — idempotência: preservar aprovação/negativa; bloquear reenvio inconclusivo/pendente
      if (dadosNormalizados.idempotency_key) {
        const transacaoExistente = await this._verificarIdempotencia(dadosNormalizados.idempotency_key);
        if (transacaoExistente) {
          const completa = await this._buscarTransacaoCompleta(transacaoExistente.id);
          const decisaoIdem = classificarIdempotencia(
            completa || transacaoExistente,
            identidadeOperacao.fingerprint
          );
          fecharLeaseTerminal({
            sucesso: tefContrato.estaAprovado({ status: transacaoExistente.status }),
            status: transacaoExistente.status,
            codigo: decisaoIdem.codigo || 'TRANSACAO_DUPLICADA'
          }, { transacaoId: transacaoExistente.id });
          const resposta = tefContrato.paraRespostaApi({
            sucesso: tefContrato.estaAprovado({ status: transacaoExistente.status }),
            status: transacaoExistente.status,
            nsu: completa?.nsu,
            autorizacao: completa?.autorizacao,
            adquirente: completa?.adquirente,
            bandeira: completa?.bandeira,
            comprovanteCliente: completa?.comprovante_cliente,
            comprovanteLoja: completa?.comprovante_estabelecimento,
            codigo: decisaoIdem.codigo || 'TRANSACAO_DUPLICADA',
            mensagem: decisaoIdem.acao === 'BLOQUEAR_REENVIAR'
              ? 'Operação inconclusiva/pendente — identidade reutilizada; novo envio bloqueado'
              : 'Transação duplicada detectada — retornando existente',
            financialState: decisaoIdem.financialState
              || (decisaoIdem.preservarUnknown ? FINANCIAL_STATES.UNKNOWN : undefined)
          }, transacaoExistente.id);
          return anexarContextoRota({
            ...resposta,
            transacao_existente: true,
            retryAllowed: false,
            operation_id: projetarRecuperacaoIdentidade(completa || transacaoExistente)?.operation_id
              || identidadeOperacao.operation_id,
            idempotency_key: dadosNormalizados.idempotency_key,
            fingerprint: identidadeOperacao.fingerprint,
            provedorPreservado: decisaoIdem.provedor || completa?.provedor || null,
            decisaoIdempotencia: decisaoIdem.acao
          });
        }
      }

      // Operação anterior (deste ou de outro processo, antes ou depois de um
      // restart) sem desfecho seguro: nenhuma nova autorização, transactionId ou cobrança.
      try {
        await this.garantirRecuperacao();
        await this._aguardarEscritas();
        if (this._pendencias.size > 0) await this.recarregarPendencias();
      } catch (error) {
        fecharLeaseTerminal({ sucesso: false, status: tefContrato.STATUS.ERRO, codigo: 'RECUPERACAO_FALHOU' });
        return anexarContextoRota(this._respostaSemRecuperacao(error));
      }
      if (this._pendencias.size > 0) {
        // TEF-14: pendência financeira bloqueia nova autorização; libera só o lease de ocupação
        // (não há TX nova). A pendência existente permanece. Holds MRT-07 inalterados.
        fecharLeaseTerminal({ sucesso: false, status: tefContrato.STATUS.ERRO, codigo: 'TRAVADO_RESULTADO_TARDIO' });
        return anexarContextoRota(this._respostaTravaResultadoTardio());
      }
      // MRT-07: sem pendência financeira → libera holds de recuperação órfãos (nunca aprova/cancela TX)
      try {
        obterTerminalRecoveryService().sincronizarHoldsComPendencias({
          pendenciasCompletas: this.listarTravasPendencias()
        });
      } catch (_) { /* best-effort */ }
      if (this._continuidadeCrt) {
        fecharLeaseTerminal({
          sucesso: false,
          status: tefContrato.STATUS.PENDENTE,
          codigo: 'TEF_CRT_CONTINUIDADE_ATIVA'
        });
        return anexarContextoRota({
          sucesso: false,
          status: tefContrato.STATUS.PENDENTE,
          codigo: 'TEF_CRT_CONTINUIDADE_ATIVA',
          mensagem: `CRT aguarda continuidade (transacao ${this._continuidadeCrt.transacaoId}) — não inicie segunda cobrança`,
          retryAllowed: false,
          requerContinuacao: true,
          acao: this._continuidadeCrt.acao || null,
          transacaoId: this._continuidadeCrt.transacaoId,
          transacao_id: this._continuidadeCrt.transacaoId,
          idempotency_key: this._continuidadeCrt.idempotencyKey
        });
      }
      if (this._autorizacaoEmCurso) {
        fecharLeaseTerminal({ sucesso: false, status: tefContrato.STATUS.ERRO, codigo: 'AUTORIZACAO_EM_CURSO' });
        return anexarContextoRota(this._respostaAutorizacaoEmCurso());
      }
      this._autorizacaoEmCurso = true;
      mutexAdquirido = true;

      // MRT-12 — seleção orientada pelo RouteDecision (sem fallback LIMIT 1).
      // Singleton Destaxa: binding COMPAT_SINGLETON já carregado pelo Router.
      let selecao;
      try {
        selecao = selecionarAdapterPorRouteDecision(routeDecision);
      } catch (erroSelecao) {
        fecharLeaseTerminal({
          sucesso: false,
          status: tefContrato.STATUS.ERRO,
          codigo: erroSelecao.codigo || erroSelecao.code || 'ADAPTER_SELECAO_FALHOU'
        });
        return anexarContextoRota({
          sucesso: false,
          codigo: erroSelecao.codigo || erroSelecao.code || 'ADAPTER_SELECAO_FALHOU',
          mensagem: erroSelecao.message,
          detalhes: erroSelecao.detalhes || null,
          adapterSelection: null
        });
      }
      dadosNormalizados._adapterSelection = {
        provedor: selecao.provedor,
        terminalTefId: selecao.terminalTefId,
        modo: selecao.modo,
        fonte: selecao.fonte,
        executionMode: selecao.executionMode || null,
        codigo: selecao.codigo
      };
      const adapter = selecao.adapter;
      provedorEmCurso = adapter.nome;

      // Adapters com gate financeiro (Destaxa real) validam pré-condições antes
      // da linha pendente: bloqueio não cria transactionId nem aciona o PinPad.
      let preparacaoAdapter = null;
      if (typeof adapter.prepararAutorizacao === 'function') {
        preparacaoAdapter = await adapter.prepararAutorizacao(dadosNormalizados);
        if (!preparacaoAdapter.pronto) {
          fecharLeaseTerminal(preparacaoAdapter.resposta || {
            sucesso: false,
            status: tefContrato.STATUS.ERRO,
            codigo: 'PREPARACAO_ADAPTER'
          });
          return anexarContextoRota(preparacaoAdapter.resposta);
        }
      }

      // Circuit breaker permanece; autorização financeira, porém, tem uma
      // única tentativa. O retry service aplica a política sem retry.
      const resultadoAutorizacao = await tefCircuitBreakerService.executarComCircuitBreaker(
        'tef_autorizacao',
        async () => {
          return await tefRetryService.autorizarComRetry(async () => {
            return await tefLockService.comLock(lockKey, async () => {
              // Timeout operacional: responde UNKNOWN/PENDING ao chamador, mas não
              // cancela a chamada do adapter (a DLL não pode ser interrompida).
              let expirado = false;
              const operacaoComTimeout = new Promise((resolve, reject) => {
                const timeoutId = setTimeout(() => {
                  expirado = true;
                  if (transacaoEmCursoId != null && adapter.contratoTimeout?.resultadoTardio === true) {
                    this._abrirTravaResultadoTardio(transacaoEmCursoId, adapter.nome, dadosNormalizados.tipo);
                  }
                  reject(new Error(`Timeout de ${operacaoTimeout}ms excedido na operação TEF`));
                }, operacaoTimeout);

                const blocoPersistencia = montarBlocoPersistenciaPreEnvio({
                  operationId: identidadeOperacao?.operation_id || dadosNormalizados.operation_id,
                  fingerprint: identidadeOperacao?.fingerprint || dadosNormalizados._fingerprint,
                  idempotencyKey: dadosNormalizados.idempotency_key,
                  vendaId: dadosNormalizados.venda_id || null,
                  pdvId: dadosNormalizados._routeDecision?.pdvId || null,
                  terminalTefId: selecao.terminalTefId
                    || dadosNormalizados._routeDecision?.terminalTefId
                    || null,
                  provedor: selecao.provedor || dadosNormalizados._adapterSelection?.provedor || adapter.nome,
                  valor: dadosNormalizados.valor,
                  tipo: dadosNormalizados.tipo,
                  estadoFinanceiroInicial: FINANCIAL_STATES.UNKNOWN
                });

                repository.criarTransacaoExclusiva({
                  venda_id: dadosNormalizados.venda_id || null,
                  tipo: dadosNormalizados.tipo,
                  valor: dadosNormalizados.valor,
                  parcelas: dadosNormalizados.parcelas || 1,
                  // MRT-13 — chave canônica do provedor (não só adapter.nome de display)
                  provedor: selecao.provedor || dadosNormalizados._adapterSelection?.provedor || adapter.nome,
                  idempotency_key: dadosNormalizados.idempotency_key || null,
                  operation_id: blocoPersistencia.operation_id,
                  codigo_transacao: blocoPersistencia.operation_id,
                  payload_retorno: {
                    execucao: { instancia: this._instanciaId, pid: process.pid, iniciadoEm: new Date().toISOString() },
                    // MRT-13 — identidade contínua do adapter no ciclo
                    identidadeAdapter: montarIdentidadeAdapterPersistencia(selecao, adapter),
                    // MRT-27 — identidade obrigatória antes da DLL
                    persistencia: blocoPersistencia,
                    financialState: FINANCIAL_STATES.UNKNOWN,
                    // MRT-07 — correlação lease×transação (somente metadado; não altera TEF-13/14/15)
                    roteamento: dadosNormalizados._routeDecision ? {
                      terminalTefId: dadosNormalizados._routeDecision.terminalTefId || null,
                      dispositivoId: dadosNormalizados._routeDecision.dispositivoId || null,
                      pdvId: dadosNormalizados._routeDecision.pdvId || null,
                      leaseId: leaseId || null,
                      runtimeKey: dadosNormalizados._routeDecision.isolamento?.runtimeKey
                        || dadosNormalizados._routeDecision.executionContext?.runtime?.runtimeKey
                        || null,
                      topologia: dadosNormalizados._routeDecision.executionContext?.topologia || null,
                      modo: dadosNormalizados._routeDecision.modo || null
                    } : null
                  }
                }, async (err, transacaoId) => {
                  if (err) {
                    clearTimeout(timeoutId);
                    // MRT-27 — falha de persistência bloqueia Adapter/DLL
                    if (err.message && err.message.includes('UNIQUE constraint')) {
                      const transacaoExistente = await this._buscarPorIdempotencyKey(dadosNormalizados.idempotency_key);
                      if (transacaoExistente) {
                        return resolve({
                          sucesso: false,
                          codigo: 'TRANSACAO_DUPLICADA',
                          mensagem: 'Transação duplicada detectada',
                          transacao_id: transacaoExistente.id,
                          status: transacaoExistente.status,
                          transacao_existente: true,
                          retryAllowed: false
                        });
                      }
                    }
                    return resolve({
                      sucesso: false,
                      codigo: ERROS_PERSISTENCIA.FALHOU,
                      mensagem: `Persistência TEF falhou — envio financeiro bloqueado: ${err.message}`,
                      retryAllowed: false,
                      transactionAttempted: false
                    });
                  }

                  if (transacaoId == null) {
                    // Outra instância/processo abriu uma transação pendente entre a
                    // verificação e o INSERT: nada foi criado nem enviado.
                    clearTimeout(timeoutId);
                    return this.recarregarPendencias()
                      .catch(() => {})
                      .then(() => resolve(this._respostaTravaResultadoTardio()));
                  }

                  if (expirado) {
                    // O chamador já recebeu TIMEOUT: a autorização não é mais enviada.
                    // MRT-14 — preservar identidadeAdapter/roteamento/execucao no rewrite.
                    const identidadeTimeout = montarIdentidadeAdapterPersistencia(selecao, adapter);
                    this._gravar((pronto) => repository.atualizarTransacao(transacaoId, {
                      status: tefContrato.STATUS.ERRO,
                      payload_retorno: mesclarPayloadPreservandoIdentidade(
                        { codigo: 'TEF_TIMEOUT_ANTES_DO_ENVIO', transactionAttempted: false },
                        {
                          execucao: {
                            instancia: this._instanciaId,
                            pid: process.pid,
                            iniciadoEm: new Date().toISOString()
                          },
                          identidadeAdapter: identidadeTimeout,
                          persistencia: blocoPersistencia,
                          roteamento: dadosNormalizados._routeDecision ? {
                            terminalTefId: dadosNormalizados._routeDecision.terminalTefId || null,
                            dispositivoId: dadosNormalizados._routeDecision.dispositivoId || null,
                            pdvId: dadosNormalizados._routeDecision.pdvId || null,
                            leaseId: leaseId || null,
                            modo: dadosNormalizados._routeDecision.modo || null
                          } : null
                        },
                        identidadeTimeout
                      )
                    }, (error) => pronto(error), {
                      statusEsperado: 'pendente',
                      exigirUmaLinha: true
                    })).catch((error) => {
                      repository.registrarLog(transacaoId, 'ERRO_TIMEOUT_ANTES_DO_ENVIO', error.message, {
                        transactionAttempted: false
                      });
                    });
                    repository.registrarLog(transacaoId, 'TIMEOUT_ANTES_DO_ENVIO', 'Timeout operacional antes do envio ao adapter — autorização não enviada', {
                      transactionAttempted: false
                    });
                    return;
                  }

                  transacaoEmCursoId = transacaoId;
                  this._emExecucao.add(String(transacaoId));

                  // Mascarar dados sensíveis nos logs
                  const dadosMascarados = DataMaskingService.mascararObjeto(dadosNormalizados);
                  repository.registrarLog(transacaoId, 'INICIO', 'Transação TEF iniciada — persistida antes do Adapter/DLL', {
                    ...dadosMascarados,
                    persistencia: blocoPersistencia
                  });

                  // MRT-31 — evidência: INSERT confirmado antes do Adapter (não altera fluxo)
                  try {
                    const { registrarEtapaFluxo, ETAPAS_FLUXO } = require('./destaxa/destaxaFluxoInstrumentacao');
                    registrarEtapaFluxo(ETAPAS_FLUXO.PERSISTENCIA_CONFIRMADA, {
                      operation_id: blocoPersistencia.operation_id,
                      transactionId: String(transacaoId),
                      venda_id: dadosNormalizados.venda_id || null,
                      pdvId: dadosNormalizados._routeDecision?.pdvId || null,
                      terminalTefId: selecao.terminalTefId
                        || dadosNormalizados._routeDecision?.terminalTefId
                        || null,
                      fingerprint: blocoPersistencia.fingerprint,
                      idempotency_key: blocoPersistencia.idempotency_key,
                      provedor: blocoPersistencia.provedor
                    }, {
                      resultadoPersistencia: 'INSERT_OK',
                      persistenciaConfirmada: true
                    });
                  } catch (_) { /* instrumentação best-effort */ }

                  tefEvents.emitirEstado(tefEvents.estados.INSIRA_CARTAO);

                  try {
                    // Destaxa (MRT-21/27): só após INSERT — autorizarPagamento exige
                    // persistenciaConfirmada + transactionId (bloqueia bypass).
                    const preparacaoComPersistencia = {
                      ...(preparacaoAdapter && preparacaoAdapter.pronto ? preparacaoAdapter : {}),
                      transactionId: String(transacaoId),
                      persistenciaConfirmada: true,
                      operation_id: blocoPersistencia.operation_id,
                      idempotency_key: blocoPersistencia.idempotency_key,
                      fingerprint: blocoPersistencia.fingerprint
                    };
                    const retornoBruto = await this._nativeHostIntent.run({
                      transactionId: String(transacaoId),
                      allowedOperations: ['TX_START', 'TX_CONTINUE', 'TX_FINALIZE']
                    }, () => adapter.autorizarPagamento(
                      dadosNormalizados,
                      preparacaoComPersistencia
                    ));
                    if (retornoBruto?.cicloCrt) {
                      repository.registrarLog(transacaoId, 'CICLO_CRT', 'Orquestração CRT Destaxa', {
                        passos: retornoBruto.cicloCrt.passos || null,
                        continues: retornoBruto.cicloCrt.continues,
                        finalizado: retornoBruto.cicloCrt.finalizado === true,
                        vinculo: retornoBruto.vinculoVendaPdv || {
                          venda_id: dadosNormalizados.venda_id || null
                        },
                        inconclusivo: retornoBruto.inconclusivo === true,
                        retryAllowed: false
                      });
                    }
                    if (retornoBruto?.requerContinuacao !== true
                      && (retornoBruto?.inconclusivo === true || retornoBruto?.sucesso === true
                      || retornoBruto?.status === tefContrato.STATUS.NEGADO
                      || retornoBruto?.status === tefContrato.STATUS.APROVADO)) {
                      this._limparContinuidadeCrt(transacaoId);
                    }
                    if (expirado) {
                      await this._registrarResultadoTardio(
                        transacaoId,
                        adapter.nome,
                        dadosNormalizados.tipo,
                        retornoBruto
                      ).catch((error) => {
                        repository.registrarLog(transacaoId, 'ERRO_RESULTADO_TARDIO', error.message, {
                          error: error.message,
                          retryAllowed: false
                        });
                      });
                      return;
                    }
                    clearTimeout(timeoutId);
                    const decisaoFinanceira = classificarResultadoFinanceiro(retornoBruto);
                    const retorno = tefContrato.criarRespostaAutorizacao({
                      sucesso: retornoBruto.sucesso,
                      status: retornoBruto.status,
                      nsu: retornoBruto.nsu,
                      autorizacao: retornoBruto.autorizacao,
                      cnpj_credenciadora: retornoBruto.cnpj_credenciadora,
                      provedor: adapter.nome,
                      adquirente: retornoBruto.adquirente,
                      bandeira: retornoBruto.bandeira,
                      comprovanteCliente: retornoBruto.comprovanteCliente || retornoBruto.comprovante_cliente,
                      comprovanteLoja: retornoBruto.comprovanteLoja || retornoBruto.comprovante_estabelecimento,
                      transacaoId: String(transacaoId),
                      codigo: retornoBruto.codigo,
                      mensagem: retornoBruto.mensagem,
                      payloadRetorno: retornoBruto.payloadRetorno || retornoBruto.payload_retorno,
                      modo: retornoBruto.modo,
                      financialState: retornoBruto.financialState || decisaoFinanceira.financialState,
                      protocolState: retornoBruto.estado || decisaoFinanceira.state,
                      retryAllowed: false,
                      retryReason: retornoBruto.retryReason || decisaoFinanceira.retryReason
                    });

                    tefEvents.emitirEstado(tefEvents.estados.PROCESSANDO);

                    const persistencia = tefContrato.paraPersistencia(retorno);
                    const payloadPersistido = persistencia.payload_retorno;
                    // MRT-14 — não descartar identidade do ciclo ao gravar desfecho
                    const identidadeAuth = montarIdentidadeAdapterPersistencia(selecao, adapter);
                      const payloadComIdentidade = mesclarPayloadPreservandoIdentidade(
                      {
                        ...(payloadPersistido && typeof payloadPersistido === 'object'
                          ? payloadPersistido
                          : { resposta: payloadPersistido }),
                        financialState: retorno.financialState,
                        cicloCrt: retornoBruto.cicloCrt || null,
                        vinculoVendaPdv: retornoBruto.vinculoVendaPdv || {
                          venda_id: dadosNormalizados.venda_id || null
                        },
                        // MRT-42 — preservar ação 99/OPCAO no payload para o PDV/continuar
                        continuidade: {
                          ...(payloadPersistido?.continuidade
                            && typeof payloadPersistido.continuidade === 'object'
                            ? payloadPersistido.continuidade
                            : {}),
                          requerContinuacao: retornoBruto.requerContinuacao === true,
                          acao: retornoBruto.acao || null,
                          solicitadaEm: retornoBruto.requerContinuacao === true
                            ? retornoBruto.solicitadaEm || null
                            : payloadPersistido?.continuidade?.solicitadaEm || null
                        },
                        reconciliacaoObrigatoria: retornoBruto.reconciliacaoObrigatoria === true
                      },
                      {
                        execucao: {
                          instancia: this._instanciaId,
                          pid: process.pid,
                          iniciadoEm: new Date().toISOString()
                        },
                        identidadeAdapter: identidadeAuth,
                        roteamento: dadosNormalizados._routeDecision ? {
                          terminalTefId: dadosNormalizados._routeDecision.terminalTefId || null,
                          dispositivoId: dadosNormalizados._routeDecision.dispositivoId || null,
                          pdvId: dadosNormalizados._routeDecision.pdvId || null,
                          leaseId: leaseId || null,
                          runtimeKey: dadosNormalizados._routeDecision.isolamento?.runtimeKey
                            || dadosNormalizados._routeDecision.executionContext?.runtime?.runtimeKey
                            || null,
                          topologia: dadosNormalizados._routeDecision.executionContext?.topologia || null,
                          modo: dadosNormalizados._routeDecision.modo || null
                        } : null
                      },
                      identidadeAuth
                    );

                    repository.atualizarTransacao(transacaoId, {
                      venda_id: dados.venda_id || null,
                      ...persistencia,
                      payload_retorno: payloadComIdentidade
                    }, async (updateErr) => {
                      if (updateErr) {
                        clearTimeout(timeoutId);
                        this._concluirExecucao(transacaoId, tefContrato.STATUS.PENDENTE, {
                          provedor: adapter.nome,
                          operacao: dadosNormalizados.tipo,
                          financialState: FINANCIAL_STATES.UNKNOWN,
                          codigo: 'TEF_PERSISTENCIA_FALHOU'
                        });
                        return reject(updateErr);
                      }
                      if (retornoBruto.requerContinuacao === true) {
                        // 51.05 — cede o event loop do Electron main antes da persistência 99
                        await new Promise((r) => setImmediate(r));
                        try {
                          await this._persistirSolicitacao99(transacaoId, retornoBruto, {
                            idempotency_key: dadosNormalizados.idempotency_key,
                            venda_id: dadosNormalizados.venda_id
                          });
                        } catch (error) {
                          clearTimeout(timeoutId);
                          repository.registrarLog(
                            transacaoId,
                            'CICLO_CRT_SOLICITACAO_99_PERSISTENCIA_FALHOU',
                            error.message,
                            { codigo: error.codigo || error.code || null }
                          );
                          this._concluirExecucao(transacaoId, tefContrato.STATUS.PENDENTE, {
                            provedor: adapter.nome,
                            operacao: dadosNormalizados.tipo,
                            financialState: FINANCIAL_STATES.UNKNOWN,
                            codigo: error.codigo || error.code || 'TEF_CONTINUIDADE_PERSISTENCIA_FALHOU'
                          });
                          return reject(error);
                        }
                        // 51.05 — libera _emExecucao para permitir POST /tef/continuar (sem concluir ciclo)
                        this._liberarSlotExecucaoParaContinuidade(transacaoId, {
                          tipoAcao: retornoBruto.acao?.tipo || null,
                          codigo: retornoBruto.codigo || '99'
                        });
                      }
                      // MRT-42 — continuidade 99: não "concluir" o ciclo; PDV deve POST /tef/continuar
                      if (retornoBruto.requerContinuacao !== true) {
                        this._concluirExecucao(transacaoId, retorno.status, {
                          provedor: adapter.nome,
                          operacao: dadosNormalizados.tipo,
                          financialState: retorno.financialState,
                          codigo: retorno.codigo
                        });
                      }

                      if (tefContrato.estaAprovado(retorno)) {
                        tefEvents.emitirEstadoPinpad(tefEvents.estadosPinpad.TRANSACAO_APROVADA, { transacaoId });
                        tefEvents.emitirEstado(tefEvents.estados.APROVADO);
                      } else if (retorno.status === tefContrato.STATUS.NEGADO) {
                        tefEvents.emitirEstadoPinpad(tefEvents.estadosPinpad.TRANSACAO_NEGADA, { transacaoId });
                      }

                      const retornoMascarado = DataMaskingService.mascararObjeto(retorno);
                      repository.registrarLog(transacaoId, 'RETORNO', retorno.mensagem, retornoMascarado);
                      repository.registrarLog(
                        transacaoId,
                        'DECISAO_RETRY',
                        retorno.retryReason,
                        montarLogDecisao({
                          transactionId: transacaoId,
                          provider: adapter.nome,
                          operation: dadosNormalizados.tipo,
                          decision: {
                            ...decisaoFinanceira,
                            financialState: retorno.financialState,
                            state: retorno.protocolState,
                            retryReason: retorno.retryReason
                          }
                        })
                      );

                      clearTimeout(timeoutId);
                      // MRT-42 — espelha continuarAutorizacao: PDV precisa de requerContinuacao + acao
                      const api = tefContrato.paraRespostaApi(retorno, transacaoId);
                      resolve({
                        ...api,
                        requerContinuacao: retornoBruto.requerContinuacao === true,
                        acao: retornoBruto.acao || null,
                        solicitadaEm: retornoBruto.solicitadaEm || null,
                        inconclusivo: retornoBruto.inconclusivo === true,
                        reconciliacaoObrigatoria: retornoBruto.reconciliacaoObrigatoria === true,
                        cicloCrt: retornoBruto.cicloCrt || null,
                        vinculoVendaPdv: retornoBruto.vinculoVendaPdv || null,
                        idempotency_key: dadosNormalizados.idempotency_key || null,
                        retryAllowed: false
                      });
                    });
                  } catch (error) {
                    clearTimeout(timeoutId);
                    repository.registrarLog(transacaoId, 'ERRO', error.message, { error: error.message });
                    if (expirado) {
                      await this._registrarResultadoTardio(transacaoId, adapter.nome, dadosNormalizados.tipo, {
                        codigo: error.code || 'TEF_UNKNOWN',
                        mensagem: error.message
                      }).catch((persistenciaError) => {
                        repository.registrarLog(transacaoId, 'ERRO_RESULTADO_TARDIO', persistenciaError.message, {
                          error: persistenciaError.message,
                          retryAllowed: false
                        });
                      });
                      return;
                    }
                    this._concluirExecucao(transacaoId, tefContrato.STATUS.PENDENTE, {
                      provedor: adapter.nome,
                      operacao: dadosNormalizados.tipo,
                      financialState: FINANCIAL_STATES.UNKNOWN,
                      codigo: error.code || 'TEF_UNKNOWN'
                    });
                    reject(error);
                  }
                });
              });

              return await operacaoComTimeout;
            }, operacaoTimeout + 10000); // Lock com 10 segundos a mais que o timeout da operação
          }, {
            transactionId: transacaoEmCursoId,
            provider: adapter.nome,
            operation: dadosNormalizados.tipo
          });
        },
        {
          limiteFalhas: 5,
          timeoutAberto: 60000
        }
      );

      fecharLeaseTerminal(resultadoAutorizacao, {
        transacaoId: transacaoEmCursoId
          ?? resultadoAutorizacao?.transacao_id
          ?? resultadoAutorizacao?.transacaoId
          ?? null
      });
      return anexarContextoRota(resultadoAutorizacao);
    } catch (error) {
      const decisaoFinanceira = error.tefFinancialDecision || classificarErroFinanceiro(error);
      const logDecisao = montarLogDecisao({
        transactionId: transacaoEmCursoId,
        provider: provedorEmCurso,
        operation: dadosNormalizados.tipo,
        decision: decisaoFinanceira
      });

      // Tratamento específico para diferentes tipos de erro
      if (decisaoFinanceira.state === 'TIMEOUT') {
        repository.registrarLog(transacaoEmCursoId, 'ERRO_TIMEOUT', error.message, logDecisao);
        await tefFailureNotificationService.notificarFalhaTimeout({
          mensagem: error.message,
          transactionId: transacaoEmCursoId,
          provider: provedorEmCurso,
          operation: dadosNormalizados.tipo
        });
        const respTimeout = {
          sucesso: false,
          status: tefContrato.STATUS.PENDENTE,
          codigo: 'TIMEOUT',
          mensagem: error.message,
          tipo_erro: 'timeout',
          transacaoId: transacaoEmCursoId != null ? String(transacaoEmCursoId) : null,
          transacao_id: transacaoEmCursoId,
          financialState: decisaoFinanceira.financialState,
          protocolState: decisaoFinanceira.state,
          retryAllowed: false,
          retryReason: decisaoFinanceira.retryReason
        };
        fecharLeaseTerminal(respTimeout, {
          transacaoId: transacaoEmCursoId,
          forcarInconclusivo: transacaoEmCursoId != null
        });
        return anexarContextoRota(respTimeout);
      }
      if (error.message && error.message.includes('lock')) {
        repository.registrarLog(null, 'ERRO_LOCK', error.message, { error: error.message });
        const respLock = {
          sucesso: false,
          codigo: 'LOCK_NAO_ADQUIRIDO',
          mensagem: 'Operação em andamento, tente novamente',
          tipo_erro: 'conflito'
        };
        fecharLeaseTerminal(respLock);
        return anexarContextoRota(respLock);
      }
      if (error.message && error.message.includes('Circuit breaker')) {
        repository.registrarLog(null, 'ERRO_CIRCUIT_BREAKER', error.message, { error: error.message });
        await tefFailureNotificationService.notificarFalhaCircuitBreaker('tef_autorizacao', tefCircuitBreakerService.obterEstado('tef_autorizacao'), error);
        const respCb = {
          sucesso: false,
          codigo: 'CIRCUIT_BREAKER_ABERTO',
          mensagem: 'Serviço TEF temporariamente indisponível devido a falhas consecutivas',
          tipo_erro: 'servico_indisponivel'
        };
        fecharLeaseTerminal(respCb);
        return anexarContextoRota(respCb);
      }
      if (error.message && error.message.includes('TRANSACAO_SUSPEITA')) {
        repository.registrarLog(null, 'ALERTA_FRAUDE', 'Transação bloqueada por suspeita de fraude', error);
        await tefFailureNotificationService.notificarFalhaFraude(error);
        const respFraude = {
          sucesso: false,
          codigo: 'TRANSACAO_SUSPEITA',
          mensagem: error.mensagem,
          alertas: error.alertas,
          nivel_risco: error.nivel_risco,
          tipo_erro: 'seguranca'
        };
        fecharLeaseTerminal(respFraude);
        return anexarContextoRota(respFraude);
      }

      // Depois que a linha pendente foi criada, qualquer erro de transporte ou
      // resposta inconclusiva permanece UNKNOWN/PENDING com o mesmo ID.
      if (transacaoEmCursoId != null || decisaoFinanceira.transportError) {
        repository.registrarLog(
          transacaoEmCursoId,
          'ERRO_FINANCEIRO_INCONCLUSIVO',
          error.message,
          logDecisao
        );
        const respInc = {
          sucesso: false,
          status: tefContrato.STATUS.PENDENTE,
          codigo: decisaoFinanceira.resultCode || 'TEF_UNKNOWN',
          mensagem: error.message,
          tipo_erro: decisaoFinanceira.transportError ? 'transporte' : 'desconhecido',
          transacaoId: transacaoEmCursoId != null ? String(transacaoEmCursoId) : null,
          transacao_id: transacaoEmCursoId,
          financialState: decisaoFinanceira.financialState,
          protocolState: decisaoFinanceira.state,
          retryAllowed: false,
          retryReason: decisaoFinanceira.retryReason
        };
        fecharLeaseTerminal(respInc, {
          transacaoId: transacaoEmCursoId,
          forcarInconclusivo: true
        });
        return anexarContextoRota(respInc);
      }
      
      // Erro genérico
      repository.registrarLog(null, 'ERRO_GENERICO', error.message, { error: error.message, stack: error.stack });
      await tefFailureNotificationService.notificarFalhaGenerica(error, {
        transactionId: transacaoEmCursoId,
        provider: provedorEmCurso,
        operation: dadosNormalizados.tipo
      });
      fecharLeaseTerminal({
        sucesso: false,
        status: tefContrato.STATUS.ERRO,
        codigo: 'ERRO_GENERICO'
      }, { transacaoId: transacaoEmCursoId, forcarInconclusivo: transacaoEmCursoId != null });
      return Promise.reject(error);
    } finally {
      if (mutexAdquirido) this._autorizacaoEmCurso = false;
      // Rede de segurança: lease aberto sem tratamento explícito
      if (leaseId && !leaseFechado) {
        if (transacaoEmCursoId != null) {
          fecharLeaseTerminal({
            sucesso: false,
            status: tefContrato.STATUS.PENDENTE,
            codigo: 'TEF_UNKNOWN',
            financialState: FINANCIAL_STATES.UNKNOWN
          }, { transacaoId: transacaoEmCursoId, forcarInconclusivo: true });
        } else {
          fecharLeaseTerminal({
            sucesso: false,
            status: tefContrato.STATUS.ERRO,
            codigo: 'LEASE_FINALIZER'
          });
        }
      }
    }
  }

  _definirPendencia(transacaoId, dados) {
    const id = String(transacaoId);
    const atual = this._pendencias.get(id) || {};
    this._pendencias.set(id, {
      transacaoId: id,
      provedor: dados.provedor ?? atual.provedor ?? null,
      operacao: dados.operacao ?? atual.operacao ?? null,
      estado: dados.estado,
      desde: atual.desde || dados.desde || new Date().toISOString(),
      origem: dados.origem || atual.origem || 'instancia-atual',
      financialState: dados.financialState ?? atual.financialState ?? FINANCIAL_STATES.UNKNOWN,
      codigo: dados.codigo ?? atual.codigo ?? null,
      resultadoTardio: dados.resultadoTardio ?? atual.resultadoTardio ?? null,
      reconciliacaoPersistenciaIncompleta: dados.reconciliacaoPersistenciaIncompleta
        ?? atual.reconciliacaoPersistenciaIncompleta
        ?? false,
      recuperacao: dados.recuperacao ?? atual.recuperacao ?? null
    });
  }

  /**
   * TEF-DESTAXA-51.05 — libera o slot `_emExecucao` após 99 sem concluir o ciclo.
   * Mantém `_continuidadeCrt` / pendência para POST /tef/continuar.
   * Sem isso, continuarAutorizacao retorna TEF_CONTINUIDADE_EM_EXECUCAO e TX_CONTINUE nunca sai.
   */
  _liberarSlotExecucaoParaContinuidade(transacaoId, meta = {}) {
    const id = String(transacaoId);
    this._emExecucao.delete(id);
    try {
      const {
        registrarEventoContinuidade,
        ESTADOS_CONTINUIDADE
      } = require('./destaxa/destaxaContinuidadeEstados');
      registrarEventoContinuidade('aguardando_pdv', {
        estado: ESTADOS_CONTINUIDADE.AGUARDANDO_RESPOSTA_OPERADOR,
        transactionId: id,
        tipoAcao: meta.tipoAcao || null,
        codigo: meta.codigo || null
      });
    } catch (_) { /* best-effort */ }
    try {
      repository.registrarLog(id, 'CONTINUIDADE_AGUARDANDO_PDV', 'Slot _emExecucao liberado para POST /tef/continuar', {
        requerContinuacao: true,
        tipoAcao: meta.tipoAcao || null
      });
    } catch (_) { /* best-effort */ }
  }

  /** Chamada ao adapter terminou dentro do prazo: pendente mantém a trava, desfecho final a remove. */
  _concluirExecucao(transacaoId, status, dados) {
    const id = String(transacaoId);
    this._emExecucao.delete(id);
    if (status === tefContrato.STATUS.PENDENTE) {
      this._definirPendencia(id, { ...dados, estado: ESTADOS_TRAVA_RESULTADO_TARDIO.RECONCILIACAO_PENDENTE });
    } else {
      this._pendencias.delete(id);
    }
  }

  _gravar(executar) {
    const escrita = new Promise((resolve, reject) => {
      let concluida = false;
      const pronto = (error, resultado) => {
        if (concluida) return;
        concluida = true;
        if (error) reject(error);
        else resolve(resultado);
      };
      try {
        const retorno = executar(pronto);
        if (retorno && typeof retorno.then === 'function') {
          retorno.then((resultado) => pronto(null, resultado), pronto);
        }
      } catch (error) {
        pronto(error);
      }
    });
    this._escritasPendentes.add(escrita);
    escrita.then(
      () => this._escritasPendentes.delete(escrita),
      () => this._escritasPendentes.delete(escrita)
    );
    return escrita;
  }

  async _aguardarEscritas() {
    while (this._escritasPendentes.size > 0) {
      await Promise.all([...this._escritasPendentes]);
    }
  }

  /**
   * Recuperação no startup (uma vez por instância; refeita se falhar).
   * Reconstrói a trava a partir das linhas `pendente` de tef_transacoes (TEF-14).
   * MRT-07: após pendências, aplica recuperação segura de leases (holds Destaxa)
   * sem aprovar/cancelar/repetir pagamento.
   */
  garantirRecuperacao() {
    if (!this._recuperacao) {
      this._recuperacao = this.recarregarPendencias()
        .then((trava) => {
          try {
            const recovery = obterTerminalRecoveryService();
            this._ultimaRecuperacaoTerminais = recovery.recuperarAposReinicio({
              pendenciasCompletas: this.listarTravasPendencias()
            });
          } catch (_) {
            this._ultimaRecuperacaoTerminais = null;
          }
          return trava;
        })
        .catch((error) => {
          this._recuperacao = null;
          throw error;
        });
    }
    return this._recuperacao;
  }

  /**
   * MRT-07 — snapshot readonly do monitor de terminais (agrega Registry/Allocator/pendências).
   */
  monitorarTerminaisTef(opcoes = {}) {
    return obterTerminalRecoveryService().monitorar({
      pendenciasCompletas: this.listarTravasPendencias(),
      ...opcoes
    });
  }

  obterRecuperacaoTerminais() {
    return this._ultimaRecuperacaoTerminais || null;
  }

  /**
   * Sincroniza o espelho em memória com o banco. Linha `pendente` criada por
   * processo ainda vivo (outra instância) ou com chamada em andamento nesta
   * instância → AGUARDANDO_RESULTADO_TARDIO (reconciliação recusada); demais →
   * RECONCILIACAO_PENDENTE (o processo que executava a chamada terminou).
   */
  async recarregarPendencias() {
    await this._aguardarEscritas();
    const linhas = await new Promise((resolve, reject) => {
      repository.listarTransacoesPendentes((err, rows) => (err ? reject(err) : resolve(rows || [])));
    });
    const idsComTentativaReconciliacao = await new Promise((resolve, reject) => {
      repository.listarIdsTransacoesComTentativaReconciliacao((err, ids) =>
        (err ? reject(err) : resolve(ids || [])));
    });
    const eventosReconciliacao = await new Promise((resolve, reject) => {
      repository.listarEvidenciasReconciliacao((err, rows) =>
        (err ? reject(err) : resolve(rows || [])));
    });
    const linhasFinalizadas = await new Promise((resolve, reject) => {
      repository.listarTransacoesFinalizadas((err, rows) =>
        (err ? reject(err) : resolve(rows || [])));
    });
    const linhasPendentesPorId = new Map(linhas.map((linha) => [String(linha.id), linha]));
    const linhasFinalizadasPorId = new Map(
      linhasFinalizadas.map((linha) => [String(linha.id), linha])
    );
    const idsComMarcadorTentativa = new Set(
      idsComTentativaReconciliacao.map((id) => String(id))
    );
    const idsCandidatosReconciliacao = new Set(
      idsComMarcadorTentativa
    );
    for (const linha of linhasFinalizadas) {
      if (linha.payload_retorno?.reconciliacao) {
        idsCandidatosReconciliacao.add(String(linha.id));
      }
    }
    for (const evento of eventosReconciliacao) {
      const payload = lerPayloadEvidencia(evento);
      const idsDoEvento = [
        evento.transacao_id,
        payload?.claims?.transacao_id,
        payload?.claims?.transactionId,
        payload?.transacao_id,
        payload?.transactionId
      ]
        .filter((id) => id != null && String(id).trim())
        .map((id) => String(id));
      if (idsDoEvento.length === 0) {
        const error = new Error(
          `Evidência de reconciliação ${evento.id} sem identidade legível`
        );
        error.code = 'TEF_RECONCILIACAO_EVIDENCIA_SEM_IDENTIDADE';
        throw error;
      }
      for (const id of idsDoEvento) idsCandidatosReconciliacao.add(id);
    }

    const reconciliacoesIncompletas = [];
    for (const id of idsCandidatosReconciliacao) {
      if (linhasPendentesPorId.has(String(id))) continue;
      const linha = linhasFinalizadasPorId.get(String(id))
        || await this._obterTransacaoPersistida(id);
      if (!linha) {
        if (!idsComMarcadorTentativa.has(String(id))) {
          reconciliacoesIncompletas.push({
            id: String(id),
            status: tefContrato.STATUS.PENDENTE,
            payload_retorno: {
              financialState: FINANCIAL_STATES.UNKNOWN,
              persistencia: {}
            },
            reconciliacaoPersistenciaIncompleta: true
          });
          continue;
        }
        const error = new Error(`Registro TEF ausente para candidata de reconciliação ${id}`);
        error.code = 'TEF_RECONCILIACAO_PERSISTENCIA_AUSENTE';
        throw error;
      }
      const reconciliacao = linha.payload_retorno?.reconciliacao;
      try {
        if (!reconciliacao
          || !STATUS_POR_RECONCILIACAO[reconciliacao.financialState]
          || linha.status !== STATUS_POR_RECONCILIACAO[reconciliacao.financialState]
          || clienteTemReconciliacaoPendente(this._nativeHostClient, id)) {
          throw new Error('Reconciliação sem desfecho persistido ou ainda pendente localmente');
        }
        validarRegistroReconciliacao(linha, {
          financialState: reconciliacao.financialState,
          usuario: String(reconciliacao.usuario || ''),
          observacao: String(reconciliacao.observacao || '')
        }, STATUS_POR_RECONCILIACAO[reconciliacao.financialState]);
        const identidade = identidadeTransacaoPersistida(linha);
        validarParEvidenciasReconciliacao(
          linha,
          reconciliacao,
          identidade,
          eventosReconciliacao
        );
      } catch (_) {
        reconciliacoesIncompletas.push({
          ...linha,
          reconciliacaoPersistenciaIncompleta: true
        });
      }
    }

    const abertas = new Set(linhas.map((linha) => String(linha.id)));
    for (const linha of reconciliacoesIncompletas) abertas.add(String(linha.id));
    for (const id of [...this._pendencias.keys()]) {
      if (!abertas.has(id) && !this._liberacoesBootstrapPendentes.has(id)) {
        this._pendencias.delete(id);
      }
    }

    for (const linha of [...linhas, ...reconciliacoesIncompletas]) {
      const id = String(linha.id);
      const payload = linha.payload_retorno || {};
      const execucao = payload.execucao || null;
      const propria = execucao?.instancia === this._instanciaId;
      const origemViva = Boolean(execucao && !propria && execucao.pid && processoVivo(execucao.pid));
      const emAndamento = (propria && this._emExecucao.has(id)) || origemViva;
      const conhecida = this._pendencias.get(id);

      if (conhecida
        && linha.reconciliacaoPersistenciaIncompleta !== true
        && !(conhecida.estado === ESTADOS_TRAVA_RESULTADO_TARDIO.AGUARDANDO_RESULTADO && !emAndamento && !propria)) {
        continue;
      }
      const identidadeRecuperada = projetarRecuperacaoIdentidade({
        ...linha,
        payload_retorno: payload
      });
      this._definirPendencia(id, {
        provedor: linha.provedor,
        operacao: linha.tipo,
        estado: emAndamento
          ? ESTADOS_TRAVA_RESULTADO_TARDIO.AGUARDANDO_RESULTADO
          : ESTADOS_TRAVA_RESULTADO_TARDIO.RECONCILIACAO_PENDENTE,
        desde: linha.criado_em,
        origem: propria ? 'instancia-atual' : 'persistida',
        financialState: payload.resultadoTardio?.financialState || payload.financialState || FINANCIAL_STATES.UNKNOWN,
        codigo: payload.resultadoTardio?.codigo || payload.codigoDestaxa || null,
        resultadoTardio: payload.resultadoTardio || null,
        reconciliacaoPersistenciaIncompleta: linha.reconciliacaoPersistenciaIncompleta === true,
        // MRT-27 — identidade recuperável após reinício (sem reenvio automático)
        recuperacao: linha.reconciliacaoPersistenciaIncompleta === true
          ? {
            transactionId: id,
            operation_id: linha.payload_retorno?.persistencia?.operation_id || linha.codigo_transacao || null,
            idempotency_key: linha.idempotency_key || linha.payload_retorno?.persistencia?.idempotency_key || null,
            fingerprint: linha.payload_retorno?.persistencia?.fingerprint || null,
            reconciliationIncomplete: true
          }
          : identidadeRecuperada
      });

      if (!propria && !this._idsRecuperadosRegistrados.has(id)) {
        this._idsRecuperadosRegistrados.add(id);
        const pendencia = this._pendencias.get(id);
        repository.registrarLog(linha.id, 'TEF_RESULTADO_PENDENTE_RECUPERADO', 'Transação TEF sem desfecho seguro recuperada do banco — nova autorização bloqueada', {
          transactionId: id,
          status: linha.status,
          estado: pendencia.estado,
          financialState: pendencia.financialState,
          resultCode: pendencia.codigo,
          provider: linha.provedor || null,
          criadoEm: linha.criado_em || null,
          execucaoOrigemAtiva: origemViva,
          retryAllowed: false
        });
      }
    }
    return this.obterTravaResultadoTardio();
  }

  _abrirTravaResultadoTardio(transacaoId, provedor, operacao) {
    this._definirPendencia(transacaoId, {
      provedor,
      operacao,
      estado: ESTADOS_TRAVA_RESULTADO_TARDIO.AGUARDANDO_RESULTADO,
      financialState: FINANCIAL_STATES.UNKNOWN,
      desde: new Date().toISOString()
    });
    repository.registrarLog(transacaoId, 'TRAVA_RESULTADO_TARDIO', 'Timeout operacional do CDS com chamada nativa em andamento — nova autorização bloqueada', {
      transactionId: String(transacaoId),
      provider: provedor || null,
      retryAllowed: false
    });
  }

  /** Pendência mais antiga (a que bloqueia) + ids de todas as pendências abertas. */
  obterTravaResultadoTardio() {
    const [primeira] = this._pendencias.values();
    if (!primeira) return null;
    return {
      ...primeira,
      resultadoTardio: primeira.resultadoTardio ? { ...primeira.resultadoTardio } : null,
      pendentes: [...this._pendencias.keys()]
    };
  }

  /**
   * TEF-14 — listagem readonly das travas em memória (espelho das pendentes).
   * Não altera estado e não aprova/libera nada.
   */
  listarTravasPendencias() {
    return [...this._pendencias.entries()].map(([id, trava]) => ({
      transacaoId: String(id),
      estado: trava.estado || null,
      provedor: trava.provedor || null,
      operacao: trava.operacao || null,
      financialState: trava.financialState || null,
      codigo: trava.codigo || null,
      resultadoTardio: trava.resultadoTardio ? { ...trava.resultadoTardio } : null
    }));
  }

  _respostaTravaResultadoTardio() {
    const trava = this.obterTravaResultadoTardio();
    let mensagem = 'Existe transação TEF pendente — nova autorização bloqueada';
    if (trava) {
      mensagem = trava.estado === ESTADOS_TRAVA_RESULTADO_TARDIO.AGUARDANDO_RESULTADO
        ? `Transação TEF ${trava.transacaoId} ainda em execução — nova autorização bloqueada`
        : `Transação TEF ${trava.transacaoId} aguarda reconciliação — nova autorização bloqueada`;
    }
    return {
      sucesso: false,
      status: tefContrato.STATUS.PENDENTE,
      codigo: 'TEF_RESULTADO_PENDENTE',
      mensagem,
      tipo_erro: 'conflito',
      transacaoId: null,
      transacao_pendente_id: trava ? trava.transacaoId : null,
      trava,
      retryAllowed: false,
      retryReason: 'TEF_LATE_RESULT_PENDING_NO_NEW_AUTHORIZATION'
    };
  }

  _respostaAutorizacaoEmCurso() {
    return {
      sucesso: false,
      status: tefContrato.STATUS.ERRO,
      codigo: 'TEF_AUTORIZACAO_EM_ANDAMENTO',
      mensagem: 'Outra autorização TEF está em andamento — nova autorização não enviada',
      tipo_erro: 'conflito',
      transacaoId: null,
      retryAllowed: false,
      retryReason: 'TEF_AUTHORIZATION_IN_PROGRESS_NO_NEW_AUTHORIZATION'
    };
  }

  _respostaSemRecuperacao(error) {
    return {
      sucesso: false,
      status: tefContrato.STATUS.ERRO,
      codigo: 'TEF_RECUPERACAO_PENDENCIAS_FALHOU',
      mensagem: `Não foi possível verificar transações TEF pendentes: ${error.message}`,
      tipo_erro: 'pre_condicao',
      transacaoId: null,
      retryAllowed: false,
      retryReason: 'TEF_PENDING_CHECK_FAILED_NO_NEW_AUTHORIZATION'
    };
  }

  /**
   * Desfecho de uma autorização que terminou depois do timeout operacional.
   * 03/04/09 tardio → negado e lock liberado; 00 tardio, 08, A0, A1, 99 ou erro
   * → linha permanece pendente e o lock só é liberado por reconciliarResultadoTardio.
   */
  async _obterTransacaoPersistida(transacaoId) {
    return new Promise((resolve, reject) => {
      repository.obterTransacaoPorId(transacaoId, (error, linha) => {
        if (error) return reject(error);
        resolve(linha || null);
      });
    });
  }

  async _atualizarTransacaoPersistida(transacaoId, dados, condicoes) {
    return this._gravar((pronto) => {
      repository.atualizarTransacao(
        transacaoId,
        dados,
        (error, resultado) => pronto(error, resultado),
        condicoes
      );
    });
  }

  async _registrarResultadoTardio(transacaoId, provedor, operacao, retornoBruto) {
    const decisao = decidirResultadoTardio(retornoBruto);
    const status = decisao.releaseLock ? tefContrato.STATUS.NEGADO : tefContrato.STATUS.PENDENTE;
    const retorno = tefContrato.criarRespostaAutorizacao({
      sucesso: false,
      status,
      nsu: retornoBruto.nsu,
      autorizacao: retornoBruto.autorizacao,
      cnpj_credenciadora: retornoBruto.cnpj_credenciadora,
      provedor,
      adquirente: retornoBruto.adquirente,
      bandeira: retornoBruto.bandeira,
      comprovanteCliente: retornoBruto.comprovanteCliente || retornoBruto.comprovante_cliente,
      comprovanteLoja: retornoBruto.comprovanteLoja || retornoBruto.comprovante_estabelecimento,
      transacaoId: String(transacaoId),
      codigo: retornoBruto.codigo,
      mensagem: retornoBruto.mensagem,
      payloadRetorno: retornoBruto.payloadRetorno || retornoBruto.payload_retorno,
      modo: retornoBruto.modo,
      financialState: decisao.financialState,
      protocolState: retornoBruto.estado || decisao.state,
      retryAllowed: false,
      retryReason: decisao.retryReason
    });
    const resultadoTardio = {
      codigo: decisao.resultCode || null,
      financialState: decisao.financialState,
      resolution: decisao.resolution,
      reconciliationRequired: decisao.reconciliationRequired,
      recebidoEm: new Date().toISOString()
    };
    const persistencia = tefContrato.paraPersistencia(retorno);
    const payloadPersistido = persistencia.payload_retorno;
    const id = String(transacaoId);
    this._emExecucao.delete(id);
    this._definirPendencia(id, {
      provedor,
      operacao,
      estado: ESTADOS_TRAVA_RESULTADO_TARDIO.RECONCILIACAO_PENDENTE,
      financialState: decisao.financialState,
      codigo: decisao.resultCode || null,
      resultadoTardio
    });

    // MRT-14 — ler payload atual e preservar identidadeAdapter antes do rewrite
    try {
      const linhaAnterior = await this._obterTransacaoPersistida(transacaoId);
      if (!linhaAnterior || linhaAnterior.status !== tefContrato.STATUS.PENDENTE) {
        const error = new Error('Transação pendente ausente ou alterada antes da gravação do resultado tardio');
        error.code = 'TEF_RESULTADO_TARDIO_PERSISTENCIA_DIVERGENTE';
        throw error;
      }
      const identidadeAnterior = identidadeTransacaoPersistida(linhaAnterior);
      const anterior = lerPayloadTransacao(linhaAnterior);
      const payloadNovo = mesclarPayloadPreservandoIdentidade(
        {
          ...(payloadPersistido && typeof payloadPersistido === 'object'
            ? payloadPersistido
            : { resposta: payloadPersistido }),
          resultadoTardio
        },
        anterior
      );
      await this._atualizarTransacaoPersistida(transacaoId, {
        ...persistencia,
        payload_retorno: payloadNovo
      }, {
        statusEsperado: tefContrato.STATUS.PENDENTE,
        payloadEsperado: linhaAnterior.payload_retorno_criptografado,
        exigirUmaLinha: true
      });
      const linhaGravada = await this._obterTransacaoPersistida(transacaoId);
      const identidadeGravada = identidadeTransacaoPersistida(linhaGravada);
      if (!linhaGravada
        || linhaGravada.status !== status
        || JSON.stringify(identidadeGravada) !== JSON.stringify(identidadeAnterior)
        || linhaGravada.payload_retorno?.resultadoTardio?.financialState !== decisao.financialState
        || String(linhaGravada.payload_retorno?.resultadoTardio?.codigo || '')
          !== String(resultadoTardio.codigo || '')) {
        const error = new Error('Resultado tardio não foi confirmado pela leitura integral do registro TEF');
        error.code = 'TEF_RESULTADO_TARDIO_PERSISTENCIA_DIVERGENTE';
        throw error;
      }
    } catch (error) {
      repository.registrarLog(transacaoId, 'ERRO_RESULTADO_TARDIO', error.message, { error: error.message });
      throw error;
    }

    repository.registrarLog(transacaoId, 'RESULTADO_TARDIO', retorno.mensagem, {
      ...montarLogDecisao({ transactionId: transacaoId, provider: provedor, operation: operacao, decision: decisao }),
      resolution: decisao.resolution,
      reconciliationRequired: decisao.reconciliationRequired
    });

    if (decisao.releaseLock) {
      this._pendencias.delete(id);
    }
    return decisao;
  }

  /**
   * Reconciliação explícita (operador) de transação com resultado tardio.
   * Só depois do desfecho da chamada nativa; nunca envia nova autorização.
   * @param {{financialState: 'CONFIRMED_SUCCESS'|'CONFIRMED_DENIED'|'CANCELLED', usuario: string, observacao: string}} dados
   */
  async reconciliarResultadoTardio(transacaoId, dados = {}) {
    this._exigirConfiguracaoCriptografica();
    const id = String(transacaoId);
    const trava = this._pendencias.get(id);
    const falhar = (code, message) => {
      const error = new Error(message);
      error.code = code;
      throw error;
    };
    if (!trava) {
      falhar('TEF_RECONCILIACAO_SEM_TRAVA', `Transação ${transacaoId} não possui resultado tardio pendente`);
    }
    if (trava.estado !== ESTADOS_TRAVA_RESULTADO_TARDIO.RECONCILIACAO_PENDENTE) {
      falhar('TEF_RECONCILIACAO_PREMATURA', `Transação ${transacaoId} ainda em execução no TEF — reconciliação somente após o desfecho`);
    }
    const status = STATUS_POR_RECONCILIACAO[dados.financialState];
    if (!status) {
      falhar('TEF_RECONCILIACAO_INVALIDA', `Estado de reconciliação inválido: ${dados.financialState}`);
    }
    if (!String(dados.usuario || '').trim() || !String(dados.observacao || '').trim()) {
      falhar('TEF_RECONCILIACAO_INVALIDA', 'Reconciliação exige usuário e observação');
    }
    if (dados.confirmacao_explicita !== true) {
      falhar('TEF_RECONCILIACAO_SEM_CONFIRMACAO', 'Reconciliação exige confirmação explícita');
    }

    const linhaAnterior = await this._obterTransacaoPersistida(transacaoId);
    if (!linhaAnterior) falhar('TEF_RECONCILIACAO_SEM_TRAVA', `Transação ${transacaoId} não existe na persistência`);
    const identidade = identidadeTransacaoPersistida(linhaAnterior);
    const reconciliacaoAnterior = linhaAnterior.payload_retorno?.reconciliacao;
    if (reconciliacaoAnterior) {
      const dadosPersistidos = {
        financialState: reconciliacaoAnterior.financialState,
        usuario: reconciliacaoAnterior.usuario,
        observacao: reconciliacaoAnterior.observacao
      };
      if (dadosPersistidos.financialState !== dados.financialState
        || dadosPersistidos.usuario !== String(dados.usuario)
        || dadosPersistidos.observacao !== String(dados.observacao)) {
        falhar('TEF_RECONCILIACAO_CONCORRENTE', 'Outra reconciliação já foi persistida para esta identidade');
      }
      validarRegistroReconciliacao(linhaAnterior, dadosPersistidos, linhaAnterior.status);
      if (![tefContrato.STATUS.PENDENTE, status].includes(linhaAnterior.status)) {
        falhar('TEF_RECONCILIACAO_STATUS_DIVERGENTE', 'Status persistido incompatível com a reconciliação solicitada');
      }
      await registrarLogPersistido(
        transacaoId,
        'RECONCILIACAO_RESULTADO_TARDIO',
        `Reconciliação como ${dados.financialState}`,
        {
          transactionId: identidade.transactionId,
          operation_id: identidade.operation_id,
          idempotency_key: identidade.idempotency_key,
          fingerprint: identidade.fingerprint,
          financialState: dados.financialState,
          usuario: String(dados.usuario),
          retryAllowed: false
        }
      );
      trava.reconciliacao = reconciliacaoAnterior;
      return {
        transacaoId: id,
        status,
        financialState: dados.financialState,
        travaLiberada: false,
        persistenciaValidada: true,
        identidade
      };
    }

    if (linhaAnterior.status !== tefContrato.STATUS.PENDENTE) {
      falhar('TEF_RECONCILIACAO_STATUS_DIVERGENTE', 'A transação não está pendente na persistência');
    }
    const reconciliacao = {
      transactionId: identidade.transactionId,
      operation_id: identidade.operation_id,
      idempotency_key: identidade.idempotency_key,
      fingerprint: identidade.fingerprint,
      financialState: dados.financialState,
      resultStatus: status,
      usuario: String(dados.usuario),
      observacao: String(dados.observacao),
      confirmacao_explicita: true,
      em: new Date().toISOString()
    };
    const payloadNovo = mesclarPayloadPreservandoIdentidade({
      reconciliacao
    }, lerPayloadTransacao(linhaAnterior));
    await this._atualizarTransacaoPersistida(transacaoId, {
      status: tefContrato.STATUS.PENDENTE,
      payload_retorno: payloadNovo
    }, {
      statusEsperado: tefContrato.STATUS.PENDENTE,
      payloadEsperado: linhaAnterior.payload_retorno_criptografado,
      exigirUmaLinha: true
    });
    const linhaGravada = await this._obterTransacaoPersistida(transacaoId);
    const validado = validarRegistroReconciliacao(
      linhaGravada,
      { financialState: dados.financialState, usuario: String(dados.usuario), observacao: String(dados.observacao) },
      tefContrato.STATUS.PENDENTE
    );
    trava.reconciliacao = validado.reconciliacao;
    await registrarLogPersistido(
      transacaoId,
      'RECONCILIACAO_RESULTADO_TARDIO',
      `Reconciliado como ${dados.financialState}`,
      {
        transactionId: identidade.transactionId,
        operation_id: identidade.operation_id,
        idempotency_key: identidade.idempotency_key,
        fingerprint: identidade.fingerprint,
        financialState: dados.financialState,
        resultadoTardio: trava.resultadoTardio,
        usuario: String(dados.usuario),
        retryAllowed: false
      }
    );
    return {
      transacaoId: id,
      status,
      financialState: dados.financialState,
      travaLiberada: false,
      persistenciaValidada: true,
      identidade: validado.identidade
    };
  }

  async reconciliarNativeHost(transacaoId, dados = {}, resultado = {}) {
    this._exigirConfiguracaoCriptografica();
    await this._aguardarEscritas();
    const id = String(transacaoId);
    const statusFinal = STATUS_POR_RECONCILIACAO[dados.financialState];
    if (!statusFinal
      || resultado.transacaoId !== id
      || resultado.status !== statusFinal
      || resultado.financialState !== dados.financialState
      || resultado.travaLiberada !== false) {
      const error = new Error('Dados da reconciliação não correspondem ao resultado validado pelo TefManager');
      error.code = 'TEF_RECONCILIACAO_RESULTADO_INVALIDO';
      throw error;
    }
    if (!this._pendencias.has(id)) {
      const error = new Error('Trava financeira ausente; reconciliação NativeHost recusada');
      error.code = 'TEF_RECONCILIACAO_SEM_TRAVA';
      throw error;
    }
    this._liberacoesBootstrapPendentes.add(id);

    const cliente = this._nativeHostClient;
    const linha = await this._obterTransacaoPersistida(transacaoId);
    if (linha?.status === statusFinal) {
      const registroFinal = validarRegistroReconciliacao(
        linha,
        { financialState: dados.financialState, usuario: String(dados.usuario), observacao: String(dados.observacao) },
        statusFinal
      );
      const eventosReconciliacao = await new Promise((resolve, reject) => {
        repository.listarEvidenciasReconciliacao((error, rows) =>
          (error ? reject(error) : resolve(rows || [])));
      });
      validarParEvidenciasReconciliacao(
        linha,
        registroFinal.reconciliacao,
        registroFinal.identidade,
        eventosReconciliacao
      );
      await this.recarregarPendencias();
      const travaAtual = this._pendencias.get(id);
      if (travaAtual?.reconciliacaoPersistenciaIncompleta === true) {
        const error = new Error('Evidência persistida não permite concluir o bootstrap de segurança');
        error.code = 'TEF_RECONCILIACAO_PERSISTENCIA_DIVERGENTE';
        throw error;
      }
      const bootstrapAtualizado = await cliente.atualizarBootstrapSeguranca();
      if (!bootstrapAtualizado?.sucesso) {
        const error = new Error(bootstrapAtualizado?.mensagem || 'NativeHost não confirmou o bootstrap pós-persistência');
        error.code = bootstrapAtualizado?.codigo || 'TEF_NATIVE_HOST_BOOTSTRAP_FALHOU';
        throw error;
      }
      this._liberacoesBootstrapPendentes.delete(id);
      this._pendencias.delete(id);
      return {
        ...resultado,
        persistenciaValidada: true,
        travaLiberada: true
      };
    }

    const registroValidado = validarRegistroReconciliacao(
      linha,
      { financialState: dados.financialState, usuario: String(dados.usuario), observacao: String(dados.observacao) },
      tefContrato.STATUS.PENDENTE
    );
    cliente.marcarReconciliacaoPendente(id);
    const hostPreparado = await cliente.prepararHostParaReconciliacao(id);
    if (!hostPreparado?.sucesso || !hostPreparado.hostSessionId) {
      const error = new Error('NativeHost indisponível; trava financeira permanece ativa');
      error.code = hostPreparado?.codigo || 'TEF_NATIVE_HOST_INDISPONIVEL';
      throw error;
    }

    const autorizacaoRelease = assinarAutorizacaoReconciliacao(
      linha,
      registroValidado,
      hostPreparado.hostSessionId,
      'release'
    );
    const liberacao = await cliente.reconciliarTransacao(id, autorizacaoRelease);
    if (!liberacao?.sucesso || String(liberacao.transactionId || '') !== id) {
      const error = new Error(liberacao?.mensagem || 'NativeHost não confirmou a liberação autorizada');
      error.code = liberacao?.codigo || 'TEF_NATIVE_HOST_RECONCILIACAO_FALHOU';
      throw error;
    }

    await this._atualizarTransacaoPersistida(transacaoId, {
      status: statusFinal,
      payload_retorno: linha.payload_retorno
    }, {
      statusEsperado: tefContrato.STATUS.PENDENTE,
      payloadEsperado: linha.payload_retorno_criptografado,
      exigirUmaLinha: true
    });
    const linhaFinal = await this._obterTransacaoPersistida(transacaoId);
    const registroFinal = validarRegistroReconciliacao(
      linhaFinal,
      { financialState: dados.financialState, usuario: String(dados.usuario), observacao: String(dados.observacao) },
      statusFinal
    );
    const claimsLiberacao = criarClaimsEvidencia({
      eventType: EVENTO_LIBERACAO,
      identidade: registroFinal.identidade,
      financialState: dados.financialState,
      resultStatus: statusFinal,
      usuario: String(dados.usuario)
    });
    const evidenciaLiberacao = assinarEvidencia(claimsLiberacao);
    await registrarLogPersistido(
      transacaoId,
      EVENTO_LIBERACAO,
      'Evidência assinada de RELEASE persistido; COMMIT pendente',
      evidenciaLiberacao
    );

    const autorizacaoCommit = assinarAutorizacaoReconciliacao(
      linhaFinal,
      registroFinal,
      hostPreparado.hostSessionId,
      'commit'
    );
    const confirmado = cliente.confirmarReconciliacaoPersistida(autorizacaoCommit);
    if (!confirmado?.sucesso || String(confirmado.transactionId || '') !== id) {
      const error = new Error('Persistência final confirmada, mas o marcador local não foi liberado');
      error.code = confirmado?.codigo || 'TEF_NATIVE_HOST_COMMIT_FALHOU';
      throw error;
    }
    const claimsCommit = criarClaimsEvidencia({
      eventType: EVENTO_COMMIT,
      identidade: registroFinal.identidade,
      financialState: dados.financialState,
      resultStatus: statusFinal,
      usuario: String(dados.usuario),
      releaseEvidenceId: claimsLiberacao.evidenceId,
      releaseTimestamp: claimsLiberacao.timestamp
    });
    const evidenciaCommit = assinarEvidencia(claimsCommit);
    await registrarLogPersistido(
      transacaoId,
      EVENTO_COMMIT,
      'Evidência assinada de COMMIT confirmado',
      evidenciaCommit
    );

    const bootstrapAtualizado = await cliente.atualizarBootstrapSeguranca();
    if (!bootstrapAtualizado?.sucesso) {
      const error = new Error(bootstrapAtualizado?.mensagem || 'NativeHost não confirmou o bootstrap pós-persistência');
      error.code = bootstrapAtualizado?.codigo || 'TEF_NATIVE_HOST_BOOTSTRAP_FALHOU';
      throw error;
    }

    this._liberacoesBootstrapPendentes.delete(id);
    this._pendencias.delete(id);
    return {
      ...liberacao,
      persistenciaValidada: true,
      travaLiberada: true
    };
  }

  async _verificarIdempotencia(idempotencyKey) {
    return new Promise((resolve, reject) => {
      const db = require('../../database');

      db.get(`
        SELECT id, status, criado_em
        FROM tef_transacoes
        WHERE idempotency_key = ?
        ORDER BY criado_em DESC
        LIMIT 1
      `, [idempotencyKey], (err, row) => {
        if (err) return reject(err);
        resolve(row || null);
      });
    });
  }

  async _buscarPorIdempotencyKey(idempotencyKey) {
    return new Promise((resolve, reject) => {
      const db = require('../../database');

      db.get(`
        SELECT id, status, criado_em
        FROM tef_transacoes
        WHERE idempotency_key = ?
      `, [idempotencyKey], (err, row) => {
        if (err) return reject(err);
        resolve(row || null);
      });
    });
  }

  async _buscarTransacaoCompleta(transacaoId) {
    return new Promise((resolve, reject) => {
      const db = require('../../database');
      db.get('SELECT * FROM tef_transacoes WHERE id = ?', [transacaoId], (err, row) => {
        if (err) return reject(err);
        // MRT-14 — hidratar payload criptografado para o ciclo pós-reinício
        resolve(hidratarTransacaoParaCiclo(row));
      });
    });
  }

  /**
   * MRT-22 — Continuidade CRT (COLETA/OPCAO). Mesma transação e idempotency_key.
   * Não chama TX_START. Não cria nova cobrança.
   */
  async continuarAutorizacao(dados = {}) {
    if (!this._configuracaoCriptografica.disponivel) {
      return this._resultadoCriptografiaIndisponivel();
    }
    const transacaoId = dados.transacao_id || dados.transacaoId;
    if (transacaoId == null || String(transacaoId).trim() === '') {
      return {
        sucesso: false,
        codigo: 'TEF_CONTINUIDADE_SEM_TRANSACAO',
        mensagem: 'transacao_id obrigatório para continuidade CRT',
        retryAllowed: false
      };
    }

    const db = require('../../database');
    const transacao = await new Promise((resolve, reject) => {
      db.get('SELECT * FROM tef_transacoes WHERE id = ?', [transacaoId], (err, row) => {
        if (err) reject(err);
        else resolve(row || null);
      });
    });

    if (!transacao) {
      return {
        sucesso: false,
        codigo: 'TEF_TRANSACAO_NAO_ENCONTRADA',
        mensagem: 'Transação TEF não encontrada para continuidade',
        retryAllowed: false
      };
    }

    if (String(transacao.status || '').toLowerCase() !== tefContrato.STATUS.PENDENTE
      && String(transacao.status || '').toLowerCase() !== 'pendente') {
      return {
        sucesso: false,
        codigo: 'TEF_CONTINUIDADE_STATUS_INVALIDO',
        mensagem: `Continuidade só para status pendente; atual=${transacao.status}`,
        retryAllowed: false,
        status: transacao.status
      };
    }

    if (dados.idempotency_key && transacao.idempotency_key
      && String(dados.idempotency_key) !== String(transacao.idempotency_key)) {
      return {
        sucesso: false,
        codigo: 'TEF_IDEMPOTENCY_DIVERGENTE',
        mensagem: 'idempotency_key diverge da transação em continuidade — nova chave/cobrança proibida',
        retryAllowed: false
      };
    }

    if (this._continuidadeCrt
      && String(this._continuidadeCrt.transacaoId) !== String(transacaoId)) {
      return {
        sucesso: false,
        codigo: 'TEF_CRT_CONTINUIDADE_ATIVA',
        mensagem: `Outra continuidade CRT ativa (${this._continuidadeCrt.transacaoId})`,
        retryAllowed: false,
        requerContinuacao: true
      };
    }

    const validacaoHost = this._validarSessaoNativeHostContinuidade(this._continuidadeCrt?.sessaoHost);
    if (!validacaoHost.ok) {
      return {
        sucesso: false,
        status: tefContrato.STATUS.PENDENTE,
        codigo: validacaoHost.codigo,
        mensagem: validacaoHost.mensagem,
        retryAllowed: false,
        inconclusivo: true,
        reconciliacaoObrigatoria: true,
        transacao_id: Number(transacaoId) || transacaoId,
        transacaoId: String(transacaoId),
        idempotency_key: dados.idempotency_key || transacao.idempotency_key || null
      };
    }

    try {
      // MRT-23 — recria o wrapper adapter, mas força o mesmo DestaxaNativeHostClient
      // compartilhado (sessão nativa vive no processo host, não no objeto adapter).
      const { obterClienteCompartilhado } = require('./destaxa/DestaxaNativeHostClient');
      const cicloAdapter = await obterAdapterDaTransacao(transacao, {
        adapterOpcoes: {
          executionMode: 'native-host',
          hostClient: obterClienteCompartilhado()
        }
      });
      const adapter = cicloAdapter.adapter;
      if (typeof adapter.continuarPagamento !== 'function') {
        return {
          sucesso: false,
          codigo: 'TEF_CONTINUIDADE_NAO_SUPORTADA',
          mensagem: `Adapter ${adapter.nome || '?'} não implementa continuarPagamento`,
          retryAllowed: false
        };
      }

      repository.registrarLog(transacaoId, 'CICLO_CRT_CONTINUE', 'Continuidade CRT PDV', {
        idempotency_key: dados.idempotency_key || transacao.idempotency_key || null,
        venda_id: dados.venda_id != null ? dados.venda_id : transacao.venda_id,
        temResposta: dados.resposta_continuidade != null || dados.resposta != null
      });

      // MRT-39.1 — enriquecer continuidade a partir do payload persistido (99/OPCAO)
      const payloadAnterior = lerPayloadTransacao(transacao);
      const contPersistida = payloadAnterior.continuidade
        && typeof payloadAnterior.continuidade === 'object'
        ? payloadAnterior.continuidade
        : {};
      const sol99 = contPersistida.solicitacao99 && typeof contPersistida.solicitacao99 === 'object'
        ? contPersistida.solicitacao99
        : {};
      const {
        normalizarAcaoContinuidade,
        normalizarTimestampSolicitacao99
      } = require('./destaxa/destaxaContinuidadeContrato');
      const solicitadaEmPersistida = normalizarTimestampSolicitacao99(sol99.solicitadaEm);
      const solicitadaEmInformada = normalizarTimestampSolicitacao99(dados.solicitadaEm);
      if (!solicitadaEmPersistida
        || !solicitadaEmInformada
        || solicitadaEmInformada !== solicitadaEmPersistida) {
        return {
          sucesso: false,
          status: tefContrato.STATUS.PENDENTE,
          codigo: 'DESTAXA_CONTINUIDADE_IDENTIDADE_DIVERGENTE',
          mensagem: 'Continuidade recusada: timestamp original ausente ou divergente da solicitação 99 persistida',
          retryAllowed: false,
          inconclusivo: true,
          financialState: 'UNKNOWN',
          reconciliacaoObrigatoria: true,
          transactionAttempted: false,
          transacao_id: Number(transacaoId) || transacaoId,
          transacaoId: String(transacaoId)
        };
      }
      if (dados.acao
        && JSON.stringify(normalizarAcaoContinuidade(dados.acao))
          !== JSON.stringify(normalizarAcaoContinuidade(sol99.acao || contPersistida.acao))) {
        return {
          sucesso: false,
          status: tefContrato.STATUS.PENDENTE,
          codigo: 'DESTAXA_CONTINUIDADE_IDENTIDADE_DIVERGENTE',
          mensagem: 'Continuidade recusada: ação diverge da solicitação 99 persistida',
          retryAllowed: false,
          inconclusivo: true,
          financialState: 'UNKNOWN',
          reconciliacaoObrigatoria: true,
          transactionAttempted: false,
          transacao_id: Number(transacaoId) || transacaoId,
          transacaoId: String(transacaoId)
        };
      }
      if (this._emExecucao.has(String(transacaoId))) {
        return {
          sucesso: false,
          status: tefContrato.STATUS.PENDENTE,
          codigo: 'TEF_CONTINUIDADE_EM_EXECUCAO',
          mensagem: 'A transação já possui uma operação TEF em execução',
          retryAllowed: false,
          transactionAttempted: false,
          transacao_id: Number(transacaoId) || transacaoId
        };
      }
      this._emExecucao.add(String(transacaoId));
      let retornoBruto;
      try {
        retornoBruto = await this._nativeHostIntent.run({
          transactionId: String(transacaoId),
          allowedOperations: ['TX_CONTINUE', 'TX_FINALIZE']
        }, () => adapter.continuarPagamento({
          ...dados,
          transacao_id: Number(transacaoId) || transacaoId,
          venda_id: dados.venda_id != null ? dados.venda_id : transacao.venda_id,
          acao: dados.acao || sol99.acao || contPersistida.acao || null,
          solicitadaEm: solicitadaEmInformada,
          idempotency_key: dados.idempotency_key || transacao.idempotency_key || null,
          idempotency_key_persistida: transacao.idempotency_key || null,
          exigirRespostaPersistida: contPersistida.estado === 'RESPONDIDA',
          identidadePersistida: {
            transactionId: String(transacao.id),
            operation_id: payloadAnterior.persistencia?.operation_id
              || transacao.codigo_transacao
              || null,
            idempotency_key: transacao.idempotency_key
              || payloadAnterior.persistencia?.idempotency_key
              || null,
            fingerprint: payloadAnterior.persistencia?.fingerprint || null
          }
        }));
      } finally {
        this._emExecucao.delete(String(transacaoId));
      }

      const decisaoFinanceira = classificarResultadoFinanceiro(retornoBruto);
      const retorno = tefContrato.criarRespostaAutorizacao({
        sucesso: retornoBruto.sucesso,
        status: retornoBruto.status,
        nsu: retornoBruto.nsu,
        autorizacao: retornoBruto.autorizacao,
        cnpj_credenciadora: retornoBruto.cnpj_credenciadora,
        provedor: adapter.nome,
        adquirente: retornoBruto.adquirente,
        bandeira: retornoBruto.bandeira,
        comprovanteCliente: retornoBruto.comprovanteCliente || retornoBruto.comprovante_cliente,
        comprovanteLoja: retornoBruto.comprovanteLoja || retornoBruto.comprovante_estabelecimento,
        transacaoId: String(transacaoId),
        codigo: retornoBruto.codigo,
        mensagem: retornoBruto.mensagem,
        payloadRetorno: retornoBruto.payloadRetorno || retornoBruto.payload_retorno,
        modo: retornoBruto.modo,
        financialState: retornoBruto.financialState || decisaoFinanceira.financialState,
        protocolState: retornoBruto.estado || decisaoFinanceira.state,
        retryAllowed: false,
        retryReason: retornoBruto.retryReason || decisaoFinanceira.retryReason
      });

      const persistencia = tefContrato.paraPersistencia(retorno);
      const identidadeAuth = montarIdentidadeAdapterPersistencia(
        {
          provedor: cicloAdapter.provedor,
          registro: cicloAdapter.registro,
          terminalTefId: cicloAdapter.terminalTefId,
          ambiente: cicloAdapter.ambiente,
          fonte: cicloAdapter.fonte
        },
        adapter
      );
      // MRT-39.1 — releitura pós-adapter: DestaxaRealAdapter grava respostas em
      // payload_retorno.continuidade; não sobrescrever o bloco durável.
      const linhaAposAdapter = await new Promise((resolve, reject) => {
        db.get('SELECT * FROM tef_transacoes WHERE id = ?', [transacaoId], (err, row) => {
          if (err) reject(err);
          else resolve(row || null);
        });
      });
      const payloadAposAdapter = lerPayloadTransacao(linhaAposAdapter || transacao);
      const continuidadeBase = payloadAposAdapter.continuidade
        && typeof payloadAposAdapter.continuidade === 'object'
        ? payloadAposAdapter.continuidade
        : contPersistida;
      const payloadComIdentidade = mesclarPayloadPreservandoIdentidade(
        {
          ...(persistencia.payload_retorno && typeof persistencia.payload_retorno === 'object'
            ? persistencia.payload_retorno
            : { resposta: persistencia.payload_retorno }),
          financialState: retorno.financialState,
          cicloCrt: retornoBruto.cicloCrt || null,
          vinculoVendaPdv: retornoBruto.vinculoVendaPdv || null,
          continuidade: {
            ...continuidadeBase,
            requerContinuacao: retornoBruto.requerContinuacao === true,
            acao: retornoBruto.acao || continuidadeBase.acao || null,
            solicitadaEm: retornoBruto.requerContinuacao === true
              ? retornoBruto.solicitadaEm || null
              : continuidadeBase.solicitadaEm || null
          },
          reconciliacaoObrigatoria: retornoBruto.reconciliacaoObrigatoria === true
        },
        { ...payloadAnterior, ...payloadAposAdapter },
        identidadeAuth
      );

      await new Promise((resolve, reject) => {
        repository.atualizarTransacao(transacaoId, {
          venda_id: transacao.venda_id || dados.venda_id || null,
          ...persistencia,
          payload_retorno: payloadComIdentidade
        }, (err) => (err ? reject(err) : resolve()));
      });

      if (retornoBruto.requerContinuacao === true) {
        await this._persistirSolicitacao99(transacaoId, retornoBruto, {
          idempotency_key: dados.idempotency_key || transacao.idempotency_key,
          venda_id: dados.venda_id != null ? dados.venda_id : transacao.venda_id
        });
      }

      if (retornoBruto.requerContinuacao !== true) {
        this._limparContinuidadeCrt(transacaoId);
      }

      if (retornoBruto.inconclusivo === true) {
        this._concluirExecucao(transacaoId, tefContrato.STATUS.PENDENTE, {
          provedor: adapter.nome,
          operacao: 'CRT_CONTINUE',
          financialState: FINANCIAL_STATES.UNKNOWN,
          codigo: retorno.codigo
        });
      } else if (!retornoBruto.requerContinuacao) {
        this._concluirExecucao(transacaoId, retorno.status, {
          provedor: adapter.nome,
          operacao: 'CRT_CONTINUE',
          financialState: retorno.financialState,
          codigo: retorno.codigo
        });
      }

      const api = tefContrato.paraRespostaApi(retorno, transacaoId);
      return {
        ...api,
        requerContinuacao: retornoBruto.requerContinuacao === true,
        acao: retornoBruto.acao || null,
        solicitadaEm: retornoBruto.solicitadaEm || null,
        inconclusivo: retornoBruto.inconclusivo === true,
        reconciliacaoObrigatoria: retornoBruto.reconciliacaoObrigatoria === true,
        cicloCrt: retornoBruto.cicloCrt || null,
        vinculoVendaPdv: retornoBruto.vinculoVendaPdv || null,
        idempotency_key: dados.idempotency_key || transacao.idempotency_key || null,
        retryAllowed: false
      };
    } catch (error) {
      repository.registrarLog(transacaoId, 'CICLO_CRT_CONTINUE_ERRO', error.message, {
        codigo: error.codigo || error.code || null
      });
      return {
        sucesso: false,
        status: tefContrato.STATUS.PENDENTE,
        codigo: error.codigo || error.code || 'TEF_CONTINUIDADE_ERRO',
        mensagem: error.message,
        retryAllowed: false,
        transacao_id: Number(transacaoId) || transacaoId,
        transacaoId: String(transacaoId)
      };
    }
  }

  async cancelar(transacaoId, motivo = 'Cancelamento da venda') {
    if (!this._configuracaoCriptografica.disponivel) {
      return this._resultadoCriptografiaIndisponivel();
    }
    return new Promise((resolve, reject) => {
      const db = require('../../database');

      db.get(`
        SELECT *
        FROM tef_transacoes
        WHERE id = ?
      `, [transacaoId], async (err, transacao) => {
        if (err) return reject(err);

        if (!transacao) {
          return reject(new Error('Transação TEF não encontrada.'));
        }

        if (transacao.status === 'cancelado') {
          return resolve({
            cancelado: true,
            status: 'cancelado',
            mensagem: 'Transação TEF já estava cancelada.',
            transacao_id: transacaoId
          });
        }

        repository.registrarLog(transacaoId, 'CANCELAMENTO_INICIO', 'Cancelamento TEF iniciado', {
          transacaoId,
          motivo
        });

        try {
          // MRT-13 — cancelamento no provedor original da transação (não LIMIT 1 cego)
          const ciclo = await obterAdapterDaTransacao(transacao);
          const adapter = ciclo.adapter;
          const retornoBruto = await adapter.cancelarPagamento({
            transacao_id: transacaoId,
            nsu: transacao.nsu,
            autorizacao: transacao.autorizacao,
            motivo
          });

          const retorno = tefContrato.criarRespostaCancelamento({
            sucesso: retornoBruto.sucesso,
            status: retornoBruto.status,
            nsu: retornoBruto.nsu != null ? retornoBruto.nsu : transacao.nsu,
            autorizacao: retornoBruto.autorizacao != null ? retornoBruto.autorizacao : transacao.autorizacao,
            transacaoId: String(transacaoId),
            codigo: retornoBruto.codigo,
            mensagem: retornoBruto.mensagem,
            payloadRetorno: retornoBruto.payloadRetorno || retornoBruto.payload_retorno,
            modo: retornoBruto.modo,
            cancelConfirmed: retornoBruto.cancelConfirmed,
            cancelOutcome: retornoBruto.cancelOutcome,
            financialState: retornoBruto.financialState
          });

          const confirmado = tefContrato.cancelamentoConfirmado(retorno);

          // TEF-17: sem confirmação do provedor, status financeiro original permanece.
          if (!confirmado) {
            repository.registrarLog(
              transacaoId,
              'CANCELAMENTO_NAO_CONFIRMADO',
              retorno.mensagem || 'Cancelamento TEF não confirmado pelo provedor',
              {
                ...retorno,
                statusAnterior: transacao.status,
                financialState: 'UNCHANGED'
              }
            );

            return resolve(tefContrato.paraRespostaApi({
              ...retorno,
              sucesso: false,
              status: transacao.status,
              cancelConfirmed: false,
              financialState: 'UNCHANGED'
            }, transacaoId));
          }

          // MRT-14 — cancelamento preserva identidadeAdapter via merge + repository
          // (repassa NSU/autorização para não zerar colunas no UPDATE do repository)
          const payloadCancel = mesclarPayloadPreservandoIdentidade(
            {
              cancelamento: retorno,
              financialState: 'CANCELLED'
            },
            lerPayloadTransacao(transacao)
          );
          repository.atualizarTransacao(transacaoId, {
            status: tefContrato.STATUS.CANCELADO,
            adquirente: transacao.adquirente || null,
            bandeira: transacao.bandeira || null,
            nsu: transacao.nsu || null,
            autorizacao: transacao.autorizacao || null,
            codigo_transacao: transacao.codigo_transacao || null,
            payload_retorno: payloadCancel
          }, (updateErr) => {
            if (updateErr) return reject(updateErr);

            repository.registrarLog(transacaoId, 'CANCELAMENTO_RETORNO', retorno.mensagem, retorno);

            resolve(tefContrato.paraRespostaApi({
              ...retorno,
              status: tefContrato.STATUS.CANCELADO,
              sucesso: true,
              cancelConfirmed: true,
              financialState: 'CANCELLED'
            }, transacaoId));
          });

        } catch (error) {
          repository.registrarLog(transacaoId, 'CANCELAMENTO_ERRO', error.message, {
            error: error.message
          });

          reject(error);
        }
      });
    });
  }

  async consultar(transacaoId) {
    try {
      const transacao = await this._buscarTransacaoCompleta(transacaoId);
      if (!transacao) {
        const error = new Error('Transação TEF não encontrada.');
        error.codigo = 'TEF_TRANSACAO_NAO_ENCONTRADA';
        throw error;
      }
      // MRT-13 — consulta no provedor original da transação
      const ciclo = await obterAdapterDaTransacao(transacao);
      return await ciclo.adapter.consultarTransacao(transacaoId);
    } catch (error) {
      return Promise.reject(error);
    }
  }

  async reimprimir(transacaoId, tipo = 'cliente') {
    try {
      const transacao = await this._buscarTransacaoCompleta(transacaoId);
      if (!transacao) {
        const error = new Error('Transação TEF não encontrada.');
        error.codigo = 'TEF_TRANSACAO_NAO_ENCONTRADA';
        throw error;
      }
      const ciclo = await obterAdapterDaTransacao(transacao);
      return await ciclo.adapter.reimprimirComprovante(transacaoId, tipo);
    } catch (error) {
      return Promise.reject(error);
    }
  }

  async status() {
    try {
      // Status de instalação (sem vínculo de transação) — singleton compat
      const adapter = await obterAdapter();
      return await adapter.status();
    } catch (error) {
      return Promise.reject(error);
    }
  }

  /**
   * Ponto de diagnóstico exclusivo da Sprint 06A.
   * Entrega ao harness o MESMO adapter criado pela Factory, evitando uma
   * segunda carga da DLL no mesmo processo. Nunca autoriza transação.
   */
  async prepararHarnessDestaxaReal() {
    if (String(process.env.DESTAXA_REAL_HARNESS || '').trim() !== '1') {
      const error = new Error('Harness Destaxa real desabilitado');
      error.code = 'DESTAXA_REAL_HARNESS_DISABLED';
      throw error;
    }
    if (String(process.env.DESTAXA_REAL_TRANSACTION_ENABLED || '').trim() === '1') {
      const error = new Error('Transação real deve permanecer desabilitada na Sprint 06A');
      error.code = 'DESTAXA_REAL_TRANSACTION_FLAG_MUST_BE_DISABLED';
      throw error;
    }

    // Diagnóstico 06A inspeciona o bridge de forma síncrona: execução in-process, sem transação.
    const adapter = criarAdapter({
      provedor: 'destaxa',
      ambiente: 'homologacao'
    }, { adapterOpcoes: { executionMode: 'in-process' } });
    const status = await adapter.status();
    return { adapter, status };
  }

  async vincularNfce(transacaoId, nfceNumero, nfceChave) {
    return new Promise((resolve, reject) => {
      const db = require('../../database');

      db.run(`
        UPDATE tef_transacoes
        SET
          nfce_numero = ?,
          nfce_chave = ?,
          atualizado_em = datetime('now')
        WHERE id = ?
      `, [nfceNumero, nfceChave, transacaoId], (err) => {
        if (err) return reject(err);

        repository.registrarLog(transacaoId, 'NFC_E_VINCULADA', `NFC-e ${nfceNumero} vinculada à transação TEF`, {
          nfce_numero: nfceNumero,
          nfce_chave: nfceChave
        });

        resolve({
          sucesso: true,
          mensagem: 'NFC-e vinculada com sucesso',
          transacao_id: transacaoId,
          nfce_numero: nfceNumero,
          nfce_chave: nfceChave
        });
      });
    });
  }
}

module.exports = new TefManager();
module.exports.ESTADOS_TRAVA_RESULTADO_TARDIO = ESTADOS_TRAVA_RESULTADO_TARDIO;
module.exports.TefManager = TefManager;
