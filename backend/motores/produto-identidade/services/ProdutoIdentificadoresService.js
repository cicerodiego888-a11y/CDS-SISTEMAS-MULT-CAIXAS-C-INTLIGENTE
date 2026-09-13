/**
 * ProdutoIdentificadoresService — regras de espelho codigo/barras (MIP Sprint 01).
 * @module motores/produto-identidade/services/ProdutoIdentificadoresService
 */

const ProdutoIdentificadoresRepository = require('../repositories/ProdutoIdentificadoresRepository');
const { TIPOS_IDENTIFICADOR, isTipoValido } = require('../constants/tiposIdentificador');
const {
  normalizarCodigoIdentificador,
  detectarTipoCodigoBarras
} = require('../normalizers/normalizarCodigoIdentificador');

class ProdutoIdentificadoresService {
  /**
   * @param {Object} [deps]
   * @param {ProdutoIdentificadoresRepository} [deps.repository]
   * @param {Object|null} [deps.db]
   */
  constructor(deps = {}) {
    this._repo = deps.repository
      ?? new ProdutoIdentificadoresRepository({ db: deps.db ?? null });
  }

  get repository() {
    return this._repo;
  }

  /**
   * Upsert do identificador principal de um tipo para o produto.
   * Se codigo vazio → desativa o principal atual.
   *
   * @param {number} produtoId
   * @param {string} tipo
   * @param {string|null} codigoBruto
   * @param {Object} [opcoes]
   * @returns {Promise<{ acao: string, registro: Object|null, conflito?: Object }>}
   */
  async upsertPrincipal(produtoId, tipo, codigoBruto, opcoes = {}) {
    const tipoNorm = String(tipo || '').toUpperCase();
    if (!isTipoValido(tipoNorm)) {
      throw new Error(`Tipo de identificador inválido: ${tipo}`);
    }

    const codigo = normalizarCodigoIdentificador(codigoBruto, tipoNorm);
    const origem = opcoes.origem || 'cadastro';
    const codigoExibicao = codigoBruto != null && String(codigoBruto).trim()
      ? String(codigoBruto).trim()
      : null;

    const atual = await this._repo.buscarPrincipal(produtoId, tipoNorm);

    if (!codigo) {
      if (atual) {
        const desativado = await this._repo.desativar(atual.id);
        return { acao: 'desativado', registro: desativado };
      }
      return { acao: 'noop', registro: null };
    }

    const existenteGlobal = await this._repo.buscarPorTipoCodigo(tipoNorm, codigo, {
      escopo: null,
      escopoValor: null,
      apenasAtivos: true
    });

    if (existenteGlobal && Number(existenteGlobal.produtoId) !== Number(produtoId)) {
      return {
        acao: 'conflito',
        registro: atual || null,
        conflito: existenteGlobal
      };
    }

    if (atual) {
      if (atual.codigo === codigo) {
        return { acao: 'inalterado', registro: atual };
      }
      const atualizado = await this._repo.atualizar(atual.id, {
        codigo,
        codigoExibicao,
        origem,
        principal: true,
        ativo: true
      });
      return { acao: 'atualizado', registro: atualizado };
    }

    if (existenteGlobal && Number(existenteGlobal.produtoId) === Number(produtoId)) {
      const atualizado = await this._repo.atualizar(existenteGlobal.id, {
        principal: true,
        ativo: true,
        codigoExibicao,
        origem
      });
      return { acao: 'promovido', registro: atualizado };
    }

    const criado = await this._repo.inserir({
      produtoId,
      tipo: tipoNorm,
      codigo,
      codigoExibicao,
      escopo: null,
      escopoValor: null,
      ativo: true,
      principal: true,
      origem,
      metadados: opcoes.metadados || null
    });
    return { acao: 'criado', registro: criado };
  }

  /**
   * Dual-write: espelha codigo interno + codigo de barras + PLU do cadastro.
   * Campos omitidos (undefined) não alteram o identificador correspondente.
   * PLU vazio ('' / null) desativa o PLU principal.
   *
   * @param {number} produtoId
   * @param {{
   *   codigo?: string|null,
   *   codigo_barras?: string|null,
   *   codigoBarras?: string|null,
   *   plu?: string|null,
   *   codigo_mgv6?: string|null,
   *   codigoMgv6?: string|null
   * }} campos
   * @param {{ origem?: string }} [opcoes]
   * @returns {Promise<{ interno: Object, barras: Object|null, plu: Object|null, mgv6: Object|null }>}
   */
  async espelharCodigoEBarras(produtoId, campos = {}, opcoes = {}) {
    const origem = opcoes.origem || 'dual_write';
    const codigo = campos.codigo;
    const barras = campos.codigo_barras !== undefined
      ? campos.codigo_barras
      : campos.codigoBarras;

    const interno = await this.upsertPrincipal(
      produtoId,
      TIPOS_IDENTIFICADOR.INTERNO,
      codigo,
      { origem }
    );

    let barrasResult = { acao: 'noop', registro: null };
    if (barras !== undefined) {
      const tipoBarras = detectarTipoCodigoBarras(barras) || TIPOS_IDENTIFICADOR.EAN13;
      // Desativa principais de outros tipos de barras se mudou o tipo
      if (barras && String(barras).trim()) {
        for (const t of [TIPOS_IDENTIFICADOR.EAN8, TIPOS_IDENTIFICADOR.EAN13, TIPOS_IDENTIFICADOR.GTIN]) {
          if (t === tipoBarras) continue;
          const outro = await this._repo.buscarPrincipal(produtoId, t);
          if (outro) await this._repo.desativar(outro.id);
        }
      } else {
        for (const t of [TIPOS_IDENTIFICADOR.EAN8, TIPOS_IDENTIFICADOR.EAN13, TIPOS_IDENTIFICADOR.GTIN]) {
          const outro = await this._repo.buscarPrincipal(produtoId, t);
          if (outro) await this._repo.desativar(outro.id);
        }
      }

      barrasResult = await this.upsertPrincipal(produtoId, tipoBarras, barras, { origem });
    }

    let pluResult = { acao: 'noop', registro: null };
    if (campos.plu !== undefined) {
      pluResult = await this.upsertPrincipal(
        produtoId,
        TIPOS_IDENTIFICADOR.PLU,
        campos.plu,
        { origem }
      );
    }

    let mgv6Result = { acao: 'noop', registro: null };
    const codigoMgv6 = campos.codigo_mgv6 !== undefined
      ? campos.codigo_mgv6
      : campos.codigoMgv6;
    if (codigoMgv6 !== undefined) {
      mgv6Result = await this.upsertPrincipal(
        produtoId,
        TIPOS_IDENTIFICADOR.MGV6,
        codigoMgv6,
        { origem }
      );
    }

    return { interno, barras: barrasResult, plu: pluResult, mgv6: mgv6Result };
  }

  /**
   * Lê Código MGV6 principal do produto (ou null).
   * @param {number} produtoId
   * @returns {Promise<string|null>}
   */
  async obterCodigoMgv6Principal(produtoId) {
    const reg = await this._repo.buscarPrincipal(produtoId, TIPOS_IDENTIFICADOR.MGV6);
    if (!reg || !reg.ativo) return null;
    return reg.codigo != null ? String(reg.codigo) : null;
  }

  /**
   * Lê PLU principal do produto (ou null).
   * @param {number} produtoId
   * @returns {Promise<string|null>}
   */
  async obterPluPrincipal(produtoId) {
    const reg = await this._repo.buscarPrincipal(produtoId, TIPOS_IDENTIFICADOR.PLU);
    if (!reg || !reg.ativo) return null;
    return reg.codigo != null ? String(reg.codigo) : null;
  }

  listarPorProduto(produtoId, opcoes) {
    return this._repo.listarPorProduto(produtoId, opcoes);
  }
}

module.exports = ProdutoIdentificadoresService;
module.exports.ProdutoIdentificadoresService = ProdutoIdentificadoresService;
