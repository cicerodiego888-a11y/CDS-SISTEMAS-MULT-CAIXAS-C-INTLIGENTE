/**
 * Hotfix RC1.3 — QRCodeService
 * Único serviço autorizado a gerar QR Codes na plataforma CDS.
 * Internamente usa a biblioteca `qrcode`. Cache em memória por conteúdo.
 *
 * Preparado para: Portal Cliente, Boletos, PIX Dinâmico, Marketplace, Links.
 */
'use strict';

const crypto = require('crypto');
const QRCode = require('qrcode');

const USOS_FUTUROS = Object.freeze([
  'portal_cliente',
  'boletos',
  'pix_dinamico',
  'marketplace',
  'links_compartilhaveis'
]);

const cache = new Map();
const MAX_CACHE = 256;

function normalizarConteudo(valor) {
  return String(valor || '').trim();
}

function chaveCache(conteudo, formato, largura) {
  return crypto
    .createHash('sha256')
    .update(`${formato}|${largura}|${conteudo}`)
    .digest('hex');
}

function lerCache(chave) {
  const hit = cache.get(chave);
  if (!hit) return null;
  cache.delete(chave);
  cache.set(chave, hit);
  return hit;
}

function gravarCache(chave, valor) {
  if (cache.has(chave)) cache.delete(chave);
  cache.set(chave, valor);
  while (cache.size > MAX_CACHE) {
    const first = cache.keys().next().value;
    cache.delete(first);
  }
}

function limparCache() {
  cache.clear();
}

function estatisticasCache() {
  return {
    tamanho: cache.size,
    maximo: MAX_CACHE,
    usos_futuros_preparados: USOS_FUTUROS.slice()
  };
}

/**
 * Núcleo: gera QR em memória (sem arquivos).
 * @param {string} conteudo
 * @param {{ formato?: 'dataurl'|'svg'|'base64', largura?: number, uso?: string }} [opcoes]
 */
async function gerar(conteudo, opcoes = {}) {
  const texto = normalizarConteudo(conteudo);
  if (!texto) {
    return {
      sucesso: false,
      imagem: null,
      formato: null,
      cache: false,
      uso: opcoes.uso || null
    };
  }

  let formato = String(opcoes.formato || 'dataurl').toLowerCase();
  if (formato === 'base64' || formato === 'png') formato = 'dataurl';
  if (formato !== 'svg') formato = 'dataurl';

  const largura = Math.min(512, Math.max(80, Number(opcoes.largura) || 220));
  const key = chaveCache(texto, formato, largura);
  const cached = lerCache(key);
  if (cached) {
    return {
      sucesso: true,
      imagem: cached,
      formato,
      payload: texto,
      cache: true,
      uso: opcoes.uso || null
    };
  }

  const qrOpts = {
    errorCorrectionLevel: 'M',
    margin: 1,
    width: largura
  };

  const imagem = formato === 'svg'
    ? await QRCode.toString(texto, { ...qrOpts, type: 'svg' })
    : await QRCode.toDataURL(texto, qrOpts);

  gravarCache(key, imagem);

  return {
    sucesso: true,
    imagem,
    formato,
    payload: texto,
    cache: false,
    uso: opcoes.uso || null
  };
}

async function gerarBase64(conteudo, opcoes = {}) {
  const out = await gerar(conteudo, { ...opcoes, formato: 'dataurl' });
  return out.sucesso ? out.imagem : null;
}

async function gerarSvg(conteudo, opcoes = {}) {
  const out = await gerar(conteudo, { ...opcoes, formato: 'svg' });
  return out.sucesso ? out.imagem : null;
}

async function gerarLink(url, opcoes = {}) {
  return gerar(url, { ...opcoes, uso: opcoes.uso || 'link' });
}

async function gerarWhatsApp(url, opcoes = {}) {
  return gerar(url, { ...opcoes, uso: 'whatsapp' });
}

async function gerarPix(chaveOuCopiaCola, opcoes = {}) {
  return gerar(chaveOuCopiaCola, {
    ...opcoes,
    uso: opcoes.uso || 'pix_estatico'
  });
}

module.exports = {
  USOS_FUTUROS,
  gerar,
  gerarBase64,
  gerarSvg,
  gerarLink,
  gerarWhatsApp,
  gerarPix,
  limparCache,
  estatisticasCache,
  normalizarConteudo,
  _cache: cache
};
