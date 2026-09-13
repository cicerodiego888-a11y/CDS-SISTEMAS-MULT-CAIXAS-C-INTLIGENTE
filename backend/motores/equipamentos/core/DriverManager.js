/**
 * DriverManager — Fachada sobre DriverRegistry + DriverLoader.
 *
 * Mantém compatibilidade com Sprint 1/2 e delega ao framework de plugins Sprint 3.
 */

const driverRegistry = require('../drivers/DriverRegistry');
const officialLoader = require('../sdk/OfficialDriverLoader');
const equipamentosRepository = require('../repositories/EquipamentosRepository');

function garantirDriversCarregados() {
  officialLoader.ensureLoaded();
}

class DriverManager {
  registrarDriver(fabricante, modelo, ClasseDriver, meta = {}) {
    garantirDriversCarregados();
    const codigo = meta.codigo || `${String(fabricante).toUpperCase()}_${String(modelo).toUpperCase()}`.replace(/\s+/g, '_');
    return driverRegistry.registrar({ codigo, Classe: ClasseDriver, meta: { fabricante, modelo, ...meta } });
  }

  registrar(fabricante, modelo, ClasseDriver, meta) {
    return this.registrarDriver(fabricante, modelo, ClasseDriver, meta);
  }

  removerDriver(fabricante, modelo) {
    const item = driverRegistry.buscar(`${String(fabricante).toLowerCase()}:${String(modelo).toLowerCase()}`);
    if (!item) return false;
    return driverRegistry.remover(item.codigo);
  }

  remover(fabricante, modelo) {
    return this.removerDriver(fabricante, modelo);
  }

  listarDrivers() {
    garantirDriversCarregados();
    return driverRegistry.listar();
  }

  listarRegistrados() {
    return this.listarDrivers();
  }

  async listarDriversCompleto() {
    garantirDriversCarregados();
    const catalogoFramework = driverRegistry.listarComCatalogo();
    const catalogoDb = await equipamentosRepository.listarDriversCatalogo();
    const mapaFramework = new Map(catalogoFramework.map((d) => [d.codigo, d]));

    return catalogoDb.map((item) => {
      const fw = mapaFramework.get(item.codigo);
      let transportes = [];
      try {
        transportes = item.transportes ? JSON.parse(item.transportes) : [];
      } catch (_) {
        transportes = [];
      }
      return {
        id: item.id,
        codigo: item.codigo,
        fabricante: item.fabricante,
        modelo: item.modelo,
        nome_exibicao: item.nome_exibicao,
        versao: item.versao,
        transportes: fw?.transportes || transportes,
        protocolos: fw?.protocolos || [],
        status: fw?.status || 'catalogo',
        versao_minima: fw?.versao_minima || '1.0.0',
        versao_driver: fw?.versao_driver || null,
        descricao: item.descricao,
        registrado: Boolean(fw?.registrado),
        implementado: Boolean(fw?.implementado),
        origem: fw?.implementado ? 'plugin' : 'catalogo'
      };
    });
  }

  buscarDriver(fabricante, modelo) {
    garantirDriversCarregados();
    return driverRegistry.buscar(`${String(fabricante).toLowerCase()}:${String(modelo).toLowerCase()}`);
  }

  buscarDriverPorCodigo(codigo) {
    garantirDriversCarregados();
    return driverRegistry.buscar(codigo);
  }

  carregarDriver(fabricante, modelo, config = {}) {
    garantirDriversCarregados();
    const item = this.buscarDriver(fabricante, modelo);
    if (!item) {
      throw new Error(`Driver não registrado: ${fabricante}/${modelo}`);
    }
    return driverRegistry.instanciar(item.codigo, config);
  }

  obterDriver(fabricante, modelo, config = {}) {
    return this.carregarDriver(fabricante, modelo, config);
  }

  possuiDriver(fabricante, modelo) {
    garantirDriversCarregados();
    return Boolean(this.buscarDriver(fabricante, modelo));
  }

  obterRelatorioCarregamento() {
    garantirDriversCarregados();
    return officialLoader.obterRelatorio();
  }

  recarregarDrivers() {
    return officialLoader.reload();
  }

  // Delegação direta ao Registry
  get registry() {
    garantirDriversCarregados();
    return driverRegistry;
  }
}

const driverManager = new DriverManager();

module.exports = driverManager;
