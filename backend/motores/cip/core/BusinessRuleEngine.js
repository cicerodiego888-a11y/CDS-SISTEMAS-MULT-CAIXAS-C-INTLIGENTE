'use strict';

/**
 * Business Rule Engine — regras inteligentes centralizadas.
 * Produz sugestões/alertas; AutomationEngine executa ações.
 */

const REGRAS = [
  {
    id: 'estoque_minimo',
    nome: 'Estoque mínimo atingido',
    avaliar: (sinais) => {
      const itens = sinais.estoque?.criticos || [];
      return itens.map((p) => ({
        regra: 'estoque_minimo',
        tipo: 'sugestao_compra',
        severidade: 'alta',
        titulo: 'Comprar mais deste produto',
        mensagem: `Estoque de "${p.nome}" (${p.estoque_atual}) ≤ mínimo (${p.estoque_minimo}).`,
        produto_id: p.id,
        acaoSugerida: 'sugerir_pedido'
      }));
    }
  },
  {
    id: 'estoque_zerado',
    nome: 'Produtos sem estoque',
    avaliar: (sinais) => {
      const n = sinais.estoque?.produtosZerados || 0;
      if (n <= 0) return [];
      return [{
        regra: 'estoque_zerado',
        tipo: 'alerta',
        severidade: n > 20 ? 'alta' : 'media',
        titulo: 'Produtos sem estoque',
        mensagem: `${n} produto(s) com estoque zerado.`,
        acaoSugerida: 'avisar_gestor'
      }];
    }
  },
  {
    id: 'contas_vencidas',
    nome: 'Contas a receber vencidas',
    avaliar: (sinais) => {
      const n = sinais.financeiro?.contasVencidas || 0;
      const valor = sinais.financeiro?.valorVencido || 0;
      if (n <= 0) return [];
      return [{
        regra: 'contas_vencidas',
        tipo: 'risco',
        severidade: valor > 1000 ? 'alta' : 'media',
        titulo: 'Risco financeiro — contas vencidas',
        mensagem: `${n} conta(s) vencida(s) · R$ ${Number(valor).toFixed(2)}.`,
        acaoSugerida: 'criar_alerta'
      }];
    }
  },
  {
    id: 'fluxo_7d',
    nome: 'Contas a vencer em 7 dias',
    avaliar: (sinais) => {
      const n = sinais.financeiro?.contasAVencer7d || 0;
      if (n <= 0) return [];
      return [{
        regra: 'fluxo_7d',
        tipo: 'previsao',
        severidade: 'baixa',
        titulo: 'Entradas previstas (7 dias)',
        mensagem: `${n} conta(s) a vencer nos próximos 7 dias.`,
        acaoSugerida: 'gerar_tarefa'
      }];
    }
  },
  {
    id: 'fiscal_ncm',
    nome: 'Produtos fiscais sem NCM',
    avaliar: (sinais) => {
      const n = sinais.fiscal?.produtosSemNcm || 0;
      if (n <= 0) return [];
      return [{
        regra: 'fiscal_ncm',
        tipo: 'alerta',
        severidade: 'media',
        titulo: 'Conformidade fiscal',
        mensagem: `${n} produto(s) fiscal(is) sem NCM.`,
        acaoSugerida: 'criar_alerta'
      }];
    }
  },
  {
    id: 'mib_duplicados',
    nome: 'Duplicados detectados pelo MIB',
    avaliar: (sinais) => {
      const d = sinais.mib?.knowledge?.duplicados;
      if (!d) return [];
      const n = (d.produtos || 0) + (d.gtin || 0);
      if (n <= 0) return [];
      return [{
        regra: 'mib_duplicados',
        tipo: 'anomalia',
        severidade: 'media',
        titulo: 'Possíveis cadastros duplicados',
        mensagem: `MIB Knowledge apontou ${n} grupo(s) de duplicados.`,
        acaoSugerida: 'gerar_tarefa',
        origemMotor: 'MIB'
      }];
    }
  },
  {
    id: 'mib_orfaos',
    nome: 'Produtos órfãos no grafo',
    avaliar: (sinais) => {
      const orfaos = sinais.mib?.knowledge?.orfaos || 0;
      if (orfaos <= 0) return [];
      return [{
        regra: 'mib_orfaos',
        tipo: 'oportunidade',
        severidade: 'baixa',
        titulo: 'Produtos sem categoria/marca',
        mensagem: `${orfaos} produto(s) órfão(s) — enriquecer cadastro.`,
        acaoSugerida: 'gerar_tarefa',
        origemMotor: 'MIB'
      }];
    }
  }
];

class BusinessRuleEngine {
  constructor(regras = REGRAS) {
    this.regras = regras;
  }

  avaliar(sinais) {
    const out = [];
    for (const regra of this.regras) {
      try {
        const hits = regra.avaliar(sinais) || [];
        out.push(...hits);
      } catch (_) { /* regra isolada */ }
    }
    return out;
  }

  listar() {
    return this.regras.map((r) => ({ id: r.id, nome: r.nome }));
  }
}

module.exports = BusinessRuleEngine;
