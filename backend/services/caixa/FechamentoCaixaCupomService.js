/**
 * Cupom térmico 80mm — Fechamento de Caixa.
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

function linha(label, valor, opts = {}) {
  const cls = opts.strong ? 'strong' : '';
  return `<div class="linha ${cls}"><span>${escapeHtml(label)}</span><span>${escapeHtml(valor)}</span></div>`;
}

function linhaForma(label, qtd, valor) {
  const q = Number(qtd || 0);
  const v = n(valor);
  if (q <= 0 && v <= 0 && !arguments[3]) return '';
  return `<div class="linha"><span>${escapeHtml(label)} <small>(${q})</small></span><span>${dinheiro(v)}</span></div>`;
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
  const totalPagamentos = n(c.totais?.recebido_por_pagamentos ?? c.totais?.recebido);

  const temEntregas = n(e.quantidade_total) > 0 || n(e.valor_total) > 0;
  const temCancelamentos = n(canc.quantidade) > 0;

  const secoesFormas = [
    linhaForma('Dinheiro', pc.dinheiro, p.dinheiro, true),
    linhaForma('PIX', pc.pix, p.pix, true),
    linhaForma('Débito', pc.debito, p.debito, true),
    linhaForma('Crédito', pc.credito, p.credito, true),
    linhaForma('TEF', pc.tef, p.tef, true),
    linhaForma('Prazo', pc.prazo, p.prazo, true),
    linhaForma('Outros', pc.outros, p.outros, true)
  ].join('');

  const diferenca = d.diferenca;
  const diffClass = diferenca == null
    ? ''
    : (n(diferenca) > 0.009 ? 'diff-pos' : (n(diferenca) < -0.009 ? 'diff-neg' : ''));

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8" />
  <title>Fechamento de Caixa #${escapeHtml(caixaId)}</title>
  <style>
    @page { size: 80mm auto; margin: 0; }
    * { box-sizing: border-box; }
    body {
      width: 80mm;
      max-width: 80mm;
      margin: 0 auto;
      padding: 3mm 2.5mm;
      font-family: "Courier New", Courier, monospace;
      font-size: 11px;
      color: #000;
      background: #fff;
    }
    h1, h2, h3 { margin: 0; padding: 0; font-weight: 700; text-align: center; }
    h1 { font-size: 13px; margin-bottom: 2px; }
    h2 { font-size: 12px; margin: 6px 0 4px; }
    h3 { font-size: 11px; margin: 8px 0 3px; text-align: left; border-bottom: 1px dashed #000; padding-bottom: 2px; }
    .center { text-align: center; }
    .muted { color: #222; }
    .sep { border: none; border-top: 1px dashed #000; margin: 6px 0; }
    .linha {
      display: flex;
      justify-content: space-between;
      gap: 6px;
      margin: 1px 0;
      white-space: nowrap;
    }
    .linha span:first-child { overflow: hidden; text-overflow: ellipsis; }
    .linha.strong { font-weight: 700; }
    .diff-pos { font-weight: 700; }
    .diff-neg { font-weight: 700; }
    small { font-size: 10px; }
    .rodape { margin-top: 8px; text-align: center; font-size: 10px; }
    .badge { text-align: center; font-weight: 700; margin: 4px 0; }
  </style>
</head>
<body>
  <h1>${escapeHtml(empresaNome)}</h1>
  ${empresaCnpj ? `<div class="center muted">CNPJ ${escapeHtml(empresaCnpj)}</div>` : ''}
  <div class="sep"></div>
  <h2>FECHAMENTO DE CAIXA</h2>
  ${reimpressao ? '<div class="badge">*** REIMPRESSÃO ***</div>' : ''}

  ${linha('Caixa:', String(caixaId))}
  ${linha('Terminal:', String(terminalNome))}
  ${linha('Operador:', String(operadorNome))}
  ${linha('Abertura:', aberturaEm)}
  ${linha('Fechamento:', fechamentoEm)}

  <h3>RESUMO DO PERÍODO</h3>
  ${linha('Qtd. vendas:', String(v.quantidade || 0))}
  ${linha('Total bruto:', dinheiro(v.bruto))}
  ${linha('Descontos:', dinheiro(v.descontos))}
  ${linha('Acréscimos:', dinheiro(v.acrescimos))}
  ${linha('Total recebido:', dinheiro(c.totais?.recebido), { strong: true })}

  <h3>FORMAS DE PAGAMENTO</h3>
  ${secoesFormas || '<div class="muted">Sem recebimentos.</div>'}
  <div class="sep"></div>
  ${linha('TOTAL', dinheiro(totalPagamentos), { strong: true })}

  <h3>VENDAS PARA ENTREGA</h3>
  ${temEntregas ? `
    ${linha('Prestadas:', String(e.quantidade_prestada || 0))}
    ${linha('Recebido:', dinheiro(e.valor_prestado))}
    ${linha('Pendentes:', String(e.quantidade_pendente || 0))}
    ${linha('A receber:', dinheiro(e.valor_pendente), { strong: true })}
    <div class="sep"></div>
    ${linha('Total entregas:', dinheiro(e.valor_total))}
  ` : '<div class="muted">Nenhuma venda para entrega.</div>'}

  <h3>MOVIMENTAÇÕES</h3>
  ${linha('Saldo inicial:', dinheiro(d.saldo_inicial))}
  ${linha('Suprimentos:', dinheiro(m.suprimentos))}
  ${linha('Sangrias:', dinheiro(m.sangrias))}

  <h3>CONFERÊNCIA DO CAIXA</h3>
  ${linha('Dinheiro recebido:', dinheiro(d.vendas_dinheiro))}
  ${linha('Saldo inicial:', dinheiro(d.saldo_inicial))}
  ${linha('Suprimentos:', dinheiro(d.suprimentos))}
  ${linha('Sangrias:', dinheiro(d.sangrias))}
  <div class="sep"></div>
  ${linha('Dinheiro esperado:', dinheiro(d.esperado), { strong: true })}
  ${linha('Dinheiro informado:', dinheiro(d.informado))}
  <div class="linha ${diffClass}"><span>Diferença:</span><span>${dinheiro(diferenca)}</span></div>

  ${temCancelamentos ? `
    <h3>CANCELAMENTOS</h3>
    ${linha('Quantidade:', String(canc.quantidade))}
    ${linha('Valor:', dinheiro(canc.valor))}
  ` : ''}

  ${(n(v.fiscal) > 0 || n(v.nao_fiscal) > 0) ? `
    <h3>FISCAL / NÃO FISCAL</h3>
    ${linha('Fiscal:', dinheiro(v.fiscal))}
    ${linha('Não fiscal:', dinheiro(v.nao_fiscal))}
    ${linha('Total:', dinheiro(n(v.fiscal) + n(v.nao_fiscal)))}
  ` : ''}

  <div class="sep"></div>
  <div class="rodape">
    FECHAMENTO REALIZADO EM<br/>
    ${escapeHtml(fechamentoEm)}<br/><br/>
    Operador: ${escapeHtml(operadorNome)}<br/><br/>
    Documento de conferência do caixa.
  </div>
</body>
</html>`;
}

module.exports = {
  gerarHtmlCupomFechamento,
  dinheiro,
  formatarDataHora,
  escapeHtml
};
