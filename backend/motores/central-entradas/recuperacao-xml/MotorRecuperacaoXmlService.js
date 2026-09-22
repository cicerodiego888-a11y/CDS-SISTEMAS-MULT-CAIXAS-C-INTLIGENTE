/**
 * MotorRecuperacaoXmlService — Recuperação automática de procNFe (RC3.7.5).
 *
 * Monitora XML_INDISPONIVEL + RESUMO_RECEBIDO.
 * Reconsulta SEFAZ via consChNFe (consultarNotaPorChave).
 * Ao localizar PROC_NFE: atualiza o mesmo registro (persistirDocumentoDfe) e
 * dispara processamento → EM_REVISAO / PRONTA_IMPORTACAO.
 *
 * Não cria INSERT duplicado. Respeita Gate SEFAZ (656).
 *
 * @module motores/central-entradas/recuperacao-xml/MotorRecuperacaoXmlService
 */

'use strict';

const CentralDocumentosRepository = require('../repositories/CentralDocumentosRepository');
const CentralConfigRepository = require('../repositories/CentralConfigRepository');
const CentralHistoricoRepository = require('../repositories/CentralHistoricoRepository');
const CentralEventosRepository = require('../repositories/CentralEventosRepository');
const { DocumentoFiscalStatus, normalizarStatus } = require('../core/DocumentoFiscalStatus');
const { DocumentoDfeTipo } = require('../core/DocumentoDfeTipo');
const DocumentoTransitionService = require('../services/DocumentoTransitionService');
const { TIPOS_EVENTO, ORIGENS } = require('../config/centralEventosTipos');
const { criarCorrelationId } = require('../utils/centralOperacaoLog');
const { logCentral, logCentralErro } = require('../utils/centralLog');
const {
  STATUS_MONITORADOS,
  ehElegivelRecuperacaoXml,
  filtrarCandidatosFila,
  ordenarFila,
  deduplicarPorChave
} = require('./FilaRecuperacaoXml');
const {
  CHAVES,
  INTERVALOS_PERMITIDOS,
  DEFAULTS,
  lerConfigDeMapa
} = require('./MotorRecuperacaoXmlConfig');
const {
  StatusRecuperacaoXml,
  PRIORIDADE,
  logXmlRecovery
} = require('./StatusRecuperacaoXml');
const {
  calcularProximaTentativa,
  avaliarJanelaRecuperacao,
  erroRecuperavel,
  prioridadeDeOrigem,
  JANELA_RECUPERACAO_DIAS
} = require('./RecuperacaoXmlPolitica');
const {
  classificarResultadoRecuperacao,
  extrairChaveDoXml,
  extrairCnpjDestinatarioXml
} = require('./RecuperacaoXmlClassificador');
const { ORIGENS: ORIGENS_SEFAZ } = require('../../../services/fiscal/sefaz/sefazGateConstants');

const ORIGEM_MOTOR = 'recuperacao_xml_automatica';

class MotorRecuperacaoXmlService {
  constructor(deps = {}) {
    this._documentosRepository = deps.documentosRepository
      || new CentralDocumentosRepository({ db: deps.db || null });
    this._configRepository = deps.configRepository || new CentralConfigRepository();
    this._historicoRepository = deps.historicoRepository
      || new CentralHistoricoRepository({ db: deps.db || null });
    this._eventosRepository = deps.eventosRepository
      || new CentralEventosRepository({ db: deps.db || null });
    this._transitionService = deps.transitionService
      || new DocumentoTransitionService({
        documentosRepository: this._documentosRepository,
        historicoRepository: this._historicoRepository
      });
    this._gate = deps.gate || null;
    this._consultarNotaPorChave = deps.consultarNotaPorChave
      || ((chave, opts) => require('../../../services/fiscal/distribuicaoDFe')
        .consultarNotaPorChave(chave, {
          ...opts,
          recuperacaoXml: true,
          origemSefazGate: ORIGENS_SEFAZ.RECUPERACAO_XML
        }));
    this._sefazQueryGate = deps.sefazQueryGate || null;
    this._obterContexto = deps.obterContextoOperacional
      || (async () => {
        const cfg = new (require('../services/CentralConfiguracaoService'))();
        return cfg.obterContextoOperacional();
      });
    this._processarDocumento = deps.processarDocumento
      || (async (id, opcoes) => {
        const orch = require('../CentralEntradasOrchestrator');
        if (typeof orch.processarDocumento === 'function') {
          return orch.processarDocumento(id, opcoes);
        }
        return null;
      });
    this._agora = deps.agora || (() => new Date());

    /** @private */
    this._timeoutId = null;
    /** @private */
    this._ativo = false;
    /** @private */
    this._cicloEmExecucao = false;
    /** @private chaves em execução (CNPJ|amb|chave) */
    this._emExecucao = new Set();
    /** @private */
    this._estado = this._estadoVazio();
  }

  /** @private */
  _estadoVazio() {
    return {
      ultimaExecucao: null,
      proximaExecucao: null,
      docs: {},
      metricas: {
        ciclos: 0,
        consultas: 0,
        recuperados: 0,
        falhas: 0,
        timeouts: 0,
        removidos: 0,
        gateBloqueios: 0
      }
    };
  }

  /** @private */
  _obterSefazQueryGate() {
    if (this._sefazQueryGate) return this._sefazQueryGate;
    try {
      this._sefazQueryGate = require('../../../services/fiscal/sefaz/SEFAZQueryGate');
    } catch {
      this._sefazQueryGate = null;
    }
    return this._sefazQueryGate;
  }

  /** @private */
  _obterGate() {
    // Sprint 2: não usa mais OperationalGate paralelo para retry DistDFe.
    // Acesso SEFAZ = SEFAZQueryGate (Sprint 1). Mantido só se injetado em testes legados.
    if (this._gate) return this._gate;
    return null;
  }

  estaAtivo() {
    return this._ativo;
  }

  /**
   * @returns {Promise<Object>}
   */
  async obterConfig() {
    try {
      const CentralConfiguracaoRepository = require('../repositories/CentralConfiguracaoRepository');
      if (this._configRepository instanceof CentralConfiguracaoRepository
        || typeof this._configRepository.ensureDefaults === 'function') {
        await this._configRepository.ensureDefaults();
      }
    } catch { /* ignore */ }
    const mapa = await this._lerMapaConfig();
    return lerConfigDeMapa(mapa);
  }

  /** @private */
  async _lerMapaConfig() {
    const mapa = {};
    try {
      const regs = await this._configRepository.listarTodas();
      for (const reg of regs || []) {
        mapa[reg.chave] = this._configRepository.parseValor(reg);
      }
    } catch {
      for (const chave of Object.values(CHAVES)) {
        if (chave === CHAVES.ESTADO) continue;
        try {
          const reg = await this._configRepository.buscarPorChave(chave);
          if (reg) mapa[chave] = this._configRepository.parseValor(reg);
        } catch { /* ignore */ }
      }
    }
    return mapa;
  }

  /**
   * Painel técnico / API.
   * @returns {Promise<Object>}
   */
  async obterStatus() {
    const config = await this.obterConfig();
    await this._carregarEstado();
    const fila = await this.listarMonitorados({ incluirEstado: true });

    return {
      ativo: this._ativo,
      cicloEmExecucao: this._cicloEmExecucao,
      config,
      intervalosPermitidos: [...INTERVALOS_PERMITIDOS],
      ultimaExecucao: this._estado.ultimaExecucao,
      proximaExecucao: this._estado.proximaExecucao,
      documentosMonitorados: fila.length,
      fila: fila.slice(0, 50),
      metricas: { ...this._estado.metricas },
      defaults: { ...DEFAULTS }
    };
  }

  /**
   * Lista documentos elegíveis + estado de tentativas.
   * @param {Object} [opcoes]
   * @returns {Promise<Object[]>}
   */
  async listarMonitorados(opcoes = {}) {
    await this._carregarEstado();
    const docs = await this._documentosRepository.listar({
      statusIn: [...STATUS_MONITORADOS],
      limite: Math.min(Number(opcoes.limite) || 200, 400),
      ordenarPor: 'created_at',
      ordenarDirecao: 'ASC'
    });
    const candidatos = ordenarFila(filtrarCandidatosFila(docs));
    if (!opcoes.incluirEstado) return candidatos;

    return candidatos.map((doc) => {
      const st = this._estado.docs[String(doc.id)] || {};
      return {
        id: doc.id,
        chave: doc.chave,
        status: doc.status,
        tipoDocumento: doc.tipoDocumento || doc.tipo_documento,
        nsu: doc.nsu,
        numero: doc.numero,
        fornecedor: doc.fornecedor,
        dataEmissao: doc.dataEmissao || doc.data_emissao || null,
        createdAt: doc.createdAt || doc.created_at,
        statusRecuperacao: doc.statusRecuperacao
          || st.statusRecuperacao
          || StatusRecuperacaoXml.AGUARDANDO_XML_COMPLETO,
        tentativas: Number(doc.recuperacaoTentativas != null
          ? doc.recuperacaoTentativas
          : st.tentativas) || 0,
        ultimaConsulta: doc.recuperacaoUltimaTentativa || st.ultimaConsulta || null,
        proximaTentativa: doc.recuperacaoProximaTentativa || st.proximaTentativa || null,
        ultimoRetorno: st.ultimoRetorno || null,
        ultimoCstat: doc.recuperacaoUltimoCstat || st.ultimoCstat || null,
        ultimoXmotivo: doc.recuperacaoUltimoXmotivo || st.ultimoXmotivo || null,
        ultimoRequestId: doc.recuperacaoUltimoRequestId || st.ultimoRequestId || null,
        recuperacaoPrioridade: doc.recuperacaoPrioridade || st.prioridade || PRIORIDADE.NORMAL,
        motivo: st.motivo || null,
        correlationId: st.correlationId || null,
        desde: st.desde || doc.recuperacaoPrimeiraTentativa || doc.createdAt || doc.created_at || null
      };
    });
  }

  async iniciar(opcoes = {}) {
    const config = await this.obterConfig();
    this.parar({ silencioso: true });

    if (!config.ativa && !opcoes.forcar) {
      this._ativo = false;
      logCentral('RECUPERACAO_XML', {
        mensagem: 'Motor desativado por configuração',
        Evento: 'SLEEP'
      });
      return { iniciado: false, motivo: 'desativado' };
    }

    await this._carregarEstado();
    this._ativo = true;
    const delayMs = opcoes.delayMs != null ? opcoes.delayMs : 12 * 1000;
    this._agendar(delayMs, 'boot');
    logCentral('RECUPERACAO_XML', {
      mensagem: 'Motor de recuperação XML iniciado',
      Evento: 'START',
      IntervaloMin: config.intervaloMinutos
    });
    return { iniciado: true, intervaloMinutos: config.intervaloMinutos };
  }

  parar(opcoes = {}) {
    if (this._timeoutId) {
      clearTimeout(this._timeoutId);
      this._timeoutId = null;
    }
    const estava = this._ativo;
    this._ativo = false;
    this._cicloEmExecucao = false;
    if (!opcoes.silencioso && estava) {
      logCentral('RECUPERACAO_XML', { mensagem: 'Motor parado', Evento: 'STOP' });
    }
  }

  /** @private */
  _agendar(delayMs, motivo) {
    if (this._timeoutId) clearTimeout(this._timeoutId);
    const ms = Math.max(3000, Number(delayMs) || 60000);
    const proxima = new Date(this._agora().getTime() + ms).toISOString();
    this._estado.proximaExecucao = proxima;
    this._timeoutId = setTimeout(() => {
      this._timeoutId = null;
      this.executarCiclo({ motivo: motivo || 'agendado' }).catch((err) => {
        logCentralErro('RECUPERACAO_XML', err, { Evento: 'CICLO_ERRO' });
      });
    }, ms);
  }

  /**
   * Ciclo completo do scheduler.
   * @param {Object} [opcoes]
   * @returns {Promise<Object>}
   */
  async executarCiclo(opcoes = {}) {
    if (this._cicloEmExecucao) {
      return { ignorado: true, motivo: 'ciclo_em_execucao' };
    }

    const config = await this.obterConfig();
    if (!config.ativa && !opcoes.forcar) {
      this._ativo = false;
      return { ignorado: true, motivo: 'desativado' };
    }

    this._cicloEmExecucao = true;
    const correlationId = opcoes.correlationId || criarCorrelationId();
    const inicio = Date.now();
    const relatorio = {
      correlationId,
      consultados: 0,
      recuperados: 0,
      falhas: 0,
      timeouts: 0,
      removidos: 0,
      gateBloqueado: false,
      itens: []
    };

    try {
      await this._carregarEstado();
      this._estado.metricas.ciclos += 1;
      this._estado.ultimaExecucao = this._agora().toISOString();

      const monitorados = await this.listarMonitorados({ incluirEstado: true, limite: 200 });
      const elegiveis = [];

      for (const item of monitorados) {
        const sync = this._sincronizarEntradaFila(item, correlationId);
        if (sync.entrou) {
          await this._emitirEvento({
            tipo: TIPOS_EVENTO.RECUPERACAO_XML_ENTROU_FILA,
            documentoId: item.id,
            descricao: `Documento #${item.id} entrou na fila de recuperação automática`,
            sucesso: true,
            correlationId,
            detalhe: { chave: item.chave, status: item.status }
          });
          logXmlRecovery({
            chave: item.chave,
            status: StatusRecuperacaoXml.AGUARDANDO_XML_COMPLETO,
            attempt: 0,
            motivo: 'entrou_fila'
          });
        }

        const decisao = this._avaliarLimites(item, config);
        if (decisao.foraJanela) {
          await this._finalizarForaJanela(item, decisao, correlationId);
          relatorio.removidos += 1;
          continue;
        }
        if (decisao.remover) {
          await this._removerDaFila(item, decisao.motivo, correlationId, decisao.timeout, {
            statusDocumento: DocumentoFiscalStatus.RECUPERACAO_ESGOTADA,
            statusRecuperacao: StatusRecuperacaoXml.RECUPERACAO_ESGOTADA
          });
          relatorio.removidos += 1;
          if (decisao.timeout) relatorio.timeouts += 1;
          continue;
        }
        if (decisao.adiar) continue;
        elegiveis.push(item);
      }

      const lote = deduplicarPorChave(ordenarFila(elegiveis)).slice(0, config.lotePorCiclo);

      for (const item of lote) {
        const resultado = await this._consultarDocumento(item, config, correlationId);
        relatorio.itens.push(resultado);
        relatorio.consultados += 1;
        this._estado.metricas.consultas += 1;

        if (resultado.gateBloqueado) {
          relatorio.gateBloqueado = true;
          this._estado.metricas.gateBloqueios += 1;
          break;
        }
        if (resultado.recuperado) {
          relatorio.recuperados += 1;
          this._estado.metricas.recuperados += 1;
        } else if (resultado.falha) {
          relatorio.falhas += 1;
          this._estado.metricas.falhas += 1;
        }
      }

      await this._persistirEstado();
    } catch (error) {
      logCentralErro('RECUPERACAO_XML', error, {
        Evento: 'CICLO_ERRO',
        CorrelationId: correlationId
      });
      relatorio.erro = error.message;
    } finally {
      this._cicloEmExecucao = false;
      const configPos = await this.obterConfig().catch(() => config);
      if (this._ativo && configPos.ativa) {
        this._agendar(configPos.intervaloMinutos * 60 * 1000, 'pos_ciclo');
        await this._persistirEstado().catch(() => {});
      }
      logCentral('RECUPERACAO_XML', {
        mensagem: 'Ciclo concluído',
        CorrelationId: correlationId,
        Tempo: Date.now() - inicio,
        Consultados: relatorio.consultados,
        Recuperados: relatorio.recuperados,
        Falhas: relatorio.falhas
      });
    }

    return relatorio;
  }

  /**
   * @private
   */
  _sincronizarEntradaFila(item, correlationId) {
    const key = String(item.id);
    if (this._estado.docs[key]) {
      return { entrou: false };
    }
    this._estado.docs[key] = {
      tentativas: Number(item.tentativas) || 0,
      ultimaConsulta: item.ultimaConsulta || null,
      proximaTentativa: item.proximaTentativa || null,
      ultimoRetorno: null,
      statusRecuperacao: StatusRecuperacaoXml.AGUARDANDO_XML_COMPLETO,
      prioridade: item.recuperacaoPrioridade || PRIORIDADE.NORMAL,
      motivo: 'monitoramento_ativo',
      correlationId,
      desde: this._agora().toISOString(),
      chave: item.chave
    };
    return { entrou: true };
  }

  /**
   * @private
   */
  _avaliarLimites(item, config) {
    const st = this._estado.docs[String(item.id)] || {};
    const tentativas = Number(item.tentativas != null ? item.tentativas : st.tentativas) || 0;

    const janela = avaliarJanelaRecuperacao(
      item.dataEmissao || item.data_emissao,
      this._agora(),
      config.janelaRecuperacaoDias || JANELA_RECUPERACAO_DIAS
    );
    if (janela.fora) {
      return {
        remover: true,
        foraJanela: true,
        timeout: false,
        motivo: `Documento localizado, mas fora da janela disponível para recuperação pela distribuição SEFAZ (${janela.dias} dias > ${config.janelaRecuperacaoDias || JANELA_RECUPERACAO_DIAS}).`,
        janela
      };
    }

    if (tentativas >= config.maxTentativas) {
      return {
        remover: true,
        timeout: true,
        motivo: `Limite de tentativas (${config.maxTentativas}) atingido`
      };
    }

    const desde = st.desde || item.desde || item.createdAt || item.created_at;
    if (desde) {
      const dias = (this._agora().getTime() - new Date(desde).getTime()) / (24 * 60 * 60 * 1000);
      if (Number.isFinite(dias) && dias > config.maxDiasMonitoramento) {
        return {
          remover: true,
          timeout: true,
          motivo: `Tempo máximo de monitoramento (${config.maxDiasMonitoramento} dias) excedido`
        };
      }
    }

    const proxima = item.proximaTentativa || st.proximaTentativa;
    if (proxima) {
      const t = Date.parse(proxima);
      if (Number.isFinite(t) && t > this._agora().getTime()) {
        return { remover: false, adiar: true, motivo: 'next_attempt_at' };
      }
    }

    return { remover: false, adiar: false };
  }

  /**
   * @private
   */
  async _consultarDocumento(item, config, correlationIdCiclo) {
    const id = Number(item.id);
    const correlationId = criarCorrelationId();
    const chaveLimpa = String(item.chave || '').replace(/\D/g, '');
    const lockKey = `chave:${chaveLimpa}`;
    const base = {
      documentoId: id,
      chave: item.chave,
      recuperado: false,
      falha: false,
      gateBloqueado: false,
      mensagem: null
    };

    if (chaveLimpa && this._emExecucao.has(lockKey)) {
      return { ...base, mensagem: 'Recuperação já em andamento para esta chave' };
    }
    if (chaveLimpa) this._emExecucao.add(lockKey);

    try {
      const doc = await this._documentosRepository.buscarPorId(id);
      if (!doc) {
        await this._removerDaFila(item, 'documento_inexistente', correlationId, false);
        return { ...base, mensagem: 'Documento não encontrado' };
      }

      // Idempotência: XML já completo → não consulta SEFAZ
      const stAtual = normalizarStatus(doc.status);
      const tipoAtual = doc.tipoDocumento || doc.tipo_documento;
      if (
        stAtual === DocumentoFiscalStatus.XML_COMPLETO
        || tipoAtual === DocumentoDfeTipo.PROC_NFE
        || tipoAtual === DocumentoDfeTipo.NFE
      ) {
        delete this._estado.docs[String(id)];
        await this._persistirMetadadosDoc(id, {
          statusRecuperacao: StatusRecuperacaoXml.XML_COMPLETO,
          recuperacaoProximaTentativa: null
        });
        logXmlRecovery({
          chave: chaveLimpa,
          status: StatusRecuperacaoXml.XML_COMPLETO,
          motivo: 'idempotente_xml_existente'
        });
        return { ...base, recuperado: true, mensagem: 'XML já existente — SEFAZ não consultada' };
      }

      if (!ehElegivelRecuperacaoXml(doc.status)) {
        await this._removerDaFila(item, 'status_nao_elegivel', correlationId, false);
        return { ...base, mensagem: 'Documento saiu da fila (status alterado)' };
      }

      if (chaveLimpa.length !== 44) {
        this._atualizarEstadoDoc(id, {
          tentativas: (this._estado.docs[String(id)]?.tentativas || 0) + 1,
          ultimaConsulta: this._agora().toISOString(),
          ultimoRetorno: 'SEM_CHAVE',
          statusRecuperacao: StatusRecuperacaoXml.ERRO_RECUPERACAO,
          motivo: 'Chave inválida',
          correlationId
        });
        return { ...base, falha: true, mensagem: 'Chave inválida' };
      }

      // Pré-check SEFAZ Query Gate (sem retry no motor)
      let ctxResult = null;
      try {
        ctxResult = await this._obterContexto();
      } catch (e) {
        ctxResult = { ok: false, mensagem: e.message };
      }
      if (!ctxResult?.ok) {
        const msg = ctxResult?.mensagem || 'Contexto operacional indisponível';
        this._agendarProxima(id, item, config, null, msg);
        return { ...base, falha: true, mensagem: msg };
      }

      const cnpj = String(ctxResult.contexto?.cnpj || '').replace(/\D/g, '');
      const ambiente = Number(ctxResult.contexto?.ambiente) === 1 ? 1 : 2;
      const sefazGate = this._obterSefazQueryGate();
      if (sefazGate?.autorizar) {
        const auth = await sefazGate.autorizar({
          cnpj,
          ambiente,
          tipo: 'CONS_CH_NFE',
          origem: ORIGENS_SEFAZ.RECUPERACAO_XML
        });
        if (!auth.permitido) {
          const next = calcularProximaTentativa(
            this._estado.docs[String(id)]?.tentativas || 0,
            this._agora(),
            auth.retry_at
          );
          this._atualizarEstadoDoc(id, {
            statusRecuperacao: StatusRecuperacaoXml.AGUARDANDO_XML_COMPLETO,
            proximaTentativa: next,
            ultimoRetorno: auth.motivo || auth.erro || 'GATE',
            ultimoCstat: auth.cstat || null,
            ultimoRequestId: auth.request_id || null,
            motivo: auth.motivo || 'Gate SEFAZ bloqueou consulta',
            correlationId
          });
          await this._persistirMetadadosDoc(id, {
            statusRecuperacao: StatusRecuperacaoXml.AGUARDANDO_XML_COMPLETO,
            recuperacaoProximaTentativa: next,
            recuperacaoUltimoCstat: auth.cstat || null,
            recuperacaoUltimoRequestId: auth.request_id || null,
            recuperacaoUltimoXmotivo: auth.motivo || null
          });
          logXmlRecovery({
            chave: chaveLimpa,
            status: StatusRecuperacaoXml.AGUARDANDO_XML_COMPLETO,
            next_attempt: next,
            request: auth.request_id,
            cStat: auth.cstat,
            motivo: auth.motivo || auth.erro
          });
          return {
            ...base,
            gateBloqueado: true,
            mensagem: auth.motivo || auth.erro || 'Gate bloqueado'
          };
        }
      }

      const tentativasAntes = Number(this._estado.docs[String(id)]?.tentativas) || 0;
      this._atualizarEstadoDoc(id, {
        statusRecuperacao: StatusRecuperacaoXml.RECUPERANDO_XML,
        correlationId
      });
      await this._persistirMetadadosDoc(id, {
        statusRecuperacao: StatusRecuperacaoXml.RECUPERANDO_XML
      });

      await this._emitirEvento({
        tipo: TIPOS_EVENTO.RECUPERACAO_XML_CONSULTA,
        documentoId: id,
        descricao: `Consulta automática consChNFe — documento #${id}`,
        sucesso: true,
        correlationId,
        detalhe: {
          chave: doc.chave,
          nsu: doc.nsu,
          status: doc.status,
          ciclo: correlationIdCiclo
        }
      });

      let resultadoConsulta = null;
      let erroConsulta = null;
      try {
        resultadoConsulta = await this._consultarNotaPorChave(chaveLimpa, {
          contextoCentral: ctxResult.contexto,
          recuperacaoXml: true,
          origemSefazGate: ORIGENS_SEFAZ.RECUPERACAO_XML
        });
      } catch (error) {
        erroConsulta = error;
      }

      const atualizado = await this._documentosRepository.buscarPorId(id);
      const classif = classificarResultadoRecuperacao({
        resultadoConsulta,
        documentoAtualizado: atualizado,
        erro: erroConsulta
      });

      const tentativas = tentativasAntes + 1;
      const requestId = erroConsulta?.request_id
        || resultadoConsulta?.sefazGateRequestId
        || null;

      // Validação chave/CNPJ quando XML completo
      if (classif.xmlCompleto && atualizado?.xml) {
        const chaveXml = extrairChaveDoXml(atualizado.xml);
        if (chaveXml && chaveXml !== chaveLimpa) {
          classif.caso = 'ERRO_CHAVE';
          classif.xmlCompleto = false;
          classif.statusRecuperacao = StatusRecuperacaoXml.ERRO_RECUPERACAO;
          classif.codigoErro = 'ERRO_XML';
          classif.mensagem = 'Chave retornada diferente da chave solicitada.';
          classif.aguardando = false;
        } else if (cnpj) {
          const cnpjDest = extrairCnpjDestinatarioXml(atualizado.xml);
          if (cnpjDest && cnpjDest !== cnpj) {
            classif.caso = 'ERRO_CNPJ';
            classif.xmlCompleto = false;
            classif.statusRecuperacao = StatusRecuperacaoXml.ERRO_RECUPERACAO;
            classif.codigoErro = 'ERRO_XML';
            classif.mensagem = 'CNPJ destinatário do XML diverge do CNPJ da empresa.';
            classif.aguardando = false;
          }
        }
      }

      if (classif.xmlCompleto) {
        this._atualizarEstadoDoc(id, {
          tentativas,
          ultimaConsulta: this._agora().toISOString(),
          proximaTentativa: null,
          statusRecuperacao: StatusRecuperacaoXml.XML_COMPLETO,
          ultimoRetorno: 'PROC_NFE',
          ultimoCstat: classif.cStat,
          ultimoRequestId: requestId,
          motivo: 'XML recuperado automaticamente',
          correlationId
        });
        await this._persistirMetadadosDoc(id, {
          statusRecuperacao: StatusRecuperacaoXml.XML_COMPLETO,
          recuperacaoTentativas: tentativas,
          recuperacaoUltimaTentativa: this._agora().toISOString(),
          recuperacaoProximaTentativa: null,
          recuperacaoUltimoCstat: classif.cStat,
          recuperacaoUltimoRequestId: requestId,
          recuperacaoPrimeiraTentativa: this._estado.docs[String(id)]?.desde || this._agora().toISOString()
        });

        logXmlRecovery({
          chave: chaveLimpa,
          status: StatusRecuperacaoXml.XML_COMPLETO,
          attempt: tentativas,
          request: requestId,
          cStat: classif.cStat
        });

        await this._historicoRepository.inserir({
          documentoId: id,
          statusAnterior: doc.status,
          statusNovo: DocumentoFiscalStatus.XML_COMPLETO,
          detalhe: [
            'XML recuperado automaticamente.',
            'Origem: DistDFe (consChNFe) via SEFAZQueryGate',
            `Data/Hora: ${this._agora().toISOString()}`,
            `Correlation ID: ${correlationId}`,
            `request_id: ${requestId || '—'}`,
            `cStat: ${classif.cStat || '—'}`
          ].join('\n')
        });

        await this._emitirEvento({
          tipo: TIPOS_EVENTO.RECUPERACAO_XML_RECUPERADO,
          documentoId: id,
          descricao: `procNFe encontrado — documento #${id}`,
          sucesso: true,
          resultado: 'XML_COMPLETO',
          correlationId,
          detalhe: { chave: doc.chave, request_id: requestId }
        });

        let statusFinal = DocumentoFiscalStatus.XML_COMPLETO;
        try {
          await this._processarDocumento(id, {
            usuarioId: null,
            origem: ORIGEM_MOTOR,
            correlationId
          });
          const docPos = await this._documentosRepository.buscarPorId(id);
          statusFinal = normalizarStatus(docPos?.status) || statusFinal;
          if (statusFinal === DocumentoFiscalStatus.XML_COMPLETO) {
            await this._transitionService.transicionar(
              id,
              DocumentoFiscalStatus.XML_COMPLETO,
              DocumentoFiscalStatus.EM_REVISAO,
              {
                detalhe: 'Sprint 2 — Liberado para revisão após recuperação do XML.',
                origem: ORIGEM_MOTOR
              }
            );
            statusFinal = DocumentoFiscalStatus.EM_REVISAO;
          }
        } catch { /* ignore — XML já persistido */ }

        delete this._estado.docs[String(id)];
        this._estado.metricas.removidos += 1;
        return {
          ...base,
          recuperado: true,
          statusFinal,
          mensagem: 'XML recuperado e documento atualizado',
          cStat: classif.cStat,
          request_id: requestId
        };
      }

      // resNFe / indisponível / 656 / 137 / erro técnico
      const next = calcularProximaTentativa(
        tentativas,
        this._agora(),
        erroConsulta?.retry_at || null
      );
      const statusRec = classif.aguardando
        ? StatusRecuperacaoXml.AGUARDANDO_XML_COMPLETO
        : (classif.recuperavel
          ? StatusRecuperacaoXml.AGUARDANDO_XML_COMPLETO
          : StatusRecuperacaoXml.ERRO_RECUPERACAO);

      this._atualizarEstadoDoc(id, {
        tentativas,
        ultimaConsulta: this._agora().toISOString(),
        proximaTentativa: classif.recuperavel || classif.aguardando ? next : null,
        statusRecuperacao: statusRec,
        ultimoRetorno: classif.caso,
        ultimoCstat: classif.cStat,
        ultimoXmotivo: classif.xMotivo || classif.mensagem,
        ultimoRequestId: requestId,
        motivo: classif.mensagem,
        correlationId
      });
      await this._persistirMetadadosDoc(id, {
        statusRecuperacao: statusRec,
        recuperacaoTentativas: tentativas,
        recuperacaoUltimaTentativa: this._agora().toISOString(),
        recuperacaoProximaTentativa: classif.recuperavel || classif.aguardando ? next : null,
        recuperacaoUltimoCstat: classif.cStat,
        recuperacaoUltimoXmotivo: classif.xMotivo || classif.mensagem,
        recuperacaoUltimoRequestId: requestId,
        recuperacaoPrimeiraTentativa: this._estado.docs[String(id)]?.desde || this._agora().toISOString()
      });

      logXmlRecovery({
        chave: chaveLimpa,
        status: statusRec,
        attempt: tentativas,
        next_attempt: next,
        request: requestId,
        cStat: classif.cStat,
        motivo: classif.mensagem
      });

      // resNFe NÃO é falha definitiva
      if (classif.caso === 'RESUMO' || classif.aguardando) {
        await this._historicoRepository.inserir({
          documentoId: id,
          statusAnterior: doc.status,
          statusNovo: doc.status,
          detalhe: [
            'Sprint 2 — Aguardando XML completo (não é erro).',
            classif.mensagem,
            `cStat: ${classif.cStat || '—'}`,
            `Próxima tentativa: ${next}`,
            `request_id: ${requestId || '—'}`
          ].join('\n')
        }).catch(() => {});
        return {
          ...base,
          gateBloqueado: Boolean(classif.gateBloqueado),
          mensagem: classif.mensagem,
          cStat: classif.cStat,
          request_id: requestId
        };
      }

      await this._emitirEvento({
        tipo: TIPOS_EVENTO.RECUPERACAO_XML_FALHA,
        documentoId: id,
        descricao: classif.mensagem,
        sucesso: false,
        correlationId,
        detalhe: {
          caso: classif.caso,
          codigo: classif.codigoErro,
          cStat: classif.cStat,
          request_id: requestId
        }
      });

      return {
        ...base,
        falha: !classif.recuperavel,
        gateBloqueado: Boolean(classif.gateBloqueado),
        mensagem: classif.mensagem,
        cStat: classif.cStat,
        request_id: requestId
      };
    } finally {
      if (chaveLimpa) this._emExecucao.delete(lockKey);
    }
  }

  /** @private */
  _agendarProxima(id, item, config, retryAtGate, motivo) {
    const tentativas = Number(this._estado.docs[String(id)]?.tentativas) || 0;
    const next = calcularProximaTentativa(tentativas, this._agora(), retryAtGate);
    this._atualizarEstadoDoc(id, {
      proximaTentativa: next,
      statusRecuperacao: StatusRecuperacaoXml.AGUARDANDO_XML_COMPLETO,
      motivo: motivo || 'adiado'
    });
    return next;
  }

  /** @private */
  async _persistirMetadadosDoc(id, patch) {
    try {
      await this._documentosRepository.atualizar(id, patch);
    } catch { /* colunas podem não existir em DB legado — estado KV cobre */ }
  }

  /** @private */
  async _finalizarForaJanela(item, decisao, correlationId) {
    const id = Number(item.id);
    logXmlRecovery({
      chave: item.chave,
      status: StatusRecuperacaoXml.FORA_JANELA_RECUPERACAO,
      motivo: decisao.motivo
    });
    try {
      await this._transitionService.transicionar(
        id,
        item.status,
        DocumentoFiscalStatus.FORA_JANELA_RECUPERACAO,
        {
          detalhe: decisao.motivo,
          origem: ORIGEM_MOTOR
        }
      );
    } catch {
      await this._persistirMetadadosDoc(id, {
        status: DocumentoFiscalStatus.FORA_JANELA_RECUPERACAO,
        statusDetalhe: decisao.motivo
      }).catch(() => {});
    }
    await this._persistirMetadadosDoc(id, {
      statusRecuperacao: StatusRecuperacaoXml.FORA_JANELA_RECUPERACAO,
      recuperacaoProximaTentativa: null,
      recuperacaoUltimoXmotivo: decisao.motivo
    });
    delete this._estado.docs[String(id)];
    await this._emitirEvento({
      tipo: TIPOS_EVENTO.RECUPERACAO_XML_TIMEOUT,
      documentoId: id,
      descricao: decisao.motivo,
      sucesso: false,
      correlationId,
      detalhe: { janela: decisao.janela, chave: item.chave }
    });
  }

  /**
   * Solicita recuperação com prioridade (consulta manual).
   * Não cria chamada paralela — entra na mesma fila/Gate.
   */
  async solicitarRecuperacaoManual(documentoIdOuChave, opcoes = {}) {
    await this._carregarEstado();
    let doc = null;
    if (typeof documentoIdOuChave === 'number' || /^\d+$/.test(String(documentoIdOuChave))) {
      doc = await this._documentosRepository.buscarPorId(documentoIdOuChave);
    } else {
      const chave = String(documentoIdOuChave || '').replace(/\D/g, '');
      if (typeof this._documentosRepository.buscarPorChave === 'function') {
        doc = await this._documentosRepository.buscarPorChave(chave);
      }
    }
    if (!doc) {
      const err = new Error('Documento não encontrado para recuperação.');
      err.status = 404;
      throw err;
    }

    const st = normalizarStatus(doc.status);
    if (st === DocumentoFiscalStatus.XML_COMPLETO) {
      return {
        sucesso: true,
        idempotente: true,
        mensagem: 'XML completo já disponível — SEFAZ não será consultada.',
        documentoId: doc.id,
        status: st
      };
    }

    if (!ehElegivelRecuperacaoXml(doc.status)
      && st !== DocumentoFiscalStatus.ERRO_RECUPERACAO
      && st !== DocumentoFiscalStatus.RECUPERACAO_ESGOTADA) {
      const err = new Error(`Documento em status ${doc.status} não elegível para recuperação.`);
      err.status = 400;
      throw err;
    }

    const prioridade = opcoes.prioridade || prioridadeDeOrigem(opcoes.origem || 'CONSULTA_MANUAL');
    this._estado.docs[String(doc.id)] = {
      ...(this._estado.docs[String(doc.id)] || {}),
      tentativas: Number(this._estado.docs[String(doc.id)]?.tentativas) || 0,
      proximaTentativa: this._agora().toISOString(),
      statusRecuperacao: StatusRecuperacaoXml.AGUARDANDO_XML_COMPLETO,
      prioridade,
      desde: this._estado.docs[String(doc.id)]?.desde || this._agora().toISOString(),
      chave: doc.chave,
      motivo: 'solicitacao_manual'
    };
    await this._persistirMetadadosDoc(doc.id, {
      statusRecuperacao: StatusRecuperacaoXml.AGUARDANDO_XML_COMPLETO,
      recuperacaoPrioridade: prioridade,
      recuperacaoProximaTentativa: this._agora().toISOString()
    });
    await this._persistirEstado();

    if (opcoes.executarImediato !== false) {
      const config = await this.obterConfig();
      const item = {
        id: doc.id,
        chave: doc.chave,
        status: doc.status,
        tentativas: this._estado.docs[String(doc.id)].tentativas,
        dataEmissao: doc.dataEmissao,
        recuperacaoPrioridade: prioridade
      };
      const resultado = await this._consultarDocumento(item, config, criarCorrelationId());
      await this._persistirEstado();
      return { sucesso: true, prioridade, resultado, documentoId: doc.id };
    }

    return {
      sucesso: true,
      enfileirado: true,
      prioridade,
      documentoId: doc.id,
      mensagem: 'Solicitação enfileirada com prioridade alta. Passará pelo SEFAZQueryGate.'
    };
  }

  /**
   * Diagnóstico operacional de uma chave/documento.
   */
  async obterDiagnosticoRecuperacao(documentoIdOuChave) {
    await this._carregarEstado();
    let doc = null;
    if (typeof documentoIdOuChave === 'number' || /^\d+$/.test(String(documentoIdOuChave))) {
      doc = await this._documentosRepository.buscarPorId(documentoIdOuChave);
    } else {
      const chave = String(documentoIdOuChave || '').replace(/\D/g, '');
      if (typeof this._documentosRepository.buscarPorChave === 'function') {
        doc = await this._documentosRepository.buscarPorChave(chave);
      }
    }
    if (!doc) return null;
    const st = this._estado.docs[String(doc.id)] || {};
    return {
      documentoId: doc.id,
      chave: doc.chave,
      cnpj: doc.cnpjFornecedor || null,
      ambiente: null,
      statusDocumento: doc.status,
      statusRecuperacao: doc.statusRecuperacao || st.statusRecuperacao || null,
      tentativas: Number(doc.recuperacaoTentativas != null ? doc.recuperacaoTentativas : st.tentativas) || 0,
      ultimaTentativa: doc.recuperacaoUltimaTentativa || st.ultimaConsulta || null,
      proximaTentativa: doc.recuperacaoProximaTentativa || st.proximaTentativa || null,
      ultimoCstat: doc.recuperacaoUltimoCstat || st.ultimoCstat || null,
      ultimoXmotivo: doc.recuperacaoUltimoXmotivo || st.ultimoXmotivo || null,
      requestId: doc.recuperacaoUltimoRequestId || st.ultimoRequestId || null,
      prioridade: doc.recuperacaoPrioridade || st.prioridade || null,
      emExecucao: this._emExecucao.has(`chave:${String(doc.chave || '').replace(/\D/g, '')}`)
    };
  }

  /**
   * @private
   */
  async _removerDaFila(item, motivo, correlationId, timeout, opcoes = {}) {
    const id = Number(item.id);
    delete this._estado.docs[String(id)];
    this._estado.metricas.removidos += 1;
    if (timeout) this._estado.metricas.timeouts += 1;

    if (opcoes.statusRecuperacao) {
      await this._persistirMetadadosDoc(id, {
        statusRecuperacao: opcoes.statusRecuperacao,
        recuperacaoProximaTentativa: null,
        recuperacaoUltimoXmotivo: motivo
      });
    }
    if (opcoes.statusDocumento && timeout) {
      try {
        await this._transitionService.transicionar(
          id,
          item.status,
          opcoes.statusDocumento,
          { detalhe: motivo, origem: ORIGEM_MOTOR }
        );
      } catch { /* ignore */ }
      logXmlRecovery({
        chave: item.chave,
        status: opcoes.statusRecuperacao || StatusRecuperacaoXml.RECUPERACAO_ESGOTADA,
        motivo
      });
    }

    await this._historicoRepository.inserir({
      documentoId: id,
      statusAnterior: item.status,
      statusNovo: opcoes.statusDocumento || item.status,
      detalhe: [
        timeout
          ? 'Sprint 2 — Documento removido da fila (timeout/limite).'
          : 'Sprint 2 — Documento removido da fila de recuperação.',
        `Motivo: ${motivo}`,
        `Correlation: ${correlationId}`
      ].join('\n')
    }).catch(() => {});

    await this._emitirEvento({
      tipo: timeout
        ? TIPOS_EVENTO.RECUPERACAO_XML_TIMEOUT
        : TIPOS_EVENTO.RECUPERACAO_XML_REMOVIDO,
      documentoId: id,
      descricao: `Documento #${id} removido da fila: ${motivo}`,
      sucesso: !timeout,
      correlationId,
      detalhe: { motivo, timeout: Boolean(timeout), chave: item.chave }
    });
  }

  /** @private */
  _atualizarEstadoDoc(id, patch) {
    const key = String(id);
    this._estado.docs[key] = {
      ...(this._estado.docs[key] || {}),
      ...patch
    };
  }

  /** @private */
  async _emitirEvento(dados) {
    try {
      await this._eventosRepository.inserir({
        tipo: dados.tipo,
        origem: ORIGENS.SISTEMA,
        descricao: dados.descricao,
        resultado: dados.resultado || null,
        sucesso: dados.sucesso !== false,
        documentoId: dados.documentoId || null,
        detalhe: {
          ...(dados.detalhe || {}),
          correlationId: dados.correlationId || null,
          motor: 'RC3.7.5'
        }
      });
    } catch {
      // Eventos não devem derrubar o ciclo
    }
  }

  /** @private */
  async _carregarEstado() {
    try {
      const reg = await this._configRepository.buscarPorChave(CHAVES.ESTADO);
      if (!reg) return;
      const parsed = this._configRepository.parseValor(reg);
      if (parsed && typeof parsed === 'object') {
        this._estado = {
          ...this._estadoVazio(),
          ...parsed,
          docs: parsed.docs && typeof parsed.docs === 'object' ? parsed.docs : {},
          metricas: {
            ...this._estadoVazio().metricas,
            ...(parsed.metricas || {})
          }
        };
      }
    } catch { /* ignore */ }
  }

  /** @private */
  async _persistirEstado() {
    try {
      await this._configRepository.salvar(CHAVES.ESTADO, this._estado, 'json');
    } catch (error) {
      logCentralErro('RECUPERACAO_XML', error, { Evento: 'PERSISTIR_ESTADO' });
    }
  }
}

let _singleton = null;

function obterMotorRecuperacaoXml(deps) {
  if (deps) return new MotorRecuperacaoXmlService(deps);
  if (!_singleton) _singleton = new MotorRecuperacaoXmlService();
  return _singleton;
}

module.exports = MotorRecuperacaoXmlService;
module.exports.obterMotorRecuperacaoXml = obterMotorRecuperacaoXml;
module.exports.ORIGEM_MOTOR = ORIGEM_MOTOR;
