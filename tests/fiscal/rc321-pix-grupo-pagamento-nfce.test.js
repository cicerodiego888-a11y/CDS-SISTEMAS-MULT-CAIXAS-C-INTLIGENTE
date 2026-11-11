/**
 * Regressão do grupo de pagamento PIX na NFC-e (modelo 65).
 *
 * Regras:
 *  - PIX com TEF (integrado): <card><tpIntegra>1</tpIntegra><CNPJ>...</CNPJ><cAut>...</cAut></card>
 *  - PIX sem TEF: <card><tpIntegra>2</tpIntegra></card>
 *  - Cartão com TEF: <card><tpIntegra>1</tpIntegra>...
 *  - Cartão sem TEF: <card><tpIntegra>2</tpIntegra></card>
 *  - Não inventar CNPJ para PIX (sem fallback Cielo).
 *
 * Executar: node --test tests/fiscal/rc321-pix-grupo-pagamento-nfce.test.js
 */
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  buildNfceXml,
  montarPagamentos,
  mapearFormaPagamento,
  validarVinculoTefPagamentos
} = require('../../backend/services/fiscal/xmlBuilder');
const {
  validarPagamentosETroco,
  validarXmlFiscal
} = require('../../backend/services/fiscal/validarXmlFiscal');

function extrairTag(xml, tag) {
  const re = new RegExp(`<${tag}>([^<]*)</${tag}>`, 'i');
  const m = xml.match(re);
  return m ? m[1] : null;
}

function temTag(xml, tag) {
  return new RegExp(`<${tag}>`, 'i').test(xml);
}

function extrairDetalhesPagamento(xml) {
  return xml.match(/<detPag(?:\s[^>]*)?>[\s\S]*?<\/detPag>/g) || [];
}

describe('RC3.21 — mapearFormaPagamento', () => {
  it('PIX e PIX_TEF mapeiam para tPag=17', () => {
    assert.equal(mapearFormaPagamento('pix'), '17');
    assert.equal(mapearFormaPagamento('pix_tef'), '17');
  });

  it('cartões mapeiam corretamente', () => {
    assert.equal(mapearFormaPagamento('cartao_credito'), '03');
    assert.equal(mapearFormaPagamento('cartao_debito'), '04');
    assert.equal(mapearFormaPagamento('dinheiro'), '01');
  });
});

describe('RC3.21 — Cenário 1: PIX sem TEF emite integração não integrada', () => {
  it('PIX por chave emite card com tpIntegra=2 sem dados TEF inventados', () => {
    const pagamentos = [{ forma_pagamento: 'pix', valor: 3.5 }];
    const xml = montarPagamentos(pagamentos);

    assert.match(xml, /<tPag>17<\/tPag>/);
    assert.match(xml, /<vPag>3\.50<\/vPag>/);
    assert.match(xml, /<card>\s*<tpIntegra>2<\/tpIntegra>\s*<\/card>/);
    assert.equal(temTag(xml, 'CNPJ'), false);
    assert.equal(temTag(xml, 'cAut'), false);
  });

  it('PIX genérico sem TEF mantém card com tpIntegra=2', () => {
    const pagamentos = [{ forma_pagamento: 'pix', valor: 100, tipo_recebimento: 'fiscal' }];
    const xml = montarPagamentos(pagamentos);

    assert.match(xml, /<tPag>17<\/tPag>[\s\S]*?<card>\s*<tpIntegra>2<\/tpIntegra>\s*<\/card>/);
  });
});

describe('RC3.21 — Cenário 2: PIX com TEF (integrado) emite <card> com tpIntegra=1', () => {
  it('PIX TEF com CNPJ e autorização emite dados reais', () => {
    const pagamentos = [{
      forma_pagamento: 'pix_tef',
      valor: 50,
      tef: {
        transacao_id: 'PIX-1',
        status: 'aprovado',
        cnpj_credenciadora: '12345678000190',
        autorizacao: 'E1234567890123456789'
      }
    }];
    const xml = montarPagamentos(pagamentos);

    assert.match(xml, /<tPag>17<\/tPag>/);
    assert.match(xml, /<tpIntegra>1<\/tpIntegra>/);
    assert.match(xml, /<CNPJ>12345678000190<\/CNPJ>/);
    assert.match(xml, /<cAut>E1234567890123456789<\/cAut>/);
    // PIX não deve ter tBand
    assert.equal(temTag(xml, 'tBand'), false);
  });

  it('PIX TEF sem CNPJ não inventa CNPJ (sem fallback Cielo)', () => {
    const pagamentos = [{
      forma_pagamento: 'pix_tef',
      valor: 50,
      tef: { transacao_id: 'PIX-2', status: 'aprovado', autorizacao: 'AUTH123' }
    }];
    const xml = montarPagamentos(pagamentos);

    assert.match(xml, /<tpIntegra>1<\/tpIntegra>/);
    assert.equal(temTag(xml, 'CNPJ'), false, 'PIX sem CNPJ real não deve emitir CNPJ');
    assert.match(xml, /<cAut>AUTH123<\/cAut>/);
  });

  it('PIX TEF com cnpj_instituicao usa o campo correto', () => {
    const pagamentos = [{
      forma_pagamento: 'pix_tef',
      valor: 25,
      tef: { transacao_id: 'PIX-3', status: 'aprovado', cnpj_instituicao: '08926189000190', autorizacao: 'PIX001' }
    }];
    const xml = montarPagamentos(pagamentos);

    assert.match(xml, /<CNPJ>08926189000190<\/CNPJ>/);
    assert.match(xml, /<cAut>PIX001<\/cAut>/);
  });
});

describe('RC3.21 — Cenário 3: Cartão integrado (com TEF)', () => {
  it('cartão crédito com TEF emite tpIntegra=1, CNPJ, tBand, cAut', () => {
    const pagamentos = [{
      forma_pagamento: 'cartao_credito',
      valor: 100,
      tef: {
        transacao_id: 'CR-1',
        status: 'aprovado',
        cnpj_credenciadora: '12345678000190',
        bandeira: 'VISA',
        autorizacao: 'AUTH999'
      }
    }];
    const xml = montarPagamentos(pagamentos);

    assert.match(xml, /<tPag>03<\/tPag>/);
    assert.match(xml, /<tpIntegra>1<\/tpIntegra>/);
    assert.match(xml, /<CNPJ>12345678000190<\/CNPJ>/);
    assert.match(xml, /<tBand>01<\/tBand>/);
    assert.match(xml, /<cAut>AUTH999<\/cAut>/);
  });

  it('cartão débito integrado preserva dados reais e não usa NSU como autorização', () => {
    const pagamentos = [{
      forma_pagamento: 'cartao_debito',
      valor: 50,
      tef: {
        transacao_id: 'DB-1',
        status: 'aprovado',
        bandeira: 'ELO',
        nsu: '123456',
        autorizacao: 'AUT456',
        cnpj_credenciadora: '12345678000190'
      }
    }];
    const xml = montarPagamentos(pagamentos);

    assert.match(xml, /<tPag>04<\/tPag>/);
    assert.match(xml, /<tpIntegra>1<\/tpIntegra>/);
    assert.match(xml, /<tBand>06<\/tBand>/);
    assert.match(xml, /<CNPJ>12345678000190<\/CNPJ>/);
    assert.match(xml, /<cAut>AUT456<\/cAut>/);
    assert.doesNotMatch(xml, /<cAut>123456<\/cAut>/);
  });
});

describe('RC3.21 — Cenário 4: Cartão não integrado (sem TEF)', () => {
  it('cartão sem TEF emite tpIntegra=2 sem CNPJ/cAut/tBand', () => {
    const pagamentos = [{ forma_pagamento: 'cartao_credito', valor: 80 }];
    const xml = montarPagamentos(pagamentos);

    assert.match(xml, /<tPag>03<\/tPag>/);
    assert.match(xml, /<tpIntegra>2<\/tpIntegra>/);
    assert.equal(temTag(xml, 'CNPJ'), false);
    assert.equal(temTag(xml, 'cAut'), false);
    assert.equal(temTag(xml, 'tBand'), false);
  });

  it('cartão débito sem TEF também emite tpIntegra=2', () => {
    const pagamentos = [{ forma_pagamento: 'cartao_debito', valor: 40 }];
    const xml = montarPagamentos(pagamentos);

    assert.match(xml, /<tPag>04<\/tPag>/);
    assert.match(xml, /<tpIntegra>2<\/tpIntegra>/);
  });
});

describe('RC3.21 — Cenário 5: Dinheiro não emite <card>', () => {
  it('pagamento em dinheiro não tem grupo <card>', () => {
    const pagamentos = [{ forma_pagamento: 'dinheiro', valor: 200 }];
    const xml = montarPagamentos(pagamentos);

    assert.match(xml, /<tPag>01<\/tPag>/);
    assert.equal(temTag(xml, 'card'), false);
    assert.equal(temTag(xml, 'tpIntegra'), false);
  });
});

describe('RC3.21 — Cenário 6: Validação estrutural do XML gerado', () => {
  it('XML começa com <pag> e termina com </pag>', () => {
    const pagamentos = [{ forma_pagamento: 'pix', valor: 10 }];
    const xml = montarPagamentos(pagamentos);

    assert.match(xml.trim(), /^<pag>/);
    assert.match(xml.trim(), /<\/pag>$/);
  });

  it('cada pagamento tem <detPag> com tPag e vPag', () => {
    const pagamentos = [
      { forma_pagamento: 'dinheiro', valor: 10 },
      { forma_pagamento: 'pix', valor: 20 }
    ];
    const xml = montarPagamentos(pagamentos);

    const detPagCount = (xml.match(/<detPag>/g) || []).length;
    assert.equal(detPagCount, 2);
    assert.match(xml, /<tPag>01<\/tPag>[\s\S]*?<vPag>10\.00<\/vPag>/);
    assert.match(xml, /<tPag>17<\/tPag>[\s\S]*?<vPag>20\.00<\/vPag>/);
  });

  it('PIX não recebe fallback de CNPJ da Cielo', () => {
    const pagamentos = [{
      forma_pagamento: 'pix_tef',
      valor: 10,
      tef: { transacao_id: 'PIX-4', status: 'aprovado', autorizacao: 'X' }
    }];
    const xml = montarPagamentos(pagamentos);

    assert.equal(xml.includes('01425787000104'), false, 'PIX não deve usar CNPJ fixo como fallback');
  });

  it('cartão integrado sem CNPJ não presume credenciadora', () => {
    const pagamentos = [{
      forma_pagamento: 'cartao_credito',
      valor: 10,
      tef: { transacao_id: 'CR-2', status: 'aprovado', bandeira: 'VISA', autorizacao: 'Y' }
    }];
    const xml = montarPagamentos(pagamentos);

    assert.match(xml, /<tpIntegra>1<\/tpIntegra>/);
    assert.equal(temTag(xml, 'CNPJ'), false);
    assert.equal(xml.includes('01425787000104'), false);
  });
});

describe('RC3.23 — vínculo por recebimento e validação do XML final', () => {
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

  function construirNfce(pagamentos) {
    return buildNfceXml({
      config,
      venda: {
        total: pagamentos.reduce((total, p) => total + p.valor, 0),
        forma_pagamento: 'misto',
        pagamentos
      },
      itens: [{
        produto_id: 1,
        produto_nome: 'ITEM TESTE',
        quantidade: 1,
        quantidade_fiscal: 1,
        quantidade_nao_fiscal: 0,
        preco_unitario: pagamentos.reduce((total, p) => total + p.valor, 0),
        valor_fiscal: pagamentos.reduce((total, p) => total + p.valor, 0),
        valor_nao_fiscal: 0,
        produto_ncm: '10063021',
        cfop: '5102',
        unidade: 'UN',
        origem: 0,
        csosn: '102'
      }],
      numero: 1
    }).xmlSemAssinatura;
  }

  function blocoPagamento(xml) {
    const match = xml.match(/<pag>([\s\S]*?)<\/pag>/);
    return match ? match[1] : '';
  }

  it('emite pagamentos mistos sem propagar os dados TEF da venda a outro recebimento', () => {
    const xml = montarPagamentos([
      { forma_pagamento: 'cartao_credito', valor: 30 },
      {
        forma_pagamento: 'cartao_debito',
        valor: 70,
        tef_transacao_id: 321,
        tef: { transacao_id: '321', status: 'aprovado', cnpj_credenciadora: '12345678000190', autorizacao: 'D321' }
      }
    ]);
    const partes = xml.split('<detPag>');

    assert.match(partes[1], /<tpIntegra>2<\/tpIntegra>/);
    assert.doesNotMatch(partes[1], /12345678000190|D321/);
    assert.match(partes[2], /<tpIntegra>1<\/tpIntegra>/);
    assert.match(partes[2], /<CNPJ>12345678000190<\/CNPJ>/);
    assert.match(partes[2], /<cAut>D321<\/cAut>/);
  });

  it('não atribui uma transação global a um recebimento sem vínculo', () => {
    const xml = montarPagamentos(
      [{ forma_pagamento: 'cartao_credito', valor: 100 }],
      { tef: { id: 322, status: 'aprovado', autorizacao: 'LEG322' } }
    );

    assert.match(xml, /<tpIntegra>2<\/tpIntegra>/);
    assert.doesNotMatch(xml, /LEG322/);
  });

  it('marca pendência quando o ID vinculado não corresponde ao ID dos metadados', () => {
    const pendencia = validarVinculoTefPagamentos([{
      forma_pagamento: 'cartao_credito',
      valor: 30,
      tef_transacao_id: 323,
      tef: { transacao_id: '324', status: 'aprovado' }
    }]);

    assert.equal(pendencia.code, 'XML_PAGAMENTO_TEF_ID_DIVERGENTE');
  });

  it('marca pendência quando o recebimento aponta para TEF sem aprovação recuperável', () => {
    const pendencia = validarVinculoTefPagamentos([{
      forma_pagamento: 'cartao_debito',
      valor: 30,
      tef_transacao_id: 325,
      tef_status: 'pendente'
    }]);

    assert.equal(pendencia.code, 'XML_PAGAMENTO_TEF_NAO_APROVADO');
  });

  it('retorna pendência para TEF aprovado sem recebimento vinculado', () => {
    const pendencia = validarVinculoTefPagamentos([
      { forma_pagamento: 'cartao_credito', valor: 30 },
      { forma_pagamento: 'dinheiro', valor: 70 }
    ], [{ status: 'aprovado', id: 323 }]);

    assert.equal(pendencia.status, 'pendente_dados_pagamento');
    assert.equal(pendencia.code, 'XML_PAGAMENTO_TEF_SEM_VINCULO');
  });

  it('o XML NFC-e final mantém CNPJ real; cartão integrado sem CNPJ é bloqueado localmente (51.54)', () => {
    const xmlSemCnpj = construirNfce([{
      forma_pagamento: 'cartao_credito',
      valor: 15,
      tef_transacao_id: 7,
      tef: { transacao_id: '7', status: 'aprovado', nsu: 'NSU7', bandeira: 'VISA' }
    }]);
    const xmlComCnpj = construirNfce([{
      forma_pagamento: 'cartao_debito',
      valor: 15,
      tef_transacao_id: 8,
      tef: { transacao_id: '8', status: 'aprovado', cnpj_credenciadora: '12345678000190', autorizacao: 'AUT8' }
    }]);

    assert.match(xmlSemCnpj, /<tpIntegra>1<\/tpIntegra>/);
    assert.equal(blocoPagamento(xmlSemCnpj).includes('<CNPJ>'), false);
    assert.equal(blocoPagamento(xmlSemCnpj).includes('01425787000104'), false);
    assert.match(xmlComCnpj, /<CNPJ>12345678000190<\/CNPJ>/);
    assert.equal(blocoPagamento(xmlComCnpj).includes('01425787000104'), false);
    // TEF-DESTAXA-51.54 — anti cStat 392: cartão tpIntegra=1 sem CNPJ não segue para SEFAZ
    assert.throws(
      () => validarXmlFiscal({
        xml: xmlSemCnpj,
        fase: 'pre_assinatura',
        modeloDoc: '65',
        validarXsd: true
      }),
      (err) => err && err.code === 'XML_PAGAMENTO_CNPJ_CREDENCIADORA_AUSENTE'
    );
    assert.doesNotThrow(() => validarXmlFiscal({
      xml: xmlComCnpj,
      fase: 'pre_assinatura',
      modeloDoc: '65',
      validarXsd: true
    }));
  });

  it('bloqueia XML com grupo card sem tpIntegra obrigatório', () => {
    assert.throws(
      () => validarPagamentosETroco(
        '<pag><detPag><card></card><vPag>10.00</vPag></detPag></pag>',
        { vNF: 10, vTroco: 0 }
      ),
      (error) => error.code === 'XML_PAGAMENTO_TPINTEGRA_AUSENTE'
    );
  });

  it('valida PIX sem TEF com tpIntegra=2 e preserva os dados explícitos do PIX integrado', () => {
    const pixManual = construirNfce([{ forma_pagamento: 'pix', valor: 15 }]);
    const pagamentosPixManual = montarPagamentos([{ forma_pagamento: 'pix', valor: 15 }]);
    const pixIntegrado = construirNfce([{
      forma_pagamento: 'pix_tef',
      valor: 15,
      tef_transacao_id: 9,
      tef: { transacao_id: '9', status: 'aprovado', cnpj_instituicao: '12345678000190', autorizacao: 'PIX9' }
    }]);

    assert.match(pixManual, /<tPag>17<\/tPag>/);
    assert.match(blocoPagamento(pixManual), /<card>\s*<tpIntegra>2<\/tpIntegra>\s*<\/card>/);
    assert.doesNotMatch(blocoPagamento(pixManual), /<CNPJ>|<cAut>|01425787000104/);
    assert.doesNotThrow(() => validarPagamentosETroco(pagamentosPixManual, { vNF: 15, vTroco: 0 }));
    assert.doesNotThrow(() => validarXmlFiscal({
      xml: pixManual,
      fase: 'pre_assinatura',
      modeloDoc: '65',
      validarXsd: true
    }));
    assert.match(pixIntegrado, /<tpIntegra>1<\/tpIntegra>/);
    assert.match(pixIntegrado, /<CNPJ>12345678000190<\/CNPJ>/);
    assert.match(pixIntegrado, /<cAut>PIX9<\/cAut>/);
  });
});

describe('RC3.21 — Cenário 7: Não invenção de dados de transação', () => {
  it('PIX TEF sem autorização não emite cAut', () => {
    const pagamentos = [{
      forma_pagamento: 'pix_tef',
      valor: 10,
      tef: { transacao_id: 'PIX-5', status: 'aprovado', cnpj_credenciadora: '12345678000190' }
    }];
    const xml = montarPagamentos(pagamentos);

    assert.match(xml, /<tpIntegra>1<\/tpIntegra>/);
    assert.match(xml, /<CNPJ>12345678000190<\/CNPJ>/);
    assert.equal(temTag(xml, 'cAut'), false, 'Não deve inventar cAut');
  });

  it('PIX manual não emite cAut nem CNPJ', () => {
    const pagamentos = [{ forma_pagamento: 'pix', valor: 10 }];
    const xml = montarPagamentos(pagamentos);

    assert.equal(temTag(xml, 'cAut'), false);
    assert.equal(temTag(xml, 'CNPJ'), false);
  });
});

describe('RC3.21 — Cenário 8: Pagamento misto (dinheiro + PIX)', () => {
  it('dinheiro não tem card e PIX sem TEF tem apenas tpIntegra=2', () => {
    const pagamentos = [
      { forma_pagamento: 'dinheiro', valor: 50 },
      { forma_pagamento: 'pix', valor: 50 }
    ];
    const xml = montarPagamentos(pagamentos);

    const detPagCount = (xml.match(/<detPag>/g) || []).length;
    assert.equal(detPagCount, 2);
    const [dinheiro, pix] = extrairDetalhesPagamento(xml);
    assert.doesNotMatch(dinheiro, /<card>|<tpIntegra>/);
    assert.match(dinheiro, /<tPag>01<\/tPag>[\s\S]*?<vPag>50\.00<\/vPag>/);
    assert.match(pix, /<tPag>17<\/tPag>[\s\S]*?<vPag>50\.00<\/vPag>/);
    assert.match(pix, /<card>\s*<tpIntegra>2<\/tpIntegra>\s*<\/card>/);
    assert.equal(temTag(pix, 'CNPJ'), false);
    assert.equal(temTag(pix, 'cAut'), false);
  });

  it('cartão + PIX TEF emitem <card> apenas para cartão sem TEF e PIX com TEF', () => {
    const pagamentos = [
      { forma_pagamento: 'cartao_credito', valor: 30 },
      {
        forma_pagamento: 'pix_tef',
        valor: 70,
        tef: { transacao_id: 'PIX-6', status: 'aprovado', cnpj_credenciadora: '12345678000190', autorizacao: 'PIX1' }
      }
    ];
    const xml = montarPagamentos(pagamentos);

    // Cartão sem TEF → tpIntegra=2
    assert.match(xml, /<tPag>03<\/tPag>[\s\S]*?<tpIntegra>2<\/tpIntegra>/);
    // PIX com TEF → tpIntegra=1 com CNPJ
    assert.match(xml, /<tPag>17<\/tPag>[\s\S]*?<tpIntegra>1<\/tpIntegra>[\s\S]*?<CNPJ>12345678000190<\/CNPJ>/);
  });
});
