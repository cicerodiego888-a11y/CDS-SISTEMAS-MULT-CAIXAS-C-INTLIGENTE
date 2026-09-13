'use strict';

const CatalogSnapshot = require('./CatalogSnapshot');

const SQL_CATALOGO = `
  SELECT
    p.id,
    p.nome,
    COALESCE(NULLIF(TRIM(p.nome_busca), ''), '') AS nome_busca,
    p.codigo,
    COALESCE(
      NULLIF(TRIM(p.codigo_barras), ''),
      (
        SELECT pi.codigo FROM produto_identificadores pi
        WHERE pi.produto_id = p.id
          AND pi.tipo IN ('EAN8', 'EAN13', 'GTIN')
          AND COALESCE(pi.ativo, 1) = 1
          AND COALESCE(pi.principal, 0) = 1
        ORDER BY CASE pi.tipo WHEN 'EAN13' THEN 1 WHEN 'GTIN' THEN 2 ELSE 3 END, pi.id DESC
        LIMIT 1
      )
    ) AS codigo_barras,
    (
      SELECT pi.codigo FROM produto_identificadores pi
      WHERE pi.produto_id = p.id
        AND pi.tipo = 'PLU'
        AND COALESCE(pi.ativo, 1) = 1
        AND COALESCE(pi.principal, 0) = 1
      ORDER BY pi.id DESC
      LIMIT 1
    ) AS plu,
    COALESCE(p.preco_venda, 0) AS preco,
    COALESCE(c.nome, '') AS categoria,
    COALESCE(m.nome, '') AS marca,
    COALESCE(p.ativo, 1) AS status,
    COALESCE(p.item_fiscal, 1) AS item_fiscal
  FROM produtos p
  LEFT JOIN categorias c ON c.id = p.categoria_id
  LEFT JOIN marcas m ON m.id = p.marca_id
  WHERE COALESCE(p.ativo, 1) = 1
`;

/**
 * Catálogo atômico Copy-On-Write.
 * Leitores sempre usam a referência ativa (lock-free).
 * Escritas constroem Catálogo B e fazem swap.
 */
class AtomicCatalog {
  /**
   * @param {import('sqlite3').Database} db
   * @param {{ logger?: object, onSwap?: Function }} [deps]
   */
  constructor(db, deps = {}) {
    this.db = db;
    this.logger = deps.logger || null;
    this.onSwap = typeof deps.onSwap === 'function' ? deps.onSwap : null;
    /** @type {CatalogSnapshot} */
    this._ativo = new CatalogSnapshot([], { versao: 0 });
    this._versao = 0;
    this._reconstruindo = false;
    this._filaRebuild = null;
    this.swaps = 0;
    this.atualizacoes = 0;
    this.ultimoSwapEm = null;
    this.ultimoRefreshEm = null;
    this.ultimoErro = null;
    this.ultimoTempoConstrucaoMs = 0;
  }

  get tamanho() {
    return this._ativo.tamanho;
  }

  get versao() {
    return this._versao;
  }

  /** Referência ativa — nunca mutar. */
  ativo() {
    return this._ativo;
  }

  /**
   * Rebuild completo + swap atômico.
   * @returns {Promise<{ versao: number, produtos: number, tempoMs: number }>}
   */
  rebuild() {
    if (this._reconstruindo) {
      if (!this._filaRebuild) {
        this._filaRebuild = new Promise((resolve, reject) => {
          this._pendenteResolve = resolve;
          this._pendenteReject = reject;
        });
      }
      return this._filaRebuild;
    }

    this._reconstruindo = true;
    const inicio = process.hrtime.bigint();

    return new Promise((resolve, reject) => {
      this.db.all(SQL_CATALOGO, [], (err, rows) => {
        if (err) {
          this._reconstruindo = false;
          this.ultimoErro = err.message;
          if (this.logger) this.logger.error('catalog_rebuild', { erro: err.message });
          if (this._pendenteReject) this._pendenteReject(err);
          this._limparFila();
          return reject(err);
        }

        const tempoMs = Number(process.hrtime.bigint() - inicio) / 1e6;
        const novaVersao = this._versao + 1;
        const novo = CatalogSnapshot.fromRows(rows || [], {
          versao: novaVersao,
          tempoConstrucaoMs: Number(tempoMs.toFixed(3))
        });

        // Validação mínima
        if (!novo || typeof novo.filtrar !== 'function') {
          this._reconstruindo = false;
          const falha = new Error('Snapshot inválido');
          if (this._pendenteReject) this._pendenteReject(falha);
          this._limparFila();
          return reject(falha);
        }

        // Swap atômico (troca de referência)
        const anterior = this._ativo;
        this._ativo = novo;
        this._versao = novaVersao;
        this.swaps += 1;
        this.atualizacoes += 1;
        this.ultimoSwapEm = new Date().toISOString();
        this.ultimoRefreshEm = this.ultimoSwapEm;
        this.ultimoTempoConstrucaoMs = Number(tempoMs.toFixed(3));
        this.ultimoErro = null;
        this._reconstruindo = false;

        if (this.logger) {
          this.logger.info('swap', {
            versao: novaVersao,
            tamanho: novo.tamanho,
            tempoMs: this.ultimoTempoConstrucaoMs
          });
        }
        if (this.onSwap) {
          try {
            this.onSwap({
              versao: novaVersao,
              tamanho: novo.tamanho,
              tempoMs: this.ultimoTempoConstrucaoMs,
              anteriorTamanho: anterior.tamanho
            });
          } catch (_) { /* ignore */ }
        }

        const result = {
          versao: novaVersao,
          produtos: novo.tamanho,
          tempoMs: this.ultimoTempoConstrucaoMs
        };
        resolve(result);
        if (this._pendenteResolve) this._pendenteResolve(result);
        this._limparFila();
      });
    });
  }

  _limparFila() {
    this._filaRebuild = null;
    this._pendenteResolve = null;
    this._pendenteReject = null;
  }

  garantir() {
    if (this._ativo.tamanho > 0 || this._versao > 0) {
      return Promise.resolve(this._ativo.tamanho);
    }
    return this.rebuild().then((r) => r.produtos);
  }

  filtrar(termoNorm, opcoes) {
    return this._ativo.filtrar(termoNorm, opcoes);
  }

  get(id) {
    return this._ativo.get(id);
  }

  /**
   * Patch COW: clona lista, aplica upsert/remove, swap (sem SQL full).
   * Para mudanças pontuais rápidas; refresh full ainda é preferível em lote.
   */
  aplicarPatch({ upsert, removeId } = {}) {
    const inicio = process.hrtime.bigint();
    const base = this._ativo.lista.slice();
    let lista = base;

    if (removeId != null) {
      const id = Number(removeId);
      lista = lista.filter((p) => p.id !== id);
    }

    if (upsert && upsert.id != null) {
      const id = Number(upsert.id);
      const item = {
        id,
        nome: upsert.nome != null ? String(upsert.nome) : '',
        nome_busca: upsert.nome_busca || '',
        codigo: upsert.codigo != null ? String(upsert.codigo) : '',
        codigo_barras: upsert.codigo_barras != null ? String(upsert.codigo_barras) : '',
        plu: upsert.plu != null ? String(upsert.plu) : '',
        preco: Number(upsert.preco != null ? upsert.preco : upsert.preco_venda || 0),
        categoria: upsert.categoria || '',
        marca: upsert.marca || '',
        status: upsert.status != null ? (Number(upsert.status) === 1 ? 1 : 0) : 1,
        item_fiscal: upsert.item_fiscal != null ? (Number(upsert.item_fiscal) === 1 ? 1 : 0) : 1
      };
      if (item.status !== 1) {
        lista = lista.filter((p) => p.id !== id);
      } else {
        const idx = lista.findIndex((p) => p.id === id);
        if (idx >= 0) lista[idx] = item;
        else lista.push(item);
      }
    }

    const tempoMs = Number(process.hrtime.bigint() - inicio) / 1e6;
    const novaVersao = this._versao + 1;
    const novo = new CatalogSnapshot(lista, {
      versao: novaVersao,
      tempoConstrucaoMs: Number(tempoMs.toFixed(3))
    });
    this._ativo = novo;
    this._versao = novaVersao;
    this.swaps += 1;
    this.atualizacoes += 1;
    this.ultimoSwapEm = new Date().toISOString();
    this.ultimoTempoConstrucaoMs = Number(tempoMs.toFixed(3));
    if (this.onSwap) {
      this.onSwap({
        versao: novaVersao,
        tamanho: novo.tamanho,
        tempoMs: this.ultimoTempoConstrucaoMs,
        patch: true
      });
    }
    return { versao: novaVersao, produtos: novo.tamanho, tempoMs: this.ultimoTempoConstrucaoMs };
  }

  snapshot() {
    return {
      ...this._ativo.snapshot(),
      swaps: this.swaps,
      atualizacoes: this.atualizacoes,
      ultimoSwapEm: this.ultimoSwapEm,
      ultimoRefreshEm: this.ultimoRefreshEm,
      ultimoErro: this.ultimoErro,
      reconstruindo: this._reconstruindo
    };
  }
}

module.exports = AtomicCatalog;
