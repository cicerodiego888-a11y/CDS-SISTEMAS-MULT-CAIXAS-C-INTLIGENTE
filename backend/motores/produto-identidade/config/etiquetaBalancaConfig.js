/**
 * Resolve layout de etiqueta oficial via Motor de Equipamentos (Sprint EQUIPAMENTOS 02).
 * Aceita deps.db para testes / resolução isolada.
 */

const { criarDbHelpers, resolverDb } = require('../../miip/repositories/dbHelpers');
const { CONFIG_CHAVE_STRATEGY, LAYOUT_DEFAULT, LAYOUT_IDS } = require('../layouts/layoutIds');
const { obterPreset, ALIAS_LAYOUT_IDS } = require('../../equipamentos/layouts/presetsEtiqueta');
const { normalizarLayoutEtiqueta } = require('../../equipamentos/layouts/LayoutEtiquetaNormalizer');
const CHAVE_LAYOUT = 'etiqueta.layout';

function anexarMetaId(layout, metaId) {
  if (!layout) return null;
  return {
    ...layout,
    _metaLayoutId: metaId || layout.preset_id || LAYOUT_DEFAULT
  };
}

function layoutDeStrategy(strategyId) {
  const raw = String(strategyId || '').trim();
  if (!raw) return null;
  const preset = obterPreset(raw);
  if (!preset) return null;
  // Preserva id legado (toledo_prix4_valor_65) para metas/testes
  const metaId = ALIAS_LAYOUT_IDS[raw] ? raw : (preset.preset_id || raw);
  return anexarMetaId(preset, metaId);
}

/**
 * @param {Object} [contexto]
 * @param {Object} [deps]
 * @returns {Promise<Object>} layout normalizado
 */
async function resolverLayoutConfig(contexto = {}, deps = {}) {
  if (contexto.layoutConfig && typeof contexto.layoutConfig === 'object') {
    const norm = normalizarLayoutEtiqueta(contexto.layoutConfig);
    if (norm.ok) {
      return anexarMetaId(norm.layout, contexto.layoutConfig._metaLayoutId || norm.layout.preset_id);
    }
  }

  if (contexto.layoutStrategy) {
    const fromStrategy = layoutDeStrategy(contexto.layoutStrategy);
    if (fromStrategy) return fromStrategy;
  }

  const equipamentoId = contexto.equipamentoId != null
    ? Number(contexto.equipamentoId)
    : null;

  if (equipamentoId && Number.isFinite(equipamentoId) && equipamentoId > 0) {
    const db = deps.db != null ? deps.db : resolverDb(null);
    if (db) {
      const helpers = criarDbHelpers(db);
      await helpers.whenReady();
      try {
        const rowLayout = await helpers.get(
          `SELECT valor FROM equipamentos_configuracoes
           WHERE equipamento_id = ? AND chave = ?
           LIMIT 1`,
          [equipamentoId, CHAVE_LAYOUT]
        );
        if (rowLayout?.valor) {
          let parsed = rowLayout.valor;
          if (typeof parsed === 'string') {
            try { parsed = JSON.parse(parsed); } catch (_) { parsed = null; }
          }
          if (parsed) {
            const norm = normalizarLayoutEtiqueta(parsed);
            if (norm.ok) return anexarMetaId(norm.layout, norm.layout.preset_id);
          }
        }

        const rowStrategy = await helpers.get(
          `SELECT valor FROM equipamentos_configuracoes
           WHERE equipamento_id = ? AND chave = ?
           LIMIT 1`,
          [equipamentoId, CONFIG_CHAVE_STRATEGY]
        );
        if (rowStrategy?.valor) {
          const fromStrategy = layoutDeStrategy(String(rowStrategy.valor).trim());
          if (fromStrategy) return fromStrategy;
        }
      } catch {
        // tabela ausente
      }
    }

    if (!deps.db) {
      try {
        const layoutEtiquetaService = require('../../equipamentos/services/LayoutEtiquetaService');
        const doEq = await layoutEtiquetaService.obterLayoutEquipamento(equipamentoId);
        if (doEq) return anexarMetaId(doEq, doEq.preset_id);
      } catch (_) { /* ignore */ }
    }
  }

  if (!deps.db) {
    try {
      const layoutEtiquetaService = deps.layoutService
        || require('../../equipamentos/services/LayoutEtiquetaService');
      const ativo = await layoutEtiquetaService.obterLayoutAtivo();
      if (ativo) return anexarMetaId(ativo, ativo.preset_id);
    } catch (_) { /* ignore */ }
  }

  return anexarMetaId(obterPreset(LAYOUT_DEFAULT), LAYOUT_DEFAULT);
}

/**
 * Compatibilidade: devolve layoutId (preset / strategy legado).
 */
async function resolverLayoutId(contexto = {}, deps = {}) {
  if (contexto.layoutStrategy && String(contexto.layoutStrategy).trim()) {
    return String(contexto.layoutStrategy).trim();
  }

  const layout = await resolverLayoutConfig(contexto, deps);
  return layout?._metaLayoutId || layout?.preset_id || LAYOUT_DEFAULT;
}

module.exports = {
  resolverLayoutConfig,
  resolverLayoutId,
  CONFIG_CHAVE_STRATEGY,
  LAYOUT_DEFAULT,
  LAYOUT_IDS
};
