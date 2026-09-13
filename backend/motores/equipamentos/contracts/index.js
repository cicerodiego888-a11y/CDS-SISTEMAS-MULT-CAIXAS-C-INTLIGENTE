/**
 * Contratos oficiais do Motor Equipamentos — barrel export.
 *
 * @module motores/equipamentos/contracts
 */

module.exports = {
  // DTOs
  ProdutoDTO: require('./ProdutoDTO'),
  PromocaoDTO: require('./PromocaoDTO'),
  DepartamentoDTO: require('./DepartamentoDTO'),
  EtiquetaDTO: require('./EtiquetaDTO'),
  PesoDTO: require('./PesoDTO'),
  StatusDTO: require('./StatusDTO'),
  DiagnosticoDTO: require('./DiagnosticoDTO'),
  EquipamentoDTO: require('./EquipamentoDTO'),

  // Validadores
  ProdutoValidator: require('./ProdutoValidator'),
  PromocaoValidator: require('./PromocaoValidator'),
  DepartamentoValidator: require('./DepartamentoValidator'),
  EtiquetaValidator: require('./EtiquetaValidator'),

  // Normalizadores
  ProdutoNormalizer: require('./ProdutoNormalizer'),
  DepartamentoNormalizer: require('./DepartamentoNormalizer'),
  EtiquetaNormalizer: require('./EtiquetaNormalizer'),

  // Infraestrutura de contrato
  Serializer: require('./Serializer'),
  ResponseFactory: require('./ResponseFactory'),
  validationResult: require('./validationResult')
};
