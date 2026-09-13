'use strict';

const { normalizarNomeBusca } = require('../core/normalizarNomeBusca');
const { produtoCasaFraseBusca, textoContemFraseCompacta } = require('../core/compararTextoBusca');

/**
 * Snapshot imutável do catálogo (lock-free para leitores).
 */
class CatalogSnapshot {
  /**
   * @param {object[]} lista
   * @param {{ versao?: number, construidoEm?: string, tempoConstrucaoMs?: number }} [meta]
   */
  constructor(lista, meta = {}) {
    this.versao = Number(meta.versao) || 1;
    this.construidoEm = meta.construidoEm || new Date().toISOString();
    this.tempoConstrucaoMs = Number(meta.tempoConstrucaoMs) || 0;
    this._lista = Object.freeze(Array.isArray(lista) ? lista.map((p) => Object.freeze({ ...p })) : []);
    /** @type {Map<number, object>} */
    this._byId = new Map();
    for (const item of this._lista) {
      this._byId.set(item.id, item);
    }
  }

  get tamanho() {
    return this._lista.length;
  }

  get lista() {
    return this._lista;
  }

  get(id) {
    return this._byId.get(Number(id)) || null;
  }

  /**
   * Identificadores numéricos iguais sem substring (39≠3; 3≠103; 039≡39).
   * RC14.15.15 — PLU/código digitado = match exato.
   */
  static idsNumericosIguais(a, b) {
    const da = String(a ?? '').replace(/\D/g, '');
    const db = String(b ?? '').replace(/\D/g, '');
    if (!da || !db) return false;
    const na = da.replace(/^0+(?=\d)/, '') || '0';
    const nb = db.replace(/^0+(?=\d)/, '') || '0';
    return na === nb;
  }

  /**
   * @param {string} termoNorm
   * @param {{ limite?: number, modoFiscal?: boolean, base?: object[] }} [opcoes]
   */
  filtrar(termoNorm, opcoes = {}) {
    const termo = String(termoNorm || '');
    if (!termo) return [];
    const limite = Math.min(Math.max(Number(opcoes.limite) || 20, 1), 100);
    const base = Array.isArray(opcoes.base) ? opcoes.base : this._lista;
    const modoFiscal = opcoes.modoFiscal === true;
    const out = [];
    const soDigitos = /^\d+$/.test(termo);
    const termoComZeroMedida = !soDigitos && /(?:^|[^0-9])0+\d/.test(termo);

    for (const p of base) {
      if (modoFiscal && Number(p.item_fiscal) !== 1) continue;
      const nb = p.nome_busca || '';
      const codigo = String(p.codigo || '').toLowerCase();
      const barras = String(p.codigo_barras || '').toLowerCase();
      const plu = String(p.plu || '').toLowerCase();

      let ok = false;
      if (soDigitos) {
        ok = CatalogSnapshot.idsNumericosIguais(codigo, termo)
          || CatalogSnapshot.idsNumericosIguais(barras, termo)
          || CatalogSnapshot.idsNumericosIguais(plu, termo)
          || codigo === termo
          || barras === termo
          || plu === termo;
      } else {
        ok = codigo === termo
          || barras === termo
          || plu === termo
          || nb.startsWith(termo)
          || nb.includes(termo)
          || codigo.includes(termo)
          || barras.includes(termo)
          || plu.includes(termo);
        if (!ok && nb && termoComZeroMedida) {
          ok = textoContemFraseCompacta(nb, termo);
        }
        if (!ok && p.marca) {
          const marca = normalizarNomeBusca(p.marca);
          ok = marca.includes(termo) || textoContemFraseCompacta(marca, termo);
        }
        if (!ok && (!nb || termoComZeroMedida)) {
          ok = produtoCasaFraseBusca(p, termo);
        }
      }

      if (ok) {
        out.push(p);
        if (out.length >= limite * 5) break;
      }
    }
    return out;
  }

  snapshot() {
    return {
      versao: this.versao,
      produtos: this.tamanho,
      construidoEm: this.construidoEm,
      tempoConstrucaoMs: this.tempoConstrucaoMs
    };
  }

  /**
   * @param {object[]} rows
   * @param {object} meta
   */
  static fromRows(rows, meta = {}) {
    const lista = [];
    for (const row of rows || []) {
      const nomeBusca = row.nome_busca || normalizarNomeBusca(row.nome);
      lista.push({
        id: Number(row.id),
        nome: row.nome || '',
        nome_busca: nomeBusca,
        codigo: row.codigo != null ? String(row.codigo) : '',
        codigo_barras: row.codigo_barras != null ? String(row.codigo_barras) : '',
        plu: row.plu != null ? String(row.plu) : '',
        preco: Number(row.preco || 0),
        categoria: row.categoria || '',
        marca: row.marca || '',
        status: Number(row.status) === 1 ? 1 : 0,
        item_fiscal: Number(row.item_fiscal) === 1 ? 1 : 0
      });
    }
    return new CatalogSnapshot(lista, meta);
  }
}

module.exports = CatalogSnapshot;
