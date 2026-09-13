/**
 * RC5.0 — Integração Corporativa do Motor de Equipamentos
 * Executar: node tests/motor-equipamentos/rc5-integracao-corporativa.test.js
 */

const assert = require('assert');
const integracao = require('../../backend/services/equipamentos-integracao');
const {
  verificarPermissao,
  exigirPermissao,
  MODULOS,
  ACOES
} = require('../../backend/services/equipamentos-integracao/EquipamentosPermissoes');
const eventBus = require('../../backend/services/equipamentos-integracao/EquipmentEventBus');
const { EVENTOS } = require('../../backend/services/equipamentos-integracao/EquipmentEventBus');
const auditoria = require('../../backend/services/equipamentos-integracao/EquipamentosAuditoria');
const equipamentosService = require('../../backend/motores/equipamentos/services/EquipamentosService');

let passou = 0;
let falhou = 0;
let equipamentoId = null;

const adminUser = { perfil: 'SUPER_ADMIN', id: 1, nome: 'RC5' };

function test(nome, fn) {
  return Promise.resolve()
    .then(() => fn())
    .then(() => {
      passou += 1;
      console.log(`  OK  ${nome}`);
    })
    .catch((error) => {
      falhou += 1;
      console.error(`  FALHOU  ${nome}`);
      console.error(`         ${error.stack || error.message}`);
    });
}

async function main() {
  console.log('\n=== RC5.0 — Integração Corporativa ===\n');

  integracao.iniciar();

  await test('permissões — PDV consultar ok / sincronizar negado', () => {
    assert.strictEqual(verificarPermissao(MODULOS.PDV, ACOES.CONSULTAR).permitido, true);
    assert.strictEqual(verificarPermissao(MODULOS.PDV, ACOES.SINCRONIZAR).permitido, false);
    assert.strictEqual(verificarPermissao(MODULOS.COMPRAS, ACOES.SINCRONIZAR).permitido, true);
    assert.strictEqual(verificarPermissao(MODULOS.FISCAL, ACOES.CONSULTAR).permitido, true);
    assert.throws(() => exigirPermissao(MODULOS.FISCAL, ACOES.SINCRONIZAR), /permissão/i);
  });

  await test('EventBus — publicar e assinar', () => {
    eventBus.limparHistorico();
    let recebido = null;
    const off = eventBus.assinar(EVENTOS.EquipmentOnline, (reg) => { recebido = reg; });
    eventBus.publicar(EVENTOS.EquipmentOnline, { equipamento_id: 99 });
    assert.ok(recebido);
    assert.strictEqual(recebido.evento, EVENTOS.EquipmentOnline);
    assert.ok(eventBus.listarHistorico(5).length >= 1);
    off();
  });

  await test('status integração', async () => {
    const st = await integracao.service.obterStatus({ modulo: MODULOS.ADMIN, usuario: adminUser });
    assert.strictEqual(st.motor, 'V1.0.0');
    assert.strictEqual(st.integracao, 'RC5.0');
  });

  await test('criar equipamento para integração', async () => {
    const eq = await equipamentosService.criar({
      nome: `RC5 Int ${Date.now()}`,
      tipo: 'balanca',
      transporte: 'ethernet',
      ip: '127.0.0.1',
      porta_tcp: 19100,
      fabricante: 'Teste',
      modelo: 'RC5',
      driver_codigo: 'GENERIC_SERIAL',
      ativo: true
    });
    equipamentoId = eq.id;
    assert.ok(equipamentoId);
  });

  await test('integração PDV — verificar + status + reconectar', async () => {
    const ver = await integracao.modulos.pdv.naAberturaCaixa(adminUser, {
      equipamento_ids: [equipamentoId]
    });
    assert.ok(typeof ver.ok === 'boolean');
    assert.ok(Array.isArray(ver.status));

    const st = await integracao.modulos.pdv.statusDuranteVenda(adminUser, equipamentoId);
    assert.strictEqual(st.equipamento_id, equipamentoId);

    const rec = await integracao.modulos.pdv.reconectar(adminUser, equipamentoId);
    assert.ok(rec.resultado);
  });

  await test('integração Compras — sincronizar com auditoria', async () => {
    eventBus.limparHistorico();
    const r = await integracao.modulos.compras.sincronizarProdutos(adminUser, {
      equipamento_id: equipamentoId,
      produtos: [{ codigo: '10', plu: 10, descricao: 'Item RC5', preco: 1.5, departamento: 1 }]
    });
    assert.ok(r.equipamento_id === equipamentoId);
    assert.ok(r.capacidades);
    const hist = eventBus.listarHistorico(20);
    assert.ok(hist.some((e) => e.evento === EVENTOS.EquipmentSyncStarted || e.evento === EVENTOS.EquipmentSyncFinished));
  });

  await test('integração Fiscal — validar equipamentos', async () => {
    const r = await integracao.modulos.fiscal.antesDaEmissao(adminUser, {
      equipamento_ids: [equipamentoId]
    });
    assert.ok(typeof r.ok === 'boolean');
    assert.ok(Array.isArray(r.indisponiveis));
  });

  await test('integração TEF — descobrir via Motor (não sdkDetector direto)', async () => {
    const r = await integracao.modulos.tef.descobrirPinpads(adminUser, {
      transportes: ['serial', 'usb'],
      timeoutMs: 200,
      persistir_sessao: false
    });
    assert.ok(Array.isArray(r.candidatos));
    assert.ok(r.mensagem.includes('Motor'));
  });

  await test('Central Inteligente consome eventos', () => {
    let visto = false;
    integracao.modulos.centralInteligente.onEvento(() => { visto = true; });
    eventBus.publicar(EVENTOS.EquipmentOffline, { origem: 'teste' });
    assert.ok(visto || integracao.modulos.centralInteligente.obterUltimoEvento());
  });

  await test('auditoria registra quem/quando/módulo', async () => {
    const itens = await auditoria.listar({ limite: 20 });
    assert.ok(itens.length >= 1);
    const a = itens[0];
    assert.ok(a.modulo);
    assert.ok(a.acao);
    assert.ok(a.em);
  });

  await test('listar eventos API service', async () => {
    const ev = await integracao.service.listarEventos({ modulo: MODULOS.ADMIN, usuario: adminUser }, 10);
    assert.ok(Array.isArray(ev.eventos));
    assert.ok(ev.catalogo.EquipmentOnline);
  });

  console.log(`\nResultado: ${passou} ok, ${falhou} falhou\n`);
  process.exit(falhou > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
