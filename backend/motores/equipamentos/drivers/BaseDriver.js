/**
 * BaseDriver — Classe abstrata oficial dos drivers de equipamentos.
 *
 * Todo driver de fabricante DEVE estender esta classe e implementar todos os métodos
 * obrigatórios. Instanciar BaseDriver diretamente é proibido.
 *
 * @abstract
 * @class BaseDriver
 */

const METODOS_OBRIGATORIOS = [
  'conectar',
  'desconectar',
  'configurar',
  'status',
  'diagnostico',
  'descobrir',
  'sincronizarProduto',
  'sincronizarProdutos',
  'sincronizarPromocao',
  'sincronizarDepartamento',
  'sincronizarEtiqueta',
  'removerProduto',
  'obterPeso',
  'zerar',
  'reiniciar',
  'informacoes',
  'transportesSuportados',
  'fabricante',
  'modelo',
  'versao'
];

class BaseDriver {
  /**
   * @param {Object} [config]
   */
  constructor(config = {}) {
    if (new.target === BaseDriver) {
      throw new Error('BaseDriver é abstrata e não pode ser instanciada diretamente');
    }

    this.config = config || {};
    this.modo = config.modo || 'stub';
  }

  /**
   * Valida se uma classe estende BaseDriver corretamente.
   * @param {Function} ClasseDriver
   * @returns {{ valido: boolean, erros: string[] }}
   */
  static validarHeranca(ClasseDriver) {
    const erros = [];

    if (!ClasseDriver || typeof ClasseDriver !== 'function') {
      return { valido: false, erros: ['Classe de driver inválida'] };
    }

    if (ClasseDriver === BaseDriver) {
      return { valido: false, erros: ['BaseDriver não pode ser registrada como driver'] };
    }

    let prototipo = ClasseDriver.prototype;
    let herdaBase = false;
    while (prototipo) {
      if (prototipo === BaseDriver.prototype) {
        herdaBase = true;
        break;
      }
      prototipo = Object.getPrototypeOf(prototipo);
    }

    if (!herdaBase) {
      erros.push('Driver deve estender BaseDriver');
    }

    let instancia;
    try {
      instancia = new ClasseDriver({});
    } catch (error) {
      erros.push(`Falha ao instanciar driver: ${error.message}`);
      return { valido: false, erros };
    }

    if (!(instancia instanceof BaseDriver)) {
      erros.push('Instância não é instanceof BaseDriver');
    }

    for (const metodo of METODOS_OBRIGATORIOS) {
      if (typeof instancia[metodo] !== 'function') {
        erros.push(`Método obrigatório ausente: ${metodo}()`);
      }
    }

    return { valido: erros.length === 0, erros };
  }

  /**
   * @param {string} metodo
   * @returns {never}
   * @protected
   */
  _naoImplementado(metodo) {
    const fab = typeof this.fabricante === 'function' ? this.fabricante() : 'base';
    const mod = typeof this.modelo === 'function' ? this.modelo() : 'base';
    throw new Error(`${metodo}() não implementado em ${fab}/${mod}`);
  }

  async conectar() { this._naoImplementado('conectar'); }
  async desconectar() { this._naoImplementado('desconectar'); }
  async configurar() { this._naoImplementado('configurar'); }
  async status() { this._naoImplementado('status'); }
  async diagnostico() { this._naoImplementado('diagnostico'); }
  async descobrir() { this._naoImplementado('descobrir'); }
  async sincronizarProduto() { this._naoImplementado('sincronizarProduto'); }
  async sincronizarProdutos() { this._naoImplementado('sincronizarProdutos'); }
  async sincronizarPromocao() { this._naoImplementado('sincronizarPromocao'); }
  async sincronizarDepartamento() { this._naoImplementado('sincronizarDepartamento'); }
  async sincronizarEtiqueta() { this._naoImplementado('sincronizarEtiqueta'); }
  async removerProduto() { this._naoImplementado('removerProduto'); }
  async obterPeso() { this._naoImplementado('obterPeso'); }
  async zerar() { this._naoImplementado('zerar'); }
  async reiniciar() { this._naoImplementado('reiniciar'); }
  informacoes() { this._naoImplementado('informacoes'); }
  transportesSuportados() { this._naoImplementado('transportesSuportados'); }
  fabricante() { this._naoImplementado('fabricante'); }
  modelo() { this._naoImplementado('modelo'); }
  versao() { this._naoImplementado('versao'); }

  /** @deprecated Use sincronizarProduto */
  async enviarProduto(produto) { return this.sincronizarProduto(produto); }
  /** @deprecated Use sincronizarProdutos */
  async enviarProdutos(produtos) { return this.sincronizarProdutos(produtos); }
  /** @deprecated Use sincronizarDepartamento */
  async enviarDepartamento(dep) { return this.sincronizarDepartamento(dep); }
  /** @deprecated Use sincronizarPromocao */
  async enviarPromocao(promo) { return this.sincronizarPromocao(promo); }
  /** @deprecated Use sincronizarEtiqueta */
  async enviarEtiqueta(etiqueta) { return this.sincronizarEtiqueta(etiqueta); }
}

BaseDriver.METODOS_OBRIGATORIOS = METODOS_OBRIGATORIOS;

module.exports = BaseDriver;
