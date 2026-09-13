/**
 * Índice do módulo Vendas para Entrega
 */

module.exports = {
  ...require('./enums'),
  ...require('./EntregaAuditoria'),
  ...require('./ComprovantePrestacao'),
  ...require('./EntregaRepository'),
  ...require('./EntregaValidator'),
  ...require('./EntregaService'),
  ...require('./CriarVendaEntregaService'),
  ...require('./MotorFinalizacaoVenda'),
  ...require('./EntregaAlertasService')
};
