/**
 * MTS V1.0 — Motor de Transferência de Saldos
 *
 * Responsabilidade única: transferir saldo entre Fiscal ↔ Não Fiscal
 * via Interfaces Públicas do Motor Fiscal × Não Fiscal.
 *
 * NÃO acessa tabelas de estoque/produtos.
 * NÃO conhece Pedido, Venda, NF-e, Expedição etc.
 *
 * @module motores/mts
 */
'use strict';

const MtsService = require('./MtsService');
const { TipoSaldo, ResultadoTransferencia } = require('./contracts');
const schema = require('./schema');

module.exports = {
  MtsService,
  transferirSaldo: MtsService.transferirSaldo,
  consultarTransferencia: MtsService.consultarTransferencia,
  TipoSaldo,
  ResultadoTransferencia,
  garantirSchema: schema.garantirSchema
};
