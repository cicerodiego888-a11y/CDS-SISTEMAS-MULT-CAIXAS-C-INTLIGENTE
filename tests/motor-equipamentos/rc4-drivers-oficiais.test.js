/**
 * RC4.0 — Drivers Oficiais
 * Executar: node tests/motor-equipamentos/rc4-drivers-oficiais.test.js
 */

const assert = require('assert');
const BaseDriver = require('../../backend/motores/equipamentos/drivers/BaseDriver');
const ToledoPrix4UnoDriver = require('../../backend/motores/equipamentos/drivers/toledo/prix4/ToledoPrix4UnoDriver');
const FilizolaPlatinaDriver = require('../../backend/motores/equipamentos/drivers/filizola/FilizolaPlatinaDriver');
const UranoPopDriver = require('../../backend/motores/equipamentos/drivers/urano/UranoPopDriver');
const AclasLs2Driver = require('../../backend/motores/equipamentos/drivers/aclas/AclasLs2Driver');
const ElginDp30Driver = require('../../backend/motores/equipamentos/drivers/elgin/ElginDp30Driver');
const BematechBp5Driver = require('../../backend/motores/equipamentos/drivers/bematech/BematechBp5Driver');
const { calcularHealthDriver, montarCapacidades } = require('../../backend/motores/equipamentos/drivers/comum/oficial/DriverOficialCore');
const perfilToledo = require('../../backend/motores/equipamentos/drivers/toledo/prix4/ToledoOficialPerfil');

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

const FABRICANTES = [
  { nome: 'Toledo', Classe: ToledoPrix4UnoDriver },
  { nome: 'Filizola', Classe: FilizolaPlatinaDriver },
  { nome: 'Urano', Classe: UranoPopDriver },
  { nome: 'Aclas', Classe: AclasLs2Driver },
  { nome: 'Elgin', Classe: ElginDp30Driver },
  { nome: 'Bematech', Classe: BematechBp5Driver }
];

const METODOS_OFICIAIS = [
  'descobrir', 'handshake', 'identificar', 'diagnostico',
  'contribuirHealth', 'healthScore', 'heartbeatPerfil',
  'lerConfiguracao', 'compararConfiguracao', 'aplicarConfiguracao',
  'backupConfiguracao', 'restaurarConfiguracao',
  'sincronizarProduto', 'sincronizarProdutos', 'sincronizarDepartamento',
  'sincronizarConfiguracoes'
];

async function main() {
  console.log('\n=== RC4.0 — Drivers Oficiais ===\n');

  await test('todos passam validação BaseDriver', () => {
    for (const f of FABRICANTES) {
      const val = BaseDriver.validarHeranca(f.Classe);
      assert.ok(val.valido, `${f.nome}: ${val.erros?.join('; ')}`);
    }
  });

  await test('informacoes().oficial e capacidades', () => {
    for (const f of FABRICANTES) {
      const d = new f.Classe();
      const info = d.informacoes();
      assert.strictEqual(info.oficial, true, f.nome);
      assert.ok(info.capacidades?.handshake, f.nome);
      assert.ok(info.capacidades?.sincronizacao, f.nome);
      assert.ok(info.capacidades?.configuracao, f.nome);
      assert.ok(Array.isArray(info.firmware_conhecido), f.nome);
    }
  });

  await test('métodos oficiais presentes', () => {
    for (const f of FABRICANTES) {
      const d = new f.Classe();
      for (const m of METODOS_OFICIAIS) {
        assert.strictEqual(typeof d[m], 'function', `${f.nome}.${m}`);
      }
    }
  });

  await test('handshake + identidade (firmware/série/modelo)', async () => {
    for (const f of FABRICANTES) {
      const d = new f.Classe();
      const hs = await d.handshake();
      assert.ok(hs.sucesso !== false, f.nome);
      assert.ok(hs.identidade?.firmware || hs.passos?.length, f.nome);
      const id = await d.identificar();
      assert.ok(id.identidade?.modelo || id.identidade?.numero_serie, f.nome);
    }
  });

  await test('diagnóstico com alertas/problemas/soluções/recomendações', async () => {
    for (const f of FABRICANTES) {
      const d = new f.Classe();
      const diag = await d.diagnostico();
      assert.ok(Array.isArray(diag.alertas) || Array.isArray(diag.recomendacoes), f.nome);
      assert.ok(Array.isArray(diag.recomendacoes), f.nome);
      assert.ok(diag.oficial === true || diag.driver?.oficial === true || diag.sucesso === true, f.nome);
    }
  });

  await test('Health Score específico Toledo (latência/protocolo/fila/timeout/firmware)', () => {
    const ok = calcularHealthDriver(perfilToledo, {
      latencia_ms: 50,
      desconectado: false
    });
    assert.ok(ok.score >= 90);

    const ruim = calcularHealthDriver(perfilToledo, {
      latencia_ms: 2500,
      erro_protocolo: true,
      fila: 20,
      timeout: true,
      firmware_incompativel: true,
      desconectado: false
    });
    assert.ok(ruim.score < ok.score);
    assert.ok(ruim.fatores.includes('latencia') || ruim.fatores.includes('erro_protocolo'));
  });

  await test('configuração ler/comparar/aplicar/backup/restaurar', async () => {
    for (const f of FABRICANTES) {
      const d = new f.Classe();
      const lida = await d.lerConfiguracao();
      assert.ok(lida.configuracao);

      await d.aplicarConfiguracao({ timeout_ms: 7777, unidade: 'g' });
      const cmp = await d.compararConfiguracao({ timeout_ms: 7777, unidade: 'kg' });
      assert.strictEqual(cmp.iguais, false);
      assert.ok(cmp.diferencas.length >= 1);

      const bak = await d.backupConfiguracao();
      assert.ok(bak.backup?.configuracao);

      await d.aplicarConfiguracao({ timeout_ms: 1 });
      const rest = await d.restaurarConfiguracao();
      assert.ok(rest.sucesso !== false);
      const depois = await d.lerConfiguracao();
      assert.strictEqual(Number(depois.configuracao.timeout_ms), 7777);
    }
  });

  await test('sincronização produtos/PLU/departamentos/config', async () => {
    for (const f of FABRICANTES) {
      const d = new f.Classe();
      const prod = await d.sincronizarProduto({
        codigo: '1001',
        plu: 1001,
        descricao: 'Banana',
        preco: 5.99,
        departamento: 2
      });
      assert.ok(prod.sucesso !== false, f.nome);
      if (prod.plu) assert.strictEqual(String(prod.plu.plu), '1001');

      const lote = await d.sincronizarProdutos([
        { codigo: '1', plu: 1, descricao: 'A', preco: 1, departamento: 1 },
        { codigo: '2', plu: 2, descricao: 'B', preco: 2, departamento: 1 }
      ]);
      assert.ok(lote.quantidade === 2 || lote.mapeados === 2 || lote.plus?.length === 2, f.nome);

      const dep = await d.sincronizarDepartamento({ codigo: 1, id: 1, nome: 'Hortifruti' });
      assert.ok(dep.sucesso !== false, f.nome);

      const cfg = await d.sincronizarConfiguracoes({ departamento_padrao: 3 });
      assert.ok(cfg.sucesso !== false, f.nome);
    }
  });

  await test('capacidades oficiais montadas', () => {
    const caps = montarCapacidades(perfilToledo);
    assert.strictEqual(caps.discovery, true);
    assert.strictEqual(caps.handshake, true);
    assert.strictEqual(caps.health_especifico, true);
    assert.strictEqual(caps.sync_plu, true);
  });

  console.log(`\nResultado: ${passou} ok, ${falhou} falhou\n`);
  process.exit(falhou > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
