const crypto = require('crypto');
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
const DataMaskingService = require('../crypto/dataMaskingService');
const tefLockService = require('./tefLockService');
const tefFraudDetectionService = require('./tefFraudDetectionService');
const tefRetryService = require('./tefRetryService');
const tefCircuitBreakerService = require('./tefCircuitBreakerService');
const tefFailureNotificationService = require('./tefFailureNotificationService');
const tefFluxoPagamento = require('./tefFluxoPagamento');
const tefRouterIntegration = require('./tefRouterIntegration');
const { obterTerminalRecoveryService } = require('./terminalRecovery');
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
    this._emExecucao = new Set();
    this._escritasPendentes = new Set();
    this._idsRecuperadosRegistrados = new Set();
    this._recuperacao = null;
    this._autorizacaoEmCurso = false;
    /** MRT-22 — ciclo CRT aguardando COLETA/OPCAO do PDV (mesmo transactionId / sem novo TX_START). */
    this._continuidadeCrt = null;
    this._instanciaId = `${process.pid}-${crypto.randomBytes(4).toString('hex')}`;
    if (opcoes.recuperarNoInicio !== false) {
      setImmediate(() => this.garantirRecuperacao().catch(() => {}));
    }
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
      desde: new Date().toISOString(),
      sessaoHost: this._capturarSessaoNativeHost()
    };
  }

  _limparContinuidadeCrt(transacaoId = null) {
    if (!this._continuidadeCrt) return;
    if (transacaoId != null && String(this._continuidadeCrt.transacaoId) !== String(transacaoId)) return;
    this._continuidadeCrt = null;
  }

  async autorizar(dados, timeoutMs) {
    const operacaoTimeout = timeoutMs || this.timeout;
    let transacaoEmCursoId = null;
    let provedorEmCurso = null;
    let mutexAdquirido = false;
    let leaseId = null;
    let leaseFechado = false;
    const dadosNormalizados = {
      ...dados,
      tipo: tefFluxoPagamento.normalizarTipoTef(dados.tipo)
    };

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
                    }, () => pronto()));
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
                      fingerprint: blocoPersistencia.fingerprint
                    };
                    const retornoBruto = await adapter.autorizarPagamento(
                      dadosNormalizados,
                      preparacaoComPersistencia
                    );
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
                    if (retornoBruto?.requerContinuacao === true) {
                      this._marcarContinuidadeCrt(transacaoId, dadosNormalizados, retornoBruto);
                    } else if (retornoBruto?.inconclusivo === true || retornoBruto?.sucesso === true
                      || retornoBruto?.status === tefContrato.STATUS.NEGADO
                      || retornoBruto?.status === tefContrato.STATUS.APROVADO) {
                      this._limparContinuidadeCrt(transacaoId);
                    }
                    if (expirado) {
                      this._registrarResultadoTardio(transacaoId, adapter.nome, dadosNormalizados.tipo, retornoBruto);
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
                    }, (updateErr) => {
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
                      this._concluirExecucao(transacaoId, retorno.status, {
                        provedor: adapter.nome,
                        operacao: dadosNormalizados.tipo,
                        financialState: retorno.financialState,
                        codigo: retorno.codigo
                      });

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
                      resolve(tefContrato.paraRespostaApi(retorno, transacaoId));
                    });
                  } catch (error) {
                    clearTimeout(timeoutId);
                    repository.registrarLog(transacaoId, 'ERRO', error.message, { error: error.message });
                    if (expirado) {
                      this._registrarResultadoTardio(transacaoId, adapter.nome, dadosNormalizados.tipo, {
                        codigo: error.code || 'TEF_UNKNOWN',
                        mensagem: error.message
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
      resultadoTardio: dados.resultadoTardio ?? atual.resultadoTardio ?? null
    });
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
    const escrita = new Promise((resolve) => executar(() => resolve()));
    this._escritasPendentes.add(escrita);
    escrita.then(() => this._escritasPendentes.delete(escrita));
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
    const abertas = new Set(linhas.map((linha) => String(linha.id)));
    for (const id of [...this._pendencias.keys()]) {
      if (!abertas.has(id)) this._pendencias.delete(id);
    }

    for (const linha of linhas) {
      const id = String(linha.id);
      const payload = linha.payload_retorno || {};
      const execucao = payload.execucao || null;
      const propria = execucao?.instancia === this._instanciaId;
      const origemViva = Boolean(execucao && !propria && execucao.pid && processoVivo(execucao.pid));
      const emAndamento = (propria && this._emExecucao.has(id)) || origemViva;
      const conhecida = this._pendencias.get(id);

      if (conhecida && !(conhecida.estado === ESTADOS_TRAVA_RESULTADO_TARDIO.AGUARDANDO_RESULTADO && !emAndamento && !propria)) {
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
        // MRT-27 — identidade recuperável após reinício (sem reenvio automático)
        recuperacao: identidadeRecuperada
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
  _registrarResultadoTardio(transacaoId, provedor, operacao, retornoBruto) {
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

    // MRT-14 — ler payload atual e preservar identidadeAdapter antes do rewrite
    this._gravar((pronto) => {
      const db = require('../../database');
      db.get('SELECT provedor, payload_retorno FROM tef_transacoes WHERE id = ?', [transacaoId], (errLeitura, row) => {
        const anterior = row ? lerPayloadTransacao(row) : {};
        const payloadNovo = mesclarPayloadPreservandoIdentidade(
          {
            ...(payloadPersistido && typeof payloadPersistido === 'object'
              ? payloadPersistido
              : { resposta: payloadPersistido }),
            resultadoTardio
          },
          anterior
        );
        repository.atualizarTransacao(transacaoId, {
          ...persistencia,
          payload_retorno: payloadNovo
        }, (err) => {
          if (err) repository.registrarLog(transacaoId, 'ERRO', err.message, { error: err.message });
          pronto();
        });
      });
    });
    repository.registrarLog(transacaoId, 'RESULTADO_TARDIO', retorno.mensagem, {
      ...montarLogDecisao({ transactionId: transacaoId, provider: provedor, operation: operacao, decision: decisao }),
      resolution: decisao.resolution,
      reconciliationRequired: decisao.reconciliationRequired
    });

    const id = String(transacaoId);
    this._emExecucao.delete(id);
    if (decisao.releaseLock) {
      this._pendencias.delete(id);
    } else {
      this._definirPendencia(id, {
        provedor,
        operacao,
        estado: ESTADOS_TRAVA_RESULTADO_TARDIO.RECONCILIACAO_PENDENTE,
        financialState: decisao.financialState,
        codigo: decisao.resultCode || null,
        resultadoTardio
      });
    }
    return decisao;
  }

  /**
   * Reconciliação explícita (operador) de transação com resultado tardio.
   * Só depois do desfecho da chamada nativa; nunca envia nova autorização.
   * @param {{financialState: 'CONFIRMED_SUCCESS'|'CONFIRMED_DENIED'|'CANCELLED', usuario: string, observacao: string}} dados
   */
  reconciliarResultadoTardio(transacaoId, dados = {}) {
    const trava = this._pendencias.get(String(transacaoId));
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

    this._gravar((pronto) => {
      const db = require('../../database');
      db.get('SELECT payload_retorno FROM tef_transacoes WHERE id = ?', [transacaoId], (errLeitura, row) => {
        const anterior = row ? lerPayloadTransacao(row) : {};
        repository.atualizarTransacao(transacaoId, {
          status,
          payload_retorno: mesclarPayloadPreservandoIdentidade(
            {
              resultadoTardio: trava.resultadoTardio,
              reconciliacao: {
                financialState: dados.financialState,
                usuario: String(dados.usuario),
                observacao: String(dados.observacao),
                em: new Date().toISOString()
              }
            },
            anterior
          )
        }, (err) => {
          if (err) repository.registrarLog(transacaoId, 'ERRO', err.message, { error: err.message });
          pronto();
        });
      });
    });
    repository.registrarLog(transacaoId, 'RECONCILIACAO_RESULTADO_TARDIO', `Reconciliado como ${dados.financialState}`, {
      transactionId: String(transacaoId),
      financialState: dados.financialState,
      resultadoTardio: trava.resultadoTardio,
      usuario: String(dados.usuario),
      retryAllowed: false
    });
    this._pendencias.delete(String(transacaoId));
    return { transacaoId: String(transacaoId), status, financialState: dados.financialState, travaLiberada: true };
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

      const retornoBruto = await adapter.continuarPagamento({
        ...dados,
        transacao_id: Number(transacaoId) || transacaoId,
        venda_id: dados.venda_id != null ? dados.venda_id : transacao.venda_id,
        acao: dados.acao || this._continuidadeCrt?.acao || null
      });

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
      const payloadAnterior = lerPayloadTransacao(transacao);
      const payloadComIdentidade = mesclarPayloadPreservandoIdentidade(
        {
          ...(persistencia.payload_retorno && typeof persistencia.payload_retorno === 'object'
            ? persistencia.payload_retorno
            : { resposta: persistencia.payload_retorno }),
          financialState: retorno.financialState,
          cicloCrt: retornoBruto.cicloCrt || null,
          vinculoVendaPdv: retornoBruto.vinculoVendaPdv || null,
          continuidade: {
            requerContinuacao: retornoBruto.requerContinuacao === true,
            acao: retornoBruto.acao || null
          },
          reconciliacaoObrigatoria: retornoBruto.reconciliacaoObrigatoria === true
        },
        payloadAnterior,
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
        this._marcarContinuidadeCrt(transacaoId, {
          idempotency_key: dados.idempotency_key || transacao.idempotency_key,
          venda_id: dados.venda_id != null ? dados.venda_id : transacao.venda_id
        }, retornoBruto);
      } else {
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
