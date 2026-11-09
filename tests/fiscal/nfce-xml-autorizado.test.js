'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { appendXmlRetornoNfce } = require('../../backend/services/fiscal/xmlRetornoNfce');
const {
  montarXmlAutorizado,
  obterXmlAutorizadoNota
} = require('../../backend/services/fiscal/nfceXmlAutorizado');

const CHAVE = '23261047627408000151650010000100031688469487';
const PROTOCOLO = '223260816956854';

function xmlAssinado(chave = CHAVE) {
  return `<?xml version="1.0" encoding="UTF-8"?>`
    + `<NFe xmlns="http://www.portalfiscal.inf.br/nfe">`
    + `<infNFe Id="NFe${chave}" versao="4.00"><ide><cUF>23</cUF></ide></infNFe>`
    + `<Signature xmlns="http://www.w3.org/2000/09/xmldsig#"><SignatureValue>fixture</SignatureValue></Signature>`
    + `</NFe>`;
}

function protNfe({
  chave = CHAVE,
  cStat = '100',
  xMotivo = 'Autorizado o uso da NF-e',
  protocolo = PROTOCOLO,
  versao = '4.00'
} = {}) {
  return `<protNFe xmlns="http://www.portalfiscal.inf.br/nfe" versao="${versao}">`
    + `<infProt><tpAmb>2</tpAmb><chNFe>${chave}</chNFe><dhRecbto>2026-10-01T10:00:00-03:00</dhRecbto>`
    + `<nProt>${protocolo}</nProt><digVal>fixture</digVal><cStat>${cStat}</cStat><xMotivo>${xMotivo}</xMotivo></infProt>`
    + `</protNFe>`;
}

function nfeProc({ nfe = xmlAssinado(), protocol = protNfe(), versao = '4.00' } = {}) {
  return `<?xml version="1.0" encoding="UTF-8"?>`
    + `<nfeProc xmlns="http://www.portalfiscal.inf.br/nfe" versao="${versao}">${nfe}${protocol}</nfeProc>`;
}

function validar(xmlRetorno, overrides = {}) {
  return montarXmlAutorizado({
    xmlEnviado: xmlAssinado(),
    xmlRetorno,
    chaveAcesso: CHAVE,
    ...overrides
  });
}

describe('XML processado e autorizado NFC-e', () => {
  it('aceita nfeProc válido e valida identidade, versão e protocolo', () => {
    const result = validar(nfeProc());
    assert.equal(result.chaveAcesso, CHAVE);
    assert.equal(result.cStat, '100');
    assert.equal(result.protocolo, PROTOCOLO);
    assert.match(result.xml, /^<\?xml/);
    assert.match(result.xml, /<nfeProc\b/);
  });

  it('aceita autorização fora do prazo (cStat 150) com protocolo válido', () => {
    const result = validar(nfeProc({ protocol: protNfe({ cStat: '150', xMotivo: 'Autorizado fora do prazo' }) }));
    assert.equal(result.cStat, '150');
  });

  it('monta nfeProc quando o retorno contém protNFe válido sem envelope', () => {
    const enviado = xmlAssinado();
    const result = validar(`<retEnviNFe>${protNfe()}</retEnviNFe>`);
    assert.ok(result.xml.includes(enviado.slice(enviado.indexOf('<NFe'), enviado.indexOf('</NFe>') + 6)));
    assert.equal(result.protocolo, PROTOCOLO);
  });

  it('rejeita cStat de rejeição', () => {
    assert.throws(() => validar(`<retEnviNFe>${protNfe({ cStat: '302', xMotivo: 'Uso denegado' })}</retEnviNFe>`), {
      code: 'PROTOCOLO_NAO_AUTORIZADO'
    });
  });

  it('não transforma timeout sem protocolo em autorização', () => {
    assert.throws(() => validar('Timeout aguardando resposta da SEFAZ'), {
      code: 'XML_RETORNO_MALFORMADO'
    });
  });

  it('rejeita protocolo de outra chave', () => {
    const outraChave = `${CHAVE.slice(0, -1)}${CHAVE.endsWith('0') ? '1' : '0'}`;
    assert.throws(() => validar(`<retEnviNFe>${protNfe({ chave: outraChave })}</retEnviNFe>`), {
      code: 'CHAVE_PROTOCOLO_DIVERGENTE'
    });
  });

  it('mantém compatibilidade com retornos NFC-e que preservam resposta de cancelamento como PI', () => {
    const retorno = appendXmlRetornoNfce(
      `<retEnviNFe>${protNfe()}</retEnviNFe>`,
      '<retEvento><cStat>135</cStat></retEvento>'
    );
    const result = validar(retorno);
    assert.equal(result.protocolo, PROTOCOLO);
  });

  it('rejeita protocolo ausente', () => {
    assert.throws(() => validar('<retEnviNFe><cStat>100</cStat></retEnviNFe>'), {
      code: 'PROTOCOLO_AUSENTE'
    });
  });

  it('rejeita retorno SEFAZ malformado', () => {
    assert.throws(() => validar(`<retEnviNFe>${protNfe()}</retEnviNFe`), {
      code: 'XML_RETORNO_MALFORMADO'
    });
  });

  it('disponibiliza apenas nfeProc validado e reconstrói documentos legados', () => {
    const armazenado = obterXmlAutorizadoNota({
      chave_acesso: CHAVE,
      protocolo: PROTOCOLO,
      xml_enviado: xmlAssinado(),
      xml_autorizado: nfeProc()
    });
    assert.match(armazenado.xml, /<nfeProc\b/);

    const legado = obterXmlAutorizadoNota({
      chave_acesso: CHAVE,
      protocolo: PROTOCOLO,
      xml_enviado: xmlAssinado(),
      xml_retorno: `<retEnviNFe>${protNfe()}</retEnviNFe>`
    });
    assert.match(legado.xml, /<nfeProc\b/);

    assert.throws(() => obterXmlAutorizadoNota({
      chave_acesso: CHAVE,
      protocolo: PROTOCOLO,
      xml_enviado: xmlAssinado(),
      xml_retorno: '<retEnviNFe><cStat>100</cStat></retEnviNFe>',
      xml_autorizado: xmlAssinado()
    }), { code: 'NFE_PROC_INVALIDO' });

    const legadoComProc = obterXmlAutorizadoNota({
      chave_acesso: CHAVE,
      protocolo: PROTOCOLO,
      xml_retorno: nfeProc()
    });
    assert.match(legadoComProc.xml, /<nfeProc\b/);
  });

  it('rejeita nProt ausente e protocolo persistido divergente', () => {
    assert.throws(() => validar(`<retEnviNFe>${protNfe({ protocolo: '' })}</retEnviNFe>`), {
      code: 'PROTOCOLO_INVALIDO'
    });
    assert.throws(() => validar(nfeProc(), { protocoloPersistido: '111111111111111' }), {
      code: 'PROTOCOLO_DIVERGENTE'
    });
  });

  it('preserva o XML assinado transmitido sem reserializá-lo', () => {
    const enviado = xmlAssinado();
    const result = validar(nfeProc({ nfe: enviado }));
    const fragmento = result.xml.match(/<NFe\b[\s\S]*?<\/NFe>/)[0];
    assert.equal(fragmento, enviado.slice(enviado.indexOf('<NFe'), enviado.indexOf('</NFe>') + 6));
    assert.ok(enviado.includes('<SignatureValue>fixture</SignatureValue>'));
  });

  it('rejeita divergência entre a chave transmitida e a persistida', () => {
    const outraChave = `${CHAVE.slice(0, -1)}${CHAVE.endsWith('0') ? '1' : '0'}`;
    assert.throws(() => validar(nfeProc(), { chaveAcesso: outraChave }), {
      code: 'CHAVE_DIVERGENTE'
    });
  });

  it('rejeita versão incompatível do documento ou do protocolo', () => {
    assert.throws(() => validar(nfeProc({ versao: '3.10' })), {
      code: 'VERSAO_NFE_PROC_INVALIDA'
    });
    assert.throws(() => validar(`<retEnviNFe>${protNfe({ versao: '3.10' })}</retEnviNFe>`), {
      code: 'VERSAO_PROTOCOLO_INVALIDA'
    });
  });

  it('valida o caso reportado da NFC-e 10003 com retorno protNFe sem nfeProc', () => {
    const result = validar(`<retEnviNFe>${protNfe()}</retEnviNFe>`);
    assert.ok(result.xml.includes(`<chNFe>${CHAVE}</chNFe>`));
    assert.ok(result.xml.includes(`<nProt>${PROTOCOLO}</nProt>`));
    assert.ok(result.xml.includes('<SignatureValue>fixture</SignatureValue>'));
  });
});
