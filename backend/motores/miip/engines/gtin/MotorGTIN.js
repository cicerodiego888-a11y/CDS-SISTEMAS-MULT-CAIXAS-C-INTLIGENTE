/**
 * MotorGTIN — Motor de identificação por GTIN/EAN.
 *
 * Responsabilidade exclusiva (SRP): localizar produtos via `ProdutoRepository`.
 *
 * Não utiliza: SQL, banco direto, nome, fornecedor, similaridade, histórico.
 * Não decide: associar, criar produto ou solicitar confirmação — apenas candidatos.
 *
 * @class MotorGTIN
 * @module motores/miip/engines/gtin/MotorGTIN
 */

const IMotorIdentificacao = require('../../core/IMotorIdentificacao');
const MiipConfidence = require('../../core/MiipConfidence');
const MiipCandidate = require('../../core/MiipCandidate');
const MiipEvidence = require('../../core/MiipEvidence');
const ProdutoSnapshot = require('../../core/ProdutoSnapshot');
const ItemIdentificavelDTO = require('../../contracts/ItemIdentificavelDTO');
const { ProdutoRepository } = require('../../repositories/ProdutoRepository');
const { normalizarGtin } = require('../../utils/normalizarGtin');
const metricsCollector = require('../../metrics/MiipMetricsCollector');
const motorLogService = require('../../logs/MiipMotorLogService');

/** Score para match exato GTIN em produto ativo. */
const SCORE_GTIN_ATIVO = 100;

/** Score para match exato GTIN em produto inativo. */
const SCORE_GTIN_INATIVO = 60;

const MOTOR_CODIGO = 'motor_gtin';

class MotorGTIN extends IMotorIdentificacao {
  /**
   * @param {Object} [config]
   * @param {import('../../repositories/ProdutoRepository')} [config.produtoRepository]
   * @param {import('../../metrics/MiipMetricsCollector')} [config.metricsCollector]
   * @param {import('../../logs/MiipMotorLogService')} [config.logService]
   */
  constructor(config = {}) {
    super(config);
    this._produtoRepository = config.produtoRepository ?? new ProdutoRepository({
      db: config.db ?? null
    });
    this._metrics = config.metricsCollector ?? metricsCollector;
    this._logs = config.logService ?? motorLogService;
  }

  /** @returns {string} */
  getCodigo() {
    return MOTOR_CODIGO;
  }

  /** @returns {string} */
  getDescricao() {
    return 'Identificação exclusiva por GTIN/EAN (codigo_barras)';
  }

  /** @returns {number} */
  getPeso() {
    return 1.0;
  }

  /**
   * @private
   * @param {ItemIdentificavelDTO|Object} item
   * @returns {string|null}
   */
  _extrairGtin(item) {
    const dto = item instanceof ItemIdentificavelDTO ? item : ItemIdentificavelDTO.create(item);
    return normalizarGtin(dto.codigoBarras);
  }

  /**
   * @private
   * @param {ProdutoSnapshot|Object} snapshot
   * @returns {boolean}
   */
  _produtoAtivo(snapshot) {
    const ativo = snapshot?.ativo;
    return ativo === 1 || ativo === '1' || ativo === true;
  }

  /**
   * @private
   * @param {string} gtin
   * @param {ProdutoSnapshot|null} snapshot
   * @param {boolean} ativo
   * @param {number} score
   * @returns {MiipEvidence[]}
   */
  _montarEvidencias(gtin, snapshot, ativo, score) {
    let viaMip = false;
    try {
      const { isProdutoIdentidadeEnabled } = require('../../../produto-identidade/config/produtoIdentidadeFlags');
      viaMip = isProdutoIdentidadeEnabled() === true;
    } catch {
      viaMip = false;
    }

    const evidencias = [
      MiipEvidence.agora({
        motor: MOTOR_CODIGO,
        tipo: 'gtin_exato',
        descricao: viaMip
          ? 'GTIN resolvido via MIP (produto_identificadores) com fallback codigo_barras'
          : 'GTIN localizado em produtos.codigo_barras',
        peso: 100,
        valor: gtin,
        score
      }),
      MiipEvidence.agora({
        motor: MOTOR_CODIGO,
        tipo: 'campo_origem',
        descricao: 'Campo utilizado na identificação',
        peso: 0,
        valor: viaMip ? 'mip|codigo_barras' : 'codigo_barras',
        score: 0
      })
    ];

    if (snapshot) {
      evidencias.push(
        MiipEvidence.agora({
          motor: MOTOR_CODIGO,
          tipo: 'produto_encontrado',
          descricao: 'Produto localizado via ProdutoRepository',
          peso: score,
          valor: snapshot.id,
          score
        }),
        MiipEvidence.agora({
          motor: MOTOR_CODIGO,
          tipo: 'produto_ativo',
          descricao: 'Status do produto no cadastro',
          peso: ativo ? 100 : 0,
          valor: ativo,
          score: ativo ? score : 0
        })
      );
    }

    return evidencias;
  }

  /**
   * @private
   * @param {ProdutoSnapshot} snapshot
   * @param {string} gtin
   * @returns {MiipCandidate}
   */
  _montarCandidato(snapshot, gtin) {
    const ativo = this._produtoAtivo(snapshot);
    const scoreTotal = ativo ? SCORE_GTIN_ATIVO : SCORE_GTIN_INATIVO;
    const confianca = ativo ? MiipConfidence.ALTA : MiipConfidence.MEDIA;

    return MiipCandidate.create({
      produtoId: snapshot.id,
      snapshot,
      produto: snapshot.toResumo(),
      scoreTotal,
      confianca,
      ranking: 1,
      evidencias: this._montarEvidencias(gtin, snapshot, ativo, scoreTotal),
      motoresQueVotaram: [MOTOR_CODIGO],
      atributosExtraidos: {
        gtin,
        origemDados: 'ProdutoRepository',
        campoOrigem: 'codigo_barras'
      }
    });
  }

  /**
   * Identifica produto por GTIN — retorna MiipCandidate[] (nunca null).
   *
   * @param {ItemIdentificavelDTO|Object} item
   * @param {import('../../core/MiipContext')|Object} [_contexto]
   * @returns {Promise<MiipCandidate[]>}
   */
  async identificar(item, _contexto) {
    const gtin = this._extrairGtin(item);
    if (!gtin) return [];

    const snapshot = await this._produtoRepository.buscarPorGtin(gtin);
    if (!snapshot) return [];

    return [this._montarCandidato(snapshot, gtin)];
  }

  /**
   * @private
   * @param {Object} params
   */
  _registrarTelemetria(params) {
    const { item, contexto, resultado, duracaoMs, erro } = params;

    this._metrics.registrarExecucao({
      motor: MOTOR_CODIGO,
      duracaoMs,
      encontrado: (resultado?.candidatos?.length ?? 0) > 0,
      erro: Boolean(erro)
    });

    this._logs.registrar({
      motor: MOTOR_CODIGO,
      item: item instanceof ItemIdentificavelDTO ? item.toJSON() : item,
      resultado,
      duracaoMs,
      contexto: contexto ?? null,
      erro: erro ?? null
    });
  }

  /**
   * Execução com telemetria — produz candidatos, sem decisão de negócio.
   *
   * @param {ItemIdentificavelDTO|Object} item
   * @param {import('../../core/MiipContext')|Object} [contexto]
   * @returns {Promise<{ motor: string, candidatos: MiipCandidate[], evidencias: MiipEvidence[], duracaoMs: number, startedAt: string, finishedAt: string }>}
   */
  async executar(item, contexto) {
    const startedAt = new Date().toISOString();
    const inicio = Date.now();
    let candidatos = [];
    let erro = null;

    try {
      candidatos = await this.identificar(item, contexto);
    } catch (error) {
      erro = error?.message || 'Erro desconhecido no MotorGTIN';
      candidatos = [];
    }

    const durationMs = Date.now() - inicio;
    const evidencias = candidatos.flatMap((c) => c.evidencias);

    const resultado = {
      motor: MOTOR_CODIGO,
      candidatos,
      evidencias,
      duracaoMs: durationMs,
      startedAt,
      finishedAt: new Date().toISOString()
    };

    this._registrarTelemetria({
      item,
      contexto,
      resultado,
      duracaoMs: durationMs,
      erro
    });

    return resultado;
  }
}

module.exports = MotorGTIN;
