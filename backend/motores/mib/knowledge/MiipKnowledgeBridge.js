'use strict';

/**
 * Ponte MIB Knowledge ↔ MIIP.
 * O MIIP consulta o grafo antes de decidir cadastro / associação.
 */
class MiipKnowledgeBridge {
  /**
   * @param {import('./KnowledgeService')} knowledge
   */
  constructor(knowledge) {
    this.knowledge = knowledge;
  }

  /**
   * @param {object} item — item desconhecido (XML / entrada)
   * @param {object} [contexto]
   */
  async enriquecer(item, contexto = {}) {
    const consulta = await this.knowledge.consultarParaMiip(item);
    return {
      origem: 'mib-knowledge',
      contexto: contexto.origem || 'miip',
      gtinMatch: consulta.encontradoPorGtin,
      similares: consulta.similares,
      sugestao: {
        categoria: consulta.sugestaoCadastro?.categoria,
        marca: consulta.sugestaoCadastro?.marca,
        ncm: consulta.sugestaoCadastro?.ncm,
        cest: consulta.sugestaoCadastro?.cest,
        preco_medio: consulta.sugestaoCadastro?.preco_medio,
        confianca: consulta.sugestaoCadastro?.confianca
      },
      podeCadastrarAutomatico: Boolean(
        consulta.encontradoPorGtin
        || (consulta.sugestaoCadastro?.confianca || 0) >= 60
      )
    };
  }
}

/**
 * Helper estático para MIIP sem acoplar singleton no bootstrap.
 */
async function consultarGrafoMiip(db, item, contexto) {
  const KnowledgeService = require('./KnowledgeService');
  const ks = KnowledgeService.getInstance(db);
  const bridge = new MiipKnowledgeBridge(ks);
  return bridge.enriquecer(item, contexto);
}

module.exports = { MiipKnowledgeBridge, consultarGrafoMiip };
