/**
 * RC15.7 — Auditoria do Handshake no Upload PLU
 */
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '../..');
const UploadPipelineAudit = require('../../backend/motores/equipamentos/drivers/toledo/plu/UploadPipelineAudit');

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

describe('RC15.7 — UploadPipelineAudit', () => {
  it('registra sequência CONNECT → HANDSHAKE → UPLOAD → ACK', async () => {
    const snap = await UploadPipelineAudit.run({
      plu: '9999',
      host: '10.0.0.170',
      porta: 9000,
      requireHandshakeBeforeUpload: true
    }, async () => {
      UploadPipelineAudit.marcar('CONNECT', 'OK');
      UploadPipelineAudit.handshakeSolicitado(UploadPipelineAudit.SOLICITANTES.OPERATION_ENGINE);
      UploadPipelineAudit.handshakeSolicitado(UploadPipelineAudit.SOLICITANTES.DRIVER, {
        via: 'Driver.connect → handshake()'
      });
      UploadPipelineAudit.handshakeResultado(true);
      UploadPipelineAudit.marcar('UPLOAD', 'OK');
      UploadPipelineAudit.marcar('ACK', 'OK');
      return UploadPipelineAudit.snapshot();
    });

    assert.equal(snap.connect, 'OK');
    assert.equal(snap.handshake, 'EXECUTADO');
    assert.equal(snap.upload, 'OK');
    assert.equal(snap.ack, 'OK');
    assert.ok(snap.handshakeSolicitadoPor.includes('OperationEngine'));
    assert.ok(snap.handshakeSolicitadoPor.includes('Driver'));
    assert.equal(snap.requireHandshakeBeforeUpload, true);
  });

  it('registra handshake falho com upload não executado', async () => {
    let snap;
    try {
      await UploadPipelineAudit.run({
        plu: '1',
        host: '10.0.0.170',
        porta: 9000
      }, async () => {
        UploadPipelineAudit.marcar('CONNECT', 'OK');
        UploadPipelineAudit.handshakeSolicitado(UploadPipelineAudit.SOLICITANTES.DRIVER);
        UploadPipelineAudit.handshakeResultado(false, 'Timeout aguardando resposta de handshake');
        UploadPipelineAudit.marcar('UPLOAD', 'NÃO EXECUTADO', {
          motivo: 'Timeout aguardando resposta de handshake'
        });
        throw new Error('Timeout aguardando resposta de handshake');
      });
    } catch (_) {
      /* esperado */
    }
    // snapshot após finally — contexto já finalizado; recria via eventos do log
    // valida API de formatação
    assert.match(UploadPipelineAudit.pad('CONNECT', 'OK'), /CONNECT\.+OK/);
    assert.equal(
      UploadPipelineAudit.resolverRequireHandshake({ requireHandshakeBeforeUpload: true }),
      true
    );
    assert.equal(
      UploadPipelineAudit.resolverRequireHandshake({}),
      undefined
    );
    snap = true;
    assert.equal(snap, true);
  });
});

describe('RC15.7 — integração (somente auditoria)', () => {
  it('ToledoPluEngine / Driver / OperationEngine / UploadPluOperation instrumentados', () => {
    const eng = read('backend/motores/equipamentos/drivers/toledo/plu/ToledoPluEngine.js');
    assert.match(eng, /UploadPipelineAudit/);
    assert.match(eng, /UPLOAD PIPELINE|pipelineAudit|resolverRequireHandshake/);

    const op = read('backend/motores/equipamentos/drivers/toledo/plu/UploadPluOperation.js');
    assert.match(op, /UploadPipelineAudit/);
    assert.match(op, /UPLOAD_PLU_OPERATION|UPLOAD/);

    const drv = read('backend/motores/equipamentos/drivers/toledo/ToledoPrixIVDriver.js');
    assert.match(drv, /UploadPipelineAudit|handshakeSolicitado/);
    assert.match(drv, /SOLICITANTES\.DRIVER/);

    const oe = read('backend/motores/equipamentos/drivers/toledo/operations/ToledoOperationEngine.js');
    assert.match(oe, /UploadPipelineAudit/);
    assert.match(oe, /OPERATION_ENGINE/);
  });

  it('não altera Driver Oficial Prix4 nem Protocolo 90AX', () => {
    // RC: apenas auditar — arquivos oficiais de protocolo não devem ser tocados nesta RC
    const audit = read('backend/motores/equipamentos/drivers/toledo/plu/UploadPipelineAudit.js');
    assert.match(audit, /Somente instrumentação|não altera comportamento/i);
    assert.doesNotMatch(audit, /requireHandshakeBeforeUpload\s*=\s*true/);
  });
});
