'use strict';

const { it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const sqlite3 = require('sqlite3');

const cryptoService = require('../../backend/services/crypto/cryptoService');
const { hidratarMetadadosPagamentoTef } = require('../../backend/services/fiscal/tefPagamentoHydrator');
const {
  montarPagamentos,
  validarVinculoTefPagamentos
} = require('../../backend/services/fiscal/xmlBuilder');
const { gerarXmlDocumento } = require('../../backend/services/fechamento-fiscal/FechamentoFiscalPreparacaoService');
const { buildNfceXml } = require('../../backend/services/fiscal/xmlBuilder');

function openDb(file) {
  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(file, (error) => (error ? reject(error) : resolve(db)));
  });
}

function run(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(error) {
      if (error) return reject(error);
      resolve({ lastID: this.lastID });
    });
  });
}

function all(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (error, rows) => (error ? reject(error) : resolve(rows || [])));
  });
}

const config = {
  codigoUf: '23',
  cnpj: '65957340000150',
  ie: '073252638',
  crt: 1,
  ambiente: 2,
  serie: 1,
  nomeEmpresa: 'EMPRESA TESTE',
  logradouro: 'RUA A',
  numero: '1',
  bairro: 'CENTRO',
  codigo_municipio: '2307304',
  municipio: 'JUAZEIRO DO NORTE',
  uf: 'CE',
  cep: '63000000',
  csosn_padrao: '102'
};

const snapshotItem = {
  produto_id: 1,
  descricao: 'ITEM TESTE',
  ncm: '10063021',
  cfop: '5102',
  csosn: '102',
  origem: 0,
  unidade: 'UN',
  quantidade: 1,
  valor_unitario: 30,
  valor_total: 30
};

it('recupera pelo recebimento TEF persistido, não cruza dados e preserva os campos do fechamento', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rc323-tef-'));
  const db = await openDb(path.join(dir, 'tef-test.db'));
  try {
    await run(db, `CREATE TABLE tef_transacoes (
      id INTEGER PRIMARY KEY, venda_id INTEGER, status TEXT, provedor TEXT,
      adquirente TEXT, bandeira TEXT, nsu TEXT, autorizacao TEXT, payload_retorno TEXT
    )`);
    await run(db, `CREATE TABLE venda_recebimentos (
      id INTEGER PRIMARY KEY, venda_id INTEGER, forma_pagamento TEXT, valor REAL,
      tef_transacao_id INTEGER, nsu TEXT, autorizacao TEXT, status TEXT
    )`);

    await run(db, `INSERT INTO tef_transacoes VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
      41, 9001, 'aprovado', 'DESTAXA', 'ADQUIRENTE-A', 'VISA', 'N41', 'A41',
      cryptoService.criptografarObjeto({ cnpj_credenciadora: '12345678000190' })
    ]);
    await run(db, `INSERT INTO tef_transacoes VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
      42, 9001, 'aprovado', 'DESTAXA', null, 'ELO', 'N42', null,
      cryptoService.criptografarObjeto({ financialState: 'APPROVED' })
    ]);
    await run(db, `INSERT INTO tef_transacoes VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
      44, 9001, 'aprovado', 'DESTAXA', null, null, 'N44', 'P44',
      cryptoService.criptografarObjeto({ cnpj_instituicao: '11223344000155' })
    ]);
    await run(db, `INSERT INTO venda_recebimentos VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, [
      501, 9001, 'cartao_credito', 10, 41, null, null, 'aprovado'
    ]);
    await run(db, `INSERT INTO venda_recebimentos VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, [
      502, 9001, 'cartao_debito', 10, 42, null, null, 'aprovado'
    ]);
    await run(db, `INSERT INTO venda_recebimentos VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, [
      503, 9001, 'cartao_credito', 10, null, null, null, 'aprovado'
    ]);
    await run(db, `INSERT INTO venda_recebimentos VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, [
      504, 9001, 'pix_tef', 10, 44, null, null, 'aprovado'
    ]);

    const carregarRecebimentos = () => all(db, `
      SELECT vr.id AS recebimento_id, vr.forma_pagamento, vr.valor,
        vr.venda_id, vr.tef_transacao_id, vr.nsu, vr.autorizacao,
        tt.status AS tef_status, tt.venda_id AS tef_venda_id, tt.provedor AS tef_provedor,
        tt.nsu AS tef_nsu, tt.autorizacao AS tef_autorizacao,
        tt.bandeira AS tef_bandeira, tt.adquirente AS tef_adquirente,
        tt.payload_retorno AS tef_payload_retorno
      FROM venda_recebimentos vr
      LEFT JOIN tef_transacoes tt ON tt.id = vr.tef_transacao_id
      WHERE vr.venda_id = ? AND vr.status = 'aprovado'
      ORDER BY vr.id
    `, [9001]);

    const pagamentosPrimeiraEmissao = hidratarMetadadosPagamentoTef(await carregarRecebimentos());
    const pagamentosReemissao = hidratarMetadadosPagamentoTef(await carregarRecebimentos());
    const xml = montarPagamentos(pagamentosPrimeiraEmissao);
    const xmlReemitido = montarPagamentos(pagamentosReemissao);
    const detalhes = xml.split('<detPag>');

    assert.equal(xmlReemitido, xml);
    assert.equal(pagamentosPrimeiraEmissao[0].tef.provedor, 'DESTAXA');
    assert.equal(pagamentosPrimeiraEmissao[0].tef.venda_id, 9001);
    assert.equal(pagamentosPrimeiraEmissao[0].tef.adquirente, 'ADQUIRENTE-A');
    assert.equal(pagamentosPrimeiraEmissao[0].tef.nsu, 'N41');
    assert.equal(pagamentosPrimeiraEmissao[0].tef.autorizacao, 'A41');
    assert.equal(pagamentosPrimeiraEmissao[0].tef.cnpj_credenciadora, '12345678000190');
    assert.equal(pagamentosPrimeiraEmissao[1].tef.cnpj_credenciadora, null);
    assert.equal(pagamentosPrimeiraEmissao[3].tef.cnpj_instituicao, '11223344000155');
    assert.match(detalhes[1], /<CNPJ>12345678000190<\/CNPJ>/);
    assert.match(detalhes[1], /<cAut>A41<\/cAut>/);
    assert.match(detalhes[2], /<tBand>06<\/tBand>/);
    assert.doesNotMatch(detalhes[2], /12345678000190|N41|A41/);
    assert.match(detalhes[3], /<tpIntegra>2<\/tpIntegra>/);
    assert.doesNotMatch(detalhes[3], /12345678000190|N41|A41|N42/);
    assert.match(detalhes[4], /<tpIntegra>1<\/tpIntegra>/);
    assert.match(detalhes[4], /<CNPJ>11223344000155<\/CNPJ>/);
    assert.equal(validarVinculoTefPagamentos(pagamentosPrimeiraEmissao, [
      { id: 41, status: 'aprovado' },
      { id: 42, status: 'aprovado' },
      { id: 44, status: 'aprovado' }
    ]), null);

    const pendencia = validarVinculoTefPagamentos(pagamentosPrimeiraEmissao, [
      { id: 41, status: 'aprovado' },
      { id: 42, status: 'aprovado' },
      { id: 44, status: 'aprovado' },
      { id: 43, status: 'aprovado' }
    ]);
    assert.equal(pendencia.status, 'pendente_dados_pagamento');
    assert.equal(pendencia.code, 'XML_PAGAMENTO_TEF_SEM_VINCULO');
    assert.equal(validarVinculoTefPagamentos([{
      forma_pagamento: 'cartao_credito',
      tef_transacao_id: 45,
      venda_id: 9001,
      tef: { transacao_id: '45', venda_id: 9002, status: 'aprovado' }
    }]).code, 'XML_PAGAMENTO_TEF_ID_DIVERGENTE');

    let pagamentoPreparado;
    const fechamentoXml = await gerarXmlDocumento({
      config,
      snapshotItens: [snapshotItem],
      pagamentos: [{
        recebimento_id: 77,
        operadora: 'POS INFORMADO',
        cnpj: '98765432000199',
        observacao: 'origem mantida',
        forma_pagamento: 'cartao',
        valor: 30
      }],
      valorTotal: 30,
      numero: 1,
      buildFn: (args) => {
        pagamentoPreparado = args.venda.pagamentos[0];
        return buildNfceXml(args);
      }
    });

    assert.equal(pagamentoPreparado.recebimento_id, 77);
    assert.equal(pagamentoPreparado.operadora, 'POS INFORMADO');
    assert.equal(pagamentoPreparado.cnpj, '98765432000199');
    assert.equal(pagamentoPreparado.observacao, 'origem mantida');
    assert.doesNotMatch(fechamentoXml.xml.match(/<pag>[\s\S]*?<\/pag>/)[0], /98765432000199/);
  } finally {
    await new Promise((resolve, reject) => db.close((error) => (error ? reject(error) : resolve())));
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
