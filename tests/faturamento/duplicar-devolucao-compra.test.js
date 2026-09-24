/**
 * Sprint — Duplicar NF-e autorizada como nova devolução.
 * Executar: node --test tests/faturamento/duplicar-devolucao-compra.test.js
 */

'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '../..');
const {
  podeDuplicarNota,
  recalcularItemRascunho,
  recalcularTotaisRascunho,
  extrairNItemOrigemDoXmlAutorizado,
  OPERACAO_AUDITORIA
} = require('../../backend/services/fiscal/duplicarDevolucaoCompra');
const {
  buildXmlNFeDevolucaoCompra
} = require('../../backend/services/fiscal/xmlBuilderNfeDevolucaoCompra');

const CHAVE_ORIGEM = '42260707670414000258550010000158601949669171';
const CHAVE_NF100 = '23260857824986000131550010000001001956868253';

const configBase = {
  codigoUf: '23',
  cnpj: '57824986000131',
  ie: '123456789',
  crt: 1,
  ambiente: 1,
  serie: 1,
  nomeEmpresa: 'CDS TESTE',
  logradouro: 'RUA A',
  numero: '10',
  bairro: 'CENTRO',
  municipioCodigo: '2307304',
  municipioNome: 'JUAZEIRO DO NORTE',
  uf: 'CE',
  cep: '63000000',
  telefone: '88999999999'
};

function itemDev(n, extra = {}) {
  return {
    produto_id: n,
    produto_codigo: `P${n}`,
    produto_nome: `PRODUTO ${n}`,
    ncm: '82041100',
    unidade: 'UN',
    quantidade: extra.quantidade != null ? extra.quantidade : 1,
    valor_unitario: extra.valor_unitario != null ? extra.valor_unitario : 10,
    nItemOrigem: extra.nItemOrigem != null ? extra.nItemOrigem : n,
    csosn: '102',
    cfop: '5202',
    ...extra
  };
}

describe('Duplicar devolução — regras de negócio', () => {
  it('1. permite duplicar NF autorizada', () => {
    const r = podeDuplicarNota({ id: 11, status: 'autorizada' });
    assert.equal(r.ok, true);
  });

  it('2. rejeita duplicação de NF cancelada', () => {
    const r = podeDuplicarNota({ id: 11, status: 'cancelada' });
    assert.equal(r.ok, false);
    assert.equal(r.code, 'STATUS_INVALIDO');
  });

  it('3. rejeita documento inválido', () => {
    const r = podeDuplicarNota(null);
    assert.equal(r.ok, false);
    assert.equal(r.code, 'DOCUMENTO_INVALIDO');
  });

  it('4. copia destinatário no payload de preview (contrato)', () => {
    const src = fs.readFileSync(path.join(ROOT, 'backend/services/fiscal/duplicarDevolucaoCompra.js'), 'utf8');
    assert.match(src, /destinatario: compra\.fornecedor/);
    assert.match(src, /fornecedor_cnpj/);
  });

  it('5. copiar 46 itens no recálculo', () => {
    const itens = Array.from({ length: 46 }, (_, i) => itemDev(i + 1, { quantidade: 2, valor_unitario: 1.5 }));
    const tot = recalcularTotaisRascunho(itens);
    assert.equal(tot.qtdItens, 46);
    assert.equal(tot.itens.length, 46);
  });

  it('6. preserva quantidades', () => {
    const tot = recalcularTotaisRascunho([itemDev(1, { quantidade: 4, valor_unitario: 15.88 })]);
    assert.equal(tot.itens[0].quantidade, 4);
  });

  it('7. preserva dados fiscais no rascunho', () => {
    const src = fs.readFileSync(path.join(ROOT, 'backend/services/fiscal/rascunhoDevolucaoCompra.js'), 'utf8');
    assert.match(src, /n_item_origem/);
    assert.match(src, /valor_unitario/);
    assert.match(src, /ncm/);
    assert.match(src, /cfop/);
  });

  it('8. cria novo rascunho (status RASCUNHO)', () => {
    const src = fs.readFileSync(path.join(ROOT, 'backend/services/fiscal/duplicarDevolucaoCompra.js'), 'utf8');
    assert.match(src, /salvarRascunhoDevolucaoCompra/);
    assert.match(src, /STATUS_RASCUNHO|status: rascunho\.status/);
  });

  it('9. não copia chave da NF 100', () => {
    const src = fs.readFileSync(path.join(ROOT, 'backend/services/fiscal/duplicarDevolucaoCompra.js'), 'utf8');
    assert.match(src, /chave_nfe_original: chaveOrigem/);
    assert.match(src, /chave_referenciada: chaveOrigem/);
  });

  it('10. não copia protocolo', () => {
    const src = fs.readFileSync(path.join(ROOT, 'backend/services/fiscal/duplicarDevolucaoCompra.js'), 'utf8');
    const payloadFn = src.slice(src.indexOf('function montarPayloadRascunho'), src.indexOf('async function previewDuplicar'));
    assert.doesNotMatch(payloadFn, /protocolo/);
    assert.doesNotMatch(payloadFn, /xml_autorizado/);
  });

  it('11. não copia status autorizado', () => {
    const src = fs.readFileSync(path.join(ROOT, 'backend/services/fiscal/duplicarDevolucaoCompra.js'), 'utf8');
    assert.match(src, /status: rascunho\.status/);
    assert.match(src, /STATUS_PERMITIDOS/);
  });

  it('12. recalcula totais (não copia vNF)', () => {
    const tot = recalcularTotaisRascunho([
      itemDev(1, { quantidade: 4, valor_unitario: 12.63 }),
      itemDev(2, { quantidade: 4, valor_unitario: 5.69 }),
      itemDev(3, { quantidade: 1, valor_unitario: 44.33 })
    ]);
    assert.equal(tot.vProd, 117.61);
  });

  it('13. alterar valor unitário', () => {
    const a = recalcularItemRascunho({ quantidade: 4, valor_unitario: 15.88 });
    const b = recalcularItemRascunho({ quantidade: 4, valor_unitario: 12.63 });
    assert.equal(a.valor_total, 63.52);
    assert.equal(b.valor_unitario, 12.63);
  });

  it('14. recalcular valor total do item', () => {
    assert.equal(recalcularItemRascunho({ quantidade: 4, valor_unitario: 12.63 }).valor_total, 50.52);
    assert.equal(recalcularItemRascunho({ quantidade: 4, valor_unitario: 5.69 }).valor_total, 22.76);
    assert.equal(recalcularItemRascunho({ quantidade: 1, valor_unitario: 44.33 }).valor_total, 44.33);
  });

  it('15. impostos nascem do recálculo do builder (qtd × vUn)', () => {
    const built = buildXmlNFeDevolucaoCompra({
      config: configBase,
      compra: {
        id: 2,
        chave_acesso: CHAVE_ORIGEM,
        fornecedor: 'UZZY IMPORTACAO E DISTRIBUICAO LTDA',
        fornecedor_cnpj: '07670414000258',
        cidade: 'Juazeiro do Norte',
        uf: 'CE',
        csosn_cst: '102',
        cst_pis: '07',
        cst_cofins: '07'
      },
      itens: [
        itemDev(1, { quantidade: 4, valor_unitario: 12.63, nItemOrigem: 7 }),
        itemDev(2, { quantidade: 4, valor_unitario: 5.69, nItemOrigem: 8 })
      ],
      numero: 1
    });
    assert.match(built.xmlSemAssinatura, /<vProd>50\.52<\/vProd>/);
    assert.match(built.xmlSemAssinatura, /<vProd>22\.76<\/vProd>/);
    assert.doesNotMatch(built.xmlSemAssinatura, new RegExp(CHAVE_NF100));
  });

  it('16. preserva vínculo com NF original (chave 15.860)', () => {
    const built = buildXmlNFeDevolucaoCompra({
      config: configBase,
      compra: {
        id: 2,
        chave_acesso: CHAVE_ORIGEM,
        fornecedor: 'UZZY',
        fornecedor_cnpj: '07670414000258',
        cidade: 'Juazeiro do Norte',
        uf: 'CE',
        csosn_cst: '102',
        cst_pis: '07',
        cst_cofins: '07'
      },
      itens: [itemDev(1, { nItemOrigem: 12, quantidade: 1, valor_unitario: 1 })],
      numero: 1
    });
    assert.match(built.xmlSemAssinatura, new RegExp(`<refNFe>${CHAVE_ORIGEM}</refNFe>`));
    assert.doesNotMatch(built.xmlSemAssinatura, new RegExp(CHAVE_NF100));
  });

  it('17. gera NFref da compra original (sem DFeReferenciado)', () => {
    const built = buildXmlNFeDevolucaoCompra({
      config: configBase,
      compra: {
        id: 2,
        chave_acesso: CHAVE_ORIGEM,
        fornecedor: 'UZZY',
        fornecedor_cnpj: '07670414000258',
        cidade: 'Juazeiro do Norte',
        uf: 'CE',
        csosn_cst: '102',
        cst_pis: '07',
        cst_cofins: '07'
      },
      itens: [itemDev(1, { nItemOrigem: 3, quantidade: 1, valor_unitario: 1 })],
      numero: 1
    });
    assert.match(built.xmlSemAssinatura, /<NFref>/);
    assert.match(built.xmlSemAssinatura, new RegExp(`<refNFe>${CHAVE_ORIGEM}</refNFe>`));
    assert.doesNotMatch(built.xmlSemAssinatura, /<DFeReferenciado>/);
  });

  it('18. utiliza nItem da NF original (não a posição da NF 100)', () => {
    const built = buildXmlNFeDevolucaoCompra({
      config: configBase,
      compra: {
        id: 2,
        chave_acesso: CHAVE_ORIGEM,
        fornecedor: 'UZZY',
        fornecedor_cnpj: '07670414000258',
        cidade: 'Juazeiro do Norte',
        uf: 'CE',
        csosn_cst: '102',
        cst_pis: '07',
        cst_cofins: '07'
      },
      itens: [itemDev(1, { nItemOrigem: 27, quantidade: 1, valor_unitario: 1 })],
      numero: 1
    });
    assert.match(built.xmlSemAssinatura, /<det nItem="1">/);
    assert.match(built.xmlSemAssinatura, new RegExp(`<refNFe>${CHAVE_ORIGEM}</refNFe>`));
    assert.doesNotMatch(built.xmlSemAssinatura, /<DFeReferenciado>/);
  });

  it('19. referencia só a NF-e de compra (NFref), sem DFeReferenciado', () => {
    const built = buildXmlNFeDevolucaoCompra({
      config: configBase,
      compra: {
        id: 2,
        chave_acesso: CHAVE_ORIGEM,
        fornecedor: 'UZZY',
        fornecedor_cnpj: '07670414000258',
        cidade: 'Juazeiro do Norte',
        uf: 'CE',
        csosn_cst: '102',
        cst_pis: '07',
        cst_cofins: '07'
      },
      itens: [itemDev(1, { nItemOrigem: 1, quantidade: 1, valor_unitario: 10 })],
      numero: 1
    });
    assert.match(built.xmlSemAssinatura, /<NFref>/);
    assert.match(built.xmlSemAssinatura, new RegExp(`<refNFe>${CHAVE_ORIGEM}</refNFe>`));
    assert.doesNotMatch(built.xmlSemAssinatura, /<DFeReferenciado>/);
  });

  it('20. rollback em caso de erro (transação)', () => {
    const src = fs.readFileSync(path.join(ROOT, 'backend/services/fiscal/duplicarDevolucaoCompra.js'), 'utf8');
    assert.match(src, /BEGIN IMMEDIATE/);
    assert.match(src, /ROLLBACK/);
    assert.match(src, /COMMIT/);
  });

  it('auditoria registra DUPLICACAO_DEVOLUCAO', () => {
    assert.equal(OPERACAO_AUDITORIA, 'DUPLICACAO_DEVOLUCAO');
    const src = fs.readFileSync(path.join(ROOT, 'backend/services/fiscal/duplicarDevolucaoCompra.js'), 'utf8');
    assert.match(src, /documento_original_id/);
    assert.match(src, /novo_documento_id/);
  });

  it('reusa nItem do XML autorizado quando já houver DFeReferenciado', () => {
    const xml = `<NFe><det nItem="2"><prod><DFeReferenciado><chaveAcesso>${CHAVE_ORIGEM}</chaveAcesso><nItem>19</nItem></DFeReferenciado></prod></det></NFe>`;
    assert.equal(extrairNItemOrigemDoXmlAutorizado(xml, 2), 19);
  });

  it('API e UI registram a ação', () => {
    const rotas = fs.readFileSync(path.join(ROOT, 'backend/rotas/compras.js'), 'utf8');
    const nfe = fs.readFileSync(path.join(ROOT, 'backend/rotas/nfe.js'), 'utf8');
    const ui = fs.readFileSync(path.join(ROOT, 'frontend/erp/js/nfe-central.js'), 'utf8');
    assert.match(rotas, /nfe-devolucao\/:notaId\/duplicar/);
    assert.match(nfe, /duplicar-devolucao/);
    assert.match(ui, /Duplicar como Nova Devolução/);
    assert.match(ui, /_duplicandoNfeDevolucao/);
  });

  it('monta XML sem DFeReferenciado mesmo sem nItem da origem', () => {
    const built = buildXmlNFeDevolucaoCompra({
      config: configBase,
      compra: {
        id: 2,
        chave_acesso: CHAVE_ORIGEM,
        fornecedor: 'X',
        fornecedor_cnpj: '07670414000258',
        cidade: 'Juazeiro do Norte',
        uf: 'CE',
        csosn_cst: '102',
        cst_pis: '07',
        cst_cofins: '07'
      },
      itens: [{ produto_nome: 'A', quantidade: 1, valor_unitario: 1, ncm: '82041100', csosn: '102' }],
      numero: 1
    });
    assert.match(built.xmlSemAssinatura, new RegExp(`<refNFe>${CHAVE_ORIGEM}</refNFe>`));
    assert.doesNotMatch(built.xmlSemAssinatura, /<DFeReferenciado>/);
  });
});
