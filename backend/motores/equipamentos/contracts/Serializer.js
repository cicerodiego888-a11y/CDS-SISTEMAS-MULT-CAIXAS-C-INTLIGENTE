/**
 * Serializer — Transforma DTOs em formatos específicos para drivers/equipamentos.
 *
 * Nesta sprint: apenas serialização genérica (JSON).
 * Formatos por fabricante serão implementados em sprints futuras.
 *
 * @class Serializer
 */

const ProdutoDTO = require('./ProdutoDTO');
const PromocaoDTO = require('./PromocaoDTO');
const DepartamentoDTO = require('./DepartamentoDTO');
const EtiquetaDTO = require('./EtiquetaDTO');
const PesoDTO = require('./PesoDTO');
const StatusDTO = require('./StatusDTO');
const DiagnosticoDTO = require('./DiagnosticoDTO');
const EquipamentoDTO = require('./EquipamentoDTO');

const TIPOS = {
  PRODUTO: 'produto',
  PROMOCAO: 'promocao',
  DEPARTAMENTO: 'departamento',
  ETIQUETA: 'etiqueta',
  PESO: 'peso',
  STATUS: 'status',
  DIAGNOSTICO: 'diagnostico',
  EQUIPAMENTO: 'equipamento'
};

class Serializer {
  /**
   * @param {*} dto
   * @returns {Object}
   * @private
   */
  static _paraPlain(dto) {
    if (!dto) return null;
    if (typeof dto.toJSON === 'function') return dto.toJSON();
    return { ...dto };
  }

  /**
   * Serialização genérica (contrato interno JSON).
   * @param {*} dto
   * @returns {Object}
   */
  static serialize(dto) {
    return {
      tipo: Serializer.identificarTipo(dto),
      dados: Serializer._paraPlain(dto),
      formato: 'json',
      implementado: true,
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Serialização para fabricante específico (stub).
   * @param {*} dto
   * @param {string} fabricante
   * @returns {Object}
   */
  static serializeForFabricante(dto, fabricante) {
    return {
      tipo: Serializer.identificarTipo(dto),
      fabricante: String(fabricante || '').toLowerCase(),
      dados: Serializer._paraPlain(dto),
      formato: 'fabricante',
      implementado: false,
      mensagem: 'Serialização por fabricante não implementada nesta sprint',
      timestamp: new Date().toISOString()
    };
  }

  /**
   * @param {*} dto
   * @returns {string|null}
   */
  static identificarTipo(dto) {
    if (dto instanceof ProdutoDTO) return TIPOS.PRODUTO;
    if (dto instanceof PromocaoDTO) return TIPOS.PROMOCAO;
    if (dto instanceof DepartamentoDTO) return TIPOS.DEPARTAMENTO;
    if (dto instanceof EtiquetaDTO) return TIPOS.ETIQUETA;
    if (dto instanceof PesoDTO) return TIPOS.PESO;
    if (dto instanceof StatusDTO) return TIPOS.STATUS;
    if (dto instanceof DiagnosticoDTO) return TIPOS.DIAGNOSTICO;
    if (dto instanceof EquipamentoDTO) return TIPOS.EQUIPAMENTO;
    return null;
  }

  /**
   * Reidrata DTO a partir de payload da fila.
   * @param {string} tipo
   * @param {Object} plain
   * @returns {*}
   */
  static rehydratar(tipo, plain) {
    const mapa = {
      [TIPOS.PRODUTO]: ProdutoDTO,
      [TIPOS.PROMOCAO]: PromocaoDTO,
      [TIPOS.DEPARTAMENTO]: DepartamentoDTO,
      [TIPOS.ETIQUETA]: EtiquetaDTO,
      [TIPOS.PESO]: PesoDTO,
      [TIPOS.STATUS]: StatusDTO,
      [TIPOS.DIAGNOSTICO]: DiagnosticoDTO,
      [TIPOS.EQUIPAMENTO]: EquipamentoDTO
    };
    const Classe = mapa[tipo];
    if (!Classe) return plain;
    return Classe.fromJSON(plain);
  }
}

Serializer.TIPOS = TIPOS;

module.exports = Serializer;
