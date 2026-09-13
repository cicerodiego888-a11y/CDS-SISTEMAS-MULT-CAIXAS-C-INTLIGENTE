/**
 * EtiquetaBalancaStrategy — interpreta EAN-13 prefixo 2 via layout cadastrado
 * no Motor de Equipamentos (Sprint EQUIPAMENTOS 02).
 */

const IdentidadeStrategyBase = require('./IdentidadeStrategyBase');
const IdentidadeResultadoDTO = require('../contracts/IdentidadeResultadoDTO');
const { resolverLayoutConfig } = require('../config/etiquetaBalancaConfig');
const { parseEtiquetaComLayout } = require('../../equipamentos/layouts/ConfiguravelEtiquetaParser');
const { TIPOS_IDENTIFICADOR } = require('../constants/tiposIdentificador');
const { normalizarCodigoIdentificador } = require('../normalizers/normalizarCodigoIdentificador');
const { variantesPlu, pluInformado } = require('../utils/normalizarPlu');

function ehEtiquetaBalanca(codigo) {
  return /^2\d{12}$/.test(String(codigo || '').replace(/\D/g, ''));
}

class EtiquetaBalancaStrategy extends IdentidadeStrategyBase {
  /**
   * @param {Object} [deps]
   * @param {Object} [deps.catalogo]
   * @param {Object} [deps.db]
   * @param {Function} [deps.resolverLayoutConfig]
   * @param {Object} [deps.layoutService]
   */
  constructor(deps = {}) {
    super();
    this._catalogo = deps.catalogo;
    this._db = deps.db || null;
    this._resolverLayoutConfig = deps.resolverLayoutConfig || resolverLayoutConfig;
    this._layoutService = deps.layoutService || null;
    // LayoutRegistry legado — mantido só se injetado (testes antigos)
    this._layouts = deps.layoutRegistry || null;
  }

  get nome() {
    return 'ETIQUETA_BALANCA';
  }

  get metodo() {
    return 'ETIQUETA_BALANCA';
  }

  canHandle(codigo, contexto, deteccao) {
    const digitos = deteccao?.digitos || String(codigo || '').replace(/\D/g, '');
    if (ehEtiquetaBalanca(digitos)) return true;
    const candidatos = deteccao?.candidatos || [];
    return candidatos.includes('ETIQUETA_BALANCA');
  }

  /**
   * Localiza produto por PLU (inclui 0 / 00 / 0000 e paddings da etiqueta).
   * @private
   * @param {string|number} plu
   * @param {string} [pluRaw] campo bruto da etiqueta (com zeros)
   */
  async _localizarPorPlu(plu, pluRaw) {
    if (!this._catalogo) return null;
    if (!pluInformado(plu) && !pluInformado(pluRaw)) return null;

    const seeds = [];
    if (pluInformado(pluRaw)) seeds.push(String(pluRaw).replace(/\D/g, ''));
    if (pluInformado(plu)) seeds.push(normalizarCodigoIdentificador(plu, TIPOS_IDENTIFICADOR.PLU));

    const tentados = new Set();
    for (const seed of seeds) {
      if (!seed || tentados.has(seed)) continue;
      tentados.add(seed);

      const viaPlu = await this._catalogo.resolverPorIdentificador(
        TIPOS_IDENTIFICADOR.PLU,
        seed
      );
      if (viaPlu?.produto) return viaPlu.produto;

      for (const cand of variantesPlu(seed)) {
        if (tentados.has(`i:${cand}`)) continue;
        tentados.add(`i:${cand}`);

        const viaInterno = await this._catalogo.resolverPorIdentificador(
          TIPOS_IDENTIFICADOR.INTERNO,
          cand
        );
        if (viaInterno?.produto) return viaInterno.produto;

        const legado = await this._catalogo.buscarProdutoPorCodigoInterno(cand);
        if (legado) return legado;
      }
    }

    return null;
  }

  async resolve(codigo, contexto = {}, deteccao = {}) {
    const limpo = (deteccao.digitos || String(codigo || '').replace(/\D/g, ''));
    if (!ehEtiquetaBalanca(limpo)) return null;

    const layoutConfig = await this._resolverLayoutConfig(contexto, {
      db: this._db,
      layoutService: this._layoutService
    });

    let parsed = parseEtiquetaComLayout(limpo, layoutConfig);

    // Compat: se injetaram LayoutRegistry legado e config falhou
    if (!parsed && this._layouts) {
      const layoutId = layoutConfig?._metaLayoutId || layoutConfig?.preset_id || contexto.layoutStrategy;
      const layout = this._layouts.obterOuDefault(layoutId);
      if (layout) parsed = layout.parse(limpo);
    }

    if (!parsed) return null;

    const layoutIdMeta = layoutConfig?._metaLayoutId
      || contexto.layoutStrategy
      || parsed.layoutId;

    const produto = await this._localizarPorPlu(parsed.plu, parsed.pluRaw);
    if (!produto) {
      return IdentidadeResultadoDTO.naoEncontrado({
        codigoOriginal: limpo,
        strategy: this.nome,
        metodo: this.metodo,
        meta: {
          plu: parsed.plu,
          pluRaw: parsed.pluRaw,
          valorTotal: parsed.valorTotal,
          peso: parsed.peso,
          tipoPayload: parsed.tipoPayload,
          layoutId: layoutIdMeta,
          produtoNaoEncontrado: true
        }
      });
    }

    let pesoCalculado = parsed.peso;
    if (
      parsed.tipoPayload === 'VALOR'
      && parsed.valorTotal != null
      && Number(produto.preco_venda) > 0
    ) {
      pesoCalculado = Number(parsed.valorTotal) / Number(produto.preco_venda);
    }

    return IdentidadeResultadoDTO.encontrado({
      produtoId: produto.id,
      produto,
      metodo: this.metodo,
      strategy: this.nome,
      codigoOriginal: limpo,
      confianca: 'ALTA',
      meta: {
        plu: parsed.plu,
        pluRaw: parsed.pluRaw,
        valorTotal: parsed.valorTotal,
        peso: pesoCalculado,
        pesoEtiqueta: parsed.peso,
        tipoPayload: parsed.tipoPayload,
        layoutId: layoutIdMeta
      }
    });
  }
}

module.exports = EtiquetaBalancaStrategy;
module.exports.ehEtiquetaBalanca = ehEtiquetaBalanca;
