/**
 * CentralConfiguracaoController — HTTP da Configuração Enterprise (RC4).
 *
 * @module motores/central-entradas/controllers/CentralConfiguracaoController
 */

const CentralConfiguracaoService = require('../services/CentralConfiguracaoService');
const { logCentralErro } = require('../utils/centralLog');

class CentralConfiguracaoController {
  /**
   * @param {Object} [deps]
   */
  constructor(deps = {}) {
    /** @private */
    this._service = deps.configuracaoService ?? new CentralConfiguracaoService();
    /** @private */
    this._orchestrator = deps.orchestrator || null;
  }

  /** @private */
  _orch() {
    return this._orchestrator || require('../CentralEntradasOrchestrator');
  }

  async obter(req, res) {
    try {
      const painel = await this._service.obterPainelCompleto();
      return res.json(painel);
    } catch (error) {
      logCentralErro('CONFIG', error);
      return res.status(500).json({
        sucesso: false,
        mensagemAmigavel: 'Não foi possível carregar a configuração da Central.',
        error: error.message
      });
    }
  }

  async atualizar(req, res) {
    try {
      const painel = await this._service.atualizar(req.body || {});
      const { emitirEvento, TIPOS_EVENTO } = require('../utils/centralEventosEmitter');
      await emitirEvento({
        tipo: TIPOS_EVENTO.CONFIG_ALTERADA,
        origem: 'api',
        descricao: 'Configuração Enterprise da Central atualizada',
        resultado: 'sucesso',
        sucesso: true,
        usuarioId: req.user?.id || null,
        detalhe: { campos: Object.keys(req.body || {}) }
      });
      try {
        await this._orch()._obterSyncBackground?.().reiniciar?.();
      } catch {
        const bg = require('../services/CentralSyncBackgroundService');
        if (typeof bg.reiniciar === 'function') await bg.reiniciar();
      }
      return res.json(painel);
    } catch (error) {
      logCentralErro('CONFIG', error);
      return res.status(400).json({
        sucesso: false,
        mensagemAmigavel: error.message || 'Falha ao salvar configuração.',
        error: error.message
      });
    }
  }

  async restaurarPadrao(req, res) {
    try {
      const painel = await this._service.restaurarPadrao(req.body || {});
      return res.json(painel);
    } catch (error) {
      return res.status(500).json({ sucesso: false, error: error.message });
    }
  }

  async testarSefaz(req, res) {
    try {
      const resultado = await this._orch().testarSefazDiagnostico();
      return res.json(resultado);
    } catch (error) {
      return res.status(422).json({
        sucesso: false,
        mensagemAmigavel: error.message,
        error: error.message
      });
    }
  }

  async testarCertificado(req, res) {
    try {
      const resultado = await this._orch().testarCertificadoDiagnostico();
      return res.json(resultado);
    } catch (error) {
      return res.status(422).json({
        sucesso: false,
        mensagemAmigavel: error.message,
        error: error.message
      });
    }
  }

  async health(req, res) {
    try {
      const resultado = await this._orch().executarHealthCheckDiagnostico();
      return res.json(resultado);
    } catch (error) {
      return res.status(500).json({ sucesso: false, error: error.message });
    }
  }

  async limparCache(req, res) {
    try {
      const resultado = this._orch().limparCacheDiagnostico();
      return res.json(resultado);
    } catch (error) {
      return res.status(500).json({ sucesso: false, error: error.message });
    }
  }
}

module.exports = CentralConfiguracaoController;
