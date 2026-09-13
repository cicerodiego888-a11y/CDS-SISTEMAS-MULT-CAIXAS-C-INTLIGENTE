'use strict';

/**
 * Forecast Engine — previsões simples (média móvel / tendência linear leve).
 * Não substitui BI externo; gera sinais acionáveis para o CIP.
 */
class ForecastEngine {
  /**
   * @param {Array<{ dia: string, vendas: number }>} serie
   * @param {number} [diasFuturos=7]
   */
  preverVendas(serie = [], diasFuturos = 7) {
    const pontos = (serie || []).map((s) => Number(s.vendas) || 0);
    if (!pontos.length) {
      return { mediaDiaria: 0, previsao: [], tendencia: 'estavel', confianca: 0 };
    }
    const media = pontos.reduce((a, b) => a + b, 0) / pontos.length;
    const half = Math.floor(pontos.length / 2) || 1;
    const m1 = pontos.slice(0, half).reduce((a, b) => a + b, 0) / half;
    const m2 = pontos.slice(-half).reduce((a, b) => a + b, 0) / half;
    const tendencia = m2 > m1 * 1.08 ? 'alta' : m2 < m1 * 0.92 ? 'baixa' : 'estavel';
    const fator = tendencia === 'alta' ? 1.05 : tendencia === 'baixa' ? 0.95 : 1;
    const previsao = [];
    const base = new Date();
    for (let i = 1; i <= diasFuturos; i += 1) {
      const d = new Date(base);
      d.setDate(d.getDate() + i);
      previsao.push({
        dia: d.toISOString().slice(0, 10),
        vendasEstimadas: Number((media * fator).toFixed(2))
      });
    }
    return {
      mediaDiaria: Number(media.toFixed(2)),
      previsao,
      tendencia,
      confianca: Math.min(90, 40 + pontos.length * 1.5)
    };
  }

  /**
   * Estima dias até ruptura com base em consumo médio.
   * @param {{ estoque_atual: number, consumo_diario?: number }} produto
   */
  preverEstoque(produto) {
    const estoque = Number(produto.estoque_atual) || 0;
    const consumo = Math.max(0.01, Number(produto.consumo_diario) || 0);
    if (consumo <= 0) {
      return { diasAteRuptura: null, risco: estoque <= 0 ? 'alto' : 'baixo' };
    }
    const dias = estoque / consumo;
    return {
      diasAteRuptura: Number(dias.toFixed(1)),
      risco: dias <= 3 ? 'alto' : dias <= 7 ? 'medio' : 'baixo'
    };
  }

  /**
   * Sazonalidade mensal a partir de agregados { mes, qtd }.
   */
  sazonalidade(mensal = []) {
    if (!mensal.length) return { picos: [], vale: [] };
    const sorted = [...mensal].sort((a, b) => (b.qtd || 0) - (a.qtd || 0));
    return {
      picos: sorted.slice(0, 3),
      vale: sorted.slice(-2).reverse()
    };
  }

  /**
   * Fluxo de caixa simplificado: entradas previstas − vencidos.
   */
  preverFluxoCaixa(financeiro = {}) {
    const entrada = Number(financeiro.valorAVencer7d) || 0;
    const risco = Number(financeiro.valorVencido) || 0;
    return {
      entradas7d: entrada,
      riscoVencido: risco,
      liquidoEstimado7d: Number((entrada - risco * 0.3).toFixed(2)),
      alerta: risco > entrada ? 'pressao_caixa' : 'ok'
    };
  }

  /**
   * Pacote de forecast a partir dos sinais coletados.
   */
  gerar(sinais = {}) {
    const vendas = this.preverVendas(sinais.vendas?.serie30d || [], 7);
    const fluxo = this.preverFluxoCaixa(sinais.financeiro || {});
    const estoqueCritico = (sinais.estoque?.criticos || []).slice(0, 10).map((p) => {
      const consumo = Math.max(0.5, (Number(p.estoque_minimo) || 1) / 7);
      return {
        produto_id: p.id,
        nome: p.nome,
        ...this.preverEstoque({ estoque_atual: p.estoque_atual, consumo_diario: consumo })
      };
    });
    return {
      vendas,
      fluxoCaixa: fluxo,
      estoque: estoqueCritico,
      compras: {
        sugerirPedidos: estoqueCritico.filter((e) => e.risco === 'alto' || e.risco === 'medio').length,
        mensagem: 'Baseado em ruptura estimada — gerar sugestão via AutomationEngine'
      }
    };
  }
}

module.exports = ForecastEngine;
