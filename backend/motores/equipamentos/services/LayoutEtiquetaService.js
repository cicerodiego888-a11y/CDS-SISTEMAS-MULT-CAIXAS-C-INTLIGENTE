/**
 * LayoutEtiquetaService — fonte oficial de configuração de etiquetas (Motor Equipamentos).
 * Persistência em equipamentos_configuracoes.
 */

const db = require('../../../database');
const { listarPresets, obterPreset } = require('../layouts/presetsEtiqueta');
const { normalizarLayoutEtiqueta } = require('../layouts/LayoutEtiquetaNormalizer');
const { parseEtiquetaComLayout } = require('../layouts/ConfiguravelEtiquetaParser');

const CHAVE_LAYOUT = 'etiqueta.layout';
const CHAVE_STRATEGY_LEGADO = 'etiqueta.strategy';
/** Layout ativo oficial do PDV (tabela configuracoes — evita FK de equipamentos) */
const CHAVE_LAYOUT_ATIVO_GLOBAL = 'equipamentos.etiqueta.layout_ativo';

function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(err) {
      if (err) return reject(err);
      resolve({ lastID: this.lastID, changes: this.changes });
    });
  });
}

function get(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) return reject(err);
      resolve(row || null);
    });
  });
}

function whenReady() {
  return new Promise((resolve, reject) => {
    if (typeof db.whenReady === 'function') {
      db.whenReady((err) => (err ? reject(err) : resolve()));
      return;
    }
    resolve();
  });
}

function parseJsonSafe(texto) {
  if (!texto) return null;
  if (typeof texto === 'object') return texto;
  try {
    return JSON.parse(String(texto));
  } catch (_) {
    return null;
  }
}

class LayoutEtiquetaService {
  listarPresets() {
    return listarPresets();
  }

  obterPreset(presetId) {
    return obterPreset(presetId);
  }

  /**
   * Default seguro (sem regressão) quando nenhum layout está cadastrado.
   */
  obterLayoutDefault() {
    return obterPreset('legado_cds_valor_56');
  }

  async _upsertConfig(equipamentoId, chave, valor, descricao = null) {
    await whenReady();
    const existente = await get(
      `SELECT id FROM equipamentos_configuracoes
       WHERE equipamento_id = ? AND chave = ? LIMIT 1`,
      [equipamentoId, chave]
    );

    const valorStr = typeof valor === 'string' ? valor : JSON.stringify(valor);

    if (existente?.id) {
      await run(
        `UPDATE equipamentos_configuracoes
         SET valor = ?, descricao = COALESCE(?, descricao), updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [valorStr, descricao, existente.id]
      );
      return existente.id;
    }

    const ins = await run(
      `INSERT INTO equipamentos_configuracoes (equipamento_id, chave, valor, descricao)
       VALUES (?, ?, ?, ?)`,
      [equipamentoId, chave, valorStr, descricao]
    );
    return ins.lastID;
  }

  async _lerConfig(equipamentoId, chave) {
    await whenReady();
    try {
      const row = await get(
        `SELECT valor FROM equipamentos_configuracoes
         WHERE equipamento_id = ? AND chave = ? LIMIT 1`,
        [equipamentoId, chave]
      );
      return row?.valor ?? null;
    } catch (_) {
      return null;
    }
  }

  /**
   * Converte strategy legado (MIP Sprint 04) em layout configurável.
   */
  layoutAPartirDeStrategy(strategyId) {
    const preset = obterPreset(strategyId);
    if (preset) return preset;
    return null;
  }

  async obterLayoutEquipamento(equipamentoId) {
    const id = Number(equipamentoId);
    if (!Number.isFinite(id) || id <= 0) return null;

    const rawLayout = await this._lerConfig(id, CHAVE_LAYOUT);
    const parsed = parseJsonSafe(rawLayout);
    if (parsed) {
      const norm = normalizarLayoutEtiqueta(parsed);
      return norm.ok ? norm.layout : null;
    }

    const strategy = await this._lerConfig(id, CHAVE_STRATEGY_LEGADO);
    if (strategy) {
      return this.layoutAPartirDeStrategy(String(strategy).trim());
    }

    return null;
  }

  async salvarLayoutEquipamento(equipamentoId, layoutBruto, opcoes = {}) {
    const id = Number(equipamentoId);
    if (!Number.isFinite(id) || id <= 0) {
      throw Object.assign(new Error('equipamento_id inválido'), { statusCode: 400 });
    }

    const norm = normalizarLayoutEtiqueta(layoutBruto);
    if (!norm.ok) {
      throw Object.assign(new Error(norm.erro), { statusCode: 400 });
    }

    await this._upsertConfig(id, CHAVE_LAYOUT, norm.layout, 'Layout de etiqueta EAN-13');
    // Mantém strategy legado sincronizada para ferramentas antigas
    await this._upsertConfig(id, CHAVE_STRATEGY_LEGADO, norm.layout.preset_id, 'Strategy legado (alias)');

    if (opcoes.definirComoAtivo) {
      await this.definirLayoutAtivo(norm.layout, { equipamentoId: id });
    }

    return norm.layout;
  }

  async _lerConfigGlobal(chave) {
    await whenReady();
    try {
      const row = await get(
        `SELECT valor FROM configuracoes WHERE chave = ? LIMIT 1`,
        [chave]
      );
      return row?.valor ?? null;
    } catch (_) {
      return null;
    }
  }

  async _upsertConfigGlobal(chave, valor) {
    await whenReady();
    const valorStr = typeof valor === 'string' ? valor : JSON.stringify(valor);
    const existente = await get(
      `SELECT id FROM configuracoes WHERE chave = ? LIMIT 1`,
      [chave]
    );
    if (existente?.id) {
      await run(
        `UPDATE configuracoes SET valor = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        [valorStr, existente.id]
      );
      return existente.id;
    }
    const ins = await run(
      `INSERT INTO configuracoes (chave, valor) VALUES (?, ?)`,
      [chave, valorStr]
    );
    return ins.lastID;
  }

  async obterLayoutAtivo() {
    const raw = await this._lerConfigGlobal(CHAVE_LAYOUT_ATIVO_GLOBAL);
    const parsed = parseJsonSafe(raw);
    if (parsed) {
      const norm = normalizarLayoutEtiqueta(parsed);
      if (norm.ok) return norm.layout;
    }

    // Fallback: primeira balança ativa com layout cadastrado
    await whenReady();
    try {
      const row = await get(`
        SELECT c.valor
        FROM equipamentos_configuracoes c
        INNER JOIN equipamentos e ON e.id = c.equipamento_id
        WHERE c.chave = ?
          AND e.ativo = 1
          AND e.tipo = 'balanca'
        ORDER BY e.id ASC
        LIMIT 1
      `, [CHAVE_LAYOUT]);
      const fromEq = parseJsonSafe(row?.valor);
      if (fromEq) {
        const norm = normalizarLayoutEtiqueta(fromEq);
        if (norm.ok) return norm.layout;
      }
    } catch (_) {
      // tabela ausente em testes mínimos
    }

    // RC1: sem configuração cadastrada → null (não usa legado implícito)
    return null;
  }

  /**
   * Indica se existe layout oficial cadastrado (global ou balança ativa).
   */
  async temLayoutAtivoConfigurado() {
    return Boolean(await this.obterLayoutAtivo());
  }

  async definirLayoutAtivo(layoutBruto, meta = {}) {
    const norm = normalizarLayoutEtiqueta(layoutBruto);
    if (!norm.ok) {
      throw Object.assign(new Error(norm.erro), { statusCode: 400 });
    }

    const payload = {
      ...norm.layout,
      equipamento_origem_id: meta.equipamentoId != null ? Number(meta.equipamentoId) : null
    };

    await this._upsertConfigGlobal(CHAVE_LAYOUT_ATIVO_GLOBAL, payload);
    return norm.layout;
  }

  /**
   * Resolve config oficial para o parser (contexto PDV/MIP).
   */
  async resolverLayoutConfig(contexto = {}) {
    if (contexto.layoutConfig && typeof contexto.layoutConfig === 'object') {
      const norm = normalizarLayoutEtiqueta(contexto.layoutConfig);
      if (norm.ok) return norm.layout;
    }

    if (contexto.layoutStrategy) {
      const fromStrategy = this.layoutAPartirDeStrategy(String(contexto.layoutStrategy).trim());
      if (fromStrategy) return fromStrategy;
    }

    const equipamentoId = contexto.equipamentoId != null
      ? Number(contexto.equipamentoId)
      : null;

    if (equipamentoId && Number.isFinite(equipamentoId) && equipamentoId > 0) {
      const doEquipamento = await this.obterLayoutEquipamento(equipamentoId);
      if (doEquipamento) return doEquipamento;
    }

    return this.obterLayoutAtivo();
  }

  /**
   * Interpretação oficial de etiqueta para o PDV (Sprint EQUIPAMENTOS 03 / RC1).
   * Sem layout ativo configurado → não interpreta.
   * @param {string} codigo
   * @param {Object} [opcoes]
   * @param {number} [opcoes.equipamentoId]
   * @param {Object} [opcoes.layout] — override opcional (laboratório/UI)
   */
  async interpretarEtiqueta(codigo, opcoes = {}) {
    const limpo = String(codigo || '').replace(/\D/g, '');
    if (!/^2\d{12}$/.test(limpo)) {
      throw Object.assign(
        new Error('Código não é etiqueta de balança (esperado EAN-13 prefixo 2).'),
        { statusCode: 400 }
      );
    }

    const t0Motor = process.hrtime.bigint();
    let layout = null;
    if (opcoes.layout && typeof opcoes.layout === 'object') {
      const norm = normalizarLayoutEtiqueta(opcoes.layout);
      if (!norm.ok) {
        throw Object.assign(new Error(norm.erro), { statusCode: 400 });
      }
      layout = norm.layout;
    } else {
      layout = await this.resolverLayoutConfig({
        equipamentoId: opcoes.equipamentoId
      });
    }
    const tempoMotorMs = Number(process.hrtime.bigint() - t0Motor) / 1e6;

    if (!layout) {
      return {
        sucesso: false,
        semLayoutAtivo: true,
        codigo: limpo,
        layout: null,
        resultado: null,
        mensagem: 'Nenhuma balança configurada para o PDV.',
        metricas: {
          tempoMotorMs: Number(tempoMotorMs.toFixed(3)),
          tempoParserMs: 0
        }
      };
    }

    const t0Parser = process.hrtime.bigint();
    const parsed = parseEtiquetaComLayout(limpo, layout);
    const tempoParserMs = Number(process.hrtime.bigint() - t0Parser) / 1e6;

    return {
      sucesso: Boolean(parsed),
      semLayoutAtivo: false,
      codigo: limpo,
      layout,
      resultado: parsed
        ? {
          plu: parsed.plu,
          pluRaw: parsed.pluRaw,
          valorTotal: parsed.valorTotal,
          peso: parsed.peso,
          tipoPayload: parsed.tipoPayload,
          layoutId: parsed.layoutId || layout?.preset_id || null
        }
        : null,
      mensagem: parsed
        ? `PLU ${parsed.plu} extraído com layout ${layout?.preset_id || 'ativo'}`
        : 'Não foi possível interpretar a etiqueta com o layout ativo.',
      metricas: {
        tempoMotorMs: Number(tempoMotorMs.toFixed(3)),
        tempoParserMs: Number(tempoParserMs.toFixed(3))
      }
    };
  }

  testarParse(codigo, layoutBruto) {
    // Sem layout explícito: usa o mesmo caminho oficial (layout ativo).
    if (layoutBruto == null || layoutBruto === '') {
      return this.interpretarEtiqueta(codigo);
    }

    const n = normalizarLayoutEtiqueta(layoutBruto);
    if (!n.ok) throw Object.assign(new Error(n.erro), { statusCode: 400 });

    const parsed = parseEtiquetaComLayout(codigo, n.layout);
    return {
      sucesso: Boolean(parsed),
      codigo: String(codigo || '').replace(/\D/g, ''),
      layout: n.layout,
      resultado: parsed,
      mensagem: parsed
        ? `PLU ${parsed.plu} extraído`
        : 'Não foi possível interpretar a etiqueta com o layout informado.'
    };
  }
}

const layoutEtiquetaService = new LayoutEtiquetaService();

module.exports = layoutEtiquetaService;
module.exports.LayoutEtiquetaService = LayoutEtiquetaService;
module.exports.CHAVE_LAYOUT = CHAVE_LAYOUT;
module.exports.CHAVE_STRATEGY_LEGADO = CHAVE_STRATEGY_LEGADO;
module.exports.CHAVE_LAYOUT_ATIVO_GLOBAL = CHAVE_LAYOUT_ATIVO_GLOBAL;
