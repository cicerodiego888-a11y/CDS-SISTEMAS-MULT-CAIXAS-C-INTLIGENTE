/**
 * ToledoPrix4Validator — Validação de payloads antes do envio ao protocolo Toledo.
 *
 * @class ToledoPrix4Validator
 */

const ProdutoDTO = require('../../../contracts/ProdutoDTO');
const PromocaoDTO = require('../../../contracts/PromocaoDTO');
const DepartamentoDTO = require('../../../contracts/DepartamentoDTO');
const EtiquetaDTO = require('../../../contracts/EtiquetaDTO');
const ProdutoValidator = require('../../../contracts/ProdutoValidator');
const PromocaoValidator = require('../../../contracts/PromocaoValidator');
const DepartamentoValidator = require('../../../contracts/DepartamentoValidator');
const EtiquetaValidator = require('../../../contracts/EtiquetaValidator');
const PesoDTO = require('../../../contracts/PesoDTO');
const { LIMITES } = require('./ToledoPrix4Constants');

class ToledoPrix4Validator {
  /**
   * @param {*} entrada
   * @param {Function} ClasseDTO
   * @returns {Object}
   */
  _paraDTO(entrada, ClasseDTO) {
    if (entrada instanceof ClasseDTO) return entrada;
    return new ClasseDTO(entrada || {});
  }

  /**
   * @param {ProdutoDTO|Object} produto
   * @returns {{ valido: boolean, erros: string[] }}
   */
  validarProduto(produto) {
    const dto = this._paraDTO(produto, ProdutoDTO);
    const base = ProdutoValidator.validar(dto);
    const erros = [...(base.erros || [])];

    const pluNum = Number(dto.plu);
    if (Number.isFinite(pluNum) && (pluNum < 1 || pluNum > LIMITES.pluMax)) {
      erros.push(`PLU deve estar entre 1 e ${LIMITES.pluMax}`);
    }

    if (dto.departamento != null) {
      const dep = Number(dto.departamento);
      if (Number.isFinite(dep) && (dep < 1 || dep > LIMITES.departamentoMax)) {
        erros.push(`Departamento deve estar entre 1 e ${LIMITES.departamentoMax}`);
      }
    }

    return { valido: erros.length === 0, erros };
  }

  validarPromocao(promocao) {
    const dto = this._paraDTO(promocao, PromocaoDTO);
    return PromocaoValidator.validar(dto);
  }

  validarDepartamento(departamento) {
    const dto = this._paraDTO(departamento, DepartamentoDTO);
    const base = DepartamentoValidator.validar(dto);
    const erros = [...(base.erros || [])];

    const cod = Number(dto.codigo);
    if (Number.isFinite(cod) && (cod < 1 || cod > LIMITES.departamentoMax)) {
      erros.push(`Código de departamento deve estar entre 1 e ${LIMITES.departamentoMax}`);
    }

    return { valido: erros.length === 0, erros };
  }

  validarEtiqueta(etiqueta) {
    const dto = this._paraDTO(etiqueta, EtiquetaDTO);
    return EtiquetaValidator.validar(dto);
  }

  validarPeso(peso) {
    if (!peso || typeof peso !== 'object') {
      return { valido: false, erros: ['Objeto de peso ausente'] };
    }
    return new PesoDTO(peso).validar();
  }

  /**
   * @param {Object} config
   * @returns {{ valido: boolean, erros: string[] }}
   */
  validarConfiguracao(config) {
    const erros = [];
    if (!config) {
      erros.push('Configuração ausente');
      return { valido: false, erros };
    }

    if (config.host && typeof config.host !== 'string') {
      erros.push('Host Ethernet inválido');
    }

    if (config.porta != null) {
      const porta = Number(config.porta);
      if (!Number.isFinite(porta) || porta < 1 || porta > 65535) {
        erros.push('Porta Ethernet inválida');
      }
    }

    return { valido: erros.length === 0, erros };
  }
}

module.exports = ToledoPrix4Validator;
