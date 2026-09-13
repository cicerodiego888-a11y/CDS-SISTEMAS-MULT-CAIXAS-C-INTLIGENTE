/**
 * MirxService — Motor Inteligente de Recuperação de XML (RC3.4.1 / RC3.4.2).
 *
 * Fila única + Worker único + Gate SEFAZ + backoff progressivo + SLEEP/WAKEUP.
 * RC3.4.2: em cStat 656 o documento dorme (fora da fila, sem ticks/Gate/logs spam).
 *
 * @module motores/central-entradas/mirx/MirxService
 */

const CentralDocumentosRepository = require('../repositories/CentralDocumentosRepository');
const CentralConfigRepository = require('../repositories/CentralConfigRepository');
const { DocumentoFiscalStatus } = require('../core/DocumentoFiscalStatus');
const { DocumentoDfeTipo } = require('../core/DocumentoDfeTipo');
const { MirxEstados, obterLabel, isTerminal, isSleep, resolverIndicadorVisual } = require('./MirxEstados');
const { BACKOFF_MINUTOS, calcularProximaEm, descreverBackoff } = require('./MirxBackoff');
const MirxQueue = require('./MirxQueue');
const MirxWorker = require('./MirxWorker');
const MirxAuditoria = require('./MirxAuditoria');
const { TIPOS_MIRX } = MirxAuditoria;
const { criarCorrelationId } = require('../utils/centralOperacaoLog');
const { logCentralErro } = require('../utils/centralLog');
const { ORIGENS } = require('../config/centralEventosTipos');

const CHAVE_ESTADO = 'mirx_scheduler_state';
const TICK_MS = 60 * 1000;
const LIMITE_SCAN = 50;
/** Heartbeat máximo quando todos dormem (não aumenta consumo SEFAZ). */
const MAX_SLEEP_DELAY_MS = 30 * 60 * 1000;
const MIN_TICK_DELAY_MS = 5 * 1000;
/** Scan de novos RES_NFE a cada N ticks (não a cada tick). */
const SCAN_A_CADA_TICKS = 5;

class MirxService {
  constructor(deps = {}) {
    this._documentosRepository = deps.documentosRepository
      || new CentralDocumentosRepository();
    this._configRepository = deps.configRepository || new CentralConfigRepository();
    if (deps.gate) {
      this._gate = deps.gate;
    } else if (deps.configRepository) {
      const { CentralSefazOperationalGate } = require('../services/CentralSefazOperationalGate');
      this._gate = new CentralSefazOperationalGate({
        configRepository: deps.configRepository,
        agora: deps.agora || (() => new Date()),
        autoPersist: false
      });
    } else {
      this._gate = require('../services/CentralSefazOperationalGate');
    }
    this._obterOrchestrator = deps.obterOrchestrator
      || (() => require('../CentralEntradasOrchestrator'));
    this._agora = deps.agora || (() => new Date());
    this._tickMs = deps.tickMs != null ? deps.tickMs : TICK_MS;

    this._queue = deps.queue || new MirxQueue();
    this._auditoria = deps.auditoria || new MirxAuditoria();
    this._worker = deps.worker || new MirxWorker({
      service: this,
      obterOrchestrator: this._obterOrchestrator,
      gate: this._gate,
      documentosRepository: this._documentosRepository,
      auditoria: this._auditoria,
      eventosRepository: deps.eventosRepository || null,
      agora: this._agora
    });

    /** @private @type {Map<number, Object>} */
    this._docs = new Map();
    this._timeoutId = null;
    this._ativo = false;
    this._tickEmExecucao = false;
    this._persistindo = false;
    this._ticksDesdeScan = 0;
    this._metricas = {
      documentosRecuperados: 0,
      tentativasTotais: 0,
      temposRecuperacaoMs: [],
      enfileiramentos: 0,
      jobsProcessados: 0,
      canceladosUpload: 0,
      canceladosOutros: 0,
      sleepStarts: 0,
      wakeups: 0,
      gateChecksEvitadosSleep: 0,
      ticksIgnoradosSleep: 0
    };
  }

  /** Compat: XmlWait / Dashboard usam obterGate */
  obterGate() {
    return this._gate;
  }

  estaAtivo() {
    return this._ativo;
  }

  static get BACKOFF_MINUTOS() {
    return BACKOFF_MINUTOS;
  }

  static get CHAVE_ESTADO() {
    return CHAVE_ESTADO;
  }

  /**
   * @param {number|Object} documentoOuId
   * @param {Object} [meta]
   */
  async enfileirar(documentoOuId, meta = {}) {
    const doc = typeof documentoOuId === 'object' && documentoOuId
      ? documentoOuId
      : await this._documentosRepository.buscarPorId(documentoOuId);

    if (!doc?.id) {
      return { enfileirado: false, motivo: 'documento_invalido' };
    }

    if (
      doc.status !== DocumentoFiscalStatus.AGUARDANDO_XML_COMPLETO
      || doc.tipoDocumento !== DocumentoDfeTipo.RES_NFE
    ) {
      return { enfileirado: false, motivo: 'nao_elegivel' };
    }

    const id = Number(doc.id);
    const atual = this._docs.get(id);

    // RC3.4.2 — SLEEP: fora da fila (exceto wake explícito / manual com Gate livre).
    // RC3.4.4 / RC3.4.5 — SLEEP NÃO descarta agendamento: alinha
    // proximaEm = max(atual, nova). Só impede consultas prematuras à SEFAZ.
    if (atual && isSleep(atual.estado) && meta.forcarWake !== true) {
      this._metricas.ticksIgnoradosSleep += 1;
      const anterior = atual.proximaEm || null;
      let proxima = anterior;
      let janelaAlinhada = false;
      if (meta.proximaEm) {
        const alinhado = this._maxProximaEm(anterior, meta.proximaEm);
        if (alinhado && alinhado !== anterior) {
          proxima = alinhado;
          janelaAlinhada = true;
          this.atualizarEstado(id, {
            proximaEm: proxima,
            motivo: meta.motivo || atual.motivo || 'janela_alinhada_em_sleep'
          });
          await this._auditoria.registrarTimeline({
            tipoEvento: TIPOS_MIRX.MIRX_AGENDAMENTO_ATUALIZADO,
            documentoId: id,
            chave: atual.chave || doc.chave,
            nsu: atual.nsu || doc.nsu,
            correlationId: meta.correlationId || atual.correlationId,
            estado: MirxEstados.SLEEP,
            sucesso: true,
            proximaTentativa: proxima,
            proximaEmAnterior: anterior,
            proximaEmNova: proxima,
            motivo: meta.motivo || 'Agendamento preservado em SLEEP (max Gate/NT)',
            origem: meta.origem || ORIGENS.SISTEMA
          });
          await this._persistirEstado();
        } else if (alinhado) {
          // Novo horário não atrasa mais que o atual — ainda registra preservação.
          await this._auditoria.registrarTimeline({
            tipoEvento: TIPOS_MIRX.MIRX_AGENDAMENTO_ATUALIZADO,
            documentoId: id,
            chave: atual.chave || doc.chave,
            nsu: atual.nsu || doc.nsu,
            correlationId: meta.correlationId || atual.correlationId,
            estado: MirxEstados.SLEEP,
            sucesso: true,
            proximaTentativa: proxima,
            proximaEmAnterior: anterior,
            proximaEmNova: proxima,
            motivo: meta.motivo || 'Agendamento já cobre a nova janela (preservado em SLEEP)',
            origem: meta.origem || ORIGENS.SISTEMA
          });
        }
      }
      return {
        enfileirado: false,
        motivo: 'documento_em_sleep',
        dormindo: true,
        proximaTentativa: proxima,
        janelaAlinhada,
        agendamentoPreservado: true
      };
    }

    const correlationId = meta.correlationId || atual?.correlationId || criarCorrelationId();
    this._assegurarEstado(doc, {
      correlationId,
      motivo: meta.motivo || 'enfileirar',
      estadoInicial: MirxEstados.AGUARDANDO_JANELA_SEFAZ,
      proximaEm: meta.proximaEm || null
    });

    if (meta.proximaEm && meta.forcarWake !== true) {
      const anterior = atual?.proximaEm || null;
      this.atualizarEstado(doc.id, {
        estado: MirxEstados.AGUARDANDO_JANELA_SEFAZ,
        proximaEm: meta.proximaEm,
        motivo: meta.motivo || 'aguardando_janela_sefaz'
      });
      await this._auditoria.registrarTimeline({
        tipoEvento: TIPOS_MIRX.MIRX_AGENDAMENTO_ATUALIZADO,
        documentoId: doc.id,
        chave: doc.chave,
        nsu: doc.nsu,
        correlationId,
        estado: MirxEstados.AGUARDANDO_JANELA_SEFAZ,
        sucesso: true,
        proximaTentativa: meta.proximaEm,
        proximaEmAnterior: anterior,
        proximaEmNova: meta.proximaEm,
        motivo: meta.motivo || 'Recuperação agendada (janela NT / pós-ciência)',
        origem: meta.origem || ORIGENS.SISTEMA
      });
    } else {
      this.atualizarEstado(doc.id, {
        estado: MirxEstados.CONSULTA_PROGRAMADA,
        dormindoDesde: null
      });
    }

    const result = this._queue.enqueue({
      documentoId: doc.id,
      origem: meta.origem || ORIGENS.SISTEMA,
      correlationId,
      prioridade: meta.prioridade,
      forcarAgora: meta.forcarAgora === true,
      motivo: meta.motivo || 'recuperacao_xml'
    });

    this._metricas.enfileiramentos += 1;
    await this._auditoria.registrarTimeline({
      tipoEvento: TIPOS_MIRX.MIRX_ENFILEIRADO,
      documentoId: doc.id,
      chave: doc.chave,
      nsu: doc.nsu,
      correlationId,
      estado: MirxEstados.CONSULTA_PROGRAMADA,
      motivo: meta.motivo || 'Solicitação enfileirada no MIRX',
      origem: meta.origem,
      sucesso: true
    });

    await this._persistirEstado();
    return result;
  }

  /**
   * RC3.4.2 — entra em SLEEP (656). Remove da fila; log único.
   * @param {number} documentoId
   * @param {Object} [meta]
   */
  async entrarSleep(documentoId, meta = {}) {
    const id = Number(documentoId);
    const atual = this._docs.get(id);
    if (!atual) return { ok: false, motivo: 'sem_estado' };

    this._queue.remove(id);

    if (atual.estado === MirxEstados.SLEEP && atual.dormindoDesde) {
      // Já dormindo: sem log/timeline SLEEP repetidos.
      // RC3.4.4/5 — só atrasa wakeup (max); nunca antecipa liberação do Gate.
      if (meta.proximaEm) {
        const anterior = atual.proximaEm || null;
        const alinhado = this._maxProximaEm(anterior, meta.proximaEm);
        if (alinhado && alinhado !== anterior) {
          this.atualizarEstado(id, {
            proximaEm: alinhado,
            ultimoCStat: meta.cStat || atual.ultimoCStat || '656',
            motivo: meta.motivo || atual.motivo
          });
          await this._auditoria.registrarTimeline({
            tipoEvento: TIPOS_MIRX.MIRX_AGENDAMENTO_ATUALIZADO,
            documentoId: id,
            chave: atual.chave,
            nsu: atual.nsu,
            correlationId: meta.correlationId || atual.correlationId,
            estado: MirxEstados.SLEEP,
            sucesso: true,
            proximaTentativa: alinhado,
            proximaEmAnterior: anterior,
            proximaEmNova: alinhado,
            motivo: meta.motivo || 'SLEEP: proximaEm alinhada (max)',
            origem: meta.origem || ORIGENS.SISTEMA
          });
          await this._persistirEstado();
        }
      }
      return {
        ok: true,
        jaDormia: true,
        proximaEm: this._docs.get(id)?.proximaEm || atual.proximaEm
      };
    }

    const proxima = meta.proximaEm
      || atual.proximaEm
      || calcularProximaEm(Math.max(atual.tentativas || 0, 3), this._agora());

    this.atualizarEstado(id, {
      estado: MirxEstados.SLEEP,
      dormindoDesde: this._agora().toISOString(),
      proximaEm: proxima,
      ultimoCStat: meta.cStat || atual.ultimoCStat || '656',
      ultimoResultado: meta.resultado || 'CONSUMO_INDEVIDO_656',
      ultimoMetodo: meta.metodo || atual.ultimoMetodo || 'DistDFe',
      tentativas: meta.tentativas != null ? meta.tentativas : atual.tentativas,
      motivo: meta.motivo
        || 'cStat 656 — documento em SLEEP até próxima tentativa automática'
    });

    this._metricas.sleepStarts += 1;

    await this._auditoria.registrarTimeline({
      tipoEvento: TIPOS_MIRX.MIRX_SLEEP_START,
      documentoId: id,
      chave: atual.chave,
      nsu: atual.nsu,
      correlationId: meta.correlationId || atual.correlationId,
      tentativa: meta.tentativas != null ? meta.tentativas : atual.tentativas,
      metodo: meta.metodo || atual.ultimoMetodo,
      cStat: '656',
      estado: MirxEstados.SLEEP,
      sucesso: true,
      proximaTentativa: proxima,
      motivo: 'SLEEP iniciado — sem fila, sem tick, sem Gate até wakeup',
      origem: meta.origem || ORIGENS.SISTEMA,
      backoffLabel: descreverBackoff(meta.tentativas != null ? meta.tentativas : atual.tentativas).label
    });

    await this._persistirEstado();
    return { ok: true, jaDormia: false, proximaEm: proxima };
  }

  /**
   * RC3.4.2 — acorda documento e recolocá na fila (só após proximaTentativa).
   */
  async despertar(documentoId, meta = {}) {
    const id = Number(documentoId);
    const atual = this._docs.get(id);
    if (!atual || !isSleep(atual.estado)) {
      return { ok: false, motivo: 'nao_esta_em_sleep' };
    }

    this.atualizarEstado(id, {
      estado: MirxEstados.CONSULTA_PROGRAMADA,
      dormindoDesde: null,
      motivo: meta.motivo || 'WAKEUP — retoma recuperação automática'
    });

    this._metricas.wakeups += 1;

    await this._auditoria.registrarTimeline({
      tipoEvento: TIPOS_MIRX.MIRX_WAKEUP,
      documentoId: id,
      chave: atual.chave,
      nsu: atual.nsu,
      correlationId: meta.correlationId || atual.correlationId,
      tentativa: atual.tentativas,
      estado: MirxEstados.CONSULTA_PROGRAMADA,
      sucesso: true,
      motivo: 'WAKEUP — documento reenfileirado para nova tentativa',
      origem: meta.origem || ORIGENS.SISTEMA
    });

    await this.enfileirar(
      { id, chave: atual.chave, nsu: atual.nsu, status: DocumentoFiscalStatus.AGUARDANDO_XML_COMPLETO, tipoDocumento: DocumentoDfeTipo.RES_NFE },
      {
        forcarWake: true,
        correlationId: atual.correlationId,
        origem: meta.origem || ORIGENS.SISTEMA,
        motivo: meta.motivo || 'wakeup_automatico',
        prioridade: 40
      }
    );

    return { ok: true };
  }

  /**
   * RC3.4.2 — botão "Solicitar XML Completo" (exceção manual).
   * Gate bloqueado → mensagem + NÃO enfileira.
   * Gate livre → recuperação imediata via worker.
   */
  async solicitarXmlManual(documentoId, opcoes = {}) {
    const id = Number(documentoId);
    const doc = await this._documentosRepository.buscarPorId(id);
    if (!doc) {
      return { sucesso: false, codigo: 'DOCUMENTO_INEXISTENTE', mensagem: 'Documento não encontrado.' };
    }

    const correlationId = opcoes.correlationId || criarCorrelationId();
    const auth = await this._gate.autorizarConsultaDistDfe({
      correlationId,
      documentoId: id,
      chave: doc.chave,
      nsu: doc.nsu,
      origem: ORIGENS.MANUAL || 'manual',
      forcar: false,
      forcarAdminConfirmado: false,
      confirmacaoAdmin: false,
      motivo: 'solicitacao_manual_xml'
    });

    if (!auth.permitido) {
      const estado = this.obterEstadoDocumento(id) || {};
      const proxima = auth.proximaConsultaEm
        || estado.proximaTentativa
        || this._gate.obterBloqueio656?.()?.bloqueadoAte
        || null;

      // Não enfileira; garante SLEEP se for 656.
      if (auth.codigo === 'BLOQUEADO_CONSUMO_INDEVIDO_656' || auth.cStat === '656') {
        if (this._docs.has(id) || doc.status === DocumentoFiscalStatus.AGUARDANDO_XML_COMPLETO) {
          this._assegurarEstado(doc, { correlationId, motivo: 'manual_gate_656' });
          await this.entrarSleep(id, {
            proximaEm: proxima,
            correlationId,
            motivo: 'Solicitação manual bloqueada — documento permanece em SLEEP',
            origem: 'manual'
          });
        }
      }

      return {
        sucesso: false,
        ignorado: true,
        gateBloqueado: true,
        codigo: auth.codigo || 'GATE_BLOQUEADO',
        cStat: auth.cStat || '656',
        proximaTentativa: proxima,
        proximaTentativaLabel: this._formatarDataHora(proxima),
        mensagem: this._mensagemGateBloqueadoManual(proxima),
        naoEnfileirado: true
      };
    }

    this._assegurarEstado(doc, {
      correlationId,
      motivo: 'solicitacao_manual',
      estadoInicial: MirxEstados.CONSULTA_PROGRAMADA
    });

    if (isSleep(this._docs.get(id)?.estado)) {
      await this.despertar(id, { motivo: 'solicitacao_manual_gate_livre', origem: 'manual' });
    } else {
      await this.enfileirar(doc, {
        forcarWake: true,
        forcarAgora: true,
        prioridade: 1,
        correlationId,
        origem: 'manual',
        motivo: 'solicitacao_manual_xml'
      });
    }

    if (!this._worker.estaExecutando()) {
      const job = this._queue.dequeue((j) => Number(j.documentoId) === id)
        || this._queue.dequeue();
      if (job) {
        this._metricas.jobsProcessados += 1;
        this._metricas.tentativasTotais += 1;
        const resultado = await this._worker.processar({
          ...job,
          origem: 'manual',
          correlationId
        });
        return {
          sucesso: resultado?.sucesso !== false,
          ...resultado,
          mensagem: resultado?.xmlCompleto
            ? 'XML completo recuperado.'
            : (resultado?.mensagem || 'Recuperação MIRX executada. O acompanhamento continua automático.'),
          manual: true
        };
      }
    }

    return {
      sucesso: true,
      enfileirado: true,
      mensagem: 'Solicitação aceita. O MIRX executará a recuperação em instantes.',
      manual: true
    };
  }

  /** @private */
  _mensagemGateBloqueadoManual(proxima) {
    const quando = this._formatarDataHora(proxima) || 'em breve';
    return [
      'Consulta temporariamente bloqueada pela SEFAZ (cStat 656).',
      '',
      `Próxima tentativa automática: ${quando}`,
      '',
      'Nenhuma ação é necessária. O MIRX fará uma nova tentativa automaticamente.'
    ].join('\n');
  }

  /** @private */
  _formatarDataHora(iso) {
    if (!iso) return null;
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return null;
    const pad = (n) => String(n).padStart(2, '0');
    return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  /**
   * Alias compatível com XmlWait.cancelar
   */
  cancelar(documentoId, motivo = 'stop') {
    return this.remover(documentoId, motivo);
  }

  cancelarPorChave(chave, motivo = 'upload') {
    const alvo = String(chave || '').replace(/\D/g, '');
    if (!alvo) return false;
    for (const [id, estado] of this._docs.entries()) {
      if (String(estado.chave || '').replace(/\D/g, '') === alvo) {
        return this.remover(id, motivo);
      }
    }
    return false;
  }

  remover(documentoId, motivo = 'remover') {
    const id = Number(documentoId);
    this._queue.remove(id);
    const tinha = this._docs.delete(id);
    if (tinha) this._persistirEstado().catch(() => {});
    this._auditoria.logOperacional('MIRX_REMOVE', {
      documentoId: id,
      motivo
    });
    return tinha;
  }

  obterEstadoDocumento(documentoId) {
    const id = Number(documentoId);
    const estado = this._docs.get(id);
    const bloqueio = this._gate.obterBloqueio656?.() || { ativo: false };
    const e593 = this._gate.obterEstado593?.() || { ativo: false };
    const agora = this._agora().getTime();

    if (!estado && !bloqueio.ativo && !e593.ativo) return null;

    const dormindo = estado ? isSleep(estado.estado) : Boolean(bloqueio.ativo);
    const base = estado
      ? {
        aguardandoXml: true,
        mirx: true,
        estadoMirx: estado.estado,
        estadoMirxLabel: obterLabel(estado.estado),
        tentativas: estado.tentativas || 0,
        proximaTentativa: estado.proximaEm,
        ultimaConsulta: estado.ultimaConsultaEm,
        ultimoMetodo: estado.ultimoMetodo || null,
        ultimoCStat: estado.ultimoCStat || null,
        ultimoResultado: estado.ultimoResultado || null,
        motivo: estado.motivo || null,
        iniciadoEm: estado.iniciadoEm,
        dormindoDesde: estado.dormindoDesde || null,
        tempoAguardandoMs: Math.max(0, agora - new Date(estado.iniciadoEm).getTime()),
        backoff: descreverBackoff(estado.tentativas || 0),
        correlationId: estado.correlationId,
        nsu: estado.nsu || null,
        chave: estado.chave || null
      }
      : {
        aguardandoXml: true,
        mirx: true,
        estadoMirx: bloqueio.ativo ? MirxEstados.SLEEP : MirxEstados.AGUARDANDO_JANELA_SEFAZ,
        estadoMirxLabel: obterLabel(
          bloqueio.ativo ? MirxEstados.SLEEP : MirxEstados.AGUARDANDO_JANELA_SEFAZ
        ),
        tentativas: 0,
        proximaTentativa: bloqueio.bloqueadoAte || null,
        ultimaConsulta: bloqueio.ultimaConsulta || null,
        ultimoMetodo: null,
        ultimoCStat: bloqueio.ativo ? '656' : null,
        ultimoResultado: null,
        motivo: bloqueio.motivo || null,
        iniciadoEm: null,
        dormindoDesde: bloqueio.ativo ? (bloqueio.desde || null) : null,
        tempoAguardandoMs: 0,
        backoff: descreverBackoff(0),
        correlationId: bloqueio.correlationId || null,
        nsu: bloqueio.nsu || null,
        chave: bloqueio.chave || null
      };

    const tempoRestanteMs = base.proximaTentativa
      ? Math.max(0, new Date(base.proximaTentativa).getTime() - agora)
      : 0;

    const estadoOp = this._gate.obterEstadoOperacional?.({
      documentosAguardando: this._docs.size
    }) || null;

    const visual = resolverIndicadorVisual({
      estado: base.estadoMirx,
      consultaBloqueada: Boolean(dormindo || bloqueio.ativo || e593.ativo),
      cStat: base.ultimoCStat
    });

    return {
      ...base,
      dormindo,
      dormindoLabel: dormindo ? 'Sim' : 'Não',
      statusGate: estadoOp?.codigo || (bloqueio.ativo ? 'BLOCKED' : (e593.ativo ? 'CONFIG_ERROR' : 'NORMAL')),
      motivoBloqueio: dormindo || bloqueio.ativo
        ? (base.motivo || bloqueio.motivo || 'cStat 656 — consumo indevido')
        : (e593.ativo ? (e593.motivo || 'Erro certificado/CNPJ') : null),
      metodoProgramado: dormindo
        ? 'Aguardando wakeup → DistDFe → consChNFe'
        : (base.ultimoMetodo || 'DistDFe → consChNFe'),
      indicadorVisual: visual.indicador,
      labelVisual: visual.label,
      corVisual: visual.cor,
      tempoRestanteMs,
      tempoRestanteLabel: this._formatarDuracao(tempoRestanteMs),
      tempoAguardandoLabel: this._formatarDuracao(base.tempoAguardandoMs),
      bloqueio656: bloqueio.ativo || dormindo
        ? (bloqueio.ativo ? bloqueio : {
          ativo: true,
          cStat: '656',
          bloqueadoAte: base.proximaTentativa,
          motivo: base.motivo
        })
        : null,
      estado593: e593.ativo ? e593 : null,
      consultaBloqueada: Boolean(dormindo || bloqueio.ativo || e593.ativo),
      proximaTentativa: (bloqueio.ativo && bloqueio.bloqueadoAte)
        ? bloqueio.bloqueadoAte
        : base.proximaTentativa,
      estadoOperacional: estadoOp
    };
  }

  obterTelemetria() {
    const tempos = this._metricas.temposRecuperacaoMs;
    const media = tempos.length
      ? Math.round(tempos.reduce((a, b) => a + b, 0) / tempos.length)
      : null;
    const gateTel = this._gate.obterTelemetria?.({
      documentosAguardando: this._docs.size,
      proximaConsultaPrevista: this._proximaGlobal(),
      quantidadeTentativas: this._metricas.tentativasTotais
    }) || {};

    return {
      motor: 'MIRX',
      versao: 'RC3.4.2',
      documentosAguardando: this._docs.size,
      documentosEmSleep: [...this._docs.values()].filter((e) => isSleep(e.estado)).length,
      fila: this._queue.size(),
      documentosRecuperados: this._metricas.documentosRecuperados,
      tempoMedioRecuperacaoMs: media,
      numeroTentativas: this._metricas.tentativasTotais,
      jobsProcessados: this._metricas.jobsProcessados,
      enfileiramentos: this._metricas.enfileiramentos,
      sleepStarts: this._metricas.sleepStarts,
      wakeups: this._metricas.wakeups,
      gateChecksEvitadosSleep: this._metricas.gateChecksEvitadosSleep,
      ticksIgnoradosSleep: this._metricas.ticksIgnoradosSleep,
      schedulerAtivo: this._ativo,
      backoffMinutos: [...BACKOFF_MINUTOS],
      workerOcupado: this._worker.estaExecutando(),
      ...gateTel,
      painelOperacional: this._gate.obterPainelOperacional?.({
        documentosAguardando: this._docs.size,
        proximaConsultaPrevista: this._proximaGlobal(),
        quantidadeTentativas: this._metricas.tentativasTotais
      }) || null
    };
  }

  obterStatus() {
    return {
      ativo: this._ativo,
      tickEmExecucao: this._tickEmExecucao,
      documentos: this._docs.size,
      fila: this._queue.size(),
      telemetria: this.obterTelemetria()
    };
  }

  atualizarEstado(documentoId, patch = {}) {
    const id = Number(documentoId);
    const atual = this._docs.get(id);
    if (!atual) return null;
    const novo = { ...atual, ...patch, atualizadoEm: this._agora().toISOString() };
    this._docs.set(id, novo);
    this._persistirEstado().catch(() => {});
    return novo;
  }

  async marcarRecuperado(documentoId, doc, meta = {}) {
    const id = Number(documentoId);
    const estado = this._docs.get(id);
    const tempoTotal = meta.tempoMs != null
      ? meta.tempoMs
      : (estado?.iniciadoEm
        ? Date.now() - new Date(estado.iniciadoEm).getTime()
        : 0);

    this._metricas.documentosRecuperados += 1;
    this._metricas.temposRecuperacaoMs.push(tempoTotal);
    if (this._metricas.temposRecuperacaoMs.length > 200) {
      this._metricas.temposRecuperacaoMs.shift();
    }

    await this._auditoria.registrarTimeline({
      tipoEvento: TIPOS_MIRX.MIRX_XML_RECUPERADO,
      documentoId: id,
      chave: doc?.chave || estado?.chave,
      nsu: doc?.nsu || estado?.nsu,
      correlationId: meta.correlationId || estado?.correlationId,
      tentativa: meta.tentativa || estado?.tentativas,
      metodo: meta.metodo || 'DistDFe',
      cStat: meta.cStat,
      estado: MirxEstados.XML_RECUPERADO,
      sucesso: true,
      tempoMs: tempoTotal,
      motivo: 'XML completo (procNFe/NFe) recuperado — ciclo reiniciável'
    });

    this._docs.delete(id);
    this._queue.remove(id);
    await this._persistirEstado();

    // Processamento Parser/MIIP via Orchestrator (já chamado no ciclo quando xmlCompleto).
    return { sucesso: true, estado: MirxEstados.PROCESSADO };
  }

  async iniciar() {
    if (this._ativo) return;
    await this._carregarEstado();
    await this.recuperarPendentes({ motivo: 'boot' });
    this._ativo = true;
    this._agendarTick(1500);
    this._auditoria.logOperacional('MIRX_START', {
      motivo: 'scheduler_iniciado',
      tentativa: this._docs.size
    });
  }

  parar(opcoes = {}) {
    if (this._timeoutId) {
      clearTimeout(this._timeoutId);
      this._timeoutId = null;
    }
    const estava = this._ativo;
    this._ativo = false;
    this._tickEmExecucao = false;
    if (estava) {
      this._auditoria.logOperacional('MIRX_STOP', {
        correlationId: opcoes.correlationId,
        motivo: opcoes.motivo || 'parada_explicita'
      });
    }
  }

  async reiniciar() {
    this.parar({ motivo: 'reiniciar' });
    await this.iniciar();
  }

  async recuperarPendentes(opcoes = {}) {
    const lista = await this._documentosRepository.listarPorStatus(
      DocumentoFiscalStatus.AGUARDANDO_XML_COMPLETO,
      LIMITE_SCAN
    );
    const candidatos = (lista || []).filter(
      (d) => d.tipoDocumento === DocumentoDfeTipo.RES_NFE
    );

    let inscritos = 0;
    let ignoradosSleep = 0;

    for (const doc of candidatos) {
      const id = Number(doc.id);
      const atual = this._docs.get(id);

      // RC3.4.2 — já em SLEEP: não reentra na fila / sem log.
      if (atual && isSleep(atual.estado)) {
        ignoradosSleep += 1;
        this._metricas.gateChecksEvitadosSleep += 1;
        continue;
      }

      const jaConhecido = Boolean(atual);
      this._assegurarEstado(doc, {
        correlationId: atual?.correlationId || criarCorrelationId(),
        motivo: opcoes.motivo || 'recuperacao'
      });

      // Apenas novos ou scan que pede reenqueue — nunca sleepers.
      if (!jaConhecido || opcoes.reenfileirarConhecidos === true) {
        if (isSleep(this._docs.get(id)?.estado)) continue;
        this._queue.enqueue({
          documentoId: doc.id,
          origem: ORIGENS.SISTEMA,
          motivo: opcoes.motivo || 'scan_pendentes',
          prioridade: 100
        });
        inscritos += 1;
      }
    }

    await this._persistirEstado();
    return { inscritos, ignoradosSleep };
  }

  // —— aliases Gate (compat XmlWait UI) ——
  obterBloqueio656() {
    return this._gate.obterBloqueio656?.() || { ativo: false };
  }

  estaBloqueadoDistDfe() {
    return Boolean(this._gate.estaBloqueado656?.() || this._gate.estaSuspenso593?.());
  }

  registrarBloqueio656(dados = {}) {
    return this._gate.registrarBloqueio656?.(dados);
  }

  limparBloqueio656(motivo = 'limpeza') {
    return this._gate.limparBloqueio656?.(motivo);
  }

  limparErro593(motivo = 'limpeza') {
    return this._gate.limparErro593?.(motivo);
  }

  registrarConsultaEvitada656(ctx = {}) {
    return this._gate.registrarConsultaEvitada656?.(ctx);
  }

  /** @private */
  _assegurarEstado(doc, meta = {}) {
    const id = Number(doc.id);
    if (!id) return null;
    if (this._docs.has(id)) {
      const e = this._docs.get(id);
      e.chave = doc.chave || e.chave;
      e.nsu = doc.nsu || e.nsu;
      return e;
    }

    const agora = this._agora();
    const estado = {
      documentoId: id,
      chave: doc.chave || null,
      nsu: doc.nsu || null,
      estado: meta.estadoInicial || MirxEstados.AGUARDANDO_JANELA_SEFAZ,
      tentativas: 0,
      iniciadoEm: agora.toISOString(),
      ultimaConsultaEm: null,
      ultimoMetodo: null,
      ultimoCStat: null,
      ultimoResultado: null,
      motivo: meta.motivo || 'inscricao',
      proximaEm: meta.proximaEm || calcularProximaEm(0, agora),
      dormindoDesde: null,
      correlationId: meta.correlationId || criarCorrelationId(),
      atualizadoEm: agora.toISOString()
    };
    this._docs.set(id, estado);
    return estado;
  }

  /** @private RC3.4.5 — max de duas datas ISO (nunca antecipa). */
  _maxProximaEm(a, b) {
    const ta = a ? new Date(a).getTime() : NaN;
    const tb = b ? new Date(b).getTime() : NaN;
    if (Number.isNaN(ta) && Number.isNaN(tb)) return null;
    if (Number.isNaN(ta)) return b;
    if (Number.isNaN(tb)) return a;
    return tb > ta ? b : a;
  }

  /** @private */
  _proximaGlobal() {
    return [...this._docs.values()]
      .map((e) => e.proximaEm)
      .filter(Boolean)
      .sort()[0] || null;
  }

  /** @private — delay até próximo wakeup/devido (economiza CPU em SLEEP). */
  _calcularProximoDelayMs() {
    const agora = this._agora().getTime();
    let next = null;
    for (const e of this._docs.values()) {
      if (!e.proximaEm || isTerminal(e.estado)) continue;
      const t = new Date(e.proximaEm).getTime();
      if (Number.isNaN(t)) continue;
      if (next == null || t < next) next = t;
    }
    if (next == null) return this._tickMs;
    const delay = next - agora;
    if (delay <= 0) return MIN_TICK_DELAY_MS;
    return Math.min(Math.max(delay, MIN_TICK_DELAY_MS), MAX_SLEEP_DELAY_MS);
  }

  /** @private */
  async _despertarDevidos() {
    const agora = this._agora().getTime();
    const sleepers = [...this._docs.values()].filter((e) => isSleep(e.estado));
    let acordados = 0;
    for (const e of sleepers) {
      const t = new Date(e.proximaEm).getTime();
      if (Number.isNaN(t) || t > agora) {
        // Ainda dormindo: remove da fila se alguém reenfileirou.
        if (this._queue.has(e.documentoId)) {
          this._queue.remove(e.documentoId);
          this._metricas.ticksIgnoradosSleep += 1;
        }
        continue;
      }
      await this.despertar(e.documentoId, { motivo: 'wakeup_proxima_tentativa' });
      acordados += 1;
    }
    return acordados;
  }

  /** @private */
  _formatarDuracao(ms) {
    const seg = Math.max(0, Math.floor(Number(ms) / 1000));
    if (seg < 60) return `${seg}s`;
    if (seg < 3600) return `${Math.floor(seg / 60)} min`;
    const h = Math.floor(seg / 3600);
    const m = Math.floor((seg % 3600) / 60);
    return `${h}h ${m}min`;
  }

  /** @private */
  _agendarTick(delayMs) {
    if (this._timeoutId) clearTimeout(this._timeoutId);
    this._timeoutId = setTimeout(() => {
      this._executarTick().catch((error) => {
        logCentralErro('MIRX', error, { Evento: 'MIRX_TICK_ERRO' });
      });
    }, Math.max(0, delayMs));
  }

  /** @private */
  async _executarTick() {
    if (!this._ativo) return;
    if (this._tickEmExecucao) {
      this._agendarTick(this._tickMs);
      return;
    }

    this._tickEmExecucao = true;
    try {
      // 1) Acorda quem atingiu proximaTentativa (único momento de reentrada).
      await this._despertarDevidos();

      // 2) Scan periódico de novos RES_NFE (não a cada tick — RC3.4.2).
      this._ticksDesdeScan += 1;
      if (this._ticksDesdeScan >= SCAN_A_CADA_TICKS) {
        this._ticksDesdeScan = 0;
        await this.recuperarPendentes({ motivo: 'scan_periodico' });
      }

      // 3) Enfileira apenas devidos NÃO-SLEEP.
      const agora = this._agora().getTime();
      const devidos = [...this._docs.values()]
        .filter((e) => {
          if (isTerminal(e.estado)) return false;
          if (isSleep(e.estado)) return false;
          if (e.estado === MirxEstados.CONSULTANDO_XML) return false;
          const t = new Date(e.proximaEm).getTime();
          return !Number.isNaN(t) && t <= agora;
        })
        .sort((a, b) => new Date(a.proximaEm) - new Date(b.proximaEm));

      for (const e of devidos) {
        this._queue.enqueue({
          documentoId: e.documentoId,
          correlationId: e.correlationId,
          origem: ORIGENS.SISTEMA,
          motivo: 'tick_devido',
          prioridade: 50
        });
      }

      // 4) Remove da fila qualquer sleeper residual.
      for (const e of this._docs.values()) {
        if (isSleep(e.estado) && this._queue.has(e.documentoId)) {
          this._queue.remove(e.documentoId);
          this._metricas.ticksIgnoradosSleep += 1;
        }
      }

      if (!this._worker.estaExecutando() && this._queue.size() > 0) {
        const job = this._queue.dequeue((j) => {
          const est = this._docs.get(Number(j.documentoId));
          return !est || !isSleep(est.estado);
        });
        if (job) {
          this._metricas.jobsProcessados += 1;
          this._metricas.tentativasTotais += 1;
          await this._worker.processar(job);
        }
      }
    } finally {
      this._tickEmExecucao = false;
      if (this._ativo) this._agendarTick(this._calcularProximoDelayMs());
    }
  }

  /** @private */
  async _carregarEstado() {
    try {
      let parsed = null;
      if (typeof this._configRepository.buscarPorChave === 'function') {
        const registro = await this._configRepository.buscarPorChave(CHAVE_ESTADO);
        parsed = typeof this._configRepository.parseValor === 'function'
          ? this._configRepository.parseValor(registro)
          : (registro?.valor || null);
        if (typeof parsed === 'string') {
          try { parsed = JSON.parse(parsed); } catch { parsed = null; }
        }
      } else if (typeof this._configRepository.obter === 'function') {
        const raw = await this._configRepository.obter(CHAVE_ESTADO);
        parsed = typeof raw?.valor === 'string' ? JSON.parse(raw.valor) : (raw?.valor || null);
      }
      if (!parsed || typeof parsed !== 'object') {
        // Migração suave do estado legado xml_wait
        if (typeof this._configRepository.buscarPorChave === 'function') {
          const legado = await this._configRepository.buscarPorChave('xml_wait_scheduler_state');
          parsed = typeof this._configRepository.parseValor === 'function'
            ? this._configRepository.parseValor(legado)
            : null;
          if (typeof parsed === 'string') {
            try { parsed = JSON.parse(parsed); } catch { parsed = null; }
          }
        }
      }
      if (!parsed || typeof parsed !== 'object') return;

      const docs = parsed.documentos || parsed.docs || [];
      for (const d of docs) {
        if (!d?.documentoId) continue;
        this._docs.set(Number(d.documentoId), {
          documentoId: Number(d.documentoId),
          chave: d.chave || null,
          nsu: d.nsu || null,
          estado: d.estado || MirxEstados.CONSULTA_PROGRAMADA,
          tentativas: Number(d.tentativas) || 0,
          iniciadoEm: d.iniciadoEm || this._agora().toISOString(),
          ultimaConsultaEm: d.ultimaConsultaEm || null,
          ultimoMetodo: d.ultimoMetodo || null,
          ultimoCStat: d.ultimoCStat || null,
          ultimoResultado: d.ultimoResultado || null,
          motivo: d.motivo || null,
          proximaEm: d.proximaEm || calcularProximaEm(Number(d.tentativas) || 0),
          dormindoDesde: d.dormindoDesde || null,
          correlationId: d.correlationId || criarCorrelationId(),
          atualizadoEm: d.atualizadoEm || null
        });
      }

      // Migra BLOQUEADO_656 legado → SLEEP (RC3.4.2)
      for (const [id, e] of this._docs.entries()) {
        if (e.estado === MirxEstados.BLOQUEADO_656) {
          e.estado = MirxEstados.SLEEP;
          e.dormindoDesde = e.dormindoDesde || e.atualizadoEm || this._agora().toISOString();
          this._docs.set(id, e);
        }
      }

      if (parsed.gateState && typeof this._gate.hidratar === 'function') {
        this._gate.hidratar(parsed.gateState);
      }
    } catch (error) {
      logCentralErro('MIRX', error, { Motivo: 'falha_carregar_estado' });
    }
  }

  /** @private */
  async _persistirEstado() {
    if (this._persistindo) return;
    this._persistindo = true;
    try {
      const gateState = typeof this._gate.serializar === 'function'
        ? this._gate.serializar()
        : null;
      await this._configRepository.salvar(CHAVE_ESTADO, {
        versao: 'RC3.4.2',
        atualizadoEm: this._agora().toISOString(),
        documentos: [...this._docs.values()],
        gateState,
        metricas: {
          documentosRecuperados: this._metricas.documentosRecuperados,
          tentativasTotais: this._metricas.tentativasTotais,
          enfileiramentos: this._metricas.enfileiramentos,
          jobsProcessados: this._metricas.jobsProcessados,
          sleepStarts: this._metricas.sleepStarts,
          wakeups: this._metricas.wakeups,
          gateChecksEvitadosSleep: this._metricas.gateChecksEvitadosSleep,
          ticksIgnoradosSleep: this._metricas.ticksIgnoradosSleep
        }
      }, 'json');
    } catch (error) {
      logCentralErro('MIRX', error, { Motivo: 'falha_persistir_estado' });
    } finally {
      this._persistindo = false;
    }
  }
}

const instancia = new MirxService();

module.exports = instancia;
module.exports.MirxService = MirxService;
module.exports.CHAVE_ESTADO = CHAVE_ESTADO;
module.exports.BACKOFF_MINUTOS = BACKOFF_MINUTOS;
module.exports.MirxEstados = MirxEstados;
