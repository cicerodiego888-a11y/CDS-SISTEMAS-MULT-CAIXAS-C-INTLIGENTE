/**
 * Persistência leve da política operacional (Sprint 5).
 * Usa central_entradas_config — não altera motores.
 *
 * @module services/fiscal/central/CentralOperationConfigStore
 */
'use strict';

const { ModoOperacao, MODO_PADRAO, normalizarModo } = require('./CentralOperationModes');
const { FLAGS_PADRAO } = require('./CentralOperationPolicy');

const CHAVES = Object.freeze({
  MODO: 'central_modo_operacao',
  AUTO_SYNC: 'central_auto_sincronizacao',
  AUTO_XML: 'central_auto_recuperacao_xml',
  AUTO_RETRY: 'central_auto_retry',
  AUTO_RECON: 'central_auto_reconcilicao'
});

function defaultsKv() {
  return Object.freeze([
    [CHAVES.MODO, MODO_PADRAO, 'string', 'Sprint 5 — Modo ASSISTIDO|AUTOMATICO'],
    [CHAVES.AUTO_SYNC, 'true', 'boolean', 'Sprint 5 — Sincronização automática (SAFE)'],
    [CHAVES.AUTO_XML, 'true', 'boolean', 'Sprint 5 — Recuperação XML automática (SAFE)'],
    [CHAVES.AUTO_RETRY, 'true', 'boolean', 'Sprint 5 — Retry recuperável automático'],
    [CHAVES.AUTO_RECON, 'true', 'boolean', 'Sprint 5 — Reconciliação automática']
  ]);
}

function enriquecerConfig(cfg) {
  const modo = normalizarModo(cfg.modo);
  return {
    ...cfg,
    modo,
    flags: { ...FLAGS_PADRAO, ...(cfg.flags || {}) },
    labels: {
      modo: modo === ModoOperacao.AUTOMATICO ? 'Automático — ações seguras' : 'Assistido',
      explicacaoAssistido: 'A Central identifica situações e solicita confirmação antes de executar ações operacionais.',
      explicacaoAutomatico: 'A Central executa automaticamente ações classificadas como seguras, sempre respeitando as proteções da SEFAZ e as regras do sistema.'
    },
    protecoesSempreAtivas: [
      'SEFAZQueryGate',
      'RateLimiter',
      'Cooldown',
      'CircuitBreaker',
      'Lock'
    ]
  };
}

class CentralOperationConfigStore {
  constructor(deps = {}) {
    this._repository = deps.configRepository || null;
    /** cache em memória por identidade CNPJ|ambiente (override futuro) */
    this._porEmpresa = new Map();
  }

  static chaveEmpresa(cnpj, ambiente) {
    const c = String(cnpj || '').replace(/\D/g, '');
    const a = Number(ambiente) === 1 ? 1 : 2;
    return c ? `${c}|${a}` : '*';
  }

  async obter(cnpj = null, ambiente = null) {
    const key = CentralOperationConfigStore.chaveEmpresa(cnpj, ambiente);
    if (this._porEmpresa.has(key)) {
      return enriquecerConfig({ ...this._porEmpresa.get(key) });
    }
    const globalKey = '*';
    if (key !== globalKey && this._porEmpresa.has(globalKey)) {
      const base = this._porEmpresa.get(globalKey);
      return enriquecerConfig({
        ...base,
        cnpj: cnpj ? String(cnpj).replace(/\D/g, '') : null,
        ambiente: ambiente != null ? (Number(ambiente) === 1 ? 1 : 2) : null
      });
    }

    let modo = MODO_PADRAO;
    const flags = { ...FLAGS_PADRAO };
    if (this._repository) {
      try {
        if (typeof this._repository.ensureDefaults === 'function') {
          await this._repository.ensureDefaults();
        }
        const mapa = await this._lerMapa();
        modo = normalizarModo(mapa[CHAVES.MODO]);
        flags.sincronizacao = mapa[CHAVES.AUTO_SYNC] !== false && mapa[CHAVES.AUTO_SYNC] !== 'false';
        flags.recuperacaoXml = mapa[CHAVES.AUTO_XML] !== false && mapa[CHAVES.AUTO_XML] !== 'false';
        flags.retry = mapa[CHAVES.AUTO_RETRY] !== false && mapa[CHAVES.AUTO_RETRY] !== 'false';
        flags.reconcilicao = mapa[CHAVES.AUTO_RECON] !== false && mapa[CHAVES.AUTO_RECON] !== 'false';
      } catch { /* defaults */ }
    }

    const cfg = enriquecerConfig({
      modo,
      flags,
      cnpj: cnpj ? String(cnpj).replace(/\D/g, '') : null,
      ambiente: ambiente != null ? (Number(ambiente) === 1 ? 1 : 2) : null
    });
    return cfg;
  }

  async salvar(patch = {}, cnpj = null, ambiente = null) {
    const atual = await this.obter(cnpj, ambiente);
    const next = {
      modo: normalizarModo(patch.modo ?? patch.modoOperacao ?? atual.modo),
      flags: {
        ...atual.flags,
        ...(patch.flags || patch.acoesAutomaticas || {})
      },
      cnpj: cnpj ? String(cnpj).replace(/\D/g, '') : atual.cnpj,
      ambiente: ambiente != null ? (Number(ambiente) === 1 ? 1 : 2) : atual.ambiente
    };

    if (this._repository?.salvar) {
      await this._repository.salvar(CHAVES.MODO, next.modo, 'string');
      await this._repository.salvar(CHAVES.AUTO_SYNC, next.flags.sincronizacao !== false, 'boolean');
      await this._repository.salvar(CHAVES.AUTO_XML, next.flags.recuperacaoXml !== false, 'boolean');
      await this._repository.salvar(CHAVES.AUTO_RETRY, next.flags.retry !== false, 'boolean');
      await this._repository.salvar(CHAVES.AUTO_RECON, next.flags.reconcilicao !== false, 'boolean');
    }

    const key = CentralOperationConfigStore.chaveEmpresa(cnpj, ambiente);
    this._porEmpresa.set(key, next);
    return this.obter(cnpj, ambiente);
  }

  /** Override em memória por empresa (testes / futuro multi-CNPJ). */
  definirParaEmpresa(cnpj, ambiente, config) {
    const key = CentralOperationConfigStore.chaveEmpresa(cnpj, ambiente);
    this._porEmpresa.set(key, {
      modo: normalizarModo(config.modo),
      flags: { ...FLAGS_PADRAO, ...(config.flags || {}) },
      cnpj: String(cnpj || '').replace(/\D/g, ''),
      ambiente: Number(ambiente) === 1 ? 1 : 2
    });
  }

  /** @private */
  async _lerMapa() {
    const mapa = {};
    if (!this._repository) return mapa;
    if (typeof this._repository.listarTodas === 'function') {
      const regs = await this._repository.listarTodas();
      for (const reg of regs || []) {
        mapa[reg.chave] = this._repository.parseValor
          ? this._repository.parseValor(reg)
          : reg.valor;
      }
      return mapa;
    }
    for (const chave of Object.values(CHAVES)) {
      const reg = await this._repository.buscarPorChave?.(chave);
      if (reg) {
        mapa[chave] = this._repository.parseValor
          ? this._repository.parseValor(reg)
          : reg.valor;
      }
    }
    return mapa;
  }
}

module.exports = CentralOperationConfigStore;
module.exports.CHAVES = CHAVES;
module.exports.defaultsKv = defaultsKv;
