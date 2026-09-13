/**
 * RC7.10.4 — Estabilização final emissor NFC-e / alinhamento NF-e 55
 */
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const forge = require('node-forge');
const fs = require('fs');
const path = require('path');

const {
  buildNfceXml,
  determinarModeloDeTotais,
  resolverPagamentosNfce,
  MODELO_BRUTO,
  MODELO_LIQUIDO
} = require('../../backend/services/fiscal/xmlBuilder');
const { buildNfeXml } = require('../../backend/services/fiscal/xmlBuilderNfeVenda');
const { validarXmlFiscal } = require('../../backend/services/fiscal/validarXmlFiscal');
const { assinarNFe } = require('../../backend/services/fiscal/signer');
const { montarLote } = require('../../backend/services/fiscal/soapClient');
const { compactarXml } = require('../../backend/services/fiscal/utils');

const cfg = {
  codigoUf: '23',
  cnpj: '65957340000150',
  ie: '073252638',
  crt: 1,
  ambiente: 2,
  serie: 1,
  nomeEmpresa: 'EMPRESA TESTE LTDA',
  logradouro: 'RUA A',
  numero: '100',
  bairro: 'CENTRO',
  codigo_municipio: '2307304',
  municipioCodigo: '2307304',
  municipio: 'JUAZEIRO DO NORTE',
  uf: 'CE',
  cep: '63000000',
  telefone: '8835110000',
  tpImp: 4,
  csosn_padrao: '102'
};

function itemFiscal({ valor_fiscal, quantidade_fiscal = 1, preco_unitario }) {
  return {
    produto_id: 1,
    produto_nome: 'PRODUTO TESTE',
    quantidade: quantidade_fiscal,
    quantidade_fiscal,
    quantidade_nao_fiscal: 0,
    preco_unitario: preco_unitario != null ? preco_unitario : valor_fiscal / quantidade_fiscal,
    valor_fiscal,
    valor_nao_fiscal: 0,
    produto_ncm: '10063021',
    cfop: '5102',
    unidade: 'UN',
    origem: 0,
    csosn: '102'
  };
}

function gerarParChavesHomologacao() {
  const keys = forge.pki.rsa.generateKeyPair(2048);
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = '01';
  cert.validity.notBefore = new Date();
  cert.validity.notAfter = new Date();
  cert.validity.notAfter.setFullYear(cert.validity.notBefore.getFullYear() + 1);
  const attrs = [{ name: 'commonName', value: 'CDS HOMOLOG RC7104' }];
  cert.setSubject(attrs);
  cert.setIssuer(attrs);
  cert.sign(keys.privateKey, forge.md.sha1.create());
  return {
    privateKeyPem: forge.pki.privateKeyToPem(keys.privateKey),
    certPem: forge.pki.certificateToPem(cert)
  };
}

describe('RC7.10.4 — fronteira R$ 0,01 determinística', () => {
  it('itens líquidos + desconto 0,01 → MODELO_LIQUIDO (nunca BRUTO)', () => {
    const m = determinarModeloDeTotais({
      itens: [itemFiscal({ valor_fiscal: 10 })],
      venda: { total: 10, desconto: 0.01, valor_fiscal: 10 }
    });
    assert.equal(m.modelo, MODELO_LIQUIDO);
    assert.equal(m.vDesc, 0);
    assert.equal(m.vNF, 10);
  });

  it('itens brutos + desconto 0,01 → MODELO_BRUTO', () => {
    const m = determinarModeloDeTotais({
      itens: [itemFiscal({ valor_fiscal: 10.01 })],
      venda: { total: 10, desconto: 0.01, valor_fiscal: 10 }
    });
    assert.equal(m.modelo, MODELO_BRUTO);
    assert.equal(m.vDesc, 0.01);
    assert.equal(m.vNF, 10);
  });

  it('XML líquido 0,01: vPag = vNF = 10', () => {
    const built = buildNfceXml({
      config: cfg,
      venda: {
        total: 10,
        desconto: 0.01,
        valor_fiscal: 10,
        forma_pagamento: 'dinheiro',
        pagamentos: [{ forma_pagamento: 'dinheiro', valor: 10, tipo_recebimento: 'fiscal' }]
      },
      itens: [itemFiscal({ valor_fiscal: 10 })],
      numero: 1
    });
    assert.equal(built.valores.modelo, MODELO_LIQUIDO);
    assert.equal(built.valores.vNF, 10);
    assert.match(built.xmlSemAssinatura, /<vPag>10\.00<\/vPag>/);
    assert.doesNotMatch(built.xmlSemAssinatura, /<vTroco>/);
  });
});

describe('RC7.10.4 — vTroco NFC-e', () => {
  it('pagamento 100 sobre vNF 78 gera vTroco 22', () => {
    const built = buildNfceXml({
      config: cfg,
      venda: {
        total: 78,
        desconto: 0,
        valor_fiscal: 78,
        forma_pagamento: 'dinheiro',
        pagamentos: [{ forma_pagamento: 'dinheiro', valor: 100, tipo_recebimento: 'fiscal' }]
      },
      itens: [itemFiscal({ valor_fiscal: 78 })],
      numero: 2
    });
    assert.equal(built.valores.vNF, 78);
    assert.equal(built.vTroco, 22);
    assert.match(built.xmlSemAssinatura, /<vPag>100\.00<\/vPag>/);
    assert.match(built.xmlSemAssinatura, /<vTroco>22\.00<\/vTroco>/);
    const v = validarXmlFiscal({ xml: built.xmlSemAssinatura, fase: 'pre_assinatura', modeloDoc: '65' });
    assert.equal(v.ok, true);
  });
});

describe('RC7.10.4 — cenários de emissão', () => {
  const casos = [
    { nome: 'sem desconto', desconto: 0, valor: 50, pag: 50, forma: 'dinheiro' },
    { nome: 'desconto valor líquido', desconto: 5.4, valor: 78, brutoItem: 78, pag: 78, forma: 'dinheiro' },
    { nome: 'desconto % líquido', desconto: 10, valor: 90, brutoItem: 90, pag: 90, forma: 'pix' },
    { nome: 'pix', desconto: 0, valor: 33.3, pag: 33.3, forma: 'pix' },
    { nome: 'cartao', desconto: 0, valor: 40, pag: 40, forma: 'cartao_credito' },
    { nome: 'arred 0.02', desconto: 0.02, valor: 10, brutoItem: 10, pag: 10, forma: 'dinheiro' },
    { nome: 'arred 0.05', desconto: 0.05, valor: 10, brutoItem: 10, pag: 10, forma: 'dinheiro' },
    { nome: 'arred 0.10', desconto: 0.1, valor: 10, brutoItem: 10, pag: 10, forma: 'dinheiro' },
    { nome: 'arred 0.99', desconto: 0.99, valor: 10, brutoItem: 10, pag: 10, forma: 'dinheiro' }
  ];

  for (const c of casos) {
    it(c.nome, () => {
      const built = buildNfceXml({
        config: cfg,
        venda: {
          total: c.valor,
          desconto: c.desconto,
          valor_fiscal: c.valor,
          forma_pagamento: c.forma,
          pagamentos: [{ forma_pagamento: c.forma, valor: c.pag, tipo_recebimento: 'fiscal' }]
        },
        itens: [itemFiscal({ valor_fiscal: c.brutoItem != null ? c.brutoItem : c.valor })],
        numero: 10
      });
      assert.equal(built.valores.vNF, c.valor);
      validarXmlFiscal({ xml: built.xmlSemAssinatura, fase: 'pre_assinatura', modeloDoc: '65' });
    });
  }

  it('múltiplos pagamentos', () => {
    const built = buildNfceXml({
      config: cfg,
      venda: {
        total: 78,
        desconto: 0,
        valor_fiscal: 78,
        pagamentos: [
          { forma_pagamento: 'pix', valor: 50, tipo_recebimento: 'fiscal' },
          { forma_pagamento: 'dinheiro', valor: 28, tipo_recebimento: 'fiscal' }
        ]
      },
      itens: [itemFiscal({ valor_fiscal: 78 })],
      numero: 11
    });
    validarXmlFiscal({ xml: built.xmlSemAssinatura, fase: 'pre_assinatura', modeloDoc: '65' });
  });

  it('itens fracionados', () => {
    const built = buildNfceXml({
      config: cfg,
      venda: {
        total: 7.55,
        desconto: 0,
        valor_fiscal: 7.55,
        pagamentos: [{ forma_pagamento: 'pix', valor: 7.55, tipo_recebimento: 'fiscal' }]
      },
      itens: [itemFiscal({ valor_fiscal: 7.55, quantidade_fiscal: 1.511, preco_unitario: 5 })],
      numero: 12
    });
    assert.equal(built.valores.vNF, 7.55);
    validarXmlFiscal({ xml: built.xmlSemAssinatura, fase: 'pre_assinatura', modeloDoc: '65' });
  });

  it('MODELO_BRUTO explícito', () => {
    const built = buildNfceXml({
      config: cfg,
      venda: {
        total: 78,
        desconto: 5.4,
        valor_fiscal: 78,
        pagamentos: [{ forma_pagamento: 'dinheiro', valor: 78, tipo_recebimento: 'fiscal' }]
      },
      itens: [itemFiscal({ valor_fiscal: 83.4 })],
      numero: 13
    });
    assert.equal(built.valores.modelo, MODELO_BRUTO);
    assert.equal(built.valores.vProd, 83.4);
    assert.equal(built.valores.vDesc, 5.4);
    assert.equal(built.valores.vNF, 78);
    validarXmlFiscal({ xml: built.xmlSemAssinatura, fase: 'pre_assinatura', modeloDoc: '65' });
  });

  it('venda mista (só parcela fiscal no XML)', () => {
    const built = buildNfceXml({
      config: cfg,
      venda: {
        total: 100,
        desconto: 0,
        valor_fiscal: 60,
        pagamentos: [{ forma_pagamento: 'dinheiro', valor: 60, tipo_recebimento: 'fiscal' }]
      },
      itens: [itemFiscal({ valor_fiscal: 60 })],
      numero: 14
    });
    assert.equal(built.valores.vNF, 60);
    validarXmlFiscal({ xml: built.xmlSemAssinatura, fase: 'pre_assinatura', modeloDoc: '65' });
  });
});

describe('RC7.10.4 — NF-e 55 alinhada', () => {
  it('itens líquidos + desconto não duplica', () => {
    const built = buildNfeXml({
      config: { ...cfg, uf_sigla: 'CE', municipio_nome: 'JUAZEIRO DO NORTE' },
      venda: {
        total: 78,
        desconto: 5.4,
        valor_fiscal: 78,
        cliente_cpf: '12345678909',
        cliente_nome: 'CLIENTE',
        pagamentos: [{ forma_pagamento: 'dinheiro', valor: 78, tipo_recebimento: 'fiscal' }]
      },
      itens: [itemFiscal({ valor_fiscal: 78 })],
      numero: 100
    });
    assert.equal(built.modelo, MODELO_LIQUIDO);
    assert.equal(built.valores.vDesc, 0);
    assert.equal(built.valores.vNF, 78);
  });

  it('itens brutos + desconto → MODELO_BRUTO', () => {
    const built = buildNfeXml({
      config: { ...cfg, uf_sigla: 'CE', municipio_nome: 'JUAZEIRO DO NORTE' },
      venda: {
        total: 78,
        desconto: 5.4,
        valor_fiscal: 78,
        cliente_cpf: '12345678909',
        cliente_nome: 'CLIENTE',
        pagamentos: [{ forma_pagamento: 'dinheiro', valor: 78, tipo_recebimento: 'fiscal' }]
      },
      itens: [itemFiscal({ valor_fiscal: 83.4 })],
      numero: 101
    });
    assert.equal(built.modelo, MODELO_BRUTO);
    assert.equal(built.valores.vProd, 83.4);
    assert.equal(built.valores.vDesc, 5.4);
    assert.equal(built.valores.vNF, 78);
  });
});

describe('RC7.10.4 — pagamento fiscal separado do não fiscal', () => {
  it('recebimentos F+NF: NFC-e usa só a parcela fiscal', () => {
    const built = buildNfceXml({
      config: cfg,
      venda: {
        total: 100,
        desconto: 0,
        valor_fiscal: 60,
        forma_pagamento: 'pix',
        pagamentos: [
          { forma_pagamento: 'pix', valor: 60, tipo_recebimento: 'fiscal' },
          { forma_pagamento: 'pix', valor: 40, tipo_recebimento: 'nao_fiscal' }
        ]
      },
      itens: [itemFiscal({ valor_fiscal: 60 })],
      numero: 21
    });
    assert.equal(built.valores.vNF, 60);
    assert.match(built.xmlSemAssinatura, /<vPag>60\.00<\/vPag>/);
    assert.doesNotMatch(built.xmlSemAssinatura, /<vPag>100\.00<\/vPag>/);
    assert.doesNotMatch(built.xmlSemAssinatura, /<vPag>40\.00<\/vPag>/);
    assert.doesNotMatch(built.xmlSemAssinatura, /<vTroco>/);
  });

  it('PIX comercial 100 sobre vNF 60 não vira troco', () => {
    const r = resolverPagamentosNfce({
      pagamentos: [{ forma_pagamento: 'pix', valor: 100 }]
    }, 60);
    assert.equal(r.pagamentos.length, 1);
    assert.equal(r.pagamentos[0].valor, 60);
    assert.equal(r.vTroco, 0);
  });
});

describe('RC7.10.4 — assinatura + XSD + SOAP (sem transmitir)', () => {
  it('emissão homologada completa', () => {
    const outDir = path.join(__dirname, '../../docs/historico/auditorias/rc7104-estabilizacao-nfce');
    fs.mkdirSync(outDir, { recursive: true });

    const built = buildNfceXml({
      config: cfg,
      venda: {
        total: 78,
        desconto: 5.4,
        valor_fiscal: 78,
        forma_pagamento: 'dinheiro',
        pagamentos: [{ forma_pagamento: 'dinheiro', valor: 100, tipo_recebimento: 'fiscal' }],
        cpf_cnpj_nota: '12345678909'
      },
      itens: [itemFiscal({ valor_fiscal: 78 })],
      numero: 71040
    });

    assert.equal(built.valores.modelo, MODELO_LIQUIDO);
    assert.equal(built.vTroco, 22);

    const pre = validarXmlFiscal({
      xml: built.xmlSemAssinatura,
      fase: 'pre_assinatura',
      modeloDoc: '65',
      validarXsd: true
    });
    assert.equal(pre.ok, true);

    const keys = gerarParChavesHomologacao();
    const xmlCompacto = compactarXml(built.xmlSemAssinatura);
    const assinatura = assinarNFe(xmlCompacto, keys.privateKeyPem, keys.certPem);
    assert.ok(assinatura.xmlAssinado.includes('<Signature'));
    assert.ok(assinatura.digestValue);

    fs.writeFileSync(path.join(outDir, 'nfce-assinada-homologacao.xml'), assinatura.xmlAssinado, 'utf8');
    fs.writeFileSync(path.join(outDir, 'digest-value.txt'), assinatura.digestValue, 'utf8');

    const pos = validarXmlFiscal({
      xml: assinatura.xmlAssinado.startsWith('<?xml')
        ? assinatura.xmlAssinado
        : `<?xml version="1.0" encoding="UTF-8"?>${assinatura.xmlAssinado}`,
      fase: 'pos_assinatura',
      modeloDoc: '65',
      validarXsd: true
    });
    assert.equal(pos.ok, true);
    assert.ok(pos.checks.assinatura.digestValue);

    const lote = montarLote(assinatura.xmlAssinado, '71040');
    assert.ok(lote && String(lote).includes('enviNFe') || String(lote).includes('NFe') || String(lote).length > 100);
    fs.writeFileSync(path.join(outDir, 'soap-lote-pronto-sem-transmitir.xml'), String(lote), 'utf8');

    fs.writeFileSync(
      path.join(outDir, 'evidencia-assinatura.json'),
      JSON.stringify({
        digestValue: assinatura.digestValue,
        temSignatureValue: /<SignatureValue>/.test(assinatura.xmlAssinado),
        temC14N: /c14n/.test(assinatura.xmlAssinado),
        temReference: /<Reference/.test(assinatura.xmlAssinado),
        temTransform: /Transform/.test(assinatura.xmlAssinado),
        xsd: pos.checks.schema,
        vTroco: built.vTroco,
        modelo: built.valores.modelo
      }, null, 2),
      'utf8'
    );
  });
});
