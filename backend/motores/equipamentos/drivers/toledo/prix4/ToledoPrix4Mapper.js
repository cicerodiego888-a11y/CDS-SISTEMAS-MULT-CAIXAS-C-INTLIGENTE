/**
 * ToledoPrix4Mapper — Conversão DTO interno → formato Toledo Prix 4.
 *
 * Não realiza comunicação. Apenas prepara payloads para o protocolo.
 *
 * @class ToledoPrix4Mapper
 */

const ProdutoDTO = require('../../../contracts/ProdutoDTO');
const PromocaoDTO = require('../../../contracts/PromocaoDTO');
const DepartamentoDTO = require('../../../contracts/DepartamentoDTO');
const EtiquetaDTO = require('../../../contracts/EtiquetaDTO');
const ProdutoNormalizer = require('../../../contracts/ProdutoNormalizer');
const DepartamentoNormalizer = require('../../../contracts/DepartamentoNormalizer');
const EtiquetaNormalizer = require('../../../contracts/EtiquetaNormalizer');
const { LIMITES } = require('./ToledoPrix4Constants');
const { ToledoPrix4MapperError } = require('./ToledoPrix4Errors');

class ToledoPrix4Mapper {
  /**
   * Normaliza entrada para instância de DTO ou objeto plano.
   * @param {*} entrada
   * @param {Function} ClasseDTO
   * @returns {Object}
   */
  _normalizar(entrada, ClasseDTO) {
    if (entrada instanceof ClasseDTO) return entrada;
    if (entrada && typeof entrada === 'object') return new ClasseDTO(entrada);
    throw new ToledoPrix4MapperError(`Entrada inválida para ${ClasseDTO.name}`);
  }

  /**
   * Trunca descrição reduzida ao limite Toledo.
   * @param {string} texto
   * @returns {string}
   */
  _truncarDescricao(texto) {
    const t = String(texto || '').trim();
    return t.length > LIMITES.descricaoReduzidaMax
      ? t.slice(0, LIMITES.descricaoReduzidaMax)
      : t;
  }

  /**
   * Converte preço para centavos (formato comum em balanças).
   * @param {number} preco
   * @returns {number}
   */
  _precoEmCentavos(preco) {
    return Math.round(Number(preco) * 100);
  }

  /**
   * ProdutoDTO → formato Toledo.
   * @param {ProdutoDTO|Object} produto
   * @returns {Object}
   */
  mapProduto(produto) {
    const dto = ProdutoNormalizer.normalizar(this._normalizar(produto, ProdutoDTO));
    const val = dto.validar();
    if (!val.valido) {
      throw new ToledoPrix4MapperError('Produto inválido para mapeamento Toledo', { erros: val.erros });
    }

    return {
      plu: String(dto.plu),
      codigoBarras: dto.codigoBarras || null,
      descricao: dto.descricao,
      descricaoReduzida: this._truncarDescricao(dto.descricaoReduzida || dto.descricao),
      preco: this._precoEmCentavos(dto.preco),
      precoOriginal: dto.preco,
      unidade: dto.unidade,
      pesavel: dto.pesavel,
      validadeDias: dto.validadeDias,
      departamento: dto.departamento != null ? String(dto.departamento) : null,
      tara: dto.tara,
      extras: { ...dto.extras }
    };
  }

  /**
   * PromocaoDTO → formato Toledo.
   * @param {PromocaoDTO|Object} promocao
   * @returns {Object}
   */
  mapPromocao(promocao) {
    const dto = this._normalizar(promocao, PromocaoDTO);
    const val = dto.validar();
    if (!val.valido) {
      throw new ToledoPrix4MapperError('Promoção inválida para mapeamento Toledo', { erros: val.erros });
    }

    return {
      plu: String(dto.plu),
      precoPromocional: this._precoEmCentavos(dto.precoPromocional),
      precoPromocionalOriginal: dto.precoPromocional,
      precoOriginal: dto.precoOriginal != null ? this._precoEmCentavos(dto.precoOriginal) : null,
      dataInicio: dto.dataInicio,
      dataFim: dto.dataFim,
      ativa: dto.ativa,
      extras: { ...dto.extras }
    };
  }

  /**
   * DepartamentoDTO → formato Toledo.
   * @param {DepartamentoDTO|Object} departamento
   * @returns {Object}
   */
  mapDepartamento(departamento) {
    const dto = DepartamentoNormalizer.normalizar(this._normalizar(departamento, DepartamentoDTO));
    const val = dto.validar();
    if (!val.valido) {
      throw new ToledoPrix4MapperError('Departamento inválido para mapeamento Toledo', { erros: val.erros });
    }

    return {
      codigo: String(dto.codigo),
      nome: dto.nome,
      origemId: dto.origemId,
      origemTipo: dto.origemTipo,
      extras: { ...dto.extras }
    };
  }

  /**
   * EtiquetaDTO → formato Toledo.
   * @param {EtiquetaDTO|Object} etiqueta
   * @returns {Object}
   */
  mapEtiqueta(etiqueta) {
    const dto = EtiquetaNormalizer.normalizar(this._normalizar(etiqueta, EtiquetaDTO));
    const val = dto.validar();
    if (!val.valido) {
      throw new ToledoPrix4MapperError('Etiqueta inválida para mapeamento Toledo', { erros: val.erros });
    }

    return {
      layout: dto.layout,
      plu: dto.plu != null ? String(dto.plu) : null,
      descricao: dto.descricao,
      preco: dto.preco != null ? this._precoEmCentavos(dto.preco) : null,
      validade: dto.validade,
      formatoCodigoBarras: dto.formatoCodigoBarras,
      extras: { ...dto.extras }
    };
  }
}

module.exports = ToledoPrix4Mapper;
