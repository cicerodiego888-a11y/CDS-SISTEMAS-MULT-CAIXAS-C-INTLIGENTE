/**
 * Testes — QR Code NFC-e (URL configurável + auditoria homologação)
 *
 * Executar: npm run test:fiscal-qrcode
 *           node tests/fiscal/fiscal-qrcode.test.js
 */

const assert = require('assert');
const crypto = require('crypto');
const {
  gerarQRCodeNFCe,
  normalizarUrlBaseQr
} = require('../../backend/services/fiscal/qrcode');

let passou = 0;
let falhou = 0;

function test(nome, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      passou += 1;
      console.log(`  OK  ${nome}`);
    })
    .catch((error) => {
      falhou += 1;
      console.error(`  FALHOU  ${nome}`);
      console.error(`         ${error && error.message ? error.message : error}`);
    });
}

function hashEsperado(chave, tpAmb, idToken, csc) {
  const dados = `${chave}|2|${tpAmb}|${idToken}`;
  return crypto
    .createHash('sha1')
    .update(dados + csc)
    .digest('hex')
    .toUpperCase();
}

async function main() {
  console.log('\n=== Testes QR Code NFC-e — URL configurável ===\n');

  const chave = '23260565957340000150650010000000281582006635';
  const csc = 'TOKEN-CSC-TESTE-16CH';
  const urlHomolog = 'https://nfceh.sefaz.ce.gov.br/pages/ShowNFCe.html';
  const urlProd = 'https://nfce.sefaz.ce.gov.br/pages/ShowNFCe.html';

  await test('normalizarUrlBaseQr exige URL configurada', async () => {
    assert.throws(() => normalizarUrlBaseQr(''), /não configurada/i);
    assert.throws(() => normalizarUrlBaseQr(null), /não configurada/i);
    assert.throws(() => normalizarUrlBaseQr(undefined), /não configurada/i);
  });

  await test('normalizarUrlBaseQr aceita bases com e sem ?p=', async () => {
    assert.strictEqual(
      normalizarUrlBaseQr(urlHomolog),
      `${urlHomolog}?p=`
    );
    assert.strictEqual(
      normalizarUrlBaseQr(`${urlHomolog}?`),
      `${urlHomolog}?p=`
    );
    assert.strictEqual(
      normalizarUrlBaseQr(`${urlHomolog}?p=`),
      `${urlHomolog}?p=`
    );
    assert.strictEqual(
      normalizarUrlBaseQr(`${urlHomolog}/`),
      `${urlHomolog}?p=`
    );
  });

  await test('gerarQRCodeNFCe falha sem consultaUrl (sem fallback)', async () => {
    assert.throws(
      () => gerarQRCodeNFCe({
        chave,
        ambiente: 2,
        idCSC: '000001',
        CSC: csc
      }),
      /não configurada/i
    );
  });

  await test('gerarQRCodeNFCe usa URL da configuração (homologação)', async () => {
    const qr = gerarQRCodeNFCe({
      chave,
      ambiente: 2,
      idCSC: '000001',
      CSC: csc,
      consultaUrl: urlHomolog,
      uf: 'CE'
    });

    const hash = hashEsperado(chave, '2', '1', csc);
    assert.ok(qr.startsWith(`${urlHomolog}?p=`), `URL base inesperada: ${qr}`);
    assert.ok(!qr.includes('consultaNota.jsf'), 'não deve usar consultaNota.jsf');
    assert.strictEqual(
      qr,
      `${urlHomolog}?p=${chave}|2|2|1|${hash}`
    );
  });

  await test('gerarQRCodeNFCe usa URL da configuração (produção)', async () => {
    const qr = gerarQRCodeNFCe({
      chave,
      ambiente: 1,
      idCSC: '1',
      CSC: csc,
      consultaUrl: urlProd,
      uf: 'CE'
    });

    const hash = hashEsperado(chave, '1', '1', csc);
    assert.strictEqual(
      qr,
      `${urlProd}?p=${chave}|2|1|1|${hash}`
    );
  });

  await test('SHA1 permanece idêntico (sem pipe antes do CSC)', async () => {
    const idToken = '1';
    const tpAmb = '2';
    const dados = `${chave}|2|${tpAmb}|${idToken}`;
    const hashManual = crypto
      .createHash('sha1')
      .update(dados + csc)
      .digest('hex')
      .toUpperCase();

    const qr = gerarQRCodeNFCe({
      chave,
      ambiente: 2,
      idCSC: idToken,
      CSC: `  ${csc}  `,
      consultaUrl: urlHomolog
    });

    assert.ok(qr.endsWith(`|${hashManual}`));
  });

  await test('auditoria de homologação não expõe o CSC', async () => {
    const logs = [];
    const originalLog = console.log;
    console.log = (...args) => {
      logs.push(args.map(String).join(' '));
    };

    try {
      gerarQRCodeNFCe({
        chave,
        ambiente: 2,
        idCSC: '1',
        CSC: csc,
        consultaUrl: urlHomolog,
        uf: 'CE'
      });
    } finally {
      console.log = originalLog;
    }

    const audit = logs.join('\n');
    assert.ok(audit.includes('[FISCAL QRCODE AUDIT]'), 'deve auditar em homologação');
    assert.ok(audit.includes('String SHA1:'), 'deve exibir string do hash');
    assert.ok(audit.includes('***'), 'deve mascarar o CSC');
    assert.ok(!audit.includes(csc), 'CSC completo não pode aparecer no log');
  });

  await test('produção não emite auditoria de QRCode', async () => {
    const logs = [];
    const originalLog = console.log;
    console.log = (...args) => {
      logs.push(args.map(String).join(' '));
    };

    try {
      gerarQRCodeNFCe({
        chave,
        ambiente: 1,
        idCSC: '1',
        CSC: csc,
        consultaUrl: urlProd,
        uf: 'CE'
      });
    } finally {
      console.log = originalLog;
    }

    assert.ok(
      !logs.some((l) => l.includes('[FISCAL QRCODE AUDIT]')),
      'produção não deve auditar QRCode'
    );
  });

  await test('fonte qrcode.js não contém URL hardcoded de SEFAZ', async () => {
    const fs = require('fs');
    const path = require('path');
    const src = fs.readFileSync(
      path.join(__dirname, '../../backend/services/fiscal/qrcode.js'),
      'utf8'
    );
    assert.ok(!/sefaz\.ce\.gov\.br/i.test(src), 'não deve hardcodar host SEFAZ-CE');
    assert.ok(!/consultaNota\.jsf/i.test(src), 'não deve hardcodar consultaNota.jsf');
    assert.ok(!/ShowNFCe\.html/i.test(src), 'não deve hardcodar ShowNFCe.html');
  });

  console.log(`\nResultado: ${passou} ok, ${falhou} falha(s)\n`);
  process.exit(falhou > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
