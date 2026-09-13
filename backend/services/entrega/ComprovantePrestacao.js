/**
 * Comprovante de Prestação de Contas (Sprint 3)
 */

const { agoraLocalBrasil } = require('../vendas/VendaFinanceiroService');

function fmt(n) {
  return Number(n || 0).toFixed(2).replace('.', ',');
}

function montarHtmlComprovantePrestacao(dados = {}) {
  const agora = agoraLocalBrasil();
  const data = agora.slice(0, 10);
  const hora = agora.includes('T') ? agora.slice(11, 19) : (agora.slice(11, 19) || '');

  const formas = Array.isArray(dados.formas_pagamento) ? dados.formas_pagamento : [];
  const linhasFormas = formas.length
    ? formas.map((p) => `
        <tr>
          <td>${String(p.forma_pagamento || '').toUpperCase()}</td>
          <td style="text-align:right">R$ ${fmt(p.valor)}</td>
        </tr>`).join('')
    : `<tr><td>${String(dados.pagamento_recebido || '—')}</td><td style="text-align:right">R$ ${fmt(dados.valor)}</td></tr>`;

  return `<!DOCTYPE html>
<html lang="pt-BR"><head><meta charset="utf-8">
<title>Comprovante de Prestação</title>
<style>
  body{font-family:monospace;font-size:12px;width:280px;margin:0 auto;padding:8px;}
  h1{font-size:14px;text-align:center;margin:0 0 8px;}
  .muted{color:#444;font-size:11px;text-align:center;}
  table{width:100%;border-collapse:collapse;margin:6px 0;}
  td{padding:2px 0;}
  .ok{margin-top:10px;text-align:center;font-weight:bold;border-top:1px dashed #000;padding-top:8px;}
</style></head><body>
  <h1>COMPROVANTE DE PRESTAÇÃO</h1>
  <div class="muted">${dados.empresa || dados.nome_empresa || 'CDS Sistemas'}</div>
  <div class="muted">${dados.cnpj ? `CNPJ ${dados.cnpj}` : ''}</div>
  <hr>
  <div><strong>Pedido:</strong> ${dados.pedido || dados.codigo || '—'}</div>
  <div><strong>Cliente:</strong> ${dados.cliente || 'Consumidor'}</div>
  <div><strong>Valor:</strong> R$ ${fmt(dados.valor)}</div>
  <div><strong>Pagamento previsto:</strong> ${dados.pagamento_previsto || '—'}</div>
  <div><strong>Pagamento recebido:</strong> ${dados.pagamento_recebido || '—'}</div>
  <table><tbody>${linhasFormas}</tbody></table>
  <div><strong>Documento:</strong> ${dados.documento || 'NAO_FISCAL'}</div>
  <div><strong>Troco levado:</strong> R$ ${fmt(dados.troco_levado)}</div>
  <div><strong>Troco devolvido:</strong> R$ ${fmt(dados.troco_devolvido)}</div>
  <div><strong>Maquineta:</strong> ${dados.maquineta || 'NÃO'}</div>
  <div><strong>Entregador:</strong> ${dados.entregador || '—'}</div>
  <div><strong>Operador:</strong> ${dados.operador || '—'}</div>
  <div><strong>Data:</strong> ${data}</div>
  <div><strong>Hora:</strong> ${hora}</div>
  <div class="ok">PRESTAÇÃO DE CONTAS FINALIZADA</div>
</body></html>`;
}

module.exports = {
  montarHtmlComprovantePrestacao,
  ComprovantePrestacao: { montarHtml: montarHtmlComprovantePrestacao }
};
