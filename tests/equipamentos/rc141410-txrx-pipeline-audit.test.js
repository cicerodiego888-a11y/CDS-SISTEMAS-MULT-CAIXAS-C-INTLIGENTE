/**
 * RC14.14.10 — Auditoria do Pipeline TX/RX
 */
'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const net = require('net');

const ROOT = path.join(__dirname, '../..');
const TcpConnection = require('../../backend/motores/equipamentos/connection/TcpConnection');
const { hexOf, asciiOf, formatTx, formatRx } = require('../../backend/motores/equipamentos/connection/TxRxPipelineAudit');
const { ToledoPrix4Protocol } = (() => {
  const mod = require('../../backend/motores/equipamentos/drivers/toledo/prix4/ToledoPrix4Protocol');
  return { ToledoPrix4Protocol: mod };
})();

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

describe('RC14.14.10 — helpers HEX/ASCII', () => {
  it('formata TX/RX', () => {
    const buf = Buffer.from([0x02, 0x50, 0x4e, 0x03]);
    assert.equal(hexOf(buf), '02 50 4E 03');
    assert.ok(asciiOf(buf).includes('PN') || asciiOf(buf).length === 4);
    const tx = formatTx(buf, { host: '10.0.0.170', porta: 9000 });
    assert.equal(tx.bytes, 4);
    assert.equal(tx.host, '10.0.0.170');
    assert.equal(tx.porta, 9000);
    const rx = formatRx(buf, { host: '10.0.0.170', porta: 9000, tempoDesdeTxMs: 12 });
    assert.equal(rx.tempoDesdeTxMs, 12);
  });
});

describe('RC14.14.10 — TcpConnection write/read audit', () => {
  let server;
  let porta;

  before(async () => {
    server = net.createServer((s) => {
      s.on('data', (d) => {
        // ecoa
        s.write(d);
      });
    });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    porta = server.address().port;
  });

  after(async () => {
    await new Promise((r) => server.close(r));
  });

  it('write marca lastTx e read recebe eco', async () => {
    const tcp = new TcpConnection({ host: '127.0.0.1', porta, timeoutMs: 2000 });
    await tcp.open();
    const payload = Buffer.from('PN');
    const n = tcp.write(payload);
    assert.equal(n, 2);
    assert.equal(tcp._lastTxBytes, 2);
    assert.ok(tcp._lastTxHex);
    const rx = await tcp.read({ timeoutMs: 1000 });
    assert.ok(Buffer.isBuffer(rx));
    assert.equal(rx.toString(), 'PN');
    await tcp.close();
  });

  it('read timeout retorna null sem crash', async () => {
    const silent = net.createServer((s) => { s.on('data', () => {}); });
    await new Promise((r) => silent.listen(0, '127.0.0.1', r));
    const p = silent.address().port;
    const tcp = new TcpConnection({ host: '127.0.0.1', porta: p, timeoutMs: 2000 });
    await tcp.open();
    tcp.write(Buffer.from('XX'));
    const rx = await tcp.read({ timeoutMs: 80 });
    assert.equal(rx, null);
    await tcp.close();
    await new Promise((r) => silent.close(r));
  });
});

describe('RC14.14.10 — Prix4Protocol null.dados', () => {
  it('_extrairBufferRx tolera null/Buffer/objeto', () => {
    const proto = new ToledoPrix4Protocol({ host: '10.0.0.1', porta: 9000 });
    assert.equal(proto._extrairBufferRx(null), null);
    assert.equal(proto._extrairBufferRx(undefined), null);
    assert.ok(Buffer.isBuffer(proto._extrairBufferRx(Buffer.from('AB'))));
    assert.ok(Buffer.isBuffer(proto._extrairBufferRx({ dados: Buffer.from('AB') })));
    assert.equal(proto._extrairBufferRx({ dados: null }), null);
  });
});

describe('RC14.14.10 — código', () => {
  it('TcpConnection tem TX BEFORE/AFTER e Timeout aguardando RX', () => {
    const src = read('backend/motores/equipamentos/connection/TcpConnection.js');
    assert.match(src, /TX BEFORE WRITE/);
    assert.match(src, /TX AFTER WRITE/);
    assert.match(src, /Timeout aguardando RX/);
    assert.match(src, /RX DATA/);
    assert.match(src, /SOCKET/);
  });

  it('front trata resposta nula / sem RX', () => {
    const src = read('frontend/erp/js/central-equipamentos.js');
    assert.match(src, /Nenhuma resposta recebida da balança/);
    assert.match(src, /RC14\.14\.10/);
    assert.match(src, /nunca acessar propriedades de resposta nula|body && typeof body/);
  });

  it('Prix4Protocol nunca acessa .dados em null', () => {
    const src = read('backend/motores/equipamentos/drivers/toledo/prix4/ToledoPrix4Protocol.js');
    assert.match(src, /_extrairBufferRx/);
    assert.doesNotMatch(src, /const dados = rawRes\.dados/);
  });
});
