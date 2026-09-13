/**
 * DriverRegistry — Registro central de plugins de drivers.
 *
 * Responsabilidade:
 * - Manter mapa de classes de driver carregadas
 * - Expor buscas por fabricante, modelo, tipo e transporte
 * - Unir metadados do catálogo com classes registradas
 */

const BaseDriver = require('./BaseDriver');
const driverCatalog = require('./driverCatalog');

class DriverRegistry {
  constructor() {
    /**
     * @type {Map<string, Object>}
     * Chave: codigo do driver
     */
    this._registro = new Map();
  }

  _montarChave(fabricante, modelo) {
    return `${String(fabricante).toLowerCase()}:${String(modelo).toLowerCase()}`;
  }

  /**
   * @param {Object} entrada
   * @param {string} entrada.codigo
   * @param {typeof BaseDriver} entrada.Classe
   * @param {Object} [entrada.meta]
   */
  registrar(entrada) {
    const { codigo, Classe, meta = {} } = entrada;

    if (!codigo) {
      throw new Error('codigo é obrigatório para registrar driver');
    }

    const validacao = BaseDriver.validarHeranca(Classe);
    if (!validacao.valido) {
      throw new Error(`Driver inválido (${codigo}): ${validacao.erros.join('; ')}`);
    }

    const catalogo = driverCatalog.buscarNoCatalogo(codigo) || {};
    const instanciaRef = new Classe({});

    const registro = {
      codigo,
      fabricante: meta.fabricante || catalogo.fabricante || instanciaRef.fabricante(),
      modelo: meta.modelo || catalogo.modelo || instanciaRef.modelo(),
      tipo: meta.tipo || catalogo.tipo || 'balanca',
      protocolos: meta.protocolos || catalogo.protocolos || [],
      transportes: meta.transportes || catalogo.transportes || instanciaRef.transportesSuportados(),
      status: meta.status || catalogo.status || 'estrutura',
      versao_minima: meta.versao_minima || catalogo.versao_minima || '1.0.0',
      versao_driver: typeof instanciaRef.versao === 'function' ? instanciaRef.versao() : '0.0.0',
      nome_exibicao: meta.nome_exibicao || catalogo.nome_exibicao || codigo,
      Classe,
      meta,
      registrado_em: new Date().toISOString()
    };

    this._registro.set(codigo, registro);
    this._registro.set(this._montarChave(registro.fabricante, registro.modelo), registro);

    return registro;
  }

  remover(codigoOuChave) {
    const item = this.buscar(codigoOuChave);
    if (!item) return false;

    this._registro.delete(item.codigo);
    this._registro.delete(this._montarChave(item.fabricante, item.modelo));
    return true;
  }

  buscar(codigoOuChave) {
    if (!codigoOuChave) return null;
    const chave = String(codigoOuChave);
    if (this._registro.has(chave)) {
      return this._registro.get(chave);
    }
    // RC14.14.3 — aliases Toledo → código oficial
    try {
      const identity = require('../sdk/DriverIdentityResolver');
      if (identity.ehToledo(chave)) {
        const can = identity.canonical(chave);
        if (this._registro.has(can)) return this._registro.get(can);
      }
    } catch (_) { /* ignore */ }
    const lower = chave.toLowerCase();
    for (const item of this._registro.values()) {
      if (item.codigo && item.codigo.toLowerCase() === lower) return item;
    }
    return null;
  }

  /**
   * RC14.14.3 — registra alias apontando para o mesmo registro canônico.
   */
  registrarAlias(codigoCanonico, alias) {
    const item = this.buscar(codigoCanonico);
    if (!item || !alias) return false;
    this._registro.set(String(alias), item);
    return true;
  }

  listar() {
    const vistos = new Set();
    const lista = [];

    for (const item of this._registro.values()) {
      if (!item.codigo || vistos.has(item.codigo)) continue;
      vistos.add(item.codigo);
      lista.push({
        codigo: item.codigo,
        fabricante: item.fabricante,
        modelo: item.modelo,
        tipo: item.tipo,
        protocolos: item.protocolos,
        transportes: item.transportes,
        status: item.status,
        versao_minima: item.versao_minima,
        versao_driver: item.versao_driver,
        nome_exibicao: item.nome_exibicao,
        registrado_em: item.registrado_em,
        implementado: true
      });
    }

    return lista.sort((a, b) => a.fabricante.localeCompare(b.fabricante));
  }

  listarComCatalogo() {
    const registrados = new Map(this.listar().map((d) => [d.codigo, d]));

    return driverCatalog.listarCatalogo().map((cat) => {
      const reg = registrados.get(cat.codigo);
      return {
        ...cat,
        registrado: Boolean(reg),
        implementado: Boolean(reg),
        versao_driver: reg?.versao_driver || null,
        registrado_em: reg?.registrado_em || null
      };
    });
  }

  buscarPorFabricante(fabricante) {
    const f = String(fabricante || '').toLowerCase();
    return this.listar().filter((item) => item.fabricante.toLowerCase() === f);
  }

  buscarPorModelo(modelo) {
    const m = String(modelo || '').toLowerCase();
    return this.listar().filter((item) => item.modelo.toLowerCase() === m);
  }

  buscarPorTipo(tipo) {
    const t = String(tipo || '').toLowerCase();
    return this.listar().filter((item) => String(item.tipo || '').toLowerCase() === t);
  }

  buscarPorTransporte(transporte) {
    const tr = String(transporte || '').toLowerCase();
    return this.listar().filter((item) =>
      (item.transportes || []).some((x) => String(x).toLowerCase() === tr)
    );
  }

  instanciar(codigoOuFabricanteModelo, config = {}) {
    const item = this.buscar(codigoOuFabricanteModelo);
    if (!item) {
      throw new Error(`Driver não registrado: ${codigoOuFabricanteModelo}`);
    }
    return new item.Classe({
      ...config,
      driver_codigo: item.codigo,
      fabricante: item.fabricante,
      modelo: item.modelo
    });
  }

  limpar() {
    this._registro.clear();
  }
}

const driverRegistry = new DriverRegistry();

module.exports = driverRegistry;
