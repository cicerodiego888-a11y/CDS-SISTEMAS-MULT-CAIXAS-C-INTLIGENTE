const BasePinpad = require('./BasePinpad');
const pinpadCatalog = require('./pinpadCatalog');

/**
 * Gertec PPC930 — abstração estrutural (sem comunicação com hardware).
 *
 * A PPC930 NÃO é controlada diretamente pelo CDS neste sprint.
 * Detecção física (TEF-02) apenas informa estado Windows/COM.
 * Operação TEF real permanece no adapter do provedor (sprint futuro).
 */
class GertecPPC930 extends BasePinpad {
  constructor(config = {}) {
    super(config);
    const meta = pinpadCatalog.MODELOS.GERTEC_PPC930;
    this.codigo = meta.codigo;
    this.fabricante = meta.fabricante;
    this.modelo = meta.modelo;
    this.nomeExibicao = meta.nomeExibicao;
    this.adquirenteSugerido = meta.adquirenteSugerido;
    this.controleViaMiddleware = true;
  }

  async conectar() {
    return {
      conectado: false,
      codigo: this.codigo,
      modelo: this.nomeExibicao,
      mensagem: 'PPC930: sem conexão direta CDS — operação via adapter do provedor',
      middleware: this._middlewareEsperado()
    };
  }

  async desconectar() {
    return {
      desconectado: true,
      codigo: this.codigo,
      mensagem: 'Desconexão lógica PPC930'
    };
  }

  async diagnosticar() {
    const sdkDetector = require('../sdkDetector');
    const portaConfigurada = this.config.porta_com || this.config.portaCom || null;
    const deteccao = sdkDetector.detectarGertecPPC930({ portaConfigurada });

    return {
      sucesso: true,
      codigo: this.codigo,
      modelo: this.nomeExibicao,
      fabricante: this.fabricante,
      detectadoFisicamente: deteccao.detectado,
      deteccao,
      controleViaMiddleware: true,
      middleware: this._middlewareEsperado(),
      mensagem: deteccao.detectado
        ? `PinPad detectado — ${deteccao.porta || portaConfigurada || 'porta desconhecida'}`
        : 'PPC930 configurada — hardware não identificado no Windows neste momento'
    };
  }

  async obterInformacoes() {
    const diag = await this.diagnosticar();
    return {
      codigo: this.codigo,
      nome: this.nomeExibicao,
      fabricante: this.fabricante,
      modelo: this.modelo,
      adquirenteSugerido: this.adquirenteSugerido,
      tipoConexao: this.config.tipo_conexao || this.config.tipoConexao || null,
      portaCom: this.config.porta_com || this.config.portaCom || null,
      ip: this.config.ip || this.config.pinpadIp || null,
      serial: this.config.serial || null,
      controleViaMiddleware: true,
      observacao: 'Detecção física via Windows; operação TEF via adapter do provedor',
      diagnostico: diag
    };
  }

  async status() {
    const diag = await this.diagnosticar();
    return {
      online: false,
      codigo: this.codigo,
      fabricante: this.fabricante,
      modelo: this.modelo,
      nomeExibicao: this.nomeExibicao,
      porta: this.config.porta_com || this.config.ip || diag.deteccao?.porta || null,
      detectado: diag.deteccao?.detectado || false,
      ultima_verificacao: new Date().toISOString(),
      aguardandoMiddleware: true
    };
  }

  _middlewareEsperado() {
    return {
      responsavel: 'Adapter do provedor TEF',
      cdsControlaHardware: false,
      pinpadCodigo: this.codigo
    };
  }
}

module.exports = GertecPPC930;
