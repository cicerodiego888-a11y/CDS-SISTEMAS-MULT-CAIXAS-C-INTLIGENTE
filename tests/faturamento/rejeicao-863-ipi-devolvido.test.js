/**
 * Rejeição SEFAZ 863: ICMSTot/vIPIDevol deve ser a soma dos
 * det/impostoDevol/IPI/vIPIDevol (valores já arredondados por item).
 */
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  calcularIpiDevolucaoItem,
  arredondarMoeda,
  somarMoeda,
  toCentavos,
  calcularVNFSefaz
} = require('../../backend/services/fiscal/modeloTotais');
const {
  buildXmlNFeDevolucaoCompra
} = require('../../backend/services/fiscal/xmlBuilderNfeDevolucaoCompra');
const {
  validarXmlFiscal,
  extrairTotais,
  somarVipiDevolItensDoXml,
  validarIpiDevolvidoNoXml
} = require('../../backend/services/fiscal/validarXmlFiscal');
const {
  podeReenviarDevolucao
} = require('../../backend/services/fiscal/nfeDevolucaoEstados');

const CHAVE44 = '23240165957340000150550010000001231000001234';

const configBase = {
  codigoUf: '23',
  cnpj: '65957340000150',
  ie: '073252638',
  crt: 3,
  ambiente: 2,
  serie: 1,
  nomeEmpresa: 'EMPRESA TESTE CDS',
  logradouro: 'RUA A',
  numero: '100',
  bairro: 'CENTRO',
  municipioCodigo: '2307304',
  municipioNome: 'JUAZEIRO DO NORTE',
  uf: 'CE',
  cep: '63000000',
  telefone: '88999999999'
};

const compraBase = {
  id: 2,
  chave_acesso: CHAVE44,
  fornecedor: 'FORNECEDOR TESTE LTDA',
  fornecedor_cnpj: '12345678000199',
  cidade: 'Juazeiro do Norte',
  uf: 'CE'
};

function impostoIpi(vIpi) {
  return `
    <ICMS><ICMS00>
      <orig>0</orig><CST>00</CST><modBC>3</modBC>
      <vBC>0.00</vBC><pICMS>0.0000</pICMS><vICMS>0.00</vICMS>
    </ICMS00></ICMS>
    ${vIpi > 0
      ? `<IPI><cEnq>999</cEnq><IPITrib>
      <CST>50</CST><vBC>0.00</vBC><pIPI>0.0000</pIPI><vIPI>${Number(vIpi).toFixed(2)}</vIPI>
    </IPITrib></IPI>`
      : `<IPI><cEnq>999</cEnq><IPINT><CST>51</CST></IPINT></IPI>`}
    <PIS><PISNT><CST>07</CST></PISNT></PIS>
    <COFINS><COFINSNT><CST>07</CST></COFINSNT></COFINS>`;
}

function itemDev({
  codigo,
  quantidade,
  quantidadeOriginal,
  valorUnitario = 10,
  vIpiOriginal = 0,
  vIpiJaRateado
}) {
  const vIpi = vIpiJaRateado != null ? vIpiJaRateado : vIpiOriginal;
  return {
    produto_id: codigo,
    produto_nome: `PROD ${codigo}`,
    produto_codigo: String(codigo),
    ncm: '22021000',
    unidade: 'UN',
    quantidade,
    quantidade_original: quantidadeOriginal != null ? quantidadeOriginal : quantidade,
    valor_unitario: valorUnitario,
    v_ipi_original: vIpiOriginal,
    v_ipi_devol: vIpi,
    cst: '00',
    tributosEspelhados: {
      origem: 0,
      cst: '00',
      grupoIcms: 'ICMS00',
      icms: { orig: '0', CST: '00', vBC: 0, pICMS: 0, vICMS: 0 },
      ipi: vIpi > 0 ? { CST: '50', vBC: 0, pIPI: 0, vIPI: vIpi } : { CST: '51' },
      pis: { CST: '07' },
      cofins: { CST: '07' }
    },
    impostoEspelhadoXml: impostoIpi(vIpi)
  };
}

function vipiDevolDosItens(xml) {
  const vals = [];
  const re = /<det\s+nItem="(\d+)"[\s\S]*?<\/det>/g;
  let m;
  while ((m = re.exec(xml)) !== null) {
    const g = m[0].match(/<impostoDevol>[\s\S]*?<vIPIDevol>([^<]*)<\/vIPIDevol>/);
    if (g) vals.push({ nItem: Number(m[1]), vIPIDevol: Number(g[1]) });
  }
  return vals;
}

describe('Rejeição 863 — IPI devolvido', () => {
  it('CENÁRIO 1 — devolução total: 10+20+30 = 60.00', () => {
    const built = buildXmlNFeDevolucaoCompra({
      config: configBase,
      compra: compraBase,
      itens: [
        itemDev({ codigo: 'A', quantidade: 1, vIpiOriginal: 10 }),
        itemDev({ codigo: 'B', quantidade: 1, vIpiOriginal: 20 }),
        itemDev({ codigo: 'C', quantidade: 1, vIpiOriginal: 30 })
      ],
      numero: 801
    });
    const xml = built.xmlSemAssinatura;
    const itens = vipiDevolDosItens(xml);
    assert.equal(itens.length, 3);
    assert.equal(itens[0].vIPIDevol, 10);
    assert.equal(itens[1].vIPIDevol, 20);
    assert.equal(itens[2].vIPIDevol, 30);
    const tot = extrairTotais(xml);
    assert.equal(tot.vIPIDevol, 60);
    assert.equal(tot.vIPI, 0);
    assert.equal(somarVipiDevolItensDoXml(xml), 60);
    assert.equal(toCentavos(tot.vIPIDevol), toCentavos(somarVipiDevolItensDoXml(xml)));
    assert.equal(built.diagnosticoIpiDevol.validacao, 'OK');
    assert.doesNotThrow(() => validarXmlFiscal({ xml, modeloDoc: '55' }));
  });

  it('CENÁRIO 2 — devolução parcial: 10/20 de IPI 20.00 → 10.00', () => {
    const calc = calcularIpiDevolucaoItem({
      quantidadeOriginal: 10,
      quantidadeDevolvida: 5,
      vIPIOriginal: 20
    });
    assert.equal(calc.vIPIDevol, 10);
    assert.equal(calc.pDevol, 50);

    const built = buildXmlNFeDevolucaoCompra({
      config: configBase,
      compra: compraBase,
      itens: [itemDev({
        codigo: 'P',
        quantidade: 5,
        quantidadeOriginal: 10,
        vIpiOriginal: 20
      })],
      numero: 802
    });
    const xml = built.xmlSemAssinatura;
    assert.match(xml, /<vIPIDevol>10\.00<\/vIPIDevol>/);
    assert.equal(extrairTotais(xml).vIPIDevol, 10);
    assert.equal(somarVipiDevolItensDoXml(xml), 10);
  });

  it('CENÁRIO 3 — arredondamento: soma dos itens arredondados = total (centavos)', () => {
    const a = calcularIpiDevolucaoItem({
      quantidadeOriginal: 3,
      quantidadeDevolvida: 1,
      vIPIOriginal: 31
    });
    const b = calcularIpiDevolucaoItem({
      quantidadeOriginal: 3,
      quantidadeDevolvida: 1,
      vIPIOriginal: 62
    });
    assert.equal(a.vIPIDevol, 10.33);
    assert.equal(b.vIPIDevol, 20.67);
    const total = somarMoeda([a.vIPIDevol, b.vIPIDevol]);
    assert.equal(total, 31);
    assert.equal(toCentavos(total), toCentavos(a.vIPIDevol) + toCentavos(b.vIPIDevol));

    const built = buildXmlNFeDevolucaoCompra({
      config: configBase,
      compra: compraBase,
      itens: [
        itemDev({ codigo: 'D1', quantidade: 1, quantidadeOriginal: 3, vIpiOriginal: 31 }),
        itemDev({ codigo: 'D2', quantidade: 1, quantidadeOriginal: 3, vIpiOriginal: 62 })
      ],
      numero: 803
    });
    const xml = built.xmlSemAssinatura;
    const itens = vipiDevolDosItens(xml);
    assert.equal(itens[0].vIPIDevol, 10.33);
    assert.equal(itens[1].vIPIDevol, 20.67);
    const tot = extrairTotais(xml);
    assert.equal(tot.vIPIDevol, 31);
    assert.equal(toCentavos(tot.vIPIDevol), toCentavos(somarVipiDevolItensDoXml(xml)));
    assert.doesNotThrow(() => validarXmlFiscal({ xml, modeloDoc: '55' }));
  });

  it('CENÁRIO 4 — item sem IPI não contamina o total', () => {
    const built = buildXmlNFeDevolucaoCompra({
      config: configBase,
      compra: compraBase,
      itens: [
        itemDev({ codigo: 'COM', quantidade: 1, vIpiOriginal: 15 }),
        itemDev({ codigo: 'SEM', quantidade: 2, vIpiOriginal: 0 })
      ],
      numero: 804
    });
    const xml = built.xmlSemAssinatura;
    const itens = vipiDevolDosItens(xml);
    assert.equal(itens.length, 1);
    assert.equal(itens[0].vIPIDevol, 15);
    assert.doesNotMatch(xml, /nItem="2"[\s\S]*?<impostoDevol>/);
    assert.equal(extrairTotais(xml).vIPIDevol, 15);
    assert.equal(somarVipiDevolItensDoXml(xml), 15);
  });

  it('CENÁRIO 5 — total divergente: validarXmlFiscal bloqueia antes da assinatura', () => {
    const built = buildXmlNFeDevolucaoCompra({
      config: configBase,
      compra: compraBase,
      itens: [
        itemDev({ codigo: 'X', quantidade: 1, vIpiOriginal: 10 }),
        itemDev({ codigo: 'Y', quantidade: 1, vIpiOriginal: 20 })
      ],
      numero: 805
    });
    const xmlRuim = built.xmlSemAssinatura.replace(
      /(<ICMSTot>[\s\S]*?)<vIPIDevol>30\.00<\/vIPIDevol>/,
      '$1<vIPIDevol>31.00</vIPIDevol>'
    );
    const tot = extrairTotais(xmlRuim);
    const vNFAjustado = calcularVNFSefaz({ ...tot, vIPIDevol: 31 });
    const xmlInconsistente = xmlRuim.replace(
      /<vNF>[^<]*<\/vNF>/,
      `<vNF>${vNFAjustado.toFixed(2)}</vNF>`
    );
    assert.equal(extrairTotais(xmlInconsistente).vIPIDevol, 31);
    assert.equal(somarVipiDevolItensDoXml(xmlInconsistente), 30);
    assert.throws(
      () => validarIpiDevolvidoNoXml(xmlInconsistente),
      /Total do IPI devolvido inconsistente/
    );
    assert.throws(
      () => validarXmlFiscal({
        xml: xmlInconsistente,
        fase: 'pre_assinatura',
        modeloDoc: '55',
        validarXsd: false
      }),
      (err) => {
        assert.equal(err.code, 'XML_IPI_DEVOL_DIVERGENTE');
        assert.match(err.message, /Total informado: R\$ 31\.00/);
        assert.match(err.message, /Soma dos itens: R\$ 30\.00/);
        return true;
      }
    );
  });

  it('CENÁRIO 6 — devolução mista: total = soma exata dos itens', () => {
    const built = buildXmlNFeDevolucaoCompra({
      config: configBase,
      compra: compraBase,
      itens: [
        itemDev({ codigo: 'T', quantidade: 2, quantidadeOriginal: 2, vIpiOriginal: 8.18 }),
        itemDev({ codigo: 'S', quantidade: 1, vIpiOriginal: 0 }),
        itemDev({
          codigo: 'PAR',
          quantidade: 3,
          quantidadeOriginal: 10,
          vIpiOriginal: 20
        })
      ],
      numero: 806
    });
    const xml = built.xmlSemAssinatura;
    const itens = vipiDevolDosItens(xml);
    const esperadoT = arredondarMoeda(8.18);
    const esperadoPar = calcularIpiDevolucaoItem({
      quantidadeOriginal: 10,
      quantidadeDevolvida: 3,
      vIPIOriginal: 20
    }).vIPIDevol;
    assert.equal(itens.length, 2);
    assert.equal(itens[0].vIPIDevol, esperadoT);
    assert.equal(itens[1].vIPIDevol, esperadoPar);
    const soma = somarMoeda(itens.map((i) => i.vIPIDevol));
    const tot = extrairTotais(xml);
    assert.equal(tot.vIPIDevol, soma);
    assert.equal(toCentavos(tot.vIPIDevol), toCentavos(somarVipiDevolItensDoXml(xml)));
    assert.equal(tot.vNF, calcularVNFSefaz(tot));
    assert.doesNotThrow(() => validarXmlFiscal({ xml, modeloDoc: '55' }));
  });

  it('não reenvia XML rejeitado com cStat 863', () => {
    assert.equal(podeReenviarDevolucao({
      status: 'rejeitada',
      rejeicao_codigo: '863',
      cstat_retorno: '863'
    }), false);
  });
});
