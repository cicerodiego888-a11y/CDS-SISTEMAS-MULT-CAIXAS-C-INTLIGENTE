/**
 * MIRX — Motor Inteligente de Recuperação de XML (RC3.4.1 / RC3.4.2)
 *
 * @module motores/central-entradas/mirx
 */

const mirx = require('./MirxService');
const { MirxEstados, obterLabel } = require('./MirxEstados');
const { BACKOFF_MINUTOS, calcularBackoffMs, calcularProximaEm, descreverBackoff } = require('./MirxBackoff');
const MirxQueue = require('./MirxQueue');
const MirxWorker = require('./MirxWorker');
const MirxAuditoria = require('./MirxAuditoria');

module.exports = mirx;
module.exports.MirxService = mirx.MirxService;
module.exports.MirxEstados = MirxEstados;
module.exports.obterLabelEstadoMirx = obterLabel;
module.exports.isSleep = require('./MirxEstados').isSleep;
module.exports.resolverIndicadorVisual = require('./MirxEstados').resolverIndicadorVisual;
module.exports.BACKOFF_MINUTOS = BACKOFF_MINUTOS;
module.exports.calcularBackoffMs = calcularBackoffMs;
module.exports.calcularProximaEm = calcularProximaEm;
module.exports.descreverBackoff = descreverBackoff;
module.exports.MirxQueue = MirxQueue;
module.exports.MirxWorker = MirxWorker;
module.exports.MirxAuditoria = MirxAuditoria;
module.exports.TIPOS_MIRX = MirxAuditoria.TIPOS_MIRX;
