const SitefAdapter = require('./adapters/sitefAdapter');
const SitefRealAdapter = require('./adapters/sitefRealAdapter');
const PaygoAdapter = require('./adapters/paygoAdapter');
const PaygoRealAdapter = require('./adapters/paygoRealAdapter');
const StoneAdapter = require('./adapters/stoneAdapter');
const CieloAdapter = require('./adapters/cieloAdapter');
const RedeAdapter = require('./adapters/redeAdapter');
const GetnetAdapter = require('./adapters/getnetAdapter');
const DestaxaAdapter = require('./adapters/destaxaAdapter');
const DestaxaRealAdapter = require('./adapters/DestaxaRealAdapter');

const PROVEDORES = Object.freeze([
  'sitef',
  'paygo',
  'cielo',
  'stone',
  'rede',
  'getnet',
  'destaxa'
]);

function ambienteUsaMiddlewareReal(ambiente) {
  const a = String(ambiente || 'simulacao').toLowerCase();
  return a === 'homologacao' || a === 'producao' || a === 'produção';
}

function normalizarProvedor(provedor) {
  return String(provedor || '').toLowerCase();
}

function provedorReconhecido(provedor) {
  return PROVEDORES.includes(normalizarProvedor(provedor));
}

function criarAdapter(registro) {
  if (!registro) {
    throw new Error('TEF não configurado');
  }

  const provedor = normalizarProvedor(registro.provedor);
  const usarReal = ambienteUsaMiddlewareReal(registro.ambiente);

  if (provedor === 'sitef') {
    if (usarReal && SitefRealAdapter.podeUsarModoReal()) {
      return new SitefRealAdapter(registro);
    }
    return new SitefAdapter(registro);
  }

  if (provedor === 'paygo') {
    if (usarReal && PaygoRealAdapter.podeUsarModoReal()) {
      return new PaygoRealAdapter(registro);
    }
    return new PaygoAdapter(registro);
  }

  if (provedor === 'destaxa') {
    if (usarReal) {
      return new DestaxaRealAdapter(registro);
    }
    return DestaxaAdapter(registro);
  }

  const gateways = {
    stone: StoneAdapter,
    cielo: CieloAdapter,
    rede: RedeAdapter,
    getnet: GetnetAdapter
  };

  const Gateway = gateways[provedor];
  if (!Gateway) {
    throw new Error(`Provedor TEF não suportado: ${provedor}`);
  }

  return new Gateway(registro);
}

async function obterAdapter() {
  const tefConfigRepository = require('../../repositories/tefConfigRepository');
  const registro = await tefConfigRepository.buscarConfiguracaoPrincipal();
  return criarAdapter(registro);
}

module.exports = {
  obterAdapter,
  criarAdapter,
  ambienteUsaMiddlewareReal,
  provedorReconhecido,
  PROVEDORES
};
