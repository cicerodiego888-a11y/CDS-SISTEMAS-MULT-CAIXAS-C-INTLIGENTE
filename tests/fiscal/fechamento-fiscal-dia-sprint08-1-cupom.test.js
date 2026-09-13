/**
 * Sprint 08.1 — Cupom Fiscal / DANFE após autorização do Fechamento (§13–20)
 * Executar: node --test tests/fiscal/fechamento-fiscal-dia-sprint08-1-cupom.test.js
 * NÃO transmite em produção. NÃO cria venda/financeiro/estoque.
 */
'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3');

const ROOT = path.join(__dirname, '../..');
const FRONT_FFD = fs.readFileSync(
  path.join(ROOT, 'frontend/erp/js/fechamento-fiscal-dia.js'),
  'utf8'
);
const FRONT_FISCAL = fs.readFileSync(path.join(ROOT, 'frontend/erp/js/fiscal.js'), 'utf8');
const ROTA_FISCAL = fs.readFileSync(path.join(ROOT, 'backend/rotas/fiscal.js'), 'utf8');
const HIST_SRC = fs.readFileSync(
  path.join(ROOT, 'backend/services/fechamento-fiscal/NfceHistoricoOficialService.js'),
  'utf8'
);
const TX_SRC = fs.readFileSync(
  path.join(ROOT, 'backend/services/fechamento-fiscal/FechamentoFiscalTransmissaoService.js'),
  'utf8'
);

const {
  obterDanfeHtmlPorNfceId,
  gerarEPersistirDanfeNfce,
  sincronizarHistoricoNfceDoFechamento,
  ORIGEM_FECHAMENTO
} = require('../../backend/services/fechamento-fiscal/NfceHistoricoOficialService');

const CHAVE = '23260968645756000121650010000000511873269476';
const PROTOCOLO = '223260816956854';
const NUMERO = 51;
const SERIE = 1;
const VALOR = 44;

function openMem() {
  return new sqlite3.Database(':memory:');
}
function run(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(err) {
      if (err) reject(err);
      else resolve({ id: this.lastID, changes: this.changes });
    });
  });
}
function get(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row)));
  });
}
function all(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows || [])));
  });
}
function close(db) {
  return new Promise((resolve, reject) => db.close((err) => (err ? reject(err) : resolve())));
}

const DEPS_DANFE = {
  getFiscalConfig: async () => ({
    nomeEmpresa: 'Mercadao Teste',
    nomeFantasia: 'Mercadao',
    razaoSocial: 'Mercadao LTDA',
    cnpj: '68645756000121',
    endereco: 'Rua A, 1',
    telefone: '85999999999',
    logradouro: 'Rua A',
    numeroEndereco: '1',
    bairro: 'Centro',
    municipioNome: 'Fortaleza',
    uf: 'CE',
    cep: '60000000',
    ambiente: 1,
    serie: 1,
    danfeLarguraMm: 80
  }),
  danfe: {
    montarDadosDanfe: async (payload) => ({
      ...payload,
      montado: true
    }),
    gerarDanfeHtml: async (dados) => {
      const n = dados.numero || dados.nota?.numero;
      const s = dados.serie;
      const ch = dados.chave;
      const p = dados.nota?.protocolo;
      const tot = dados.venda?.total;
      const qr = dados.qrCodeUrl || '';
      return [
        '<html><body class="danfe-nfce">',
        `<div>NUMERO:${n}</div>`,
        `<div>SERIE:${s}</div>`,
        `<div>CHAVE:${ch}</div>`,
        `<div>PROTOCOLO:${p}</div>`,
        `<div>VALOR:${Number(tot).toFixed(2)}</div>`,
        qr ? `<div class="qrcode">${qr}</div>` : '',
        '</body></html>'
      ].join('');
    }
  },
  DanfeTermicoRenderer: {
    gerar: (dados) => ({
      html: `<pre>TERMICO ${dados.numero} ${dados.chave}</pre>`,
      texto: `TERMICO ${dados.numero}`
    })
  }
};

async function schema(db) {
  await run(db, `CREATE TABLE vendas (id INTEGER PRIMARY KEY, codigo TEXT, total REAL, status TEXT)`);
  await run(db, `CREATE TABLE financeiro (id INTEGER PRIMARY KEY, valor REAL)`);
  await run(db, `CREATE TABLE produtos (id INTEGER PRIMARY KEY, estoque REAL DEFAULT 0)`);
  await run(db, `CREATE TABLE nfce_notas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    venda_id INTEGER,
    numero INTEGER NOT NULL,
    serie INTEGER NOT NULL,
    chave_acesso TEXT,
    ambiente INTEGER DEFAULT 2,
    status TEXT DEFAULT 'pendente',
    xml_enviado TEXT,
    xml_retorno TEXT,
    protocolo TEXT,
    recibo TEXT,
    qr_code_url TEXT,
    danfe_html TEXT,
    fechamento_fiscal_id INTEGER,
    fechamento_documento_id INTEGER,
    origem TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
  await run(db, `CREATE TABLE fechamentos_fiscais (
    id INTEGER PRIMARY KEY, status TEXT, valor_informado REAL, valor_distribuido REAL
  )`);
  await run(db, `CREATE TABLE fechamentos_fiscais_documentos (
    id INTEGER PRIMARY KEY,
    fechamento_fiscal_id INTEGER,
    status TEXT,
    numero INTEGER,
    serie TEXT,
    ambiente INTEGER,
    chave_acesso TEXT,
    protocolo TEXT,
    cstat TEXT,
    xmotivo TEXT,
    valor_total REAL,
    xml_enviado TEXT,
    xml_assinado TEXT,
    xml_retorno TEXT,
    xml_autorizado TEXT
  )`);
  await run(db, `CREATE TABLE fechamentos_fiscais_documentos_itens (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    documento_id INTEGER,
    produto_id INTEGER,
    descricao TEXT,
    quantidade REAL,
    valor_unitario REAL,
    valor_total REAL,
    unidade TEXT,
    ordem INTEGER
  )`);
  await run(db, `CREATE TABLE fechamentos_fiscais_documentos_pagamentos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    documento_id INTEGER,
    forma_pagamento TEXT,
    valor REAL,
    operadora TEXT
  )`);
}

describe('Sprint 08.1 — Cupom Fiscal após autorização', () => {
  let db;
  let nfceId;

  before(async () => {
    db = openMem();
    await schema(db);
    await run(db, `INSERT INTO vendas (id, codigo, total, status) VALUES (1, 'V1', 10, 'finalizada')`);
    await run(db, `INSERT INTO produtos (id, estoque) VALUES (1, 100)`);
    await run(db, `INSERT INTO fechamentos_fiscais (id, status, valor_informado, valor_distribuido)
      VALUES (4, 'AUTORIZADO', 44, 44)`);
    await run(db, `INSERT INTO fechamentos_fiscais_documentos (
      id, fechamento_fiscal_id, status, numero, serie, ambiente, chave_acesso, protocolo, cstat,
      valor_total, xml_enviado, xml_retorno
    ) VALUES (
      2, 4, 'AUTORIZADO', ?, ?, 1, ?, ?, '100', ?,
      '<NFe><infNFe><qrCode><![CDATA[https://nfce.sefaz.ce.gov.br/qr?ch=AUTH]]></qrCode></infNFe></NFe>',
      '<retEnviNFe><protNFe><infProt><nProt>223260816956854</nProt></infProt></protNFe></retEnviNFe>'
    )`, [NUMERO, String(SERIE), CHAVE, PROTOCOLO, VALOR]);
    await run(db, `INSERT INTO fechamentos_fiscais_documentos_itens
      (documento_id, produto_id, descricao, quantidade, valor_unitario, valor_total, unidade, ordem)
      VALUES (2, 1, 'Item Fechamento', 1, 44, 44, 'UN', 1)`);
    await run(db, `INSERT INTO fechamentos_fiscais_documentos_pagamentos
      (documento_id, forma_pagamento, valor, operadora)
      VALUES (2, 'cartao', 44, 'MP')`);

    const sync = await sincronizarHistoricoNfceDoFechamento(db, 4);
    assert.equal(sync.ok, true);
    const nota = await get(db, `SELECT * FROM nfce_notas WHERE chave_acesso=?`, [CHAVE]);
    assert.ok(nota);
    nfceId = nota.id;

    // Garante DANFE com motor injetável (sem SEFAZ / sem config real)
    const gerado = await gerarEPersistirDanfeNfce(db, nfceId, DEPS_DANFE);
    assert.ok(gerado && gerado.html);
  });

  after(async () => {
    await close(db);
  });

  it('A — contrato: NFC-e autorizada do fechamento abre cupom automaticamente', () => {
    assert.match(FRONT_FFD, /body\.status === 'AUTORIZADO'/);
    assert.match(FRONT_FFD, /ffdAbrirCupomAposAutorizacao/);
    assert.match(FRONT_FFD, /ffdMostrarModalCupomFiscal/);
    assert.match(FRONT_FFD, /Cupom Fiscal — NFC-e Autorizada/);
  });

  it('B — cupom apresenta número correto', async () => {
    const pacote = await obterDanfeHtmlPorNfceId(db, nfceId);
    assert.equal(Number(pacote.nota.numero), NUMERO);
    assert.match(pacote.html, new RegExp(`NUMERO:${NUMERO}`));
  });

  it('C — cupom apresenta série correta', async () => {
    const pacote = await obterDanfeHtmlPorNfceId(db, nfceId);
    assert.equal(Number(pacote.nota.serie), SERIE);
    assert.match(pacote.html, new RegExp(`SERIE:${SERIE}`));
  });

  it('D — cupom apresenta chave correta', async () => {
    const pacote = await obterDanfeHtmlPorNfceId(db, nfceId);
    assert.equal(pacote.nota.chave_acesso, CHAVE);
    assert.match(pacote.html, new RegExp(`CHAVE:${CHAVE}`));
  });

  it('E — cupom apresenta protocolo correto', async () => {
    const pacote = await obterDanfeHtmlPorNfceId(db, nfceId);
    assert.equal(pacote.nota.protocolo, PROTOCOLO);
    assert.match(pacote.html, new RegExp(`PROTOCOLO:${PROTOCOLO}`));
  });

  it('F — cupom apresenta valor correto (dados persistidos, não catálogo atual)', async () => {
    const gerado = await gerarEPersistirDanfeNfce(db, nfceId, DEPS_DANFE);
    assert.equal(Number(gerado.total), VALOR);
    assert.match(gerado.html, /VALOR:44\.00/);
    // não consulta tabela produtos para montar valor
    assert.doesNotMatch(HIST_SRC, /FROM produtos/);
  });

  it('G — cupom inclui QR Code quando disponível no XML/persistido', async () => {
    const pacote = await obterDanfeHtmlPorNfceId(db, nfceId);
    assert.ok(pacote.nota.qr_code_url || /qrcode/i.test(pacote.html));
    assert.match(HIST_SRC, /extrairQrCodeUrlDoXml/);
  });

  it('H — botão imprimir reutiliza mecanismo existente', () => {
    assert.match(FRONT_FFD, /ffdImprimirCupomFiscal/);
    assert.match(FRONT_FFD, /imprimirHtmlFiscal/);
    assert.match(FRONT_FISCAL, /function imprimirHtmlFiscal/);
    assert.match(ROTA_FISCAL, /\/notas\/:id\/danfe/);
    assert.match(HIST_SRC, /gerarDanfeHtml/);
    assert.match(HIST_SRC, /DanfeTermicoRenderer/);
    // não cria segundo gerador de DANFE no frontend do fechamento
    assert.doesNotMatch(FRONT_FFD, /function gerarDanfeHtml|montarDadosDanfe/);
  });

  it('I — NFC-e rejeitada NÃO abre cupom autorizado', async () => {
    const rej = await run(db, `INSERT INTO nfce_notas
      (venda_id, numero, serie, chave_acesso, ambiente, status, protocolo)
      VALUES (NULL, 50, 1, 'CHAVE-REJ', 1, 'rejeitada', NULL)`);
    await assert.rejects(
      () => obterDanfeHtmlPorNfceId(db, rej.id),
      /autorizada|autorizado/i
    );
    assert.match(FRONT_FFD, /body\.status === 'AUTORIZADO'/);
    assert.doesNotMatch(FRONT_FFD, /ffdAbrirCupomAposAutorizacao\(.*REJEITADO/);
  });

  it('J — NFC-e pendente NÃO abre cupom autorizado', async () => {
    const pend = await run(db, `INSERT INTO nfce_notas
      (venda_id, numero, serie, chave_acesso, ambiente, status)
      VALUES (NULL, 99, 1, 'CHAVE-PEND', 1, 'pendente')`);
    await assert.rejects(
      () => obterDanfeHtmlPorNfceId(db, pend.id),
      /autorizada|autorizado/i
    );
  });

  it('K — reabrir cupom oficial via endpoint (sem item novo no menu de ações)', async () => {
    assert.match(ROTA_FISCAL, /\/notas\/:id\/danfe/);
    assert.doesNotMatch(FRONT_FISCAL, /abrirDanfeNfceEmitida|title=\"Cupom Fiscal\"/);
    const pacote1 = await obterDanfeHtmlPorNfceId(db, nfceId);
    const pacote2 = await obterDanfeHtmlPorNfceId(db, nfceId);
    assert.equal(pacote1.nota.id, pacote2.nota.id);
    assert.equal(pacote1.nota.chave_acesso, pacote2.nota.chave_acesso);
    assert.equal(pacote1.nota.protocolo, pacote2.nota.protocolo);
    assert.equal(pacote1.nota.origem, ORIGEM_FECHAMENTO);
  });

  it('L — abrir/imprimir cupom não gera nova transmissão', () => {
    assert.doesNotMatch(HIST_SRC, /enviarAutorizacao|transmitirFechamento|assinarNFe/);
    assert.match(ROTA_FISCAL, /router\.get\('\/notas\/:id\/danfe'/);
    assert.doesNotMatch(
      ROTA_FISCAL.slice(ROTA_FISCAL.indexOf("/notas/:id/danfe")),
      /POST|transmitir|autorizar/
    );
  });

  it('M — abrir/imprimir cupom não gera nova venda', async () => {
    const antes = (await get(db, `SELECT COUNT(*) AS c FROM vendas`)).c;
    await obterDanfeHtmlPorNfceId(db, nfceId);
    await gerarEPersistirDanfeNfce(db, nfceId, DEPS_DANFE);
    assert.equal((await get(db, `SELECT COUNT(*) AS c FROM vendas`)).c, antes);
  });

  it('N — abrir/imprimir cupom não gera novo financeiro', async () => {
    const antes = (await get(db, `SELECT COUNT(*) AS c FROM financeiro`)).c;
    await obterDanfeHtmlPorNfceId(db, nfceId);
    assert.equal((await get(db, `SELECT COUNT(*) AS c FROM financeiro`)).c, antes);
  });

  it('O — abrir/imprimir cupom não altera estoque', async () => {
    const antes = (await get(db, `SELECT estoque FROM produtos WHERE id=1`)).estoque;
    await obterDanfeHtmlPorNfceId(db, nfceId);
    await gerarEPersistirDanfeNfce(db, nfceId, DEPS_DANFE);
    assert.equal((await get(db, `SELECT estoque FROM produtos WHERE id=1`)).estoque, antes);
  });

  it('contrato — ações Imprimir / Visualizar / Fechar no modal', () => {
    assert.match(FRONT_FFD, /ffdCupomImprimir/);
    assert.match(FRONT_FFD, /ffdCupomAmpliar|Visualizar \/ Ampliar/);
    assert.match(FRONT_FFD, /ffdCupomFechar|Fechar/);
    assert.match(FRONT_FFD, /NFC-e AUTORIZADA/);
    assert.match(FRONT_FFD, /Número:[\s\S]*Série:[\s\S]*Chave:[\s\S]*Protocolo:/);
  });

  it('contrato — transmissão anexa historico_nfce e só AUTORIZADO abre cupom', () => {
    assert.match(TX_SRC, /historico_nfce/);
    assert.match(TX_SRC, /docsComHistorico|historico_nfce/);
    assert.match(FRONT_FFD, /cStat[\s\S]*100[\s\S]*150|cstat[\s\S]*100/);
    assert.match(FRONT_FFD, /!auth\.chave_acesso|chave_acesso/);
    assert.match(FRONT_FFD, /protocolo/);
  });
});
