/**
 * MotorAssociacaoFornecedor — Motor de associação fornecedor + cProd.
 *
 * Responsabilidade exclusiva (SRP): localizar produtos via `miip_associacoes`
 * usando CNPJ + código do fornecedor (cProd), carregando `ProdutoSnapshot`
 * exclusivamente via `ProdutoRepository`.
 *
 * Não utiliza: SQL, banco direto, GTIN, nome, similaridade.
 * Não cria, altera ou aprende associações — somente consulta.
 * Não decide: associar, criar produto ou solicitar confirmação.
 *
 * @class MotorAssociacaoFornecedor
 * @module motores/miip/engines/fornecedor/MotorAssociacaoFornecedor
 */

const IMotorIdentificacao = require('../../core/IMotorIdentificacao');
const MiipConfidence = require('../../core/MiipConfidence');
const MiipCandidate = require('../../core/MiipCandidate');
const MiipEvidence = require('../../core/MiipEvidence');
const ProdutoSnapshot = require('../../core/ProdutoSnapshot');
const ItemIdentificavelDTO = require('../../contracts/ItemIdentificavelDTO');
const { MiipAssociacoesRepository } = require('../../repositories/MiipAssociacoesRepository');
const { ProdutoRepository } = require('../../repositories/ProdutoRepository');
const { normalizarCnpj } = require('../../utils/normalizarCnpj');
const { normalizarCodigoFornecedor } = require('../../utils/normalizarCodigoFornecedor');
const metricsCollector = require('../../metrics/MiipMetricsCollector');
const motorLogService = require('../../logs/MiipMotorLogService');

/** Score para associação ativa com produto ativo. */
const SCORE_ASSOCIACAO_ATIVA = 100;

/** Score para associação ativa com produto inativo. */
const SCORE_ASSOCIACAO_PRODUTO_INATIVO = 60;

const MOTOR_CODIGO = 'motor_associacao_fornecedor';

class MotorAssociacaoFornecedor extends IMotorIdentificacao {
  /**
   * @param {Object} [config]
   * @param {import('../../repositories/MiipAssociacoesRepository')} [config.associacoesRepository]
   * @param {import('../../repositories/ProdutoRepository')} [config.produtoRepository]
   * @param {import('../../metrics/MiipMetricsCollector')} [config.metricsCollector]
   * @param {import('../../logs/MiipMotorLogService')} [config.logService]
   */
  constructor(config = {}) {
    super(config);
    this._associacoesRepository = config.associacoesRepository ?? new MiipAssociacoesRepository({
      db: config.db ?? null
    });
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
    return 'Identificação por associação fornecedor (CNPJ) + código cProd';
  }

  /** @returns {number} */
  getPeso() {
    return 0.95;
  }

  /**
   * @private
   * @param {ItemIdentificavelDTO|Object} item
   * @returns {{ fornecedorCnpj: string|null, codigoFornecedor: string|null }}
   */
  _extrairChaveFornecedor(item) {
    const dto = item instanceof ItemIdentificavelDTO ? item : ItemIdentificavelDTO.create(item);

    return {
      fornecedorCnpj: normalizarCnpj(dto.fornecedorCnpj),
      codigoFornecedor: normalizarCodigoFornecedor(dto.codigoFornecedor)
    };
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
   * @param {Object} associacao
   * @param {string} fornecedorCnpj
   * @param {string} codigoFornecedor
   * @param {ProdutoSnapshot} snapshot
   * @param {number} score
   * @returns {MiipEvidence[]}
   */
  _montarEvidencias(associacao, fornecedorCnpj, codigoFornecedor, snapshot, score) {
    return [
      MiipEvidence.agora({
        motor: MOTOR_CODIGO,
        tipo: 'associacao_fornecedor',
        descricao: 'Associação ativa encontrada em miip_associacoes',
        peso: score,
        valor: associacao.id,
        score
      }),
      MiipEvidence.agora({
        motor: MOTOR_CODIGO,
        tipo: 'fornecedor_cnpj',
        descricao: 'CNPJ do fornecedor utilizado no lookup',
        peso: 0,
        valor: fornecedorCnpj,
        score: 0
      }),
      MiipEvidence.agora({
        motor: MOTOR_CODIGO,
        tipo: 'codigo_fornecedor',
        descricao: 'Código cProd do fornecedor utilizado no lookup',
        peso: 0,
        valor: codigoFornecedor,
        score: 0
      }),
      MiipEvidence.agora({
        motor: MOTOR_CODIGO,
        tipo: 'produto_snapshot',
        descricao: 'Produto carregado via ProdutoRepository',
        peso: score,
        valor: snapshot.id,
        score
      }),
      MiipEvidence.agora({
        motor: MOTOR_CODIGO,
        tipo: 'origem_dados',
        descricao: 'Fontes consultadas pelo motor',
        peso: 0,
        valor: 'miip_associacoes+ProdutoRepository',
        score: 0
      })
    ];
  }

  /**
   * @private
   * @param {Object} associacao
   * @param {ProdutoSnapshot} snapshot
   * @param {string} fornecedorCnpj
   * @param {string} codigoFornecedor
   * @returns {MiipCandidate}
   */
  _montarCandidato(associacao, snapshot, fornecedorCnpj, codigoFornecedor) {
    const ativo = this._produtoAtivo(snapshot);
    const scoreTotal = ativo ? SCORE_ASSOCIACAO_ATIVA : SCORE_ASSOCIACAO_PRODUTO_INATIVO;
    const confianca = ativo ? MiipConfidence.ALTA : MiipConfidence.MEDIA;

    return MiipCandidate.create({
      produtoId: snapshot.id,
      snapshot,
      produto: snapshot.toResumo(),
      scoreTotal,
      confianca,
      ranking: 1,
      evidencias: this._montarEvidencias(associacao, fornecedorCnpj, codigoFornecedor, snapshot, scoreTotal),
      motoresQueVotaram: [MOTOR_CODIGO],
      atributosExtraidos: {
        fornecedorCnpj,
        codigoFornecedor,
        associacaoId: associacao.id,
        origemDados: 'MiipAssociacoesRepository',
        statusAssociacao: associacao.status ?? 'ativa'
      }
    });
  }

  /**
   * Identifica produto por associação fornecedor + cProd — retorna MiipCandidate[] (nunca null).
   *
   * @param {ItemIdentificavelDTO|Object} item
   * @param {import('../../core/MiipContext')|Object} [_contexto]
   * @returns {Promise<MiipCandidate[]>}
   */
  async identificar(item, _contexto) {
    const { fornecedorCnpj, codigoFornecedor } = this._extrairChaveFornecedor(item);
    if (!fornecedorCnpj || !codigoFornecedor) return [];

    const associacao = await this._associacoesRepository.buscarPorFornecedorCodigo(
      fornecedorCnpj,
      codigoFornecedor
    );
    if (!associacao?.produtoId) return [];

    const snapshot = await this._produtoRepository.buscarPorId(associacao.produtoId);
    if (!snapshot) return [];

    return [this._montarCandidato(associacao, snapshot, fornecedorCnpj, codigoFornecedor)];
  }

  /**
   * @private
   * @param {Object} params
   */
  _registrarTelemetria(params) {
    const {
      item,
      contexto,
      resultado,
      duracaoMs,
      erro,
      fornecedorCnpj,
      codigoFornecedor,
      produtoId
    } = params;

    this._metrics.registrarExecucao({
      motor: MOTOR_CODIGO,
      duracaoMs,
      encontrado: (resultado?.candidatos?.length ?? 0) > 0,
      erro: Boolean(erro)
    });

    this._logs.registrar({
      motor: MOTOR_CODIGO,
      engine: MOTOR_CODIGO,
      item: item instanceof ItemIdentificavelDTO ? item.toJSON() : item,
      resultado,
      duracaoMs,
      tempoMs: duracaoMs,
      fornecedorCnpj: fornecedorCnpj ?? null,
      codigoFornecedor: codigoFornecedor ?? null,
      produtoId: produtoId ?? null,
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
    const chave = this._extrairChaveFornecedor(item);
    let candidatos = [];
    let erro = null;

    try {
      candidatos = await this.identificar(item, contexto);
    } catch (error) {
      erro = error?.message || 'Erro desconhecido no MotorAssociacaoFornecedor';
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
      erro,
      fornecedorCnpj: chave.fornecedorCnpj,
      codigoFornecedor: chave.codigoFornecedor,
      produtoId: candidatos[0]?.produtoId ?? null
    });

    return resultado;
  }
}

module.exports = MotorAssociacaoFornecedor;
