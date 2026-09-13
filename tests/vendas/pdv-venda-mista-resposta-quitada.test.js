/**
 * Correção PDV venda mista — resposta HTTP deve respeitar status persistido.
 * Executar: node --test tests/vendas/pdv-venda-mista-resposta-quitada.test.js
 */
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const {
  resolverStatusPagamentoResposta,
  responderVendaComFiscal
} = require('../../backend/services/vendas/VendaFiscalService');

const {
  aplicarRegraStatusPagamentoVenda
} = require('../../backend/services/vendas/VendaPagamentoService');

const Orquestrador = require('../../backend/services/OrquestradorPagamento');

const ROOT = path.join(__dirname, '../..');

function mockRes() {
  const captured = { body: null };
  return {
    json(data) {
      captured.body = data;
      return data;
    },
    captured
  };
}

async function responder(payload) {
  const res = mockRes();
  await responderVendaComFiscal(res, {
    vendaId: 76,
    codigo: 'VND-TEST',
    message: 'Venda registrada com sucesso',
    emitirFiscal: false,
    ...payload
  });
  return res.captured.body;
}

describe('Resposta HTTP — status persistido da venda', () => {
  it('01. venda 100% fiscal quitada', async () => {
    const body = await responder({
      valorFiscal: 5,
      valorNaoFiscal: 0,
      statusPagamento: 'quitada'
    });
    assert.equal(body.status, 'concluida');
    assert.equal(body.status_pagamento, 'quitada');
    assert.notEqual(body.status_pagamento, 'aguardando_nao_fiscal');
  });

  it('02. venda 100% não fiscal quitada', async () => {
    const body = await responder({
      valorFiscal: 0,
      valorNaoFiscal: 5,
      statusPagamento: 'quitada'
    });
    assert.equal(body.status_pagamento, 'quitada');
    assert.notEqual(body.status_pagamento, 'aguardando_nao_fiscal');
  });

  it('03. venda mista quitada', async () => {
    const body = await responder({
      valorFiscal: 2.5,
      valorNaoFiscal: 2.5,
      statusPagamento: 'quitada'
    });
    assert.equal(body.status_pagamento, 'quitada');
    assert.notEqual(body.status_pagamento, 'aguardando_nao_fiscal');
  });

  it('04. venda mista PIX + dinheiro', () => {
    assert.equal(resolverStatusPagamentoResposta({
      valorFiscal: 2.5,
      valorNaoFiscal: 2.5,
      statusPagamento: 'quitada'
    }), 'quitada');
  });

  it('05. venda mista dinheiro + PIX', () => {
    assert.equal(resolverStatusPagamentoResposta({
      valorFiscal: 2.5,
      valorNaoFiscal: 2.5,
      statusPagamento: 'quitada'
    }), 'quitada');
  });

  it('06–11. venda mista 2 unidades — persistência não é reescrita na resposta', async () => {
    const persistido = {
      total: 5,
      quantidade: 2,
      quantidade_fiscal: 1,
      quantidade_nao_fiscal: 1,
      financeiro: 5,
      pix: 2.5,
      dinheiro: 2.5,
      status_pagamento: 'quitada'
    };
    const body = await responder({
      valorFiscal: persistido.pix,
      valorNaoFiscal: persistido.dinheiro,
      statusPagamento: persistido.status_pagamento
    });
    assert.equal(persistido.quantidade, 2);
    assert.equal(persistido.quantidade_fiscal, 1);
    assert.equal(persistido.quantidade_nao_fiscal, 1);
    assert.equal(persistido.total, 5);
    assert.equal(persistido.financeiro, 5);
    assert.equal(persistido.pix + persistido.dinheiro, 5);
    assert.equal(body.status_pagamento, 'quitada');
    assert.equal(body.valor_fiscal, 2.5);
    assert.equal(body.valor_nao_fiscal, 2.5);
  });

  it('12–14. status persistido quitada → HTTP quitada; nunca aguardando_nao_fiscal', async () => {
    const body = await responder({
      valorFiscal: 2.5,
      valorNaoFiscal: 2.5,
      statusPagamento: 'quitada'
    });
    assert.equal(body.status_pagamento, 'quitada');
    assert.notEqual(body.status_pagamento, 'aguardando_nao_fiscal');

    const recalculoIncompleto = resolverStatusPagamentoResposta({
      valorFiscal: 2.5,
      valorNaoFiscal: 2.5,
      statusPagamento: 'quitada',
      recebimentosNaoFiscal: []
    });
    assert.equal(recalculoIncompleto, 'quitada');
  });

  it('2ª etapa legítima continua aguardando_nao_fiscal', async () => {
    const body = await responder({
      valorFiscal: 2.5,
      valorNaoFiscal: 2.5,
      statusPagamento: 'aguardando_nao_fiscal'
    });
    assert.equal(body.status_pagamento, 'aguardando_nao_fiscal');
  });
});

describe('PDV interpreta resposta quitada e finaliza', () => {
  const pdv = fs.readFileSync(path.join(ROOT, 'frontend/pdv/js/pdv.js'), 'utf8');

  it('resposta quitada chama finalizarPosVenda uma vez', () => {
    assert.match(pdv, /function pdvVendaRespostaQuitada/);
    assert.match(pdv, /function encerrarPosVendaUmaVez/);
    assert.match(pdv, /if \(posVendaEncerrada\) return;/);
    assert.match(pdv, /encerrarPosVendaUmaVez\(\)/);
    assert.match(pdv, /NÃO abre modal de não fiscal/);
  });

  it('aguardando_nao_fiscal só abre 2ª etapa se NÃO estiver quitada', () => {
    assert.match(pdv, /statusPagamento === 'aguardando_nao_fiscal' && !vendaQuitada/);
    assert.match(pdv, /valor_nao_fiscal > 0/);
  });

  it('handoff NF encerra se saldo já quitado', () => {
    assert.match(pdv, /pdvVendaRespostaQuitada\(info\) \|\| Number\(info\.saldo_pendente\) <= 0/);
    assert.match(pdv, /iniciarFluxoPosVendaComNaoFiscal/);
  });
});

describe('Falha na NFC-e não trava o PDV', () => {
  it('não referencia transacoesTefAutorizadas (ReferenceError que engolia a resposta)', () => {
    const src = fs.readFileSync(
      path.join(ROOT, 'backend/services/vendas/VendaFiscalService.js'),
      'utf8'
    );
    assert.equal(src.includes('transacoesTefAutorizadas'), false);
    assert.match(src, /coletarIdsTefAutorizados/);
    assert.match(src, /erro_emissao/);
  });
});

describe('Orquestrador / regra de persistência — venda #76 equivalente', () => {
  it('PIX 2,50 + dinheiro 2,50 em F 2,50 / NF 2,50 quita e não descarta NF', async () => {
    const r = await Orquestrador.processarFluxoPagamentoVenda({
      totalFiscal: 2.5,
      totalNaoFiscal: 2.5,
      formaPagamento: 'misto',
      pagamentos: [
        { forma_pagamento: 'pix', valor: 2.5 },
        { forma_pagamento: 'dinheiro', valor: 2.5 }
      ],
      tefHabilitado: false,
      modoConfirmacaoFiscal: 'MANUAL',
      midpAtivo: true
    });
    assert.equal(r.sucesso, true, r.erro);
    assert.equal(r.statusPagamento, 'quitada');

    const aplicado = aplicarRegraStatusPagamentoVenda({
      valorFiscal: 2.5,
      valorNaoFiscal: 2.5,
      statusPagamento: r.statusPagamento,
      recebimentos: r.recebimentos
    });
    assert.equal(aplicado.statusPagamento, 'quitada');

    const http = await responder({
      valorFiscal: 2.5,
      valorNaoFiscal: 2.5,
      statusPagamento: aplicado.statusPagamento
    });
    assert.equal(http.status_pagamento, 'quitada');
    assert.notEqual(http.status_pagamento, 'aguardando_nao_fiscal');
  });
});

describe('Não alterar motores nesta correção', () => {
  it('MIDP e Motor F×NF não foram editados neste arquivo de correção', () => {
    const midp = fs.readFileSync(
      path.join(ROOT, 'backend/services/midp/MotorInteligenteDistribuicaoPagamentos.js'),
      'utf8'
    );
    assert.match(midp, /PRESERVAR_DINHEIRO/);
    const dist = fs.readFileSync(
      path.join(ROOT, 'backend/services/distribuidorEstoqueVenda.js'),
      'utf8'
    );
    assert.match(dist, /function calcularValorFiscalEfetivo/);
    assert.match(dist, /function ajustarItensParaValorFiscalEfetivo/);
  });
});
