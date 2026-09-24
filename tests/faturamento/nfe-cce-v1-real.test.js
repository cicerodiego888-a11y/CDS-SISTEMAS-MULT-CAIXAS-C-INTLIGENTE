/**
 * CC-e V1 REAL — fluxo com mock SEFAZ (128 lote / 135 evento),
 * rejeição, cancelada e duplicidade.
 */
'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const db = require('../../backend/database');
const cce = require('../../backend/services/fiscal/cartaCorrecaoNfe');

const CHAVE_TESTE = '23260957824986000131550019999999991634555900';

function dbRun(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(err) {
      if (err) return reject(err);
      resolve({ lastID: this.lastID, changes: this.changes });
    });
  });
}

function dbGet(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row || null)));
  });
}

function dbAll(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows || [])));
  });
}

function waitDbReady() {
  return new Promise((resolve) => setTimeout(resolve, 3500));
}

function xmlRetornoAutorizado(chave) {
  return `<retConsSitNFe><protNFe><infProt><tpAmb>2</tpAmb><chNFe>${chave}</chNFe><cStat>100</cStat><nProt>999000111222</nProt></infProt></protNFe></retConsSitNFe>`;
}

function xmlSefazRegistrado({ chave, nSeq = 1, nProt = '135000000000001' } = {}) {
  return `<?xml version="1.0"?>
<soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope">
  <soap:Body>
    <nfeRecepcaoEventoNFResult>
      <retEnvEvento versao="1.00" xmlns="http://www.portalfiscal.inf.br/nfe">
        <idLote>1</idLote>
        <tpAmb>2</tpAmb>
        <cStat>128</cStat>
        <xMotivo>Lote de Evento Processado</xMotivo>
        <retEvento versao="1.00">
          <infEvento>
            <tpAmb>2</tpAmb>
            <cOrgao>23</cOrgao>
            <cStat>135</cStat>
            <xMotivo>Evento registrado e vinculado a NF-e</xMotivo>
            <chNFe>${chave}</chNFe>
            <tpEvento>110110</tpEvento>
            <nSeqEvento>${nSeq}</nSeqEvento>
            <dhRegEvento>2026-09-24T17:00:00-03:00</dhRegEvento>
            <nProt>${nProt}</nProt>
          </infEvento>
        </retEvento>
      </retEnvEvento>
    </nfeRecepcaoEventoNFResult>
  </soap:Body>
</soap:Envelope>`;
}

function xmlSefazRejeitado({ chave, cStat = '573', xMotivo = 'Rejeicao: Duplicidade de Evento' } = {}) {
  return `<?xml version="1.0"?>
<soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope">
  <soap:Body>
    <nfeRecepcaoEventoNFResult>
      <retEnvEvento versao="1.00" xmlns="http://www.portalfiscal.inf.br/nfe">
        <idLote>1</idLote>
        <cStat>128</cStat>
        <xMotivo>Lote de Evento Processado</xMotivo>
        <retEvento versao="1.00">
          <infEvento>
            <cStat>${cStat}</cStat>
            <xMotivo>${xMotivo}</xMotivo>
            <chNFe>${chave}</chNFe>
            <tpEvento>110110</tpEvento>
            <nSeqEvento>1</nSeqEvento>
          </infEvento>
        </retEvento>
      </retEnvEvento>
    </nfeRecepcaoEventoNFResult>
  </soap:Body>
</soap:Envelope>`;
}

const depsOk = (chave, nSeq, nProt) => ({
  getFiscalConfig: async () => ({
    cnpj: '57824986000131',
    codigoUf: '23',
    ambiente: 2,
    certificadoPath: 'fake.pfx',
    certificadoSenha: 'x'
  }),
  carregarCertificadoPfx: () => ({
    privateKeyPem: 'KEY',
    certPem: 'CERT'
  }),
  assinarEvento: (xml) => ({ xmlAssinado: xml }),
  enviarCancelamento: async () => ({
    success: true,
    body: xmlSefazRegistrado({ chave, nSeq, nProt })
  })
});

describe('CC-e V1 REAL — parse SEFAZ 128/135', () => {
  it('extrai cStat do evento (135) e cStat do lote (128)', () => {
    const parsed = cce.parseRetornoEvento(xmlSefazRegistrado({ chave: CHAVE_TESTE, nSeq: 1 }));
    assert.equal(parsed.cStatLote, '128');
    assert.equal(parsed.cStat, '135');
    assert.equal(parsed.registrado, true);
    assert.equal(parsed.protocolo, '135000000000001');
    assert.match(parsed.xMotivo, /registrado e vinculado/i);
    assert.ok(parsed.dhRegEvento);
  });

  it('rejeição do evento não marca como registrada', () => {
    const parsed = cce.parseRetornoEvento(xmlSefazRejeitado({ chave: CHAVE_TESTE }));
    assert.equal(parsed.cStatLote, '128');
    assert.equal(parsed.cStat, '573');
    assert.equal(parsed.registrado, false);
  });
});

describe('CC-e V1 REAL — fluxo mockado (registro / rejeição / bloqueio)', () => {
  let notaId;
  let notaCanceladaId;

  before(async () => {
    await waitDbReady();
    await cce.garantirTabelaCce();

    const venda = await dbGet(`SELECT id FROM vendas ORDER BY id DESC LIMIT 1`);
    const vendaId = Number(venda?.id || 7);

    const ins = await dbRun(
      `INSERT INTO nfe_notas (
        venda_id, numero, serie, chave_acesso, ambiente, status, xml_retorno, protocolo, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, 'autorizada', ?, ?, datetime('now','localtime'), datetime('now','localtime'))`,
      [vendaId, 999901, 99, CHAVE_TESTE, 2, xmlRetornoAutorizado(CHAVE_TESTE), '999000111222']
    );
    notaId = ins.lastID;

    const chaveCancel = '23260957824986000131550019999999991634555901';
    const insCancel = await dbRun(
      `INSERT INTO nfe_notas (
        venda_id, numero, serie, chave_acesso, ambiente, status, xml_retorno, protocolo, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, 'cancelada', ?, ?, datetime('now','localtime'), datetime('now','localtime'))`,
      [vendaId, 999902, 99, chaveCancel, 2, xmlRetornoAutorizado(chaveCancel), '999000111223']
    );
    notaCanceladaId = insCancel.lastID;
  });

  after(async () => {
    if (notaId) {
      await dbRun(`DELETE FROM nfe_cce_eventos WHERE nfe_id = ?`, [notaId]);
      await dbRun(`DELETE FROM nfe_notas WHERE id = ?`, [notaId]);
    }
    if (notaCanceladaId) {
      await dbRun(`DELETE FROM nfe_cce_eventos WHERE nfe_id = ?`, [notaCanceladaId]);
      await dbRun(`DELETE FROM nfe_notas WHERE id = ?`, [notaCanceladaId]);
    }
  });

  it('evento 1 registrado (cStat 135) e persistido', async () => {
    const out = await cce.transmitirCartaCorrecao(
      notaId,
      { xCorrecao: 'Correcao do endereco de entrega informado na NF-e de teste.' },
      depsOk(CHAVE_TESTE, 1, '135000000000001')
    );
    assert.equal(out.success, true);
    assert.equal(out.status, 'registrada');
    assert.equal(out.evento.n_seq_evento, 1);
    assert.equal(out.sefaz.cStatLote, '128');
    assert.equal(out.sefaz.cStat, '135');
    assert.equal(out.evento.protocolo, '135000000000001');

    const row = await dbGet(`SELECT * FROM nfe_cce_eventos WHERE nfe_id = ? AND n_seq_evento = 1`, [notaId]);
    assert.equal(row.status, 'registrada');
    assert.equal(row.c_stat, '135');
    assert.equal(row.chave_nfe, CHAVE_TESTE);
    assert.ok(row.xml_envio && row.xml_envio.includes('110110'));
    assert.ok(row.xml_retorno && row.xml_retorno.includes('<cStat>135</cStat>'));
    assert.ok(row.dh_recebimento);
  });

  it('evento 2 registrado com n_seq_evento = 2', async () => {
    const out = await cce.transmitirCartaCorrecao(
      notaId,
      { xCorrecao: 'Segunda correcao: complemento do campo de observacoes da NF-e.' },
      depsOk(CHAVE_TESTE, 2, '135000000000002')
    );
    assert.equal(out.success, true);
    assert.equal(out.evento.n_seq_evento, 2);
    assert.equal(out.status, 'registrada');

    const rows = await dbAll(
      `SELECT n_seq_evento, status FROM nfe_cce_eventos WHERE nfe_id = ? ORDER BY n_seq_evento`,
      [notaId]
    );
    assert.equal(rows.length >= 2, true);
    assert.equal(rows[0].n_seq_evento, 1);
    assert.equal(rows[1].n_seq_evento, 2);
  });

  it('rejeição preserva histórico e não marca como registrada', async () => {
    const depsRej = {
      ...depsOk(CHAVE_TESTE, 3, 'x'),
      enviarCancelamento: async () => ({
        success: true,
        body: xmlSefazRejeitado({ chave: CHAVE_TESTE, cStat: '574', xMotivo: 'Rejeicao: Falha no Schema XML' })
      })
    };
    const out = await cce.transmitirCartaCorrecao(
      notaId,
      { xCorrecao: 'Tentativa rejeitada de correcao textual na NF-e de teste.' },
      depsRej
    );
    assert.equal(out.success, false);
    assert.equal(out.status, 'rejeitada');
    assert.equal(out.evento.c_stat, '574');
    assert.match(out.evento.x_motivo || '', /Schema|Rejeicao/i);

    const hist = await dbAll(
      `SELECT n_seq_evento, status, c_stat FROM nfe_cce_eventos WHERE nfe_id = ? ORDER BY n_seq_evento`,
      [notaId]
    );
    assert.ok(hist.some((h) => h.status === 'registrada' && h.n_seq_evento === 1));
    assert.ok(hist.some((h) => h.status === 'registrada' && h.n_seq_evento === 2));
    assert.ok(hist.some((h) => h.status === 'rejeitada' && String(h.c_stat) === '574'));
  });

  it('NF-e cancelada bloqueada', async () => {
    await assert.rejects(
      () =>
        cce.transmitirCartaCorrecao(
          notaCanceladaId,
          { xCorrecao: 'Texto valido com mais de quinze caracteres.' },
          depsOk(CHAVE_TESTE, 1, '1')
        ),
      (err) => {
        assert.equal(err.statusCode, 400);
        assert.equal(err.code, 'NFE_CANCELADA');
        return true;
      }
    );
  });

  it('duplicidade protegida por UNIQUE(nfe_id, n_seq_evento)', async () => {
    let hit = false;
    try {
      await dbRun(
        `INSERT INTO nfe_cce_eventos (nfe_id, chave_nfe, n_seq_evento, x_correcao, status)
         VALUES (?, ?, 1, 'dup', 'pendente')`,
        [notaId, CHAVE_TESTE]
      );
    } catch (err) {
      hit = /UNIQUE|constraint/i.test(String(err.message || err));
    }
    assert.equal(hit, true);
  });
});
