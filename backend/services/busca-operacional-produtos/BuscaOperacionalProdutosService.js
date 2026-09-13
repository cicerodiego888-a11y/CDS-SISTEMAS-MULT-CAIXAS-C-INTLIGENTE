'use strict';

/**
 * Busca operacional determinística (Cadastro + PDV Express).
 * Não usa ranking/fuzzy/aprendizado do MIB.
 * MIB entra somente como sugestão quando a busca operacional retorna zero.
 */

const { normalizarNomeBusca, normalizarTermoBusca } = require('../../motores/mib/core/normalizarNomeBusca');

const LIMITE_PADRAO = 20;
const LIMITE_MAXIMO = 30;

const PRIORIDADE = {
  IDENTIFICADOR_EXATO: 1,
  NOME_EXATO: 2,
  NOME_PREFIXO: 3,
  NOME_CONTEM: 4,
  MARCA_EXATO: 5,
  MARCA_PREFIXO: 6,
  MARCA_CONTEM: 7
};

function limitarResultados(valor) {
  const n = parseInt(valor, 10);
  if (!Number.isFinite(n)) return LIMITE_PADRAO;
  return Math.min(Math.max(n, 1), LIMITE_MAXIMO);
}

function pareceIdentificador(termo) {
  const t = String(termo || '').trim();
  if (!t) return false;
  return /^\d+$/.test(t.replace(/\s+/g, ''));
}

function idsIguais(a, b) {
  const da = String(a ?? '').trim();
  const db = String(b ?? '').trim();
  if (da && db && da === db) return true;
  const na = da.replace(/\D/g, '');
  const nb = db.replace(/\D/g, '');
  if (!na || !nb) return false;
  const sa = na.replace(/^0+(?=\d)/, '') || '0';
  const sb = nb.replace(/^0+(?=\d)/, '') || '0';
  return sa === sb && /^\d+$/.test(String(b || '').replace(/\s+/g, ''));
}

function produtoBateIdentificador(row, termoRaw) {
  const t = String(termoRaw || '').trim();
  if (!t || !row) return false;
  return idsIguais(row.codigo, t)
    || idsIguais(row.codigo_barras, t)
    || idsIguais(row.plu, t)
    || idsIguais(row.ean, t)
    || idsIguais(row.gtin, t);
}

function nomeNormalizado(row) {
  const nb = String(row && row.nome_busca != null ? row.nome_busca : '').trim();
  if (nb) return nb;
  return normalizarNomeBusca(row && row.nome);
}

function classificarMatchNome(row, termoNorm) {
  if (!termoNorm) return null;
  const nb = nomeNormalizado(row);
  if (!nb) return null;
  if (nb === termoNorm) return 'NOME_EXATO';
  if (nb.startsWith(termoNorm)) return 'NOME_PREFIXO';
  if (nb.includes(termoNorm)) return 'NOME_CONTEM';
  return null;
}

function classificarMatchMarca(row, termoNorm) {
  if (!termoNorm) return null;
  const mb = normalizarNomeBusca(row && (row.marca || row.marca_nome));
  if (!mb) return null;
  if (mb === termoNorm) return 'MARCA_EXATO';
  if (mb.startsWith(termoNorm)) return 'MARCA_PREFIXO';
  if (mb.includes(termoNorm)) return 'MARCA_CONTEM';
  return null;
}

function prioridadeDeMatch(tipo) {
  if (tipo === 'IDENTIFICADOR_EXATO') return PRIORIDADE.IDENTIFICADOR_EXATO;
  if (tipo === 'NOME_EXATO') return PRIORIDADE.NOME_EXATO;
  if (tipo === 'NOME_PREFIXO') return PRIORIDADE.NOME_PREFIXO;
  if (tipo === 'NOME_CONTEM') return PRIORIDADE.NOME_CONTEM;
  if (tipo === 'MARCA_EXATO') return PRIORIDADE.MARCA_EXATO;
  if (tipo === 'MARCA_PREFIXO') return PRIORIDADE.MARCA_PREFIXO;
  if (tipo === 'MARCA_CONTEM') return PRIORIDADE.MARCA_CONTEM;
  return 99;
}

function deveIgnorarRespostaBusca(seqResposta, seqAtual) {
  return Number(seqResposta) !== Number(seqAtual);
}

class BuscaOperacionalProdutosService {
  /**
   * @param {import('sqlite3').Database} db
   * @param {{ buscarSugestoesMib?: Function }} [opcoes]
   */
  constructor(db, opcoes = {}) {
    this.db = db;
    this.buscarSugestoesMib = typeof opcoes.buscarSugestoesMib === 'function'
      ? opcoes.buscarSugestoesMib
      : null;
  }

  _all(sql, params) {
    return new Promise((resolve, reject) => {
      this.db.all(sql, params, (err, rows) => {
        if (err) reject(err);
        else resolve(rows || []);
      });
    });
  }

  _selectBase() {
    return `
      SELECT
        p.*,
        (
          SELECT pi.codigo FROM produto_identificadores pi
          WHERE pi.produto_id = p.id
            AND pi.tipo = 'PLU'
            AND COALESCE(pi.ativo, 1) = 1
            AND COALESCE(pi.principal, 0) = 1
          ORDER BY pi.id DESC
          LIMIT 1
        ) AS plu,
        (SELECT preco_atacado FROM produto_atacado WHERE produto_id = p.id ORDER BY quantidade_minima ASC LIMIT 1) AS preco_atacado,
        (SELECT quantidade_minima FROM produto_atacado WHERE produto_id = p.id ORDER BY quantidade_minima ASC LIMIT 1) AS quantidade_minima_atacado,
        c.nome AS categoria_nome,
        COALESCE(m.nome, '') AS marca
      FROM produtos p
      LEFT JOIN categorias c ON c.id = p.categoria_id
      LEFT JOIN marcas m ON m.id = p.marca_id
    `;
  }

  _filtroFiscal(modoFiscal) {
    return modoFiscal ? ' AND COALESCE(p.item_fiscal, 1) = 1' : '';
  }

  async _porIdentificador(termoRaw, limite, fiscal) {
    const t = String(termoRaw || '').trim();
    if (!t) return [];
    const sql = `
      ${this._selectBase()}
      WHERE COALESCE(p.ativo, 1) = 1
        AND (
          p.codigo = ?
          OR p.codigo_barras = ?
          OR EXISTS (
            SELECT 1 FROM produto_identificadores pi
            WHERE pi.produto_id = p.id
              AND COALESCE(pi.ativo, 1) = 1
              AND pi.codigo = ?
              AND UPPER(pi.tipo) IN ('PLU', 'EAN', 'EAN8', 'EAN13', 'GTIN', 'GTIN14', 'CODIGO_BARRAS')
          )
        )
        ${fiscal}
      LIMIT ?
    `;
    return this._all(sql, [t, t, t, limite]);
  }

  async _porNomeExato(termoNorm, limite, fiscal) {
    if (!termoNorm) return [];
    const sql = `
      ${this._selectBase()}
      WHERE COALESCE(p.ativo, 1) = 1
        AND p.nome_busca = ?
        ${fiscal}
      ORDER BY p.nome ASC, p.id ASC
      LIMIT ?
    `;
    return this._all(sql, [termoNorm, limite]);
  }

  async _porNomePrefixo(termoNorm, limite, fiscal) {
    if (!termoNorm) return [];
    const sql = `
      ${this._selectBase()}
      WHERE COALESCE(p.ativo, 1) = 1
        AND p.nome_busca LIKE ? || '%'
        AND p.nome_busca != ?
        ${fiscal}
      ORDER BY LENGTH(p.nome_busca) ASC, p.nome ASC, p.id ASC
      LIMIT ?
    `;
    return this._all(sql, [termoNorm, termoNorm, limite]);
  }

  async _porNomeContem(termoNorm, limite, fiscal) {
    if (!termoNorm) return [];
    const sql = `
      ${this._selectBase()}
      WHERE COALESCE(p.ativo, 1) = 1
        AND p.nome_busca LIKE '%' || ? || '%'
        AND p.nome_busca NOT LIKE ? || '%'
        ${fiscal}
      ORDER BY LENGTH(p.nome_busca) ASC, p.nome ASC, p.id ASC
      LIMIT ?
    `;
    return this._all(sql, [termoNorm, termoNorm, limite]);
  }

  async _idsMarcasQueCorrespondem(termoNorm) {
    if (!termoNorm) return [];
    const marcas = await this._all(`SELECT id, nome FROM marcas`, []);
    const ids = [];
    for (const marca of marcas || []) {
      const nb = normalizarNomeBusca(marca && marca.nome);
      if (!nb) continue;
      if (nb === termoNorm || nb.startsWith(termoNorm) || nb.includes(termoNorm)) {
        const id = Number(marca.id);
        if (id) ids.push(id);
      }
    }
    return ids;
  }

  async _porMarca(termoNorm, limite, fiscal) {
    const ids = await this._idsMarcasQueCorrespondem(termoNorm);
    if (!ids.length) return [];
    const placeholders = ids.map(() => '?').join(',');
    const sql = `
      ${this._selectBase()}
      WHERE COALESCE(p.ativo, 1) = 1
        AND p.marca_id IN (${placeholders})
        ${fiscal}
      ORDER BY p.nome ASC, p.id ASC
      LIMIT ?
    `;
    return this._all(sql, [...ids, limite]);
  }

  _anotar(row, tipo) {
    return {
      ...row,
      categoria: row.categoria_nome || row.categoria || '',
      subcategoria: row.subcategoria_nome || row.subcategoria || '',
      busca_match_tipo: tipo,
      busca_prioridade: prioridadeDeMatch(tipo),
      match_exato: tipo === 'IDENTIFICADOR_EXATO' || tipo === 'NOME_EXATO' ? 1 : 0,
      _fonteBusca: 'operacional'
    };
  }

  _ordenar(itens) {
    return itens.slice().sort((a, b) => {
      const pa = Number(a.busca_prioridade || 99);
      const pb = Number(b.busca_prioridade || 99);
      if (pa !== pb) return pa - pb;
      const la = String(a.nome_busca || a.nome || '').length;
      const lb = String(b.nome_busca || b.nome || '').length;
      if (la !== lb) return la - lb;
      const na = String(a.nome || '').localeCompare(String(b.nome || ''), 'pt-BR');
      if (na !== 0) return na;
      return Number(a.id) - Number(b.id);
    });
  }

  /**
   * @param {{ q: string, limite?: number, modoFiscal?: boolean, incluirSugestoes?: boolean }} opts
   */
  async buscar(opts = {}) {
    const termoRaw = String(opts.q || '').trim();
    const limite = limitarResultados(opts.limite);
    const modoFiscal = opts.modoFiscal === true;
    const incluirSugestoes = opts.incluirSugestoes !== false;
    const termoNorm = normalizarTermoBusca(termoRaw);
    const fiscal = this._filtroFiscal(modoFiscal);

    if (!termoRaw) {
      return {
        itens: [],
        sugestoes: [],
        meta: {
          fonte: 'operacional',
          query: '',
          limite,
          total_operacional: 0,
          mib_consultado: false
        }
      };
    }

    const vistos = new Set();
    const itens = [];

    const push = (rows, tipoForcado) => {
      for (const row of rows || []) {
        const id = Number(row.id);
        if (!id || vistos.has(id)) continue;
        let tipo = tipoForcado;
        if (!tipo) {
          if (produtoBateIdentificador(row, termoRaw)) tipo = 'IDENTIFICADOR_EXATO';
          else tipo = classificarMatchNome(row, termoNorm) || 'NOME_CONTEM';
        }
        vistos.add(id);
        itens.push(this._anotar(row, tipo));
      }
    };

    const ids = await this._porIdentificador(termoRaw, limite, fiscal);
    push(ids, 'IDENTIFICADOR_EXATO');

    if (!pareceIdentificador(termoRaw) && termoNorm) {
      const exatos = await this._porNomeExato(termoNorm, limite, fiscal);
      push(exatos, 'NOME_EXATO');

      if (itens.length < limite) {
        const prefixos = await this._porNomePrefixo(termoNorm, limite, fiscal);
        push(prefixos, 'NOME_PREFIXO');
      }

      const temPrefixoOuExato = itens.some((p) =>
        p.busca_match_tipo === 'NOME_EXATO' || p.busca_match_tipo === 'NOME_PREFIXO'
      );

      if (!temPrefixoOuExato && itens.length < limite) {
        const contem = await this._porNomeContem(termoNorm, limite, fiscal);
        push(contem, 'NOME_CONTEM');
      }

      if (itens.length < limite) {
        const porMarca = await this._porMarca(termoNorm, limite, fiscal);
        for (const row of porMarca || []) {
          const tipoMarca = classificarMatchMarca(row, termoNorm);
          if (tipoMarca) push([row], tipoMarca);
        }
      }
    }

    const isolados = this._ordenar(itens).filter((p) => {
      const temPrefixoOuExato = itens.some((x) =>
        x.busca_match_tipo === 'NOME_EXATO' || x.busca_match_tipo === 'NOME_PREFIXO'
      );
      if (temPrefixoOuExato && p.busca_match_tipo === 'NOME_CONTEM') return false;
      return true;
    }).slice(0, limite);

    let sugestoes = [];
    let mibConsultado = false;
    if (isolados.length === 0 && incluirSugestoes && this.buscarSugestoesMib) {
      mibConsultado = true;
      try {
        const mibItens = await this.buscarSugestoesMib(termoRaw, {
          limite,
          modoFiscal
        });
        sugestoes = (Array.isArray(mibItens) ? mibItens : [])
          .filter((p) => p != null)
          .slice(0, limite)
          .map((p) => ({
            ...p,
            _fonteBusca: 'mib-sugestao'
          }));
      } catch (_) {
        sugestoes = [];
      }
    }

    return {
      itens: isolados,
      sugestoes,
      meta: {
        fonte: isolados.length ? 'operacional' : 'vazio',
        query: termoRaw,
        query_normalizada: termoNorm,
        limite,
        total_operacional: isolados.length,
        total_sugestoes: sugestoes.length,
        mib_consultado: mibConsultado,
        prioridade: ['IDENTIFICADOR_EXATO', 'NOME_EXATO', 'NOME_PREFIXO', 'NOME_CONTEM', 'MARCA_EXATO', 'MARCA_PREFIXO', 'MARCA_CONTEM']
      }
    };
  }
}

function criarBuscaOperacionalProdutosService(db, opcoes) {
  return new BuscaOperacionalProdutosService(db, opcoes);
}

module.exports = {
  BuscaOperacionalProdutosService,
  criarBuscaOperacionalProdutosService,
  LIMITE_PADRAO,
  LIMITE_MAXIMO,
  PRIORIDADE,
  normalizarNomeBusca,
  normalizarTermoBusca,
  pareceIdentificador,
  classificarMatchNome,
  classificarMatchMarca,
  produtoBateIdentificador,
  deveIgnorarRespostaBusca,
  limitarResultados
};
