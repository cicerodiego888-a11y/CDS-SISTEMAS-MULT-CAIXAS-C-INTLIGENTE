/**
 * Sprint 08.0 — Numeração oficial NFC-e + correção cStat 442 (xPag) + retorno infProt
 * Executar: node --test tests/fiscal/fechamento-fiscal-dia-sprint08-0.test.js
 *
 * NÃO transmite. NÃO altera contador/configuração de produção.
 */
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '../..');
const PREP_SRC = fs.readFileSync(
  path.join(ROOT, 'backend/services/fechamento-fiscal/FechamentoFiscalPreparacaoService.js'),
  'utf8'
);
const TX_SRC = fs.readFileSync(
  path.join(ROOT, 'backend/services/fechamento-fiscal/FechamentoFiscalTransmissaoService.js'),
  'utf8'
);
const FRONT = fs.readFileSync(
  path.join(ROOT, 'frontend/erp/js/fechamento-fiscal-dia.js'),
  'utf8'
);

const {
  extrairCStat,
  extrairXMotivo
} = require('../../backend/services/fechamento-fiscal/FechamentoFiscalTransmissaoService');
const {
  gerarXmlDocumento,
  peekNumeroProvisorio
} = require('../../backend/services/fechamento-fiscal/FechamentoFiscalPreparacaoService');

const SOAP_104_442 = `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope">
  <soap:Body>
    <nfeResultMsg>
      <retEnviNFe versao="4.00" xmlns="http://www.portalfiscal.inf.br/nfe">
        <cStat>104</cStat>
        <xMotivo>Lote processado</xMotivo>
        <protNFe>
          <infProt>
            <cStat>442</cStat>
            <xMotivo>Rejeicao: Descricao do pagamento nao permitida</xMotivo>
          </infProt>
        </protNFe>
      </retEnviNFe>
    </nfeResultMsg>
  </soap:Body>
</soap:Envelope>`;

describe('Sprint 08.0 — numeração oficial + 442 + infProt', () => {
  it('01 — extrai cStat/xMotivo de infProt e não do lote', () => {
    assert.equal(extrairCStat(SOAP_104_442), '442');
    assert.match(extrairXMotivo(SOAP_104_442), /Descricao do pagamento|Descrição do pagamento|nao permitida|não permitida/i);
    assert.notEqual(extrairXMotivo(SOAP_104_442), 'Lote processado');
    assert.match(TX_SRC, /infProt/);
    assert.match(TX_SRC, /envio\.xMotivo/);
  });

  it('02 — cartão/PIX não geram xPag (evita cStat 442)', async () => {
    const config = {
      ambiente: 2,
      serie: 1,
      uf: 'CE',
      codigoUf: '23',
      crt: '1',
      cnpj: '68645756000121',
      ie: '073590150',
      nomeEmpresa: 'TESTE',
      municipioCodigo: '2307304',
      municipioNome: 'Juazeiro do Norte',
      logradouro: 'Rua A',
      numeroEndereco: '1',
      bairro: 'Centro',
      cep: '63000000',
      idCSC: '00001',
      tokenCSC: 'AAAA',
      certificadoPath: null,
      certificadoSenha: null,
      urls: { consultaQr: 'https://example.local/qr', consultaChave: 'https://example.local/chave' }
    };
    const snapshotItens = [{
      produto_id: 1,
      descricao: 'Coca',
      ncm: '22021000',
      cest: null,
      cfop: '5102',
      csosn: '102',
      origem: '0',
      unidade: 'UN',
      quantidade: 1,
      valor_unitario: 44,
      valor_total: 44,
      desconto: 0
    }];

    for (const forma of ['cartao', 'cartao_credito', 'cartao_debito', 'pix']) {
      const gerado = await gerarXmlDocumento({
        config,
        snapshotItens,
        pagamentos: [{ forma_pagamento: forma, valor: 44, operadora: 'Mercado pago' }],
        valorTotal: 44,
        numero: 51
      });
      assert.doesNotMatch(gerado.xml, /<xPag>/i, `forma ${forma} não deve emitir xPag`);
      assert.doesNotMatch(gerado.xml, /Mercado pago/i);
    }

    assert.match(PREP_SRC, /tPag === '99'/);
    assert.match(PREP_SRC, /NÃO copiar operadora para xPag|nao copiar operadora para xPag|cStat 442/i);
  });

  it('03 — Fechamento usa numeração oficial e não inventa contador próprio', () => {
    assert.match(TX_SRC, /incrementaNumeroFiscal|reservarNumero/);
    assert.match(TX_SRC, /DOC_STATUS\.REJEITADO/);
    assert.match(TX_SRC, /!numero \|\| doc\.status === DOC_STATUS\.REJEITADO/);
    assert.match(PREP_SRC, /peekNumeroProvisorio/);
    assert.match(PREP_SRC, /numeroAtual/);
    assert.doesNotMatch(PREP_SRC, /Math\.floor\(Math\.random/);
    assert.doesNotMatch(TX_SRC, /numero\s*=\s*50/);

    const n = peekNumeroProvisorio({ numeroAtual: 51, serie: 1 }, 1);
    assert.equal(n, 51);
  });

  it('04 — não transmite automaticamente e Motor Fiscal permanece fora do escopo deste ajuste', () => {
    assert.doesNotMatch(FRONT, /ffdCarregarDia[\s\S]{0,400}ffdTransmitirSefaz\(/);
    assert.match(FRONT, /confirmado:\s*true/);
    assert.match(TX_SRC, /enviarAutorizacao/);
    // xmlBuilder (Motor) não foi reescrito neste sprint — correção fica na preparação do fechamento
    const xmlBuilder = fs.readFileSync(path.join(ROOT, 'backend/services/fiscal/xmlBuilder.js'), 'utf8');
    assert.match(xmlBuilder, /function montarPagamentos/);
  });

  it('05 — auditoria documental do cenário real (somente leitura, se DB existir)', async () => {
    const dbPath = 'C:/ProgramData/MercantilFiscal/dados/mercadao.db';
    if (!fs.existsSync(dbPath)) {
      assert.ok(true, 'DB operacional ausente — auditoria de código apenas');
      return;
    }
    const sqlite3 = require('sqlite3');
    const db = await new Promise((res, rej) => {
      const d = new sqlite3.Database(dbPath, sqlite3.OPEN_READONLY, (e) => (e ? rej(e) : res(d)));
    });
    const get = (sql, p = []) => new Promise((res, rej) => db.get(sql, p, (e, r) => (e ? rej(e) : res(r))));

    const cfg = await get(`SELECT valor FROM configuracoes WHERE chave='fiscal_numero_atual'`);
    const serie = await get(`SELECT valor FROM configuracoes WHERE chave='fiscal_serie'`);
    const fn = await get(`SELECT proximo_numero FROM fiscal_numeracao WHERE ambiente=1 AND modelo='65' AND serie=1`);
    const doc51 = await get(
      `SELECT id, status, numero, chave_acesso, protocolo FROM fechamentos_fiscais_documentos
       WHERE fechamento_fiscal_id=4 AND CAST(numero AS INTEGER)=51 AND UPPER(status)='AUTORIZADO' LIMIT 1`
    );
    const tx50 = await get(
      `SELECT status, cstat, chave_acesso FROM fechamentos_fiscais_transmissoes
       WHERE fechamento_fiscal_id=4 AND CAST(cstat AS TEXT)='442' ORDER BY id DESC LIMIT 1`
    );

    assert.equal(String(serie.valor), '1');
    assert.ok(Number(cfg.valor) >= 51);
    assert.ok(Number(fn.proximo_numero) >= 51);
    // Histórico: tentativa nº 50 rejeitada (442) permanece na auditoria de transmissão.
    assert.ok(tx50);
    assert.equal(tx50.status, 'REJEITADO');
    // Documento atual autorizado: nº 51.
    assert.ok(doc51);
    assert.equal(Number(doc51.numero), 51);
    assert.ok(doc51.chave_acesso);
    assert.ok(doc51.protocolo);

    await new Promise((res, rej) => db.close((e) => (e ? rej(e) : res())));
  });
});
