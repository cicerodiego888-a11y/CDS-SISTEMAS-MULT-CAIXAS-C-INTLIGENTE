/**
 * Sprint 3 — Prestação de Contas / MotorFinalizacaoVenda
 * Executar: node tests/vendas-entrega/sprint03-prestacao.test.js
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const {
  StatusVenda,
  StatusEntrega,
  EntregaAuditoriaEventos,
  montarHtmlComprovantePrestacao,
  MotorFinalizacaoVenda,
  finalizarPrestacao,
  cancelarEntregaMotor
} = require('../../backend/services/entrega');

let passou = 0;
let falhou = 0;

function test(nome, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      passou += 1;
      console.log(`  OK  ${nome}`);
    })
    .catch((error) => {
      falhou += 1;
      console.error(`  FALHOU  ${nome}`);
      console.error(`         ${error && error.message ? error.message : error}`);
    });
}

function ler(rel) {
  return fs.readFileSync(path.join(__dirname, '../..', rel), 'utf8');
}

async function main() {
  console.log('\n=== Sprint 3 — Prestação de Contas ===\n');

  await test('MotorFinalizacaoVenda é o único ponto de finalização', async () => {
    assert.strictEqual(typeof MotorFinalizacaoVenda.finalizar, 'function');
    assert.strictEqual(typeof MotorFinalizacaoVenda.cancelar, 'function');
    assert.strictEqual(MotorFinalizacaoVenda.finalizar, finalizarPrestacao);
    assert.strictEqual(MotorFinalizacaoVenda.cancelar, cancelarEntregaMotor);
  });

  await test('auditoria Sprint 3 — eventos de prestação', async () => {
    assert.strictEqual(EntregaAuditoriaEventos.PRESTACAO_INICIADA, 'prestacao_iniciada');
    assert.strictEqual(EntregaAuditoriaEventos.PAGAMENTO_CONFIRMADO, 'pagamento_confirmado');
    assert.strictEqual(EntregaAuditoriaEventos.RESERVA_CONVERTIDA, 'reserva_convertida');
    assert.strictEqual(EntregaAuditoriaEventos.ESTOQUE_BAIXADO, 'estoque_baixado');
    assert.strictEqual(EntregaAuditoriaEventos.FINANCEIRO_GERADO, 'financeiro_gerado');
    assert.strictEqual(EntregaAuditoriaEventos.CAIXA_ATUALIZADO, 'caixa_atualizado');
    assert.strictEqual(EntregaAuditoriaEventos.NFCE_EMITIDA, 'nfce_emitida');
    assert.strictEqual(EntregaAuditoriaEventos.ENTREGA_CONCLUIDA, 'entrega_concluida');
    assert.strictEqual(EntregaAuditoriaEventos.COMPROVANTE_PRESTACAO_IMPRESSO, 'comprovante_prestacao_impresso');
  });

  await test('comprovante de prestação completo', async () => {
    const html = montarHtmlComprovantePrestacao({
      pedido: 88,
      cliente: 'Ana',
      valor: 85.4,
      pagamento_previsto: 'PIX',
      pagamento_recebido: 'MISTO',
      formas_pagamento: [
        { forma_pagamento: 'pix', valor: 50 },
        { forma_pagamento: 'dinheiro', valor: 35.4 }
      ],
      documento: 'NFCE',
      troco_levado: 100,
      troco_devolvido: 14.6,
      maquineta: 'SIM',
      entregador: 'João',
      operador: 'Caixa 1'
    });
    assert.ok(html.includes('PRESTAÇÃO DE CONTAS FINALIZADA'));
    assert.ok(html.includes('Ana'));
    assert.ok(html.includes('PIX'));
    assert.ok(html.includes('NFCE'));
    assert.ok(html.includes('João'));
  });

  await test('EstoqueConsumoReserva existe e baixa + consome', async () => {
    const src = ler('backend/services/estoque/EstoqueConsumoReserva.js');
    assert.ok(src.includes('consumirReservasDaVenda'));
    assert.ok(src.includes('reduzirEstoqueDistribuido'));
    assert.ok(src.includes("status = 'CONSUMIDA'"));
    assert.ok(src.includes('reservado_fiscal'));
  });

  await test('MotorFinalizacaoVenda reutiliza Orquestrador e não altera criarVenda balcão', async () => {
    const motor = ler('backend/services/entrega/MotorFinalizacaoVenda.js');
    assert.ok(motor.includes('OrquestradorPagamento'));
    assert.ok(motor.includes('consumirReservasDaVenda'));
    assert.ok(motor.includes('gravarRecebimentos'));
    assert.ok(motor.includes('emitirFiscalSeSolicitado'));
    assert.ok(motor.includes('StatusVenda.FINALIZADA'));
    assert.ok(motor.includes('StatusEntrega.CONCLUIDA'));
    assert.ok(motor.includes('liberarReservasDaVenda'));

    const balcao = ler('backend/services/vendas/VendaPagamentoService.js');
    assert.ok(balcao.includes("tipoVendaCanal === 'ENTREGA'"));
    assert.ok(balcao.includes("'concluida'"));
  });

  await test('status alvo pós-prestação e pós-cancelamento', async () => {
    assert.strictEqual(StatusVenda.FINALIZADA, 'FINALIZADA');
    assert.strictEqual(StatusVenda.CANCELADA, 'CANCELADA');
    assert.strictEqual(StatusEntrega.CONCLUIDA, 'CONCLUIDA');
    assert.strictEqual(StatusEntrega.CANCELADA, 'CANCELADA');
  });

  await test('rotas prestação e cancelamento reais', async () => {
    const rotas = ler('backend/rotas/entregas.js');
    assert.ok(rotas.includes("router.post('/:id/prestacao'"));
    assert.ok(rotas.includes("router.delete('/:id/entrega'"));

    const ctrl = ler('backend/controllers/EntregaController.js');
    assert.ok(ctrl.includes('registrarPrestacao'));
    assert.ok(ctrl.includes('contextoAuditoriaRequisicao'));
  });

  await test('EntregaService não retorna mais mock de prestação', async () => {
    const src = ler('backend/services/entrega/EntregaService.js');
    assert.ok(src.includes('MotorFinalizacaoVenda'));
    assert.ok(!src.includes("mock: true"));
  });

  await test('finalizarPrestacao rejeita venda inexistente', async () => {
    let erro = null;
    try {
      await finalizarPrestacao({
        vendaId: 999999001,
        body: {
          forma_pagamento: 'dinheiro',
          pagamentos: [{ forma_pagamento: 'dinheiro', valor: 10 }],
          emitir_fiscal: false
        },
        req: {}
      });
    } catch (e) {
      erro = e;
    }
    assert.ok(erro);
  });

  await test('cancelarEntregaMotor rejeita inexistente', async () => {
    let erro = null;
    try {
      await cancelarEntregaMotor({ vendaId: 999999002 });
    } catch (e) {
      erro = e;
    }
    assert.ok(erro);
  });

  await test('UI drawer + widget rodapé ativo', async () => {
    const drawer = ler('frontend/pdv/js/pdv-prestacao-entrega.js');
    assert.ok(drawer.includes('PdvPrestacaoEntrega'));
    assert.ok(drawer.includes('/vendas/') && drawer.includes('/prestacao'));
    assert.ok(drawer.includes('Finalizar Prestação'));
    assert.ok(drawer.includes('Cancelar Entrega'));
    assert.ok(drawer.includes('misto') || drawer.includes('Misto'));
    assert.ok(drawer.includes('NFCE'));
    assert.ok(drawer.includes('ativarWidget'));

    const pdv = ler('frontend/pdv/js/pdv.js');
    assert.ok(pdv.includes('PdvPrestacaoEntrega.init'));

    const html = ler('frontend/pdv/index.html');
    assert.ok(html.includes('pdv-prestacao-entrega.js'));

    const css = ler('frontend/css/pdv.css');
    assert.ok(css.includes('pdv-prestacao-drawer'));
    assert.ok(css.includes('pdv-prestacao-conferencia'));
    assert.ok(drawer.includes('pdvPrestacaoConferencia'));
    assert.ok(drawer.includes('trazerParaFrente'));
    assert.ok(!drawer.includes('modalConferenciaPrestacao'));
    assert.ok(!drawer.includes('bootstrap.Modal'));
  });

  await test('balcão permanece intocado no divert ENTREGA', async () => {
    const src = ler('backend/services/vendas/VendaPagamentoService.js');
    const idx = src.indexOf("tipoVendaCanal === 'ENTREGA'");
    assert.ok(idx > 0);
    const after = src.slice(idx, idx + 200);
    assert.ok(after.includes('criarVendaEntrega'));
    assert.ok(!after.includes('MotorFinalizacaoVenda'));
  });

  console.log(`\nResultado: ${passou} ok, ${falhou} falhou\n`);
  process.exit(falhou > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
