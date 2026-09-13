/**
 * CentralHomologacaoService — Observabilidade somente leitura para homologação SEFAZ (RC3.4).
 *
 * Não altera regras fiscais, Parser, MIIP nem Plataforma Fiscal.
 * Agrega documentos + eventos + NSU já existentes.
 *
 * @module motores/central-entradas/services/CentralHomologacaoService
 */

const CentralDocumentosRepository = require('../repositories/CentralDocumentosRepository');
const CentralEventosRepository = require('../repositories/CentralEventosRepository');
const CentralHistoricoRepository = require('../repositories/CentralHistoricoRepository');
const CentralNsuRepository = require('../repositories/CentralNsuRepository');
const CentralNsuService = require('./CentralNsuService');
const { DocumentoFiscalStatus } = require('../core/DocumentoFiscalStatus');
const { TIPOS_EVENTO } = require('../config/centralEventosTipos');
const { ETAPAS_CICLO_DFE } = require('../core/CicloDfeEstadosMap');

const TIPOS_CICLO = Object.freeze([
  TIPOS_EVENTO.DOCUMENTO_RECEBIDO,
  TIPOS_EVENTO.CIENCIA_ENVIADA,
  TIPOS_EVENTO.MANIFESTACAO_ACEITA,
  TIPOS_EVENTO.MANIFESTACAO_REJEITADA,
  TIPOS_EVENTO.CONSULTA_DFE_POS_MANIFESTACAO,
  TIPOS_EVENTO.DOCUMENTO_ATUALIZADO,
  TIPOS_EVENTO.PARSER_CONCLUIDO,
  TIPOS_EVENTO.MIIP_CONCLUIDO,
  TIPOS_EVENTO.DOCUMENTO_PROCESSADO,
  TIPOS_EVENTO.COMPRA_GRAVADA,
  TIPOS_EVENTO.SYNC_CONCLUIDA,
  TIPOS_EVENTO.SYNC_ERRO
]);

const CHECKLIST_HOMOLOGACAO = Object.freeze([
  { codigo: 'RES_NFE', label: 'Recebeu RES_NFE', tipos: [TIPOS_EVENTO.DOCUMENTO_RECEBIDO], status: DocumentoFiscalStatus.AGUARDANDO_XML_COMPLETO },
  { codigo: 'CIENCIA', label: 'Ciência enviada', tipos: [TIPOS_EVENTO.CIENCIA_ENVIADA] },
  { codigo: 'ACEITA', label: 'Evento aceito', tipos: [TIPOS_EVENTO.MANIFESTACAO_ACEITA] },
  { codigo: 'PROC_NFE', label: 'PROC_NFE recebido', tipos: [TIPOS_EVENTO.DOCUMENTO_ATUALIZADO, TIPOS_EVENTO.CONSULTA_DFE_POS_MANIFESTACAO] },
  { codigo: 'PARSER', label: 'Parser', tipos: [TIPOS_EVENTO.PARSER_CONCLUIDO] },
  { codigo: 'MIIP', label: 'MIIP', tipos: [TIPOS_EVENTO.MIIP_CONCLUIDO] },
  { codigo: 'COMPRA', label: 'Compra', tipos: [TIPOS_EVENTO.COMPRA_GRAVADA] }
]);

function parseIso(valor) {
  if (!valor) return null;
  const d = new Date(valor);
  return Number.isNaN(d.getTime()) ? null : d;
}

function diffMs(a, b) {
  const da = parseIso(a);
  const db = parseIso(b);
  if (!da || !db) return null;
  return Math.max(0, db.getTime() - da.getTime());
}

function media(valores) {
  const nums = valores.filter((v) => Number.isFinite(v));
  if (!nums.length) return null;
  return Math.round(nums.reduce((s, v) => s + v, 0) / nums.length);
}

function healthDoDocumento(doc, eventos = [], cooldown = null) {
  const tipos = new Set(eventos.map((e) => e.tipo));
  if (tipos.has(TIPOS_EVENTO.MANIFESTACAO_REJEITADA) && doc.status === DocumentoFiscalStatus.AGUARDANDO_XML_COMPLETO) {
    const rej = eventos.find((e) => e.tipo === TIPOS_EVENTO.MANIFESTACAO_REJEITADA);
    if (rej?.sucesso === false) return { codigo: 'ERRO', label: 'Erro', tom: 'danger' };
  }
  if (doc.status === DocumentoFiscalStatus.ERRO) {
    return { codigo: 'ERRO', label: 'Erro', tom: 'danger' };
  }
  if (cooldown?.ativo) {
    return { codigo: 'COOLDOWN', label: 'Cooldown ativo', tom: 'warning' };
  }
  if (doc.status === DocumentoFiscalStatus.AGUARDANDO_XML_COMPLETO) {
    return { codigo: 'AGUARDANDO_PROC', label: 'Aguardando PROC_NFE', tom: 'caution' };
  }
  if ([
    DocumentoFiscalStatus.SINCRONIZADA,
    DocumentoFiscalStatus.EM_PROCESSAMENTO,
    DocumentoFiscalStatus.AGUARDANDO_REVISAO,
    DocumentoFiscalStatus.PRONTA_PARA_COMPRA,
    DocumentoFiscalStatus.EM_COMPRA,
    DocumentoFiscalStatus.GRAVADA,
    DocumentoFiscalStatus.REVISADA
  ].includes(doc.status)) {
    return { codigo: 'SAUDAVEL', label: 'Fluxo saudável', tom: 'success' };
  }
  return { codigo: 'NEUTRO', label: doc.status || '—', tom: 'neutral' };
}

function montarTimelineCiclo(eventos = [], historico = []) {
  const porTipo = {};
  for (const ev of eventos) {
    if (!porTipo[ev.tipo] || parseIso(ev.createdAt) > parseIso(porTipo[ev.tipo].createdAt)) {
      porTipo[ev.tipo] = ev;
    }
  }

  const etapas = [
    { codigo: 'RES_NFE', label: 'RES_NFE recebido', tipo: TIPOS_EVENTO.DOCUMENTO_RECEBIDO },
    { codigo: 'CIENCIA', label: 'Ciência enviada', tipo: TIPOS_EVENTO.CIENCIA_ENVIADA },
    { codigo: 'ACEITA', label: 'Evento registrado', tipo: TIPOS_EVENTO.MANIFESTACAO_ACEITA },
    { codigo: 'AGUARDANDO_NSU', label: 'Aguardando novo NSU', tipo: TIPOS_EVENTO.CONSULTA_DFE_POS_MANIFESTACAO },
    { codigo: 'PROC_NFE', label: 'PROC_NFE recebido', tipo: TIPOS_EVENTO.DOCUMENTO_ATUALIZADO },
    { codigo: 'PARSER', label: 'Parser', tipo: TIPOS_EVENTO.PARSER_CONCLUIDO },
    { codigo: 'MIIP', label: 'MIIP', tipo: TIPOS_EVENTO.MIIP_CONCLUIDO },
    { codigo: 'COMPRA', label: 'Compra', tipo: TIPOS_EVENTO.COMPRA_GRAVADA }
  ];

  let anteriorTs = null;
  return etapas.map((etapa) => {
    const ev = porTipo[etapa.tipo] || null;
    const ts = ev?.createdAt || null;
    const duracaoMs = ev?.duracaoMs != null
      ? Number(ev.duracaoMs)
      : (anteriorTs && ts ? diffMs(anteriorTs, ts) : null);
    if (ts) anteriorTs = ts;
    return {
      codigo: etapa.codigo,
      label: etapa.label,
      concluida: Boolean(ev),
      dataHora: ts,
      duracaoMs,
      origem: ev?.origem || null,
      resultado: ev?.resultado || null,
      cStat: ev?.detalhe?.cStat || null,
      correlationId: ev?.detalhe?.correlationId || null,
      detalheHistorico: historico.find((h) => String(h.detalhe || '').includes(etapa.label.split(' ')[0])) || null
    };
  });
}

class CentralHomologacaoService {
  /**
   * @param {Object} [deps]
   */
  constructor(deps = {}) {
    this._documentos = deps.documentosRepository ?? new CentralDocumentosRepository({ db: deps.db ?? null });
    this._eventos = deps.eventosRepository ?? new CentralEventosRepository({ db: deps.db ?? null });
    this._historico = deps.historicoRepository ?? new CentralHistoricoRepository({ db: deps.db ?? null });
    this._nsuRepository = deps.nsuRepository ?? new CentralNsuRepository({ db: deps.db ?? null });
    this._nsuService = deps.nsuService ?? new CentralNsuService({ nsuRepository: this._nsuRepository });
  }

  /**
   * Painel monitor + diagnóstico SEFAZ + métricas + checklist.
   * @param {Object} [opcoes]
   */
  async obterPainel(opcoes = {}) {
    const limite = Math.min(Number(opcoes.limite) || 80, 200);
    const documentos = await this._documentos.listar({
      limite,
      ordenarPor: 'created_at',
      ordenarDirecao: 'DESC'
    });

    const nsu = await this._nsuRepository.obterUltimaSincronizacao();
    const cooldown = this._nsuService.avaliarCooldown(nsu);

    const monitor = [];
    for (const doc of documentos) {
      // eslint-disable-next-line no-await-in-loop
      const eventos = await this._eventos.listar({
        documentoId: doc.id,
        limite: 50
      });
      const cicloEventos = eventos.filter((e) => TIPOS_CICLO.includes(e.tipo));
      const ultimoSefaz = cicloEventos.find((e) => [
        TIPOS_EVENTO.CIENCIA_ENVIADA,
        TIPOS_EVENTO.MANIFESTACAO_ACEITA,
        TIPOS_EVENTO.MANIFESTACAO_REJEITADA,
        TIPOS_EVENTO.CONSULTA_DFE_POS_MANIFESTACAO,
        TIPOS_EVENTO.SYNC_CONCLUIDA,
        TIPOS_EVENTO.SYNC_ERRO
      ].includes(e.tipo)) || null;

      const tempos = this._extrairTemposEtapas(cicloEventos);
      monitor.push({
        id: doc.id,
        chave: doc.chave,
        nsu: doc.nsu || null,
        fornecedor: doc.fornecedor || null,
        tipoDocumento: doc.tipoDocumento || null,
        status: doc.status,
        statusDetalhe: doc.statusDetalhe || null,
        valorTotal: doc.valorTotal,
        createdAt: doc.createdAt,
        updatedAt: doc.updatedAt,
        health: healthDoDocumento(doc, cicloEventos, cooldown),
        tempos,
        ultimaComunicacaoSefaz: ultimoSefaz
          ? {
            tipo: ultimoSefaz.tipo,
            dataHora: ultimoSefaz.createdAt,
            cStat: ultimoSefaz.detalhe?.cStat || null,
            correlationId: ultimoSefaz.detalhe?.correlationId || null,
            origem: ultimoSefaz.origem
          }
          : null,
        checklist: this._checklistDocumento(doc, cicloEventos)
      });
    }

    const diagnosticoSefaz = await this._montarDiagnosticoSefaz(nsu, cooldown);
    const metricas = await this.obterMetricas();

    return {
      geradoEm: new Date().toISOString(),
      nsu: nsu
        ? {
          ultNsu: nsu.ultNsu,
          maxNsu: nsu.maxNsu,
          dataSincronizacao: nsu.dataSincronizacao,
          ultimoCstat: nsu.ultimoCstat || null,
          cooldownAte: nsu.cooldownAte || null
        }
        : null,
      cooldown,
      healthResumo: this._resumoHealth(monitor),
      monitor,
      diagnosticoSefaz,
      metricas,
      checklistHomologacao: CHECKLIST_HOMOLOGACAO.map((c) => ({
        codigo: c.codigo,
        label: c.label,
        concluidos: monitor.filter((m) => m.checklist.find((x) => x.codigo === c.codigo)?.ok).length,
        total: monitor.length
      })),
      etapasReferencia: Object.keys(ETAPAS_CICLO_DFE)
    };
  }

  /**
   * Inspeção somente leitura de um documento.
   * @param {number|string} documentoId
   */
  async inspecionarDocumento(documentoId) {
    const documento = await this._documentos.buscarPorId(documentoId);
    if (!documento) {
      const erro = new Error('Documento não encontrado');
      erro.statusCode = 404;
      throw erro;
    }

    const [eventos, historico, nsu] = await Promise.all([
      this._eventos.listar({ documentoId: documento.id, limite: 100 }),
      this._historico.listarPorDocumento(documento.id),
      this._nsuRepository.obterUltimaSincronizacao()
    ]);

    const cicloEventos = eventos.filter((e) => TIPOS_CICLO.includes(e.tipo));
    const cooldown = this._nsuService.avaliarCooldown(nsu);
    const timeline = montarTimelineCiclo(cicloEventos, historico);
    const manifestacoes = cicloEventos.filter((e) => [
      TIPOS_EVENTO.CIENCIA_ENVIADA,
      TIPOS_EVENTO.MANIFESTACAO_ACEITA,
      TIPOS_EVENTO.MANIFESTACAO_REJEITADA
    ].includes(e.tipo));

    return {
      geradoEm: new Date().toISOString(),
      documento: {
        id: documento.id,
        chave: documento.chave,
        nsu: documento.nsu,
        fornecedor: documento.fornecedor,
        cnpjFornecedor: documento.cnpjFornecedor,
        status: documento.status,
        statusDetalhe: documento.statusDetalhe,
        tipoDocumento: documento.tipoDocumento,
        origem: documento.origem,
        valorTotal: documento.valorTotal,
        dataEmissao: documento.dataEmissao,
        createdAt: documento.createdAt,
        updatedAt: documento.updatedAt,
        compraId: documento.compraId || null,
        schema: this._inferirSchema(documento),
        xmlArmazenado: Boolean(documento.xml),
        xmlPreview: documento.xml
          ? String(documento.xml).slice(0, 4000)
          : null
      },
      nsuControle: nsu
        ? {
          ultNsu: nsu.ultNsu,
          maxNsu: nsu.maxNsu,
          dataSincronizacao: nsu.dataSincronizacao,
          ultimoCstat: nsu.ultimoCstat,
          cooldownAte: nsu.cooldownAte
        }
        : null,
      cooldown,
      health: healthDoDocumento(documento, cicloEventos, cooldown),
      timeline,
      eventos: cicloEventos,
      historico,
      manifestacoes,
      telemetria: this._telemetriaDocumento(cicloEventos, nsu, cooldown),
      checklist: this._checklistDocumento(documento, cicloEventos)
    };
  }

  /**
   * @returns {Promise<Object>}
   */
  async obterMetricas() {
    const eventos = await this._eventos.listar({ limite: 200 });
    const porDoc = new Map();
    for (const ev of eventos) {
      if (!ev.documentoId) continue;
      if (!porDoc.has(ev.documentoId)) porDoc.set(ev.documentoId, []);
      porDoc.get(ev.documentoId).push(ev);
    }

    const resParaCiencia = [];
    const cienciaParaProc = [];
    const procParaParser = [];
    const parserParaMiip = [];
    const miipParaCompra = [];
    const temposManifestacao = [];
    const temposConsulta = [];
    const temposParser = [];
    const temposMiip = [];

    for (const lista of porDoc.values()) {
      const map = {};
      for (const ev of lista) map[ev.tipo] = ev;
      const t = (tipo) => map[tipo]?.createdAt;
      const d = (a, b) => diffMs(t(a), t(b));

      const rc = d(TIPOS_EVENTO.DOCUMENTO_RECEBIDO, TIPOS_EVENTO.CIENCIA_ENVIADA);
      if (rc != null) resParaCiencia.push(rc);
      const cp = d(TIPOS_EVENTO.MANIFESTACAO_ACEITA, TIPOS_EVENTO.DOCUMENTO_ATUALIZADO);
      if (cp != null) cienciaParaProc.push(cp);
      const pp = d(TIPOS_EVENTO.DOCUMENTO_ATUALIZADO, TIPOS_EVENTO.PARSER_CONCLUIDO);
      if (pp != null) procParaParser.push(pp);
      const pm = d(TIPOS_EVENTO.PARSER_CONCLUIDO, TIPOS_EVENTO.MIIP_CONCLUIDO);
      if (pm != null) parserParaMiip.push(pm);
      const mc = d(TIPOS_EVENTO.MIIP_CONCLUIDO, TIPOS_EVENTO.COMPRA_GRAVADA);
      if (mc != null) miipParaCompra.push(mc);

      if (map[TIPOS_EVENTO.MANIFESTACAO_ACEITA]?.duracaoMs != null) {
        temposManifestacao.push(Number(map[TIPOS_EVENTO.MANIFESTACAO_ACEITA].duracaoMs));
      }
      if (map[TIPOS_EVENTO.CONSULTA_DFE_POS_MANIFESTACAO]?.duracaoMs != null) {
        temposConsulta.push(Number(map[TIPOS_EVENTO.CONSULTA_DFE_POS_MANIFESTACAO].duracaoMs));
      }
      if (map[TIPOS_EVENTO.PARSER_CONCLUIDO]?.duracaoMs != null) {
        temposParser.push(Number(map[TIPOS_EVENTO.PARSER_CONCLUIDO].duracaoMs));
      }
      if (map[TIPOS_EVENTO.MIIP_CONCLUIDO]?.duracaoMs != null) {
        temposMiip.push(Number(map[TIPOS_EVENTO.MIIP_CONCLUIDO].duracaoMs));
      }
    }

    return {
      mediaMs: {
        resNfeParaCiencia: media(resParaCiencia),
        cienciaParaProcNfe: media(cienciaParaProc),
        procNfeParaParser: media(procParaParser),
        parserParaMiip: media(parserParaMiip),
        miipParaCompra: media(miipParaCompra),
        manifestacao: media(temposManifestacao),
        consultaDfe: media(temposConsulta),
        parser: media(temposParser),
        miip: media(temposMiip)
      },
      amostras: {
        resNfeParaCiencia: resParaCiencia.length,
        cienciaParaProcNfe: cienciaParaProc.length,
        procNfeParaParser: procParaParser.length,
        parserParaMiip: parserParaMiip.length,
        miipParaCompra: miipParaCompra.length
      }
    };
  }

  /**
   * Exportação técnica JSON/TXT.
   * @param {number|string} documentoId
   * @param {'json'|'txt'} formato
   */
  async exportarRelatorio(documentoId, formato = 'json') {
    const inspecao = await this.inspecionarDocumento(documentoId);
    if (String(formato).toLowerCase() === 'txt') {
      return {
        formato: 'txt',
        filename: `homologacao-doc-${documentoId}.txt`,
        contentType: 'text/plain; charset=utf-8',
        corpo: this._formatarTxt(inspecao)
      };
    }
    return {
      formato: 'json',
      filename: `homologacao-doc-${documentoId}.json`,
      contentType: 'application/json; charset=utf-8',
      corpo: JSON.stringify(inspecao, null, 2)
    };
  }

  /** @private */
  async _montarDiagnosticoSefaz(nsu, cooldown) {
    const [
      ultimo137,
      ultimo656,
      ultimoSucesso,
      ultimoTimeout,
      ultimaManifestacao,
      ultimoProc
    ] = await Promise.all([
      this._buscarEventoPorCstat('137'),
      this._buscarEventoPorCstat('656'),
      this._eventos.obterUltimoPorTipo(TIPOS_EVENTO.SYNC_CONCLUIDA),
      this._buscarTimeout(),
      this._eventos.obterUltimoPorTipo(TIPOS_EVENTO.MANIFESTACAO_ACEITA),
      this._eventos.obterUltimoPorTipo(TIPOS_EVENTO.DOCUMENTO_ATUALIZADO)
    ]);

    return {
      comunicacao: cooldown?.ativo
        ? { estado: 'COOLDOWN', detalhe: cooldown.motivo || 'Janela NT 2014.002' }
        : { estado: 'PRONTA', detalhe: 'Sem cooldown ativo' },
      ultNsu: nsu?.ultNsu || null,
      maxNsu: nsu?.maxNsu || null,
      ultimoCstatPersistido: nsu?.ultimoCstat || null,
      cooldown,
      ultimo137,
      ultimo656,
      ultimoSucesso: ultimoSucesso
        ? {
          dataHora: ultimoSucesso.createdAt,
          cStat: ultimoSucesso.detalhe?.cStat || null,
          mensagem: ultimoSucesso.descricao,
          correlationId: ultimoSucesso.detalhe?.correlationId || null
        }
        : null,
      ultimoTimeout,
      ultimaManifestacao: ultimaManifestacao
        ? {
          dataHora: ultimaManifestacao.createdAt,
          cStat: ultimaManifestacao.detalhe?.cStat || null,
          protocolo: ultimaManifestacao.detalhe?.protocolo || null,
          correlationId: ultimaManifestacao.detalhe?.correlationId || null,
          documentoId: ultimaManifestacao.documentoId
        }
        : null,
      ultimoProcNfe: ultimoProc
        ? {
          dataHora: ultimoProc.createdAt,
          documentoId: ultimoProc.documentoId,
          tipoDfe: ultimoProc.detalhe?.tipoDfe || null,
          correlationId: ultimoProc.detalhe?.correlationId || null
        }
        : null
    };
  }

  /** @private */
  async _buscarEventoPorCstat(cStat) {
    const eventos = await this._eventos.listar({ limite: 100 });
    const hit = eventos.find((e) => String(e.detalhe?.cStat || e.resultado || '') === String(cStat));
    if (!hit) return null;
    return {
      dataHora: hit.createdAt,
      tipo: hit.tipo,
      documentoId: hit.documentoId,
      mensagem: hit.descricao,
      correlationId: hit.detalhe?.correlationId || null,
      ultNsu: hit.detalhe?.ultNsu || null,
      maxNsu: hit.detalhe?.maxNsu || null
    };
  }

  /** @private */
  async _buscarTimeout() {
    const eventos = await this._eventos.listar({ limite: 100 });
    const hit = eventos.find((e) => /timeout/i.test(String(e.descricao || ''))
      || /timeout/i.test(String(e.detalhe?.erro || ''))
      || e.resultado === 'ERRO' && /timeout/i.test(JSON.stringify(e.detalhe || {})));
    if (!hit) return null;
    return {
      dataHora: hit.createdAt,
      tipo: hit.tipo,
      documentoId: hit.documentoId,
      mensagem: hit.descricao,
      correlationId: hit.detalhe?.correlationId || null
    };
  }

  /** @private */
  _checklistDocumento(doc, eventos) {
    const tipos = new Set(eventos.map((e) => e.tipo));
    return CHECKLIST_HOMOLOGACAO.map((item) => {
      let ok = item.tipos.some((t) => tipos.has(t));
      if (item.codigo === 'RES_NFE') {
        ok = ok || doc.tipoDocumento === 'RES_NFE'
          || doc.status === DocumentoFiscalStatus.AGUARDANDO_XML_COMPLETO
          || ['PROC_NFE', 'NFE'].includes(doc.tipoDocumento);
      }
      if (item.codigo === 'PROC_NFE') {
        ok = ok || ['PROC_NFE', 'NFE'].includes(doc.tipoDocumento)
          || doc.status === DocumentoFiscalStatus.SINCRONIZADA
          || Boolean(doc.parseJson);
      }
      if (item.codigo === 'COMPRA') {
        ok = ok || Boolean(doc.compraId) || doc.status === DocumentoFiscalStatus.GRAVADA;
      }
      return { codigo: item.codigo, label: item.label, ok: Boolean(ok) };
    });
  }

  /** @private */
  _extrairTemposEtapas(eventos) {
    const map = {};
    for (const ev of eventos) map[ev.tipo] = ev;
    return {
      cienciaMs: map[TIPOS_EVENTO.MANIFESTACAO_ACEITA]?.duracaoMs ?? null,
      consultaMs: map[TIPOS_EVENTO.CONSULTA_DFE_POS_MANIFESTACAO]?.duracaoMs ?? null,
      parserMs: map[TIPOS_EVENTO.PARSER_CONCLUIDO]?.duracaoMs ?? null,
      miipMs: map[TIPOS_EVENTO.MIIP_CONCLUIDO]?.duracaoMs ?? null
    };
  }

  /** @private */
  _telemetriaDocumento(eventos, nsu, cooldown) {
    const ultimo = eventos[0] || null;
    return {
      ultNsu: nsu?.ultNsu || null,
      maxNsu: nsu?.maxNsu || null,
      cStat: ultimo?.detalhe?.cStat || nsu?.ultimoCstat || null,
      tempoConsultaMs: eventos.find((e) => e.tipo === TIPOS_EVENTO.CONSULTA_DFE_POS_MANIFESTACAO)?.duracaoMs ?? null,
      tempoManifestacaoMs: eventos.find((e) => e.tipo === TIPOS_EVENTO.MANIFESTACAO_ACEITA)?.duracaoMs ?? null,
      tempoParserMs: eventos.find((e) => e.tipo === TIPOS_EVENTO.PARSER_CONCLUIDO)?.duracaoMs ?? null,
      tempoMiipMs: eventos.find((e) => e.tipo === TIPOS_EVENTO.MIIP_CONCLUIDO)?.duracaoMs ?? null,
      cooldownAtivo: Boolean(cooldown?.ativo),
      proximaConsultaEm: cooldown?.proximaConsultaEm || null,
      correlationId: ultimo?.detalhe?.correlationId || null
    };
  }

  /** @private */
  _inferirSchema(documento) {
    if (documento.tipoDocumento === 'RES_NFE') return 'resNFe';
    if (documento.tipoDocumento === 'PROC_NFE') return 'procNFe';
    if (documento.tipoDocumento === 'NFE') return 'nfe';
    if (documento.xml && /<resNFe[\s>]/i.test(documento.xml)) return 'resNFe';
    if (documento.xml && /<nfeProc[\s>]/i.test(documento.xml)) return 'procNFe';
    return documento.tipoDocumento || null;
  }

  /** @private */
  _resumoHealth(monitor) {
    const contagem = { SAUDAVEL: 0, AGUARDANDO_PROC: 0, COOLDOWN: 0, ERRO: 0, NEUTRO: 0 };
    for (const item of monitor) {
      const codigo = item.health?.codigo || 'NEUTRO';
      contagem[codigo] = (contagem[codigo] || 0) + 1;
    }
    return contagem;
  }

  /** @private */
  _formatarTxt(inspecao) {
    const linhas = [];
    linhas.push('=== RELATÓRIO TÉCNICO DE HOMOLOGAÇÃO DF-e (RC3.4) ===');
    linhas.push(`Gerado em: ${inspecao.geradoEm}`);
    linhas.push(`Documento #${inspecao.documento.id}`);
    linhas.push(`Chave: ${inspecao.documento.chave || '—'}`);
    linhas.push(`Tipo: ${inspecao.documento.tipoDocumento || '—'} | Schema: ${inspecao.documento.schema || '—'}`);
    linhas.push(`Status: ${inspecao.documento.status}`);
    linhas.push(`NSU doc: ${inspecao.documento.nsu || '—'}`);
    linhas.push(`Health: ${inspecao.health?.label || '—'}`);
    linhas.push('');
    linhas.push('--- Telemetria ---');
    const t = inspecao.telemetria || {};
    linhas.push(`ultNSU=${t.ultNsu} maxNSU=${t.maxNsu} cStat=${t.cStat}`);
    linhas.push(`tempoManifestacaoMs=${t.tempoManifestacaoMs} tempoConsultaMs=${t.tempoConsultaMs}`);
    linhas.push(`tempoParserMs=${t.tempoParserMs} tempoMiipMs=${t.tempoMiipMs}`);
    linhas.push(`cooldown=${t.cooldownAtivo} proxima=${t.proximaConsultaEm || '—'}`);
    linhas.push(`CorrelationId=${t.correlationId || '—'}`);
    linhas.push('');
    linhas.push('--- Timeline ---');
    for (const etapa of inspecao.timeline || []) {
      linhas.push(
        `${etapa.concluida ? '[OK]' : '[  ]'} ${etapa.label}`
        + ` | ${etapa.dataHora || '—'}`
        + ` | ${etapa.duracaoMs != null ? `${etapa.duracaoMs}ms` : '—'}`
        + ` | origem=${etapa.origem || '—'}`
        + ` | cStat=${etapa.cStat || '—'}`
        + ` | corr=${etapa.correlationId || '—'}`
      );
    }
    linhas.push('');
    linhas.push('--- Eventos ---');
    for (const ev of inspecao.eventos || []) {
      linhas.push(
        `${ev.createdAt} | ${ev.tipo} | ${ev.origem} | ${ev.descricao || ''}`
        + ` | cStat=${ev.detalhe?.cStat || '—'} | corr=${ev.detalhe?.correlationId || '—'}`
      );
    }
    linhas.push('');
    linhas.push('--- Checklist ---');
    for (const item of inspecao.checklist || []) {
      linhas.push(`${item.ok ? '[x]' : '[ ]'} ${item.label}`);
    }
    return linhas.join('\n');
  }
}

CentralHomologacaoService.CHECKLIST_HOMOLOGACAO = CHECKLIST_HOMOLOGACAO;
CentralHomologacaoService.healthDoDocumento = healthDoDocumento;

module.exports = CentralHomologacaoService;
