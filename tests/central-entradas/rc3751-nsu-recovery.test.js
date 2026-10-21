/**
 * RC3.7.5.1 — Auto recuperação do cursor NSU após cStat 656.
 */

const assert = require('assert');
const CentralNsuService = require(
  '../../backend/motores/central-entradas/services/CentralNsuService'
);
const NsuRecoveryService = require(
  '../../backend/motores/central-entradas/services/NsuRecoveryService'
);
const { TIPOS_EVENTO } = require(
  '../../backend/motores/central-entradas/config/centralEventosTipos'
);

let passou = 0;
let falhou = 0;

function test(nome, fn) {
  const inicio = Date.now();
  return Promise.resolve()
    .then(fn)
    .then(() => {
      passou += 1;
      console.log(`  OK  ${nome} (${Date.now() - inicio}ms)`);
    })
    .catch((error) => {
      falhou += 1;
      console.error(`  FALHOU  ${nome}`);
      console.error(`         ${error.stack || error.message}`);
    });
}

function criarNsuRepoMemoria(inicial = {}) {
  let row = {
    id: 1,
    cnpj: '12345678000199',
    ambiente: 2,
    ultNsu: inicial.ultNsu || '000000000000000',
    maxNsu: inicial.maxNsu || '000000000000000',
    dataSincronizacao: inicial.dataSincronizacao || null,
    cooldownAte: null,
    ultimoCstat: null,
    updatedAt: new Date().toISOString()
  };

  return {
    obterOuCriar: async () => ({ ...row }),
    buscarPorCnpjAmbiente: async () => ({ ...row }),
    buscarPorId: async () => ({ ...row }),
    atualizarSincronizacaoSegura: async (id, dados) => {
      if (dados.preservarNsu) {
        row = {
          ...row,
          dataSincronizacao: dados.dataSincronizacao || row.dataSincronizacao,
          cooldownAte: dados.cooldownAte !== undefined ? dados.cooldownAte : row.cooldownAte,
          ultimoCstat: dados.ultimoCstat !== undefined ? dados.ultimoCstat : row.ultimoCstat
        };
        return { ...row };
      }
      const atual = row.ultNsu;
      if (String(dados.ultNsu) >= String(atual)) {
        row = {
          ...row,
          ultNsu: dados.ultNsu,
          maxNsu: dados.maxNsu,
          dataSincronizacao: dados.dataSincronizacao,
          cooldownAte: dados.cooldownAte !== undefined ? dados.cooldownAte : row.cooldownAte,
          ultimoCstat: dados.ultimoCstat || row.ultimoCstat
        };
      } else {
        row = {
          ...row,
          dataSincronizacao: dados.dataSincronizacao || row.dataSincronizacao,
          ultimoCstat: dados.ultimoCstat || row.ultimoCstat
        };
      }
      return { ...row };
    },
    _peek: () => ({ ...row }),
    _set: (patch) => { row = { ...row, ...patch }; }
  };
}

async function main() {
  console.log('\n=== RC3.7.5.1 — Auto recuperação NSU ===\n');
  NsuRecoveryService.limparCacheEventos();

  await test('656 com NSUs remotos → preserva cursor até reconciliação verificada', async () => {
    NsuRecoveryService.limparCacheEventos();
    const auditorias = [];
    const repo = criarNsuRepoMemoria({
      ultNsu: '000000000000000',
      maxNsu: '000000000000000'
    });
    const service = new CentralNsuService({
      nsuRepository: repo,
      emitirEvento: async (ev) => { auditorias.push(ev); }
    });
    const controle = await service.obterOuCriar('12345678000199', 2);

    const consumo = await service.aplicarRetornoDistDfe({
      controle,
      cStat: '656',
      xmlRetorno: '<retDistDFeInt><cStat>656</cStat><xMotivo>Consumo Indevido</xMotivo>'
        + '<ultNSU>000000000000428</ultNSU><maxNSU>000000000000500</maxNSU></retDistDFeInt>',
      ultNsu: '000000000000428',
      maxNsu: '000000000000500',
      correlationId: 'rc3751-restore-1',
      empresa: '12345678000199'
    });

    assert.strictEqual(consumo.atualizouNsu, false);
    assert.strictEqual(consumo.preservado, true);
    assert.strictEqual(consumo.ultNsu, '000000000000000');
    assert.strictEqual(consumo.maxNsu, '000000000000000');
    assert.strictEqual(consumo.cooldownAtivo, true);
    assert.ok(consumo.proximaConsultaEm);
    assert.strictEqual(repo._peek().ultNsu, '000000000000000');
    assert.strictEqual(repo._peek().ultimoCstat, '656');
    assert.ok(repo._peek().cooldownAte);

    assert.strictEqual(consumo.recuperacaoNsu.motivo, 'CSTAT_656_REQUER_RECONCILIACAO_CONTROLADA');
    assert.strictEqual(auditorias.length, 0);
  });

  await test('NSU local igual ao SEFAZ → nenhuma alteração', async () => {
    NsuRecoveryService.limparCacheEventos();
    const repo = criarNsuRepoMemoria({
      ultNsu: '000000000000428',
      maxNsu: '000000000000428'
    });
    const service = new CentralNsuService({ nsuRepository: repo });
    const controle = await service.obterOuCriar('12345678000199', 2);

    const consumo = await service.aplicarRetornoDistDfe({
      controle,
      cStat: '656',
      xmlRetorno: '<retDistDFeInt><cStat>656</cStat>'
        + '<ultNSU>000000000000428</ultNSU><maxNSU>000000000000428</maxNSU></retDistDFeInt>',
      ultNsu: '000000000000428',
      maxNsu: '000000000000428',
      correlationId: 'rc3751-igual'
    });

    assert.strictEqual(consumo.atualizouNsu, false);
    assert.strictEqual(consumo.preservado, true);
    assert.strictEqual(consumo.ultNsu, '000000000000428');
    assert.strictEqual(repo._peek().ultNsu, '000000000000428');
    assert.strictEqual(consumo.recuperacaoNsu.motivo, 'CSTAT_656_REQUER_RECONCILIACAO_CONTROLADA');
  });

  await test('SEFAZ sem ultNSU/maxNSU → nenhuma alteração (regressão RC3.3.3)', async () => {
    NsuRecoveryService.limparCacheEventos();
    const repo = criarNsuRepoMemoria({
      ultNsu: '000000000000050',
      maxNsu: '000000000000050'
    });
    const service = new CentralNsuService({ nsuRepository: repo });
    const controle = await service.obterOuCriar('12345678000199', 2);

    const consumo = await service.aplicarRetornoDistDfe({
      controle,
      cStat: '656',
      xmlRetorno: '<retDistDFeInt><cStat>656</cStat><xMotivo>Consumo Indevido</xMotivo></retDistDFeInt>',
      correlationId: 'rc3751-sem-tags'
    });

    assert.strictEqual(consumo.atualizouNsu, false);
    assert.strictEqual(consumo.preservado, true);
    assert.strictEqual(consumo.ultNsu, '000000000000050');
    assert.strictEqual(repo._peek().ultNsu, '000000000000050');
    assert.strictEqual(consumo.recuperacaoNsu.motivo, 'CSTAT_656_REQUER_RECONCILIACAO_CONTROLADA');
    assert.strictEqual(consumo.cooldownAtivo, true);
  });

  await test('SEFAZ retorna NSU menor → ignora atualização', async () => {
    NsuRecoveryService.limparCacheEventos();
    const repo = criarNsuRepoMemoria({
      ultNsu: '000000000000500',
      maxNsu: '000000000000500'
    });
    const service = new CentralNsuService({ nsuRepository: repo });
    const controle = await service.obterOuCriar('12345678000199', 2);

    const consumo = await service.aplicarRetornoDistDfe({
      controle,
      cStat: '656',
      xmlRetorno: '<retDistDFeInt><cStat>656</cStat>'
        + '<ultNSU>000000000000100</ultNSU><maxNSU>000000000000100</maxNSU></retDistDFeInt>',
      ultNsu: '000000000000100',
      maxNsu: '000000000000100',
      correlationId: 'rc3751-menor'
    });

    assert.strictEqual(consumo.atualizouNsu, false);
    assert.strictEqual(consumo.ultNsu, '000000000000500');
    assert.strictEqual(repo._peek().ultNsu, '000000000000500');
  });

  await test('repetição de 656 não avança cursor sem reconciliação verificada', async () => {
    NsuRecoveryService.limparCacheEventos();
    const auditorias = [];
    const repo = criarNsuRepoMemoria({
      ultNsu: '000000000000000',
      maxNsu: '000000000000000'
    });
    const service = new CentralNsuService({
      nsuRepository: repo,
      emitirEvento: async (ev) => { auditorias.push(ev); }
    });
    const controle = await service.obterOuCriar('12345678000199', 2);
    const xml = '<retDistDFeInt><cStat>656</cStat>'
      + '<ultNSU>000000000000428</ultNSU><maxNSU>000000000000428</maxNSU></retDistDFeInt>';

    const r1 = await service.aplicarRetornoDistDfe({
      controle,
      cStat: '656',
      xmlRetorno: xml,
      ultNsu: '000000000000428',
      maxNsu: '000000000000428',
      correlationId: 'rc3751-once'
    });
    assert.strictEqual(r1.atualizouNsu, false);

    const r2 = await service.aplicarRetornoDistDfe({
      controle: r1.controle,
      cStat: '656',
      xmlRetorno: xml,
      ultNsu: '000000000000428',
      maxNsu: '000000000000428',
      correlationId: 'rc3751-once'
    });
    assert.strictEqual(r2.atualizouNsu, false);
    assert.strictEqual(r2.recuperacaoNsu.motivo, 'CSTAT_656_REQUER_RECONCILIACAO_CONTROLADA');
    assert.strictEqual(auditorias.filter((a) => a.tipo === TIPOS_EVENTO.AUTO_SYNC_NSU).length, 0);
  });

  await test('cooldown persiste com cursor preservado', async () => {
    NsuRecoveryService.limparCacheEventos();
    const agora = new Date('2026-07-30T12:00:00.000Z');
    const repo = criarNsuRepoMemoria({
      ultNsu: '000000000000000',
      maxNsu: '000000000000000'
    });
    const service = new CentralNsuService({
      nsuRepository: repo,
      agora: () => agora,
      emitirEvento: async () => {}
    });
    const controle = await service.obterOuCriar('12345678000199', 2);

    const consumo = await service.aplicarRetornoDistDfe({
      controle,
      cStat: '656',
      xmlRetorno: '<retDistDFeInt><cStat>656</cStat>'
        + '<ultNSU>000000000000428</ultNSU><maxNSU>000000000000428</maxNSU></retDistDFeInt>',
      ultNsu: '000000000000428',
      maxNsu: '000000000000428',
      correlationId: 'rc3751-cd'
    });

    assert.strictEqual(consumo.atualizouNsu, false);
    assert.strictEqual(consumo.ultNsu, '000000000000000');
    const cd = service.avaliarCooldown(consumo.controle);
    assert.strictEqual(cd.ativo, true);
    assert.strictEqual(cd.proximaConsultaEm, '2026-07-30T13:00:00.000Z');
  });

  await test('diagnóstico status NSU — atualizado / aguardando cooldown', async () => {
    const recovery = new NsuRecoveryService({
      agora: () => new Date('2026-07-30T12:30:00.000Z')
    });

    const sync = recovery.statusDiagnostico({
      ultNsu: '000000000000100',
      maxNsu: '000000000000100',
      ultimoCstat: '138',
      cooldownAte: null
    });
    assert.strictEqual(sync.status, 'Sincronizado');

    const auto = recovery.statusDiagnostico({
      ultNsu: '000000000000428',
      maxNsu: '000000000000500',
      ultimoCstat: '656',
      cooldownAte: '2026-07-30T13:00:00.000Z'
    }, { atualizou: true, nsuRemoto: '000000000000428' });
    assert.strictEqual(auto.status, 'Reconciliação controlada');
    assert.strictEqual(auto.nsuLocal, '000000000000428');
    assert.strictEqual(auto.nsuSefaz, '000000000000428');

    const wait = recovery.statusDiagnostico({
      ultNsu: '000000000000428',
      maxNsu: '000000000000500',
      ultimoCstat: '656',
      cooldownAte: '2026-07-30T13:00:00.000Z'
    });
    assert.strictEqual(wait.status, 'Aguardando cooldown');
  });

  await test('cStat != 656 → recovery não executa alteração', async () => {
    NsuRecoveryService.limparCacheEventos();
    const repo = criarNsuRepoMemoria({ ultNsu: '000000000000010', maxNsu: '000000000000010' });
    const recovery = new NsuRecoveryService({ nsuRepository: repo });
    const r = await recovery.tentarRecuperar({
      controle: await repo.obterOuCriar(),
      cStat: '137',
      ultNsu: '000000000000999',
      maxNsu: '000000000000999'
    });
    assert.strictEqual(r.atualizou, false);
    assert.strictEqual(r.motivo, 'CSTAT_DIFERENTE');
    assert.strictEqual(repo._peek().ultNsu, '000000000000010');
  });

  console.log(`\nResultado: ${passou} ok, ${falhou} falha(s)\n`);
  if (falhou > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
