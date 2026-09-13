/**
 * Sprint 14.7 — Testes Motor de PLUs Toledo V1.0
 */
'use strict';

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

const mapper = require('../../backend/motores/equipamentos/drivers/toledo/plu/ToledoPluMapper');
const validator = require('../../backend/motores/equipamentos/drivers/toledo/plu/ToledoPluValidator');
const builder = require('../../backend/motores/equipamentos/drivers/toledo/plu/ToledoPluBuilder');
const parser = require('../../backend/motores/equipamentos/drivers/toledo/plu/ToledoPluParser');
const ToledoPluRepository = require('../../backend/motores/equipamentos/drivers/toledo/plu/ToledoPluRepository');
const { ToledoPluEngine } = require('../../backend/motores/equipamentos/drivers/toledo/plu/ToledoPluEngine');
const { CODES } = require('../../backend/motores/equipamentos/drivers/toledo/plu/ToledoPluErrors');
const frameBuilder = require('../../backend/motores/equipamentos/drivers/toledo/ToledoFrameBuilder');
const { COMMANDS } = require('../../backend/motores/equipamentos/drivers/toledo/ToledoProtocol');

function mockDriverAck() {
  return {
    host: '10.0.0.170',
    porta: 9000,
    _online: true,
    isOnline() { return true; },
    async connect() { return { status: 'CONNECTED', handshake: true, latencia: 1 }; },
    async sendFrame(buf) { this._lastTx = buf; return buf.length; },
    async receiveFrame() { return frameBuilder.buildAck({ ok: true, plu: '1001' }); },
    async handshake() { return { ok: true, latencia: 1, frame: { raw: frameBuilder.buildAck() } }; },
    async ping() { return { ok: true, frame: { raw: frameBuilder.buildAck(), isAck: true } }; }
  };
}

function mockDriverNack() {
  const d = mockDriverAck();
  d.receiveFrame = async () => frameBuilder.build(require('../../backend/motores/equipamentos/drivers/toledo/ToledoProtocol').RESPONSES.NAK, { erro: 'plu' });
  return d;
}

describe('PLU V1 — Mapper', () => {
  it('mapeia produto CDS', () => {
    const plu = mapper.map({
      id: 7,
      codigo: '1001',
      nome: 'Picanha Premium Extra Longa',
      preco_venda: 89.9,
      tara: 0.01,
      departamento_id: 3,
      unidade: 'kg',
      ean: '789123'
    });
    assert.equal(plu.produto_id, 7);
    assert.equal(plu.plu, '1001');
    assert.ok(plu.descricao.length <= 22);
    assert.equal(plu.preco, 89.9);
    assert.equal(plu.departamento, 3);
    assert.equal(plu.codigoBarras, '789123');
  });
});

describe('PLU V1 — Validator', () => {
  it('aceita PLU válido e rejeita inválido', () => {
    assert.equal(validator.validate({
      plu: '1001', descricao: 'Picanha', preco: 10, departamento: 1, unidade: 'kg'
    }).ok, true);
    assert.equal(validator.validate({ plu: '', descricao: 'X', preco: 1, departamento: 1, unidade: 'kg' }).ok, false);
    assert.equal(validator.validate({ plu: '1', descricao: '', preco: 1, departamento: 1, unidade: 'kg' }).ok, false);
    assert.equal(validator.validate({ plu: '1', descricao: 'X', preco: NaN, departamento: 1, unidade: 'kg' }).ok, false);
    assert.throws(() => validator.assertValid({ plu: '', descricao: 'A', preco: 1, departamento: 1, unidade: 'kg' }));
  });

  it('RC15.5 — ValidationReport com campo/valor/motivo', () => {
    const report = validator.buildReport({
      plu: '9999',
      descricao: 'CDS TESTE',
      preco: 0,
      departamento: null,
      unidade: 'kg'
    });
    assert.equal(report.success, false);
    assert.ok(Array.isArray(report.errors));
    assert.ok(report.errors.some((e) => e.campo === 'departamento'));
    assert.ok(report.errors.some((e) => e.campo === 'preco' && /maior que zero/i.test(e.motivo)));
    assert.ok(report.errors.every((e) => e.campo && e.motivo));
    try {
      validator.assertValid({ plu: '9999', descricao: 'X', preco: 0, departamento: null, unidade: 'kg' });
      assert.fail('deveria lançar');
    } catch (err) {
      assert.equal(err.code, CODES.VALIDATION_ERROR);
      assert.ok(err.validationReport);
      assert.notEqual(err.message, 'VALIDATION_ERROR');
      assert.match(err.message, /Departamento|Preço/i);
    }
  });
});

describe('PLU V1 — Builder', () => {
  it('monta frame EP com framing V1 do lab', () => {
    const frame = builder.build({
      plu: '1001',
      descricao: 'Picanha',
      preco: 10.5,
      tara: 0,
      departamento: 1,
      codigoBarras: '789'
    });
    assert.ok(Buffer.isBuffer(frame));
    assert.equal(frame[0], 0x02);
    assert.equal(frame.toString('ascii', 1, 3), COMMANDS.UPLOAD_PLU);
    assert.equal(builder.getProtocolProfile().source, 'lab-v1-framing');
  });
});

describe('PLU V1 — Parser ACK/NACK', () => {
  it('parse ACK e NACK', () => {
    const ack = parser.parse(frameBuilder.buildAck({ ok: true }));
    assert.equal(ack.ack, true);
    assert.equal(ack.ok, true);
    const nak = parser.parse(frameBuilder.build(
      require('../../backend/motores/equipamentos/drivers/toledo/ToledoProtocol').RESPONSES.NAK,
      { erro: 'x' }
    ));
    assert.equal(nak.nack, true);
    assert.throws(() => parser.assertAck(nak.raw));
  });
});

describe('PLU V1 — Repository', () => {
  it('registra sync e confirma', async () => {
    const repo = new ToledoPluRepository();
    const id = await repo.registrarInicio({
      produto_id: 1,
      plu: '2002',
      host: '10.0.0.170',
      porta: 9000
    });
    assert.ok(id);
    await repo.confirmar(id);
    const row = await repo.buscarPorId(id);
    assert.equal(row.status, 'CONFIRMADO');
    await repo.incrementarTentativa(id);
  });
});

describe('PLU V1 — Engine upload / lote / retry / NACK', () => {
  let engine;

  beforeEach(() => {
    engine = new ToledoPluEngine({
      persistir: false,
      driverFactory: () => mockDriverAck(),
      repository: {
        async registrarInicio() { return 99; },
        async confirmar() {},
        async falhar() {},
        async incrementarTentativa() {},
        async buscarPorId() {
          return { id: 99, plu: '1001', host: '10.0.0.170', porta: 9000, produto_id: 1 };
        },
        async historico() { return []; }
      }
    });
  });

  it('upload com ACK', async () => {
    const r = await engine.upload({
      plu: '1001',
      descricao: 'Picanha',
      preco: 12.5,
      departamento: 1,
      unidade: 'kg'
    }, { host: '10.0.0.170', porta: 9000, persistir: false });
    assert.equal(r.success, true);
    assert.equal(r.plu, '1001');
  });

  it('uploadMany com progresso', async () => {
    const progressos = [];
    const r = await engine.uploadMany([
      { plu: '1', descricao: 'A', preco: 1, departamento: 1, unidade: 'kg' },
      { plu: '2', descricao: 'B', preco: 2, departamento: 1, unidade: 'kg' }
    ], {
      host: '10.0.0.170',
      porta: 9000,
      persistir: false,
      onProgress: (p) => progressos.push({ ...p })
    });
    assert.equal(r.ok, 2);
    assert.equal(r.erro, 0);
    assert.ok(progressos.length >= 2);
  });

  it('NACK falha upload', async () => {
    const eng = new ToledoPluEngine({
      persistir: false,
      driverFactory: () => mockDriverNack(),
      repository: {
        async registrarInicio() { return 1; },
        async confirmar() {},
        async falhar() {}
      }
    });
    await assert.rejects(
      () => eng.upload({ plu: '1', descricao: 'A', preco: 1, departamento: 1, unidade: 'kg' }, {
        host: '10.0.0.170', porta: 9000, persistir: false
      }),
      (err) => err.code === CODES.NACK || err.code === CODES.UPLOAD_ERROR
    );
  });

  it('retry exige produto', async () => {
    await assert.rejects(
      () => engine.retry(99, { host: '10.0.0.170', porta: 9000 }),
      /produto completo/i
    );
    const r = await engine.retry(99, {
      host: '10.0.0.170',
      porta: 9000,
      produto: { plu: '1001', descricao: 'Picanha', preco: 10, departamento: 1, unidade: 'kg' }
    });
    assert.equal(r.success, true);
  });
});
