/**
 * MotorReconcilicaoDfe — Reconciliação e integridade DF-e (Sprint 4).
 *
 * SOMENTE DIAGNÓSTICO.
 * NÃO avança/retrocede cursor, NÃO cria NSU, NÃO baixa XML,
 * NÃO consulta SEFAZ, NÃO altera documentos.
 *
 * @module services/fiscal/descoberta-nsu/MotorReconcilicaoDfe
 */
'use strict';

const { ReconcilicaoStatus, labelReconcilicaoStatus, SEVERIDADE } = require('./ReconcilicaoDfeStatus');
const { AchadoCodigo, criarAchado } = require('./ReconcilicaoDfeAchados');
const { criarReconciliationId } = require('./ReconcilicaoDfeId');
const { obterSnapshotStore } = require('./ReconcilicaoDfeSnapshotStore');
const { detectarLacunasNsu } = require('../../../motores/central-entradas/descoberta-nsu/NsuLacunaDetector');
const { normalizarNsuOuZero } = require('../dfeRetornoParser');
const { DocumentoFiscalStatus, normalizarStatus } = require('../../../motores/central-entradas/core/DocumentoFiscalStatus');
const { StatusRecuperacaoXml } = require('../../../motores/central-entradas/recuperacao-xml/StatusRecuperacaoXml');

function nsuBig(valor) {
  const n = normalizarNsuOuZero(valor).replace(/^0+(?=\d)/, '') || '0';
  try {
    return BigInt(n);
  } catch {
    return 0n;
  }
}

function formatNsu(n) {
  return String(n).padStart(15, '0');
}

function padNsu(v) {
  return formatNsu(nsuBig(v));
}

function extrairChaveXml(xml) {
  const raw = String(xml || '');
  const mId = raw.match(/Id\s*=\s*["']NFe(\d{44})["']/i);
  if (mId) return mId[1];
  const mCh = raw.match(/<chNFe>\s*(\d{44})\s*<\/chNFe>/i);
  return mCh ? mCh[1] : null;
}

function extrairCnpjDestXml(xml) {
  const raw = String(xml || '');
  const bloco = raw.match(/<dest[\s>][\s\S]*?<\/dest>/i);
  if (!bloco) return null;
  const m = bloco[0].match(/<CNPJ>\s*([^<]+)\s*<\/CNPJ>/i);
  return m ? String(m[1]).replace(/\D/g, '') : null;
}

function parseDetalhe(row) {
  if (!row) return {};
  const raw = row.detalhe_json || row.detalheJson || row.detalhe;
  if (!raw) return {};
  if (typeof raw === 'object') return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function resolverPeriodo(periodo, agora = new Date()) {
  if (!periodo || periodo === 'tudo') return { inicio: null, fim: null, label: 'tudo' };
  if (typeof periodo === 'object' && (periodo.inicio || periodo.fim)) {
    return { inicio: periodo.inicio || null, fim: periodo.fim || null, label: 'custom' };
  }
  const fim = agora.toISOString();
  if (periodo === '24h' || periodo === 'ultima_24h') {
    return {
      inicio: new Date(agora.getTime() - 24 * 60 * 60 * 1000).toISOString(),
      fim,
      label: '24h'
    };
  }
  if (periodo === '7d' || periodo === 'ultimos_7_dias') {
    return {
      inicio: new Date(agora.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString(),
      fim,
      label: '7d'
    };
  }
  if (periodo === 'ultima_sincronizacao') {
    return { inicio: null, fim: null, label: 'ultima_sincronizacao' };
  }
  return { inicio: null, fim: null, label: String(periodo) };
}

function agregarStatusGeral(achados) {
  let pior = ReconcilicaoStatus.CONSISTENTE;
  const rank = {
    [ReconcilicaoStatus.CONSISTENTE]: 0,
    [ReconcilicaoStatus.ATENCAO]: 1,
    [ReconcilicaoStatus.INCONSISTENTE]: 2,
    [ReconcilicaoStatus.ERRO_ANALISE]: 3
  };
  for (const a of achados) {
    const s = a.severidade || ReconcilicaoStatus.ATENCAO;
    if ((rank[s] || 0) > (rank[pior] || 0)) pior = s;
  }
  return pior;
}

class MotorReconcilicaoDfe {
  /**
   * @param {Object} [deps]
   */
  constructor(deps = {}) {
    this._nsuService = deps.nsuService || null;
    this._nsuRepository = deps.nsuRepository || null;
    this._documentosRepository = deps.documentosRepository || null;
    this._auditoria = deps.auditoriaService || null;
    this._snapshot = deps.snapshotStore || obterSnapshotStore();
    this._agora = deps.agora || (() => new Date());
    this._cnpjEsperado = deps.cnpjEsperado || null;
  }

  /**
   * Resumo leve (sem análise profunda de XML).
   */
  async obterResumo(cnpj, ambiente, opcoes = {}) {
    return this.reconciliar({
      ...opcoes,
      cnpj,
      ambiente,
      modo: 'resumo'
    });
  }

  /**
   * Análise profunda sob demanda.
   */
  async analisarProfundo(cnpj, ambiente, opcoes = {}) {
    return this.reconciliar({
      ...opcoes,
      cnpj,
      ambiente,
      modo: 'profunda'
    });
  }

  /** Alias explícito */
  async reconciliar(opcoes = {}) {
    return this.reconciliaar(opcoes);
  }

  /**
   * @param {Object} opcoes
   * @returns {Promise<Object>}
   */
  async reconciliaar(opcoes = {}) {
    const reconciliationId = opcoes.reconciliationId || criarReconciliationId(this._agora());
    const cnpj = String(opcoes.cnpj || '').replace(/\D/g, '');
    const ambiente = Number(opcoes.ambiente) === 1 ? 1 : 2;
    const modo = opcoes.modo === 'profunda' ? 'profunda' : 'resumo';
    const periodo = resolverPeriodo(opcoes.periodo, this._agora());

    try {
      if (!cnpj) {
        return this._erroAnalise(reconciliationId, cnpj, ambiente, periodo, modo, 'CNPJ obrigatório');
      }

      const cursor = opcoes.cursor
        || await this._carregarCursor(cnpj, ambiente);
      const documentos = opcoes.documentos
        || await this._carregarDocumentos(opcoes);
      const auditoria = opcoes.auditoriaItens
        || await this._carregarAuditoria(cnpj, ambiente, periodo, modo);

      const resultado = this._analisar({
        reconciliationId,
        cnpj,
        ambiente,
        modo,
        periodo,
        cursor,
        documentos,
        auditoria,
        cnpjEsperado: opcoes.cnpjEsperado || this._cnpjEsperado || cnpj
      });

      if (opcoes.salvarSnapshot !== false) {
        this._snapshot.salvar(cnpj, ambiente, resultado);
      }
      return resultado;
    } catch (err) {
      return this._erroAnalise(
        reconciliationId,
        cnpj,
        ambiente,
        periodo,
        modo,
        err.message || 'Erro na análise'
      );
    }
  }

  /**
   * Diagnóstico de um documento (somente leitura).
   */
  diagnosticarDocumento(documento, contexto = {}) {
    if (!documento) return null;
    const st = normalizarStatus(documento.status);
    const stRec = documento.statusRecuperacao || null;
    let situacao = AchadoCodigo.XML_OK;
    if (
      st === DocumentoFiscalStatus.RESUMO_RECEBIDO
      || st === DocumentoFiscalStatus.XML_INDISPONIVEL
      || stRec === StatusRecuperacaoXml.AGUARDANDO_XML_COMPLETO
      || stRec === StatusRecuperacaoXml.RECUPERANDO_XML
    ) {
      situacao = AchadoCodigo.XML_PENDENTE;
    } else if (
      st === DocumentoFiscalStatus.ERRO_RECUPERACAO
      || stRec === StatusRecuperacaoXml.ERRO_RECUPERACAO
      || stRec === StatusRecuperacaoXml.RECUPERACAO_ESGOTADA
    ) {
      situacao = AchadoCodigo.XML_ERRO;
    } else if (st === DocumentoFiscalStatus.XML_COMPLETO || documento.xml) {
      situacao = AchadoCodigo.XML_OK;
    }

    return {
      chave: documento.chave || null,
      nsu: documento.nsu || null,
      cnpj: contexto.cnpj || documento.cnpjFornecedor || null,
      ambiente: contexto.ambiente != null ? contexto.ambiente : null,
      primeiroRecebimento: documento.createdAt || documento.created_at || null,
      ultimaAtualizacao: documento.updatedAt || documento.updated_at || null,
      statusDocumento: st,
      statusXml: situacao,
      statusRecuperacao: stRec,
      tentativasRecuperacao: documento.recuperacaoTentativas || 0,
      ultimoCstat: documento.recuperacaoUltimoCstat || null,
      ultimoXmotivo: documento.recuperacaoUltimoXmotivo || null,
      requestId: documento.recuperacaoUltimoRequestId || null,
      situacaoReconcilicao: situacao
    };
  }

  /**
   * Diagnóstico de um lote a partir de eventos de auditoria (mesmo correlation_id).
   */
  diagnosticarLote(eventosLote = [], meta = {}) {
    const evs = eventosLote || [];
    const detalheNsu = evs
      .filter((e) => String(e.tipo).toUpperCase() === 'NSU')
      .map((e) => parseDetalhe(e));
    const detalheConsulta = evs
      .filter((e) => String(e.tipo).toUpperCase() === 'CONSULTA')
      .map((e) => parseDetalhe(e));
    const nsus = evs.map((e) => e.nsu).filter(Boolean).map(padNsu);
    const sorted = [...new Set(nsus)].sort((a, b) => (nsuBig(a) < nsuBig(b) ? -1 : 1));
    const d0 = detalheNsu[0] || detalheConsulta[0] || {};
    const correlationId = evs[0]?.correlation_id || evs[0]?.correlationId || meta.requestId || null;

    return {
      requestId: correlationId,
      nsuInicial: sorted[0] || d0.ultNsuAnterior || null,
      nsuFinal: sorted[sorted.length - 1] || d0.ultNsuNovo || null,
      maxNsu: d0.maxNsu || detalheConsulta[0]?.maxNsuRecebido || null,
      quantidadeDocumentos: Number(d0.loteQtd != null ? d0.loteQtd : sorted.length) || sorted.length,
      cStat: d0.cStat || detalheConsulta[0]?.cStat || null,
      xMotivo: detalheConsulta[0]?.xMotivo || null,
      dataHora: evs[0]?.created_at || meta.dataHora || null,
      status: sorted.length === 0 ? AchadoCodigo.LOTE_SEM_DOCUMENTOS : 'LOTE_COM_DOCUMENTOS',
      eventos: evs.length
    };
  }

  obterUltimoSnapshot(cnpj, ambiente) {
    return this._snapshot.obter(cnpj, ambiente);
  }

  /** @private */
  _analisar(ctx) {
    const achados = [];
    const {
      reconciliationId, cnpj, ambiente, modo, periodo, cursor, documentos, auditoria, cnpjEsperado
    } = ctx;

    const ultNsu = padNsu(cursor?.ultNsu || '0');
    const maxNsu = padNsu(cursor?.maxNsu || '0');
    const docs = documentos || [];

    // —— XML / documentos ——
    let xmlCompleto = 0;
    let xmlPendente = 0;
    let xmlErro = 0;
    const porNsu = new Map();
    const porChave = new Map();
    const docsComXmlOrfao = [];

    for (const doc of docs) {
      const st = normalizarStatus(doc.status);
      const stRec = doc.statusRecuperacao;
      const nsu = doc.nsu ? padNsu(doc.nsu) : null;
      const chave = doc.chave ? String(doc.chave).replace(/\D/g, '') : null;

      if (nsu) {
        if (!porNsu.has(nsu)) porNsu.set(nsu, []);
        porNsu.get(nsu).push(doc);
      }
      if (chave) {
        if (!porChave.has(chave)) porChave.set(chave, []);
        porChave.get(chave).push(doc);
      } else if (doc.id) {
        achados.push(criarAchado(AchadoCodigo.DOCUMENTO_SEM_CHAVE, {
          documentoId: doc.id,
          nsu
        }));
      }

      if (
        st === DocumentoFiscalStatus.ERRO_RECUPERACAO
        || stRec === StatusRecuperacaoXml.ERRO_RECUPERACAO
        || stRec === StatusRecuperacaoXml.RECUPERACAO_ESGOTADA
      ) {
        xmlErro += 1;
        achados.push(criarAchado(AchadoCodigo.XML_ERRO, {
          documentoId: doc.id,
          chave,
          nsu,
          status: st,
          statusRecuperacao: stRec
        }));
      } else if (
        st === DocumentoFiscalStatus.RESUMO_RECEBIDO
        || st === DocumentoFiscalStatus.XML_INDISPONIVEL
        || stRec === StatusRecuperacaoXml.AGUARDANDO_XML_COMPLETO
        || stRec === StatusRecuperacaoXml.RECUPERANDO_XML
      ) {
        xmlPendente += 1;
        achados.push(criarAchado(AchadoCodigo.XML_PENDENTE, {
          documentoId: doc.id,
          chave,
          nsu
        }));
      } else if (
        st === DocumentoFiscalStatus.XML_COMPLETO
        || st === DocumentoFiscalStatus.EM_REVISAO
        || st === DocumentoFiscalStatus.PRONTA_IMPORTACAO
        || st === DocumentoFiscalStatus.IMPORTADA
        || Boolean(doc.xml)
      ) {
        xmlCompleto += 1;
        if (modo === 'profunda') {
          achados.push(criarAchado(AchadoCodigo.XML_OK, {
            documentoId: doc.id,
            chave,
            nsu
          }));
        }
      }

      if (modo === 'profunda' && doc.xml) {
        const chaveXml = extrairChaveXml(doc.xml);
        if (chave && chaveXml && chaveXml !== chave) {
          achados.push(criarAchado(AchadoCodigo.INCONSISTENCIA_CHAVE_XML, {
            documentoId: doc.id,
            chaveRegistrada: chave,
            chaveXml
          }));
        }
        if (cnpjEsperado) {
          const cnpjDest = extrairCnpjDestXml(doc.xml);
          if (cnpjDest && cnpjDest !== String(cnpjEsperado).replace(/\D/g, '')) {
            achados.push(criarAchado(AchadoCodigo.INCONSISTENCIA_CNPJ_XML, {
              documentoId: doc.id,
              cnpjEsperado,
              cnpjXml: cnpjDest
            }));
          }
        }
        if (!doc.id && !chave) {
          docsComXmlOrfao.push(doc);
        }
      }
    }

    for (const [nsu, lista] of porNsu) {
      if (lista.length > 1) {
        achados.push(criarAchado(AchadoCodigo.DUPLICIDADE_NSU, {
          nsu,
          quantidade: lista.length,
          documentoIds: lista.map((d) => d.id)
        }));
      }
    }
    for (const [chave, lista] of porChave) {
      if (lista.length > 1) {
        achados.push(criarAchado(AchadoCodigo.DUPLICIDADE_CHAVE, {
          chave,
          quantidade: lista.length,
          documentoIds: lista.map((d) => d.id)
        }));
      }
    }
    for (const orf of docsComXmlOrfao) {
      achados.push(criarAchado(AchadoCodigo.XML_SEM_DOCUMENTO, { nsu: orf.nsu || null }));
    }

    // —— Cursor / maxNSU ——
    const diffPosicoes = nsuBig(maxNsu) > nsuBig(ultNsu)
      ? Number(nsuBig(maxNsu) - nsuBig(ultNsu))
      : 0;
    if (diffPosicoes > 0) {
      achados.push(criarAchado(AchadoCodigo.DOCUMENTOS_POSTERIORES_DISPONIVEIS, {
        ultNsu,
        maxNsu,
        posicoesEntre: diffPosicoes,
        mensagem: `Existem ${diffPosicoes} posições de NSU entre o último NSU processado e o MAX NSU informado.`
      }));
    } else {
      achados.push(criarAchado(AchadoCodigo.SEM_DIFERENCA_DE_CURSOR, { ultNsu, maxNsu }));
    }

    // —— Histórico de lotes / NSUs da auditoria ——
    const lotes = this._reconstruirLotes(auditoria || []);
    const nsusRecebidosAudit = [];
    const nsusVistos = new Set();

    for (const ev of auditoria || []) {
      if (ev.nsu) {
        const n = padNsu(ev.nsu);
        nsusRecebidosAudit.push(n);
        nsusVistos.add(n);
      }
      const det = parseDetalhe(ev);
      const cStat = String(det.cStat || '').trim();
      if (cStat === '137' || cStat === '656') {
        achados.push(criarAchado(AchadoCodigo.BLOQUEIO_SEFAZ_REGISTRADO, {
          cStat,
          requestId: ev.correlation_id || ev.correlationId || null,
          timestamp: ev.created_at || null,
          xMotivo: det.xMotivo || ev.motivo || null,
          cnpj,
          ambiente
        }));
      }
      if (String(ev.tipo).toUpperCase() === 'CONSULTA' && Number(det.lotes || 0) === 0) {
        achados.push(criarAchado(AchadoCodigo.LOTE_SEM_DOCUMENTOS, {
          requestId: ev.correlation_id || null,
          cStat: det.cStat || null,
          timestamp: ev.created_at || null
        }));
      }
    }

    // Lacunas nos NSUs observados (docs + auditoria)
    const nsusObservados = [
      ...docs.filter((d) => d.nsu).map((d) => padNsu(d.nsu)),
      ...nsusRecebidosAudit
    ];
    const lacuna = detectarLacunasNsu(nsusObservados, { cnpj, ambiente, data: this._agora().toISOString() });
    for (const l of lacuna.lacunas) {
      achados.push(criarAchado(AchadoCodigo.POSSIVEL_LACUNA_NSU, {
        ...l,
        classificacao: 'POSSIVEL_LACUNA',
        observacao: 'Lacuna aparente — não confirma perda de documento.'
      }));
    }

    // Regressão / salto no histórico de avanço de cursor
    const avancos = (auditoria || [])
      .filter((e) => String(e.tipo).toUpperCase() === 'NSU')
      .map((e) => {
        const d = parseDetalhe(e);
        return {
          anterior: d.ultNsuAnterior != null ? padNsu(d.ultNsuAnterior) : null,
          novo: d.ultNsuNovo != null ? padNsu(d.ultNsuNovo) : (e.nsu ? padNsu(e.nsu) : null),
          requestId: e.correlation_id || null,
          createdAt: e.created_at || null,
          avancou: d.avancou
        };
      })
      .filter((a) => a.anterior && a.novo)
      .sort((a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || '')));

    for (const a of avancos) {
      if (nsuBig(a.novo) < nsuBig(a.anterior)) {
        achados.push(criarAchado(AchadoCodigo.CURSOR_REGRESSAO_DETECTADA, {
          cursorAnterior: a.anterior,
          cursorNovo: a.novo,
          requestId: a.requestId,
          timestamp: a.createdAt
        }));
      } else if (nsuBig(a.novo) > nsuBig(a.anterior) + 1n) {
        const salto = Number(nsuBig(a.novo) - nsuBig(a.anterior));
        // Salto só é alertado se posições intermediárias não foram observadas nos docs/auditoria
        let intermediariosObservados = 0;
        for (let x = nsuBig(a.anterior) + 1n; x < nsuBig(a.novo); x += 1n) {
          if (nsusObservados.includes(formatNsu(x))) intermediariosObservados += 1;
        }
        if (intermediariosObservados === 0 && salto > 1) {
          achados.push(criarAchado(AchadoCodigo.SALTO_NSU_OBSERVADO, {
            cursorAnterior: a.anterior,
            cursorNovo: a.novo,
            posicoes: salto,
            requestId: a.requestId,
            observacao: 'Salto observado no histórico — não assume perda automática.'
          }));
        }
      }
    }

    // NSU na auditoria sem documento persistido (profunda ou quando houver nsus audit)
    if (modo === 'profunda' || nsusVistos.size > 0) {
      for (const nsu of nsusVistos) {
        if (!porNsu.has(nsu)) {
          // NSU de eventos ZIP/PERSISTENCIA sem doc — inconsistência
          const temPersistencia = (auditoria || []).some((e) => {
            const t = String(e.tipo || '').toUpperCase();
            return padNsu(e.nsu) === nsu && (t === 'PERSISTENCIA' || t === 'ZIP');
          });
          if (temPersistencia) {
            achados.push(criarAchado(AchadoCodigo.DOCUMENTO_NSU_SEM_PERSISTENCIA, {
              nsu,
              observacao: 'NSU recebido na auditoria sem documento correspondente persistido.'
            }));
          }
        }
      }
    }

    // Deduplicar achados informativos repetidos (XML_OK em massa no resumo já omitidos)
    const achadosFinais = this._deduplicarAchadosInformativos(achados, modo);
    const status = agregarStatusGeral(achadosFinais);
    const lacunasQtd = achadosFinais.filter((a) => a.codigo === AchadoCodigo.POSSIVEL_LACUNA_NSU).length;
    const duplicidades = achadosFinais.filter((a) => (
      a.codigo === AchadoCodigo.DUPLICIDADE_NSU || a.codigo === AchadoCodigo.DUPLICIDADE_CHAVE
    )).length;
    const erros = achadosFinais.filter((a) => a.severidade === ReconcilicaoStatus.INCONSISTENTE).length;

    const ultimoCstat = cursor?.ultimoCstat
      || (avancos.length ? parseDetalhe((auditoria || []).find((e) => String(e.tipo).toUpperCase() === 'NSU') || {}).cStat : null)
      || null;
    const ultimoXmotivo = cursor?.ultimoXmotivo || null;
    const ultimoRequestId = cursor?.ultimoRequestId
      || (auditoria && auditoria[0] && (auditoria[0].correlation_id || auditoria[0].correlationId))
      || null;

    return {
      reconciliationId,
      cnpj,
      ambiente,
      ambienteLabel: ambiente === 1 ? 'PRODUÇÃO' : 'HOMOLOGAÇÃO',
      executadoEm: this._agora().toISOString(),
      modo,
      periodo,
      status,
      statusLabel: labelReconcilicaoStatus(status),
      severidadeVisual: SEVERIDADE[status] || 'amarelo',
      cursor: {
        ultNsu,
        maxNsu,
        diferencaPosicoes: diffPosicoes,
        mensagemPosteriores: diffPosicoes > 0
          ? `Existem ${diffPosicoes} posições de NSU entre o último NSU processado e o MAX NSU informado.`
          : null,
        ultimoCstat,
        ultimoXmotivo,
        ultimoRequestId,
        ultimaSincronizacao: cursor?.dataSincronizacao || cursor?.updatedAt || null
      },
      resumo: {
        nsusAnalisados: new Set(nsusObservados).size,
        documentos: docs.length,
        documentosRecebidos: docs.length,
        documentosPersistidos: docs.length,
        xmlCompleto,
        aguardandoXml: xmlPendente,
        xmlErro,
        duplicidades,
        lacunasSuspeitas: lacunasQtd,
        erros,
        lotesAnalisados: lotes.length
      },
      lotes,
      achados: achadosFinais,
      indicadoresDashboard: {
        consistentes: status === ReconcilicaoStatus.CONSISTENTE ? 1 : 0,
        atencao: status === ReconcilicaoStatus.ATENCAO ? 1 : 0,
        inconsistencias: status === ReconcilicaoStatus.INCONSISTENTE || status === ReconcilicaoStatus.ERRO_ANALISE ? 1 : 0,
        nsuAtual: ultNsu,
        maxNsu,
        xmlPendentes: xmlPendente,
        possiveisLacunas: lacunasQtd,
        duplicidades
      },
      // Garantia explícita da Sprint
      acoesAutomaticas: [],
      consultaSefaz: false,
      somenteDiagnostico: true
    };
  }

  /** @private */
  _deduplicarAchadosInformativos(achados, modo) {
    if (modo === 'profunda') return achados;
    // No resumo: agrega XML_PENDENTE / XML_OK / XML_ERRO / LOTE_SEM_DOCUMENTOS / BLOQUEIO
    const out = [];
    const contadores = {
      [AchadoCodigo.XML_PENDENTE]: 0,
      [AchadoCodigo.XML_OK]: 0,
      [AchadoCodigo.XML_ERRO]: 0,
      [AchadoCodigo.LOTE_SEM_DOCUMENTOS]: 0,
      [AchadoCodigo.BLOQUEIO_SEFAZ_REGISTRADO]: 0
    };
    for (const a of achados) {
      if (contadores[a.codigo] != null) {
        contadores[a.codigo] += 1;
        continue;
      }
      out.push(a);
    }
    for (const [codigo, qtd] of Object.entries(contadores)) {
      if (qtd > 0 && codigo !== AchadoCodigo.XML_OK) {
        out.push(criarAchado(codigo, { quantidade: qtd, agregado: true }));
      }
    }
    return out;
  }

  /** @private */
  _reconstruirLotes(auditoria) {
    const porCorr = new Map();
    for (const ev of auditoria || []) {
      const cid = ev.correlation_id || ev.correlationId || `id-${ev.id || Math.random()}`;
      if (!porCorr.has(cid)) porCorr.set(cid, []);
      porCorr.get(cid).push(ev);
    }
    const lotes = [];
    for (const [requestId, evs] of porCorr) {
      lotes.push(this.diagnosticarLote(evs, { requestId }));
    }
    return lotes.sort((a, b) => String(a.dataHora || '').localeCompare(String(b.dataHora || '')));
  }

  /** @private */
  async _carregarCursor(cnpj, ambiente) {
    if (this._nsuService?.buscarPorCnpjAmbiente) {
      return this._nsuService.buscarPorCnpjAmbiente(cnpj, ambiente);
    }
    if (this._nsuRepository?.buscarPorCnpjAmbiente) {
      return this._nsuRepository.buscarPorCnpjAmbiente(cnpj, ambiente);
    }
    return null;
  }

  /** @private */
  async _carregarDocumentos(opcoes = {}) {
    if (!this._documentosRepository?.listar) return [];
    const limite = opcoes.modo === 'profunda' ? 2000 : 500;
    return this._documentosRepository.listar({
      limite,
      ordenarPor: 'created_at',
      ordenarDirecao: 'ASC'
    });
  }

  /** @private */
  async _carregarAuditoria(cnpj, ambiente, periodo, modo) {
    if (!this._auditoria?.listar) return [];
    const limite = modo === 'profunda' ? 2000 : 300;
    const { itens } = await this._auditoria.listar({
      cnpj,
      ambiente,
      dataInicio: periodo.inicio ? String(periodo.inicio).slice(0, 10) : undefined,
      dataFim: periodo.fim ? String(periodo.fim).slice(0, 10) : undefined,
      limite
    });
    // Isolamento ambiente (listar pode não filtrar — reforço local)
    return (itens || []).filter((e) => {
      if (e.ambiente == null) return true;
      return Number(e.ambiente) === ambiente;
    });
  }

  /** @private */
  _erroAnalise(reconciliationId, cnpj, ambiente, periodo, modo, mensagem) {
    return {
      reconciliationId,
      cnpj,
      ambiente,
      ambienteLabel: Number(ambiente) === 1 ? 'PRODUÇÃO' : 'HOMOLOGAÇÃO',
      executadoEm: this._agora().toISOString(),
      modo,
      periodo,
      status: ReconcilicaoStatus.ERRO_ANALISE,
      statusLabel: labelReconcilicaoStatus(ReconcilicaoStatus.ERRO_ANALISE),
      severidadeVisual: 'vermelho',
      mensagem,
      resumo: {
        nsusAnalisados: 0,
        documentos: 0,
        xmlCompleto: 0,
        aguardandoXml: 0,
        duplicidades: 0,
        lacunasSuspeitas: 0,
        erros: 1
      },
      achados: [],
      somenteDiagnostico: true,
      consultaSefaz: false,
      acoesAutomaticas: []
    };
  }
}

module.exports = MotorReconcilicaoDfe;
