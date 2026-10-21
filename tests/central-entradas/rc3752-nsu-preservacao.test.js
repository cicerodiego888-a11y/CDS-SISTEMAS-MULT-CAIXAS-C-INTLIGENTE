/**
 * RC3.7.5.2 — Preservação do estado do NSU (null vs zero).
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  normalizarNsu,
  extrairMetadadosRetorno,
  extrairNsuTagDoXml,
  salvarXmlRetorno656
} = require('../../backend/services/fiscal/dfeRetornoParser');
const NsuRecoveryService = require(
  '../../backend/motores/central-entradas/services/NsuRecoveryService'
);
const CentralNsuService = require(
  '../../backend/motores/central-entradas/services/CentralNsuService'
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
    dataSincronizacao: null,
    cooldownAte: null,
    ultimoCstat: null,
    updatedAt: new Date().toISOString()
  };
  return {
    obterOuCriar: async () => ({ ...row }),
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
      if (String(dados.ultNsu) >= String(row.ultNsu)) {
        row = {
          ...row,
          ultNsu: dados.ultNsu,
          maxNsu: dados.maxNsu,
          dataSincronizacao: dados.dataSincronizacao,
          ultimoCstat: dados.ultimoCstat || row.ultimoCstat
        };
      }
      return { ...row };
    },
    _peek: () => ({ ...row })
  };
}

async function main() {
  console.log('\n=== RC3.7.5.2 — Preservação estado NSU ===\n');
  NsuRecoveryService.limparCacheEventos();

  await test('656 sem ultNSU → NULL no parser', async () => {
    const meta = extrairMetadadosRetorno(
      '<retDistDFeInt><cStat>656</cStat><xMotivo>Consumo Indevido</xMotivo></retDistDFeInt>'
    );
    assert.strictEqual(meta.ultNSU, null);
    assert.strictEqual(meta.maxNSU, null);
    assert.strictEqual(normalizarNsu(null), null);
  });

  await test('656 com ultNSU → valor correto', async () => {
    const meta = extrairMetadadosRetorno(
      '<retDistDFeInt><cStat>656</cStat>'
      + '<ultNSU>000000000000428</ultNSU><maxNSU>000000000000500</maxNSU></retDistDFeInt>'
    );
    assert.strictEqual(meta.ultNSU, '000000000000428');
    assert.strictEqual(meta.maxNSU, '000000000000500');
  });

  await test('656 com namespace → valor correto', async () => {
    const xml = '<ns1:retDistDFeInt xmlns:ns1="http://www.portalfiscal.inf.br/nfe">'
      + '<ns1:cStat>656</ns1:cStat>'
      + '<ns1:ultNSU>428</ns1:ultNSU>'
      + '<ns1:maxNSU>500</ns1:maxNSU></ns1:retDistDFeInt>';
    const meta = extrairMetadadosRetorno(xml);
    assert.strictEqual(meta.ultNSU, '000000000000428');
    assert.strictEqual(meta.maxNSU, '000000000000500');
    assert.strictEqual(extrairNsuTagDoXml(xml, 'ultNSU'), '000000000000428');
  });

  await test('Fallback recupera NSU quando params null + XML namespaced', async () => {
    NsuRecoveryService.limparCacheEventos();
    const auditorias = [];
    const repo = criarNsuRepoMemoria({ ultNsu: '000000000000000', maxNsu: '000000000000000' });
    const recovery = new NsuRecoveryService({
      nsuRepository: repo,
      emitirEvento: async (ev) => { auditorias.push(ev); }
    });
    const xml = '<nfe:retDistDFeInt xmlns:nfe="http://www.portalfiscal.inf.br/nfe">'
      + '<nfe:cStat>656</nfe:cStat>'
      + '<nfe:ultNSU>000000000000428</nfe:ultNSU>'
      + '<nfe:maxNSU>000000000000500</nfe:maxNSU></nfe:retDistDFeInt>';

    const r = await recovery.tentarRecuperar({
      controle: await repo.obterOuCriar(),
      cStat: '656',
      ultNsu: null,
      maxNsu: null,
      xmlRetorno: xml,
      correlationId: 'rc3752-fallback',
      requestId: 'req-rc3752-fallback',
      evidenciaSequencia: {
        confirmada: true,
        confirmadoPor: 'operador-teste',
        requestId: 'req-rc3752-fallback',
        correlationId: 'rc3752-fallback',
        cnpj: '12345678000199',
        ambiente: 2,
        cursorLocal: '000000000000000',
        nsuEnviado: '000000000000000'
      }
    });

    assert.strictEqual(r.atualizou, true);
    assert.strictEqual(r.nsuRemoto, '000000000000428');
    assert.strictEqual(r.origemUltNsu, 'Fallback XML');
    assert.ok(auditorias.some((a) => a.tipo === TIPOS_EVENTO.NSU_RECOVERED_FROM_XML));
    assert.ok(auditorias.some((a) => a.tipo === TIPOS_EVENTO.AUTO_SYNC_NSU));
    assert.strictEqual(repo._peek().ultNsu, '000000000000428');
  });

  await test('recuperação direta rejeita ausência de evidência da sequência', async () => {
    const repo = criarNsuRepoMemoria({ ultNsu: '000000000000736', maxNsu: '000000000000736' });
    const recovery = new NsuRecoveryService({ nsuRepository: repo });
    const xml = '<retDistDFeInt><cStat>656</cStat>'
      + '<ultNSU>000000000000810</ultNSU><maxNSU>000000000000900</maxNSU></retDistDFeInt>';
    const result = await recovery.tentarRecuperar({
      controle: await repo.obterOuCriar(),
      cStat: '656',
      xmlRetorno: xml,
      correlationId: 'rc3752-no-evidence',
      ultNsu: '000000000000810',
      maxNsu: '000000000000900'
    });

    assert.strictEqual(result.atualizou, false);
    assert.strictEqual(result.motivo, 'EVIDENCIA_SEQUENCIA_NAO_VERIFICADA');
    assert.strictEqual(repo._peek().ultNsu, '000000000000736');
  });

  await test('XML de diagnóstico 656 preserva cursor 736 e cooldown sobrevive a reinício', async () => {
    const xmlPath = path.join(
      __dirname,
      '../../dados/fiscal/debug/dfe-ret-656-SYNC-20261009-204524-642.xml'
    );
    const xml = fs.readFileSync(xmlPath, 'utf8');
    const meta = extrairMetadadosRetorno(xml);
    assert.strictEqual(meta.cStat, '656');
    assert.strictEqual(meta.ultNSU, '000000000000810');
    assert.strictEqual(meta.maxNSU, '000000000000000');

    const agora = { valor: new Date('2026-10-09T23:00:00.000Z') };
    const repo = criarNsuRepoMemoria({
      ultNsu: '000000000000736',
      maxNsu: '000000000000736'
    });
    const primeiraExecucao = new CentralNsuService({
      nsuRepository: repo,
      agora: () => agora.valor
    });
    const resultado = await primeiraExecucao.aplicarRetornoDistDfe({
      controle: await primeiraExecucao.obterOuCriar('12345678000199', 2),
      cStat: meta.cStat,
      xmlRetorno: xml,
      ultNsu: meta.ultNSU,
      maxNsu: meta.maxNSU,
      correlationId: 'rc3752-diagnostic-656',
      requestId: 'fixture-request'
    });

    assert.strictEqual(resultado.atualizouNsu, false);
    assert.strictEqual(resultado.ultNsu, '000000000000736');
    assert.strictEqual(resultado.maxNsu, '000000000000736');
    assert.strictEqual(repo._peek().cooldownAte, '2026-10-10T00:00:00.000Z');

    agora.valor = new Date('2026-10-09T23:59:59.000Z');
    const aposReinicio = new CentralNsuService({ nsuRepository: repo, agora: () => agora.valor });
    assert.strictEqual(aposReinicio.avaliarCooldown(await repo.buscarPorId(1)).ativo, true);
    agora.valor = new Date('2026-10-10T00:00:01.000Z');
    assert.strictEqual(aposReinicio.avaliarCooldown(await repo.buscarPorId(1)).ativo, false);
    assert.strictEqual(repo._peek().ultNsu, '000000000000736');
  });

  await test('NSU inexistente → não atualizar', async () => {
    NsuRecoveryService.limparCacheEventos();
    const repo = criarNsuRepoMemoria({ ultNsu: '000000000000000', maxNsu: '000000000000000' });
    const service = new CentralNsuService({
      nsuRepository: repo,
      emitirEvento: async () => {}
    });
    const consumo = await service.aplicarRetornoDistDfe({
      controle: await service.obterOuCriar('12345678000199', 2),
      cStat: '656',
      ultNsu: null,
      maxNsu: null,
      xmlRetorno: '<retDistDFeInt><cStat>656</cStat><xMotivo>Consumo Indevido</xMotivo></retDistDFeInt>',
      correlationId: 'rc3752-ausente'
    });
    assert.strictEqual(consumo.atualizouNsu, false);
    assert.strictEqual(consumo.recuperacaoNsu.motivo, 'CSTAT_656_REQUER_RECONCILIACAO_CONTROLADA');
    assert.strictEqual(repo._peek().ultNsu, '000000000000000');
    assert.strictEqual(repo._peek().ultimoCstat, '656');
  });

  await test('656 com tags → cursor preservado para reconciliação controlada', async () => {
    NsuRecoveryService.limparCacheEventos();
    const repo = criarNsuRepoMemoria({ ultNsu: '000000000000000', maxNsu: '000000000000000' });
    const service = new CentralNsuService({
      nsuRepository: repo,
      emitirEvento: async () => {}
    });
    const meta = extrairMetadadosRetorno(
      '<retDistDFeInt><cStat>656</cStat>'
      + '<ultNSU>000000000000428</ultNSU><maxNSU>000000000000500</maxNSU></retDistDFeInt>'
    );
    const consumo = await service.aplicarRetornoDistDfe({
      controle: await service.obterOuCriar('12345678000199', 2),
      cStat: '656',
      ultNsu: meta.ultNSU,
      maxNsu: meta.maxNSU,
      xmlRetorno: '<retDistDFeInt><cStat>656</cStat>'
        + '<ultNSU>000000000000428</ultNSU><maxNSU>000000000000500</maxNSU></retDistDFeInt>',
      correlationId: 'rc3752-restore'
    });
    assert.strictEqual(consumo.atualizouNsu, false);
    assert.strictEqual(consumo.ultNsu, '000000000000000');
    assert.strictEqual(consumo.maxNsu, '000000000000000');
    assert.strictEqual(consumo.recuperacaoNsu.motivo, 'CSTAT_656_REQUER_RECONCILIACAO_CONTROLADA');
    assert.strictEqual(consumo.cooldownAtivo, true);
  });

  await test('salvarXmlRetorno656 grava arquivo de diagnóstico', async () => {
    const destino = salvarXmlRetorno656(
      '<retDistDFeInt><cStat>656</cStat></retDistDFeInt>',
      { correlationId: 'rc3752-dump-test' }
    );
    assert.ok(destino);
    assert.ok(fs.existsSync(destino));
    const conteudo = fs.readFileSync(destino, 'utf8');
    assert.ok(conteudo.includes('cStat>656'));
    try { fs.unlinkSync(destino); } catch (_) { /* ignore */ }
  });

  console.log(`\nResultado: ${passou} ok, ${falhou} falha(s)\n`);
  if (falhou > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
