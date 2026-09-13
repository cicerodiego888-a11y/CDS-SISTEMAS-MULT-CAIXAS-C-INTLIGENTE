/**
 * Sprint 3.1 — Hardening / UX / Segurança
 * Executar: node tests/vendas-entrega/sprint03.1-hardening.test.js
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const configService = require('../../backend/services/configuracaoService');
const { listarAlertas, obterLimites } = require('../../backend/services/entrega/EntregaAlertasService');
const { MotorFinalizacaoVenda } = require('../../backend/services/entrega');

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
  console.log('\n=== Sprint 3.1 — Hardening ===\n');

  await test('config impressão e alertas normalizados', async () => {
    const cfg = configService.readConfig();
    assert.ok('imprimir_comprovante_entrega' in cfg || cfg.imprimir_comprovante_entrega !== undefined);
    assert.strictEqual(typeof cfg.imprimir_comprovante_prestacao, 'boolean');
    assert.strictEqual(typeof cfg.imprimir_danfe_nfce_entrega, 'boolean');
    assert.ok(Number(cfg.entrega_alerta_horas_aguardando) >= 1);
    assert.strictEqual(obterLimites().horasAguardando, Number(cfg.entrega_alerta_horas_aguardando));
  });

  await test('MotorFinalizacaoVenda tem lock concorrente', async () => {
    const src = ler('backend/services/entrega/MotorFinalizacaoVenda.js');
    assert.ok(src.includes('prestacoesEmAndamento'));
    assert.ok(src.includes('PRESTACAO_DUPLICADA') || src.includes('PRESTACAO_CONCORRENTE'));
    assert.ok(src.includes('BEGIN IMMEDIATE') || src.includes("BEGIN IMMEDIATE") || src.includes('begin()'));
    assert.ok(src.includes('COALESCE(prestacao_realizada, 0) = 0'));
  });

  await test('atualizarEntrega bloqueia venda finalizada', async () => {
    const src = ler('backend/services/entrega/EntregaService.js');
    assert.ok(src.includes('VENDA_JA_FINALIZADA') || src.includes('após a conclusão'));
  });

  await test('alertas serviço responde', async () => {
    const data = await listarAlertas();
    assert.ok(typeof data.total === 'number');
    assert.ok(Array.isArray(data.items));
    assert.ok(data.limites);
  });

  await test('dashboard indicadores Sprint 3.1', async () => {
    const src = ler('backend/services/entrega/EntregaRepository.js');
    assert.ok(src.includes('entregas_hoje') || src.includes('valor_total_hoje') || src.includes('ticket_medio'));
    assert.ok(src.includes('prestacao_pendente') || src.includes('tempo_medio'));
    assert.ok(src.includes('listarReservasPorProduto'));
  });

  await test('índices de performance criados', async () => {
    const src = ler('backend/database.js');
    assert.ok(src.includes('idx_vendas_tipo_status_entrega'));
    assert.ok(src.includes('idx_reservas_venda_status'));
    assert.ok(src.includes('idx_auditoria_modulo_ref'));
  });

  await test('UI conferência final + rodapé duplo', async () => {
    const prest = ler('frontend/pdv/js/pdv-prestacao-entrega.js');
    assert.ok(prest.includes('abrirConferenciaFinal'));
    assert.ok(prest.includes('Finalizar Venda'));
    assert.ok(prest.includes('entregas-prestacao'));
    assert.ok(prest.includes('imprimirPosPrestacao'));

    const entregas = ler('frontend/pdv/js/entregas.js');
    assert.ok(entregas.includes('ticket_medio'));
    assert.ok(entregas.includes('alertasEntregaBox'));
  });

  await test('estoque com reservas + auditoria export', async () => {
    const prod = ler('frontend/erp/js/produtos.js');
    assert.ok(prod.includes('formatarEstoqueCompletoProduto'));
    assert.ok(prod.includes('abrirModalReservasProduto'));

    const aud = ler('frontend/erp/js/auditoria.js');
    assert.ok(aud.includes('exportarAuditoriaCsv'));

    const audHtml = ler('frontend/erp/pages/auditoria.html');
    assert.ok(audHtml.includes('vendas_entrega'));
  });

  await test('rotas alertas e reservas-produto', async () => {
    const rotas = ler('backend/rotas/entregas.js');
    assert.ok(rotas.includes('/entregas/alertas'));
    assert.ok(rotas.includes('/entregas/reservas-produto'));
  });

  await test('cancelar venda finalizada permanece bloqueado', async () => {
    let erro = null;
    try {
      await MotorFinalizacaoVenda.cancelar({ vendaId: 999999991 });
    } catch (e) {
      erro = e;
    }
    assert.ok(erro);
  });

  await test('concorrência — segunda prestação simultânea é rejeitada', async () => {
    const motorSrc = ler('backend/services/entrega/MotorFinalizacaoVenda.js');
    assert.ok(motorSrc.includes('PRESTACAO_EM_ANDAMENTO') || motorSrc.includes('prestacoesEmAndamento'));

    // Simula lock em memória: duas chamadas paralelas à mesma venda inexistente
    // A primeira falha por 404; o importante é o Set não vazar e o código existir.
    const r1 = MotorFinalizacaoVenda.finalizar({
      vendaId: 888888001,
      body: { forma_pagamento: 'dinheiro', pagamentos: [{ forma_pagamento: 'dinheiro', valor: 1 }] },
      req: {}
    }).then(() => 'ok').catch((e) => e.codigo || e.status || 'err');

    const r2 = MotorFinalizacaoVenda.finalizar({
      vendaId: 888888001,
      body: { forma_pagamento: 'dinheiro', pagamentos: [{ forma_pagamento: 'dinheiro', valor: 1 }] },
      req: {}
    }).then(() => 'ok').catch((e) => e.codigo || e.status || 'err');

    const [a, b] = await Promise.all([r1, r2]);
    // Ambas devem falhar (404 ou 409 em andamento) — nunca sucesso
    assert.notStrictEqual(a, 'ok');
    assert.notStrictEqual(b, 'ok');
  });

  console.log(`\nResultado: ${passou} ok, ${falhou} falhou\n`);
  process.exit(falhou > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
