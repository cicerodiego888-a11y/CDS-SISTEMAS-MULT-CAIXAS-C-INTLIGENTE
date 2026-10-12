'use strict';

const { tokenizar } = require('../core/tokenizer');
const { levenshtein } = require('../core/levenshtein');
const { normalizarNomeBusca } = require('../core/normalizarNomeBusca');
const CatalogSnapshot = require('../catalog/CatalogSnapshot');
const { textoContemToken, haystackBuscaProduto } = require('../core/compararTextoBusca');

/**
 * Tokens que realmente restringem a busca.
 * Ignora "1", "tc", "sp" quando o termo já tem palavras longas —
 * esses curtos casam como substring em quase qualquer nome_busca concatenado.
 */
function tokensSignificativos(tokens) {
  const unicos = [];
  const vistos = new Set();
  for (const raw of tokens || []) {
    const t = String(raw || '');
    if (!t || vistos.has(t)) continue;
    vistos.add(t);
    unicos.push(t);
  }
  const fortes = unicos.filter((t) => t.length >= 3 || (t.length >= 2 && /\d/.test(t)));
  return { unicos, fortes, exigidos: fortes.length ? fortes : unicos };
}

/** Palavras (3+ letras) do nome por produto do snapshot; o snapshot é imutável, a chave some no próximo swap. */
const TOKENS_NOME_POR_PRODUTO = new WeakMap();

function tokensDoNome(produto) {
  let tokens = TOKENS_NOME_POR_PRODUTO.get(produto);
  if (!tokens) {
    tokens = String(produto?.nome || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length >= 3);
    TOKENS_NOME_POR_PRODUTO.set(produto, tokens);
  }
  return tokens;
}

/**
 * INTER casa INTERRUPTOR (e o inverso) sem aceitar "sp" dentro de "antirrespigo".
 * Token só dígitos NÃO usa prefixo no nome — senão EAN 789… casa "789" no título
 * e a busca nunca chega no código de barras.
 */
function tokenCompativelNoProduto(produto, token, alts) {
  const t = String(token || '');
  if (!t) return false;

  const hay = haystackBuscaProduto(produto);
  if (/^\d+$/.test(t)) {
    return CatalogSnapshot.idsNumericosIguais(produto.codigo, t)
      || CatalogSnapshot.idsNumericosIguais(produto.codigo_barras, t)
      || CatalogSnapshot.idsNumericosIguais(produto.plu, t)
      || textoContemToken(hay, t);
  }

  if (textoContemToken(hay, t)) return true;
  for (const e of alts || []) {
    if (e && e !== t && textoContemToken(hay, e)) return true;
  }
  if (t.length < 3 || !/[a-z]/.test(t)) return false;
  const palavras = String(produto?.nome || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 3);
  for (const w of palavras) {
    if (w === t || w.startsWith(t) || t.startsWith(w)) return true;
  }
  return false;
}

/**
 * SearchAI — correção, abreviações, apelidos e sugestões.
 * Base para integração futura com MIIP.
 */
class SearchAI {
  /**
   * @param {{
   *   sinonimos: import('../core/SinonimosService'),
   *   learning: import('../core/LearningEngine'),
   *   catalog: import('../catalog/CatalogMemory'),
   *   config: import('../config/MibConfig')
   * }} deps
   */
  constructor(deps) {
    this.sinonimos = deps.sinonimos;
    this.learning = deps.learning;
    this.catalog = deps.catalog;
    this.config = deps.config;
  }

  maxDistancia() {
    return Math.max(1, Number(this.config.get('sensibilidadeLevenshtein')) || 2);
  }

  /**
   * Interpreta termo: tokens, sinônimos, preferência do operador.
   */
  interpretar(termo, contexto = {}) {
    const tok = tokenizar(termo);
    const tokensExpandidos = this.config.get('ativarSinonimos')
      ? this.sinonimos.expandir(tok.tokensNorm)
      : tok.tokensNorm;

    const preferido = this.config.get('ativarAprendizado')
      ? this.learning.preferenciaProduto(tok.normalizado, contexto.operador_id)
      : null;

    return {
      ...tok,
      tokensExpandidos,
      preferidoId: preferido,
      abreviacao: tok.tokensNorm.length === 1 && tok.tokensNorm[0].length <= 5
    };
  }

  /**
   * Busca fuzzy no snapshot do catálogo (limitada para performance).
   * @returns {{ itens: object[], sugestoes: string[] }}
   */
  buscarFuzzy(termoNorm, opcoes = {}) {
    if (!this.config.get('ativarFuzzy')) {
      return { itens: [], sugestoes: [] };
    }
    const maxDist = this.maxDistancia();
    const limite = Math.min(Math.max(Number(opcoes.limite) || 20, 1), 40);
    const modoFiscal = opcoes.modoFiscal === true;
    const snapshot = this.catalog.ativo ? this.catalog.ativo() : null;
    const lista = snapshot?.lista || [];

    // amostra: prefixo aproximado (1ª letra) + janelas de tamanho do termo
    const candidatos = [];
    const first = termoNorm.slice(0, 1);
    for (const p of lista) {
      const nb = p.nome_busca || '';
      if (!nb) continue;
      // evita scan total: mesma inicial OU tamanho próximo OU contém 2 primeiras letras
      const pref2 = termoNorm.slice(0, Math.min(2, termoNorm.length));
      const sameStart = first && nb[0] === first;
      const nearLen = Math.abs(nb.length - termoNorm.length) <= maxDist + 6;
      const softPref = pref2.length >= 2 && nb.includes(pref2);
      if (!sameStart && !nearLen && !softPref) continue;
      candidatos.push(p);
      if (candidatos.length >= 4000) break;
    }

    const outrasJanelas = [...new Set([
      termoNorm.length + 1,
      Math.max(1, termoNorm.length - 1),
      termoNorm.length + maxDist
    ])].filter((len) => len !== termoNorm.length);

    // Examina todos os pré-selecionados e guarda só os `limite` mais próximos (empate: ordem do catálogo).
    // Parar nos primeiros aceitos descartava itens mais próximos do fim do catálogo (produtos recém-cadastrados).
    const melhores = [];
    for (const p of candidatos) {
      const nb = p.nome_busca || '';
      const prefixo = nb.slice(0, termoNorm.length);
      const dPrefixo = levenshtein(termoNorm, prefixo);
      let d = dPrefixo;
      for (const len of outrasJanelas) {
        d = Math.min(d, levenshtein(termoNorm, nb.slice(0, len)));
      }
      // levenshtein(a, b) >= |a.length - b.length|: comparações que não podem reduzir `d` são puladas.
      if (nb.length <= termoNorm.length + 4 && Math.abs(nb.length - termoNorm.length) < d) {
        d = Math.min(d, levenshtein(termoNorm, nb));
      }
      // tokens do nome original (espaços) — cobre "COKA" ↔ "COCA" em "COCA COLA 2L"
      for (const tok of tokensDoNome(p)) {
        if (Math.abs(tok.length - termoNorm.length) >= d) continue;
        d = Math.min(d, levenshtein(termoNorm, tok));
      }

      const maxLenPrefixo = Math.max(termoNorm.length, prefixo.length);
      const similaridadePrefixo = maxLenPrefixo ? 1 - (dPrefixo / maxLenPrefixo) : 1;
      if (d > maxDist && similaridadePrefixo < 0.72) continue;
      if (melhores.length >= limite && d >= melhores[melhores.length - 1]._fuzzyDist) continue;

      let pos = melhores.length;
      while (pos > 0 && melhores[pos - 1]._fuzzyDist > d) pos -= 1;
      melhores.splice(pos, 0, {
        ...p,
        preco_venda: p.preco,
        _matchTipo: { fuzzy: true },
        _fuzzyDist: d,
        match_exato: 0
      });
      if (melhores.length > limite) melhores.pop();
      if (melhores.length >= limite && melhores[limite - 1]._fuzzyDist === 0) break;
    }

    return {
      itens: melhores,
      sugestoes: [...new Set(melhores.map((p) => p.nome).filter(Boolean))].slice(0, 5)
    };
  }

  /**
   * Filtra catálogo por tokens/sinônimos.
   * Com várias palavras, exige TODAS as significativas (AND).
   * Token curto sozinho ("tc", "ph") continua OR — inclusive via sinônimo.
   */
  buscarPorTokens(tokensExpandidos, opcoes = {}) {
    if (!tokensExpandidos?.length) return [];
    const limite = Math.min(Math.max(Number(opcoes.limite) || 20, 1), 50);
    const modoFiscal = opcoes.modoFiscal === true;
    const snapshot = this.catalog.ativo ? this.catalog.ativo() : null;
    const lista = snapshot?.lista || [];
    const originais = (opcoes.tokensOriginais && opcoes.tokensOriginais.length)
      ? opcoes.tokensOriginais
      : tokensExpandidos;
    const { exigidos } = tokensSignificativos(originais);
    if (!exigidos.length) return [];
    const out = [];

    for (const p of lista) {
      let hits = 0;
      let sinonimo = false;
      let ok = true;
      for (const t of exigidos) {
        if (tokenCompativelNoProduto(p, t, [])) {
          hits += 1;
          continue;
        }
        const alts = this._sinonimosDoToken(t, tokensExpandidos, originais);
        if (tokenCompativelNoProduto(p, t, alts)) {
          hits += 1;
          sinonimo = true;
          continue;
        }
        ok = false;
        break;
      }
      if (!ok) continue;
      out.push({
        ...p,
        preco_venda: p.preco,
        _matchTipo: { sinonimo, tokens: hits },
        match_exato: 0
      });
      if (out.length >= limite * 4) break;
    }
    return out;
  }

  _sinonimosDoToken(token, tokensExpandidos, originais) {
    const t = String(token || '');
    if (!t) return [];
    if (this.sinonimos && typeof this.sinonimos.expandir === 'function') {
      return this.sinonimos.expandir([t]).filter((e) => e && e !== t);
    }
    const orig = new Set(originais || []);
    return (tokensExpandidos || []).filter((e) => e && e !== t && !orig.has(e)
      && (e.includes(t) || t.includes(e)));
  }

  /**
   * "Você quis dizer..." quando não há resultados.
   */
  sugerirCorrecao(termo, fuzzyResult) {
    if (!this.config.get('ativarAutoCorrecao')) {
      return { mensagem: null, sugestoes: [] };
    }
    const sugestoes = fuzzyResult?.sugestoes || [];
    if (!sugestoes.length) {
      // histórico
      const top = this.learning.topSearches(5).map((t) => t.termo);
      if (!top.length) return { mensagem: null, sugestoes: [] };
      return {
        mensagem: 'Você quis dizer...',
        sugestoes: top
      };
    }
    this.learning.correcoes += 1;
    return {
      mensagem: 'Você quis dizer...',
      sugestoes
    };
  }

  /**
   * Expande termo único via sinônimo para busca.
   */
  termoViaSinonimo(termoNorm) {
    const exp = this.sinonimos.expandir([termoNorm]);
    return exp.filter((t) => t !== termoNorm);
  }
}

SearchAI.tokensSignificativos = tokensSignificativos;
SearchAI.tokenCompativelNoProduto = tokenCompativelNoProduto;

module.exports = SearchAI;
