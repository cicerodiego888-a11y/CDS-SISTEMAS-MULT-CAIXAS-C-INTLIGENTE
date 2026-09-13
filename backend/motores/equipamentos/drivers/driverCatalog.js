/**
 * Catálogo declarativo de drivers do Motor Equipamentos.
 *
 * Cada entrada descreve metadados do plugin — independente do banco SQLite.
 */

/** @typedef {'estrutura'|'desenvolvimento'|'homologacao'|'producao'|'descontinuado'} DriverStatus */

/**
 * @type {Array<Object>}
 */
const DRIVER_CATALOG = [
  {
    codigo: 'TOLEDO_PRIX4_UNO',
    fabricante: 'Toledo',
    modelo: 'Prix IV Uno',
    tipo: 'balanca',
    protocolos: ['90AX', 'toledo-prix4', 'ethernet-tcp'],
    transportes: ['ethernet'],
    status: 'homologacao',
    versao_minima: '1.0.0',
    modulo: './toledo/prix4/ToledoPrix4UnoDriver',
    nome_exibicao: 'Toledo Prix IV Uno',
    aliases: ['TOLEDO_PRIX4', 'toledo-prix4'],
    runtime_modulo: './toledo/ToledoPrixIVDriver'
  },
  {
    codigo: 'FILIZOLA_PLATINA',
    fabricante: 'Filizola',
    modelo: 'Platina',
    tipo: 'balanca',
    protocolos: ['filizola-platina'],
    transportes: ['serial', 'ethernet'],
    status: 'estrutura',
    versao_minima: '1.0.0',
    modulo: './filizola/FilizolaPlatinaDriver',
    nome_exibicao: 'Filizola Platina'
  },
  {
    codigo: 'URANO_POP',
    fabricante: 'Urano',
    modelo: 'POP',
    tipo: 'balanca',
    protocolos: ['urano-pop'],
    transportes: ['serial'],
    status: 'estrutura',
    versao_minima: '1.0.0',
    modulo: './urano/UranoPopDriver',
    nome_exibicao: 'Urano POP'
  },
  {
    codigo: 'ACLAS_LS2',
    fabricante: 'Aclas',
    modelo: 'LS2',
    tipo: 'balanca',
    protocolos: ['aclas-ls2'],
    transportes: ['serial', 'usb'],
    status: 'estrutura',
    versao_minima: '1.0.0',
    modulo: './aclas/AclasLs2Driver',
    nome_exibicao: 'Aclas LS2'
  },
  {
    codigo: 'ELGEN_BALANCA',
    fabricante: 'Elgin',
    modelo: 'DP30',
    tipo: 'balanca',
    protocolos: ['elgin-dp30'],
    transportes: ['serial'],
    status: 'estrutura',
    versao_minima: '1.0.0',
    modulo: './elgin/ElginDp30Driver',
    nome_exibicao: 'Elgin DP30'
  },
  {
    codigo: 'BEMATECH_BP5',
    fabricante: 'Bematech',
    modelo: 'BP5',
    tipo: 'balanca',
    protocolos: ['bematech-bp5'],
    transportes: ['serial'],
    status: 'estrutura',
    versao_minima: '1.0.0',
    modulo: './bematech/BematechBp5Driver',
    nome_exibicao: 'Bematech BP5'
  },
  {
    codigo: 'GENERIC_SERIAL',
    fabricante: 'Genérico',
    modelo: 'Serial',
    tipo: 'balanca',
    protocolos: ['serial-generico'],
    transportes: ['serial'],
    status: 'estrutura',
    versao_minima: '1.0.0',
    modulo: './comum/GenericSerialDriver',
    nome_exibicao: 'Genérico Serial (Discovery)'
  },
  {
    codigo: 'GENERIC_USB',
    fabricante: 'Genérico',
    modelo: 'USB',
    tipo: 'balanca',
    protocolos: ['usb-generico'],
    transportes: ['usb'],
    status: 'estrutura',
    versao_minima: '1.0.0',
    modulo: './comum/GenericUsbDriver',
    nome_exibicao: 'Genérico USB (Discovery)'
  }
];

function listarCatalogo() {
  return DRIVER_CATALOG.map((item) => ({ ...item }));
}

function buscarNoCatalogo(codigo) {
  return DRIVER_CATALOG.find((item) => item.codigo === codigo) || null;
}

function buscarPorFabricante(fabricante) {
  const f = String(fabricante || '').toLowerCase();
  return DRIVER_CATALOG.filter((item) => item.fabricante.toLowerCase() === f);
}

function buscarPorModelo(modelo) {
  const m = String(modelo || '').toLowerCase();
  return DRIVER_CATALOG.filter((item) => item.modelo.toLowerCase() === m);
}

function buscarPorTipo(tipo) {
  const t = String(tipo || '').toLowerCase();
  return DRIVER_CATALOG.filter((item) => item.tipo.toLowerCase() === t);
}

function buscarPorTransporte(transporte) {
  const tr = String(transporte || '').toLowerCase();
  return DRIVER_CATALOG.filter((item) =>
    (item.transportes || []).some((x) => String(x).toLowerCase() === tr)
  );
}

module.exports = {
  DRIVER_CATALOG,
  listarCatalogo,
  buscarNoCatalogo,
  buscarPorFabricante,
  buscarPorModelo,
  buscarPorTipo,
  buscarPorTransporte
};
