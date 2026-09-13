/**
 * Sprint 2.1 — Melhorias operacionais Vendas para Entrega
 * Executar: node tests/vendas-entrega/sprint02.1-operacional.test.js
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const {
  StatusVenda,
  StatusEntrega,
  STATUS_VENDA,
  STATUS_ENTREGA,
  normalizarStatusEntrega,
  normalizarStatusVenda,
  EntregaAuditoriaEventos,
  EntregaService,
  EntregaRepository,
  EntregaValidator
} = require('../../backend/services/entrega');

const { calcularEstoqueProduto } = require('../../backend/services/estoque/EstoqueDisponivelService');

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
  console.log('\n=== Sprint 2.1 — Operacional Entrega ===\n');

  await test('StatusVenda e StatusEntrega separados', async () => {
    assert.deepStrictEqual([...STATUS_VENDA].sort(), ['ABERTA', 'CANCELADA', 'FINALIZADA']);
    assert.ok(STATUS_ENTREGA.includes(StatusEntrega.CONCLUIDA));
    assert.ok(!STATUS_ENTREGA.includes('FINALIZADA'));
    assert.strictEqual(normalizarStatusEntrega('FINALIZADA'), StatusEntrega.CONCLUIDA);
    assert.strictEqual(normalizarStatusVenda('reserva_entrega'), StatusVenda.ABERTA);
  });

  await test('validator aceita CONCLUIDA e alias FINALIZADA', async () => {
    const v = new EntregaValidator();
    assert.strictEqual(v.validarStatusEntrega('CONCLUIDA'), true);
    assert.strictEqual(v.validarStatusEntrega('FINALIZADA'), true);
    assert.strictEqual(v.validarStatusVenda('ABERTA'), true);
    assert.strictEqual(v.validarStatusVenda('X'), false);
  });

  await test('auditoria — novos eventos Sprint 2.1', async () => {
    assert.strictEqual(EntregaAuditoriaEventos.ENTREGA_AGRUPADA, 'entrega_agrupada');
    assert.strictEqual(EntregaAuditoriaEventos.ENTREGA_REABERTA, 'entrega_reaberta');
    assert.strictEqual(EntregaAuditoriaEventos.MUDANCA_STATUS, 'mudanca_status');
    assert.strictEqual(EntregaAuditoriaEventos.TROCO_INFORMADO, 'troco_informado');
    assert.strictEqual(EntregaAuditoriaEventos.MAQUINETA_INFORMADA, 'maquineta_informada');
  });

  await test('agrupamento por entregador ordena prestação pendente', async () => {
    const repo = new EntregaRepository();
    repo.listar = async () => [
      {
        id: 1, entregador: 'Carlos', total: 10, total_reservado: 1,
        reservado_fiscal: 1, reservado_nao_fiscal: 0,
        status_entrega: StatusEntrega.AGUARDANDO_ENTREGA, prestacao_realizada: 0
      },
      {
        id: 2, entregador: 'João', total: 20, total_reservado: 2,
        reservado_fiscal: 2, reservado_nao_fiscal: 0,
        status_entrega: StatusEntrega.AGUARDANDO_PRESTACAO, prestacao_realizada: 0
      },
      {
        id: 3, entregador: 'João', total: 30, total_reservado: 1,
        reservado_fiscal: 1, reservado_nao_fiscal: 0,
        status_entrega: StatusEntrega.EM_ENTREGA, prestacao_realizada: 0
      },
      {
        id: 4, entregador: null, total: 5, total_reservado: 0,
        reservado_fiscal: 0, reservado_nao_fiscal: 0,
        status_entrega: StatusEntrega.AGUARDANDO_ENTREGA, prestacao_realizada: 0
      }
    ];

    const grupos = await repo.agruparPorEntregador();
    assert.strictEqual(grupos[0].entregador, 'João');
    assert.ok(grupos[0].pendente_prestacao >= 1);
    assert.strictEqual(grupos[0].quantidade, 2);
    const sem = grupos.find((g) => g.entregador === 'Sem Entregador');
    assert.ok(sem);
    assert.strictEqual(sem.quantidade, 1);
  });

  await test('dashboard e consultas expostas no service', async () => {
    const service = new EntregaService({
      repository: {
        async resumoDashboard() {
          return {
            aguardando_entrega: 12,
            em_entrega: 7,
            aguardando_prestacao: 3,
            concluidas_hoje: 54,
            canceladas: 2,
            por_status: {}
          };
        },
        async totaisReservados() {
          return { reservado_fiscal: 5, reservado_nao_fiscal: 2, total_reservado: 7 };
        },
        async resumoPorStatus() {
          return [{ status_entrega: 'EM_ENTREGA', quantidade: 7, valor_total: 100 }];
        },
        async listar() { return []; },
        async listarAguardandoPrestacao() { return [{ id: 1 }]; },
        async listarTimeline() {
          return [
            { id: 1, acao: 'venda_marcada_para_entrega', criado_em: '2026-01-01' },
            { id: 2, acao: 'reserva_criada', criado_em: '2026-01-01' },
            { id: 3, acao: 'comprovante_impresso', criado_em: '2026-01-01' },
            { id: 4, acao: 'entrega_iniciada', criado_em: '2026-01-01' }
          ];
        },
        async buscarPorVendaId() { return null; },
        async agruparPorEntregador() { return []; }
      }
    });

    const dash = await service.dashboard();
    assert.strictEqual(dash.dashboard.aguardando_entrega, 12);
    assert.strictEqual(dash.dashboard.concluidas_hoje, 54);
    assert.strictEqual(dash.reservas.total_reservado, 7);

    const timeline = await service.obterTimeline(99);
    assert.strictEqual(timeline.eventos.length, 4);
    assert.strictEqual(timeline.eventos[0].label, 'Venda criada');
    assert.strictEqual(timeline.eventos[3].label, 'Saiu para entrega');

    const prest = await service.aguardandoPrestacao();
    assert.strictEqual(prest.total, 1);
  });

  await test('iniciarEntrega não altera status_venda (permanece ABERTA)', async () => {
    let statusEntrega = StatusEntrega.AGUARDANDO_ENTREGA;
    const service = new EntregaService({
      repository: {
        async buscarPorVendaId() {
          return {
            id: 10,
            status_entrega: statusEntrega,
            status_venda: StatusVenda.ABERTA,
            tipo_venda: 'ENTREGA'
          };
        },
        async atualizarStatusEntrega(_id, st) {
          statusEntrega = st;
          return { changes: 1 };
        }
      }
    });
    const ok = await service.iniciarEntrega(10, {});
    assert.strictEqual(ok.item.status_entrega, StatusEntrega.EM_ENTREGA);
    assert.strictEqual(ok.item.status_venda, StatusVenda.ABERTA);
  });

  await test('reserva disponível intacta (sem baixa)', async () => {
    const calc = calcularEstoqueProduto({
      saldo_fiscal: 100,
      saldo_nao_fiscal: 20,
      reservado_fiscal: 5,
      reservado_nao_fiscal: 0
    });
    assert.strictEqual(calc.disponivel_fiscal, 95);
  });

  await test('CriarVendaEntrega grava status_venda ABERTA', async () => {
    const src = ler('backend/services/entrega/CriarVendaEntregaService.js');
    assert.ok(src.includes('StatusVenda.ABERTA'));
    assert.ok(src.includes('status_venda'));
    assert.ok(src.includes('reserva_entrega'));
    assert.ok(!/emitirNfce|gerarContasReceber|baixarEstoque/i.test(src));
  });

  await test('rotas dashboard / por-entregador / timeline', async () => {
    const src = ler('backend/rotas/entregas.js');
    assert.ok(src.includes('/entregas/dashboard'));
    assert.ok(src.includes('/entregas/por-entregador'));
    assert.ok(src.includes('/entregas/resumo'));
    assert.ok(src.includes('/entregas/reservas'));
    assert.ok(src.includes('/:id/timeline'));
  });

  await test('schema status_venda', async () => {
    const src = ler('backend/database.js');
    assert.ok(src.includes("ADD COLUMN status_venda TEXT DEFAULT 'ABERTA'"));
  });

  await test('UI operacional + widget rodapé estruturado sem exibir', async () => {
    const ui = ler('frontend/pdv/js/entregas.js');
    assert.ok(ui.includes('cardsDashboardEntrega'));
    assert.ok(ui.includes('por-entregador'));
    assert.ok(ui.includes('Timeline'));
    assert.ok(ui.includes('Maquineta'));
    assert.ok(ui.includes('Troco'));
    assert.ok(ui.includes('status_venda'));

    const footer = ler('frontend/pdv/js/pdv-footer-widgets.js');
    assert.ok(footer.includes('ENTREGAS_WIDGET_SPEC'));
    assert.ok(footer.includes('prepararWidgetEntregas'));
    assert.ok(footer.includes('Prestação'));
    assert.ok(footer.includes('Contadores'));
    assert.ok(footer.includes('Notificações'));
  });

  await test('prestação usa MotorFinalizacaoVenda (não mock)', async () => {
    const { MotorFinalizacaoVenda, finalizarPrestacao } = require('../../backend/services/entrega');
    assert.strictEqual(typeof finalizarPrestacao, 'function');
    assert.strictEqual(typeof MotorFinalizacaoVenda.finalizar, 'function');
    assert.strictEqual(typeof MotorFinalizacaoVenda.cancelar, 'function');

    let erro = null;
    try {
      await finalizarPrestacao({ vendaId: 999999, body: {}, req: {} });
    } catch (e) {
      erro = e;
    }
    assert.ok(erro);
    assert.ok(erro.status === 404 || /não encontrada|desabilitado/i.test(erro.message));
  });

  console.log(`\nResultado: ${passou} ok, ${falhou} falhou\n`);
  process.exit(falhou > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
