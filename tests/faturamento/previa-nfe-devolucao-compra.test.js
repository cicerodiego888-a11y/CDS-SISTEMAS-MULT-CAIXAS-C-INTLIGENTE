/**
 * Prévia NF-e Devolução Compra — sem emitir / mesmos totais do XML
 */
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '../..');
const {
  montarResumoPreviaDevolucao
} = require('../../backend/services/fiscal/nfeDevolucaoCompra');
const { buildXmlNFeDevolucaoCompra } = require('../../backend/services/fiscal/xmlBuilderNfeDevolucaoCompra');
const { extrairTotais } = require('../../backend/services/fiscal/validarXmlFiscal');
const { calcularVNFSefaz } = require('../../backend/services/fiscal/modeloTotais');

const CHAVE44 = '23240165957340000150550010000001231000001234';
const configBase = {
  codigoUf: '23',
  cnpj: '65957340000150',
  ie: '073252638',
  crt: 1,
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

describe('Prévia NF-e devolução — fluxo UI', () => {
  it('Emitir abre prévia; só Confirmar chama emissão real', () => {
    const src = fs.readFileSync(path.join(ROOT, 'frontend/erp/js/compras.js'), 'utf8');
    assert.match(src, /onclick="abrirPreviaNfeDevolucaoCompra/);
    assert.match(src, /nfe-devolucao\/previa/);
    assert.match(src, /Prévia da NF-e de Devolução/);
    assert.match(src, /Voltar e Editar/);
    assert.match(src, /Confirmar e Emitir NF-e/);
    assert.match(src, /function confirmarEmissaoNFeDevolucaoCompra/);
    assert.match(src, /emitir-nfe-devolucao/);

    const emitBtn = src.match(/id="btnEmitirNfeDevolucao"[\s\S]{0,400}onclick="([^"]+)"/);
    assert.ok(emitBtn);
    assert.match(emitBtn[1], /abrirPreviaNfeDevolucaoCompra/);
    assert.doesNotMatch(emitBtn[1], /confirmarEmissaoNFeDevolucaoCompra/);

    const confirmarBtn = src.match(/id="btnConfirmarEmitirNfeDev"[\s\S]{0,250}onclick="([^"]+)"/);
    assert.ok(confirmarBtn);
    assert.match(confirmarBtn[1], /confirmarEmissaoNFeDevolucaoCompra/);
  });

  it('ETAPA 1 e ETAPA 2 nunca mostram os dois conjuntos de botões juntos', () => {
    const src = fs.readFileSync(path.join(ROOT, 'frontend/erp/js/compras.js'), 'utf8');
    assert.match(src, /data-modo="EDICAO"/);
    assert.match(src, /function aplicarModoNfeDevolucao/);
    assert.match(src, /\[data-modo="EDICAO"\][\s\S]{0,200}\[data-etapa="PREVIA"\]/);
    assert.match(src, /\[data-modo="PREVIA"\][\s\S]{0,200}\[data-etapa="EDICAO"\]/);
    assert.match(src, /data-etapa="EDICAO"/);
    assert.match(src, /data-etapa="PREVIA"/);
    assert.match(src, /aplicarModoNfeDevolucao\('EDICAO'\)/);
    assert.doesNotMatch(src, /nfeDevFooterFormulario/);
    assert.doesNotMatch(src, /nfeDevFooterPrevia/);
  });

  it('rota de prévia não transmite SEFAZ', () => {
    const rotas = fs.readFileSync(path.join(ROOT, 'backend/rotas/compras.js'), 'utf8');
    assert.match(rotas, /nfe-devolucao\/previa/);
    assert.match(rotas, /previaNfeDevolucaoCompra/);
    const svc = fs.readFileSync(path.join(ROOT, 'backend/services/fiscal/nfeDevolucaoCompra.js'), 'utf8');
    assert.match(svc, /async function previaNfeDevolucaoCompra/);
    assert.match(svc, /reservarNumero: false/);
    const previaFn = svc.slice(svc.indexOf('async function previaNfeDevolucaoCompra'));
    const corpo = previaFn.slice(0, previaFn.indexOf('async function emitirNFeDevolucaoCompra') > 0
      ? 1200
      : 1200);
    assert.doesNotMatch(corpo, /enviarLote/);
    assert.doesNotMatch(corpo, /persistirNota/);
    assert.doesNotMatch(corpo, /persistirItensNfeDevolucao/);
  });
});

describe('Prévia NF-e devolução — totais iguais ao XML', () => {
  it('vNF da prévia = ICMSTot.vNF gerado pelo builder (PIS/COFINS informativos)', () => {
    const vProd = 1128.63;
    const vIpi = 48.73;
    const vPis = 7.34;
    const vCofins = 33.40;
    const built = buildXmlNFeDevolucaoCompra({
      config: configBase,
      compra: {
        id: 77,
        chave_acesso: CHAVE44,
        fornecedor: 'FORNECEDOR TESTE LTDA',
        fornecedor_cnpj: '12345678000199',
        cidade: 'Juazeiro do Norte',
        uf: 'CE'
      },
      itens: [{
        produto_id: 1,
        produto_nome: 'PRODUTO DEV',
        produto_codigo: 'P1',
        ncm: '22021000',
        unidade: 'UN',
        quantidade: 1,
        valor_unitario: vProd,
        csosn: '102',
        cst: '00',
        v_ipi: vIpi,
        v_ipi_devol: vIpi,
        tributosEspelhados: {
          origem: 0,
          cst: '00',
          grupoIcms: 'ICMS00',
          icms: { orig: '0', CST: '00', vBC: 0, pICMS: 0, vICMS: 0 },
          ipi: { CST: '50', vBC: 0, pIPI: 0, vIPI: vIpi },
          pis: { CST: '01', vBC: 0, pPIS: 0, vPIS: vPis, grupo: 'PISAliq' },
          cofins: { CST: '01', vBC: 0, pCOFINS: 0, vCOFINS: vCofins, grupo: 'COFINSAliq' }
        },
        impostoEspelhadoXml: `
          <ICMS><ICMS00><orig>0</orig><CST>00</CST><modBC>3</modBC>
            <vBC>0.00</vBC><pICMS>0.0000</pICMS><vICMS>0.00</vICMS></ICMS00></ICMS>
          <IPI><cEnq>999</cEnq><IPITrib><CST>50</CST><vBC>0.00</vBC><pIPI>0.0000</pIPI><vIPI>48.73</vIPI></IPITrib></IPI>
          <PIS><PISAliq><CST>01</CST><vBC>0.00</vBC><pPIS>0.0000</pPIS><vPIS>7.34</vPIS></PISAliq></PIS>
          <COFINS><COFINSAliq><CST>01</CST><vBC>0.00</vBC><pCOFINS>0.0000</pCOFINS><vCOFINS>33.40</vCOFINS></COFINSAliq></COFINS>`
      }],
      numero: 1,
      observacoes: 'Teste prévia'
    });

    const previa = montarResumoPreviaDevolucao({
      built,
      compra: { fornecedor: 'FORNECEDOR TESTE LTDA', fornecedor_cnpj: '12345678000199' },
      itensEspelhados: [{
        produto_codigo: 'P1',
        produto_nome: 'PRODUTO DEV',
        unidade: 'UN',
        quantidade: 1,
        valor_unitario: vProd,
        vDesc: 0,
        vProd
      }],
      observacoes: 'Teste prévia',
      cfop: '5202'
    });

    const totXml = extrairTotais(built.xmlSemAssinatura);
    assert.equal(previa.emitido, false);
    assert.equal(previa.transmitido, false);
    assert.equal(previa.totais.vNF, totXml.vNF);
    assert.equal(previa.totais.vNF, calcularVNFSefaz(totXml));
    assert.equal(previa.totais.vProd, 1128.63);
    assert.equal(previa.totais.vIPIDevol, 48.73);
    assert.equal(previa.tributos.vPIS, 7.34);
    assert.equal(previa.tributos.vCOFINS, 33.40);
    assert.equal(previa.tributos.pisCofinsInformativos, true);
    assert.equal(previa.totais.vNF, 1177.36);
    assert.equal(previa.itens.length, 1);
    assert.equal(previa.cfop, '5202');
  });
});
