/**
 * RC6.3 — NF-e rejeitada não bloqueia nova tentativa (XML/assinatura novos).
 */
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const { classificarRetornoSefaz, ACOES } = require('../../backend/services/fiscal/classificarRetornoSefaz');
const { deveBloquearNovaTransmissao } = require('../../backend/services/fiscal/classificarResultadoEmissaoNfe');
const {
  podeReenviarDevolucao,
  podeNovaTentativaDevolucao,
  xmlRejeicaoFiscalDefinitiva,
  ESTADOS
} = require('../../backend/services/fiscal/nfeDevolucaoEstados');
const {
  buildXmlNFeDevolucaoCompra,
  resolverDestinatarioDevolucaoCompra,
  validarDestinatarioDevolucaoAntesAssinatura
} = require('../../backend/services/fiscal/xmlBuilderNfeDevolucaoCompra');

const CHAVE_ORIGEM = '23260963479539000195550010002356951386219958';
const CNPJ_FORNECEDOR = '63479539000195';
const IE_FORNECEDOR = '068994613';
const CNPJ_EMPRESA = '57824986000131';

const configDevolucao = {
  codigoUf: '23',
  cnpj: CNPJ_EMPRESA,
  ie: '072205385',
  crt: 1,
  ambiente: 2,
  serie: 1,
  nomeEmpresa: 'EMPRESA CDS DEVOLUCAO',
  logradouro: 'RUA EMPRESA',
  numero: '10',
  bairro: 'CENTRO',
  municipioCodigo: '2307304',
  municipioNome: 'JUAZEIRO DO NORTE',
  uf: 'CE',
  cep: '63000000',
  telefone: '88999999999'
};

function tag(xml, name) {
  const m = String(xml).match(new RegExp(`<${name}(?:\\s[^>]*)?>([^<]*)</${name}>`));
  return m ? m[1] : null;
}

function bloco(xml, name) {
  const m = String(xml).match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`));
  return m ? m[1] : '';
}

const nota696 = {
  id: 110,
  status: 'rejeitada',
  numero: 110,
  chave_acesso: '1'.repeat(44),
  cstat_retorno: '696',
  rejeicao_codigo: '696',
  xml_assinado: '<NFe><infNFe Id="NFeOLD"/></NFe>',
  xml_assinado_hash: 'hash-antigo',
  xml_retorno: '<cStat>696</cStat>'
};

describe('RC6.3 — lifecycle rejeitada vs autorizada', () => {
  it('1. NF rejeitada 696 pode iniciar nova tentativa', () => {
    assert.equal(classificarRetornoSefaz('696').acao, ACOES.EXIGE_CORRECAO);
    assert.equal(xmlRejeicaoFiscalDefinitiva(nota696), true);
    assert.equal(podeNovaTentativaDevolucao(nota696), true);
    assert.equal(deveBloquearNovaTransmissao(nota696).bloquear, false);
  });

  it('2. NF autorizada não inicia nova tentativa livremente', () => {
    const aut = { id: 9, status: 'autorizada', cstat_retorno: '100' };
    assert.equal(podeNovaTentativaDevolucao(aut), false);
    assert.equal(deveBloquearNovaTransmissao(aut).bloquear, true);
  });

  it('3–4. rejeição fiscal não reenvia XML/assinatura antigos', () => {
    assert.equal(podeReenviarDevolucao(nota696), false);
    const lc = read('backend/services/fiscal/nfeDevolucaoLifecycleService.js');
    assert.match(lc, /async function iniciarNovaTentativaDevolucao/);
    assert.match(lc, /reutilizaXml: false/);
    assert.match(lc, /reutilizaAssinatura: false/);
    assert.doesNotMatch(lc.slice(lc.indexOf('async function iniciarNovaTentativaDevolucao')), /xml_assinado = nota\.xml_assinado/);
  });

  it('5. nova tentativa gera vínculo e lifecycle próprio', () => {
    const svc = read('backend/services/fiscal/nfeDevolucaoCompra.js');
    assert.match(svc, /tentativa_origem_id/);
    assert.match(svc, /numero_tentativa/);
    assert.match(svc, /origemTentativaId/);
    const estados = read('backend/services/fiscal/nfeDevolucaoEstados.js');
    assert.match(estados, /NOVA_TENTATIVA: 'nova_tentativa'/);
  });

  it('6. rejeição não consome saldo definitivamente', () => {
    const saldo = read('backend/services/fiscal/controleSaldoDevolucaoCompra.js');
    assert.match(saldo, /LOWER\(TRIM\(COALESCE\(n\.status, ''\)\)\) = 'autorizada'/);
    assert.doesNotMatch(saldo, /status.*=.*rejeitada.*quantidade/);
  });

  it('7–8. tentativa 1 permanece; tentativa 2 vinculada', () => {
    const lc = read('backend/services/fiscal/nfeDevolucaoLifecycleService.js');
    assert.match(lc, /preservarNotaId: nota\.id/);
    assert.match(lc, /origemTentativaId: Number\(nota\.id\)/);
    const compra = read('backend/services/fiscal/nfeDevolucaoCompra.js');
    assert.match(compra, /tentativaMeta/);
    assert.doesNotMatch(compra, /UPDATE nfe_devolucoes_compra SET xml_assinado =/);
  });

  it('9. RC3: persistir itens só em autorizada', () => {
    const saldo = read('backend/services/fiscal/controleSaldoDevolucaoCompra.js');
    assert.match(saldo, /String\(nota\.status\)\.toLowerCase\(\) !== 'autorizada'/);
  });
});

describe('RC6.3 — destinatário na nova tentativa', () => {
  const xmlOrigem = `<NFe><infNFe><emit>
    <CNPJ>${CNPJ_FORNECEDOR}</CNPJ>
    <xNome>FORNECEDOR</xNome>
    <enderEmit>
      <xLgr>RUA DO FORNECEDOR</xLgr>
      <nro>50</nro>
      <xBairro>ALDEOTA</xBairro>
      <cMun>2304400</cMun>
      <xMun>FORTALEZA</xMun>
      <UF>CE</UF>
      <CEP>60150100</CEP>
    </enderEmit>
    <IE>${IE_FORNECEDOR}</IE>
  </emit></infNFe></NFe>`;

  it('10–13. dest CNPJ/IE/indIEDest/indFinal corretos no XML novo', () => {
    const dest = resolverDestinatarioDevolucaoCompra({
      chave_acesso: CHAVE_ORIGEM,
      inscricao_estadual: '',
      xmlOrigem
    }, configDevolucao);
    assert.equal(dest.cnpj, CNPJ_FORNECEDOR);
    assert.equal(dest.IE, IE_FORNECEDOR);
    assert.equal(dest.indIEDest, '1');

    const built = buildXmlNFeDevolucaoCompra({
      config: configDevolucao,
      compra: {
        id: 16,
        chave_acesso: CHAVE_ORIGEM,
        fornecedor_cnpj: CNPJ_EMPRESA,
        inscricao_estadual: null,
        xmlOrigem
      },
      itens: [{
        produto_nome: 'PRODUTO',
        produto_codigo: '78993',
        ncm: '85365090',
        unidade: 'UN',
        quantidade: 1,
        valor_unitario: 10,
        csosn: '102',
        cst_pis: '07',
        cst_cofins: '07'
      }],
      numero: 111
    });
    const destXml = bloco(built.xmlSemAssinatura, 'dest');
    const ide = bloco(built.xmlSemAssinatura, 'ide');
    assert.equal(tag(destXml, 'CNPJ'), CNPJ_FORNECEDOR);
    assert.equal(tag(destXml, 'IE'), IE_FORNECEDOR);
    assert.equal(tag(destXml, 'indIEDest'), '1');
    assert.equal(tag(ide, 'indFinal'), '0');
    assert.notEqual(built.xmlSemAssinatura, nota696.xml_assinado);
    validarDestinatarioDevolucaoAntesAssinatura({
      xml: built.xmlSemAssinatura,
      emitenteOriginal: { IE: IE_FORNECEDOR },
      destDiagnostico: built.destDiagnostico
    });
  });

  it('bloqueia assinar se IE original válida e dest indIEDest=9', () => {
    assert.throws(
      () => validarDestinatarioDevolucaoAntesAssinatura({
        xml: '<dest><CNPJ>63479539000195</CNPJ><indIEDest>9</indIEDest></dest>',
        emitenteOriginal: { IE: IE_FORNECEDOR },
        destDiagnostico: { indIEDest: '9' }
      }),
      /não contribuinte, mas a NF-e original informa IE válida/
    );
  });
});

describe('RC6.3 — UI e rota', () => {
  it('concluir rejeitada oferece corrigir; reenviar não reusa XML 696', () => {
    const ui = read('frontend/erp/js/nfe-devolucao-compra.js');
    assert.match(ui, /Corrigir e emitir novamente/);
    assert.match(ui, /nova-tentativa/);
    assert.match(ui, /Histórico de tentativas/);
    const rotas = read('backend/rotas/compras.js');
    assert.match(rotas, /nfe-devolucao\/:notaId\/nova-tentativa/);
    assert.match(rotas, /iniciarNovaTentativaDevolucao/);
  });

  it('denegada permanece bloqueada', () => {
    assert.equal(podeNovaTentativaDevolucao({ status: ESTADOS.DENEGADA, cstat_retorno: '110' }), false);
    assert.equal(podeReenviarDevolucao({ status: ESTADOS.DENEGADA }), false);
  });
});
