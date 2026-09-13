/**
 * Motor de Identificação de Produtos — MIP V1.0.0 (Sprints 01–09).
 * @module motores/produto-identidade
 */

const { TIPOS_IDENTIFICADOR, TIPOS_LISTA, ESCOPOS, isTipoValido } = require('./constants/tiposIdentificador');
const { normalizarCodigoIdentificador, detectarTipoCodigoBarras } = require('./normalizers/normalizarCodigoIdentificador');
const { garantirSchemaProdutoIdentificadores } = require('./schema/produtoIdentificadoresSchema');
const ProdutoIdentificadoresRepository = require('./repositories/ProdutoIdentificadoresRepository');
const ProdutoIdentificadoresService = require('./services/ProdutoIdentificadoresService');
const ProdutoIdentificadoresBackfill = require('./services/ProdutoIdentificadoresBackfill');
const ProdutoIdentidadeService = require('./services/ProdutoIdentidadeService');
const ProdutoIdentidadeCatalogo = require('./services/ProdutoIdentidadeCatalogo');
const PdvProdutoIdentificacaoService = require('./services/PdvProdutoIdentificacaoService');
const EntradasProdutoIdentificacaoService = require('./services/EntradasProdutoIdentificacaoService');
const IdentidadeResultadoDTO = require('./contracts/IdentidadeResultadoDTO');
const DetectorTipoCodigo = require('./core/DetectorTipoCodigo');
const StrategyRegistry = require('./core/StrategyRegistry');
const StrategyFactory = require('./core/StrategyFactory');
const IdentidadeStrategyBase = require('./strategies/IdentidadeStrategyBase');
const InternoStrategy = require('./strategies/InternoStrategy');
const IdStrategy = require('./strategies/IdStrategy');
const Ean13Strategy = require('./strategies/Ean13Strategy');
const GtinStrategy = require('./strategies/GtinStrategy');
const EtiquetaBalancaStrategy = require('./strategies/EtiquetaBalancaStrategy');
const PluStrategy = require('./strategies/PluStrategy');
const LayoutRegistry = require('./layouts/LayoutRegistry');
const LegadoCdsValor56Layout = require('./layouts/LegadoCdsValor56Layout');
const ToledoPrix4Valor55Layout = require('./layouts/ToledoPrix4Valor55Layout');
const ToledoPrix4PesoLayout = require('./layouts/ToledoPrix4PesoLayout');
const { LAYOUT_IDS, LAYOUT_DEFAULT, CONFIG_CHAVE_STRATEGY } = require('./layouts/layoutIds');
const { resolverLayoutId, resolverLayoutConfig } = require('./config/etiquetaBalancaConfig');
const { parseEtiquetaComLayout } = require('../equipamentos/layouts/ConfiguravelEtiquetaParser');
const { normalizarLayoutEtiqueta } = require('../equipamentos/layouts/LayoutEtiquetaNormalizer');
const { listarPresets: listarPresetsEtiqueta, obterPreset } = require('../equipamentos/layouts/presetsEtiqueta');
const layoutEtiquetaService = require('../equipamentos/services/LayoutEtiquetaService');
const {
  FLAG_CHAVE,
  isProdutoIdentidadeEnabled,
  setProdutoIdentidadeEnabled,
  hidratarFlagDoBanco
} = require('./config/produtoIdentidadeFlags');
const { validarPluOpcional, resolverFlagProdutoPesavel } = require('./validators/validarPlu');
const { extrairCandidatosCodigo } = require('./services/EntradasProdutoIdentificacaoService');
const { interpretarResultadoPdv, calcularPesoEtiquetaPdv } = require('./adapters/interpretarResultadoPdv');
const { normalizarPlu } = require('./utils/normalizarPlu');
const mipLogger = require('./observability/mipLogger');
const mipMetrics = require('./observability/MipMetrics');
const MipLookupCache = require('./observability/MipLookupCache');
const { MIP_VERSION, MIP_STATUS, MIP_RELEASE_DATE } = require('./version');

/**
 * Dual-write seguro. Aguarda callback após persistir (ou falhar sem quebrar o HTTP).
 * Sempre usa o banco oficial quando deps.db não é informado.
 */
function espelharIdentificadoresSafe(produtoId, campos, deps = {}, callback) {
  const cb = typeof callback === 'function' ? callback : null;
  const db = deps.db != null ? deps.db : require('../../database');
  const service = deps.service
    ?? new ProdutoIdentificadoresService({ db });

  Promise.resolve()
    .then(() => service.espelharCodigoEBarras(produtoId, campos, { origem: deps.origem || 'dual_write' }))
    .then((resultado) => {
      if (
        resultado?.interno?.acao === 'conflito'
        || resultado?.barras?.acao === 'conflito'
        || resultado?.plu?.acao === 'conflito'
        || resultado?.mgv6?.acao === 'conflito'
      ) {
        mipLogger.warn('dual-write conflito', { produtoId, resultado });
      } else {
        mipLogger.debug('dual-write ok', {
          produtoId,
          interno: resultado?.interno?.acao,
          barras: resultado?.barras?.acao,
          plu: resultado?.plu?.acao,
          mgv6: resultado?.mgv6?.acao
        });
      }
      if (cb) cb(null, resultado);
      return resultado;
    })
    .catch((err) => {
      mipLogger.error('dual-write falhou', { produtoId, erro: err.message });
      if (cb) cb(err);
    });
}

module.exports = {
  MIP_VERSION,
  MIP_STATUS,
  MIP_RELEASE_DATE,
  // Sprint 01
  TIPOS_IDENTIFICADOR,
  TIPOS_LISTA,
  ESCOPOS,
  isTipoValido,
  normalizarCodigoIdentificador,
  detectarTipoCodigoBarras,
  garantirSchemaProdutoIdentificadores,
  ProdutoIdentificadoresRepository,
  ProdutoIdentificadoresService,
  ProdutoIdentificadoresBackfill,
  espelharIdentificadoresSafe,
  // Sprint 02 — núcleo
  FLAG_CHAVE,
  isProdutoIdentidadeEnabled,
  setProdutoIdentidadeEnabled,
  hidratarFlagDoBanco,
  ProdutoIdentidadeService,
  ProdutoIdentidadeCatalogo,
  PdvProdutoIdentificacaoService,
  EntradasProdutoIdentificacaoService,
  IdentidadeResultadoDTO,
  DetectorTipoCodigo,
  StrategyRegistry,
  StrategyFactory,
  IdentidadeStrategyBase,
  InternoStrategy,
  IdStrategy,
  Ean13Strategy,
  GtinStrategy,
  // Sprint 04 / 06 — etiquetas + PLU
  PluStrategy,
  EtiquetaBalancaStrategy,
  LayoutRegistry,
  LegadoCdsValor56Layout,
  ToledoPrix4Valor55Layout,
  ToledoPrix4PesoLayout,
  LAYOUT_IDS,
  LAYOUT_DEFAULT,
  CONFIG_CHAVE_STRATEGY,
  resolverLayoutId,
  resolverLayoutConfig,
  parseEtiquetaComLayout,
  normalizarLayoutEtiqueta,
  listarPresetsEtiqueta,
  obterPreset,
  layoutEtiquetaService,
  validarPluOpcional,
  resolverFlagProdutoPesavel,
  extrairCandidatosCodigo,
  interpretarResultadoPdv,
  calcularPesoEtiquetaPdv,
  normalizarPlu,
  variantesPlu: require('./utils/normalizarPlu').variantesPlu,
  pluInformado: require('./utils/normalizarPlu').pluInformado,
  // Sprint 08 — observabilidade
  mipLogger,
  mipMetrics,
  MipLookupCache
};
