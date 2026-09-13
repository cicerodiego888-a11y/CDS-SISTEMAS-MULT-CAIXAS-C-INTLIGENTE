/**
 * Hotfix RC1.1 / RC1.3 — QRCodePixGenerator
 * Compatibilidade: delega ao QRCodeService oficial.
 */
'use strict';

const QRCodeService = require('../qrcode/QRCodeService');

const MODO_PIX = Object.freeze({
  ESTATICO: 'estatico',
  DINAMICO: 'dinamico'
});

const MSG_PIX_NAO_CONFIGURADO = 'PIX ainda não configurado.';

function normalizarPayloadPix(chaveOuCopiaCola) {
  return QRCodeService.normalizarConteudo(chaveOuCopiaCola);
}

function pixConfigurado(chaveOuCopiaCola) {
  return normalizarPayloadPix(chaveOuCopiaCola).length > 0;
}

function resolverConteudoQr({ chavePix, modo, payloadDinamico }) {
  const modoNorm = String(modo || MODO_PIX.ESTATICO).toLowerCase();

  if (modoNorm === MODO_PIX.DINAMICO) {
    const dinamico = normalizarPayloadPix(payloadDinamico);
    if (dinamico) return { conteudo: dinamico, modo: MODO_PIX.DINAMICO, dinamicoAtivo: false };
    return {
      conteudo: normalizarPayloadPix(chavePix),
      modo: MODO_PIX.ESTATICO,
      dinamicoAtivo: false
    };
  }

  return {
    conteudo: normalizarPayloadPix(chavePix),
    modo: MODO_PIX.ESTATICO,
    dinamicoAtivo: false
  };
}

async function gerar(opcoes = {}) {
  const { conteudo, modo, dinamicoAtivo } = resolverConteudoQr(opcoes);

  if (!conteudo) {
    return {
      configurado: false,
      mensagem: MSG_PIX_NAO_CONFIGURADO,
      imagem: null,
      payload: '',
      modo,
      dinamico_preparado: true,
      dinamico_ativo: false
    };
  }

  const formato = String(opcoes.formato || 'dataurl').toLowerCase() === 'svg' ? 'svg' : 'dataurl';
  const out = await QRCodeService.gerarPix(conteudo, {
    formato,
    largura: opcoes.largura,
    uso: modo === MODO_PIX.DINAMICO ? 'pix_dinamico' : 'pix_estatico'
  });

  if (!out.sucesso) {
    return {
      configurado: false,
      mensagem: MSG_PIX_NAO_CONFIGURADO,
      imagem: null,
      payload: '',
      modo,
      dinamico_preparado: true,
      dinamico_ativo: false
    };
  }

  return {
    configurado: true,
    formato: out.formato,
    imagem: out.imagem,
    payload: out.payload,
    modo,
    cache: out.cache === true,
    dinamico_preparado: true,
    dinamico_ativo: dinamicoAtivo === true
  };
}

async function gerarDataUrl(chavePix, opcoes = {}) {
  const out = await gerar({ ...opcoes, chavePix, formato: 'dataurl' });
  return out.configurado ? out.imagem : null;
}

async function gerarSvg(chavePix, opcoes = {}) {
  const out = await gerar({ ...opcoes, chavePix, formato: 'svg' });
  return out.configurado ? out.imagem : null;
}

module.exports = {
  MODO_PIX,
  MSG_PIX_NAO_CONFIGURADO,
  normalizarPayloadPix,
  pixConfigurado,
  resolverConteudoQr,
  gerar,
  gerarDataUrl,
  gerarSvg,
  QRCodeService
};
