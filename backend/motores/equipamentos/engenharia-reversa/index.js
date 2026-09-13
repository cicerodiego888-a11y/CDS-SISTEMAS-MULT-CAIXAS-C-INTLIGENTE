/**
 * Engenharia Reversa — exports públicos (Sprint 13)
 * @module motores/equipamentos/engenharia-reversa
 */

const engenhariaReversaService = require('./EngenhariaReversaService');

module.exports = {
  engenhariaReversaService,
  EngenhariaReversaService: engenhariaReversaService.EngenhariaReversaService,
  protocolCaptureService: require('./ProtocolCaptureService'),
  frameAnalyzer: require('./FrameAnalyzer'),
  protocolDocumentation: require('./ProtocolDocumentation'),
  CaptureSession: require('./CaptureSession'),
  captureExporter: require('./CaptureExporter'),
  captureImporter: require('./CaptureImporter'),
  wiresharkFormat: require('./WiresharkFormat'),
  paths: require('./paths')
};
