/**
 * MiipOrchestrator — Delegação ao MiipPipeline (cérebro do MIIP).
 *
 * Sprint 3: sem lógica duplicada — todo fluxo passa pelo Pipeline.
 *
 * @class MiipOrchestrator
 */

const MiipContext = require('./core/MiipContext');
const { criarPipelinePadrao } = require('./core/MiipPipelineFactory');

class MiipOrchestrator {
  /**
   * @param {Object} [deps]
   * @param {import('./core/MiipPipeline')} [deps.pipeline]
   * @param {import('./repositories/MiipConfiguracoesRepository')|null} [deps.configuracoesRepository]
   */
  constructor(deps = {}) {
    /** @private */
    this._pipeline = deps.pipeline ?? criarPipelinePadrao({
      configuracoesRepository: deps.configuracoesRepository ?? null,
      db: deps.db ?? null
    });
  }

  /**
   * Executa identificação via Pipeline.
   *
   * @param {import('./contracts/ItemIdentificavelDTO')|Object} item
   * @param {import('./core/MiipContext')|Object} [contexto]
   * @returns {Promise<import('./core/MiipResult')>}
   */
  async executar(item, contexto) {
    const contextoNormalizado = contexto instanceof MiipContext
      ? contexto
      : MiipContext.agora(contexto || {});

    const response = await this._pipeline.executar({
      item,
      contexto: contextoNormalizado
    });

    if (!response.sucesso || !response.resultado) {
      throw new Error(response.erro || 'Pipeline MIIP não retornou resultado');
    }

    return response.resultado;
  }

  /**
   * @returns {{ pronto: boolean, versao: string, componente: string }}
   */
  healthCheck() {
    return {
      pronto: true,
      versao: '1.0.0-rc1',
      componente: 'MiipOrchestrator',
      pipeline: this._pipeline.healthCheck()
    };
  }
}

const instancia = new MiipOrchestrator();

module.exports = instancia;
module.exports.MiipOrchestrator = MiipOrchestrator;
