/**
 * MiipPipelineConfigLoader — Carrega configuração do MIIP para o Pipeline.
 *
 * Sprint 3: lê `miip_configuracoes` quando repository disponível — sem regra de negócio.
 *
 * @module motores/miip/core/MiipPipelineConfigLoader
 */

/**
 * @param {import('../repositories/MiipConfiguracoesRepository')|null} [configuracoesRepository]
 * @returns {Function}
 */
function criarCarregadorConfiguracao(configuracoesRepository = null) {
  return async (_context) => {
    const config = {
      usarMiip: true,
      motoresAtivos: [],
      timeoutMotorMs: 500,
      versao: '1.0.0-pipeline-sprint3'
    };

    if (!configuracoesRepository) return config;

    try {
      const registro = await configuracoesRepository.buscarPorChave('usarMiip');
      if (registro?.valor != null) {
        const valor = String(registro.valor).trim().toLowerCase();
        config.usarMiip = !(valor === 'false' || valor === '0' || valor === 'no');
      }
    } catch {
      // fail-safe: defaults em memória
    }

    return config;
  };
}

module.exports = {
  criarCarregadorConfiguracao
};
