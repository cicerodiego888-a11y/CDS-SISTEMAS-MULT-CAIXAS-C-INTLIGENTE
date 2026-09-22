/**
 * Sprint 3 — Auditoria e robustez distNSU / CentralNsuService
 * node --test tests/central-entradas/sprint3-distnsu-cursor.test.js
 */
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '../..');
const {
  FLUXO_DIST_NSU,
  REGRA_AVANCO,
  DistNsuStatus,
  avaliarAvancoCursor,
  existemDocumentosPosteriores,
  detectarLacunasNsu,
  DistNsuSyncLock,
  CentralDistNsuDiagnosticoService
} = require('../../backend/motores/central-entradas/descoberta-nsu');
const CentralNsuService = require('../../backend/motores/central-entradas/services/CentralNsuService');

function ler(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

function criarNsuRepoMemoria(inicial = {}) {
  const rows = new Map();
  let seq = 1;
  const key = (cnpj, amb) => `${String(cnpj).replace(/\D/g, '')}|${amb}`;
  if (inicial.cnpj) {
    const k = key(inicial.cnpj, inicial.ambiente || 1);
    rows.set(k, {
      id: seq++,
      cnpj: String(inicial.cnpj).replace(/\D/g, ''),
      ambiente: inicial.ambiente || 1,
      ultNsu: inicial.ultNsu || '000000000000100',
      maxNsu: inicial.maxNsu || '000000000000100',
      dataSincronizacao: null,
      cooldownAte: null,
      ultimoCstat: null
    });
  }
  return {
    rows,
    async obterOuCriar(cnpj, ambiente) {
      const k = key(cnpj, ambiente);
      if (!rows.has(k)) {
        rows.set(k, {
          id: seq++,
          cnpj: String(cnpj).replace(/\D/g, ''),
          ambiente: Number(ambiente) === 1 ? 1 : 2,
          ultNsu: '000000000000000',
          maxNsu: '000000000000000',
          dataSincronizacao: null,
          cooldownAte: null,
          ultimoCstat: null
        });
      }
      return { ...rows.get(k) };
    },
    async buscarPorCnpjAmbiente(cnpj, ambiente) {
      return rows.get(key(cnpj, ambiente)) || null;
    },
    async atualizarSincronizacaoSegura(id, dados = {}) {
      let row = [...rows.values()].find((r) => r.id === id);
      if (!row) return null;
      if (dados.preservarNsu) {
        row = {
          ...row,
          dataSincronizacao: dados.dataSincronizacao || row.dataSincronizacao,
          ultimoCstat: dados.ultimoCstat !== undefined ? dados.ultimoCstat : row.ultimoCstat,
          cooldownAte: dados.cooldownAte !== undefined ? dados.cooldownAte : row.cooldownAte,
          ultimoRequestId: dados.ultimoRequestId !== undefined ? dados.ultimoRequestId : row.ultimoRequestId,
          ultimoLoteQtd: dados.ultimoLoteQtd !== undefined ? dados.ultimoLoteQtd : row.ultimoLoteQtd,
          ultimoXmotivo: dados.ultimoXmotivo !== undefined ? dados.ultimoXmotivo : row.ultimoXmotivo,
          ultimoStatusSync: dados.ultimoStatusSync !== undefined ? dados.ultimoStatusSync : row.ultimoStatusSync,
          lacunasJson: dados.lacunasJson !== undefined
            ? (typeof dados.lacunasJson === 'string' ? dados.lacunasJson : JSON.stringify(dados.lacunasJson))
            : row.lacunasJson,
          cursorAnterior: dados.cursorAnterior !== undefined ? dados.cursorAnterior : row.cursorAnterior,
          motivoAvanco: dados.motivoAvanco !== undefined ? dados.motivoAvanco : row.motivoAvanco
        };
      } else {
        const novoUlt = dados.ultNsu;
        const novoMax = dados.maxNsu;
        if (novoUlt != null && String(novoUlt) >= String(row.ultNsu)) {
          row = {
            ...row,
            ultNsu: novoUlt,
            maxNsu: novoMax != null ? novoMax : row.maxNsu,
            dataSincronizacao: dados.dataSincronizacao || row.dataSincronizacao,
            ultimoCstat: dados.ultimoCstat !== undefined ? dados.ultimoCstat : row.ultimoCstat,
            cooldownAte: dados.cooldownAte !== undefined ? dados.cooldownAte : row.cooldownAte,
            ultimoRequestId: dados.ultimoRequestId,
            ultimoLoteQtd: dados.ultimoLoteQtd,
            ultimoXmotivo: dados.ultimoXmotivo,
            ultimoStatusSync: dados.ultimoStatusSync,
            lacunasJson: dados.lacunasJson != null
              ? (typeof dados.lacunasJson === 'string' ? dados.lacunasJson : JSON.stringify(dados.lacunasJson))
              : row.lacunasJson,
            cursorAnterior: dados.cursorAnterior,
            motivoAvanco: dados.motivoAvanco
          };
        }
      }
      const k = key(row.cnpj, row.ambiente);
      rows.set(k, row);
      return { ...row };
    }
  };
}

describe('Sprint 3 — mapa / contratos', () => {
  it('mapa de auditoria cobre CentralNsuService e sync', () => {
    assert.ok(FLUXO_DIST_NSU.length >= 8);
    assert.ok(FLUXO_DIST_NSU.some((f) => f.arquivo.includes('CentralNsuService')));
    assert.ok(FLUXO_DIST_NSU.some((f) => f.arquivo.includes('distribuicaoDFe')));
    assert.ok(REGRA_AVANCO.ultNsu);
    assert.ok(REGRA_AVANCO.maxNsu);
  });

  it('sync usa política de avanço e lacuna; Gate/Motor XML intactos', () => {
    const dfe = ler('backend/services/fiscal/distribuicaoDFe.js');
    assert.match(dfe, /avaliarAvancoCursor/);
    assert.match(dfe, /detectarLacunasNsu/);
    assert.match(dfe, /CentralNsuService/);
    const gate = ler('backend/services/fiscal/sefaz/SEFAZQueryGate.js');
    assert.match(gate, /class SEFAZQueryGate|SEFAZQueryGate/);
    const motor = ler('backend/motores/central-entradas/recuperacao-xml/MotorRecuperacaoXmlService.js');
    assert.match(motor, /SEFAZQueryGate|recuperacaoXml/);
  });
});

describe('Sprint 3 — cursor', () => {
  it('1-2. ultNSU correto e avança após lote processado', async () => {
    const repo = criarNsuRepoMemoria({
      cnpj: '14200166000187',
      ambiente: 1,
      ultNsu: '000000000000100',
      maxNsu: '000000000000100'
    });
    const svc = new CentralNsuService({
      nsuRepository: repo,
      nsuRecovery: { tentarRecuperar: async () => ({ atualizou: false }), logCooldown() {} }
    });
    const controle = await repo.obterOuCriar('14200166000187', 1);
    const r = await svc.aplicarRetornoDistDfe({
      controle,
      cStat: '138',
      xmlRetorno: '<retDistDFeInt><ultNSU>000000000000105</ultNSU><maxNSU>000000000000150</maxNSU></retDistDFeInt>',
      ultNsu: '000000000000105',
      maxNsu: '000000000000150',
      loteQtd: 4,
      requestId: 'SEFAZ-TEST',
      statusSync: DistNsuStatus.LOTE_PROCESSADO
    });
    assert.equal(r.atualizouNsu, true);
    assert.equal(r.ultNsu, '000000000000105');
    assert.equal(r.maxNsu, '000000000000150');
  });

  it('3. cursor não avança após erro de banco (política)', () => {
    const p = avaliarAvancoCursor({
      cStat: '138',
      persistidos: { errosPersistencia: 1, errosZip: 0, errosSchema: 0, recebidosZip: 2 }
    });
    assert.equal(p.avancar, false);
    assert.equal(p.status, DistNsuStatus.ERRO_BANCO);
  });

  it('4. cursor não regride', async () => {
    const repo = criarNsuRepoMemoria({
      cnpj: '14200166000187',
      ambiente: 1,
      ultNsu: '000000000000200',
      maxNsu: '000000000000200'
    });
    const svc = new CentralNsuService({
      nsuRepository: repo,
      nsuRecovery: { tentarRecuperar: async () => ({ atualizou: false }), logCooldown() {} }
    });
    const controle = await repo.obterOuCriar('14200166000187', 1);
    const r = await svc.aplicarRetornoDistDfe({
      controle,
      cStat: '138',
      xmlRetorno: '<retDistDFeInt><ultNSU>000000000000150</ultNSU><maxNSU>000000000000150</maxNSU></retDistDFeInt>',
      ultNsu: '000000000000150',
      maxNsu: '000000000000150'
    });
    assert.equal(r.atualizouNsu, false);
    assert.equal(r.preservado, true);
    assert.equal(r.ultNsu, '000000000000200');
  });

  it('5. cursor não avança após parser failure', () => {
    const p = avaliarAvancoCursor({
      cStat: '138',
      erro: new Error('XML parse failed'),
      tipoErro: 'PARSER'
    });
    assert.equal(p.avancar, false);
    assert.equal(p.status, DistNsuStatus.ERRO_PARSER);
  });

  it('6. cursor não avança após erro de banco (tipo)', () => {
    const p = avaliarAvancoCursor({
      cStat: '138',
      tipoErro: 'BANCO',
      erro: new Error('SQLITE_BUSY')
    });
    assert.equal(p.avancar, false);
  });

  it('7. timeout não move cursor', () => {
    const p = avaliarAvancoCursor({
      cStat: '',
      tipoErro: 'TIMEOUT',
      erro: new Error('ETIMEDOUT')
    });
    assert.equal(p.avancar, false);
  });

  it('8. restart recupera cursor (repositório é fonte única)', async () => {
    const repo = criarNsuRepoMemoria({
      cnpj: '111',
      ambiente: 1,
      ultNsu: '000000000000077',
      maxNsu: '000000000000090'
    });
    const a = new CentralNsuService({ nsuRepository: repo, nsuRecovery: { tentarRecuperar: async () => ({}), logCooldown() {} } });
    const b = new CentralNsuService({ nsuRepository: repo, nsuRecovery: { tentarRecuperar: async () => ({}), logCooldown() {} } });
    const ca = await a.obterOuCriar('111', 1);
    const cb = await b.obterOuCriar('111', 1);
    assert.equal(ca.ultNsu, cb.ultNsu);
    assert.equal(cb.ultNsu, '000000000000077');
  });
});

describe('Sprint 3 — idempotência / lacuna / maxNSU', () => {
  it('9-11. política lote OK avança; ZIP inválido não', () => {
    assert.equal(avaliarAvancoCursor({
      cStat: '138',
      persistidos: { errosPersistencia: 0, errosZip: 0, errosSchema: 0, recebidosZip: 3 }
    }).avancar, true);
    assert.equal(avaliarAvancoCursor({
      cStat: '138',
      persistidos: { errosPersistencia: 0, errosZip: 1, errosSchema: 0, recebidosZip: 3 }
    }).avancar, false);
  });

  it('15-17. maxNSU vs ultNSU e sem documentos', () => {
    assert.equal(existemDocumentosPosteriores('100', '150'), true);
    assert.equal(existemDocumentosPosteriores('150', '150'), false);
    const s = avaliarAvancoCursor({ cStat: '137', persistidos: { recebidosZip: 0, errosZip: 0, errosSchema: 0, errosPersistencia: 0 } });
    assert.equal(s.status, DistNsuStatus.SEM_NOVOS_DOCUMENTOS);
    assert.equal(s.avancar, true);
  });

  it('23-24. 137 avança com política; 656 não', () => {
    assert.equal(avaliarAvancoCursor({ cStat: '656' }).avancar, false);
    assert.equal(avaliarAvancoCursor({
      cStat: '137',
      persistidos: { errosZip: 0, errosSchema: 0, errosPersistencia: 0, recebidosZip: 0 }
    }).avancar, true);
  });

  it('25. lacuna 100,101,104 detectada sem fabricar NSU', () => {
    const r = detectarLacunasNsu(
      ['000000000000100', '000000000000101', '000000000000104'],
      { cnpj: '1', ambiente: 1 }
    );
    assert.equal(r.lacunas.length, 1);
    assert.equal(r.lacunas[0].intervalo, 2);
    assert.deepEqual(r.lacunas[0].nsusFabricados, []);
    assert.equal(r.status, DistNsuStatus.POSSIVEL_LACUNA_NSU);
  });
});

describe('Sprint 3 — concorrência / isolamento', () => {
  it('12. duas syncs mesmo CNPJ — segunda bloqueada', async () => {
    const lock = new DistNsuSyncLock();
    let liberar;
    const p1 = lock.comLock('a', () => new Promise((r) => { liberar = r; }), { cnpj: '111', ambiente: 1 });
    await new Promise((r) => setTimeout(r, 10));
    const p2 = await lock.comLock('b', async () => ({ ok: true }), { cnpj: '111', ambiente: 1 });
    assert.equal(p2.codigo, 'SYNC_EM_ANDAMENTO');
    liberar({ ok: true });
    await p1;
  });

  it('13-14. CNPJs e ambientes isolados', async () => {
    const lock = new DistNsuSyncLock();
    let liberarA;
    const pa = lock.comLock('a', () => new Promise((r) => { liberarA = r; }), { cnpj: '111', ambiente: 1 });
    await new Promise((r) => setTimeout(r, 5));
    const pb = await lock.comLock('b', async () => ({ ok: 'B' }), { cnpj: '222', ambiente: 1 });
    assert.equal(pb.ok, 'B');
    const ph = await lock.comLock('h', async () => ({ ok: 'H' }), { cnpj: '111', ambiente: 2 });
    assert.equal(ph.ok, 'H');
    liberarA({ ok: 'A' });
    await pa;
  });
});

describe('Sprint 3 — diagnóstico', () => {
  it('painel responde perguntas da sprint', async () => {
    const repo = criarNsuRepoMemoria({
      cnpj: '14200166000187',
      ambiente: 1,
      ultNsu: '000000000000100',
      maxNsu: '000000000000150'
    });
    const row = await repo.obterOuCriar('14200166000187', 1);
    await repo.atualizarSincronizacaoSegura(row.id, {
      preservarNsu: true,
      ultimoRequestId: 'SEFAZ-XYZ',
      ultimoLoteQtd: 4,
      ultimoCstat: '138',
      ultimoXmotivo: 'Documento localizado',
      ultimoStatusSync: DistNsuStatus.LOTE_PROCESSADO,
      dataSincronizacao: '2026-09-22T12:00:00.000Z'
    });
    const diag = new CentralDistNsuDiagnosticoService({
      nsuService: new CentralNsuService({
        nsuRepository: repo,
        nsuRecovery: { tentarRecuperar: async () => ({}), logCooldown() {} }
      }),
      documentosRepository: { contar: async () => 3 },
      syncLock: new DistNsuSyncLock()
    });
    const p = await diag.obterPainel('14200166000187', 1);
    assert.equal(p.ultimoNsuProcessado, '000000000000100');
    assert.equal(p.ultimoMaxNsuConhecido, '000000000000150');
    assert.equal(p.ultimoRequestId, 'SEFAZ-XYZ');
    assert.equal(p.quantidadeDocumentosUltimoLote, 4);
    assert.equal(p.ultimoCstat, '138');
    assert.equal(p.documentosPosterioresDisponiveis, true);
    assert.match(p.mensagemPosteriores, /posteriores disponíveis/i);
    assert.equal(p.documentosAguardandoXmlCompleto, 3);
    assert.ok(p.reconciliacao);
  });
});
