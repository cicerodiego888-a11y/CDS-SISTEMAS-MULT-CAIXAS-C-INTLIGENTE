/**
 * Sprint 1 — SEFAZ Query Gate
 * node --test tests/fiscal/sefaz-query-gate.test.js
 */
'use strict';

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '../..');
const {
  SEFAZQueryGate,
  TIPOS_CONSULTA,
  ORIGENS,
  ESTADOS_SOLICITACAO,
  ERROS,
  CIRCUIT_STATE,
  criarRequestId,
  SEFAZRateLimiter,
  SEFAZCooldown,
  SEFAZCircuitBreaker,
  SEFAZQueryQueue
} = require('../../backend/services/fiscal/sefaz');
const { _resetSeqForTests } = require('../../backend/services/fiscal/sefaz/SEFAZRequestId');

function criarGate(opts = {}) {
  const agoraRef = { t: opts.agoraMs != null ? opts.agoraMs : Date.now() };
  const gate = new SEFAZQueryGate({
    rateLimiter: new SEFAZRateLimiter({
      minIntervalMs: opts.minIntervalMs != null ? opts.minIntervalMs : 0,
      agora: () => agoraRef.t
    }),
    cooldown: new SEFAZCooldown({
      cooldown137Ms: opts.cooldown137Ms != null ? opts.cooldown137Ms : 60_000,
      cooldown656Ms: opts.cooldown656Ms != null ? opts.cooldown656Ms : 60_000,
      agora: () => agoraRef.t
    }),
    circuitBreaker: new SEFAZCircuitBreaker({
      openMs: opts.openMs != null ? opts.openMs : 100,
      agora: () => agoraRef.t
    }),
    queue: new SEFAZQueryQueue(),
    nsuService: opts.nsuService || null,
    waitCooldown: opts.waitCooldown === true,
    agora: () => agoraRef.t
  });
  gate._advance = (ms) => { agoraRef.t += ms; };
  return gate;
}

function nsuMock(ultNsu) {
  return {
    async buscarPorCnpjAmbiente() {
      return { ultNsu, maxNsu: ultNsu };
    },
    async obterOuCriar() {
      return { ultNsu, maxNsu: ultNsu };
    }
  };
}

describe('SEFAZ Query Gate — unitários', () => {
  beforeEach(() => {
    _resetSeqForTests();
  });

  it('1. Autorizar consulta', async () => {
    const gate = criarGate();
    const auth = await gate.autorizar({
      cnpj: '12345678000199',
      ambiente: 1,
      tipo: TIPOS_CONSULTA.DIST_NSU,
      origem: ORIGENS.CENTRAL_SYNC
    });
    assert.equal(auth.permitido, true);
    assert.equal(auth.status, ESTADOS_SOLICITACAO.AUTHORIZED);
    assert.ok(auth.request_id.startsWith('SEFAZ-'));
  });

  it('2. Bloquear consulta durante cooldown', async () => {
    const gate = criarGate();
    gate._cooldown.registrar({
      cnpj: '12345678000199',
      ambiente: 1,
      cStat: '656',
      tipo: TIPOS_CONSULTA.DIST_NSU,
      request_id: 'SEFAZ-TEST'
    });
    const auth = await gate.autorizar({
      cnpj: '12345678000199',
      ambiente: 1,
      tipo: TIPOS_CONSULTA.DIST_NSU
    });
    assert.equal(auth.permitido, false);
    assert.equal(auth.erro, ERROS.ERRO_COOLDOWN);
    assert.equal(auth.status, ESTADOS_SOLICITACAO.WAITING);
  });

  it('3. Bloquear consulta durante circuit breaker OPEN', async () => {
    const gate = criarGate({ openMs: 60_000 });
    gate._circuit.forcarOpen('12345678000199', 1, 'TEST');
    const auth = await gate.autorizar({
      cnpj: '12345678000199',
      ambiente: 1,
      tipo: TIPOS_CONSULTA.CONS_CH_NFE
    });
    assert.equal(auth.permitido, false);
    assert.equal(auth.erro, ERROS.ERRO_CIRCUIT_BREAKER);
  });

  it('4. Permitir HALF_OPEN após openMs', async () => {
    const gate = criarGate({ openMs: 50 });
    gate._circuit.forcarOpen('12345678000199', 1, 'TEST');
    gate._advance(60);
    const auth = await gate.autorizar({
      cnpj: '12345678000199',
      ambiente: 1,
      tipo: TIPOS_CONSULTA.DIST_NSU
    });
    assert.equal(auth.permitido, true);
    assert.equal(auth.circuit_state, CIRCUIT_STATE.HALF_OPEN);
  });

  it('5. Impedir duas consultas simultâneas do mesmo CNPJ', async () => {
    const gate = criarGate();
    let liberar1;
    const p1 = gate.request({
      cnpj: '111',
      ambiente: 1,
      tipo: TIPOS_CONSULTA.DIST_NSU,
      origem: ORIGENS.CENTRAL_SYNC,
      execute: () => new Promise((resolve) => {
        liberar1 = () => resolve({ success: true, body: '<cStat>138</cStat>' });
      })
    });
    await new Promise((r) => setTimeout(r, 20));
    const snap = gate._queue.snapshot('111', 1);
    assert.ok(snap.em_execucao);

    let started2 = false;
    const p2 = gate.request({
      cnpj: '111',
      ambiente: 1,
      tipo: TIPOS_CONSULTA.CONS_CH_NFE,
      origem: ORIGENS.CONSULTA_MANUAL,
      execute: async () => {
        started2 = true;
        return { success: true, body: '<cStat>138</cStat>' };
      }
    });
    await new Promise((r) => setTimeout(r, 30));
    assert.equal(started2, false);
    assert.equal(gate._queue.snapshot('111', 1).tamanho_fila, 1);

    liberar1();
    await p1;
    await p2;
    assert.equal(started2, true);
  });

  it('6. Permitir consultas simultâneas de CNPJs diferentes', async () => {
    const gate = criarGate();
    const order = [];
    const pA = gate.request({
      cnpj: '11111111000111',
      ambiente: 1,
      tipo: TIPOS_CONSULTA.DIST_NSU,
      execute: async () => {
        order.push('A-start');
        await new Promise((r) => setTimeout(r, 40));
        order.push('A-end');
        return { success: true, body: '<cStat>138</cStat>' };
      }
    });
    const pB = gate.request({
      cnpj: '22222222000122',
      ambiente: 1,
      tipo: TIPOS_CONSULTA.DIST_NSU,
      execute: async () => {
        order.push('B-start');
        await new Promise((r) => setTimeout(r, 40));
        order.push('B-end');
        return { success: true, body: '<cStat>138</cStat>' };
      }
    });
    await Promise.all([pA, pB]);
    assert.ok(order.indexOf('B-start') < order.indexOf('A-end'));
  });

  it('7. Isolar produção de homologação', async () => {
    const gate = criarGate({ openMs: 60_000 });
    gate._circuit.forcarOpen('123', 1, 'PROD');
    const prod = await gate.autorizar({ cnpj: '123', ambiente: 1, tipo: TIPOS_CONSULTA.DIST_NSU });
    const hom = await gate.autorizar({ cnpj: '123', ambiente: 2, tipo: TIPOS_CONSULTA.DIST_NSU });
    assert.equal(prod.permitido, false);
    assert.equal(hom.permitido, true);
  });

  it('8. Impedir regressão de NSU', async () => {
    const gate = criarGate({ nsuService: nsuMock('000000000000100') });
    const auth = await gate.autorizar({
      cnpj: '123',
      ambiente: 1,
      tipo: TIPOS_CONSULTA.DIST_NSU,
      nsu_solicitado: '000000000000099'
    });
    assert.equal(auth.permitido, false);
    assert.equal(auth.erro, ERROS.ERRO_NSU_REGRESSAO);
  });

  it('9. Preservar cursor (NSU igual autorizado)', async () => {
    const gate = criarGate({ nsuService: nsuMock('000000000000100') });
    const auth = await gate.autorizar({
      cnpj: '123',
      ambiente: 1,
      tipo: TIPOS_CONSULTA.DIST_NSU,
      nsu_solicitado: '000000000000100'
    });
    assert.equal(auth.permitido, true);
  });

  it('10. Gerar request_id', () => {
    const a = criarRequestId(new Date('2026-09-22T12:00:00'));
    const b = criarRequestId(new Date('2026-09-22T12:00:00'));
    assert.match(a, /^SEFAZ-20260922-\d{6}$/);
    assert.notEqual(a, b);
  });

  it('11. Registrar auditoria', async () => {
    const gate = criarGate();
    await gate.request({
      cnpj: '123',
      ambiente: 1,
      tipo: TIPOS_CONSULTA.DIST_NSU,
      origem: ORIGENS.CENTRAL_SYNC,
      execute: async () => ({ success: true, body: '<cStat>138</cStat><xMotivo>OK</xMotivo>' })
    });
    const recentes = gate._audit.listarRecentes(5);
    assert.ok(recentes.length >= 1);
    assert.ok(recentes.some((r) => r.status === ESTADOS_SOLICITACAO.SUCCESS));
  });

  it('12. Registrar cStat 137', async () => {
    const gate = criarGate();
    await gate.request({
      cnpj: '123',
      ambiente: 1,
      tipo: TIPOS_CONSULTA.DIST_NSU,
      execute: async () => ({ success: true, body: '<cStat>137</cStat><xMotivo>Nenhum documento</xMotivo>' })
    });
    assert.ok(gate._cooldown.estaAtivo('123', 1));
    assert.equal(gate._cooldown.obter('123', 1).cStat, '137');
  });

  it('13. Registrar cStat 656', async () => {
    const gate = criarGate({ openMs: 60_000 });
    await gate.request({
      cnpj: '123',
      ambiente: 1,
      tipo: TIPOS_CONSULTA.DIST_NSU,
      execute: async () => ({ success: true, body: '<cStat>656</cStat><xMotivo>Consumo Indevido</xMotivo>' })
    });
    assert.ok(gate._cooldown.estaAtivo('123', 1));
    assert.equal(gate._circuit.obterEstado('123', 1).state, CIRCUIT_STATE.OPEN);
  });

  it('14. Colocar consulta em WAITING (cooldown)', async () => {
    const gate = criarGate();
    gate._cooldown.registrar({
      cnpj: '123', ambiente: 1, cStat: '137', tipo: TIPOS_CONSULTA.DIST_NSU, request_id: 'x'
    });
    await assert.rejects(
      () => gate.request({
        cnpj: '123',
        ambiente: 1,
        tipo: TIPOS_CONSULTA.DIST_NSU,
        execute: async () => ({ success: true, body: '<cStat>138</cStat>' })
      }),
      (err) => err.codigo === ERROS.ERRO_COOLDOWN
    );
  });

  it('15. Retomar consulta após cooldown', async () => {
    const gate = criarGate({ cooldown137Ms: 50 });
    gate._cooldown.registrar({
      cnpj: '123', ambiente: 1, cStat: '137', tipo: TIPOS_CONSULTA.DIST_NSU, request_id: 'x'
    });
    gate._advance(60);
    const auth = await gate.autorizar({
      cnpj: '123', ambiente: 1, tipo: TIPOS_CONSULTA.DIST_NSU
    });
    assert.equal(auth.permitido, true);
  });
});

describe('SEFAZ Query Gate — integração', () => {
  it('fila: distNSU ativa e consChNFe aguarda no mesmo CNPJ', async () => {
    const gate = criarGate();
    let release;
    const d1 = gate.request({
      cnpj: '999',
      ambiente: 1,
      tipo: TIPOS_CONSULTA.DIST_NSU,
      origem: ORIGENS.CENTRAL_SYNC,
      execute: () => new Promise((res) => {
        release = () => res({ success: true, body: '<cStat>138</cStat>' });
      })
    });
    await new Promise((r) => setTimeout(r, 15));
    let chNfeRan = false;
    const d2 = gate.request({
      cnpj: '999',
      ambiente: 1,
      tipo: TIPOS_CONSULTA.CONS_CH_NFE,
      origem: ORIGENS.RECUPERACAO_XML,
      execute: async () => {
        chNfeRan = true;
        return { success: true, body: '<cStat>138</cStat>' };
      }
    });
    const d3 = gate.request({
      cnpj: '999',
      ambiente: 1,
      tipo: TIPOS_CONSULTA.DIST_NSU,
      origem: ORIGENS.CENTRAL_SYNC,
      execute: async () => ({ success: true, body: '<cStat>138</cStat>' })
    });
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(chNfeRan, false);
    assert.equal(gate._queue.snapshot('999', 1).tamanho_fila, 2);
    release();
    await Promise.all([d1, d2, d3]);
    assert.equal(chNfeRan, true);
  });

  it('isolamento: CNPJ A 656 / CNPJ B normal', async () => {
    const gate = criarGate({ openMs: 60_000 });
    await gate.request({
      cnpj: '11111111000111',
      ambiente: 1,
      tipo: TIPOS_CONSULTA.DIST_NSU,
      execute: async () => ({ success: true, body: '<cStat>656</cStat>' })
    });
    const a = await gate.autorizar({ cnpj: '11111111000111', ambiente: 1, tipo: TIPOS_CONSULTA.DIST_NSU });
    const b = await gate.autorizar({ cnpj: '22222222000122', ambiente: 1, tipo: TIPOS_CONSULTA.DIST_NSU });
    assert.equal(a.permitido, false);
    assert.equal(b.permitido, true);
  });

  it('NSU 99 bloqueado / 100 autorizado', async () => {
    const gate = criarGate({ nsuService: nsuMock('100') });
    const block = await gate.autorizar({
      cnpj: '1', ambiente: 1, tipo: TIPOS_CONSULTA.DIST_NSU, nsu_solicitado: '99'
    });
    const ok = await gate.autorizar({
      cnpj: '1', ambiente: 1, tipo: TIPOS_CONSULTA.DIST_NSU, nsu_solicitado: '100'
    });
    assert.equal(block.permitido, false);
    assert.equal(ok.permitido, true);
  });

  it('rate limit: request espera pacing e conclui (relógio real)', async () => {
    const gate = new SEFAZQueryGate({
      rateLimiter: new SEFAZRateLimiter({ minIntervalMs: 50 }),
      cooldown: new SEFAZCooldown({ cooldown137Ms: 60_000, cooldown656Ms: 60_000 }),
      circuitBreaker: new SEFAZCircuitBreaker({ openMs: 60_000 }),
      queue: new SEFAZQueryQueue(),
      waitCooldown: false
    });
    await gate.request({
      cnpj: '55555555000155',
      ambiente: 1,
      tipo: TIPOS_CONSULTA.DIST_NSU,
      execute: async () => ({ success: true, body: '<cStat>138</cStat>' })
    });
    const t0 = Date.now();
    const r2 = await gate.request({
      cnpj: '55555555000155',
      ambiente: 1,
      tipo: TIPOS_CONSULTA.DIST_NSU,
      execute: async () => ({ success: true, body: '<cStat>138</cStat>' })
    });
    assert.equal(r2.permitido, true);
    assert.ok(Date.now() - t0 >= 40);
  });
});

describe('SEFAZ Query Gate — contratos de migração', () => {
  it('distribuicaoDFe e diagnóstico passam pelo Gate', () => {
    const dfe = fs.readFileSync(path.join(ROOT, 'backend/services/fiscal/distribuicaoDFe.js'), 'utf8');
    assert.match(dfe, /sefazQueryGate\.request/);
    assert.match(dfe, /TIPOS_CONSULTA\.DIST_NSU/);
    assert.match(dfe, /TIPOS_CONSULTA\.CONS_CH_NFE/);
    assert.match(dfe, /executarEnvioConsultaDfe/);

    const diag = fs.readFileSync(
      path.join(ROOT, 'backend/motores/central-entradas/services/CentralDiagnosticoService.js'),
      'utf8'
    );
    assert.match(diag, /executarEnvioConsultaDfe/);
    assert.doesNotMatch(diag, /enviarDistribuicaoDfe\s*\(/);

    assert.ok(fs.existsSync(path.join(ROOT, 'backend/services/fiscal/sefaz/SEFAZQueryGate.js')));
    assert.ok(fs.existsSync(path.join(ROOT, 'backend/services/fiscal/sefaz/SEFAZQueryQueue.js')));
    assert.ok(fs.existsSync(path.join(ROOT, 'backend/services/fiscal/sefaz/SEFAZRateLimiter.js')));
    assert.ok(fs.existsSync(path.join(ROOT, 'backend/services/fiscal/sefaz/SEFAZCircuitBreaker.js')));
  });
});
