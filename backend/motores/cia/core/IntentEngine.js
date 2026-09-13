'use strict';

/**
 * Intent Engine — reconhece intenções em linguagem natural (heurística + padrões).
 * Não contém regras de negócio dos módulos — apenas classificação de intenção.
 */

const INTENTS = Object.freeze({
  SEARCH_PRODUCT: 'search_product',
  SEARCH_CLIENT: 'search_client',
  STOCK_OUT: 'stock_out',
  FORECAST: 'forecast',
  RECOMMEND: 'recommend',
  INSIGHTS: 'insights',
  INADIMPLENTES: 'inadimplentes',
  IDENTIFY_PRODUCT: 'identify_product',
  REGISTER_PRODUCT: 'register_product',
  CLOSE_CAIXA: 'close_caixa',
  GENERATE_ORDER: 'generate_order',
  EMIT_NFE: 'emit_nfe',
  DELETE_PRODUCT: 'delete_product',
  DELETE_CLIENT: 'delete_client',
  CANCEL_NFE: 'cancel_nfe',
  HELP: 'help',
  UNKNOWN: 'unknown'
});

const PATTERNS = [
  { intent: INTENTS.STOCK_OUT, re: /sem estoque|estoque\s*zerad|faltando\s*estoque|ruptura/i, permissao: 'produtos' },
  { intent: INTENTS.INADIMPLENTES, re: /inadimplen|quem\s*deve|contas?\s*vencid|atrasad/i, permissao: 'financeiro' },
  { intent: INTENTS.FORECAST, re: /previs[aã]o|forecast|vai\s*vender|tend[eê]ncia/i, permissao: 'relatorios' },
  { intent: INTENTS.INSIGHTS, re: /insight|oportunidad|risco|intelig[eê]ncia|cip/i, permissao: 'relatorios' },
  { intent: INTENTS.RECOMMEND, re: /recomenda|suger|tamb[eé]m\s*compra|similar/i, permissao: 'produtos' },
  { intent: INTENTS.IDENTIFY_PRODUCT, re: /identificar|gtin|c[oó]digo\s*de\s*barras|miip/i, permissao: 'produtos' },
  { intent: INTENTS.REGISTER_PRODUCT, re: /cadastr\w*\s*(este\s*)?produto|novo\s*produto|criar\s*produto/i, permissao: 'produtos', critica: true },
  { intent: INTENTS.CLOSE_CAIXA, re: /fech\w*\s*(o\s*|meu\s*)?caixa|fechar\s*caixa/i, permissao: 'caixa', critica: true },
  { intent: INTENTS.GENERATE_ORDER, re: /gerar\s*pedido|criar\s*pedido|pedido\s*de\s*compra/i, permissao: 'compras', critica: true },
  { intent: INTENTS.EMIT_NFE, re: /emitir\s*nf-?e|gerar\s*nf-?e/i, permissao: 'fiscal', critica: true },
  { intent: INTENTS.DELETE_PRODUCT, re: /exclu\w*\s*produto|apagar\s*produto|deletar\s*produto/i, permissao: 'produtos', critica: true },
  { intent: INTENTS.DELETE_CLIENT, re: /exclu\w*\s*cliente|apagar\s*cliente/i, permissao: 'clientes', critica: true },
  { intent: INTENTS.CANCEL_NFE, re: /cancel\w*\s*nf-?e/i, permissao: 'fiscal', critica: true },
  { intent: INTENTS.SEARCH_CLIENT, re: /cliente|comprador|cpf/i, permissao: 'clientes' },
  { intent: INTENTS.SEARCH_PRODUCT, re: /produto|buscar|pesquis|estoque\s*de|quanto\s*tem/i, permissao: 'produtos' },
  { intent: INTENTS.HELP, re: /ajuda|help|o\s*que\s*voc[eê]\s*faz|comandos/i, permissao: null }
];

class IntentEngine {
  /**
   * @param {string} texto
   * @returns {{ intent: string, confianca: number, permissao: string|null, critica: boolean, entidades: object }}
   */
  classificar(texto) {
    const raw = String(texto || '').trim();
    if (!raw) {
      return { intent: INTENTS.UNKNOWN, confianca: 0, permissao: null, critica: false, entidades: {} };
    }

    for (const p of PATTERNS) {
      if (p.re.test(raw)) {
        return {
          intent: p.intent,
          confianca: 0.85,
          permissao: p.permissao,
          critica: Boolean(p.critica),
          entidades: this._extrairEntidades(raw, p.intent)
        };
      }
    }

    // fallback: busca genérica se parece termo curto
    if (raw.length <= 40 && !/\?$/.test(raw)) {
      return {
        intent: INTENTS.SEARCH_PRODUCT,
        confianca: 0.45,
        permissao: 'produtos',
        critica: false,
        entidades: { query: raw }
      };
    }

    return {
      intent: INTENTS.UNKNOWN,
      confianca: 0.2,
      permissao: null,
      critica: false,
      entidades: { query: raw }
    };
  }

  _extrairEntidades(texto, intent) {
    const entidades = {};
    const gtin = texto.match(/\b(\d{8,14})\b/);
    if (gtin) entidades.gtin = gtin[1];

    const n = texto.match(/\b(\d+)\s*(primeiros|itens|clientes|produtos)?\b/i);
    if (n && /primeiro|itens|clientes|produtos/i.test(texto)) {
      entidades.limite = Number(n[1]);
    }

    // termo após "buscar/pesquisar/produto"
    const q = texto.match(/(?:buscar|pesquisar|produto|cliente)\s+(.+)$/i);
    if (q) entidades.query = q[1].trim();
    else if (intent === INTENTS.SEARCH_PRODUCT || intent === INTENTS.SEARCH_CLIENT) {
      entidades.query = texto
        .replace(/buscar|pesquisar|produto|cliente|qual|quais|mostre|mostrar/gi, '')
        .trim() || texto;
    }

    if (intent === INTENTS.RECOMMEND) {
      const m = texto.match(/(?:para|de|do|da)\s+(.+)$/i);
      if (m) entidades.query = m[1].trim();
    }

    return entidades;
  }
}

IntentEngine.INTENTS = INTENTS;

module.exports = IntentEngine;
