'use strict';

/**
 * Copiloto Cadastro — sugere via MIIP + MIB. Não grava produto.
 */
function createPlugin() {
  let ready = false;

  async function miipIdentify(args) {
    try {
      const { getMiipService } = require('../../motores/miip/getMiipService');
      const miip = getMiipService();
      if (typeof miip.estaHabilitado === 'function' && !miip.estaHabilitado()) {
        return { desabilitado: true };
      }
      return miip.identificar({
        nome: args.nome || args.query,
        gtin: args.gtin,
        codigo_barras: args.gtin || args.codigo_barras
      }, { origem: 'catalog-copilot' });
    } catch (err) {
      return { erro: err.message };
    }
  }

  async function mibEnrich(db, args) {
    try {
      const { consultarGrafoMiip, obterKnowledge, obterSearchService } = require('../../motores/mib');
      const grafo = await consultarGrafoMiip(db, {
        nome: args.nome || args.query,
        gtin: args.gtin,
        ncm: args.ncm
      }, { origem: 'catalog-copilot' });

      let semelhantes = [];
      try {
        const search = obterSearchService(db);
        if (!search._pronto && typeof search.iniciar === 'function') await search.iniciar();
        const r = await search.search({
          entity: 'produto',
          query: args.nome || args.query || args.gtin || '',
          limite: 5,
          skipAuth: true,
          origem: 'catalog-copilot'
        });
        semelhantes = r.itens || [];
        if (semelhantes[0]?.id) {
          try {
            const rec = await obterKnowledge(db).recommendations(semelhantes[0].id, 5);
            semelhantes = { itens: semelhantes, recomendacoes: rec };
          } catch (_) { /* ignore */ }
        }
      } catch (_) { /* MIB opcional */ }

      return { grafo, semelhantes };
    } catch (err) {
      return { erro: err.message };
    }
  }

  return {
    async load() { ready = true; return { ok: true }; },
    async unload() { ready = false; },
    async health() {
      return { ok: ready, motors: ['MIIP', 'MIB'], gravaCadastro: false };
    },
    async suggest(args = {}, ctx = {}) {
      const identify = await miipIdentify(args);
      const enrich = await mibEnrich(ctx.db, args);
      const sugestoes = {
        categoria: identify?.categoria || identify?.sugestao?.categoria || null,
        marca: identify?.marca || identify?.sugestao?.marca || null,
        ncm: identify?.ncm || args.ncm || enrich?.grafo?.ncm || null,
        cest: identify?.cest || identify?.sugestao?.cest || null,
        preco: identify?.preco_sugerido || identify?.sugestao?.preco || null,
        fornecedor: identify?.fornecedor || null,
        produtosSemelhantes: enrich?.semelhantes || []
      };
      return {
        resposta: 'Sugestões de cadastro (MIIP+MIB) — revise antes de salvar no cadastro oficial.',
        fonte: ['MIIP', 'MIB'],
        sugestoes,
        identify,
        enrich
      };
    },
    async ask({ mensagem, gtin, nome, query } = {}, ctx = {}) {
      const q = nome || query || mensagem || '';
      const gtinMatch = String(mensagem || '').match(/\b(\d{8,14})\b/);
      return this.suggest({
        nome: q,
        query: q,
        gtin: gtin || (gtinMatch && gtinMatch[1]) || null
      }, ctx);
    }
  };
}

module.exports = createPlugin;
