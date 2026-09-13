/**
 * RC14.12.3 — Exports do Discovery sem wrappers recursivos
 */
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '../..');
const DISCOVERY_DIR = path.join(ROOT, 'backend/motores/equipamentos/discovery');

const FILES = [
  'DiscoveryManager.js',
  'EthernetDiscovery.js',
  'DiscoveryEngineV1.js',
  'DiscoveryService.js'
];

const WRAPPER_RE = /module\.exports\.(\w+)\s*=\s*\(\.\.\.args\)\s*=>\s*\w+\.\1\(/;

describe('RC14.12.3 — antipadrão de export recursivo', () => {
  for (const file of FILES) {
    it(`${file}: sem wrapper module.exports.metodo => instancia.metodo`, () => {
      const src = fs.readFileSync(path.join(DISCOVERY_DIR, file), 'utf8');
      assert.equal(WRAPPER_RE.test(src), false, `wrapper recursivo em ${file}`);
    });
  }

  it('DiscoveryManager.descobrir não entra em recursão', async () => {
    const modPath = require.resolve('../../backend/motores/equipamentos/discovery/DiscoveryManager');
    delete require.cache[modPath];
    const dm = require('../../backend/motores/equipamentos/discovery/DiscoveryManager');

    assert.equal(typeof dm.descobrir, 'function');

    let erro = null;
    let resultado = null;
    try {
      resultado = await dm.descobrir({
        transportes: ['ethernet'],
        timeoutTcpMs: 50,
        concorrencia: 2,
        hosts: ['127.0.0.1'],
        portas: [1],
        lab: false,
        meta: true
      });
    } catch (e) {
      erro = e;
    }

    if (erro) {
      assert.doesNotMatch(String(erro.message || erro), /Maximum call stack size exceeded/);
      assert.notEqual(erro.name, 'RangeError');
    } else {
      assert.ok(resultado);
      assert.ok(resultado.candidatos || resultado.meta || resultado.sucesso !== undefined);
    }
  });

  it('métodos DiscoveryManager / Ethernet / EngineV1 vêm do prototype', () => {
    const dm = require('../../backend/motores/equipamentos/discovery/DiscoveryManager');
    const eth = require('../../backend/motores/equipamentos/discovery/EthernetDiscovery');
    const eng = require('../../backend/motores/equipamentos/discovery/DiscoveryEngineV1');

    assert.equal(Object.prototype.hasOwnProperty.call(dm, 'descobrir'), false);
    assert.equal(typeof dm.descobrir, 'function');
    assert.equal(Object.prototype.hasOwnProperty.call(eth, 'executar'), false);
    assert.equal(typeof eth.executar, 'function');
    assert.equal(Object.prototype.hasOwnProperty.call(eng, 'executar'), false);
    assert.equal(typeof eng.executar, 'function');
    assert.equal(typeof eng.listarEquipamentos, 'function');
  });
});
