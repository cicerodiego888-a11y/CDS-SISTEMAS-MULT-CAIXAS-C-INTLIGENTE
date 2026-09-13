/**
 * RC3.16.7 — Correção identificação destinatário NF-e (<dest>)
 * Elimina CNPJ 00000000000000 (cStat 208).
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  buildNfeXml,
  montarDocumentoDestinatarioNfe
} = require('../../backend/services/fiscal/xmlBuilderNfeVenda');

const CONFIG_BASE = {
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

function build(vendaExtra = {}, configExtra = {}) {
  return buildNfeXml({
    config: { ...CONFIG_BASE, ...configExtra },
    venda: {
      total: 10,
      desconto: 0,
      valor_fiscal: 10,
      cliente_nome: 'CLIENTE REAL',
      forma_pagamento: 'dinheiro',
      pagamentos: [{ forma_pagamento: 'dinheiro', valor: 10 }],
      ...vendaExtra
    },
    itens: [ITEM],
    numero: 1,
    dadosNfe: { natureza_operacao: 'VENDA', cfop: '5102' }
  });
}

describe('RC3.16.7 — montarDocumentoDestinatarioNfe', () => {
  it('PF com CPF válido → somente CPF', () => {
    const d = montarDocumentoDestinatarioNfe({
      cliente_cpf: '12345678901',
      tipo_pessoa: 'PF'
    });
    assert.equal(d.grupoDestDoc, 'CPF');
    assert.equal(d.tagXml, '<CPF>12345678901</CPF>');
    assert.equal(d.cnpj, null);
  });

  it('PJ com CNPJ válido → somente CNPJ', () => {
    const d = montarDocumentoDestinatarioNfe({
      cliente_cpf: '12345678000199',
      tipo_pessoa: 'PJ'
    });
    assert.equal(d.grupoDestDoc, 'CNPJ');
    assert.equal(d.tagXml, '<CNPJ>12345678000199</CNPJ>');
    assert.equal(d.cpf, null);
  });

  it('documento ausente → nunca 00000000000000', () => {
    const d = montarDocumentoDestinatarioNfe({ cliente_nome: 'SEM DOC' });
    assert.equal(d.grupoDestDoc, 'AUSENTE');
    assert.equal(d.tagXml, '');
    assert.doesNotMatch(d.tagXml, /00000000000000/);
  });

  it('CNPJ zerado explícito → AUSENTE', () => {
    const d = montarDocumentoDestinatarioNfe({ cliente_cpf: '00000000000000' });
    assert.equal(d.grupoDestDoc, 'AUSENTE');
    assert.equal(d.tagXml, '');
  });

  it('idEstrangeiro válido → grupo idEstrangeiro', () => {
    const d = montarDocumentoDestinatarioNfe({}, { dest_id_estrangeiro: 'ABCDE12345' });
    assert.equal(d.grupoDestDoc, 'idEstrangeiro');
    assert.match(d.tagXml, /<idEstrangeiro>ABCDE12345<\/idEstrangeiro>/);
  });
});

describe('RC3.16.7 — buildNfeXml grupo <dest>', () => {
  it('XML PF contém somente <CPF>', () => {
    const built = build({ cliente_cpf: '12345678901', tipo_pessoa: 'PF' });
    assert.match(built.xmlSemAssinatura, /<dest>[\s\S]*<CPF>12345678901<\/CPF>/);
    assert.doesNotMatch(built.xmlSemAssinatura, /<dest>[\s\S]*<CNPJ>/);
    assert.doesNotMatch(built.xmlSemAssinatura, /00000000000000/);
    assert.equal(built.destinatario.grupoDestDoc, 'CPF');
  });

  it('XML PJ contém somente <CNPJ>', () => {
    const built = build({ cliente_cpf: '12345678000199', tipo_pessoa: 'PJ' });
    assert.match(built.xmlSemAssinatura, /<dest>[\s\S]*<CNPJ>12345678000199<\/CNPJ>/);
    assert.doesNotMatch(built.xmlSemAssinatura, /<dest>[\s\S]*<CPF>/);
    assert.doesNotMatch(built.xmlSemAssinatura, /00000000000000/);
  });

  it('sem documento → bloqueia XML (RC3.16.12)', () => {
    assert.throws(
      () => build({ cliente_cpf: '', cpf_cnpj_nota: '' }),
      /NÃO É POSSÍVEL EMITIR NF-e SEM CPF, CNPJ OU ID ESTRANGEIRO DO DESTINATÁRIO/
    );
  });

  it('ordem schema: identificador antes de xNome', () => {
    const built = build({ cliente_cpf: '12345678901', tipo_pessoa: 'PF' });
    const dest = built.xmlSemAssinatura.match(/<dest>[\s\S]*?<\/dest>/)[0];
    const iCpf = dest.indexOf('<CPF>');
    const iNome = dest.indexOf('<xNome>');
    const iEnder = dest.indexOf('<enderDest>');
    const iIe = dest.indexOf('<indIEDest>');
    assert.ok(iCpf >= 0 && iCpf < iNome && iNome < iEnder && iEnder < iIe);
  });

  it('homologação mantém xNome oficial e CPF real', () => {
    const built = build({ cliente_cpf: '12345678901', cliente_nome: 'NOME REAL LTDA' });
    assert.match(
      built.xmlSemAssinatura,
      /<xNome>NF-E EMITIDA EM AMBIENTE DE HOMOLOGACAO - SEM VALOR FISCAL<\/xNome>/
    );
    assert.match(built.xmlSemAssinatura, /<CPF>12345678901<\/CPF>/);
    assert.doesNotMatch(built.xmlSemAssinatura, /NOME REAL LTDA/);
  });

  it('produção usa nome real', () => {
    const built = build(
      { cliente_cpf: '12345678901', cliente_nome: 'JOAO DA SILVA' },
      { ambiente: 1 }
    );
    assert.match(built.xmlSemAssinatura, /<xNome>JOAO DA SILVA<\/xNome>/);
  });
});
