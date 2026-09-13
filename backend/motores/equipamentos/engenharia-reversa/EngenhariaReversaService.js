/**
 * EngenhariaReversaService — Fachada Sprint 13.
 */

const protocolCaptureService = require('./ProtocolCaptureService');
const frameAnalyzer = require('./FrameAnalyzer');
const protocolDocumentation = require('./ProtocolDocumentation');
const captureExporter = require('./CaptureExporter');
const captureImporter = require('./CaptureImporter');
const wiresharkFormat = require('./WiresharkFormat');
const packetComparator = require('../laboratorio/PacketComparator');

class EngenhariaReversaService {
  get capture() { return protocolCaptureService; }
  get analyzer() { return frameAnalyzer; }
  get documentation() { return protocolDocumentation; }
  get exporter() { return captureExporter; }
  get importer() { return captureImporter; }
  get wireshark() { return wiresharkFormat; }
  get comparator() { return packetComparator; }

  iniciarCaptura(meta) {
    return protocolCaptureService.iniciarCaptura(meta);
  }

  pararCaptura() {
    return protocolCaptureService.pararCaptura();
  }

  exportar(sessao, nome) {
    return protocolCaptureService.exportar(sessao, nome);
  }

  importar(idOuCaminho) {
    return protocolCaptureService.importar(idOuCaminho);
  }

  listarCapturas() {
    return protocolCaptureService.listarCapturas();
  }

  abrirCaptura(id) {
    return protocolCaptureService.abrirCaptura(id);
  }

  analisarFrame(buffer) {
    return frameAnalyzer.analisarFrame(buffer);
  }

  adicionarObservacao(capturaId, indice, texto, categoria) {
    protocolDocumentation.adicionarObservacao(capturaId, indice, texto, categoria);
  }

  atualizarProtocoloMd(sessoes) {
    return protocolCaptureService.atualizarDocumentacao(sessoes);
  }

  compararCapturas(capturaA, capturaB, categoria = null) {
    if (categoria) {
      return packetComparator.compararCapturasPorCategoria(capturaA, capturaB, categoria);
    }
    return packetComparator.compararCapturas(capturaA, capturaB);
  }

  gerarWireshark(sessao) {
    return wiresharkFormat.gerarDeSessao(sessao);
  }
}

const engenhariaReversaService = new EngenhariaReversaService();

module.exports = engenhariaReversaService;
module.exports.EngenhariaReversaService = EngenhariaReversaService;
