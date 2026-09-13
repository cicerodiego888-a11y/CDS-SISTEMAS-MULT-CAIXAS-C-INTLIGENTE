const fs = require('fs');
const path = require('path');
const { SignedXml } = require('xml-crypto');
const { getFiscalSubDir } = require('./paths');

console.log('SIGNER REAL:', __filename);

function salvarDebug(nome, conteudo) {
  const pasta = getFiscalSubDir('xml/debug-assinatura');
  fs.writeFileSync(path.join(pasta, nome), String(conteudo ?? ''), 'utf8');
}

function extrairIdInfNFe(xml) {
  const match = String(xml || '').match(/<infNFe[^>]*\sId="([^"]+)"/);

  if (!match || !match[1]) {
    throw new Error('Id da infNFe não encontrado no XML.');
  }

  return match[1];
}

function limparCertificadoBase64(certPem) {
  return String(certPem || '')
    .replace(/-----BEGIN CERTIFICATE-----/g, '')
    .replace(/-----END CERTIFICATE-----/g, '')
    .replace(/\r/g, '')
    .replace(/\n/g, '')
    .trim();
}

function extrairDigestValue(xmlAssinado) {
  const match = String(xmlAssinado || '').match(/<DigestValue>(.*?)<\/DigestValue>/);

  if (!match || !match[1]) {
    throw new Error('DigestValue não encontrado no XML assinado.');
  }

  return match[1].trim();
}

function removerInfNFeSupl(xml) {
  return String(xml || '').replace(/<infNFeSupl>[\s\S]*?<\/infNFeSupl>/gi, '');
}

function assinarNFe(xml, chavePrivadaPem, certPem) {
  try {
    // RC3.16.11 — TRACE
    try {
      const { traceNfe } = require('./nfeTrace');
      traceNfe('assinarNFe', {
        bytesXml: Buffer.byteLength(String(xml || ''), 'utf8'),
        arquivo: __filename
      });
    } catch (_) { /* ignore */ }

    salvarDebug('01-xml-original.xml', xml);

    const xmlSemSupl = removerInfNFeSupl(xml);
    const idInfNFe = extrairIdInfNFe(xmlSemSupl);
    const certBase64 = limparCertificadoBase64(certPem);

    const sig = new SignedXml({
      privateKey: chavePrivadaPem,
      idAttribute: 'Id',
      signatureAlgorithm: 'http://www.w3.org/2000/09/xmldsig#rsa-sha1',
      canonicalizationAlgorithm: 'http://www.w3.org/TR/2001/REC-xml-c14n-20010315'
    });

    sig.getKeyInfoContent = () =>
      `<X509Data><X509Certificate>${certBase64}</X509Certificate></X509Data>`;

    sig.getCertFromKeyInfo = () => null;

    sig.addReference({
      xpath: `//*[@Id='${idInfNFe}']`,
      transforms: [
        'http://www.w3.org/2000/09/xmldsig#enveloped-signature',
        'http://www.w3.org/TR/2001/REC-xml-c14n-20010315'
      ],
      digestAlgorithm: 'http://www.w3.org/2000/09/xmldsig#sha1'
    });

    console.log('ANTES DO computeSignature');

    sig.computeSignature(xmlSemSupl, {
      location: {
        reference: "//*[local-name(.)='infNFe']",
        action: 'after'
      }
    });

    console.log('DEPOIS DO computeSignature');

    const xmlAssinadoBruto = sig.getSignedXml();

    if (!xmlAssinadoBruto.includes('<Signature')) {
      throw new Error('XML assinado ficou sem Signature.');
    }

    const digestValue = extrairDigestValue(xmlAssinadoBruto);

    const xmlAssinado = String(xmlAssinadoBruto || '')
      .replace(/^\s*<\?xml[^>]*\?>\s*/i, '')
      .trim();

    salvarDebug('02-xml-assinado.xml', xmlAssinado);
    salvarDebug('03-digest-value.txt', digestValue);

    return {
      xmlAssinado,
      digestValue
    };
  } catch (erro) {
    salvarDebug(
      '99-erro-assinatura.txt',
      erro && erro.stack ? erro.stack : String(erro)
    );
    throw erro;
  }
}

function extrairIdInfEvento(xml) {
  const match = String(xml || '').match(/<infEvento[^>]*\sId="([^"]+)"/);

  if (!match || !match[1]) {
    throw new Error('Id da infEvento não encontrado no XML.');
  }

  return match[1];
}

function assinarEvento(xml, chavePrivadaPem, certPem) {
  try {
    salvarDebug('01-evento-original.xml', xml);

    const idInfEvento = extrairIdInfEvento(xml);
    const certBase64 = limparCertificadoBase64(certPem);

    const sig = new SignedXml({
      privateKey: chavePrivadaPem,
      idAttribute: 'Id',
      signatureAlgorithm: 'http://www.w3.org/2000/09/xmldsig#rsa-sha1',
      canonicalizationAlgorithm: 'http://www.w3.org/TR/2001/REC-xml-c14n-20010315'
    });

    sig.getKeyInfoContent = () =>
      `<X509Data><X509Certificate>${certBase64}</X509Certificate></X509Data>`;

    sig.getCertFromKeyInfo = () => null;

    sig.addReference({
      xpath: `//*[@Id='${idInfEvento}']`,
      transforms: [
        'http://www.w3.org/2000/09/xmldsig#enveloped-signature',
        'http://www.w3.org/TR/2001/REC-xml-c14n-20010315'
      ],
      digestAlgorithm: 'http://www.w3.org/2000/09/xmldsig#sha1'
    });

    sig.computeSignature(xml, {
      location: {
        reference: "//*[local-name(.)='infEvento']",
        action: 'after'
      }
    });

    const xmlAssinado = String(sig.getSignedXml() || '')
      .replace(/^\s*<\?xml[^>]*\?>\s*/i, '')
      .trim();

    salvarDebug('02-evento-assinado.xml', xmlAssinado);

    return {
      xmlAssinado
    };
  } catch (erro) {
    salvarDebug(
      '99-erro-assinatura-evento.txt',
      erro && erro.stack ? erro.stack : String(erro)
    );
    throw erro;
  }
}

module.exports = {
  assinarNFe,
  assinarEvento
};