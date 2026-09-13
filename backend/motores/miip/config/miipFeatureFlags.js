/**
 * MiipFeatureFlags — Feature flags do MIIP.
 *
 * Sprint 5 Integração: controle de `usarMiip` para rollback imediato ao legado.
 *
 * Prioridade de resolução:
 * 1. Override em memória (`definirUsarMiip`)
 * 2. Variável de ambiente `MIIP_USAR_MIIP`
 * 3. `miip_configuracoes.usarMiip` (cache async)
 * 4. Default em `miip.defaults.json` (true)
 *
 * @module motores/miip/config/miipFeatureFlags
 */

const path = require('path');
const fs = require('fs');

const DEFAULTS_PATH = path.join(__dirname, 'miip.defaults.json');

/**
 * @returns {{ usarMiip: boolean }}
 */
function carregarDefaultsArquivo() {
  try {
    const bruto = fs.readFileSync(DEFAULTS_PATH, 'utf8');
    const json = JSON.parse(bruto);
    return {
      usarMiip: json.usarMiip !== false,
      usarMiipImportacaoXML: json.usarMiipImportacaoXML !== false
    };
  } catch {
    return { usarMiip: true, usarMiipImportacaoXML: true };
  }
}

class MiipFeatureFlags {
  constructor() {
    const arquivo = carregarDefaultsArquivo();
    /** @private */
    this._usarMiip = arquivo.usarMiip;
    /** @private */
    this._usarMiipImportacaoXML = arquivo.usarMiipImportacaoXML;
    /** @private */
    this._overrideManual = false;
    /** @private */
    this._overrideImportacaoManual = false;
    /** @private */
    this._sincronizadoBanco = false;
  }

  /**
   * Aplica override de ambiente (síncrono).
   *
   * @private
   */
  _aplicarAmbiente() {
    const env = String(process.env.MIIP_USAR_MIIP ?? '').trim().toLowerCase();
    if (env === 'false' || env === '0' || env === 'no') {
      this._usarMiip = false;
    } else if (env === 'true' || env === '1' || env === 'yes') {
      this._usarMiip = true;
    }

    const envImport = String(process.env.MIIP_USAR_MIIP_IMPORTACAO_XML ?? '').trim().toLowerCase();
    if (envImport === 'false' || envImport === '0' || envImport === 'no') {
      this._usarMiipImportacaoXML = false;
    } else if (envImport === 'true' || envImport === '1' || envImport === 'yes') {
      this._usarMiipImportacaoXML = true;
    }
  }

  /**
   * Indica se o MIIP está habilitado para integração ERP.
   *
   * @returns {boolean}
   */
  estaHabilitado() {
    if (!this._overrideManual) {
      this._aplicarAmbiente();
    }
    return Boolean(this._usarMiip);
  }

  /**
   * Indica se a importação XML deve usar o MIIP (Sprint 6A).
   * Requer `usarMiip` e `usarMiipImportacaoXML` habilitados.
   *
   * @returns {boolean}
   */
  estaImportacaoXmlHabilitada() {
    if (!this._overrideImportacaoManual) {
      this._aplicarAmbiente();
    }
    return Boolean(this._usarMiip && this._usarMiipImportacaoXML);
  }

  /**
   * @returns {boolean}
   */
  obterUsarMiipImportacaoXML() {
    if (!this._overrideImportacaoManual) {
      this._aplicarAmbiente();
    }
    return Boolean(this._usarMiipImportacaoXML);
  }

  /**
   * Define flag em runtime (testes ou painel futuro).
   *
   * @param {boolean} valor
   * @returns {void}
   */
  definirUsarMiip(valor) {
    this._usarMiip = Boolean(valor);
    this._overrideManual = true;
  }

  /**
   * Define flag de importação XML em runtime (testes ou painel futuro).
   *
   * @param {boolean} valor
   * @returns {void}
   */
  definirUsarMiipImportacaoXML(valor) {
    this._usarMiipImportacaoXML = Boolean(valor);
    this._overrideImportacaoManual = true;
  }

  /**
   * Restaura leitura de ambiente/defaults (testes).
   *
   * @returns {void}
   */
  reiniciar() {
    const arquivo = carregarDefaultsArquivo();
    this._usarMiip = arquivo.usarMiip;
    this._usarMiipImportacaoXML = arquivo.usarMiipImportacaoXML;
    this._overrideManual = false;
    this._overrideImportacaoManual = false;
    this._sincronizadoBanco = false;
    this._aplicarAmbiente();
  }

  /**
   * Sincroniza `usarMiip` a partir de `miip_configuracoes`.
   *
   * @param {import('../repositories/MiipConfiguracoesRepository')} configRepository
   * @returns {Promise<boolean>}
   */
  async sincronizarDoBanco(configRepository) {
    if (!configRepository || typeof configRepository.buscarPorChave !== 'function') {
      return this.estaHabilitado();
    }

    try {
      const registro = await configRepository.buscarPorChave('usarMiip');
      if (registro && !this._overrideManual) {
        const valor = configRepository.parseValor(registro);
        this._usarMiip = Boolean(valor);
      }

      const registroImport = await configRepository.buscarPorChave('usarMiipImportacaoXML');
      if (registroImport && !this._overrideImportacaoManual) {
        const valorImport = configRepository.parseValor(registroImport);
        this._usarMiipImportacaoXML = Boolean(valorImport);
      }

      this._sincronizadoBanco = true;
    } catch {
      // Mantém valor atual — fail-safe habilitado
    }

    return this.estaHabilitado();
  }

  /**
   * @returns {{ usarMiip: boolean, sincronizadoBanco: boolean }}
   */
  obterEstado() {
    return {
      usarMiip: this.estaHabilitado(),
      usarMiipImportacaoXML: this.obterUsarMiipImportacaoXML(),
      importacaoXmlHabilitada: this.estaImportacaoXmlHabilitada(),
      sincronizadoBanco: this._sincronizadoBanco
    };
  }
}

const instancia = new MiipFeatureFlags();

module.exports = instancia;
module.exports.MiipFeatureFlags = MiipFeatureFlags;
module.exports.CHAVE_USAR_MIIP = 'usarMiip';
module.exports.CHAVE_USAR_MIIP_IMPORTACAO_XML = 'usarMiipImportacaoXML';
