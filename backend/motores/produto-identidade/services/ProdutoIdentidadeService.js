/**
 * ProdutoIdentidadeService — orquestrador resolve() do MIP.
 * Sprint 08: métricas, tempo de execução e logs padronizados.
 * @module motores/produto-identidade/services/ProdutoIdentidadeService
 */

const DetectorTipoCodigo = require('../core/DetectorTipoCodigo');
const StrategyFactory = require('../core/StrategyFactory');
const IdentidadeResultadoDTO = require('../contracts/IdentidadeResultadoDTO');
const ProdutoIdentidadeCatalogo = require('./ProdutoIdentidadeCatalogo');
const {
  isProdutoIdentidadeEnabled,
  setProdutoIdentidadeEnabled,
  FLAG_CHAVE
} = require('../config/produtoIdentidadeFlags');
const mipMetrics = require('../observability/MipMetrics');
const mipLogger = require('../observability/mipLogger');

function _nowHr() {
  return process.hrtime.bigint();
}

function _elapsedMs(start) {
  return Number(_nowHr() - start) / 1e6;
}

function _anexarObservabilidade(resultado, extras = {}) {
  if (!resultado) return resultado;
  const meta = {
    ...(resultado.meta && typeof resultado.meta === 'object' ? resultado.meta : {}),
    tempoMs: extras.tempoMs != null ? Number(Number(extras.tempoMs).toFixed(3)) : null,
    flag: FLAG_CHAVE,
    flagEnabled: extras.flagEnabled !== false,
    origem: extras.origem || null
  };
  if (extras.fallback) meta.fallback = true;
  resultado.meta = meta;
  return resultado;
}

class ProdutoIdentidadeService {
  /**
   * @param {Object} [deps]
   * @param {Object|null} [deps.db]
   * @param {DetectorTipoCodigo} [deps.detector]
   * @param {import('../core/StrategyRegistry')} [deps.registry]
   * @param {ProdutoIdentidadeCatalogo} [deps.catalogo]
   * @param {Function} [deps.isEnabled]
   * @param {Object} [deps.metrics]
   */
  constructor(deps = {}) {
    this._db = deps.db ?? null;
    this._catalogo = deps.catalogo
      ?? new ProdutoIdentidadeCatalogo({ db: this._db });
    this._detector = deps.detector ?? new DetectorTipoCodigo();
    this._registry = deps.registry
      ?? StrategyFactory.criarRegistryPadrao({
        catalogo: this._catalogo,
        db: this._db
      });
    this._isEnabled = deps.isEnabled ?? isProdutoIdentidadeEnabled;
    this._metrics = deps.metrics || mipMetrics;
  }

  get registry() {
    return this._registry;
  }

  get detector() {
    return this._detector;
  }

  get catalogo() {
    return this._catalogo;
  }

  /**
   * @param {string|number|{ codigo: string, contexto?: Object }} entrada
   * @param {Object} [contexto]
   * @returns {Promise<IdentidadeResultadoDTO>}
   */
  async resolve(entrada, contexto = {}) {
    const start = _nowHr();
    let codigo;
    let ctx = { ...contexto };

    if (entrada != null && typeof entrada === 'object' && !Array.isArray(entrada)) {
      codigo = entrada.codigo;
      ctx = { ...contexto, ...(entrada.contexto || {}) };
    } else {
      codigo = entrada;
    }

    const bruto = String(codigo ?? '').trim();
    const origem = ctx.origem || null;

    if (!this._isEnabled()) {
      const dto = IdentidadeResultadoDTO.desabilitado(bruto || null);
      _anexarObservabilidade(dto, {
        tempoMs: _elapsedMs(start),
        flagEnabled: false,
        origem
      });
      this._metrics.registrar({
        habilitado: false,
        tempoMs: dto.meta.tempoMs
      });
      console.log('[MIP DEBUG] INTERRUPÇÃO: ProdutoIdentidadeService desabilitado (flag)', { origem, codigo: bruto });
      mipLogger.debug('resolve desabilitado', { origem, codigo: bruto });
      return dto;
    }

    if (!bruto) {
      const dto = IdentidadeResultadoDTO.naoEncontrado({ codigoOriginal: '' });
      _anexarObservabilidade(dto, {
        tempoMs: _elapsedMs(start),
        flagEnabled: true,
        origem
      });
      this._metrics.registrar({
        habilitado: true,
        encontrado: false,
        metodo: null,
        strategy: null,
        tempoMs: dto.meta.tempoMs
      });
      return dto;
    }

    try {
      const deteccao = this._detector.detectar(bruto, ctx);
      // DEBUG 01 — Detector
      console.log('[MIP DEBUG] Detector identificou candidatos:', deteccao.candidatos || [], {
        bruto: deteccao.bruto,
        digitos: deteccao.digitos
      });

      const strategies = this._registry.filtrarCompativeis(bruto, ctx, deteccao);
      const ordenadas = this._ordenarPorCandidatos(strategies, deteccao.candidatos);

      console.log('[MIP DEBUG] Strategies na ordem de tentativa:', ordenadas.map((s) => s.nome));

      for (const strategy of ordenadas) {
        console.log('[MIP DEBUG] Strategy tentando:', strategy.nome);
        const resultado = await strategy.resolve(bruto, ctx, deteccao);

        if (resultado && resultado.encontrado) {
          const tempoMs = _elapsedMs(start);
          _anexarObservabilidade(resultado, { tempoMs, flagEnabled: true, origem });
          this._metrics.registrar({
            habilitado: true,
            encontrado: true,
            metodo: resultado.metodo,
            strategy: resultado.strategy,
            tempoMs
          });
          // DEBUG 01 — resultado
          console.log('[MIP DEBUG] Strategy escolhida:', strategy.nome);
          console.log('[MIP DEBUG] Produto encontrado?', true, {
            id: resultado.produtoId,
            nome: resultado.produto?.nome || null,
            metodo: resultado.metodo
          });
          mipLogger.debug('resolve ok', {
            origem,
            strategy: resultado.strategy,
            metodo: resultado.metodo,
            produtoId: resultado.produtoId,
            tempoMs
          });
          return resultado;
        }

        console.log('[MIP DEBUG] Strategy sem match:', strategy.nome, {
          retornou: resultado != null,
          encontrado: resultado?.encontrado
        });

        if (
          resultado
          && !resultado.encontrado
          && resultado.strategy === 'ETIQUETA_BALANCA'
          && resultado.meta?.produtoNaoEncontrado
        ) {
          const tempoMs = _elapsedMs(start);
          _anexarObservabilidade(resultado, { tempoMs, flagEnabled: true, origem });
          this._metrics.registrar({
            habilitado: true,
            encontrado: false,
            metodo: resultado.metodo,
            strategy: resultado.strategy,
            tempoMs
          });
          console.log('[MIP DEBUG] INTERRUPÇÃO: etiqueta balança sem produto', resultado.meta);
          return resultado;
        }
      }

      const dto = IdentidadeResultadoDTO.naoEncontrado({
        codigoOriginal: bruto,
        meta: { candidatos: deteccao.candidatos }
      });
      console.log('[MIP DEBUG] Produto encontrado?', false, { codigo: bruto, candidatos: deteccao.candidatos });
      const tempoMs = _elapsedMs(start);
      _anexarObservabilidade(dto, { tempoMs, flagEnabled: true, origem, fallback: false });
      this._metrics.registrar({
        habilitado: true,
        encontrado: false,
        metodo: null,
        strategy: null,
        tempoMs
      });
      mipLogger.debug('resolve nao encontrado', { origem, codigo: bruto, tempoMs });
      return dto;
    } catch (err) {
      this._metrics.registrar({ erro: true });
      mipLogger.error('resolve falhou', { origem, codigo: bruto, erro: err.message });
      throw err;
    }
  }

  /**
   * @private
   */
  _ordenarPorCandidatos(strategies, candidatos = []) {
    if (!candidatos.length) return strategies;
    const porNome = new Map(strategies.map((s) => [s.nome, s]));
    const ordenadas = [];
    const usados = new Set();

    for (const c of candidatos) {
      const nomeStrategy = c === 'ETIQUETA_BALANCA' ? 'ETIQUETA_BALANCA' : c;
      const s = porNome.get(nomeStrategy);
      if (s && !usados.has(s.nome)) {
        ordenadas.push(s);
        usados.add(s.nome);
      }
    }
    for (const s of strategies) {
      if (!usados.has(s.nome)) ordenadas.push(s);
    }
    return ordenadas;
  }
}

module.exports = ProdutoIdentidadeService;
module.exports.ProdutoIdentidadeService = ProdutoIdentidadeService;
module.exports.setProdutoIdentidadeEnabled = setProdutoIdentidadeEnabled;
module.exports.isProdutoIdentidadeEnabled = isProdutoIdentidadeEnabled;
