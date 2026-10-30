'use strict';

/**
 * MRT-02 — Binding compatível com o TEF atual (singleton por instalação).
 * Não cria Registry; espelha tefFactory.obterAdapter → LIMIT 1.
 */

async function carregarBindingSingleton(dependencias = {}) {
  const tefConfigRepository = dependencias.tefConfigRepository
    || require('../../../repositories/tefConfigRepository');
  const tefConfigService = dependencias.tefConfigService
    || require('../tefConfigService');

  const registroDb = await tefConfigRepository.buscarConfiguracaoPrincipal();
  if (!registroDb) {
    return {
      ok: false,
      mensagem: 'TEF não configurado (singleton ausente)',
      adapterBinding: null,
      config: null
    };
  }

  let config;
  try {
    config = await tefConfigService.obterConfiguracao();
  } catch (error) {
    return {
      ok: false,
      mensagem: `Falha ao ler configuração TEF: ${error.message}`,
      adapterBinding: null,
      config: null
    };
  }

  if (config && config._defaultsAplicados) {
    return {
      ok: false,
      mensagem: 'TEF não configurado (defaults sem linha persistida)',
      adapterBinding: null,
      config
    };
  }

  const registro = {
    ...registroDb,
    ...(typeof tefConfigService.configParaRegistroAdapter === 'function'
      ? tefConfigService.configParaRegistroAdapter(config)
      : {})
  };

  return {
    ok: true,
    mensagem: 'Fallback singleton — comportamento TEF atual preservado',
    config: registroDb,
    adapterBinding: {
      fonte: 'tef_configuracao_singleton',
      modo: 'COMPAT_SINGLETON',
      registro,
      executionMode: String(registro.provedor || registro.tefProvedor || '').toLowerCase() === 'destaxa'
        ? 'native-host'
        : 'adapter-default',
      // Extensão futura: terminalTefId / dispositivoId preenchidos pelo Registry
      terminalTefId: null,
      dispositivoId: null,
      pinpadPortaCom: registro.portaCom || registro.porta_com || null
    }
  };
}

module.exports = {
  carregarBindingSingleton
};
