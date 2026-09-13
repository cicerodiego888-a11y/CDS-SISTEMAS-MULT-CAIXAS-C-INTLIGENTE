/**
 * MIRX Worker único — consultas DistDFe/consChNFe de recuperação (RC3.4.1).
 *
 * Regras:
 * - Um job por vez (coordenado pelo MirxService + mutex DistDFe).
 * - Gate SEFAZ obrigatório — nunca ignorarBloqueio656.
 * - forcarConsulta=false por padrão (respeita janela NT / NSU cooldown).
 * - forcarConsulta=true somente com justificativa técnica documentada
 *   (ex.: admin confirmado após Gate liberado, ou primeira inscrição pós-ciência
 *   já fora da janela).
 *
 * @module motores/central-entradas/mirx/MirxWorker
 */

const { DocumentoFiscalStatus } = require('../core/DocumentoFiscalStatus');
const { DocumentoDfeTipo } = require('../core/DocumentoDfeTipo');
const { MirxEstados } = require('./MirxEstados');
const { calcularProximaEm, descreverBackoff } = require('./MirxBackoff');
const { TIPOS_MIRX } = require('./MirxAuditoria');
const { criarCorrelationId } = require('../utils/centralOperacaoLog');
const { ORIGENS, TIPOS_EVENTO } = require('../config/centralEventosTipos');

class MirxWorker {
  /**
   * @param {Object} deps
   * @param {import('./MirxService')} deps.service
   * @param {Function} deps.obterOrchestrator
   * @param {Object} deps.gate — CentralSefazOperationalGate singleton
   * @param {Object} deps.documentosRepository
   * @param {import('./MirxAuditoria')} deps.auditoria
   * @param {Object} [deps.eventosRepository]
   * @param {Function} [deps.agora]
   */
  constructor(deps = {}) {
    this._service = deps.service;
    this._obterOrchestrator = deps.obterOrchestrator
      || (() => require('../CentralEntradasOrchestrator'));
    this._gate = deps.gate || require('../services/CentralSefazOperationalGate');
    this._documentosRepository = deps.documentosRepository;
    this._auditoria = deps.auditoria;
    this._eventosRepository = deps.eventosRepository || null;
    this._agora = deps.agora || (() => new Date());
    this._executando = false;
  }

  /** @private */
  _obterEventosRepository() {
    if (!this._eventosRepository) {
      this._eventosRepository = new (require('../repositories/CentralEventosRepository'))();
    }
    return this._eventosRepository;
  }

  /**
   * RC3.4.4 — modoRecuperacaoXml não deve rodar DistDFe/consChNFe antes da Ciência.
   * Evita Gate/SLEEP prematuros; a inscrição correta ocorre em _registrarAguardandoXml.
   * @private
   */
  async _temCienciaAceita(documentoId) {
    try {
      const repo = this._obterEventosRepository();
      if (typeof repo.existePorTipoDocumento === 'function') {
        return repo.existePorTipoDocumento(TIPOS_EVENTO.MANIFESTACAO_ACEITA, documentoId);
      }
      const lista = await repo.listar({
        tipo: TIPOS_EVENTO.MANIFESTACAO_ACEITA,
        documentoId,
        limite: 1
      });
      return Boolean(lista?.[0]);
    } catch {
      // Sem acesso a eventos: não bloqueia recuperação (fail-open).
      return true;
    }
  }

  /**
   * RC3.4.4 — lê proximaConsultaEm da janela NT pós-ciência (sem SOAP).
   * @private
   */
  async _obterJanelaPosCiencia(documentoId) {
    try {
      const repo = this._obterEventosRepository();
      const eventos = await repo.listar({
        tipo: TIPOS_EVENTO.CONSULTA_DFE_POS_MANIFESTACAO,
        documentoId,
        limite: 5
      });
      let melhor = null;
      for (const ev of eventos || []) {
        const iso = ev?.detalhe?.proximaConsultaEm;
        if (!iso) continue;
        const t = new Date(iso).getTime();
        if (Number.isNaN(t)) continue;
        if (melhor == null || t > melhor) melhor = t;
      }
      if (melhor == null) {
        const aceita = await repo.listar({
          tipo: TIPOS_EVENTO.MANIFESTACAO_ACEITA,
          documentoId,
          limite: 1
        });
        const iso = aceita?.[0]?.detalhe?.proximaConsultaEm;
        if (iso) {
          const t = new Date(iso).getTime();
          if (!Number.isNaN(t)) melhor = t;
        }
      }
      return melhor != null ? new Date(melhor).toISOString() : null;
    } catch {
      return null;
    }
  }

  /**
   * RC3.4.5 — job originado de WAKEUP (automático ou manual pós-cooldown).
   * @private
   */
  _ehJobWakeup(job) {
    const m = String(job?.motivo || '').toLowerCase();
    return m.includes('wakeup') || m.includes('despertar');
  }

  /**
   * RC3.4.5 — log MIRX_WAKEUP_EXECUTADO (método / resultado / tempo).
   * @private
   */
  async _registrarWakeupExecutado(doc, job, correlationId, dados = {}) {
    if (!this._ehJobWakeup(job)) return;
    await this._auditoria.registrarTimeline({
      tipoEvento: TIPOS_MIRX.MIRX_WAKEUP_EXECUTADO,
      documentoId: doc.id,
      chave: doc.chave,
      nsu: doc.nsu,
      correlationId,
      metodo: dados.metodo || null,
      resultado: dados.resultado || dados.codigo || null,
      cStat: dados.cStat || null,
      sucesso: dados.sucesso !== false,
      tempoMs: dados.tempoMs,
      estado: dados.estado || null,
      motivo: dados.motivo || 'WAKEUP executou recuperação MIRX',
      origem: job.origem,
      distDfe: dados.distDfe === true,
      consChNFe: dados.consChNFe === true
    });
  }

  estaExecutando() {
    return this._executando;
  }

  /**
   * Processa um job da fila.
   * @param {Object} job
   * @returns {Promise<Object>}
   */
  async processar(job) {
    if (this._executando) {
      return { sucesso: false, ignorado: true, codigo: 'MIRX_WORKER_OCUPADO' };
    }

    const documentoId = Number(job?.documentoId);
    if (!documentoId) {
      return { sucesso: false, codigo: 'MIRX_JOB_INVALIDO' };
    }

    this._executando = true;
    const correlationId = job.correlationId || criarCorrelationId();
    const inicio = Date.now();
    const estadoDoc = this._service.obterEstadoDocumento(documentoId) || {};

    try {
      const doc = await this._documentosRepository.buscarPorId(documentoId);
      if (!doc) {
        this._service.remover(documentoId, 'documento_inexistente');
        return { sucesso: false, codigo: 'DOCUMENTO_INEXISTENTE' };
      }

      if (
        doc.status === DocumentoFiscalStatus.DESCARTADA
        || doc.status === DocumentoFiscalStatus.XML_INDISPONIVEL
      ) {
        this._service.remover(documentoId, doc.status);
        return { sucesso: true, codigo: 'CANCELADO', status: doc.status };
      }

      if (
        doc.status !== DocumentoFiscalStatus.AGUARDANDO_XML_COMPLETO
        || doc.tipoDocumento !== DocumentoDfeTipo.RES_NFE
      ) {
        if (doc.status !== DocumentoFiscalStatus.AGUARDANDO_XML_COMPLETO) {
          await this._service.marcarRecuperado(documentoId, doc, {
            correlationId,
            tempoMs: Date.now() - inicio
          });
          return { sucesso: true, codigo: 'XML_JA_DISPONIVEL', xmlCompleto: true };
        }
        this._service.remover(documentoId, 'status_incompativel');
        return { sucesso: false, codigo: 'STATUS_INCOMPATIVEL' };
      }

      // RC3.4.4 — sem Ciência aceita: não Gate, não DistDFe, não SLEEP.
      // Scan/boot não pode colocar RES_NFE pré-manifestação em cooldown 656.
      if (!(await this._temCienciaAceita(documentoId))) {
        this._service.remover(documentoId, 'aguardando_ciencia');
        return {
          sucesso: true,
          ignorado: true,
          codigo: 'AGUARDANDO_CIENCIA',
          mensagem: 'Recuperação MIRX só após Ciência (210210) aceita.'
        };
      }

      // RC3.4.4 — respeitar janela NT pós-ciência sem SOAP (forcarConsulta permanece false).
      const janelaNt = await this._obterJanelaPosCiencia(documentoId);
      if (janelaNt) {
        const janelaTs = new Date(janelaNt).getTime();
        const agoraTs = this._agora().getTime();
        if (!Number.isNaN(janelaTs) && agoraTs < janelaTs) {
          this._service.atualizarEstado(documentoId, {
            estado: MirxEstados.AGUARDANDO_JANELA_SEFAZ,
            proximaEm: janelaNt,
            motivo: 'NT_2014_002 — aguardando janela pós-ciência (sem consulta SEFAZ)'
          });
          await this._auditoria.registrarTimeline({
            tipoEvento: TIPOS_MIRX.MIRX_AGENDAMENTO_ATUALIZADO,
            documentoId,
            chave: doc.chave,
            correlationId,
            estado: MirxEstados.AGUARDANDO_JANELA_SEFAZ,
            sucesso: true,
            proximaTentativa: janelaNt,
            proximaEmAnterior: estadoDoc.proximaTentativa || null,
            proximaEmNova: janelaNt,
            motivo: 'Janela NT 2014.002 — recuperação agendada (sem consulta SEFAZ)',
            origem: job.origem,
            distDfe: false,
            consChNFe: false
          });
          return {
            sucesso: true,
            ignorado: true,
            codigo: 'AGUARDANDO_JANELA_NT',
            proximaConsultaEm: janelaNt,
            agendado: true
          };
        }
      }

      // Gate obrigatório — nunca bypass.
      const auth = await this._gate.autorizarConsultaDistDfe({
        correlationId,
        documentoId,
        chave: doc.chave,
        nsu: doc.nsu,
        origem: job.origem || ORIGENS.SISTEMA,
        forcar: false,
        forcarAdminConfirmado: job.forcarAdminConfirmado === true,
        confirmacaoAdmin: job.confirmacaoAdmin === true,
        motivo: job.motivo || 'MIRX_recuperacao_xml'
      });

      if (!auth.permitido) {
        const proxima = auth.proximaConsultaEm
          || calcularProximaEm(estadoDoc.tentativas || 0, this._agora());

        // RC3.4.2 — 656 / Gate bloqueado → SLEEP (sem MIRX_SKIP_GATE por tick).
        if (
          auth.codigo === 'BLOQUEADO_CONSUMO_INDEVIDO_656'
          || auth.cStat === '656'
        ) {
          await this._service.entrarSleep(documentoId, {
            proximaEm: proxima,
            correlationId,
            cStat: '656',
            resultado: auth.codigo,
            motivo: auth.mensagem || 'Gate 656 — SLEEP até próxima tentativa',
            origem: job.origem,
            metodo: null
          });
          return {
            sucesso: true,
            ignorado: true,
            codigo: auth.codigo,
            proximaConsultaEm: proxima,
            dormindo: true,
            gate: true
          };
        }

        this._service.atualizarEstado(documentoId, {
          estado: MirxEstados.AGUARDANDO_JANELA_SEFAZ,
          proximaEm: proxima,
          ultimoCStat: auth.cStat || null,
          ultimoMetodo: null,
          ultimoResultado: auth.codigo,
          motivo: auth.mensagem || auth.codigo
        });

        // Outros bloqueios de Gate (ex. 593): um log, sem spam de SLEEP.
        await this._auditoria.registrarTimeline({
          tipoEvento: TIPOS_MIRX.MIRX_SKIP_GATE,
          documentoId,
          chave: doc.chave,
          correlationId,
          estado: MirxEstados.AGUARDANDO_JANELA_SEFAZ,
          cStat: auth.cStat,
          resultado: auth.codigo,
          sucesso: true,
          motivo: auth.mensagem || 'Consulta bloqueada pelo Gate SEFAZ',
          proximaTentativa: proxima,
          origem: job.origem
        });

        return {
          sucesso: true,
          ignorado: true,
          codigo: auth.codigo,
          proximaConsultaEm: proxima,
          gate: true
        };
      }

      this._service.atualizarEstado(documentoId, {
        estado: MirxEstados.CONSULTANDO_XML,
        ultimaConsultaEm: this._agora().toISOString()
      });

      await this._auditoria.registrarTimeline({
        tipoEvento: TIPOS_MIRX.MIRX_CONSULTA_INICIO,
        documentoId,
        chave: doc.chave,
        nsu: doc.nsu,
        correlationId,
        tentativa: (estadoDoc.tentativas || 0) + 1,
        metodo: 'DistDFe→consChNFe',
        estado: MirxEstados.CONSULTANDO_XML,
        motivo: 'Inicio consulta MIRX (sem forcarConsulta permanente)',
        origem: job.origem,
        distDfe: true
      });

      /**
       * JUSTIFICATIVA TÉCNICA (RC3.4.1):
       * forcarConsulta permanece FALSE. O MIRX só consulta quando a janela
       * (Gate + NSU cooldown + backoff) já autorizou. Isso elimina o bypass
       * da NT 2014.002 que causava cStat 656.
       */
      const orch = this._obterOrchestrator();
      const resultado = await orch.processarCicloDfeDocumento(documentoId, {
        confirmado: true,
        apenasManifestacao: false,
        forcarConsulta: false,
        modoRecuperacaoXml: true,
        correlationId,
        ignorarBloqueio656: false,
        origemMirx: true
      });

      const tempoMs = Date.now() - inicio;
      const cStat = String(resultado?.cStat || '');
      const tentativas = (estadoDoc.tentativas || 0) + 1;

      if (
        resultado?.codigo === 'BLOQUEADO_CONSUMO_INDEVIDO_656'
        || cStat === '656'
      ) {
        const bloq = this._gate.obterBloqueio656();
        const proxima = resultado.proximaConsultaEm
          || bloq.bloqueadoAte
          || calcularProximaEm(Math.max(tentativas, 3), this._agora());

        // Atualiza tentativas antes do SLEEP.
        this._service.atualizarEstado(documentoId, {
          tentativas,
          ultimaConsultaEm: this._agora().toISOString(),
          ultimoCStat: '656',
          ultimoMetodo: 'DistDFe',
          ultimoResultado: 'CONSUMO_INDEVIDO'
        });

        await this._service.entrarSleep(documentoId, {
          proximaEm: proxima,
          correlationId,
          cStat: '656',
          tentativas,
          metodo: 'DistDFe',
          motivo: 'cStat 656 — SLEEP automático; retry sem intervenção',
          origem: job.origem
        });

        // Timeline de bloqueio uma vez (SLEEP_START já registra o modo dorminhoco).
        await this._auditoria.registrarTimeline({
          tipoEvento: TIPOS_MIRX.MIRX_BLOQUEIO_656,
          documentoId,
          chave: doc.chave,
          correlationId,
          tentativa: tentativas,
          metodo: 'DistDFe',
          cStat: '656',
          estado: MirxEstados.SLEEP,
          sucesso: false,
          tempoMs,
          proximaTentativa: proxima,
          motivo: 'Consumo indevido — documento em SLEEP; permanece AGUARDANDO_XML_COMPLETO',
          backoffLabel: descreverBackoff(tentativas).label,
          origem: job.origem,
          distDfe: true
        });

        await this._registrarWakeupExecutado(doc, job, correlationId, {
          metodo: 'DistDFe',
          resultado: 'BLOQUEADO_CONSUMO_INDEVIDO_656',
          codigo: 'BLOQUEADO_CONSUMO_INDEVIDO_656',
          cStat: '656',
          tempoMs,
          estado: MirxEstados.SLEEP,
          sucesso: false,
          distDfe: true,
          motivo: 'WAKEUP — DistDFe retornou 656; documento em SLEEP'
        });

        return {
          sucesso: false,
          codigo: 'BLOQUEADO_CONSUMO_INDEVIDO_656',
          cStat: '656',
          proximaConsultaEm: proxima,
          dormindo: true,
          reagendado: true
        };
      }

      const atualizado = await this._documentosRepository.buscarPorId(documentoId);
      const xmlCompleto = resultado?.xmlCompleto === true
        || (
          atualizado
          && atualizado.status !== DocumentoFiscalStatus.AGUARDANDO_XML_COMPLETO
          && [DocumentoDfeTipo.PROC_NFE, DocumentoDfeTipo.NFE].includes(atualizado.tipoDocumento)
        );

      if (xmlCompleto) {
        const metodo = resultado?.consultaPorChave ? 'consChNFe' : 'DistDFe';
        await this._service.marcarRecuperado(documentoId, atualizado || doc, {
          correlationId,
          tentativa: tentativas,
          tempoMs,
          metodo,
          cStat
        });
        await this._registrarWakeupExecutado(doc, job, correlationId, {
          metodo: resultado?.consultaPorChave ? 'DistDFe→consChNFe' : 'DistDFe',
          resultado: 'XML_RECUPERADO',
          codigo: 'XML_RECUPERADO',
          cStat,
          tempoMs,
          estado: MirxEstados.XML_RECUPERADO,
          sucesso: true,
          distDfe: true,
          consChNFe: Boolean(resultado?.consultaPorChave),
          motivo: 'WAKEUP — XML recuperado automaticamente'
        });
        return {
          sucesso: true,
          codigo: 'XML_RECUPERADO',
          xmlCompleto: true,
          cStat
        };
      }

      // Sem PROC: reagendar (nunca abandonar).
      const backoff = descreverBackoff(tentativas);
      const proxima = resultado?.proximaConsultaEm
        || calcularProximaEm(tentativas, this._agora());
      const metodoParcial = resultado?.consultaPorChave ? 'DistDFe+consChNFe' : 'DistDFe';

      this._service.atualizarEstado(documentoId, {
        estado: MirxEstados.CONSULTA_PROGRAMADA,
        tentativas,
        ultimaConsultaEm: this._agora().toISOString(),
        ultimoCStat: cStat || null,
        ultimoMetodo: metodoParcial,
        ultimoResultado: cStat || resultado?.mensagem || 'AGUARDANDO',
        proximaEm: proxima,
        motivo: cStat === '137'
          ? 'cStat 137 — sem documentos; aguardar propagação'
          : 'XML ainda indisponível — reagendamento automático'
      });

      await this._auditoria.registrarTimeline({
        tipoEvento: TIPOS_MIRX.MIRX_REAGENDADO,
        documentoId,
        chave: doc.chave,
        correlationId,
        tentativa: tentativas,
        metodo: metodoParcial,
        cStat: cStat || null,
        estado: MirxEstados.CONSULTA_PROGRAMADA,
        sucesso: true,
        tempoMs,
        proximaTentativa: proxima,
        backoffLabel: backoff.label,
        motivo: 'Reagendamento MIRX — documento não abandonado',
        origem: job.origem,
        distDfe: true,
        consChNFe: Boolean(resultado?.consultaPorChave)
      });

      await this._registrarWakeupExecutado(doc, job, correlationId, {
        metodo: metodoParcial,
        resultado: 'REAGENDADO',
        codigo: 'REAGENDADO',
        cStat,
        tempoMs,
        estado: MirxEstados.CONSULTA_PROGRAMADA,
        sucesso: true,
        distDfe: true,
        consChNFe: Boolean(resultado?.consultaPorChave),
        motivo: 'WAKEUP — XML ainda indisponível; reagendado'
      });

      return {
        sucesso: true,
        codigo: 'REAGENDADO',
        cStat,
        proximaConsultaEm: proxima,
        tentativas
      };
    } catch (error) {
      const tentativas = (estadoDoc.tentativas || 0) + 1;
      const backoff = descreverBackoff(tentativas);
      const proxima = calcularProximaEm(tentativas, this._agora());
      this._service.atualizarEstado(documentoId, {
        estado: MirxEstados.ERRO_TEMPORARIO,
        tentativas,
        ultimaConsultaEm: this._agora().toISOString(),
        ultimoResultado: 'ERRO',
        proximaEm: proxima,
        motivo: error.message || 'erro_temporario'
      });

      await this._auditoria.registrarTimeline({
        tipoEvento: TIPOS_MIRX.MIRX_ERRO,
        documentoId,
        correlationId,
        tentativa: tentativas,
        estado: MirxEstados.ERRO_TEMPORARIO,
        sucesso: false,
        tempoMs: Date.now() - inicio,
        proximaTentativa: proxima,
        backoffLabel: backoff.label,
        motivo: error.message || 'Erro SOAP/ciclo — retry automático',
        origem: job.origem
      });

      return {
        sucesso: false,
        codigo: 'ERRO_TEMPORARIO',
        mensagem: error.message,
        proximaConsultaEm: proxima,
        reagendado: true
      };
    } finally {
      this._executando = false;
    }
  }
}

module.exports = MirxWorker;
