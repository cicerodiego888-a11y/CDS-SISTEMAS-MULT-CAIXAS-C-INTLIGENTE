const crypto = require('crypto');

/**
 * Normaliza a URL base de consulta QR Code para terminar em `?p=`.
 * Aceita bases com ou sem `?` / `?p=` (compatível com todas as UFs).
 * Sem fallback de host — a URL deve vir da configuração fiscal.
 */
function normalizarUrlBaseQr(consultaUrl) {
  const base = String(consultaUrl || '').trim();

  if (!base) {
    throw new Error(
      'URL de consulta QR Code NFC-e não configurada. ' +
      'Configure fiscal_csc_qrcode_url_producao (ambiente 1) ou ' +
      'fiscal_csc_qrcode_url_homologacao (ambiente 2).'
    );
  }

  if (/\?p=$/i.test(base)) {
    return base;
  }

  if (/\?p=/i.test(base)) {
    return base.replace(/(\?p=).*$/i, '$1');
  }

  if (base.endsWith('?')) {
    return `${base}p=`;
  }

  return `${base.replace(/\/+$/, '')}?p=`;
}

function mascararCscNaStringHash(dadosParaHash) {
  return `${dadosParaHash}***`;
}

function auditarQrCodeHomologacao({
  uf,
  tpAmb,
  versaoQR,
  urlBase,
  idToken,
  dadosParaHash,
  hashCSC,
  qrFinal
}) {
  if (Number(tpAmb) !== 2) {
    return;
  }

  console.log([
    '[FISCAL QRCODE AUDIT]',
    `UF: ${uf || '(não informado)'}`,
    `Ambiente: ${tpAmb} (Homologação)`,
    `Versão QR: ${versaoQR}`,
    `URL utilizada: ${urlBase}`,
    `ID CSC: ${idToken}`,
    `String SHA1: ${mascararCscNaStringHash(dadosParaHash)}`,
    `SHA1 gerado: ${hashCSC}`,
    `QR final: ${qrFinal}`
  ].join('\n'));
}

/**
 * Gera a URL do QR Code NFC-e (versão 2 — emissão online).
 * Algoritmo de hash: SHA-1(chNFe|2|tpAmb|cIdToken + CSC) em hex maiúsculo.
 * A URL base vem exclusivamente da configuração fiscal (sem hardcode).
 */
function gerarQRCodeNFCe({
  chave,
  ambiente,
  idCSC,
  CSC,
  consultaUrl,
  uf
}) {
  const versaoQR = '2';
  const tpAmb = String(Number(ambiente || 2));
  const idToken = String(Number(String(idCSC || '1').replace(/\D/g, '') || 1));
  const token = String(CSC || '').trim();
  const urlBase = normalizarUrlBaseQr(consultaUrl);

  const dadosParaHash = `${chave}|${versaoQR}|${tpAmb}|${idToken}`;

  const hashCSC = crypto
    .createHash('sha1')
    .update(dadosParaHash + token)
    .digest('hex')
    .toUpperCase();

  const qrFinal = `${urlBase}${chave}|${versaoQR}|${tpAmb}|${idToken}|${hashCSC}`;

  auditarQrCodeHomologacao({
    uf,
    tpAmb,
    versaoQR,
    urlBase,
    idToken,
    dadosParaHash,
    hashCSC,
    qrFinal
  });

  return qrFinal;
}

module.exports = {
  gerarQRCodeNFCe,
  normalizarUrlBaseQr
};
