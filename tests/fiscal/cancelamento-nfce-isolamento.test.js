'use strict';

const assert = require('assert');
const crypto = require('crypto');
const https = require('https');
const tls = require('tls');
const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const forge = require('node-forge');
const xml2js = require('xml2js');
const cancelarNfce = require('../../backend/services/fiscal/cancelarNfce');
const { createCancelamentoRuntime, classificarResultado } = require('../../backend/services/fiscal/cancelamentoRuntime');
const { SoapTransport } = require('../../backend/services/fiscal/core/SoapTransport');
const { enviarCancelamentoLegado } = require('../../backend/services/fiscal/cancelamentoLegado');
const {
  criarAgenteHttpsCancelamento,
  obterCAsCancelamento
} = require('../../backend/services/fiscal/cancelamentoTls');
const { appendXmlRetornoNfce } = require('../../backend/services/fiscal/xmlRetornoNfce');
const {
  cancelarDocumentoFiscalFechamento
} = require('../../backend/services/fechamento-fiscal/NfceCancelamentoFechamentoService');
const { extrairChaveEProtocoloAutorizados } = require('../../backend/services/fiscal/utils');
const { extrairXmlNfceAutorizado } = require('../../backend/services/fiscal/exportarContabilidadeService');
const { extrairCancelamentoSefaz } = require('../../backend/services/fechamento-fiscal/NfceCancelamentoFechamentoService');

const CNPJ = '12345678000199';
const CHAVE_1 = '23261012345678000199650010000000011000000010';
const CHAVE_2 = '23261012345678000199650010000000011000000020';
const PROTOCOLO_1 = '123456789012345';

function gerarCertificadoTlsSintetico() {
  const keys = forge.pki.rsa.generateKeyPair(2048);
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = '01';
  cert.validity.notBefore = new Date(Date.now() - 60_000);
  cert.validity.notAfter = new Date(Date.now() + 60 * 60_000);
  cert.setSubject([{ name: 'commonName', value: 'localhost' }]);
  cert.setIssuer([{ name: 'commonName', value: 'localhost' }]);
  cert.setExtensions([
    { name: 'basicConstraints', cA: true },
    { name: 'keyUsage', keyCertSign: true, digitalSignature: true },
    {
      name: 'subjectAltName',
      altNames: [
        { type: 2, value: 'localhost' },
        { type: 7, ip: '127.0.0.1' }
      ]
    }
  ]);
  cert.sign(keys.privateKey, forge.md.sha256.create());
  return {
    key: forge.pki.privateKeyToPem(keys.privateKey),
    cert: forge.pki.certificateToPem(cert)
  };
}

function dbRun(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(err) {
      if (err) reject(err);
      else resolve({ changes: this.changes, lastID: this.lastID });
    });
  });
}

function dbGet(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row || null)));
  });
}

function closeDb(db) {
  return new Promise((resolve, reject) => {
    db.close((err) => (err ? reject(err) : resolve()));
  });
}

async function criarBanco() {
  const db = new sqlite3.Database(':memory:');
  await dbRun(db, `
    CREATE TABLE nfce_notas (
      id INTEGER PRIMARY KEY,
      venda_id INTEGER,
      numero INTEGER,
      serie INTEGER,
      chave_acesso TEXT,
      ambiente INTEGER,
      status TEXT,
      xml_enviado TEXT,
      xml_retorno TEXT,
      protocolo TEXT,
      origem TEXT,
      fechamento_fiscal_id INTEGER,
      fechamento_documento_id INTEGER,
      updated_at TEXT
    )
  `);
  return db;
}

function xmlAutorizacao(chave, protocolo = PROTOCOLO_1) {
  return `<retConsSitNFe><protNFe><infProt><chNFe>${chave}</chNFe><cStat>100</cStat><nProt>${protocolo}</nProt></infProt></protNFe></retConsSitNFe>`;
}

function xmlEvento(cStat, motivo = 'Evento processado', cStatLote = '128') {
  return `<retEnvEvento><cStat>${cStatLote}</cStat><xMotivo>Lote processado</xMotivo><retEvento><infEvento><cStat>${cStat}</cStat><xMotivo>${motivo}</xMotivo><nProt>135260000000001</nProt><dhRegEvento>2026-10-14T12:00:00-03:00</dhRegEvento></infEvento></retEvento></retEnvEvento>`;
}

function xmlConsultaEventoCancelamento(chave, cStat = '135') {
  return `<retConsSitNFe><tpAmb>2</tpAmb><cStat>100</cStat><xMotivo>Consulta realizada</xMotivo>`
    + `<cUF>23</cUF><chNFe>${chave}</chNFe>`
    + `<protNFe><infProt><tpAmb>2</tpAmb><chNFe>${chave}</chNFe><cStat>100</cStat>`
    + '<nProt>135260000000001</nProt></infProt></protNFe>'
    + `<procEventoNFe><evento><infEvento Id="ID110111${chave}01"><cOrgao>23</cOrgao><tpAmb>2</tpAmb>`
    + `<CNPJ>${CNPJ}</CNPJ><chNFe>${chave}</chNFe><dhEvento>2026-10-14T12:00:00-03:00</dhEvento>`
    + '<tpEvento>110111</tpEvento><nSeqEvento>1</nSeqEvento><verEvento>1.00</verEvento>'
    + `<detEvento><descEvento>Cancelamento</descEvento><nProt>${PROTOCOLO_1}</nProt></detEvento>`
    + '</infEvento></evento><retEvento><infEvento><tpAmb>2</tpAmb><cOrgao>23</cOrgao>'
    + `<cStat>${cStat}</cStat><xMotivo>Evento registrado e vinculado a NF-e</xMotivo>`
    + `<chNFe>${chave}</chNFe><tpEvento>110111</tpEvento><nSeqEvento>1</nSeqEvento>`
    + '<dhRegEvento>2026-10-14T12:00:01-03:00</dhRegEvento><nProt>135260000000002</nProt>'
    + '</infEvento></retEvento></procEventoNFe></retConsSitNFe>';
}

async function inserirNota(db, {
  id,
  vendaId = 45,
  chave = CHAVE_1,
  ambiente = 2,
  status = 'autorizada',
  origem = 'venda',
  xml = xmlAutorizacao(chave)
} = {}) {
  await dbRun(db, `
    INSERT INTO nfce_notas
      (id, venda_id, numero, serie, chave_acesso, ambiente, status, xml_retorno, protocolo, origem, fechamento_fiscal_id)
    VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?)
  `, [
    id,
    vendaId,
    id,
    chave,
    ambiente,
    status,
    xml,
    PROTOCOLO_1,
    origem,
    origem === 'fechamento_fiscal_dia' ? 800 + id : null
  ]);
}

function depsCancelamento(db, enviarCancelamento, cnpj = CNPJ) {
  return {
    db,
    getFiscalConfig: async () => ({
      ambiente: 2,
      cnpj,
      codigoUf: '23',
      certificadoPath: 'certificado-sintetico.pfx',
      certificadoSenha: 'senha-sintetica'
    }),
    assinarEvento: () => ({ xmlAssinado: '<evento/>' }),
    carregarCertificadoPfx: () => ({
      privateKeyPem: 'chave-sintetica',
      certPem: 'certificado-sintetico'
    }),
    enviarCancelamento
  };
}

async function iniciarServidorTls(certificado, aoReceber) {
  const server = https.createServer(certificado, (req, res) => {
    aoReceber();
    req.resume();
    res.writeHead(200, { 'Content-Type': 'application/soap+xml' });
    res.end(xmlEvento('135'));
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return {
    server,
    url: `https://127.0.0.1:${server.address().port}/recepcaoevento`
  };
}

async function fecharServidor(server) {
  await new Promise((resolve) => server.close(resolve));
}

const tests = [];
function test(nome, fn) {
  tests.push({ nome, fn });
}

test('agente de cancelamento combina CAs Node com a raiz oficial e mantém validação TLS', () => {
  const cas = obterCAsCancelamento('nfce.svrs.rs.gov.br');
  assert.deepStrictEqual(cas.slice(0, tls.rootCertificates.length), tls.rootCertificates);
  assert.strictEqual(
    cas.length,
    tls.rootCertificates.length + (process.env.NODE_EXTRA_CA_CERTS ? 2 : 1)
  );
  assert.strictEqual(
    obterCAsCancelamento('api.example.test').length,
    tls.rootCertificates.length + (process.env.NODE_EXTRA_CA_CERTS ? 1 : 0)
  );

  const raiz = forge.pki.certificateFromPem(cas[cas.length - 1]);
  assert.ok(raiz.subject.attributes.some((attribute) => (
    attribute.value === 'Autoridade Certificadora Raiz Brasileira v10'
  )));
  assert.deepStrictEqual(
    raiz.subject.attributes.map((attribute) => attribute.value),
    raiz.issuer.attributes.map((attribute) => attribute.value)
  );
  const fingerprint = crypto.createHash('sha256')
    .update(forge.asn1.toDer(forge.pki.certificateToAsn1(raiz)).getBytes(), 'binary')
    .digest('hex')
    .toUpperCase()
    .match(/../g)
    .join(':');
  assert.strictEqual(
    fingerprint,
    '6E:0B:FF:06:9A:26:99:4C:15:DE:2C:48:88:CC:54:AF:84:88:2E:54:95:B7:FB:F6:6B:E9:CC:FF:EC:74:89:F6'
  );

  const agent = criarAgenteHttpsCancelamento({
    servername: 'nfce.svrs.rs.gov.br'
  });
  try {
    assert.strictEqual(agent.options.rejectUnauthorized, true);
    assert.strictEqual(agent.options.minVersion, 'TLSv1.2');
    assert.deepStrictEqual(agent.options.ca, cas);
    assert.strictEqual(agent.options.servername, 'nfce.svrs.rs.gov.br');
  } finally {
    agent.destroy();
  }
});

test('TLS local não confiável é rejeitado no runtime e no fallback legado', async () => {
  const tlsCert = gerarCertificadoTlsSintetico();
  let requisicoesHttp = 0;
  const local = await iniciarServidorTls(tlsCert, () => { requisicoesHttp += 1; });
  const db = await criarBanco();
  const fallbackCalls = [];
  const agents = [];
  let transport;
  const agentFactory = ({ tls: tlsOptions }) => {
    const agent = criarAgenteHttpsCancelamento({
      minVersion: tlsOptions.minVersion,
      servername: undefined
    });
    agents.push(agent);
    return agent;
  };

  try {
    await inserirNota(db, { id: 1, status: 'cancelamento_em_andamento' });

    transport = new SoapTransport({
      maxRetries: 3,
      createHttpsAgent: agentFactory
    });
    const platform = {
      resolve: () => ({
        success: true,
        source: 'TEST',
        definition: {
          endpoint: local.url,
          soapAction: 'cancelamento',
          namespace: 'test',
          versao: '1.00',
          modelo: 'NFCE',
          operacao: 'CANCELAMENTO',
          ambiente: 'HOMOLOGACAO',
          uf: 'SVRS',
          tls: { minVersion: 'TLSv1.2', rejectUnauthorized: false }
        }
      }),
      getSoapTransport: () => transport
    };
    const runtime = createCancelamentoRuntime({
      platform,
      legadoSender: async () => {
        fallbackCalls.push(true);
        return { success: true, body: xmlEvento('135') };
      }
    });

    const deps = depsCancelamento(db, runtime.enviarCancelamento);
    await assert.rejects(
      cancelarNfce.cancelarNfcePorId(1, 'Justificativa fiscal suficientemente longa', {
        ...deps,
        cancelamentoClaimed: true
      }),
      /self-signed certificate/i
    );

    assert.strictEqual(agents[0].options.rejectUnauthorized, true);
    assert.strictEqual(
      agents[0].options.ca.length,
      tls.rootCertificates.length
    );
    const nota = await dbGet(db, 'SELECT status FROM nfce_notas WHERE id = 1');
    assert.notStrictEqual(nota.status, 'cancelada');
    assert.strictEqual(nota.status, 'cancelamento_em_andamento');
    assert.deepStrictEqual(fallbackCalls, []);
    assert.strictEqual(requisicoesHttp, 0);

    const legacyAgent = new https.Agent({ rejectUnauthorized: true, minVersion: 'TLSv1.2' });
    const legacy = await enviarCancelamentoLegado({
      url: local.url,
      envelope: '<soap/>',
      httpsAgent: legacyAgent,
      timeoutMs: 1500
    });
    legacyAgent.destroy();
    assert.strictEqual(legacy.success, false);
    assert.strictEqual(requisicoesHttp, 0);
  } finally {
    agents.forEach((agent) => agent.destroy());
    await closeDb(db);
    await fecharServidor(local.server);
  }
});

test('duas NFC-e da mesma venda enviam somente o ID e a chave selecionados', async () => {
  const db = await criarBanco();
  const enviados = [];
  try {
    await inserirNota(db, { id: 11, chave: CHAVE_1 });
    await inserirNota(db, { id: 12, chave: CHAVE_2 });
    const signedEvents = [];

    const retorno = await cancelarNfce.cancelarNfcePorId(
      11,
      'Justificativa fiscal suficientemente longa',
      {
        ...depsCancelamento(db, async (params) => {
          enviados.push(params);
          return { success: true, body: xmlEvento('135'), source: 'test' };
        }),
        assinarEvento: (xml) => {
          signedEvents.push(xml);
          return { xmlAssinado: '<evento/>' };
        }
      }
    );

    assert.strictEqual(retorno.notaId, 11);
    assert.strictEqual(retorno.chaveAcesso, CHAVE_1);
    assert.strictEqual(enviados.length, 1);
    assert.strictEqual(enviados[0].chave, CHAVE_1);
    assert.ok(signedEvents[0].includes(CHAVE_1));
    assert.ok(!enviados[0].envelope.includes(CHAVE_2));
    assert.strictEqual((await dbGet(db, 'SELECT status FROM nfce_notas WHERE id = 12')).status, 'autorizada');
  } finally {
    await closeDb(db);
  }
});

test('cStat 573 consulta a mesma chave e só confirma evento 110111 validado', async () => {
  const db = await criarBanco();
  const enviados = [];
  const consultas = [];
  try {
    await inserirNota(db, { id: 31, chave: CHAVE_1 });
    const retorno = await cancelarNfce.cancelarNfcePorId(
      31,
      'Justificativa fiscal suficientemente longa',
      {
        ...depsCancelamento(db, async (params) => {
          enviados.push(params);
          return { success: true, body: xmlEvento('573', 'Duplicidade de evento'), source: 'test' };
        }),
        consultarProtocolo: async (params) => {
          consultas.push(params);
          return { success: true, body: xmlConsultaEventoCancelamento(CHAVE_1) };
        }
      }
    );

    assert.strictEqual(enviados.length, 1);
    assert.strictEqual(enviados[0].chave, CHAVE_1);
    assert.strictEqual(consultas.length, 1);
    assert.strictEqual(consultas[0].chave, CHAVE_1);
    assert.strictEqual(consultas[0].modelo, 'NFCE');
    assert.strictEqual(consultas[0].ambiente, 2);
    assert.strictEqual(consultas[0].cUF, '23');
    assert.strictEqual(retorno.confirmacaoCancelamento.confirmado, true);
    assert.strictEqual(retorno.confirmacaoCancelamento.cStat, '135');
    assert.strictEqual(retorno.confirmacaoCancelamento.protocolo, '135260000000002');
  } finally {
    await closeDb(db);
  }
});

test('cStat 573 com consulta indisponível não é tratado como confirmação', async () => {
  const db = await criarBanco();
  try {
    await inserirNota(db, { id: 32, chave: CHAVE_1 });
    const retorno = await cancelarNfce.cancelarNfcePorId(
      32,
      'Justificativa fiscal suficientemente longa',
      {
        ...depsCancelamento(db, async () => ({
          success: true,
          body: xmlEvento('573', 'Duplicidade de evento')
        })),
        consultarProtocolo: async () => { throw new Error('Timeout sintético'); }
      }
    );
    assert.strictEqual(retorno.confirmacaoCancelamento.confirmado, false);
    assert.match(retorno.confirmacaoCancelamento.motivo, /Timeout sintético/);
  } finally {
    await closeDb(db);
  }
});

test('nota inexistente, outra empresa e operação em andamento não transmitem', async () => {
  const db = await criarBanco();
  let chamadas = 0;
  const enviar = async () => {
    chamadas += 1;
    return { success: true, body: xmlEvento('135') };
  };
  try {
    await inserirNota(db, { id: 21, chave: CHAVE_2 });
    await inserirNota(db, { id: 22, chave: CHAVE_1, status: 'cancelamento_em_andamento' });

    await assert.rejects(
      cancelarNfce.cancelarNfcePorId(999, 'Justificativa fiscal suficientemente longa', depsCancelamento(db, enviar)),
      (err) => err.statusCode === 404
    );
    await assert.rejects(
      cancelarNfce.cancelarNfcePorId(
        21,
        'Justificativa fiscal suficientemente longa',
        depsCancelamento(db, enviar, '98765432000198')
      ),
      /CNPJ da NFC-e não corresponde/
    );
    await assert.rejects(
      cancelarNfce.cancelarNfcePorId(22, 'Justificativa fiscal suficientemente longa', depsCancelamento(db, enviar)),
      (err) => err.statusCode === 409
    );
    assert.strictEqual(chamadas, 0);
  } finally {
    await closeDb(db);
  }
});

test('cStat 136 e retorno desconhecido bloqueiam reenvio sem liberar a venda', async () => {
  const db = await criarBanco();
  let chamadas = 0;
  try {
    await inserirNota(db, {
      id: 31,
      vendaId: null,
      origem: 'fechamento_fiscal_dia',
      xml: xmlAutorizacao(CHAVE_1),
      chave: CHAVE_1
    });
    const opts = {
      deps: {
        skipSnapshot: true,
        ignorarPrazoLocal: true,
        cancelarNfcePorId: async (id) => {
          chamadas += 1;
          assert.strictEqual(id, 31);
          return { sefaz: xmlEvento('136', 'Evento registrado, mas não vinculado') };
        }
      }
    };

    await assert.rejects(
      cancelarDocumentoFiscalFechamento(
        db,
        31,
        'Justificativa fiscal suficientemente longa',
        opts
      ),
      (err) => err.code === 'PENDENCIA_DOCUMENTAL_CSTAT_136'
    );

    const nota = await dbGet(db, 'SELECT status, xml_retorno FROM nfce_notas WHERE id = 31');
    assert.strictEqual(nota.status, 'cancelamento_desconhecido');
    assert.ok(nota.xml_retorno.includes('<cStat>136</cStat>'));
    await assert.rejects(
      cancelarDocumentoFiscalFechamento(
        db,
        31,
        'Justificativa fiscal suficientemente longa',
        opts
      ),
      /Somente NFC-e autorizada/
    );
    assert.strictEqual(chamadas, 1);
  } finally {
    await closeDb(db);
  }
});

test('cStat 573 sem confirmação oficial mantém fechamento desconhecido e bloqueia novo envio', async () => {
  const db = await criarBanco();
  let chamadas = 0;
  try {
    await inserirNota(db, {
      id: 32,
      vendaId: null,
      origem: 'fechamento_fiscal_dia',
      xml: xmlAutorizacao(CHAVE_1),
      chave: CHAVE_1
    });
    const opts = {
      deps: {
        skipSnapshot: true,
        ignorarPrazoLocal: true,
        cancelarNfcePorId: async (id) => {
          chamadas += 1;
          assert.strictEqual(id, 32);
          return { sefaz: xmlEvento('573', 'Duplicidade de evento') };
        }
      }
    };

    await assert.rejects(
      cancelarDocumentoFiscalFechamento(
        db,
        32,
        'Justificativa fiscal suficientemente longa',
        opts
      ),
      (err) => err.code === 'PENDENCIA_RECONCILIACAO_CSTAT_573'
        && /não comprova o cancelamento/.test(err.message)
    );
    const nota = await dbGet(db, 'SELECT status, xml_retorno FROM nfce_notas WHERE id = 32');
    assert.strictEqual(nota.status, 'cancelamento_desconhecido');
    assert.match(nota.xml_retorno, /<cStat>573<\/cStat>/);
    await assert.rejects(
      cancelarDocumentoFiscalFechamento(
        db,
        32,
        'Justificativa fiscal suficientemente longa',
        opts
      ),
      /Somente NFC-e autorizada/
    );
    assert.strictEqual(chamadas, 1);
  } finally {
    await closeDb(db);
  }
});

test('falha ao persistir o cancelamento mantém claim bloqueado', async () => {
  const db = await criarBanco();
  try {
    await inserirNota(db, {
      id: 41,
      vendaId: null,
      origem: 'fechamento_fiscal_dia',
      xml: xmlAutorizacao(CHAVE_1),
      chave: CHAVE_1
    });
    await dbRun(db, `
      CREATE TRIGGER falha_persistencia_cancelamento
      BEFORE UPDATE OF status ON nfce_notas
      WHEN NEW.status = 'cancelada'
      BEGIN
        SELECT RAISE(ABORT, 'falha de persistência sintética');
      END
    `);

    await assert.rejects(
      cancelarDocumentoFiscalFechamento(
        db,
        41,
        'Justificativa fiscal suficientemente longa',
        {
          deps: {
            skipSnapshot: true,
            ignorarPrazoLocal: true,
            cancelarNfcePorId: async (id) => ({
              notaId: id,
              sefaz: xmlEvento('135')
            })
          }
        }
      ),
      /falha de persistência sintética/
    );
    assert.strictEqual(
      (await dbGet(db, 'SELECT status FROM nfce_notas WHERE id = 41')).status,
      'cancelamento_em_andamento'
    );
  } finally {
    await closeDb(db);
  }
});

test('xml_retorno preserva a raiz SEFAZ e mantém os retornos anteriores legíveis', async () => {
  const antigo = xmlAutorizacao(CHAVE_1);
  const atual = xmlEvento('135');
  const xml = appendXmlRetornoNfce(antigo, `<?xml version="1.0" encoding="utf-8"?>${atual}`);
  const parsed = await xml2js.parseStringPromise(xml, { explicitArray: false });

  assert.ok(xml.startsWith(antigo));
  assert.equal(parsed.retConsSitNFe.protNFe.infProt.chNFe, CHAVE_1);
  assert.deepStrictEqual(extrairChaveEProtocoloAutorizados(xml), {
    chaveAcesso: CHAVE_1,
    protocolo: PROTOCOLO_1
  });
  assert.strictEqual(extrairCancelamentoSefaz(xml).cStatEvento, '135');

  const retornoAnterior = xmlEvento('573', 'Duplicidade de evento');
  const xmlLegado = `<retornosNfce><retornoAnterior><![CDATA[${antigo}]]></retornoAnterior>`
    + `<retornoAtual>${retornoAnterior}</retornoAtual></retornosNfce>`;
  const migrado = appendXmlRetornoNfce(xmlLegado, xmlEvento('135'));
  const parsedMigrado = await xml2js.parseStringPromise(migrado, { explicitArray: false });

  assert.equal(parsedMigrado.retConsSitNFe.protNFe.infProt.chNFe, CHAVE_1);
  assert.deepStrictEqual(extrairChaveEProtocoloAutorizados(migrado), {
    chaveAcesso: CHAVE_1,
    protocolo: PROTOCOLO_1
  });
  assert.match(migrado, /<cStat>573<\/cStat>/);
  assert.strictEqual(extrairCancelamentoSefaz(migrado).cStatEvento, '135');

  const nfeProc = `<nfeProc>${xmlAutorizacao(CHAVE_1)}</nfeProc>`;
  const nfeProcComHistorico = appendXmlRetornoNfce(nfeProc, atual);
  assert.strictEqual(
    extrairXmlNfceAutorizado({ xml_retorno: nfeProcComHistorico }),
    nfeProc,
    'exportação contábil continua extraindo o XML autorizado original'
  );
});

test('cStat desconhecido não é sucesso fiscal', async () => {
  assert.strictEqual(classificarResultado('135'), 'AUTORIZADO');
  assert.strictEqual(classificarResultado('155'), 'AUTORIZADO');
  assert.strictEqual(classificarResultado('136'), 'DESCONHECIDO');
  assert.strictEqual(classificarResultado('573'), 'DESCONHECIDO');
  assert.strictEqual(classificarResultado('631'), 'REJEITADO');
  assert.strictEqual(classificarResultado('999'), 'DESCONHECIDO');

  const routeSource = fs.readFileSync(
    path.join(__dirname, '../../backend/rotas/fiscal.js'),
    'utf8'
  );
  const vendaSource = fs.readFileSync(
    path.join(__dirname, '../../backend/services/vendas/VendaCancelamentoService.js'),
    'utf8'
  );
  assert.match(routeSource, /cancelarNfce\.cancelarNfcePorId\(\s*id,/);
  assert.doesNotMatch(routeSource, /cancelarNfce\(nota\.venda_id/);
  assert.match(routeSource, /'cancelamento_desconhecido'/);
  assert.match(routeSource, /rejeicaoConhecida \? 'autorizada' : 'cancelamento_desconhecido'/);
  assert.match(vendaSource, /cancelarNfceAutorizadaVenda\(vendaId, justificativa, avaliacao\.nfce\.id\)/);
  assert.match(vendaSource, /concluirAposConfirmacaoFiscal\(\)/);
});

async function main() {
  let passed = 0;
  let failed = 0;
  for (const item of tests) {
    try {
      await item.fn();
      passed += 1;
      console.log(`  OK  ${item.nome}`);
    } catch (error) {
      failed += 1;
      console.error(`  FALHOU  ${item.nome}`);
      console.error(`         ${error.stack || error.message}`);
    }
  }
  console.log(`\nResultado: ${passed} ok, ${failed} falha(s)\n`);
  if (failed) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
