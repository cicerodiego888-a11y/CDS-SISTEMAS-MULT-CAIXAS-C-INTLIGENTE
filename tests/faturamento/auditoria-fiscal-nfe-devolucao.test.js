/**
 * Barreira preventiva — auditoria fiscal NF-e de devolução (modelo 55).
 */
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { auditarNfe } = require('../../backend/services/fiscal/auditoriaFiscalNfe');
const { buildXmlNFeDevolucaoCompra } = require('../../backend/services/fiscal/xmlBuilderNfeDevolucaoCompra');
const { extrairTotais } = require('../../backend/services/fiscal/validarXmlFiscal');
const { calcularVNFSefaz, arredondarMoeda } = require('../../backend/services/fiscal/modeloTotais');
const {
  parsearDetsDoXml,
  espelharDet,
  flattenParaItem
} = require('../../backend/services/fiscal/espelharTributosNfeDevolucaoCompra');
const {
  podeReenviarDevolucao,
  mensagemReenvioXmlEstruturalmenteRejeitado
} = require('../../backend/services/fiscal/nfeDevolucaoEstados');

const FIXTURE = path.join(__dirname, 'fixtures', 'rc2-nfe-origem-tributos.xml');
const CHAVE44 = '23240165957340000150550010000001231000001234';

function configEmitente(crt) {
  return {
    codigoUf: '23',
    cnpj: '65957340000150',
    ie: '073252638',
    crt,
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
}

const compraCE = {
  id: 2,
  chave_acesso: CHAVE44,
  fornecedor: 'FORNECEDOR TESTE LTDA',
  fornecedor_cnpj: '12345678000199',
  rua: 'RUA X',
  numero: '10',
  bairro: 'CENTRO',
  cidade: 'Juazeiro do Norte',
  uf: 'CE',
  cep: '63000000'
};

function imposto({ vIpi = 0, vPis = 0, vCofins = 0, vST = 0, vFCPST = 0, csosn = null }) {
  const icms = csosn
    ? `<ICMS><ICMSSN${csosn}><orig>0</orig><CSOSN>${csosn}</CSOSN></ICMSSN${csosn}></ICMS>`
    : `<ICMS><ICMS00><orig>0</orig><CST>00</CST><modBC>3</modBC>
        <vBC>0.00</vBC><pICMS>0.0000</pICMS><vICMS>0.00</vICMS>
        ${vST > 0 ? `<vICMSST>${vST.toFixed(2)}</vICMSST>` : ''}
        ${vFCPST > 0 ? `<vFCPST>${vFCPST.toFixed(2)}</vFCPST>` : ''}
      </ICMS00></ICMS>`;
  const ipi = vIpi > 0
    ? `<IPI><cEnq>999</cEnq><IPITrib><CST>50</CST><vBC>0.00</vBC><pIPI>0.0000</pIPI><vIPI>${vIpi.toFixed(2)}</vIPI></IPITrib></IPI>`
    : `<IPI><cEnq>999</cEnq><IPINT><CST>51</CST></IPINT></IPI>`;
  const pis = vPis > 0
    ? `<PIS><PISAliq><CST>01</CST><vBC>0.00</vBC><pPIS>0.0000</pPIS><vPIS>${vPis.toFixed(2)}</vPIS></PISAliq></PIS>`
    : `<PIS><PISNT><CST>07</CST></PISNT></PIS>`;
  const cofins = vCofins > 0
    ? `<COFINS><COFINSAliq><CST>01</CST><vBC>0.00</vBC><pCOFINS>0.0000</pCOFINS><vCOFINS>${vCofins.toFixed(2)}</vCOFINS></COFINSAliq></COFINS>`
    : `<COFINS><COFINSNT><CST>07</CST></COFINSNT></COFINS>`;
  return icms + ipi + pis + cofins;
}

function itemDev(opts = {}) {
  const vIpi = opts.vIpiOriginal != null ? opts.vIpiOriginal : (opts.vIpi || 0);
  return {
    produto_codigo: opts.codigo || 'P1',
    produto_nome: opts.nome || 'PRODUTO',
    ncm: '22021000',
    unidade: 'UN',
    quantidade: opts.quantidade != null ? opts.quantidade : 1,
    quantidade_original: opts.quantidadeOriginal != null ? opts.quantidadeOriginal : (opts.quantidade || 1),
    valor_unitario: opts.valorUnitario != null ? opts.valorUnitario : 10,
    v_ipi_original: vIpi,
    v_ipi_devol: vIpi,
    vFrete: opts.vFrete || 0,
    vSeg: opts.vSeg || 0,
    vOutro: opts.vOutro || 0,
    vDesc: opts.vDesc || 0,
    cst: opts.csosn ? '' : '00',
    csosn: opts.csosn || '',
    tributosEspelhados: {
      origem: 0,
      cst: opts.csosn ? '' : '00',
      csosn: opts.csosn || '',
      grupoIcms: opts.csosn ? `ICMSSN${opts.csosn}` : 'ICMS00',
      icms: opts.csosn
        ? { orig: '0', CSOSN: opts.csosn, vICMSST: opts.vST || 0, vFCPST: opts.vFCPST || 0 }
        : { orig: '0', CST: '00', vBC: 0, pICMS: 0, vICMS: 0, vICMSST: opts.vST || 0, vFCPST: opts.vFCPST || 0 },
      ipi: vIpi > 0 ? { CST: '50', vIPI: vIpi } : { CST: '51' },
      pis: { CST: (opts.vPis > 0 ? '01' : '07'), vPIS: opts.vPis || 0 },
      cofins: { CST: (opts.vCofins > 0 ? '01' : '07'), vCOFINS: opts.vCofins || 0 }
    },
    impostoEspelhadoXml: opts.impostoEspelhadoXml || imposto({
      vIpi,
      vPis: opts.vPis || 0,
      vCofins: opts.vCofins || 0,
      vST: opts.vST || 0,
      vFCPST: opts.vFCPST || 0,
      csosn: opts.csosn || null
    })
  };
}

function itemIcms00Espelhado() {
  return {
    produto_nome: 'AL_CRIMP_DUP',
    produto_codigo: 'AL_CRIMP_DUP',
    quantidade: 1,
    valor_unitario: 157.35,
    ncm: '82032000',
    unidade: 'UN',
    cfop: '5202',
    cst: '00',
    tributosEspelhados: {
      origem: 1,
      cst: '00',
      grupoIcms: 'ICMS00',
      icms: { orig: '1', CST: '00', modBC: 3, vBC: 157.35, pICMS: 4, vICMS: 6.29 },
      pis: { CST: '07' },
      cofins: { CST: '07' }
    },
    impostoEspelhadoXml:
      '<ICMS><ICMS00><orig>1</orig><CST>00</CST><modBC>3</modBC><vBC>157.35</vBC><pICMS>4.0000</pICMS><vICMS>6.29</vICMS></ICMS00></ICMS>'
      + '<PIS><PISNT><CST>07</CST></PISNT></PIS><COFINS><COFINSNT><CST>07</CST></COFINSNT></COFINS>'
  };
}

function auditarXml(xml, extra = {}) {
  return auditarNfe({ tipoDocumento: 'DEVOLUCAO_COMPRA', xml, ...extra });
}

function temCodigo(auditoria, codigo) {
  return (auditoria.erros || []).some((e) => e.codigo === codigo);
}

describe('Auditoria fiscal NF-e de devolução', () => {
  it('CENÁRIO 1 — CRT=1 + CST=00: BLOQUEADO', () => {
    const built = buildXmlNFeDevolucaoCompra({
      config: configEmitente(1),
      compra: compraCE,
      itens: [itemIcms00Espelhado()],
      numero: 1
    });
    const xmlRuim = built.xmlSemAssinatura
      .replace(/<ICMSSN900>[\s\S]*?<\/ICMSSN900>/g, '<ICMS00><orig>1</orig><CST>00</CST></ICMS00>');
    const r = auditarXml(xmlRuim);
    assert.equal(r.aprovado, false);
    assert.equal(temCodigo(r, 'AUD-ICMS-CRT-001'), true);
  });

  it('CENÁRIO 2 — CRT=1 + ICMSSN900 + CSOSN=900: APROVADO', () => {
    const built = buildXmlNFeDevolucaoCompra({
      config: configEmitente(1),
      compra: compraCE,
      itens: [itemIcms00Espelhado()],
      numero: 2
    });
    const r = auditarXml(built.xmlSemAssinatura);
    assert.equal(r.aprovado, true, JSON.stringify(r.erros, null, 2));
    assert.match(built.xmlSemAssinatura, /<ICMSSN900>/);
    assert.match(built.xmlSemAssinatura, /<CSOSN>900<\/CSOSN>/);
  });

  it('CENÁRIO 3 — Município SC com IBGE CE: BLOQUEADO', () => {
    const built = buildXmlNFeDevolucaoCompra({
      config: configEmitente(3),
      compra: { ...compraCE, cidade: 'Camboriu', uf: 'SC', codigo_municipio: '4203204' },
      itens: [itemDev({ csosn: '102' })],
      numero: 3
    });
    const xmlRuim = built.xmlSemAssinatura.replace(/<enderDest>[\s\S]*?<\/enderDest>/, (bloco) =>
      bloco.replace('<cMun>4203204</cMun>', '<cMun>2307304</cMun>')
    );
    const r = auditarXml(xmlRuim);
    assert.equal(r.aprovado, false);
    assert.equal(temCodigo(r, 'AUD-DEST-001'), true);
  });

  it('CENÁRIO 4 — Camboriú / SC / 4203204: APROVADO', () => {
    const built = buildXmlNFeDevolucaoCompra({
      config: configEmitente(3),
      compra: { ...compraCE, cidade: 'Camboriu', uf: 'SC', codigo_municipio: '4203204' },
      itens: [itemDev({ csosn: '102' })],
      numero: 4
    });
    const r = auditarXml(built.xmlSemAssinatura);
    assert.equal(r.aprovado, true, JSON.stringify(r.erros, null, 2));
    assert.match(built.xmlSemAssinatura, /<cMun>4203204<\/cMun>/);
  });

  it('CENÁRIO 5 — vNF contendo PIS + COFINS: BLOQUEADO', () => {
    const vProd = 1128.63;
    const vIpi = 48.73;
    const vPis = 7.34;
    const vCofins = 33.40;
    const built = buildXmlNFeDevolucaoCompra({
      config: configEmitente(3),
      compra: compraCE,
      itens: [itemDev({
        valorUnitario: vProd,
        vIpiOriginal: vIpi,
        vPis,
        vCofins
      })],
      numero: 5
    });
    const tot = extrairTotais(built.xmlSemAssinatura);
    const vNFErrado = arredondarMoeda(tot.vNF + tot.vPIS + tot.vCOFINS);
    const xmlRuim = built.xmlSemAssinatura.replace(
      /<vNF>[^<]*<\/vNF>/,
      `<vNF>${vNFErrado.toFixed(2)}</vNF>`
    );
    const r = auditarXml(xmlRuim);
    assert.equal(r.aprovado, false);
    assert.equal(temCodigo(r, 'AUD-TOTAL-VNF-001'), true);
  });

  it('CENÁRIO 6 — vNF conforme fórmula oficial: APROVADO', () => {
    const built = buildXmlNFeDevolucaoCompra({
      config: configEmitente(3),
      compra: compraCE,
      itens: [itemDev({
        valorUnitario: 1128.63,
        vIpiOriginal: 48.73
      })],
      numero: 6
    });
    const tot = extrairTotais(built.xmlSemAssinatura);
    assert.equal(tot.vNF, calcularVNFSefaz(tot));
    const r = auditarXml(built.xmlSemAssinatura);
    assert.equal(r.aprovado, true, JSON.stringify(r.erros, null, 2));
  });

  it('CENÁRIO 7 — vIPIDevol total ≠ soma dos itens: BLOQUEADO', () => {
    const built = buildXmlNFeDevolucaoCompra({
      config: configEmitente(3),
      compra: compraCE,
      itens: [
        itemDev({ codigo: 'A', vIpiOriginal: 10 }),
        itemDev({ codigo: 'B', vIpiOriginal: 20 })
      ],
      numero: 7
    });
    let xml = built.xmlSemAssinatura.replace(
      /(<ICMSTot>[\s\S]*?)<vIPIDevol>30\.00<\/vIPIDevol>/,
      '$1<vIPIDevol>31.00</vIPIDevol>'
    );
    const tot = extrairTotais(xml);
    xml = xml.replace(/<vNF>[^<]*<\/vNF>/, `<vNF>${calcularVNFSefaz({ ...tot, vIPIDevol: 31 }).toFixed(2)}</vNF>`);
    const r = auditarXml(xml);
    assert.equal(r.aprovado, false);
    assert.equal(temCodigo(r, 'AUD-IPI-DEVOL-001'), true);
  });

  it('CENÁRIO 8 — vIPIDevol total = soma dos itens: APROVADO', () => {
    const built = buildXmlNFeDevolucaoCompra({
      config: configEmitente(3),
      compra: compraCE,
      itens: [
        itemDev({ codigo: 'A', vIpiOriginal: 10 }),
        itemDev({ codigo: 'B', vIpiOriginal: 20 })
      ],
      numero: 8
    });
    const r = auditarXml(built.xmlSemAssinatura);
    assert.equal(r.aprovado, true, JSON.stringify(r.erros, null, 2));
    assert.equal(extrairTotais(built.xmlSemAssinatura).vIPIDevol, 30);
  });

  it('CENÁRIO 9 — devolução parcial com IPI proporcional: APROVADO', () => {
    const built = buildXmlNFeDevolucaoCompra({
      config: configEmitente(3),
      compra: compraCE,
      itens: [itemDev({ quantidade: 5, quantidadeOriginal: 10, vIpiOriginal: 20 })],
      numero: 9
    });
    const r = auditarXml(built.xmlSemAssinatura, {
      itens: [itemDev({ quantidade: 5, quantidadeOriginal: 10, vIpiOriginal: 20 })]
    });
    assert.equal(r.aprovado, true, JSON.stringify(r.erros, null, 2));
    assert.equal(extrairTotais(built.xmlSemAssinatura).vIPIDevol, 10);
  });

  it('CENÁRIO 10 — frete proporcional: APROVADO', () => {
    const built = buildXmlNFeDevolucaoCompra({
      config: configEmitente(3),
      compra: compraCE,
      itens: [itemDev({ csosn: '102', quantidade: 2, vFrete: 4.5 })],
      numero: 10
    });
    const r = auditarXml(built.xmlSemAssinatura);
    assert.equal(r.aprovado, true, JSON.stringify(r.erros, null, 2));
    assert.equal(extrairTotais(built.xmlSemAssinatura).vFrete, 4.5);
  });

  it('CENÁRIO 11 — seguro proporcional: APROVADO', () => {
    const built = buildXmlNFeDevolucaoCompra({
      config: configEmitente(3),
      compra: compraCE,
      itens: [itemDev({ csosn: '102', vSeg: 1.2 })],
      numero: 11
    });
    const r = auditarXml(built.xmlSemAssinatura);
    assert.equal(r.aprovado, true, JSON.stringify(r.erros, null, 2));
    assert.equal(extrairTotais(built.xmlSemAssinatura).vSeg, 1.2);
  });

  it('CENÁRIO 12 — outras despesas proporcionais: APROVADO', () => {
    const built = buildXmlNFeDevolucaoCompra({
      config: configEmitente(3),
      compra: compraCE,
      itens: [itemDev({ csosn: '102', vOutro: 0.8 })],
      numero: 12
    });
    const r = auditarXml(built.xmlSemAssinatura);
    assert.equal(r.aprovado, true, JSON.stringify(r.erros, null, 2));
    assert.equal(extrairTotais(built.xmlSemAssinatura).vOutro, 0.8);
  });

  it('CENÁRIO 13 — ST/FCPST quando presentes: total = soma dos itens', async () => {
    const dets = await parsearDetsDoXml(fs.readFileSync(FIXTURE, 'utf8'));
    const itens = dets.map((d) => {
      const esp = espelharDet(d, d.qCom);
      return { ...flattenParaItem(esp), produto_nome: d.xProd, produto_codigo: d.cProd, quantidade: d.qCom, ncm: d.NCM, unidade: d.uCom, valor_unitario: d.vUnCom };
    });
    const built = buildXmlNFeDevolucaoCompra({
      config: configEmitente(3),
      compra: compraCE,
      itens,
      numero: 13
    });
    const r = auditarXml(built.xmlSemAssinatura);
    assert.equal(r.aprovado, true, JSON.stringify(r.erros, null, 2));
    const tot = extrairTotais(built.xmlSemAssinatura);
    assert.ok(tot.vST > 0);
    assert.ok(tot.vFCPST > 0);
  });

  it('CENÁRIO 14 — XML divergente do objeto interno: BLOQUEADO', () => {
    const built = buildXmlNFeDevolucaoCompra({
      config: configEmitente(3),
      compra: compraCE,
      itens: [itemDev({ csosn: '102' })],
      numero: 14
    });
    const r = auditarXml(built.xmlSemAssinatura, {
      itens: [itemDev({ codigo: 'A' }), itemDev({ codigo: 'B' })],
      totais: { vNF: 1 }
    });
    assert.equal(r.aprovado, false);
    assert.equal(temCodigo(r, 'AUD-XML-ESTRUTURA-001'), true);
  });

  it('CENÁRIO 15 — reenviar XML rejeitado 275: BLOQUEADO', () => {
    assert.equal(podeReenviarDevolucao({ status: 'rejeitada', rejeicao_codigo: '275' }), false);
    assert.match(mensagemReenvioXmlEstruturalmenteRejeitado({ cstat_retorno: '275' }), /não pode ser reutilizado/i);
  });

  it('CENÁRIO 16 — reenviar XML rejeitado 590: BLOQUEADO', () => {
    assert.equal(podeReenviarDevolucao({ status: 'rejeitada', cstat_retorno: '590' }), false);
  });

  it('CENÁRIO 17 — reenviar XML rejeitado 863: BLOQUEADO', () => {
    assert.equal(podeReenviarDevolucao({ status: 'rejeitada', cstat_retorno: '863' }), false);
  });

  it('AUD-RATEIO-001 inclui o nome do produto na mensagem', () => {
    const itens = [
      itemDev({ csosn: '102', nome: 'PARAFUSO', quantidade: 1, quantidadeOriginal: 1 }),
      itemDev({
        csosn: '102',
        nome: 'C/ PONTA MAGNETIZADA 3/16X4',
        quantidade: 6,
        quantidadeOriginal: 4,
        valorUnitario: 1
      })
    ];
    const built = buildXmlNFeDevolucaoCompra({
      config: configEmitente(3),
      compra: compraCE,
      itens,
      numero: 101
    });
    const r = auditarXml(built.xmlSemAssinatura, { itens });
    assert.equal(r.aprovado, false);
    const erro = (r.erros || []).find((e) => e.codigo === 'AUD-RATEIO-001');
    assert.ok(erro, JSON.stringify(r.erros, null, 2));
    assert.match(erro.mensagem, /item 2 \(C\/ PONTA MAGNETIZADA 3\/16X4\)/);
    assert.match(erro.mensagem, /devolvida \(6\).*original \(4\)/);
  });

  it('CENÁRIO 18 — 46 itens auditados, CRT/dest/IPI/vNF fechados', () => {
    const itens = Array.from({ length: 46 }, (_, i) => itemDev({
      codigo: `I${i + 1}`,
      vIpiOriginal: i === 0 ? 8.18 : (i === 1 ? 2.55 : 0.80)
    }));
    const built = buildXmlNFeDevolucaoCompra({
      config: configEmitente(3),
      compra: compraCE,
      itens,
      numero: 18
    });
    const r = auditarXml(built.xmlSemAssinatura);
    assert.equal(r.resumo.itensAuditados, 46);
    assert.equal(r.aprovado, true, JSON.stringify(r.erros, null, 2));
    const tot = extrairTotais(built.xmlSemAssinatura);
    assert.equal(tot.vNF, calcularVNFSefaz(tot));
    assert.equal(tot.vIPIDevol, r.totais.vIPIDevol);
  });
});
