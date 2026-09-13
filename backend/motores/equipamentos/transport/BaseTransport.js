/**
 * BaseTransport — Classe abstrata da camada de transporte do Motor de Equipamentos.
 *
 * Todo transporte (Ethernet, Serial, USB, Bluetooth, Mock) DEVE estender esta classe.
 * Drivers utilizam transportes para comunicar com hardware sem conhecer detalhes
 * de baixo nível (sockets, portas seriais, etc.).
 *
 * Fluxo:
 *   Driver → Transport → Hardware
 *
 * IMPORTANTE (Sprint 5): infraestrutura apenas. Implementações concretas
 * não abrem sockets, portas seriais ou dispositivos reais.
 *
 * @abstract
 * @class BaseTransport
 */

const METODOS_OBRIGATORIOS = [
  'conectar',
  'desconectar',
  'enviar',
  'receber',
  'ping',
  'status',
  'reiniciar',
  'configurar',
  'tipo'
];

class BaseTransport {
  /**
   * @param {Object} [config]
   */
  constructor(config = {}) {
    if (new.target === BaseTransport) {
      throw new Error('BaseTransport é abstrata e não pode ser instanciada diretamente');
    }

    this.config = config || {};
    this._conectado = false;
  }

  /**
   * Valida se uma classe estende BaseTransport corretamente.
   * @param {Function} ClasseTransport
   * @returns {{ valido: boolean, erros: string[] }}
   */
  static validarHeranca(ClasseTransport) {
    const erros = [];

    if (!ClasseTransport || typeof ClasseTransport !== 'function') {
      return { valido: false, erros: ['Classe de transporte inválida'] };
    }

    if (ClasseTransport === BaseTransport) {
      return { valido: false, erros: ['BaseTransport não pode ser registrada como transporte'] };
    }

    let prototipo = ClasseTransport.prototype;
    let herdaBase = false;
    while (prototipo) {
      if (prototipo === BaseTransport.prototype) {
        herdaBase = true;
        break;
      }
      prototipo = Object.getPrototypeOf(prototipo);
    }

    if (!herdaBase) {
      erros.push('Transporte deve estender BaseTransport');
    }

    let instancia;
    try {
      instancia = new ClasseTransport({});
    } catch (error) {
      erros.push(`Falha ao instanciar transporte: ${error.message}`);
      return { valido: false, erros };
    }

    if (!(instancia instanceof BaseTransport)) {
      erros.push('Instância não é instanceof BaseTransport');
    }

    for (const metodo of METODOS_OBRIGATORIOS) {
      if (typeof instancia[metodo] !== 'function') {
        erros.push(`Método obrigatório ausente: ${metodo}()`);
      }
    }

    return { valido: erros.length === 0, erros };
  }

  /**
   * @returns {boolean}
   */
  estaConectado() {
    return this._conectado;
  }

  /**
   * @param {string} metodo
   * @returns {never}
   * @protected
   */
  _naoImplementado(metodo) {
    const tipo = typeof this.tipo === 'function' ? this.tipo() : 'base';
    throw new Error(`${metodo}() não implementado em transporte ${tipo}`);
  }

  /**
   * Resposta padrão para operações simuladas (sem hardware real).
   * @param {string} metodo
   * @param {Object} [extras]
   * @returns {Object}
   * @protected
   */
  _stub(metodo, extras = {}) {
    return {
      sucesso: true,
      simulado: true,
      comunicacao_real: false,
      transporte: typeof this.tipo === 'function' ? this.tipo() : 'desconhecido',
      metodo,
      timestamp: new Date().toISOString(),
      ...extras
    };
  }

  async conectar() { this._naoImplementado('conectar'); }
  async desconectar() { this._naoImplementado('desconectar'); }
  async enviar() { this._naoImplementado('enviar'); }
  async receber() { this._naoImplementado('receber'); }
  async ping() { this._naoImplementado('ping'); }
  async status() { this._naoImplementado('status'); }
  async reiniciar() { this._naoImplementado('reiniciar'); }
  async configurar() { this._naoImplementado('configurar'); }
  tipo() { this._naoImplementado('tipo'); }
}

BaseTransport.METODOS_OBRIGATORIOS = METODOS_OBRIGATORIOS;

module.exports = BaseTransport;
