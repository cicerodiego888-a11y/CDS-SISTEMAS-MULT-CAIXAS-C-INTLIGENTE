'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  extrairXmlNfceAutorizado,
  prepararNfceAutorizadasParaExportacao
} = require('../../backend/services/fiscal/centralContabilNfceXml');

const CHAVE = '23261047627408000151650010000100031688469487';
const CHAVE_DIVERGENTE = '23261047627408000151650010000100041688469486';
const PROTOCOLO = '223260874568598';
const DIGEST = 'RPeZioxYXIKEETEmulTDX8EzfzY=';

function xmlAssinado(chave = CHAVE, digest = DIGEST) {
  return `<NFe xmlns="http://www.portalfiscal.inf.br/nfe">`
    + `<infNFe Id="NFe${chave}" versao="4.00"><ide><cUF>23</cUF></ide></infNFe>`
    + `<Signature xmlns="http://www.w3.org/2000/09/xmldsig#"><SignedInfo><Reference>`
    + `<DigestValue>${digest}</DigestValue></Reference></SignedInfo><SignatureValue>fixture</SignatureValue></Signature>`
    + `</NFe>`;
}

function protNfe({
  chave = CHAVE,
  protocolo = PROTOCOLO,
  cStat = '100',
  digVal = DIGEST,
  versao = '4.00'
} = {}) {
  return `<protNFe xmlns="http://www.portalfiscal.inf.br/nfe" versao="${versao}"><infProt>`
    + `<chNFe>${chave}</chNFe><cStat>${cStat}</cStat><xMotivo>Autorizado o uso da NF-e</xMotivo>`
    + `<nProt>${protocolo}</nProt><digVal>${digVal}</digVal></infProt></protNFe>`;
}

function nfeProc({ nfe = xmlAssinado(), protocol = protNfe() } = {}) {
  return `<nfeProc xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00">${nfe}${protocol}</nfeProc>`;
}

function nota(overrides = {}) {
  return {
    id: 10003,
    status: 'autorizada',
    chave_acesso: CHAVE,
    protocolo: PROTOCOLO,
    xml_enviado: xmlAssinado(),
    xml_retorno: `<retEnviNFe>${protNfe()}</retEnviNFe>`,
    ...overrides
  };
}

describe('Central Contábil — XML autorizado NFC-e', () => {
  it('exporta nfeProc já disponível e mantém o XML assinado original', () => {
    const signed = xmlAssinado();
    const xml = extrairXmlNfceAutorizado(nota({
      xml_autorizado: nfeProc({ nfe: signed }),
      xml_retorno: `<retEnviNFe>${protNfe()}</retEnviNFe>`
    }));
    assert.match(xml, /^<\?xml|^<nfeProc\b/);
    assert.match(xml, /<nfeProc\b/);
    assert.equal(xml.match(/<NFe\b[\s\S]*?<\/NFe>/)[0], signed);
    assert.match(xml, /<nProt>223260874568598<\/nProt>/);
  });

  it('monta nfeProc do XML assinado e protNFe armazenados separadamente', () => {
    const signed = xmlAssinado();
    const xml = extrairXmlNfceAutorizado(nota({ xml_retorno: `<retEnviNFe>${protNfe()}</retEnviNFe>` }));
    assert.match(xml, /^<\?xml|^<nfeProc\b/);
    assert.equal(xml.match(/<NFe\b[\s\S]*?<\/NFe>/)[0], signed);
    assert.match(xml, /<chNFe>23261047627408000151650010000100031688469487<\/chNFe>/);
    assert.match(xml, /<nProt>223260874568598<\/nProt>/);
  });

  it('bloqueia documento sem protocolo', () => {
    assert.throws(() => extrairXmlNfceAutorizado(nota({
      xml_retorno: '<retEnviNFe><cStat>100</cStat></retEnviNFe>'
    })), { code: 'PROTOCOLO_AUSENTE' });
  });

  it('bloqueia protocolo cuja chave diverge', () => {
    assert.throws(() => extrairXmlNfceAutorizado(nota({
      xml_retorno: `<retEnviNFe>${protNfe({ chave: CHAVE_DIVERGENTE })}</retEnviNFe>`
    })), { code: 'CHAVE_PROTOCOLO_DIVERGENTE' });
  });

  it('bloqueia protocolo sem nProt', () => {
    assert.throws(() => extrairXmlNfceAutorizado(nota({
      xml_retorno: `<retEnviNFe>${protNfe().replace(/<nProt>[\s\S]*?<\/nProt>/, '')}</retEnviNFe>`
    })), { code: 'PROTOCOLO_INVALIDO' });
  });

  it('bloqueia cStat de rejeição', () => {
    assert.throws(() => extrairXmlNfceAutorizado(nota({
      xml_retorno: `<retEnviNFe>${protNfe({ cStat: '302' })}</retEnviNFe>`
    })), { code: 'PROTOCOLO_NAO_AUTORIZADO' });
  });

  it('bloqueia cStat 150 na exportação contábil, que exige autorização cStat 100', () => {
    assert.throws(() => extrairXmlNfceAutorizado(nota({
      xml_retorno: `<retEnviNFe>${protNfe({ cStat: '150' })}</retEnviNFe>`
    })), { code: 'PROTOCOLO_NAO_AUTORIZADO' });
  });

  it('bloqueia nProt divergente do protocolo persistido', () => {
    const protocoloDivergente = '123456789012345';
    const retorno = `<retEnviNFe>${protNfe({ protocolo: protocoloDivergente })}</retEnviNFe>`;
    assert.throws(() => extrairXmlNfceAutorizado(nota({
      xml_autorizado: nfeProc({ protocol: protNfe({ protocolo: protocoloDivergente }) }),
      xml_retorno: retorno
    })), { code: 'PROTOCOLO_DIVERGENTE' });
  });

  it('bloqueia digVal divergente do DigestValue assinado', () => {
    assert.throws(() => extrairXmlNfceAutorizado(nota({
      xml_enviado: xmlAssinado(CHAVE, 'AAAAAAAAAAAAAAAAAAAAAAAAAAA='),
      xml_retorno: `<retEnviNFe>${protNfe()}</retEnviNFe>`
    })), { code: 'DIGEST_DIVERGENTE' });
  });

  it('preserva documento histórico com nfeProc armazenado', () => {
    const stored = nfeProc();
    const xml = extrairXmlNfceAutorizado(nota({ xml_autorizado: stored }));
    assert.match(xml, /<nfeProc\b/);
    assert.match(xml, /<digVal>RPeZioxYXIKEETEmulTDX8EzfzY=<\/digVal>/);
  });

  it('identifica documento inválido em lote e não o inclui entre os XMLs exportáveis', () => {
    const invalid = nota({
      id: 10004,
      chave_acesso: CHAVE_DIVERGENTE,
      protocolo: PROTOCOLO,
      xml_enviado: xmlAssinado(CHAVE_DIVERGENTE),
      xml_retorno: `<retEnviNFe>${protNfe({ chave: CHAVE })}</retEnviNFe>`
    });
    const result = prepararNfceAutorizadasParaExportacao([nota(), invalid]);
    assert.equal(result.validas.length, 1);
    assert.equal(result.invalidas.length, 1);
    assert.equal(result.invalidas[0].nota.id, 10004);
    assert.equal(result.invalidas[0].codigo, 'CHAVE_PROTOCOLO_DIVERGENTE');
  });

  it('bloqueia rejeitada mesmo que seus campos incluam XML com autorização', () => {
    assert.throws(() => extrairXmlNfceAutorizado(nota({ status: 'rejeitada' })), {
      code: 'STATUS_NAO_AUTORIZADO'
    });
  });

  it('bloqueia timeout ou pendência sem confirmação persistida de autorização', () => {
    assert.throws(() => extrairXmlNfceAutorizado(nota({ status: 'pendente' })), {
      code: 'STATUS_NAO_AUTORIZADO'
    });
  });

  it('bloqueia retorno SEFAZ malformado', () => {
    assert.throws(() => extrairXmlNfceAutorizado(nota({ xml_retorno: '<retEnviNFe>' })), {
      code: 'XML_RETORNO_MALFORMADO'
    });
  });
});
