/**
 * Prestação de contas — NFC-e pelo Motor Fiscal oficial.
 * O emissor e a SEFAZ são mocks. Nenhum documento real é transmitido.
 *
 * Executar: node --test tests/vendas-entrega/prestacao-nfce-motor-fiscal.test.js
 */

'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const {
  executarEmissaoSeMarcada,
  avaliarRepeticaoPrestacao,
  separarItensFiscais,
  resumirPagamentosDaVenda,
  validarPagamentosDoPedido,
  classificarResultadoMotorFiscal
} = require('../../backend/services/entrega/PrestacaoFiscalService');

const ROOT = path.join(__dirname, '../..');

function ler(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

function itemFiscal(valor = 20) {
  return {
    produto_id: 1,
    quantidade: 1,
    quantidade_fiscal: 1,
    quantidade_nao_fiscal: 0,
    valor_fiscal: valor,
    valor_nao_fiscal: 0
  };
}

function itemGerencial(valor = 5) {
  return {
    produto_id: 2,
    quantidade: 1,
    quantidade_fiscal: 0,
    quantidade_nao_fiscal: 1,
    valor_fiscal: 0,
    valor_nao_fiscal: valor
  };
}

function mockMotor(retorno) {
  const chamadas = [];
  return {
    chamadas,
    async emitirPorVendaId(vendaId) {
      chamadas.push(vendaId);
      return typeof retorno === 'function' ? retorno(vendaId, chamadas.length) : retorno;
    },
    async vincularNfceTransacoesVenda() {}
  };
}

describe('prestação NFC-e — Motor Fiscal oficial', () => {
  it('1. pedido marcado para NFC-e com emissão autorizada aciona o motor e só conclui com autorização', async () => {
    const motor = mockMotor({
      success: true,
      status: 'autorizada',
      numero: 120,
      chaveAcesso: '23261012345678000199650010000001201000000120',
      protocolo: '123456789012345',
      message: 'Autorizado o uso da NFC-e'
    });

    const resultado = await executarEmissaoSeMarcada({
      vendaId: 65,
      body: { documento: 'NFCE', emitir_fiscal: true },
      venda: { id: 65, total: 20, documento_solicitado: 'NFCE' },
      itens: [itemFiscal(20)],
      pagamentos: [{ venda_id: 65, forma_pagamento: 'pix', valor: 20 }],
      deps: motor
    });

    assert.equal(motor.chamadas.length, 1);
    assert.equal(motor.chamadas[0], 65);
    assert.equal(resultado.motor_acionado, true);
    assert.equal(resultado.emissao_concluida, true);
    assert.equal(resultado.situacao, 'autorizada');
    assert.equal(resultado.fiscal.protocolo, '123456789012345');
    assert.equal(resultado.fiscal.chaveAcesso.endsWith('120'), true);
    assert.equal(resultado.valor_fiscal_elegivel, 20);
  });

  it('2. rejeição fiscal permanece visível e não marca a emissão como concluída', async () => {
    const motor = mockMotor({
      success: false,
      status: 'rejeitada',
      message: 'NFC-e rejeitada pela SEFAZ (cStat 225): Falha no schema XML'
    });

    const resultado = await executarEmissaoSeMarcada({
      vendaId: 65,
      body: { documento: 'NFCE' },
      venda: { documento_solicitado: 'NFCE' },
      itens: [itemFiscal(20)],
      pagamentos: [{ venda_id: 65, forma_pagamento: 'dinheiro', valor: 20 }],
      deps: motor
    });

    assert.equal(resultado.motor_acionado, true);
    assert.equal(resultado.emissao_concluida, false);
    assert.equal(resultado.situacao, 'rejeitada');
    assert.match(resultado.fiscal.message, /cStat 225/);
  });

  it('3. falha de comunicação com a SEFAZ não autoriza a NFC-e', async () => {
    const motor = mockMotor({
      success: false,
      status: 'erro_transmissao',
      message: 'timeout ao contatar a SEFAZ'
    });

    const resultado = await executarEmissaoSeMarcada({
      vendaId: 65,
      body: { emitir_fiscal: true, documento: 'NFCE' },
      venda: {},
      itens: [itemFiscal(20)],
      pagamentos: [{ venda_id: 65, forma_pagamento: 'pix', valor: 20 }],
      deps: motor
    });

    assert.equal(resultado.situacao, 'erro_comunicacao');
    assert.equal(resultado.emissao_concluida, false);
    assert.match(resultado.fiscal.message, /SEFAZ/);
  });

  it('4. itens fiscais e gerenciais: o total elegível ignora o gerencial e não altera o item', async () => {
    const fiscal = itemFiscal(15);
    const gerencial = itemGerencial(5);
    const antes = JSON.stringify([fiscal, gerencial]);
    const motor = mockMotor({
      success: true,
      status: 'autorizada',
      numero: 8,
      chaveAcesso: 'chave-8'
    });

    const separado = separarItensFiscais([fiscal, gerencial]);
    const resultado = await executarEmissaoSeMarcada({
      vendaId: 70,
      body: { documento: 'NFCE' },
      venda: { documento_solicitado: 'NFCE' },
      itens: [fiscal, gerencial],
      pagamentos: [{ venda_id: 70, forma_pagamento: 'pix', valor: 20 }],
      deps: motor
    });

    assert.equal(separado.fiscais.length, 1);
    assert.equal(separado.gerenciais.length, 1);
    assert.equal(separado.valorFiscal, 15);
    assert.equal(resultado.valor_fiscal_elegivel, 15);
    assert.equal(resultado.itens_gerenciais, 1);
    assert.equal(JSON.stringify([fiscal, gerencial]), antes);
    assert.equal(motor.chamadas[0], 70);
  });

  it('5. pedido sem itens fiscalmente elegíveis não conclui emissão', async () => {
    const motor = mockMotor({
      success: true,
      status: 'sem_itens_fiscais',
      message: 'Venda sem itens fiscais. NFC-e não necessária.'
    });

    const resultado = await executarEmissaoSeMarcada({
      vendaId: 71,
      body: { documento: 'NFCE' },
      venda: { documento_solicitado: 'NFCE' },
      itens: [itemGerencial(20)],
      pagamentos: [{ venda_id: 71, forma_pagamento: 'dinheiro', valor: 20 }],
      deps: motor
    });

    assert.equal(resultado.motor_acionado, true);
    assert.equal(resultado.situacao, 'sem_itens_fiscais');
    assert.equal(resultado.emissao_concluida, false);
    assert.equal(resultado.valor_fiscal_elegivel, 0);
    assert.match(resultado.fiscal.message, /sem itens fiscais/i);
  });

  it('6. preserva PIX, dinheiro, cartão e pagamento misto do próprio pedido', () => {
    const casos = [
      [{ forma_pagamento: 'pix', valor: 20, venda_id: 65 }],
      [{ forma_pagamento: 'dinheiro', valor: 20, venda_id: 65 }],
      [{ forma_pagamento: 'cartao_debito', valor: 20, venda_id: 65 }],
      [{ forma_pagamento: 'cartao_credito', valor: 20, venda_id: 65 }],
      [
        { forma_pagamento: 'pix', valor: 10, venda_id: 65 },
        { forma_pagamento: 'dinheiro', valor: 10, venda_id: 65 }
      ]
    ];

    const formas = casos.map((pagamentos) => resumirPagamentosDaVenda(pagamentos, 65));
    assert.deepEqual(formas[0], [{
      venda_id: 65, forma_pagamento: 'pix', valor: 20, tipo_recebimento: null, tef_transacao_id: null
    }]);
    assert.equal(formas[1][0].forma_pagamento, 'dinheiro');
    assert.equal(formas[2][0].forma_pagamento, 'cartao_debito');
    assert.equal(formas[3][0].forma_pagamento, 'cartao_credito');
    assert.equal(formas[4].length, 2);
    assert.equal(formas[4][0].valor + formas[4][1].valor, 20);
  });

  it('7. isola o pedido 65 do PIX de R$ 21,99 do pedido 64', async () => {
    await assert.rejects(
      () => validarPagamentosDoPedido([
        { forma_pagamento: 'pix', valor: 21.99, venda_id: 64, tef_transacao_id: 900, tef_venda_id: 64 }
      ], 65, async () => ({ id: 900, venda_id: 64, valor: 21.99 })),
      (err) => err.codigo === 'PAGAMENTO_OUTRA_VENDA'
    );

    const motor = mockMotor({ success: true, status: 'autorizada', numero: 1, chaveAcesso: 'x' });
    const resultado = await executarEmissaoSeMarcada({
      vendaId: 65,
      body: { documento: 'NFCE' },
      venda: { documento_solicitado: 'NFCE', total: 20 },
      itens: [itemFiscal(20)],
      pagamentos: [
        { venda_id: 65, forma_pagamento: 'pix', valor: 20 },
        { venda_id: 64, forma_pagamento: 'pix', valor: 21.99, tef_venda_id: 64 }
      ],
      deps: motor
    });

    assert.equal(resultado.motor_acionado, false);
    assert.equal(resultado.emissao_concluida, false);
    assert.equal(motor.chamadas.length, 0);
    assert.match(resultado.fiscal.message, /outro pedido/);
  });

  it('8. repetir a prestação não emite de novo; a recuperação reutiliza a NFC-e autorizada', async () => {
    const venda = {
      id: 65,
      status_venda: 'FINALIZADA',
      prestacao_realizada: 1,
      status: 'concluida',
      documento_solicitado: 'NFCE'
    };

    const bloqueio = avaliarRepeticaoPrestacao(venda, { documento: 'NFCE', emitir_fiscal: true });
    assert.equal(bloqueio.bloquear, true);
    assert.equal(bloqueio.codigo, 'PRESTACAO_DUPLICADA');

    const recuperacao = avaliarRepeticaoPrestacao(venda, { recuperar_fiscal: true });
    assert.equal(recuperacao.recuperar, true);
    assert.equal(recuperacao.bloquear, false);

    let numeroEmitido = null;
    const motor = mockMotor((vendaId, tentativa) => {
      if (tentativa === 1) {
        numeroEmitido = 33;
        return {
          success: true,
          status: 'autorizada',
          numero: 33,
          chaveAcesso: 'chave-33',
          protocolo: 'prot-33'
        };
      }
      return {
        success: true,
        reused: true,
        status: 'autorizada',
        numero: numeroEmitido,
        chaveAcesso: 'chave-33',
        protocolo: 'prot-33',
        message: 'NFC-e da tentativa anterior já estava autorizada na SEFAZ; nenhuma nova emissão foi feita.'
      };
    });

    const primeira = await executarEmissaoSeMarcada({
      vendaId: 65,
      body: { documento: 'NFCE' },
      venda: { documento_solicitado: 'NFCE' },
      itens: [itemFiscal(20)],
      pagamentos: [{ venda_id: 65, forma_pagamento: 'pix', valor: 20 }],
      deps: motor
    });
    const segunda = await executarEmissaoSeMarcada({
      vendaId: 65,
      body: { recuperar_fiscal: true, documento: 'NFCE' },
      venda,
      itens: [itemFiscal(20)],
      pagamentos: [{ venda_id: 65, forma_pagamento: 'pix', valor: 20 }],
      deps: motor
    });

    assert.equal(primeira.fiscal.numero, 33);
    assert.equal(segunda.fiscal.numero, 33);
    assert.equal(segunda.fiscal.reused, true);
    assert.equal(segunda.emissao_concluida, true);
    assert.equal(motor.chamadas.length, 2);
    assert.deepEqual(motor.chamadas, [65, 65]);
  });

  it('9. pedido configurado como venda não fiscal não aciona o Motor Fiscal', async () => {
    const motor = mockMotor({ success: true, status: 'autorizada', numero: 1, chaveAcesso: 'x' });
    const resultado = await executarEmissaoSeMarcada({
      vendaId: 80,
      body: { documento: 'NFCE', emitir_fiscal: true },
      venda: { documento_solicitado: 'NAO_FISCAL', total: 20 },
      itens: [itemFiscal(20)],
      pagamentos: [{ venda_id: 80, forma_pagamento: 'dinheiro', valor: 20 }],
      deps: motor
    });

    assert.equal(resultado.documento, 'NAO_FISCAL');
    assert.equal(resultado.situacao, 'nao_aplicavel');
    assert.equal(resultado.motor_acionado, false);
    assert.equal(resultado.fiscal, null);
    assert.equal(motor.chamadas.length, 0);

    const repeticao = avaliarRepeticaoPrestacao({
      status_venda: 'FINALIZADA',
      prestacao_realizada: 1,
      documento_solicitado: 'NAO_FISCAL'
    }, { recuperar_fiscal: true });
    assert.equal(repeticao.codigo, 'VENDA_NAO_FISCAL');
    assert.equal(repeticao.bloquear, true);
  });

  it('10. regressão operacional: a prestação segue no motor de entrega e não cria emissor paralelo', () => {
    const motor = ler('backend/services/entrega/MotorFinalizacaoVenda.js');
    const fiscal = ler('backend/services/entrega/PrestacaoFiscalService.js');
    const drawer = ler('frontend/pdv/js/pdv-prestacao-entrega.js');
    const universal = ler('frontend/pdv/js/pdv-venda-entrega.js');

    assert.match(motor, /consumirReservasDaVenda/);
    assert.match(motor, /FINANCEIRO_GERADO|financeiro/);
    assert.match(motor, /StatusEntrega\.CONCLUIDA/);
    assert.match(motor, /executarEmissaoSeMarcada/);
    assert.doesNotMatch(motor, /buildNfceXml|assinarNFe|enviarAutorizacao/);
    assert.match(fiscal, /emitirPorVendaId/);
    assert.doesNotMatch(fiscal, /buildNfceXml|assinarNFe/);
    assert.match(drawer, /situacao_fiscal|prestacaoFiscalEstado/);
    assert.match(drawer, /Recuperar emissão/);
    assert.match(drawer, /emitir_fiscal: documento === 'NFCE'/);
    assert.match(universal, /entregaDeveMarcarNfce/);
    assert.doesNotMatch(universal, /emitir_fiscal:\s*false/);

    const classe = classificarResultadoMotorFiscal({
      success: false,
      status: 'pendente',
      message: 'Lote em processamento'
    });
    assert.equal(classe.emissao_concluida, false);
    assert.equal(classe.situacao, 'pendente');
  });
});
