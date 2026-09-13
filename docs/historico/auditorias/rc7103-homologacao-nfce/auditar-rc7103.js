'use strict';

const fs = require('fs');
const path = require('path');
const {
  buildNfceXml,
  validarIdentidadeICMSTot,
} = require('../../../backend/services/fiscal/xmlBuilder');
const { distribuirItensVendaComValorFiscalEfetivo } = require('../../../backend/services/distribuidorEstoqueVenda');
const midp = require('../../../backend/services/midp');
const OrquestradorPagamento = require('../../../backend/services/OrquestradorPagamento');

const outDir = __dirname;
fs.mkdirSync(outDir, { recursive: true });

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
  municipio: 'JUAZEIRO DO NORTE',
  uf: 'CE',
  cep: '63000000',
  telefone: '8835110000',
  csosn_padrao: '102',
};

function round2(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

function tag(xml, name) {
  const m = String(xml).match(new RegExp(`<${name}>([^<]*)</${name}>`));
  return m ? m[1] : null;
}

function hasGroup(xml, name) {
  return new RegExp(`<${name}[\\s>]`).test(xml);
}

function extract(xml, name) {
  const m = String(xml).match(new RegExp(`<${name}[\\s>][\\s\\S]*?</${name}>`));
  return m ? m[0] : null;
}

async function main() {
  const motor = distribuirItensVendaComValorFiscalEfetivo(
    [
      {
        item: {
          produto_id: 1,
          quantidade: 1,
          preco_unitario: 83.4,
          subtotal: 83.4,
          produto_ncm: '10063021',
          cfop: '5102',
          unidade: 'UN',
          origem: 0,
          csosn: '102',
          produto_nome: 'PRODUTO TESTE',
        },
        saldoFiscal: 100,
        saldoNaoFiscal: 0,
      },
    ],
    true,
    { pagamentos: [{ forma_pagamento: 'dinheiro', valor: 78 }], desconto: 5.4, midpAtivo: false }
  );

  const itens = motor.itens.map((i) => ({
    ...i,
    produto_ncm: '10063021',
    cfop: '5102',
    unidade: 'UN',
    origem: 0,
    csosn: '102',
    produto_nome: 'PRODUTO TESTE',
  }));

  const venda = {
    total: 78,
    desconto: 5.4,
    valor_fiscal: motor.valorFiscalEfetivo,
    valor_nao_fiscal: 0,
    forma_pagamento: 'dinheiro',
    pagamentos: [{ forma_pagamento: 'dinheiro', valor: 78, tipo_recebimento: 'fiscal' }],
    cpf_cnpj_nota: '12345678909',
  };

  const built = buildNfceXml({ config: cfg, venda, itens, numero: 91003 });
  const xml = built.xmlSemAssinatura;
  const xmlPath = path.join(outDir, 'nfce-caso-real-8340-540-7800-sem-assinar.xml');
  fs.writeFileSync(xmlPath, xml, 'utf8');

  const icms = extract(xml, 'ICMSTot') || '';
  const totais = {
    vProd: Number(tag(icms, 'vProd')),
    vDesc: Number(tag(icms, 'vDesc')),
    vFrete: Number(tag(icms, 'vFrete')),
    vSeg: Number(tag(icms, 'vSeg')),
    vOutro: Number(tag(icms, 'vOutro')),
    vIPI: Number(tag(icms, 'vIPI')),
    vST: Number(tag(icms, 'vST')),
    vNF: Number(tag(icms, 'vNF')),
    vBC: Number(tag(icms, 'vBC')),
    vICMS: Number(tag(icms, 'vICMS')),
    vPIS: Number(tag(icms, 'vPIS')),
    vCOFINS: Number(tag(icms, 'vCOFINS')),
  };

  const somaDetVProd = [...xml.matchAll(/<det[\s\S]*?<vProd>([^<]+)<\/vProd>/g)].reduce(
    (s, m) => s + Number(m[1]),
    0
  );
  const somaPag = [...xml.matchAll(/<vPag>([^<]+)<\/vPag>/g)].reduce((s, m) => s + Number(m[1]), 0);
  const vTroco = tag(xml, 'vTroco');
  const sefazVNF = round2(
    totais.vProd -
      totais.vDesc +
      totais.vFrete +
      totais.vSeg +
      totais.vOutro +
      totais.vIPI +
      totais.vST
  );

  const grupos = {
    ide: hasGroup(xml, 'ide'),
    emit: hasGroup(xml, 'emit'),
    dest: hasGroup(xml, 'dest'),
    det: hasGroup(xml, 'det'),
    prod: hasGroup(xml, 'prod'),
    imposto: hasGroup(xml, 'imposto'),
    ICMS: hasGroup(xml, 'ICMS'),
    PIS: hasGroup(xml, 'PIS'),
    COFINS: hasGroup(xml, 'COFINS'),
    IPI: hasGroup(xml, 'IPI'),
    ISSQN: hasGroup(xml, 'ISSQN'),
    ICMSTot: hasGroup(xml, 'ICMSTot'),
    transp: hasGroup(xml, 'transp'),
    pag: hasGroup(xml, 'pag'),
    detPag: hasGroup(xml, 'detPag'),
    infAdic: hasGroup(xml, 'infAdic'),
    infRespTec: hasGroup(xml, 'infRespTec'),
    Signature: hasGroup(xml, 'Signature'),
    protNFe: hasGroup(xml, 'protNFe'),
    vTotTrib: hasGroup(xml, 'vTotTrib'),
    infNFeSupl: hasGroup(xml, 'infNFeSupl'),
  };

  const midpRes = midp.alocarPagamentos(
    [{ forma_pagamento: 'dinheiro', valor: 78 }],
    motor.valorFiscalLiquido,
    0
  );

  const roundCases = [];
  for (const d of [0.01, 0.02, 0.03, 0.05, 0.1, 0.99]) {
    const liq = 10;
    const b = buildNfceXml({
      config: cfg,
      venda: {
        total: liq,
        desconto: d,
        valor_fiscal: liq,
        forma_pagamento: 'dinheiro',
        pagamentos: [{ forma_pagamento: 'dinheiro', valor: liq, tipo_recebimento: 'fiscal' }],
      },
      itens: [
        {
          produto_id: 1,
          produto_nome: 'P',
          quantidade: 1,
          quantidade_fiscal: 1,
          quantidade_nao_fiscal: 0,
          preco_unitario: liq,
          valor_fiscal: liq,
          valor_nao_fiscal: 0,
          produto_ncm: '10063021',
          cfop: '5102',
          unidade: 'UN',
          origem: 0,
          csosn: '102',
        },
      ],
      numero: 1,
    });
    const esp = round2(b.valores.vProd - b.valores.vDesc);
    roundCases.push({
      desconto: d,
      modelo: b.valores.modelo,
      vProd: b.valores.vProd,
      vDesc: b.valores.vDesc,
      vNF: b.valores.vNF,
      diff: round2(b.valores.vNF - esp),
    });
  }

  const frac = buildNfceXml({
    config: cfg,
    venda: {
      total: 7.55,
      desconto: 0,
      valor_fiscal: 7.55,
      forma_pagamento: 'pix',
      pagamentos: [{ forma_pagamento: 'pix', valor: 7.55, tipo_recebimento: 'fiscal' }],
    },
    itens: [
      {
        produto_id: 1,
        produto_nome: 'KG',
        quantidade: 1.511,
        quantidade_fiscal: 1.511,
        quantidade_nao_fiscal: 0,
        preco_unitario: 5,
        valor_fiscal: 7.55,
        valor_nao_fiscal: 0,
        produto_ncm: '10063021',
        cfop: '5102',
        unidade: 'KG',
        origem: 0,
        csosn: '102',
      },
    ],
    numero: 2,
  });

  const payCases = [];
  async function pay(name, pags, vnf) {
    const r = await OrquestradorPagamento.processarFluxoPagamentoVenda({
      totalFiscal: vnf,
      totalNaoFiscal: 0,
      formaPagamento: pags[0].forma_pagamento,
      pagamentos: pags,
      tefHabilitado: false,
      modoConfirmacaoFiscal: 'MANUAL',
      valorFiscalMaximo: vnf,
    });
    const soma = pags.reduce((s, p) => s + Number(p.valor), 0);
    payCases.push({
      name,
      ok: r.sucesso,
      soma,
      vnf,
      saldoFiscal: r.distribuicao?.saldoFiscal,
      erro: r.erro || null,
    });
  }
  await pay('dinheiro', [{ forma_pagamento: 'dinheiro', valor: 78 }], 78);
  await pay('pix', [{ forma_pagamento: 'pix', valor: 78 }], 78);
  await pay('cartao', [{ forma_pagamento: 'cartao_credito', valor: 78 }], 78);
  await pay('multi_pix_dinheiro', [
    { forma_pagamento: 'pix', valor: 50 },
    { forma_pagamento: 'dinheiro', valor: 28 },
  ], 78);
  await pay('insuficiente', [{ forma_pagamento: 'dinheiro', valor: 70 }], 78);

  const signerSrc = fs.readFileSync(
    path.join(__dirname, '../../../backend/services/fiscal/signer.js'),
    'utf8'
  );
  const assinaturaAudit = {
    lib: 'xml-crypto',
    canonicalization: /REC-xml-c14n-20010315/.test(signerSrc),
    digestSha1: /xmldsig#sha1/.test(signerSrc),
    rsaSha1: /rsa-sha1/.test(signerSrc),
    enveloped: /enveloped-signature/.test(signerSrc),
    referenceId: /addReference/.test(signerSrc),
    extraiDigest: /extrairDigestValue/.test(signerSrc),
    xmlGeradoTemSignature: hasGroup(xml, 'Signature'),
    observacao:
      'XML desta auditoria é pré-assinatura (antes de assinarNFe). Signature/protNFe só após cert+SEFAZ.',
  };

  const duplicatas = {
    xmlBuilders: [
      'backend/services/fiscal/xmlBuilder.js (NFC-e 65)',
      'backend/services/fiscal/xmlBuilderNfeVenda.js (NF-e 55)',
      'backend/services/fiscal/nfeDevolucaoCompra.js',
    ],
    icmsTot: ['xmlBuilder.js', 'xmlBuilderNfeVenda.js', 'nfeDevolucaoCompra.js'],
    vNF: [
      'xmlBuilder.js determinarModeloDeTotais/buildNfceXml',
      'xmlBuilderNfeVenda.js',
      'nfeDevolucaoCompra.js',
    ],
    desconto: [
      'valorFiscalLiquido.js (RC7.10.1)',
      'xmlBuilder ratearDescontoNosItens (só MODELO_BRUTO)',
      'xmlBuilderNfeVenda.js',
    ],
  };

  let identidade = 'PASSOU';
  try {
    validarIdentidadeICMSTot({ ...totais, vII: 0, vIPIDevol: 0 });
  } catch (e) {
    identidade = `FALHOU:${e.message}`;
  }

  const formulas = {
    vNF: sefazVNF === totais.vNF ? 'PASSOU' : 'FALHOU',
    vProd_vs_det: round2(somaDetVProd) === totais.vProd ? 'PASSOU' : 'FALHOU',
    pag_vs_vNF: round2(somaPag) === totais.vNF ? 'PASSOU' : 'FALHOU',
    identidade,
    vBC: totais.vBC === 0 ? 'PASSOU (SN CRT1 sem BC)' : 'CHECAR',
    vICMS: totais.vICMS === 0 ? 'PASSOU (CSOSN102)' : 'CHECAR',
    vPIS: totais.vPIS === 0 ? 'PASSOU (PISNT)' : 'CHECAR',
    vCOFINS: totais.vCOFINS === 0 ? 'PASSOU (COFINSNT)' : 'CHECAR',
    vTotTrib: grupos.vTotTrib ? 'PRESENTE' : 'AUSENTE (opcional NFC-e)',
  };

  const relatorio = {
    caso: { bruto: 83.4, desconto: 5.4, liquido: 78 },
    motor: {
      valorFiscalBruto: motor.valorFiscalBruto,
      valorFiscalLiquido: motor.valorFiscalLiquido,
      valorFiscalEfetivo: motor.valorFiscalEfetivo,
    },
    midp: { saldoFiscal: midpRes.saldoFiscal },
    modelo: built.valores.modelo,
    grupos,
    totais,
    coerencia: {
      somaDetVProd: round2(somaDetVProd),
      vProd: totais.vProd,
      diffProd: round2(somaDetVProd - totais.vProd),
      sefazVNF,
      vNF: totais.vNF,
      diffVNF: round2(totais.vNF - sefazVNF),
      somaPag: round2(somaPag),
      vTroco,
      diffPag: round2(somaPag - totais.vNF),
    },
    formulas,
    roundCases,
    fracionado: frac.valores,
    payCases,
    assinaturaAudit,
    duplicatas,
    xmlPath,
    xsd: {
      ferramenta: 'xmllint ausente no ambiente',
      status: 'NAO_EXECUTADO_FULL',
      structuralRequiredOk:
        grupos.ide && grupos.emit && grupos.det && grupos.ICMSTot && grupos.pag,
    },
  };

  fs.writeFileSync(path.join(outDir, 'relatorio-rc7103.json'), JSON.stringify(relatorio, null, 2), 'utf8');
  console.log(JSON.stringify(relatorio, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
