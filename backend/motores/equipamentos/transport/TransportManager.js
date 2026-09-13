/**
 * TransportManager — Registro e seleção de transportes do Motor de Equipamentos.
 *
 * Responsabilidade:
 * - Registrar classes de transporte
 * - Selecionar/instanciar transporte por tipo
 * - Listar transportes disponíveis
 * - Carregar automaticamente transportes built-in
 * - Validar herança BaseTransport
 *
 * @class TransportManager
 */

const BaseTransport = require('./BaseTransport');
const EthernetTransport = require('./EthernetTransport');
const SerialTransport = require('./SerialTransport');
const UsbTransport = require('./UsbTransport');
const BluetoothTransport = require('./BluetoothTransport');
const MockTransport = require('./MockTransport');

/** Catálogo de transportes built-in */
const TRANSPORTES_BUILTIN = [
  { codigo: 'ethernet', Classe: EthernetTransport, descricao: 'TCP/Ethernet' },
  { codigo: 'serial', Classe: SerialTransport, descricao: 'RS-232 / COM' },
  { codigo: 'usb', Classe: UsbTransport, descricao: 'USB' },
  { codigo: 'bluetooth', Classe: BluetoothTransport, descricao: 'Bluetooth' },
  { codigo: 'mock', Classe: MockTransport, descricao: 'Simulado (testes)' }
];

class TransportManager {
  constructor() {
    /** @type {Map<string, Object>} */
    this._registro = new Map();
    /** @type {boolean} */
    this._carregado = false;
    /** @type {Object|null} */
    this._ultimoRelatorio = null;
  }

  /**
   * Valida uma classe de transporte.
   * @param {Function} ClasseTransport
   * @returns {{ valido: boolean, erros: string[] }}
   */
  validar(ClasseTransport) {
    return BaseTransport.validarHeranca(ClasseTransport);
  }

  /**
   * Registra um transporte.
   * @param {Object} entrada - { codigo, Classe, meta? }
   */
  registrar(entrada) {
    const { codigo, Classe, meta = {} } = entrada;

    if (!codigo) {
      throw new Error('codigo é obrigatório para registrar transporte');
    }

    const validacao = this.validar(Classe);
    if (!validacao.valido) {
      throw new Error(`Transporte inválido (${codigo}): ${validacao.erros.join('; ')}`);
    }

    const instanciaRef = new Classe({});
    const registro = {
      codigo: String(codigo).toLowerCase(),
      tipo: instanciaRef.tipo(),
      descricao: meta.descricao || codigo,
      Classe,
      meta,
      registrado_em: new Date().toISOString()
    };

    this._registro.set(registro.codigo, registro);
    return registro;
  }

  /**
   * Remove transporte do registro.
   * @param {string} codigo
   * @returns {boolean}
   */
  remover(codigo) {
    return this._registro.delete(String(codigo).toLowerCase());
  }

  /**
   * Busca registro por código.
   * @param {string} codigo
   * @returns {Object|null}
   */
  buscar(codigo) {
    return this._registro.get(String(codigo).toLowerCase()) || null;
  }

  /**
   * Lista transportes registrados (sem instanciar).
   * @returns {Object[]}
   */
  listar() {
    return Array.from(this._registro.values()).map((r) => ({
      codigo: r.codigo,
      tipo: r.tipo,
      descricao: r.descricao,
      registrado_em: r.registrado_em
    }));
  }

  /**
   * Verifica se transporte está registrado.
   * @param {string} codigo
   * @returns {boolean}
   */
  possui(codigo) {
    return this._registro.has(String(codigo).toLowerCase());
  }

  /**
   * Instancia um transporte pelo código.
   * @param {string} codigo
   * @param {Object} [config]
   * @returns {BaseTransport}
   */
  instanciar(codigo, config = {}) {
    const registro = this.buscar(codigo);
    if (!registro) {
      throw new Error(`Transporte não registrado: ${codigo}`);
    }
    return new registro.Classe(config);
  }

  /**
   * Seleciona e instancia o transporte adequado (alias de instanciar).
   * @param {string} tipo - ethernet | serial | usb | bluetooth | mock
   * @param {Object} [config]
   * @returns {BaseTransport}
   */
  selecionar(tipo, config = {}) {
    this.garantirCarregado();
    return this.instanciar(tipo, config);
  }

  /**
   * Carrega automaticamente todos os transportes built-in.
   * @returns {{ carregados: number, ignorados: Object[], erros: Object[] }}
   */
  carregarTodos() {
    const relatorio = { carregados: 0, ignorados: [], erros: [] };

    for (const item of TRANSPORTES_BUILTIN) {
      try {
        if (this.possui(item.codigo)) {
          relatorio.ignorados.push({ codigo: item.codigo, motivo: 'já registrado' });
          continue;
        }
        this.registrar({
          codigo: item.codigo,
          Classe: item.Classe,
          meta: { descricao: item.descricao }
        });
        relatorio.carregados += 1;
      } catch (err) {
        relatorio.erros.push({ codigo: item.codigo, erro: err.message });
      }
    }

    this._carregado = true;
    this._ultimoRelatorio = relatorio;
    return relatorio;
  }

  /**
   * Garante que transportes built-in foram carregados (lazy init).
   */
  garantirCarregado() {
    if (!this._carregado) {
      this.carregarTodos();
    }
  }

  /**
   * @returns {Object|null}
   */
  obterUltimoRelatorio() {
    return this._ultimoRelatorio;
  }

  /**
   * Reinicia o registro (útil em testes).
   */
  reiniciar() {
    this._registro.clear();
    this._carregado = false;
    this._ultimoRelatorio = null;
  }
}

const transportManager = new TransportManager();

module.exports = transportManager;
module.exports.TransportManager = TransportManager;
module.exports.TRANSPORTES_BUILTIN = TRANSPORTES_BUILTIN;
