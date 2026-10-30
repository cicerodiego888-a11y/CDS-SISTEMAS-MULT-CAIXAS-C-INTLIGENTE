'use strict';

const BasePinpad = require('./BasePinpad');

/**
 * PinPad cadastrado no catálogo sem adapter TEF financeiro.
 * Recusa conexão/pagamento — não simula sucesso e não reutiliza Gertec/Destaxa.
 */
class PinpadNaoIntegrado extends BasePinpad {
  constructor(config = {}) {
    super(config);
    this.fabricante = config.fabricante || 'Desconhecido';
    this.codigo = config.codigo || config.pinpadCodigo || null;
    this.nomeExibicao = config.pinpadNomeExibicao || config.pinpadNome || this.codigo || 'PinPad';
    this.integracaoTefStatus = 'NAO_INTEGRADO';
  }

  _recusar(operacao) {
    const erro = new Error(
      `${this.nomeExibicao}: modelo cadastrado, mas a integração TEF ainda não está disponível no CDS. `
      + `Operação "${operacao}" bloqueada (não há adapter financeiro para este PinPad).`
    );
    erro.code = 'PINPAD_NAO_INTEGRADO';
    erro.codigo = 'PINPAD_NAO_INTEGRADO';
    erro.pinpadCodigo = this.codigo;
    throw erro;
  }

  async conectar() {
    this._recusar('conectar');
  }

  async desconectar() {
    this.conectado = false;
    return { desconectado: true, mensagem: `${this.nomeExibicao}: sem sessão TEF ativa` };
  }

  async status() {
    return {
      online: false,
      integracaoTefStatus: 'NAO_INTEGRADO',
      fabricante: this.fabricante,
      modelo: this.config.modelo || null,
      codigo: this.codigo,
      mensagem: `${this.nomeExibicao}: cadastrado sem integração TEF`
    };
  }

  async iniciarPagamento() {
    this._recusar('iniciarPagamento');
  }

  async cancelar() {
    this._recusar('cancelar');
  }
}

module.exports = PinpadNaoIntegrado;
