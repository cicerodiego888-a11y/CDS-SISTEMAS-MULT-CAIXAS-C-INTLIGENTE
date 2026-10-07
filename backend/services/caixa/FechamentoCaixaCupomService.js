/**
 * Cupom térmico 58/80mm — Fechamento de Caixa.
 */

'use strict';

function n(valor) {
  const v = Number(valor);
  return Number.isFinite(v) ? v : 0;
}

function dinheiro(valor) {
  return n(valor).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function escapeHtml(texto) {
  return String(texto ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatarDataHora(valor) {
  if (!valor) return '—';
  const s = String(valor).trim();
  // SQLite local: YYYY-MM-DD HH:MM:SS
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/);
  if (m) {
    return `${m[3]}/${m[2]}/${m[1]} ${m[4]}:${m[5]}`;
  }
  try {
    const d = new Date(s);
    if (!Number.isNaN(d.getTime())) {
      return d.toLocaleString('pt-BR', { timeZone: 'America/Fortaleza' });
    }
  } catch (_) { /* ignore */ }
  return s;
}

const geo = require('../termico/geometriaCupom80');

function linhaForma(label, qtd, valor, sempre) {
  const q = Number(qtd || 0);
  const v = n(valor);
  if (q <= 0 && v <= 0 && !sempre) return '';
  return geo.linha(`${label} (${q})`, dinheiro(v));
}

/**
 * @param {object} consolidacao — saída de FechamentoCaixaResumoService
 * @param {object} [extras]
 */
function gerarHtmlCupomFechamento(consolidacao, extras = {}) {
  const c = consolidacao || {};
  const p = c.pagamentos || {};
  const pc = c.pagamentos_contagem || {};
  const e = c.entregas || {};
  const d = c.dinheiro || {};
  const v = c.vendas || {};
  const m = c.movimentacoes || {};
  const canc = c.cancelamentos || {};
  const empresaNome = extras.empresa_nome || c.empresa?.nome || 'CDS Sistemas';
  const empresaCnpj = extras.empresa_cnpj || c.empresa?.cnpj || '';
  const caixaId = c.caixa?.id ?? extras.caixa_id ?? '—';
  const terminalNome = c.terminal?.nome || extras.terminal_nome || (c.terminal?.id ? `Terminal ${c.terminal.id}` : '—');
  const operadorNome = c.operador?.nome || extras.operador_nome || '—';
  const aberturaEm = formatarDataHora(c.abertura?.em || c.periodo?.aberto_em);
  const fechamentoEm = formatarDataHora(c.fechamento?.em || c.periodo?.fechado_em || extras.fechado_em);
  const reimpressao = extras.reimpressao === true;
  const papelMm = geo.papelMmDe(extras.papel_mm);
  const totalPagamentos = n(c.totais?.recebido_por_pagamentos ?? c.totais?.recebido);
  const L = (label, valor, extra) => geo.linha(label, valor, extra);

  const temEntregas = n(e.quantidade_total) > 0 || n(e.valor_total) > 0;
  const temCancelamentos = n(canc.quantidade) > 0;

  const formas = [
    linhaForma('Dinheiro', pc.dinheiro, p.dinheiro, true),
    linhaForma('PIX', pc.pix, p.pix, true),
    linhaForma('Débito', pc.debito, p.debito, true),
    linhaForma('Crédito', pc.credito, p.credito, true),
    linhaForma('TEF', pc.tef, p.tef, true),
    linhaForma('Prazo', pc.prazo, p.prazo, true),
    linhaForma('Outros', pc.outros, p.outros, true)
  ].filter(Boolean);

  const partes = [
    geo.centro(empresaNome, 'empresa'),
    empresaCnpj ? geo.centro(`CNPJ ${empresaCnpj}`, 'meta') : '',
    geo.sep(),
    geo.centro('FECHAMENTO DE CAIXA', 'titulo'),
    reimpressao ? geo.centro('*** REIMPRESSÃO ***', 'aviso') : '',
    L('Caixa:', String(caixaId)),
    L('Terminal:', String(terminalNome)),
    L('Operador:', String(operadorNome)),
    L('Abertura:', aberturaEm),
    L('Fechamento:', fechamentoEm),
    geo.centro('RESUMO DO PERÍODO'),
    L('Qtd. vendas:', String(v.quantidade || 0)),
    L('Total bruto:', dinheiro(v.bruto)),
    L('Descontos:', dinheiro(v.descontos)),
    L('Acréscimos:', dinheiro(v.acrescimos)),
    L('Total vendido:', dinheiro(c.totais?.vendido != null ? c.totais.vendido : v.total_vendido || v.liquido), 'total'),
    L('Total recebido:', dinheiro(c.totais?.recebido), 'total'),
    L('Total pendente:', dinheiro(c.totais?.pendente != null ? c.totais.pendente : 0), 'total'),
    geo.centro('FORMAS DE PAGAMENTO'),
    formas.length ? formas.join('') : geo.texto('Sem recebimentos.'),
    geo.sep(),
    L('TOTAL', dinheiro(totalPagamentos), 'total'),
    geo.centro('VENDAS PARA ENTREGA'),
    temEntregas
      ? [
        L('Prestadas:', String(e.quantidade_prestada || 0)),
        L('Recebido:', dinheiro(e.valor_prestado)),
        L('Pendentes:', String(e.quantidade_pendente || 0)),
        L('A receber:', dinheiro(e.valor_pendente)),
        geo.sep(),
        L('Total entregas:', dinheiro(e.valor_total))
      ].join('')
      : geo.texto('Nenhuma venda para entrega.'),
    geo.centro('MOVIMENTAÇÕES'),
    L('Saldo inicial:', dinheiro(d.saldo_inicial)),
    L('Suprimentos:', dinheiro(m.suprimentos)),
    L('Sangrias:', dinheiro(m.sangrias)),
    geo.centro('CONFERÊNCIA DO CAIXA'),
    L('Dinheiro recebido:', dinheiro(d.vendas_dinheiro)),
    L('Saldo inicial:', dinheiro(d.saldo_inicial)),
    L('Suprimentos:', dinheiro(d.suprimentos)),
    L('Sangrias:', dinheiro(d.sangrias)),
    geo.sep(),
    L('Dinheiro esperado:', dinheiro(d.esperado)),
    L('Dinheiro conferido:', dinheiro(c.caixa_fisico?.dinheiro_conferido != null ? c.caixa_fisico.dinheiro_conferido : d.informado)),
    L('Diferença:', dinheiro(d.diferenca), 'total'),
    L('Retirada fechamento:', dinheiro(c.caixa_fisico?.retirada_fechamento || c.fechamento?.retirada_fechamento || 0), 'total'),
    L('Saldo final:', dinheiro(c.caixa_fisico?.saldo_final != null ? c.caixa_fisico.saldo_final : c.fechamento?.saldo_final), 'total')
  ];

  if (c.reconciliacao) {
    partes.push(
      geo.centro('RECONCILIAÇÃO'),
      L('Vendas OK:', String(c.reconciliacao.vendas_ok || 0)),
      L('Parciais:', String(c.reconciliacao.vendas_parciais || 0)),
      L('Pendentes:', String(c.reconciliacao.vendas_pendentes || 0)),
      L('Inconsistentes:', String(c.reconciliacao.vendas_inconsistentes || 0))
    );
  }

  if (temCancelamentos) {
    partes.push(
      geo.centro('CANCELAMENTOS'),
      L('Quantidade:', String(canc.quantidade)),
      L('Valor:', dinheiro(canc.valor))
    );
  }

  if (n(v.fiscal) > 0 || n(v.nao_fiscal) > 0) {
    partes.push(
      geo.centro('FISCAL / NÃO FISCAL'),
      L('Fiscal:', dinheiro(v.fiscal)),
      L('Não fiscal:', dinheiro(v.nao_fiscal)),
      L('Total:', dinheiro(n(v.fiscal) + n(v.nao_fiscal)))
    );
  }

  partes.push(
    geo.sep(),
    geo.centro('FECHAMENTO REALIZADO EM', 'sec'),
    geo.centro(fechamentoEm, 'txt'),
    geo.texto(`Operador: ${operadorNome}`),
    geo.texto('Documento de conferência do caixa.')
  );

  const html = geo.documento({
    titulo: `Fechamento de Caixa #${caixaId}`,
    classe: `fechamento-caixa-${papelMm}`,
    corpo: partes.join(''),
    papelMm
  });
  if (papelMm !== 80) return html;
  const tipo = `<style id="cds-fechamento-tipo">
  body.fechamento-caixa-80 .cds-cupom-termico {
    font-family: "Courier New", Courier, monospace;
    font-size: 12px;
    line-height: 1.22;
  }
  body.fechamento-caixa-80 .empresa { font-size: 14px; font-weight: 700; line-height: 1.15; }
  body.fechamento-caixa-80 .meta { font-size: 12px; }
  body.fechamento-caixa-80 .titulo,
  body.fechamento-caixa-80 .sec { font-size: 13px; font-weight: 700; line-height: 1.2; margin: 0.8mm 0 0.3mm; }
  body.fechamento-caixa-80 .total .rotulo,
  body.fechamento-caixa-80 .total .valor { font-size: 13px; font-weight: 700; }
</style>`;
  return html.replace('</head>', `${tipo}</head>`);
}

module.exports = {
  gerarHtmlCupomFechamento,
  dinheiro,
  formatarDataHora,
  escapeHtml
};
