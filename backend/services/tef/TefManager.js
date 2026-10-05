const crypto = require('crypto');
const { obterAdapter, criarAdapter } = require('./tefFactory');
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
const {
  FINANCIAL_STATES,
  classificarErroFinanceiro,
  classificarResultadoFinanceiro,
  decidirResultadoTardio,
  montarLogDecisao
} = require('./tefFinancialSafetyPolicy');

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
    this._instanciaId = `${process.pid}-${crypto.randomBytes(4).toString('hex')}`;
    if (opcoes.recuperarNoInicio !== false) {
      setImmediate(() => this.garantirRecuperacao().catch(() => {}));
    }
  }

  async autorizar(dados, timeoutMs) {
    const operacaoTimeout = timeoutMs || this.timeout;
    let transacaoEmCursoId = null;
    let provedorEmCurso = null;
    let mutexAdquirido = false;
    const dadosNormalizados = {
      ...dados,
      tipo: tefFluxoPagamento.normalizarTipoTef(dados.tipo)
    };
    
    // Determinar chave do lock (usar idempotency_key ou venda_id)
    const lockKey = dadosNormalizados.idempotency_key || dadosNormalizados.venda_id || `tef_${Date.now()}`;
    
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
          return {
            sucesso: false,
            codigo: 'TRANSACAO_SUSPEITA',
            mensagem: 'Transação bloqueada por suspeita de fraude',
            alertas: analiseFraude.alertas,
            nivel_risco: analiseFraude.nivel_risco
          };
        }
      }

      // Verificar idempotência para evitar duplicação
      if (dadosNormalizados.idempotency_key) {
        const transacaoExistente = await this._verificarIdempotencia(dadosNormalizados.idempotency_key);
        if (transacaoExistente) {
          const completa = await this._buscarTransacaoCompleta(transacaoExistente.id);
          const resposta = tefContrato.paraRespostaApi({
            sucesso: tefContrato.estaAprovado({ status: transacaoExistente.status }),
            status: transacaoExistente.status,
            nsu: completa?.nsu,
            autorizacao: completa?.autorizacao,
            adquirente: completa?.adquirente,
            bandeira: completa?.bandeira,
            comprovanteCliente: completa?.comprovante_cliente,
            comprovanteLoja: completa?.comprovante_estabelecimento,
            codigo: 'TRANSACAO_DUPLICADA',
            mensagem: 'Transação duplicada detectada — retornando existente'
          }, transacaoExistente.id);
          return {
            ...resposta,
            transacao_existente: true
          };
        }
      }

      // Operação anterior (deste ou de outro processo, antes ou depois de um
      // restart) sem desfecho seguro: nenhuma nova autorização, transactionId ou cobrança.
      try {
        await this.garantirRecuperacao();
        await this._aguardarEscritas();
        if (this._pendencias.size > 0) await this.recarregarPendencias();
      } catch (error) {
        return this._respostaSemRecuperacao(error);
      }
      if (this._pendencias.size > 0) {
        return this._respostaTravaResultadoTardio();
      }
      if (this._autorizacaoEmCurso) {
        return this._respostaAutorizacaoEmCurso();
      }
      this._autorizacaoEmCurso = true;
      mutexAdquirido = true;

      const adapter = await obterAdapter();
      provedorEmCurso = adapter.nome;

      // Adapters com gate financeiro (Destaxa real) validam pré-condições antes
      // da linha pendente: bloqueio não cria transactionId nem aciona o PinPad.
      let preparacaoAdapter = null;
      if (typeof adapter.prepararAutorizacao === 'function') {
        preparacaoAdapter = await adapter.prepararAutorizacao(dadosNormalizados);
        if (!preparacaoAdapter.pronto) {
          return preparacaoAdapter.resposta;
        }
      }

      // Circuit breaker permanece; autorização financeira, porém, tem uma
      // única tentativa. O retry service aplica a política sem retry.
      return await tefCircuitBreakerService.executarComCircuitBreaker(
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

                repository.criarTransacaoExclusiva({
                  venda_id: dadosNormalizados.venda_id || null,
                  tipo: dadosNormalizados.tipo,
                  valor: dadosNormalizados.valor,
                  parcelas: dadosNormalizados.parcelas || 1,
                  provedor: adapter.nome,
                  idempotency_key: dadosNormalizados.idempotency_key || null,
                  payload_retorno: {
                    execucao: { instancia: this._instanciaId, pid: process.pid, iniciadoEm: new Date().toISOString() }
                  }
                }, async (err, transacaoId) => {
                  if (err) {
                    clearTimeout(timeoutId);
                    // Se erro for de chave duplicada (idempotency_key), buscar transação existente
                    if (err.message && err.message.includes('UNIQUE constraint')) {
                      const transacaoExistente = await this._buscarPorIdempotencyKey(dadosNormalizados.idempotency_key);
                      if (transacaoExistente) {
                        return resolve({
                          sucesso: false,
                          codigo: 'TRANSACAO_DUPLICADA',
                          mensagem: 'Transação duplicada detectada',
                          transacao_id: transacaoExistente.id,
                          status: transacaoExistente.status,
                          transacao_existente: true
                        });
                      }
                    }
                    return reject(err);
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
                    this._gravar((pronto) => repository.atualizarTransacao(transacaoId, {
                      status: tefContrato.STATUS.ERRO,
                      payload_retorno: { codigo: 'TEF_TIMEOUT_ANTES_DO_ENVIO', transactionAttempted: false }
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
                  repository.registrarLog(transacaoId, 'INICIO', 'Transação TEF iniciada', dadosMascarados);

                  tefEvents.emitirEstado(tefEvents.estados.INSIRA_CARTAO);

                  try {
                    const retornoBruto = preparacaoAdapter
                      ? await adapter.autorizarPagamento(dadosNormalizados, {
                        ...preparacaoAdapter,
                        transactionId: String(transacaoId)
                      })
                      : await adapter.autorizarPagamento(dadosNormalizados);
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

                    repository.atualizarTransacao(transacaoId, {
                      venda_id: dados.venda_id || null,
                      ...persistencia,
                      payload_retorno: { ...persistencia.payload_retorno, financialState: retorno.financialState }
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
        return {
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
      }
      if (error.message && error.message.includes('lock')) {
        repository.registrarLog(null, 'ERRO_LOCK', error.message, { error: error.message });
        return {
          sucesso: false,
          codigo: 'LOCK_NAO_ADQUIRIDO',
          mensagem: 'Operação em andamento, tente novamente',
          tipo_erro: 'conflito'
        };
      }
      if (error.message && error.message.includes('Circuit breaker')) {
        repository.registrarLog(null, 'ERRO_CIRCUIT_BREAKER', error.message, { error: error.message });
        await tefFailureNotificationService.notificarFalhaCircuitBreaker('tef_autorizacao', tefCircuitBreakerService.obterEstado('tef_autorizacao'), error);
        return {
          sucesso: false,
          codigo: 'CIRCUIT_BREAKER_ABERTO',
          mensagem: 'Serviço TEF temporariamente indisponível devido a falhas consecutivas',
          tipo_erro: 'servico_indisponivel'
        };
      }
      if (error.message && error.message.includes('TRANSACAO_SUSPEITA')) {
        repository.registrarLog(null, 'ALERTA_FRAUDE', 'Transação bloqueada por suspeita de fraude', error);
        await tefFailureNotificationService.notificarFalhaFraude(error);
        return {
          sucesso: false,
          codigo: 'TRANSACAO_SUSPEITA',
          mensagem: error.mensagem,
          alertas: error.alertas,
          nivel_risco: error.nivel_risco,
          tipo_erro: 'seguranca'
        };
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
        return {
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
      }
      
      // Erro genérico
      repository.registrarLog(null, 'ERRO_GENERICO', error.message, { error: error.message, stack: error.stack });
      await tefFailureNotificationService.notificarFalhaGenerica(error, {
        transactionId: transacaoEmCursoId,
        provider: provedorEmCurso,
        operation: dadosNormalizados.tipo
      });
      return Promise.reject(error);
    } finally {
      if (mutexAdquirido) this._autorizacaoEmCurso = false;
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
   * Reconstrói a trava a partir das linhas `pendente` de tef_transacoes.
   */
  garantirRecuperacao() {
    if (!this._recuperacao) {
      this._recuperacao = this.recarregarPendencias().catch((error) => {
        this._recuperacao = null;
        throw error;
      });
    }
    return this._recuperacao;
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
        resultadoTardio: payload.resultadoTardio || null
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

    this._gravar((pronto) => repository.atualizarTransacao(transacaoId, {
      ...tefContrato.paraPersistencia(retorno),
      payload_retorno: { ...(retorno.payloadRetorno || {}), resultadoTardio }
    }, (err) => {
      if (err) repository.registrarLog(transacaoId, 'ERRO', err.message, { error: err.message });
      pronto();
    }));
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

    this._gravar((pronto) => repository.atualizarTransacao(transacaoId, {
      status,
      payload_retorno: {
        resultadoTardio: trava.resultadoTardio,
        reconciliacao: {
          financialState: dados.financialState,
          usuario: String(dados.usuario),
          observacao: String(dados.observacao),
          em: new Date().toISOString()
        }
      }
    }, (err) => {
      if (err) repository.registrarLog(transacaoId, 'ERRO', err.message, { error: err.message });
      pronto();
    }));
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
        resolve(row || null);
      });
    });
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
          const adapter = await obterAdapter();
          const retornoBruto = await adapter.cancelarPagamento({
            transacao_id: transacaoId,
            nsu: transacao.nsu,
            autorizacao: transacao.autorizacao,
            motivo
          });

          const retorno = tefContrato.criarRespostaCancelamento({
            sucesso: retornoBruto.sucesso,
            status: retornoBruto.status,
            nsu: retornoBruto.nsu,
            autorizacao: retornoBruto.autorizacao,
            transacaoId: String(transacaoId),
            codigo: retornoBruto.codigo,
            mensagem: retornoBruto.mensagem,
            payloadRetorno: retornoBruto.payloadRetorno || retornoBruto.payload_retorno,
            modo: retornoBruto.modo
          });

          db.run(`
            UPDATE tef_transacoes
            SET
              status = ?,
              payload_retorno = ?,
              atualizado_em = datetime('now')
            WHERE id = ?
          `, [
            retorno.status,
            JSON.stringify(retorno),
            transacaoId
          ], (updateErr) => {
            if (updateErr) return reject(updateErr);

            repository.registrarLog(transacaoId, 'CANCELAMENTO_RETORNO', retorno.mensagem, retorno);

            resolve(tefContrato.paraRespostaApi({
              ...retorno,
              status: retorno.status,
              sucesso: retorno.sucesso
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
      const adapter = await obterAdapter();
      return await adapter.consultarTransacao(transacaoId);
    } catch (error) {
      return Promise.reject(error);
    }
  }

  async reimprimir(transacaoId, tipo = 'cliente') {
    try {
      const adapter = await obterAdapter();
      return await adapter.reimprimirComprovante(transacaoId, tipo);
    } catch (error) {
      return Promise.reject(error);
    }
  }

  async status() {
    try {
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
