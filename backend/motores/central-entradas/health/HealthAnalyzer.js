/**
 * Analisador de saúde documental (RC3.4.6).
 * Lê banco + MIRX state (somente leitura). Sem SEFAZ.
 *
 * @module motores/central-entradas/health/HealthAnalyzer
 */

const HealthRepository = require('./HealthRepository');
const { avaliarDocumento, consolidar, formatarDuracao } = require('./HealthRules');
const { HealthNiveis, obterLabel, obterIndicador } = require('./HealthNiveis');
const { DocumentoFiscalStatus } = require('../core/DocumentoFiscalStatus');

const STATUS_ENCERRADOS = new Set([
  DocumentoFiscalStatus.XML_INDISPONIVEL,
  DocumentoFiscalStatus.GRAVADA,
  DocumentoFiscalStatus.DESCARTADA,
  DocumentoFiscalStatus.DUPLICADA
]);

class HealthAnalyzer {
  /**
   * @param {Object} [deps]
   */
  constructor(deps = {}) {
    this._repo = deps.repository || new HealthRepository(deps);
    this._obterMirx = deps.obterMirx
      || (() => {
        try {
          return require('../services/CentralXmlWaitScheduler');
        } catch {
          return null;
        }
      });
    this._agora = deps.agora || (() => Date.now());
  }

  /**
   * @param {Object} doc
   * @param {Object} [wait]
   * @param {Object} [anterior]
   */
  analisarUm(doc, wait = null, anterior = null) {
    const mirx = this._obterMirx();
    const estado = wait != null
      ? wait
      : (mirx && typeof mirx.obterEstadoDocumento === 'function'
        ? mirx.obterEstadoDocumento(doc.id)
        : null);

    const alertas = avaliarDocumento(doc, estado || {}, { agora: this._agora() });
    const cons = consolidar(alertas);
    let nivel = cons.nivel;

    if (
      anterior
      && anterior.nivel
      && anterior.nivel !== HealthNiveis.SAUDAVEL
      && nivel === HealthNiveis.SAUDAVEL
    ) {
      nivel = HealthNiveis.RESOLVIDO;
    }

    const ind = obterIndicador(nivel);
    const principal = cons.alertaPrincipal;
    const encerrado = STATUS_ENCERRADOS.has(doc.status) || nivel === HealthNiveis.BLOQUEADO;

    return {
      documentoId: doc.id,
      chave: doc.chave,
      fornecedor: doc.fornecedor,
      status: doc.status,
      dataEmissao: doc.dataEmissao || null,
      numero: doc.numero != null ? doc.numero : null,
      serie: doc.serie != null ? doc.serie : null,
      /** Data em que o documento entrou no estado terminal / bloqueado. */
      dataEncerramento: encerrado ? (doc.updatedAt || null) : null,
      nivel,
      nivelLabel: obterLabel(nivel),
      indicador: ind.emoji,
      cor: ind.cor,
      regra: principal?.regra || null,
      diagnostico: principal?.diagnostico
        || (nivel === HealthNiveis.RESOLVIDO
          ? 'Alerta resolvido automaticamente — documento voltou ao fluxo normal.'
          : 'Documento saudável — sem anomalias detectadas.'),
      recomendacao: principal?.recomendacao
        || (nivel === HealthNiveis.SAUDAVEL || nivel === HealthNiveis.RESOLVIDO
          ? 'Nenhuma ação necessária.'
          : null),
      tempoParadoMs: principal?.tempoParadoMs || null,
      tempoParadoLabel: principal?.tempoParadoMs != null
        ? formatarDuracao(principal.tempoParadoMs)
        : null,
      autoRecuperavel: Boolean(principal?.autoRecuperavel),
      acaoInterna: principal?.acaoInterna || null,
      alertas: cons.alertas,
      mirx: estado
        ? {
          estadoMirx: estado.estadoMirx || null,
          dormindo: Boolean(estado.dormindo),
          tentativas: estado.tentativas || 0,
          proximaTentativa: estado.proximaTentativa || null
        }
        : null,
      detectadoEm: new Date(this._agora()).toISOString(),
      ultimaAtualizacaoDoc: doc.updatedAt || null
    };
  }

  /**
   * Varredura completa (somente local).
   * @param {Object} [opcoes]
   */
  async analisarTodos(opcoes = {}) {
    const inicio = Date.now();
    const anteriores = opcoes.anteriores || {};
    const docs = await this._repo.listarDocumentosParaAnalise(opcoes.limite);
    const resultados = [];
    const porNivel = {
      [HealthNiveis.SAUDAVEL]: 0,
      [HealthNiveis.ATENCAO]: 0,
      [HealthNiveis.CRITICO]: 0,
      [HealthNiveis.BLOQUEADO]: 0,
      [HealthNiveis.RESOLVIDO]: 0
    };

    for (const doc of docs) {
      const prev = anteriores[String(doc.id)] || null;
      const av = this.analisarUm(doc, null, prev);
      resultados.push(av);
      porNivel[av.nivel] = (porNivel[av.nivel] || 0) + 1;
    }

    const alertas = resultados.filter(
      (r) => r.nivel === HealthNiveis.ATENCAO
        || r.nivel === HealthNiveis.CRITICO
        || r.nivel === HealthNiveis.BLOQUEADO
    );

    const stats = await this._repo.obterEstatisticasFluxo();
    let taxaMirx = null;
    try {
      const tel = this._obterMirx()?.obterTelemetria?.() || {};
      const ok = Number(tel.documentosRecuperados || 0);
      const tent = Number(tel.numeroTentativas || tel.tentativasTotais || 0);
      if (ok > 0 || tent > 0) {
        taxaMirx = tent > 0 ? Math.round((ok / Math.max(tent, 1)) * 100) : 100;
      }
    } catch { /* ignore */ }

    return {
      analisados: docs.length,
      tempoScanMs: Date.now() - inicio,
      contadores: {
        saudaveis: porNivel[HealthNiveis.SAUDAVEL] || 0,
        atencao: porNivel[HealthNiveis.ATENCAO] || 0,
        criticos: porNivel[HealthNiveis.CRITICO] || 0,
        bloqueados: porNivel[HealthNiveis.BLOQUEADO] || 0,
        resolvidos: porNivel[HealthNiveis.RESOLVIDO] || 0,
        emAlerta: alertas.length
      },
      alertas: alertas
        .sort((a, b) => {
          const p = { CRITICO: 3, BLOQUEADO: 2, ATENCAO: 1 };
          return (p[b.nivel] || 0) - (p[a.nivel] || 0);
        }),
      documentos: resultados,
      estatisticas: {
        ...stats,
        documentosEmAlerta: alertas.length,
        taxaSucessoMirx: taxaMirx
      },
      geradoEm: new Date(this._agora()).toISOString()
    };
  }
}

module.exports = HealthAnalyzer;
