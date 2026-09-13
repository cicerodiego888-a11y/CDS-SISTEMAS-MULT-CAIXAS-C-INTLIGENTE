class BasePinpad {
  constructor(config) {
    this.config = config;
    this.conectado = false;
  }

  async conectar() {
    throw new Error('Método conectar() deve ser implementado pela subclasse');
  }

  async desconectar() {
    throw new Error('Método desconectar() deve ser implementado pela subclasse');
  }

  async status() {
    throw new Error('Método status() deve ser implementado pela subclasse');
  }

  async iniciarPagamento(dados) {
    throw new Error('Método iniciarPagamento() deve ser implementado pela subclasse');
  }

  async cancelar() {
    throw new Error('Método cancelar() deve ser implementado pela subclasse');
  }

  async verificarConexao() {
    try {
      const status = await this.status();
      return status.online || false;
    } catch (error) {
      return false;
    }
  }
}

module.exports = BasePinpad;
