/**
 * RC5 — NF-e Devolução de Venda (cliente → empresa).
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { buildXmlNFeDevolucaoVenda } = require('../../backend/services/fiscal/xmlBuilderNfeDevolucaoVenda');
const {
  STATUS,
  statusDoSaldo,
  validarQuantidadesContraSaldo,
  round3
} = require('../../backend/services/fiscal/controleSaldoDevolucaoVenda');
const {
  podeReenviarDevolucao,
  podeCancelarDevolucao,
  mensagemRejeicaoDetalhada
} = require('../../backend/services/fiscal/nfeDevolucaoEstados');
const { ORIGENS, resolverContexto } = require('../../backend/services/fiscal/nfeDevolucaoOrigem');
const { parseRetornoAutorizacaoNfe } = require('../../backend/services/fiscal/nfeRetornoAutorizacao');

const CHAVE44 = '23250612345678000190550010000000011000000010';

function configBase() {
  return {
    codigoUf: '23',
    uf: 'CE',
    cnpj: '12345678000190',
    ie: '123456789',
    crt: 1,
    ambiente: 2,
    serie: 1,
    municipioCodigo: '2304400',
    municipioNome: 'FORTALEZA',
    nomeEmpresa: 'EMPRESA TESTE LTDA',
    logradouro: 'RUA A',
    numero: '100',
    bairro: 'CENTRO',
    cep: '60000000',
    telefone: '85999999999'
  };
}

function vendaBase() {
  return {
    id: 10,
    chave_acesso: CHAVE44,
    cliente_nome: 'CLIENTE TESTE',
    cliente_cpf: '52998224725',
    cliente_rua: 'RUA B',
    cliente_numero: '50',
    cliente_bairro: 'ALDEOTA',
    cliente_cidade: 'FORTALEZA',
    cliente_uf: 'CE',
    cliente_cep: '60150000'
  };
}

function itemEspelhado(qtd = 1) {
  return {
    venda_item_id: 1,
    produto_id: 1,
    produto_nome: 'PRODUTO A',
    produto_codigo: 'SKU1',
    ncm: '22021000',
    unidade: 'UN',
    quantidade: qtd,
    valor_unitario: 10,
    cfop: '1202',
    csosn: '102',
    cst_pis: '49',
    cst_cofins: '49',
    impostoEspelhadoXml: `<ICMS><ICMSSN102><orig>0</orig><CSOSN>102</CSOSN></ICMSSN102></ICMS>
      <PIS><PISOutr><CST>49</CST><vBC>10.00</vBC><pPIS>0.00</pPIS><vPIS>0.00</vPIS></PISOutr></PIS>
      <COFINS><COFINSOutr><CST>49</CST><vBC>10.00</vBC><pCOFINS>0.00</pCOFINS><vCOFINS>0.00</vCOFINS></COFINSOutr></COFINS>`,
    tributosEspelhados: {
      icms: { CSOSN: '102', orig: '0' },
      pis: { CST: '49', vBC: 10, pPIS: 0, vPIS: 0 },
      cofins: { CST: '49', vBC: 10, pCOFINS: 0, vCOFINS: 0 }
    }
  };
}

describe('RC5 — builder devolução venda', () => {
  it('gera finNFe=4, tpNF=0, natOp e NFref', () => {
    const built = buildXmlNFeDevolucaoVenda({
      config: configBase(),
      venda: vendaBase(),
      itens: [itemEspelhado(2)],
      numero: 55
    });
    assert.equal(built.finNFe, 4);
    assert.equal(built.tpNF, 0);
    assert.equal(built.natOp, 'DEVOLUCAO DE VENDA');
    assert.equal(built.origem, 'VENDA');
    assert.equal(built.refNFe, CHAVE44);
    assert.match(built.xmlSemAssinatura, /<finNFe>4<\/finNFe>/);
    assert.match(built.xmlSemAssinatura, /<tpNF>0<\/tpNF>/);
    assert.match(built.xmlSemAssinatura, new RegExp(`<refNFe>${CHAVE44}</refNFe>`));
    assert.match(built.xmlSemAssinatura, /<CFOP>1202<\/CFOP>/);
    assert.match(built.xmlSemAssinatura, /<CPF>52998224725<\/CPF>/);
  });

  it('exige chave 44 e documento do cliente', () => {
    assert.throws(() => buildXmlNFeDevolucaoVenda({
      config: configBase(),
      venda: { ...vendaBase(), chave_acesso: '123' },
      itens: [itemEspelhado()],
      numero: 1
    }), /chave/i);

    assert.throws(() => buildXmlNFeDevolucaoVenda({
      config: configBase(),
      venda: { ...vendaBase(), cliente_cpf: '' },
      itens: [itemEspelhado()],
      numero: 1
    }), /CPF|CNPJ|documento/i);
  });
});

describe('RC5 — saldo devolução venda', () => {
  it('status parcial/total', () => {
    assert.equal(statusDoSaldo({ quantidadeVendida: 100, quantidadeDevolvida: 0, saldo: 100 }), STATUS.NAO_DEVOLVIDO);
    assert.equal(statusDoSaldo({ quantidadeVendida: 100, quantidadeDevolvida: 40, saldo: 60 }), STATUS.PARCIAL);
    assert.equal(statusDoSaldo({ quantidadeVendida: 100, quantidadeDevolvida: 100, saldo: 0 }), STATUS.TOTAL);
  });

  it('múltiplas devoluções parciais e reabertura', () => {
    let saldo = 100;
    const emitir = (q) => {
      if (q > saldo + 1e-9) return false;
      saldo = round3(saldo - q);
      return true;
    };
    const cancelar = (q) => { saldo = round3(saldo + q); };

    assert.equal(emitir(30), true);
    assert.equal(emitir(20), true);
    assert.equal(emitir(50), true);
    assert.equal(saldo, 0);
    assert.equal(emitir(1), false);
    cancelar(50);
    assert.equal(saldo, 50);
    assert.equal(emitir(50), true);
  });

  it('validarQuantidadesContraSaldo bloqueia excesso', () => {
    const saldos = {
      itens: [{
        venda_item_id: 1,
        produto_nome: 'A',
        quantidade_vendida: 10,
        quantidade_devolvida: 0,
        saldo: 10
      }]
    };
    const bad = validarQuantidadesContraSaldo({
      saldos,
      itensSolicitados: [{ venda_item_id: 1, quantidade: 11 }]
    });
    assert.equal(bad.ok, false);
    const ok = validarQuantidadesContraSaldo({
      saldos,
      itensSolicitados: [{ venda_item_id: 1, quantidade: 5 }]
    });
    assert.equal(ok.ok, true);
  });
});

describe('RC5 — lifecycle compartilhado', () => {
  it('origem VENDA no contexto', () => {
    assert.equal(ORIGENS.VENDA, 'venda');
    const ctx = resolverContexto('venda');
    assert.equal(ctx.tabelaNotas, 'nfe_devolucoes_venda');
    assert.equal(ctx.fkOrigem, 'venda_id');
  });

  it('reenvio e cancelamento seguros', () => {
    assert.equal(podeReenviarDevolucao({ status: 'rejeitada' }), true);
    assert.equal(podeReenviarDevolucao({ status: 'autorizada' }), false);
    assert.equal(podeCancelarDevolucao({ status: 'autorizada' }), true);
  });

  it('rejeição detalhada', () => {
    const xml = `<retEnviNFe><cStat>104</cStat><protNFe><infProt>
      <cStat>539</cStat><xMotivo>Duplicidade de NF-e</xMotivo>
    </infProt></protNFe></retEnviNFe>`;
    const p = parseRetornoAutorizacaoNfe(xml);
    assert.equal(p.status, 'rejeitada');
    assert.match(mensagemRejeicaoDetalhada(p.cStat, p.xMotivo), /Rejeição 539/);
  });
});
