/**
 * RC3.0 — Central de Equipamentos
 * Executar: node tests/motor-equipamentos/rc3-central-equipamentos.test.js
 */

const assert = require('assert');
const {
  STATUS,
  STATUS_ROTULO,
  resolverStatusCentral,
  calcularHealthScore
} = require('../../backend/motores/equipamentos/central/CentralStatus');
const central = require('../../backend/motores/equipamentos/central/CentralEquipamentosService');

let passou = 0;
let falhou = 0;

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
  console.log('\n=== RC3.0 — Central de Equipamentos ===\n');

  await test('status padronizados exportados', () => {
    const esperados = [
      'ONLINE', 'OFFLINE', 'DESCONHECIDO', 'NUNCA_VISTO',
      'ALTEROU_IP', 'ALTEROU_FIRMWARE', 'SINCRONIZANDO', 'ERRO'
    ];
    for (const s of esperados) {
      assert.ok(STATUS[s], `faltou ${s}`);
      assert.ok(STATUS_ROTULO[s]);
    }
  });

  await test('resolverStatusCentral — IP / firmware / online', () => {
    assert.strictEqual(
      resolverStatusCentral({ identidade_status: 'ip_alterado' }),
      STATUS.ALTEROU_IP
    );
    assert.strictEqual(
      resolverStatusCentral({ identidade_status: 'firmware_alterado' }),
      STATUS.ALTEROU_FIRMWARE
    );
    assert.strictEqual(
      resolverStatusCentral({ status: 'online' }),
      STATUS.ONLINE
    );
    assert.strictEqual(
      resolverStatusCentral({ status: 'offline' }),
      STATUS.OFFLINE
    );
    assert.strictEqual(
      resolverStatusCentral({ tipo_origem: 'descoberto', identidade_status: 'novo' }),
      STATUS.NUNCA_VISTO
    );
  });

  await test('Health Score — faixas', () => {
    const ok = calcularHealthScore({ status_central: STATUS.ONLINE, ultima_comunicacao: new Date().toISOString() });
    assert.ok(ok.score >= 80, `score online=${ok.score}`);

    const off = calcularHealthScore({ status_central: STATUS.OFFLINE });
    assert.ok(off.score <= 60);

    const err = calcularHealthScore({ status_central: STATUS.ERRO });
    assert.ok(err.score <= 40);

    const zero = calcularHealthScore({ status_central: STATUS.ERRO, ultimo_erro: 'x', confianca: 0.1 });
    assert.ok(zero.score <= 20);
    assert.ok(typeof ok.rotulo === 'string');
  });

  await test('dashboard — estrutura', async () => {
    const d = await central.obterDashboard();
    assert.ok(typeof d.total === 'number');
    assert.ok(typeof d.online === 'number');
    assert.ok(typeof d.offline === 'number');
    assert.ok(typeof d.novos === 'number');
    assert.ok(typeof d.conhecidos === 'number');
    assert.ok(typeof d.problemas === 'number');
    assert.ok(typeof d.sincronizando === 'number');
    assert.ok(typeof d.health_medio === 'number');
  });

  await test('lista — filtros transporte/status', async () => {
    const todos = await central.listarItens({});
    assert.ok(Array.isArray(todos));
    const eth = await central.listarItens({ transporte: 'ethernet' });
    assert.ok(Array.isArray(eth));
    assert.ok(eth.every((i) => !i.transporte || String(i.transporte).toLowerCase() === 'ethernet'));

    const online = await central.listarItens({ status: 'ONLINE' });
    assert.ok(online.every((i) => i.status_central === 'ONLINE'));
  });

  await test('lista — campos obrigatórios do painel', async () => {
    const itens = await central.listarItens({});
    if (!itens.length) return;
    const i = itens[0];
    for (const campo of [
      'nome', 'transporte', 'status_central', 'status_rotulo',
      'health_score', 'health_rotulo', 'tipo_origem'
    ]) {
      assert.ok(campo in i, `faltou ${campo}`);
    }
    assert.ok(Object.values(STATUS).includes(i.status_central));
  });

  await test('histórico — retorna array', async () => {
    const itens = await central.listarItens({});
    const comId = itens.find((i) => i.identidade_id || i.equipamento_id);
    if (!comId) {
      const eventos = await central.obterHistorico({});
      assert.ok(Array.isArray(eventos));
      return;
    }
    const eventos = await central.obterHistorico({
      identidade_id: comId.identidade_id,
      equipamento_id: comId.equipamento_id,
      limite: 10
    });
    assert.ok(Array.isArray(eventos));
  });

  await test('saúde — score e status', async () => {
    const itens = await central.listarItens({});
    if (!itens.length) {
      const s = await central.obterSaude({});
      assert.strictEqual(s.score, 0);
      return;
    }
    const alvo = itens[0];
    const s = await central.obterSaude({
      equipamento_id: alvo.equipamento_id,
      identidade_id: alvo.identidade_id
    });
    assert.ok(typeof s.score === 'number');
    assert.ok(s.rotulo);
    assert.ok(s.status_central);
  });

  await test('filtros conhecidos/novos não quebram', async () => {
    const a = await central.listarItens({ conhecidos: '1' });
    const b = await central.listarItens({ novos: '1' });
    assert.ok(Array.isArray(a) && Array.isArray(b));
  });

  console.log(`\nResultado: ${passou} ok, ${falhou} falhou\n`);
  process.exit(falhou > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
