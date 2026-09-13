/**
 * CentralConfiguracaoRepository — Persistência KV da configuração enterprise (RC4).
 * Reutiliza a tabela central_entradas_config.
 *
 * @module motores/central-entradas/repositories/CentralConfiguracaoRepository
 */

const CentralConfigRepository = require('./CentralConfigRepository');

/**
 * Defaults oficiais da Central (operação).
 *
 * RC3.1 — Ambiente SEFAZ e UF emitente NÃO vivem aqui.
 * Fonte oficial: Configurações Avançadas → getFiscalConfig() → fiscal_ambiente / fiscal_uf_*.
 *
 * Endpoints SOAP DF-e NÃO vivem aqui — exclusivos do UrlResolver (Plataforma Fiscal).
 * Chaves sefaz_url_dfe_* permanecem vazias/legado de schema (não usadas no SOAP).
 *
 * Chaves legadas central_ambiente / central_uf / central_codigo_uf (se existirem no DB)
 * são ignoradas pelo CentralConfiguracaoService e não são mais semeadas.
 */
const DEFAULTS = Object.freeze([
  ['sefaz_url_dfe_producao', '', 'string', 'DEPRECATED — endpoint DF-e via UrlResolver (Plataforma Fiscal)'],
  ['sefaz_url_dfe_homologacao', '', 'string', 'DEPRECATED — endpoint DF-e via UrlResolver (Plataforma Fiscal)'],
  ['sefaz_url_consulta_chave_producao', '', 'string', 'URL Consulta por chave (preparação)'],
  ['sefaz_url_consulta_chave_homologacao', '', 'string', 'URL Consulta por chave homologação (preparação)'],
  ['sefaz_url_manifestacao_producao', '', 'string', 'URL Manifestação (preparação futura)'],
  ['sefaz_url_manifestacao_homologacao', '', 'string', 'URL Manifestação homologação (preparação futura)'],
  ['sefaz_versao_servico', '1.01', 'string', 'Versão do serviço DF-e'],
  ['sefaz_timeout_ms', '90000', 'number', 'Timeout SOAP SEFAZ (ms)'],
  ['sefaz_max_tentativas', '2', 'number', 'Máximo de tentativas SOAP'],
  ['sefaz_intervalo_tentativas_ms', '3000', 'number', 'Intervalo entre tentativas (ms)'],
  ['manifestacao_destinatario_politica', 'MANUAL', 'string', 'Política: MANUAL, AUTOMATICA_CIENCIA ou CONFIRMAR_OPERADOR'],
  ['sync_reprocessamento_automatico', 'true', 'boolean', 'Reprocessar pendências após sync'],
  ['http_timeout_ms', '90000', 'number', 'Timeout HTTP avançado (ms)'],
  ['http_retry', '2', 'number', 'Retries HTTP avançados'],
  ['proxy_habilitado', 'false', 'boolean', 'Proxy (estrutura — não funcional)'],
  ['proxy_url', '', 'string', 'URL do proxy (estrutura)'],
  ['log_detalhado', 'false', 'boolean', 'Log detalhado da Central'],
  ['modo_debug', 'false', 'boolean', 'Modo debug da Central'],
  ['recuperacao_xml_ativa', 'true', 'boolean', 'RC3.7.5 — Recuperação automática de XML (procNFe)'],
  ['recuperacao_xml_intervalo_minutos', '60', 'number', 'RC3.7.5 — Intervalo do scheduler (min): 30|60|120|360|1440'],
  ['recuperacao_xml_max_tentativas', '48', 'number', 'RC3.7.5 — Máximo de tentativas consChNFe por documento'],
  ['recuperacao_xml_max_dias_monitoramento', '30', 'number', 'RC3.7.5 — Dias máximos em monitoramento'],
  ['recuperacao_xml_lote_por_ciclo', '5', 'number', 'RC3.7.5 — Documentos consultados por ciclo']
]);

/** Chaves legadas — não semear; serviço ignora leitura/gravação. */
const CHAVES_FISCAIS_LEGADAS = Object.freeze([
  'central_ambiente',
  'central_uf',
  'central_codigo_uf'
]);

class CentralConfiguracaoRepository extends CentralConfigRepository {
  getDescricao() {
    return 'Configuração Enterprise da Central Inteligente de Entradas (RC4)';
  }

  /**
   * Garante chaves RC4 com INSERT OR IGNORE sem sobrescrever valores do usuário.
   * @returns {Promise<void>}
   */
  async ensureDefaults() {
    const sql = this._obterSql();
    await sql.whenReady();

    for (const [chave, valor, tipo, descricao] of DEFAULTS) {
      await sql.run(
        `INSERT OR IGNORE INTO ${CentralConfigRepository.TABELA}
          (chave, valor, tipo, descricao) VALUES (?, ?, ?, ?)`,
        [chave, valor, tipo, descricao]
      );
    }
  }

  /**
   * @returns {ReadonlyArray<[string, string, string, string]>}
   */
  static get DEFAULTS() {
    return DEFAULTS;
  }

  /**
   * @returns {ReadonlyArray<string>}
   */
  static get CHAVES_FISCAIS_LEGADAS() {
    return CHAVES_FISCAIS_LEGADAS;
  }
}

module.exports = CentralConfiguracaoRepository;
