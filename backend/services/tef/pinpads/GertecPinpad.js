const BasePinpad = require('./BasePinpad');

class GertecPinpad extends BasePinpad {
  constructor(config) {
    super(config);
    this.fabricante = 'Gertec';
  }

  async conectar() {
    return new Promise((resolve) => {
      setTimeout(() => {
        this.conectado = true;
        resolve({
          conectado: true,
          fabricante: this.fabricante,
          modelo: this.config.modelo || 'Desconhecido',
          mensagem: 'PinPad Gertec conectado com sucesso'
        });
      }, 1000);
    });
  }

  async desconectar() {
    return new Promise((resolve) => {
      setTimeout(() => {
        this.conectado = false;
        resolve({
          desconectado: true,
          mensagem: 'PinPad Gertec desconectado'
        });
      }, 500);
    });
  }

  async status() {
    return new Promise((resolve) => {
      setTimeout(() => {
        resolve({
          online: this.conectado,
          fabricante: this.fabricante,
          modelo: this.config.modelo || 'Desconhecido',
          porta: this.config.porta_com || this.config.ip,
          ultima_verificacao: new Date().toISOString()
        });
      }, 200);
    });
  }

  async iniciarPagamento(dados) {
    return new Promise((resolve) => {
      setTimeout(() => {
        resolve({
          iniciado: true,
          mensagem: 'Pagamento iniciado no PinPad Gertec',
          dados: {
            valor: dados.valor,
            tipo: dados.tipo
          }
        });
      }, 800);
    });
  }

  async cancelar() {
    return new Promise((resolve) => {
      setTimeout(() => {
        resolve({
          cancelado: true,
          mensagem: 'Operação cancelada no PinPad Gertec'
        });
      }, 500);
    });
  }
}

module.exports = GertecPinpad;
