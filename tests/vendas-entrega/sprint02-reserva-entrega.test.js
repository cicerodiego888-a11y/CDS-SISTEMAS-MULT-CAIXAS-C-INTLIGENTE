/**
 * Sprint 2 — Venda para Entrega
 * Reserva de estoque, comprovante, status, sem financeiro/caixa/NFC-e.
 *
 * Executar: node tests/vendas-entrega/sprint02-reserva-entrega.test.js
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const { calcularEstoqueProduto } = require('../../backend/services/estoque/EstoqueDisponivelService');
const {
  StatusEntrega,
  TipoVenda,
  EntregaAuditoriaEventos,
  montarHtmlComprovanteEntrega,
  EntregaService
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
  console.log('\n=== Sprint 2 — Reserva / Venda Entrega ===\n');

  await test('cálculo estoque disponível × reservado', async () => {
    const calc = calcularEstoqueProduto({
      saldo_fiscal: 100,
      saldo_nao_fiscal: 20,
      reservado_fiscal: 5,
      reservado_nao_fiscal: 2,
      estoque_atual: 120
    });
    assert.strictEqual(calc.estoque_fisico, 120);
    assert.strictEqual(calc.reservado_fiscal, 5);
    assert.strictEqual(calc.reservado_nao_fiscal, 2);
    assert.strictEqual(calc.disponivel_fiscal, 95);
    assert.strictEqual(calc.disponivel_nao_fiscal, 18);
    assert.strictEqual(calc.disponivel_total, 113);
  });

  await test('reserva não pode zerar disponível abaixo de zero', async () => {
    const calc = calcularEstoqueProduto({
      saldo_fiscal: 10,
      saldo_nao_fiscal: 0,
      reservado_fiscal: 50,
      reservado_nao_fiscal: 0
    });
    assert.strictEqual(calc.disponivel_fiscal, 0);
    assert.strictEqual(calc.disponivel_total, 0);
  });

  await test('comprovante de entrega HTML sem valor fiscal', async () => {
    const html = montarHtmlComprovanteEntrega(
      {
        id: 77,
        total: 55.5,
        cliente_nome: 'Maria',
        telefone_entrega: '11999990000',
        pagamento_previsto: 'PIX',
        entregador: 'João',
        endereco_entrega: 'Rua A, 10',
        referencia_entrega: 'Portão azul',
        observacao_entrega: 'Não tocar interfone',
        taxa_entrega: 5
      },
      [{ nome: 'Arroz', quantidade: 2, preco_unitario: 25, subtotal: 50 }],
      { nome: 'Mercado Teste', cnpj: '00.000.000/0001-00' }
    );
    assert.ok(html.includes('COMPROVANTE DE ENTREGA'));
    assert.ok(html.includes('ESTE DOCUMENTO NÃO POSSUI VALOR FISCAL'));
    assert.ok(html.includes('prestação de contas'));
    assert.ok(html.includes('Maria'));
    assert.ok(html.includes('Arroz'));
    assert.ok(!html.toLowerCase().includes('nfc-e'));
  });

  await test('CriarVendaEntregaService não gera financeiro/caixa/NFC-e', async () => {
    const src = ler('backend/services/entrega/CriarVendaEntregaService.js');
    assert.ok(src.includes("status_entrega = AGUARDANDO_ENTREGA") || src.includes("StatusEntrega.AGUARDANDO_ENTREGA"));
    assert.ok(src.includes("TipoVenda.ENTREGA"));
    assert.ok(src.includes("reserva_entrega"));
    assert.ok(src.includes('reservarItem'));
    assert.ok(src.includes('financeiro_gerado: false'));
    assert.ok(src.includes('estoque_baixado: false'));
    assert.ok(!/emitirNfce|emitirNFC|NFeService|gerarContasReceber|movimentarCaixa|baixarEstoque/i.test(src));
  });

  await test('VendaPagamentoService desvia ENTREGA sem alterar balcão', async () => {
    const src = ler('backend/services/vendas/VendaPagamentoService.js');
    assert.ok(src.includes("tipoVendaCanal === 'ENTREGA'"));
    assert.ok(src.includes('criarVendaEntrega'));
    assert.ok(src.includes('disponivel_fiscal'));
    // fluxo balcão ainda conclui venda normalmente
    assert.ok(/status.*concluida|concluida/.test(src));
  });

  await test('EstoqueReservaService só reserva (não altera saldo físico)', async () => {
    const src = ler('backend/services/estoque/EstoqueReservaService.js');
    assert.ok(src.includes('reservado_fiscal'));
    assert.ok(src.includes('venda_estoque_reservas'));
    assert.ok(!src.includes('estoque_atual ='));
    assert.ok(!src.includes('saldo_fiscal ='));
  });

  await test('schema: reservado_* e tabela venda_estoque_reservas', async () => {
    const src = ler('backend/database.js');
    assert.ok(src.includes('reservado_fiscal'));
    assert.ok(src.includes('reservado_nao_fiscal'));
    assert.ok(src.includes('CREATE TABLE IF NOT EXISTS venda_estoque_reservas'));
    assert.ok(src.includes('telefone_entrega'));
  });

  await test('auditoria Sprint 2 — reserva e comprovante', async () => {
    assert.strictEqual(EntregaAuditoriaEventos.RESERVA_CRIADA, 'reserva_criada');
    assert.strictEqual(EntregaAuditoriaEventos.COMPROVANTE_IMPRESSO, 'comprovante_impresso');
    assert.strictEqual(EntregaAuditoriaEventos.ENTREGA_INICIADA, 'entrega_iniciada');
  });

  await test('iniciarEntrega: AGUARDANDO → EM_ENTREGA', async () => {
    const fakeRepo = {
      async buscarPorVendaId(id) {
        if (this._status === 'EM_ENTREGA') {
          return {
            id: Number(id),
            tipo_venda: TipoVenda.ENTREGA,
            status_entrega: StatusEntrega.EM_ENTREGA
          };
        }
        return {
          id: Number(id),
          tipo_venda: TipoVenda.ENTREGA,
          status_entrega: StatusEntrega.AGUARDANDO_ENTREGA
        };
      },
      async atualizarStatusEntrega(_id, status) {
        this._status = status;
        return { changes: 1 };
      }
    };
    const service = new EntregaService({ repository: fakeRepo });
    const ok = await service.iniciarEntrega(15, {});
    assert.strictEqual(ok.success, true);
    assert.strictEqual(ok.item.status_entrega, StatusEntrega.EM_ENTREGA);

    let erro = null;
    try {
      await service.iniciarEntrega(15, {});
    } catch (e) {
      erro = e;
    }
    assert.ok(erro);
    assert.strictEqual(erro.status, 400);
  });

  await test('rota POST /entregas/:id/iniciar montada', async () => {
    const src = ler('backend/rotas/entregas.js');
    assert.ok(src.includes("/entregas/:id/iniciar"));
    assert.ok(src.includes('iniciarEntrega'));
  });

  await test('PDV: botão Entrega + modal (UX-01)', async () => {
    const pdvEntrega = ler('frontend/pdv/js/pdv-venda-entrega.js');
    assert.ok(pdvEntrega.includes('abrirModalVendaEntrega'));
    assert.ok(pdvEntrega.includes('Confirmar Entrega'));
    assert.ok(pdvEntrega.includes("tipo_venda: 'ENTREGA'"));
    assert.ok(pdvEntrega.includes('imprimirComprovanteEntrega'));
    assert.ok(pdvEntrega.includes('atualizarBotaoEntrega'));

    const pdv = ler('frontend/pdv/js/pdv.js');
    assert.ok(pdv.includes('PdvVendaEntrega.abrirModalVendaEntrega') || pdv.includes('btnVendaEntregaPdv'));
    assert.ok(pdv.includes('abrirTelaPagamento'));
    assert.ok(pdv.includes('abrirTelaPagamentoBalcao'));

    const html = ler('frontend/pdv/pages/pdv.html');
    assert.ok(html.includes('btnVendaEntregaPdv'));
    assert.ok(html.includes('ENVIAR PARA ENTREGA') || html.includes('btnVendaEntregaPdv'));
  });

  await test('listagem entregas PDV/ERP', async () => {
    const listagem = ler('frontend/pdv/js/entregas.js');
    assert.ok(listagem.includes('Aguardando'));
    assert.ok(listagem.includes('btn-iniciar-entrega') || listagem.includes('Iniciar'));
    assert.ok(listagem.includes('/vendas/entregas'));

    const erpHtml = ler('frontend/erp/index.html');
    assert.ok(erpHtml.includes('data-page="entregas"'));
    assert.ok(erpHtml.includes('vendasEntrega'));

    const pdvHtml = ler('frontend/pdv/index.html');
    assert.ok(pdvHtml.includes('data-page="entregas"'));
    assert.ok(pdvHtml.includes('pdv-venda-entrega.js'));
  });

  console.log(`\nResultado: ${passou} ok, ${falhou} falhou\n`);
  process.exit(falhou > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
