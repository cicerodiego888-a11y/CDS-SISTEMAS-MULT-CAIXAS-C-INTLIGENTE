/**
 * RC3.15.5 — Robustez da emissão NF-e (certificado / PEM / loteXml).
 * NFC-e permanece intacta (somente leitura de isolamento).
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const {
  assertPrivateKeyPemNfe,
  assertCertPemNfe,
  MSG_CHAVE_PRIVADA,
  MSG_CERT_PEM
} = require('../../backend/services/fiscal/nfeEmissorVenda');

describe('RC3.15.5 — validação PEM (NF-e)', () => {
  it('rejeita privateKey undefined / objeto / vazio sem key.key do Node', () => {
    for (const bad of [undefined, null, {}, { privateKeyPem: 'x' }, '', '   ', 123]) {
      assert.throws(
        () => assertPrivateKeyPemNfe(bad),
        (err) => err.code === 'CERT_PRIVATE_KEY_INVALID' && err.message === MSG_CHAVE_PRIVADA
      );
    }
  });

  it('aceita PEM PKCS#8 e RSA', () => {
    const pkcs8 = '-----BEGIN PRIVATE KEY-----\nMIIB\n-----END PRIVATE KEY-----';
    const rsa = '-----BEGIN RSA PRIVATE KEY-----\nMIIB\n-----END RSA PRIVATE KEY-----';
    assert.equal(assertPrivateKeyPemNfe(pkcs8), pkcs8.trim());
    assert.equal(assertPrivateKeyPemNfe(`  ${rsa}  `), rsa);
  });

  it('rejeita certPem inválido', () => {
    assert.throws(() => assertCertPemNfe(undefined), (e) => e.code === 'CERT_PEM_INVALID');
    assert.throws(() => assertCertPemNfe('nao-e-cert'), (e) => e.message === MSG_CERT_PEM);
  });

  it('aceita certPem com BEGIN CERTIFICATE', () => {
    const pem = '-----BEGIN CERTIFICATE-----\nABC\n-----END CERTIFICATE-----';
    assert.equal(assertCertPemNfe(pem), pem);
  });
});

describe('RC3.15.5 — contrato NF-e no emissor', () => {
  it('usa loteXml (não xmlLote) e assina só com strings PEM', () => {
    const nfe = read('backend/services/fiscal/nfeEmissorVenda.js');
    assert.match(nfe, /loteXml:\s*lote/);
    assert.doesNotMatch(nfe, /xmlLote:\s*lote/);
    assert.match(nfe, /assinarNFe\(\s*built\.xmlSemAssinatura\s*,\s*privateKeyPem\s*,\s*certPem\s*\)/);
    assert.match(nfe, /carregarEValidarCertificadoNfe/);
    assert.match(nfe, /\[NFE\]/);
    assert.match(nfe, /PrivateKey OK/);
    assert.match(nfe, /Enviando lote/);
  });

  it('não altera emissor / signer / soap da NFC-e', () => {
    const nfce = read('backend/services/fiscal/emissor.js');
    const signer = read('backend/services/fiscal/signer.js');
    const soap = read('backend/services/fiscal/soapClient.js');
    assert.match(nfce, /assinarNFe\(/);
    assert.match(nfce, /certificado\.privateKeyPem/);
    assert.match(signer, /function assinarNFe/);
    assert.match(soap, /loteXml/);
    assert.doesNotMatch(nfce, /carregarEValidarCertificadoNfe/);
    assert.doesNotMatch(nfce, /\[NFE\]/);
    assert.doesNotMatch(signer, /carregarEValidarCertificadoNfe/);
  });
});
