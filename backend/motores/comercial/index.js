/**
 * Motor Comercial — fachada pública.
 * @module motores/comercial
 */
'use strict';

const MotorComercialService = require('./MotorComercialService');
const ReservaReconciliationService = require('./ReservaReconciliationService');
const ReservaRepairService = require('./ReservaRepairService');

module.exports = {
  ...MotorComercialService,
  MotorComercialService,
  reconciliarReservas: ReservaReconciliationService.reconciliarReservas,
  TipoInconsistenciaReserva: ReservaReconciliationService.TipoInconsistencia,
  ReservaReconciliationService,
  executarPlanoCorrecao: ReservaRepairService.executarPlano,
  ReservaRepairService
};
