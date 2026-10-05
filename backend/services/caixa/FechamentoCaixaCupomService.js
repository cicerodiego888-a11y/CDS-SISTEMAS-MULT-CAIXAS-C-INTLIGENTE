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

function colunasDoPapel(papelMm) {
  return papelMm === 58 ? 32 : 48;
}

function quebrar(texto, largura) {
  const bruto = String(texto ?? '').trim();
  if (!bruto) return [''];
  if (bruto.length <= largura) return [bruto];
  const linhas = [];
  let atual = '';
  for (const palavra of bruto.split(/\s+/)) {
    if (palavra.length > largura) {
      if (atual) linhas.push(atual);
      for (let i = 0; i < palavra.length; i += largura) {
        linhas.push(palavra.slice(i, i + largura));
      }
      atual = '';
      continue;
    }
    const candidato = atual ? `${atual} ${palavra}` : palavra;
    if (candidato.length <= largura) atual = candidato;
    else {
      if (atual) linhas.push(atual);
      atual = palavra;
    }
  }
  if (atual) linhas.push(atual);
  return linhas.length ? linhas : [''];
}

function centro(texto, cols) {
  const s = String(texto ?? '');
  if (s.length >= cols) return s.slice(0, cols);
  return ' '.repeat(Math.floor((cols - s.length) / 2)) + s;
}

function blocoCentro(texto, cols) {
  return quebrar(texto, cols).map((parte) => centro(parte, cols));
}

/**
 * O valor fica inteiro no fim da linha. Se não couber junto com o rótulo,
 * o rótulo é que encolhe. Valor maior que a linha quebra na linha seguinte.
 */
function comporLinha(label, valor, cols) {
  const right = String(valor ?? '');
  const left = String(label ?? '');
  if (right.length >= cols) {
    return [...(left ? quebrar(left, cols) : []), ...quebrar(right, cols)];
  }
  const gap = cols - left.length - right.length;
  if (gap >= 1) return [left + ' '.repeat(gap) + right];
  const maxLeft = Math.max(0, cols - right.length - 1);
  const leftCut = left.slice(0, maxLeft);
  const espacos = Math.max(1, cols - leftCut.length - right.length);
  return [leftCut + ' '.repeat(espacos) + right];
}

function linhaForma(label, qtd, valor, cols, sempre) {
  const q = Number(qtd || 0);
  const v = n(valor);
  if (q <= 0 && v <= 0 && !sempre) return [];
  return comporLinha(`${label} (${q})`, dinheiro(v), cols);
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
  const papelMm = Number(extras.papel_mm) === 58 ? 58 : 80;
  const cols = colunasDoPapel(papelMm);
  const totalPagamentos = n(c.totais?.recebido_por_pagamentos ?? c.totais?.recebido);
  const sep = '-'.repeat(cols);
  const L = (label, valor) => comporLinha(label, valor, cols);

  const temEntregas = n(e.quantidade_total) > 0 || n(e.valor_total) > 0;
  const temCancelamentos = n(canc.quantidade) > 0;

  const formas = [
    linhaForma('Dinheiro', pc.dinheiro, p.dinheiro, cols, true),
    linhaForma('PIX', pc.pix, p.pix, cols, true),
    linhaForma('Débito', pc.debito, p.debito, cols, true),
    linhaForma('Crédito', pc.credito, p.credito, cols, true),
    linhaForma('TEF', pc.tef, p.tef, cols, true),
    linhaForma('Prazo', pc.prazo, p.prazo, cols, true),
    linhaForma('Outros', pc.outros, p.outros, cols, true)
  ].flat();

  const linhas = [
    ...blocoCentro(empresaNome, cols),
    ...(empresaCnpj ? blocoCentro(`CNPJ ${empresaCnpj}`, cols) : []),
    sep,
    centro('FECHAMENTO DE CAIXA', cols),
    ...(reimpressao ? [centro('*** REIMPRESSÃO ***', cols)] : []),
    '',
    ...L('Caixa:', String(caixaId)),
    ...L('Terminal:', String(terminalNome)),
    ...L('Operador:', String(operadorNome)),
    ...L('Abertura:', aberturaEm),
    ...L('Fechamento:', fechamentoEm),
    '',
    centro('RESUMO DO PERÍODO', cols),
    ...L('Qtd. vendas:', String(v.quantidade || 0)),
    ...L('Total bruto:', dinheiro(v.bruto)),
    ...L('Descontos:', dinheiro(v.descontos)),
    ...L('Acréscimos:', dinheiro(v.acrescimos)),
    ...L('Total vendido:', dinheiro(c.totais?.vendido != null ? c.totais.vendido : v.total_vendido || v.liquido)),
    ...L('Total recebido:', dinheiro(c.totais?.recebido)),
    ...L('Total pendente:', dinheiro(c.totais?.pendente != null ? c.totais.pendente : 0)),
    '',
    centro('FORMAS DE PAGAMENTO', cols),
    ...(formas.length ? formas : ['Sem recebimentos.']),
    sep,
    ...L('TOTAL', dinheiro(totalPagamentos)),
    '',
    centro('VENDAS PARA ENTREGA', cols),
    ...(temEntregas
      ? [
        ...L('Prestadas:', String(e.quantidade_prestada || 0)),
        ...L('Recebido:', dinheiro(e.valor_prestado)),
        ...L('Pendentes:', String(e.quantidade_pendente || 0)),
        ...L('A receber:', dinheiro(e.valor_pendente)),
        sep,
        ...L('Total entregas:', dinheiro(e.valor_total))
      ]
      : ['Nenhuma venda para entrega.']),
    '',
    centro('MOVIMENTAÇÕES', cols),
    ...L('Saldo inicial:', dinheiro(d.saldo_inicial)),
    ...L('Suprimentos:', dinheiro(m.suprimentos)),
    ...L('Sangrias:', dinheiro(m.sangrias)),
    '',
    centro('CONFERÊNCIA DO CAIXA', cols),
    ...L('Dinheiro recebido:', dinheiro(d.vendas_dinheiro)),
    ...L('Saldo inicial:', dinheiro(d.saldo_inicial)),
    ...L('Suprimentos:', dinheiro(d.suprimentos)),
    ...L('Sangrias:', dinheiro(d.sangrias)),
    sep,
    ...L('Dinheiro esperado:', dinheiro(d.esperado)),
    ...L('Dinheiro conferido:', dinheiro(c.caixa_fisico?.dinheiro_conferido != null ? c.caixa_fisico.dinheiro_conferido : d.informado)),
    ...L('Diferença:', dinheiro(d.diferenca)),
    ...L('Retirada fechamento:', dinheiro(c.caixa_fisico?.retirada_fechamento || c.fechamento?.retirada_fechamento || 0)),
    ...L('Saldo final:', dinheiro(c.caixa_fisico?.saldo_final != null ? c.caixa_fisico.saldo_final : c.fechamento?.saldo_final))
  ];

  if (c.reconciliacao) {
    linhas.push(
      '',
      centro('RECONCILIAÇÃO', cols),
      ...L('Vendas OK:', String(c.reconciliacao.vendas_ok || 0)),
      ...L('Parciais:', String(c.reconciliacao.vendas_parciais || 0)),
      ...L('Pendentes:', String(c.reconciliacao.vendas_pendentes || 0)),
      ...L('Inconsistentes:', String(c.reconciliacao.vendas_inconsistentes || 0))
    );
  }

  if (temCancelamentos) {
    linhas.push(
      '',
      centro('CANCELAMENTOS', cols),
      ...L('Quantidade:', String(canc.quantidade)),
      ...L('Valor:', dinheiro(canc.valor))
    );
  }

  if (n(v.fiscal) > 0 || n(v.nao_fiscal) > 0) {
    linhas.push(
      '',
      centro('FISCAL / NÃO FISCAL', cols),
      ...L('Fiscal:', dinheiro(v.fiscal)),
      ...L('Não fiscal:', dinheiro(v.nao_fiscal)),
      ...L('Total:', dinheiro(n(v.fiscal) + n(v.nao_fiscal)))
    );
  }

  linhas.push(
    sep,
    ...blocoCentro('FECHAMENTO REALIZADO EM', cols),
    ...blocoCentro(fechamentoEm, cols),
    '',
    ...blocoCentro(`Operador: ${operadorNome}`, cols),
    '',
    ...blocoCentro('Documento de conferência do caixa.', cols)
  );

  const corpo = linhas.map((linha) => escapeHtml(linha)).join('\n');

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8" />
  <title>Fechamento de Caixa #${escapeHtml(caixaId)}</title>
  <style>
    @page { margin: 0; }
    html, body { margin: 0; padding: 0; background: #fff; color: #000; }
    pre.cupom-fechamento {
      font-family: Consolas, "Courier New", monospace;
      font-size: 10px;
      font-weight: 700;
      line-height: 1.2;
      color: #000;
      background: #fff;
      width: ${cols}ch;
      max-width: ${cols}ch;
      margin: 0;
      padding: 1.5mm 0.5mm 2mm;
      white-space: pre;
      letter-spacing: 0;
      overflow: visible;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
  </style>
</head>
<body class="fechamento-caixa-${papelMm}">
<pre class="cupom-fechamento">${corpo}</pre>
</body>
</html>`;
}

module.exports = {
  gerarHtmlCupomFechamento,
  dinheiro,
  formatarDataHora,
  escapeHtml
};
