'use strict';

/**
 * Recommendation Hub — central única.
 * Agrega recomendações CIP (regras/forecast) + MIB Knowledge (sem duplicar grafo).
 */
class RecommendationHub {
  /**
   * @param {{
   *   regras: object[],
   *   forecast: object,
   *   mibKnowledge?: object,
   *   contexto?: object
   * }} input
   */
  consolidar(input = {}) {
    const lista = [];
    const pesos = input.contexto?.pesos || {};

    for (const r of input.regras || []) {
      lista.push({
        id: `regra:${r.regra}:${r.produto_id || r.titulo}`,
        fonte: r.origemMotor || 'CIP',
        tipo: r.tipo,
        titulo: r.titulo,
        mensagem: r.mensagem,
        severidade: r.severidade,
        score: this._scoreSeveridade(r.severidade) * (1 + (pesos.risco || 0)),
        produto_id: r.produto_id || null
      });
    }

    // Forecast → recomendações de estoque
    for (const e of input.forecast?.estoque || []) {
      if (e.risco === 'alto' || e.risco === 'medio') {
        lista.push({
          id: `forecast:estoque:${e.produto_id}`,
          fonte: 'CIP.Forecast',
          tipo: 'previsao',
          titulo: 'Estoque ficará insuficiente',
          mensagem: e.diasAteRuptura != null
            ? `"${e.nome}" pode romper em ~${e.diasAteRuptura} dia(s).`
            : `"${e.nome}" com risco de ruptura.`,
          severidade: e.risco === 'alto' ? 'alta' : 'media',
          score: e.risco === 'alto' ? 90 : 70,
          produto_id: e.produto_id
        });
      }
    }

    if (input.forecast?.fluxoCaixa?.alerta === 'pressao_caixa') {
      lista.push({
        id: 'forecast:caixa',
        fonte: 'CIP.Forecast',
        tipo: 'risco',
        titulo: 'Pressão de caixa prevista',
        mensagem: 'Valor vencido supera entradas estimadas dos próximos 7 dias.',
        severidade: 'alta',
        score: 85
      });
    }

    // MIB Knowledge — recomendações já produzidas pelo grafo (não recalcular)
    const topRel = input.mibKnowledge?.topRelacoes || [];
    for (const rel of topRel.slice(0, 5)) {
      if (rel.relacao === 'VENDIDO_JUNTO' || rel.relacao === 'SIMILAR') {
        lista.push({
          id: `mib:${rel.from_id}:${rel.to_id}`,
          fonte: 'MIB',
          tipo: 'oportunidade',
          titulo: 'Produto semelhante / complemento disponível',
          mensagem: `${rel.from_label || rel.from_id} ↔ ${rel.to_label || rel.to_id} (${rel.relacao})`,
          severidade: 'baixa',
          score: 40 + Number(rel.peso || 1)
        });
      }
    }

    // Ordena por score × peso de contexto
    lista.sort((a, b) => (b.score || 0) - (a.score || 0));
    return lista.slice(0, 50);
  }

  _scoreSeveridade(sev) {
    if (sev === 'alta') return 90;
    if (sev === 'media') return 60;
    return 35;
  }
}

module.exports = RecommendationHub;
