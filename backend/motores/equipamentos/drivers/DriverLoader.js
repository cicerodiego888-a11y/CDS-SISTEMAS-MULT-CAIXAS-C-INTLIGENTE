/**
 * DriverLoader — Carregamento automático de plugins de drivers.
 *
 * Responsabilidade:
 * - Carregar módulos de driver declarados no catálogo
 * - Validar herança de BaseDriver
 * - Registrar drivers válidos no DriverRegistry
 * - Ignorar drivers inválidos e gerar relatório
 */

const path = require('path');
const BaseDriver = require('./BaseDriver');
const driverRegistry = require('./DriverRegistry');
const driverCatalog = require('./driverCatalog');

class DriverLoader {
  constructor() {
    this._carregado = false;
    this._ultimoRelatorio = null;
  }

  /**
   * Carrega todos os drivers com módulo declarado no catálogo.
   * @param {Object} [opcoes]
   * @returns {{ carregados: Object[], ignorados: Object[], erros: Object[] }}
   */
  carregarTodos(opcoes = {}) {
    const forcar = opcoes.forcar === true;
    if (this._carregado && !forcar) {
      return this._ultimoRelatorio;
    }

    const carregados = [];
    const ignorados = [];
    const erros = [];

    const entradas = driverCatalog.listarCatalogo().filter((item) => item.modulo);

    for (const entrada of entradas) {
      try {
        const moduloPath = path.join(__dirname, entrada.modulo.replace(/^\.\//, ''));
        // eslint-disable-next-line import/no-dynamic-require, global-require
        const exportado = require(moduloPath);
        const Classe = exportado.default || exportado;

        const validacao = BaseDriver.validarHeranca(Classe);
        if (!validacao.valido) {
          ignorados.push({
            codigo: entrada.codigo,
            motivo: validacao.erros.join('; '),
            modulo: entrada.modulo
          });
          continue;
        }

        if (driverRegistry.buscar(entrada.codigo)) {
          ignorados.push({
            codigo: entrada.codigo,
            motivo: 'Já registrado',
            modulo: entrada.modulo
          });
          continue;
        }

        const registro = driverRegistry.registrar({
          codigo: entrada.codigo,
          Classe,
          meta: {
            fabricante: entrada.fabricante,
            modelo: entrada.modelo,
            tipo: entrada.tipo,
            protocolos: entrada.protocolos,
            transportes: entrada.transportes,
            status: entrada.status,
            versao_minima: entrada.versao_minima,
            nome_exibicao: entrada.nome_exibicao
          }
        });

        // RC14.14.3 — aliases de identidade
        const aliases = Array.isArray(entrada.aliases) ? entrada.aliases : [];
        for (const alias of aliases) {
          driverRegistry.registrarAlias(entrada.codigo, alias);
        }
        try {
          const identity = require('../sdk/DriverIdentityResolver');
          if (identity.ehToledo(entrada.codigo)) {
            identity.aplicarAliasesNosRegistries(driverRegistry, null);
          }
        } catch (_) { /* ignore */ }

        carregados.push({
          codigo: entrada.codigo,
          fabricante: registro.fabricante,
          modelo: registro.modelo,
          modulo: entrada.modulo,
          versao_driver: registro.versao_driver
        });
      } catch (error) {
        erros.push({
          codigo: entrada.codigo,
          modulo: entrada.modulo,
          erro: error.message
        });
      }
    }

    this._ultimoRelatorio = {
      carregados,
      ignorados,
      erros,
      total_catalogo: driverCatalog.listarCatalogo().length,
      total_com_modulo: entradas.length,
      timestamp: new Date().toISOString()
    };

    this._carregado = true;
    return this._ultimoRelatorio;
  }

  obterRelatorio() {
    return this._ultimoRelatorio;
  }

  estaCarregado() {
    return this._carregado;
  }

  reiniciar() {
    driverRegistry.limpar();
    this._carregado = false;
    this._ultimoRelatorio = null;
  }
}

const driverLoader = new DriverLoader();

module.exports = driverLoader;
