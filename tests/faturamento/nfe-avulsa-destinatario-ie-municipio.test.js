/**
 * Correção destinatário NF-e Avulsa — IE + município do cliente.
 * Foco: payload/XML <dest> (não altera Motor Fiscal / TEF / pagamento).
 */
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  buildNfeXml,
  resolverIeDestinatarioNfe,
  resolverEnderecoDestinatarioNfe
} = require('../../backend/services/fiscal/xmlBuilderNfeVenda');

const CONFIG_EMITENTE = {
  codigoUf: '23',
  cnpj: '57824986000131',
  ie: '073252638',
  crt: 1,
  ambiente: 2,
  serie: 1,
  nomeEmpresa: 'EMITENTE TESTE',
  logradouro: 'RUA EMITENTE',
  numero: '100',
  bairro: 'CENTRO',
  codigo_municipio: '2307304',
  municipio_nome: 'JUAZEIRO DO NORTE',
  uf_sigla: 'CE',
  cep: '63000000'
};

const ITEM = {
  produto_id: 1,
  produto_nome: 'Produto A',
  quantidade_fiscal: 1,
  valor_fiscal: 10,
  preco_unitario: 10,
  produto_ncm: '10063021',
  cfop: '5102',
  csosn: '102',
  unidade: 'UN'
};

const CLIENTE_MV = {
  cliente_nome: 'MV ENGENHARIA',
  cliente_cpf: '09591661000103',
  tipo_pessoa: 'PJ',
  cliente_ie: '063640520',
  cliente_codigo_municipio: '2313252',
  cliente_cidade: 'TARRAFAS',
  cliente_uf: 'CE',
  cliente_rua: 'Rua Jose Candido de Araujo',
  cliente_numero: '71',
  cliente_bairro: 'Centro',
  cliente_cep: '63145000'
};

function extrairDest(xml) {
  const m = String(xml || '').match(/<dest>[\s\S]*?<\/dest>/);
  assert.ok(m, 'bloco <dest> ausente');
  return m[0];
}

function build(vendaExtra = {}, dadosNfeExtra = {}) {
  return buildNfeXml({
    config: CONFIG_EMITENTE,
    venda: {
      total: 10,
      desconto: 0,
      valor_fiscal: 10,
      forma_pagamento: 'dinheiro',
      pagamentos: [{ forma_pagamento: 'dinheiro', valor: 10 }],
      ...vendaExtra
    },
    itens: [ITEM],
    numero: 106,
    dadosNfe: { natureza_operacao: 'VENDA DE MERCADORIA', cfop: '5102', ...dadosNfeExtra }
  });
}

describe('NF-e Avulsa destinatário — IE + município', () => {
  it('TESTE 1 — cliente com IE → indIEDest=1 + IE + cMun do cliente', () => {
    const ie = resolverIeDestinatarioNfe(CLIENTE_MV, {});
    assert.equal(ie.indIEDest, '1');
    assert.equal(ie.ie, '063640520');

    const ender = resolverEnderecoDestinatarioNfe(CLIENTE_MV, {}, CONFIG_EMITENTE);
    assert.equal(ender.destCMun, '2313252');
    assert.match(ender.destXMun, /TARRAFAS/i);
    assert.equal(ender.destUf, 'CE');

    const built = build(CLIENTE_MV);
    const dest = extrairDest(built.xmlSemAssinatura);

    assert.match(dest, /<CNPJ>09591661000103<\/CNPJ>/);
    assert.match(dest, /<indIEDest>1<\/indIEDest>/);
    assert.match(dest, /<IE>063640520<\/IE>/);
    assert.match(dest, /<cMun>2313252<\/cMun>/);
    assert.match(dest, /<xMun>TARRAFAS<\/xMun>/);
    assert.match(dest, /<UF>CE<\/UF>/);
    assert.doesNotMatch(dest, /<IE>undefined<\/IE>/);
    assert.doesNotMatch(dest, /<IE>null<\/IE>/);
    assert.doesNotMatch(dest, /<IE><\/IE>/);
  });

  it('TESTE 2 — cliente sem IE → sem tag IE artificial; indIEDest=9', () => {
    const semIe = {
      ...CLIENTE_MV,
      cliente_ie: null,
      cliente_cpf: '12345678000199'
    };
    delete semIe.cliente_ie;

    const ie = resolverIeDestinatarioNfe(semIe, {});
    assert.equal(ie.indIEDest, '9');
    assert.equal(ie.ie, null);

    const built = build(semIe);
    const dest = extrairDest(built.xmlSemAssinatura);

    assert.match(dest, /<indIEDest>9<\/indIEDest>/);
    assert.doesNotMatch(dest, /<IE>/);
    assert.doesNotMatch(dest, /<IE>undefined<\/IE>/);
    assert.doesNotMatch(dest, /<IE>null<\/IE>/);
    assert.doesNotMatch(dest, /<IE><\/IE>/);
  });

  it('TESTE 3 — não herda cMun do emitente (Juazeiro 2307304)', () => {
    assert.equal(CONFIG_EMITENTE.codigo_municipio, '2307304');

    const ender = resolverEnderecoDestinatarioNfe(CLIENTE_MV, {}, CONFIG_EMITENTE);
    assert.equal(ender.destCMun, '2313252');
    assert.notEqual(ender.destCMun, CONFIG_EMITENTE.codigo_municipio);

    const built = build(CLIENTE_MV);
    const dest = extrairDest(built.xmlSemAssinatura);
    const emit = built.xmlSemAssinatura.match(/<emit>[\s\S]*?<\/emit>/)[0];

    assert.match(emit, /<cMun>2307304<\/cMun>/);
    assert.match(dest, /<cMun>2313252<\/cMun>/);
    assert.match(dest, /<xMun>TARRAFAS<\/xMun>/);
    assert.doesNotMatch(dest, /<cMun>2307304<\/cMun>/);
  });

  it('município por nome (sem codigo_municipio) via municipioIbge — sem herdar emitente', () => {
    const semCodigo = {
      ...CLIENTE_MV,
      cliente_codigo_municipio: null,
      cliente_cidade: 'TARRAFAS',
      cliente_uf: 'CE'
    };
    delete semCodigo.cliente_codigo_municipio;

    const ender = resolverEnderecoDestinatarioNfe(semCodigo, {}, CONFIG_EMITENTE);
    assert.equal(ender.destCMun, '2313252');
    assert.notEqual(ender.destCMun, '2307304');
  });

  it('IE vazia / ISENTO textual não gera <IE>', () => {
    for (const raw of ['', '   ', 'ISENTO', 'isento', null, undefined]) {
      const r = resolverIeDestinatarioNfe({ cliente_ie: raw }, {});
      assert.equal(r.indIEDest, '9');
      assert.equal(r.ie, null);
    }
  });
});
