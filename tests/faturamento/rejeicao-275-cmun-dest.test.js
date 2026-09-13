/**
 * Rejeição SEFAZ 275: cMun do destinatário deve pertencer à UF do destinatário.
 * Destinatário da devolução de compra = fornecedor (nunca o emitente).
 */
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  buildXmlNFeDevolucaoCompra
} = require('../../backend/services/fiscal/xmlBuilderNfeDevolucaoCompra');
const {
  lookupCodigoMunicipio,
  resolverMunicipioDestinatario,
  validarMunicipioDestinatario
} = require('../../backend/services/fiscal/municipioIbge');
const {
  validarXmlFiscal,
  validarDestinatarioMunicipioNoXml
} = require('../../backend/services/fiscal/validarXmlFiscal');

const CHAVE44 = '23240165957340000150550010000001231000001234';

const configEmitenteCE = {
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
  municipioNome: 'Juazeiro do Norte',
  uf: 'CE',
  cep: '63000000',
  telefone: '88999999999'
};

function bloco(xml, name) {
  const m = String(xml).match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`));
  return m ? m[1] : '';
}

function tag(xml, name) {
  const m = String(xml).match(new RegExp(`<${name}(?:\\s[^>]*)?>([^<]*)</${name}>`));
  return m ? m[1] : null;
}

describe('Rejeição 275 — cMun destinatário (fornecedor)', () => {
  it('base IBGE resolve Camboriú/SC como 4203204 (não 2307304 do emitente)', () => {
    assert.equal(lookupCodigoMunicipio('Camboriu', 'SC'), '4203204');
    assert.equal(lookupCodigoMunicipio('Camboriú', 'SC'), '4203204');
    assert.equal(
      resolverMunicipioDestinatario({
        cidade: 'Camboriu',
        uf: 'SC',
        codigoMunicipio: '2307304'
      }),
      '4203204'
    );
  });

  it('XML de devolução usa cMun do fornecedor SC, não o do emitente CE', () => {
    const built = buildXmlNFeDevolucaoCompra({
      config: configEmitenteCE,
      compra: {
        id: 4,
        chave_acesso: CHAVE44,
        fornecedor: 'UZZY IMPORTACAO E DISTRIBUICAO LTDA',
        fornecedor_cnpj: '12345678000199',
        rua: 'R RIO NEGRINHO',
        numero: '372',
        bairro: 'RIO PEQUENO',
        cidade: 'Camboriu',
        uf: 'SC',
        cep: '88343405',
        csosn_cst: '102',
        cst_pis: '07',
        cst_cofins: '07'
      },
      itens: [{
        produto_id: 1,
        produto_nome: 'PRODUTO DEV',
        produto_codigo: 'P1',
        ncm: '22021000',
        unidade: 'UN',
        quantidade: 1,
        valor_unitario: 10,
        csosn: '102'
      }],
      numero: 1
    });

    const dest = bloco(built.xmlSemAssinatura, 'dest');
    const emit = bloco(built.xmlSemAssinatura, 'emit');
    assert.equal(tag(dest, 'cMun'), '4203204');
    assert.equal(tag(dest, 'xMun'), 'Camboriu');
    assert.equal(tag(dest, 'UF'), 'SC');
    assert.equal(tag(emit, 'cMun'), '2307304');
    assert.equal(tag(emit, 'UF'), 'CE');
    assert.doesNotMatch(dest, /<cMun>2307304<\/cMun>/);

    assert.doesNotThrow(() => validarDestinatarioMunicipioNoXml(built.xmlSemAssinatura));
    assert.doesNotThrow(() => validarXmlFiscal({
      xml: built.xmlSemAssinatura,
      modeloDoc: '55',
      validarXsd: false
    }));
  });

  it('validação local bloqueia cMun 2307304 com UF SC (caso da rejeição 275)', () => {
    const xmlInconsistente = `
      <NFe><infNFe>
        <dest>
          <enderDest>
            <cMun>2307304</cMun>
            <xMun>Camboriu</xMun>
            <UF>SC</UF>
          </enderDest>
        </dest>
      </infNFe></NFe>`;
    assert.throws(
      () => validarDestinatarioMunicipioNoXml(xmlInconsistente),
      /município informado não pertence à UF do destinatário/
    );
    assert.throws(
      () => validarMunicipioDestinatario({ uf: 'SC', xMun: 'Camboriu', cMun: '2307304' }),
      /UF: SC[\s\S]*Município: Camboriu[\s\S]*Código IBGE: 2307304/
    );
  });
});
