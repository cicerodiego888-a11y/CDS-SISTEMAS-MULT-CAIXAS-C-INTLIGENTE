/**
 * MiipLearningService — Único serviço autorizado a persistir aprendizado MIIP.
 *
 * Sprint 5: grava associações em `miip_associacoes` somente com confirmação explícita
 * do operador. Sprint 2.4: origem `auto_*` (identificação automática) é rejeitada.
 *
 * Nenhum Engine grava aprendizado — toda persistência via `MiipAssociacoesRepository`.
 *
 * @class MiipLearningService
 */

const MiipLearningEvent = require('../core/MiipLearningEvent');
const MiipConfidence = require('../core/MiipConfidence');
const { MiipAssociacoesRepository } = require('../repositories/MiipAssociacoesRepository');
const { ProdutoRepository } = require('../repositories/ProdutoRepository');
const { normalizarCnpj } = require('../utils/normalizarCnpj');
const { normalizarCodigoFornecedor } = require('../utils/normalizarCodigoFornecedor');
const { mapearItemCompraParaIdentificavel } = require('../utils/mapearItemCompra');
const learningMetrics = require('../metrics/MiipLearningMetricsCollector');
const aprendizadoLogService = require('../logs/MiipAprendizadoLogService');

const SCORE_CONFIRMACAO = 100;

const TIPO_CONFIRMACAO_MANUAL = 'manual_operador';

function origemAutomatica(origem) {
  return String(origem ?? '').trim().toLowerCase().startsWith('auto_');
}

/** Estado retornado quando associação ativa conflita com produto novo — decisão na UI. */
const ESTADO_ASSOCIACAO_EXISTENTE_DIFERENTE = 'ASSOCIACAO_EXISTENTE_DIFERENTE';

/**
 * @param {string} valor
 * @returns {string}
 */
function normalizarNomeItem(valor) {
  return String(valor ?? '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

class MiipLearningService {
  /**
   * @param {Object} [deps]
   * @param {import('../repositories/MiipAssociacoesRepository')} [deps.associacoesRepository]
   * @param {import('../metrics/MiipLearningMetricsCollector')} [deps.metricsCollector]
   * @param {import('../logs/MiipAprendizadoLogService')} [deps.logService]
   * @param {import('../repositories/ProdutoRepository')} [deps.produtoRepository]
   * @param {Object|null} [deps.db]
   */
  constructor(deps = {}) {
    this._associacoesRepository = deps.associacoesRepository ?? new MiipAssociacoesRepository({
      db: deps.db ?? null
    });
    this._produtoRepository = deps.produtoRepository ?? new ProdutoRepository({
      db: deps.db ?? null
    });
    this._metrics = deps.metricsCollector ?? learningMetrics;
    this._logs = deps.logService ?? aprendizadoLogService;
  }

  /**
   * @private
   * @param {Object} dados
   * @returns {Object}
   */
  _normalizarEntrada(dados = {}) {
    const item = dados.item && typeof dados.item === 'object'
      ? mapearItemCompraParaIdentificavel(dados.item)
      : null;

    const fornecedorCnpj = normalizarCnpj(
      dados.cnpj ?? dados.fornecedorCnpj ?? dados.fornecedor_cnpj ?? item?.fornecedorCnpj
    );
    const codigoFornecedor = normalizarCodigoFornecedor(
      dados.codigoFornecedor ?? dados.codigo_fornecedor ?? item?.codigoFornecedor
    );
    const produtoId = Number(dados.produtoId ?? dados.produto_id ?? dados.produtoEscolhido);
    const confirmado = dados.confirmado === true
      || dados.confirmacaoUsuario === true
      || dados.confirmacaoExplicita === true;

    const descricao = dados.descricaoFornecedor
      ?? dados.descricao_fornecedor
      ?? dados.nomeItem
      ?? dados.nome_item
      ?? item?.produtoNome
      ?? (codigoFornecedor ? `Item fornecedor ${codigoFornecedor}` : 'Item confirmado');

    return {
      requestId: dados.requestId ?? dados.operacaoId ?? dados.operacao_id ?? null,
      confirmado,
      produtoId: Number.isFinite(produtoId) && produtoId > 0 ? produtoId : null,
      fornecedorCnpj,
      codigoFornecedor,
      fornecedor: dados.fornecedor ?? dados.fornecedorNome ?? dados.fornecedor_nome ?? item?.fornecedorNome ?? '',
      descricaoFornecedor: String(descricao).trim() || 'Item confirmado',
      nomeNormalizado: normalizarNomeItem(descricao),
      codigoBarras: dados.codigoBarras ?? dados.codigo_barras ?? item?.codigoBarras ?? null,
      ncm: dados.ncm ?? item?.ncm ?? null,
      unidade: dados.unidade ?? item?.unidade ?? null,
      usuario: dados.usuario ?? dados.usuarioId ?? dados.confirmadoPorUsuarioId ?? dados.usuario_id ?? null,
      origem: dados.origem ?? 'feedback',
      operacaoId: dados.operacaoId ?? dados.operacao_id ?? dados.requestId ?? null,
      confirmarSubstituicao: dados.confirmarSubstituicao === true,
      substituicaoCancelada: dados.substituicaoCancelada === true
    };
  }

  /**
   * @param {Object} entrada
   * @returns {{ valido: boolean, motivo: string|null }}
   */
  validarConfirmacao(entrada) {
    if (origemAutomatica(entrada.origem)) {
      return { valido: false, motivo: 'aprendizado_automatico_nao_permitido' };
    }
    if (!entrada.confirmado) {
      return { valido: false, motivo: 'confirmacao_usuario_obrigatoria' };
    }
    if (!entrada.fornecedorCnpj) {
      return { valido: false, motivo: 'fornecedor_cnpj_obrigatorio' };
    }
    if (!entrada.codigoFornecedor) {
      return { valido: false, motivo: 'codigo_fornecedor_obrigatorio' };
    }
    if (!entrada.produtoId) {
      return { valido: false, motivo: 'produto_id_obrigatorio' };
    }

    return { valido: true, motivo: null };
  }

  /**
   * O produto confirmado precisa existir e estar ativo para virar mapeamento.
   *
   * @param {Object} entrada
   * @returns {Promise<{ valido: boolean, motivo: string|null }>}
   */
  async validarProdutoConfirmado(entrada) {
    let produto = null;
    try {
      produto = await this._produtoRepository.buscarPorId(entrada.produtoId);
    } catch (_) {
      return { valido: false, motivo: 'produto_nao_validado' };
    }
    if (!produto) return { valido: false, motivo: 'produto_inexistente' };
    const ativo = produto.ativo;
    if (!(ativo == null || ativo === 1 || ativo === '1' || ativo === true)) {
      return { valido: false, motivo: 'produto_inativo' };
    }
    return { valido: true, motivo: null };
  }

  /**
   * @private
   * @param {Object} entrada
   * @returns {MiipLearningEvent}
   */
  _criarEvento(entrada) {
    return MiipLearningEvent.create({
      requestId: entrada.requestId ?? entrada.operacaoId,
      produtoId: entrada.produtoId,
      fornecedor: entrada.fornecedor,
      cnpj: entrada.fornecedorCnpj,
      codigoFornecedor: entrada.codigoFornecedor,
      descricaoFornecedor: entrada.descricaoFornecedor,
      usuario: entrada.usuario,
      origem: entrada.origem
    });
  }

  /**
   * @private
   * @param {Object} params
   */
  _registrarLog(params) {
    const {
      evento,
      entrada,
      resultado,
      duracaoMs,
      erro
    } = params;

    this._logs.registrar({
      evento,
      dados: {
        usuario: entrada.usuario,
        fornecedor: entrada.fornecedor,
        fornecedorCnpj: entrada.fornecedorCnpj,
        codigoFornecedor: entrada.codigoFornecedor,
        produtoId: entrada.produtoId,
        descricaoFornecedor: entrada.descricaoFornecedor,
        origem: entrada.origem,
        confirmado: entrada.confirmado
      },
      resultado,
      motivo: resultado?.motivo ?? null,
      erro: erro ?? null,
      duracaoMs
    });
  }

  /**
   * Persiste aprendizado confirmado pelo usuário.
   *
   * @param {Object} dados
   * @returns {Promise<Object>}
   */
  async registrarConfirmacao(dados) {
    const inicio = Date.now();
    const entrada = this._normalizarEntrada(dados);
    const evento = this._criarEvento(entrada);

    this._registrarLog({
      evento: 'aprendizado_inicio',
      entrada,
      resultado: { evento: evento.toJSON() },
      duracaoMs: 0
    });

    let validacao = this.validarConfirmacao(entrada);
    if (validacao.valido) {
      validacao = await this.validarProdutoConfirmado(entrada);
    }
    if (!validacao.valido) {
      const resultado = {
        sucesso: false,
        gravado: false,
        rejeitado: true,
        associacaoId: null,
        operacaoId: entrada.operacaoId,
        evento: evento.toJSON(),
        motivo: validacao.motivo
      };

      this._metrics.registrar({ tipo: 'rejeitado', duracaoMs: Date.now() - inicio });
      this._registrarLog({
        evento: 'aprendizado_rejeitado',
        entrada,
        resultado,
        duracaoMs: Date.now() - inicio
      });

      return resultado;
    }

    let resultado;
    let erro = null;

    try {
      resultado = await this._processarAprendizado(entrada, evento);
    } catch (error) {
      erro = error?.message || 'Erro desconhecido no MiipLearningService';
      resultado = {
        sucesso: false,
        gravado: false,
        rejeitado: false,
        associacaoId: null,
        operacaoId: entrada.operacaoId,
        evento: evento.toJSON(),
        motivo: 'erro_persistencia',
        erro
      };
      this._metrics.registrar({ tipo: 'erro', duracaoMs: Date.now() - inicio });
    }

    const duracaoMs = Date.now() - inicio;

    if (!erro) {
      const tipoMetrica = resultado.substituida
        ? 'substituicao'
        : (resultado.reativada
          ? 'reativacao'
          : (resultado.reutilizacao
            ? 'reutilizacao'
            : (resultado.gravado
              ? 'novo'
              : (resultado.estado === ESTADO_ASSOCIACAO_EXISTENTE_DIFERENTE ? 'conflito' : 'rejeitado'))));
      this._metrics.registrar({ tipo: tipoMetrica, duracaoMs });
    }

    this._registrarLog({
      evento: erro
        ? 'aprendizado_erro'
        : (resultado.gravado || resultado.reutilizacao || resultado.reativada
          ? 'aprendizado_gravado'
          : 'aprendizado_rejeitado'),
      entrada,
      resultado,
      duracaoMs,
      erro
    });

    return resultado;
  }

  /**
   * @private
   * @param {Object} entrada
   * @param {Object} existente
   * @param {MiipLearningEvent} evento
   * @param {Object} [opcoes]
   * @returns {Object}
   */
  _retornarAssociacaoExistenteDiferente(entrada, existente, evento, opcoes = {}) {
    return {
      sucesso: false,
      gravado: false,
      rejeitado: false,
      pendenteDecisao: true,
      reutilizacao: false,
      reativada: false,
      substituida: false,
      associacaoId: existente.id,
      operacaoId: entrada.operacaoId,
      evento: evento.toJSON(),
      estado: ESTADO_ASSOCIACAO_EXISTENTE_DIFERENTE,
      conflito: {
        produtoAtual: Number(existente.produtoId),
        produtoNovo: entrada.produtoId,
        fornecedor: entrada.fornecedor,
        codigoFornecedor: entrada.codigoFornecedor
      },
      motivo: opcoes.motivo ?? 'associacao_existente_diferente'
    };
  }

  /**
   * Mapeamento antigo gravado sem pessoa (auto_*) confirmado agora pelo operador
   * passa a valer como confirmação manual; a origem anterior fica nos metadados.
   *
   * @private
   * @returns {Promise<Object|null>} associação atualizada, ou null se nada mudou
   */
  async _promoverMapeamentoAutomatico(existente, atualizada, entrada) {
    if (!origemAutomatica(existente?.origem)) return null;
    if (typeof this._associacoesRepository.atualizar !== 'function') return null;
    const metadados = {
      ...((atualizada && atualizada.metadados) || existente.metadados || {}),
      tipo_confirmacao: TIPO_CONFIRMACAO_MANUAL,
      origem_anterior: existente.origem,
      confirmada_manual_em: new Date().toISOString(),
      confirmada_manual_por: entrada.usuario ?? null
    };
    return this._associacoesRepository.atualizar(existente.id, {
      origem: entrada.origem,
      confirmadoPorUsuarioId: entrada.usuario ?? null,
      metadados
    });
  }

  /**
   * @private
   * @param {Object} entrada
   * @param {MiipLearningEvent} evento
   * @returns {Promise<Object>}
   */
  async _processarAprendizado(entrada, evento) {
    const existente = await this._associacoesRepository.buscarAssociacao(
      entrada.fornecedorCnpj,
      entrada.codigoFornecedor
    );

    if (
      existente
      && existente.status === 'ativa'
      && Number(existente.produtoId) !== entrada.produtoId
    ) {
      if (entrada.substituicaoCancelada) {
        return this._retornarAssociacaoExistenteDiferente(entrada, existente, evento, {
          motivo: 'substituicao_cancelada'
        });
      }

      if (!entrada.confirmarSubstituicao) {
        return this._retornarAssociacaoExistenteDiferente(entrada, existente, evento);
      }

      await this._associacoesRepository.desativarAssociacao(existente.id);

      const associacao = await this._associacoesRepository.salvarAssociacao({
        produtoId: entrada.produtoId,
        origem: entrada.origem,
        fornecedorCnpj: entrada.fornecedorCnpj,
        fornecedorNome: entrada.fornecedor,
        codigoFornecedor: entrada.codigoFornecedor,
        codigoBarras: entrada.codigoBarras,
        nomeItem: entrada.descricaoFornecedor,
        nomeNormalizado: entrada.nomeNormalizado,
        ncm: entrada.ncm,
        unidade: entrada.unidade,
        score: SCORE_CONFIRMACAO,
        confianca: MiipConfidence.ALTA,
        status: 'ativa',
        fonte: 'aprendizado',
        decisaoOperacaoId: entrada.operacaoId,
        confirmadoPorUsuarioId: entrada.usuario,
        metadados: {
          servico: 'MiipLearningService',
          tipo_confirmacao: TIPO_CONFIRMACAO_MANUAL,
          evento: evento.toJSON(),
          substituiuAssociacaoId: existente.id
        }
      });

      return {
        sucesso: true,
        gravado: true,
        rejeitado: false,
        reutilizacao: false,
        reativada: false,
        substituida: true,
        associacaoAnteriorId: existente.id,
        associacaoId: associacao?.id ?? null,
        confirmacoes: 1,
        operacaoId: entrada.operacaoId,
        evento: evento.toJSON(),
        motivo: 'associacao_substituida'
      };
    }

    if (existente && existente.status === 'ativa' && Number(existente.produtoId) === entrada.produtoId) {
      let atualizada = await this._associacoesRepository.incrementarConfirmacoes(existente.id, {
        usuarioId: entrada.usuario
      });
      const promovida = await this._promoverMapeamentoAutomatico(existente, atualizada, entrada);
      if (promovida) atualizada = promovida;

      return {
        sucesso: true,
        gravado: false,
        rejeitado: false,
        reutilizacao: true,
        reativada: false,
        promovida: Boolean(promovida),
        associacaoId: atualizada?.id ?? existente.id,
        confirmacoes: atualizada?.confirmacoes ?? (existente.confirmacoes + 1),
        operacaoId: entrada.operacaoId,
        evento: evento.toJSON(),
        motivo: promovida ? 'mapeamento_automatico_confirmado' : 'confirmacao_incrementada'
      };
    }

    if (existente && existente.status !== 'ativa' && Number(existente.produtoId) === entrada.produtoId) {
      await this._associacoesRepository.reativarAssociacao(existente.id, {
        usuarioId: entrada.usuario
      });
      let atualizada = await this._associacoesRepository.incrementarConfirmacoes(existente.id, {
        usuarioId: entrada.usuario
      });
      const promovida = await this._promoverMapeamentoAutomatico(existente, atualizada, entrada);
      if (promovida) atualizada = promovida;

      return {
        sucesso: true,
        gravado: false,
        rejeitado: false,
        reutilizacao: false,
        reativada: true,
        promovida: Boolean(promovida),
        associacaoId: atualizada?.id ?? existente.id,
        confirmacoes: atualizada?.confirmacoes ?? 1,
        operacaoId: entrada.operacaoId,
        evento: evento.toJSON(),
        motivo: 'associacao_reativada'
      };
    }

    const associacao = await this._associacoesRepository.salvarAssociacao({
      produtoId: entrada.produtoId,
      origem: entrada.origem,
      fornecedorCnpj: entrada.fornecedorCnpj,
      fornecedorNome: entrada.fornecedor,
      codigoFornecedor: entrada.codigoFornecedor,
      codigoBarras: entrada.codigoBarras,
      nomeItem: entrada.descricaoFornecedor,
      nomeNormalizado: entrada.nomeNormalizado,
      ncm: entrada.ncm,
      unidade: entrada.unidade,
      score: SCORE_CONFIRMACAO,
      confianca: MiipConfidence.ALTA,
      status: 'ativa',
      fonte: 'aprendizado',
      decisaoOperacaoId: entrada.operacaoId,
      confirmadoPorUsuarioId: entrada.usuario,
      metadados: {
        servico: 'MiipLearningService',
        tipo_confirmacao: TIPO_CONFIRMACAO_MANUAL,
        evento: evento.toJSON()
      }
    });

    return {
      sucesso: true,
      gravado: true,
      rejeitado: false,
      reutilizacao: false,
      reativada: false,
      associacaoId: associacao?.id ?? null,
      confirmacoes: 1,
      operacaoId: entrada.operacaoId,
      evento: evento.toJSON(),
      motivo: 'associacao_criada'
    };
  }

  /**
   * @returns {Object}
   */
  obterMetricas() {
    return this._metrics.obterResumo();
  }
}

module.exports = MiipLearningService;
module.exports.ESTADO_ASSOCIACAO_EXISTENTE_DIFERENTE = ESTADO_ASSOCIACAO_EXISTENTE_DIFERENTE;
module.exports.TIPO_CONFIRMACAO_MANUAL = TIPO_CONFIRMACAO_MANUAL;
