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

const AMBIENTES_DESTAXA_REAL = new Set(['homologacao', 'producao', 'produção']);

function erroAdapterDestaxa(codigo, mensagem, detalhes = {}) {
  const error = new Error(mensagem);
  error.codigo = codigo;
  error.code = codigo;
  error.detalhes = detalhes;
  return error;
}

/**
 * Destaxa não tem fallback silencioso:
 * - ambiente ausente/"simulacao" → adapter simulado (nunca o real);
 * - homologacao/producao → DestaxaRealAdapter, ou erro explícito se indisponível;
 * - qualquer outro valor → erro explícito.
 */
function criarAdapterDestaxa(registro, opcoes = {}) {
  const ambiente = String(registro.ambiente || 'simulacao').trim().toLowerCase();

  if (ambiente === 'simulacao') {
    return DestaxaAdapter(registro);
  }

  if (!AMBIENTES_DESTAXA_REAL.has(ambiente)) {
    throw erroAdapterDestaxa(
      'DESTAXA_AMBIENTE_INVALIDO',
      `Ambiente TEF Destaxa inválido: "${registro.ambiente}"`,
      { ambiente: registro.ambiente }
    );
  }

  const verificar = opcoes.verificarDisponibilidadeReal
    || ((cfg) => DestaxaRealAdapter.verificarDisponibilidade(cfg));
  const disponibilidade = verificar(registro);
  if (!disponibilidade || disponibilidade.disponivel !== true) {
    throw erroAdapterDestaxa(
      'DESTAXA_REAL_ADAPTER_INDISPONIVEL',
      `Ambiente "${ambiente}" exige DestaxaRealAdapter, mas ele está indisponível: ${disponibilidade?.mensagem || 'motivo não informado'}`,
      { ambiente, motivo: disponibilidade?.codigo || null, dllPath: disponibilidade?.dllPath || null }
    );
  }

  return new DestaxaRealAdapter(registro, opcoes.adapterOpcoes || {});
}

function erroAdapterProvedor(codigo, mensagem, detalhes = {}) {
  const error = new Error(mensagem);
  error.codigo = codigo;
  error.code = codigo;
  error.detalhes = detalhes;
  return error;
}

function criarAdapter(registro, opcoes = {}) {
  if (!registro) {
    throw new Error('TEF não configurado');
  }

  const provedor = normalizarProvedor(registro.provedor || registro.tefProvedor);
  if (!provedor) {
    throw erroAdapterProvedor(
      'TEF_PROVEDOR_NAO_CONFIGURADO',
      'Provedor TEF não configurado. Salve um provedor na tela oficial antes de operar.'
    );
  }

  const ambiente = registro.ambiente || registro.tefAmbiente;
  const usarReal = ambienteUsaMiddlewareReal(ambiente);
  const registroNormalizado = {
    ...registro,
    provedor,
    ambiente
  };

  if (provedor === 'sitef') {
    if (usarReal) {
      if (!SitefRealAdapter.podeUsarModoReal()) {
        throw erroAdapterProvedor(
          'SITEF_REAL_ADAPTER_INDISPONIVEL',
          `Ambiente "${ambiente}" exige adapter SiTef real, mas a DLL/middleware não está disponível.`,
          { ambiente, provedor }
        );
      }
      return new SitefRealAdapter(registroNormalizado);
    }
    return new SitefAdapter(registroNormalizado);
  }

  if (provedor === 'paygo') {
    if (usarReal) {
      if (!PaygoRealAdapter.podeUsarModoReal()) {
        throw erroAdapterProvedor(
          'PAYGO_REAL_ADAPTER_INDISPONIVEL',
          `Ambiente "${ambiente}" exige adapter PayGo real, mas a DLL/middleware não está disponível.`,
          { ambiente, provedor }
        );
      }
      return new PaygoRealAdapter(registroNormalizado);
    }
    return new PaygoAdapter(registroNormalizado);
  }

  if (provedor === 'destaxa') {
    return criarAdapterDestaxa(registroNormalizado, opcoes);
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

  return new Gateway(registroNormalizado);
}

/**
 * Fonte oficial: tefConfigService → registro coerente para a fábrica.
 * Não inventa provedor Rede quando a linha ainda não existe.
 */
async function obterAdapter(opcoes = {}) {
  const tefConfigService = require('./tefConfigService');
  const tefConfigRepository = require('../../repositories/tefConfigRepository');
  const registroDb = await tefConfigRepository.buscarConfiguracaoPrincipal();
  if (!registroDb) {
    throw new Error('TEF não configurado');
  }
  const config = await tefConfigService.obterConfiguracao();
  if (config._defaultsAplicados) {
    throw new Error('TEF não configurado');
  }
  const registro = {
    ...registroDb,
    ...tefConfigService.configParaRegistroAdapter(config)
  };
  return criarAdapter(registro, opcoes);
}

module.exports = {
  obterAdapter,
  criarAdapter,
  criarAdapterDestaxa,
  ambienteUsaMiddlewareReal,
  provedorReconhecido,
  PROVEDORES
};
