/**
 * BrandService — Identidade visual oficial CDS Sistemas (Branding 1.0)
 *
 * Uso Node/Electron:
 *   const BrandService = require('./assets/branding/BrandService');
 *   BrandService.fsPath('icon')
 *
 * Uso Web (via frontend/shared/js/brand-service.js):
 *   BrandService.url('logoOficial')
 */
'use strict';

const path = require('path');

const NOME = 'CDS Sistemas';
const NOME_CURTO = 'CDS';
const NOME_DISPLAY = 'CDS SISTEMAS';
const SLOGAN = 'Inteligência para gerir, Tecnologia para crescer';
const SUBTITULO = 'Plataforma Inteligente de Gestão';
const VERSAO = '1.0.0';
const COPYRIGHT = `© ${new Date().getFullYear()} CDS Sistemas`;

/** Arquivos canônicos em assets/branding/ */
const ARQUIVOS = Object.freeze({
  logoOficial: 'logo-oficial.png',
  logoAuxiliar: 'logo-auxiliar.png',
  favicon: 'favicon.ico',
  icon: 'icon.ico',
  splash: 'splash.png',
  loginBackground: 'login-background.png',
  marcaDagua: 'marca-dagua.png'
});

const WEB_BASE = '/branding';
const BRANDING_DIR = __dirname;

function arquivo(chave) {
  const nome = ARQUIVOS[chave];
  if (!nome) {
    throw new Error(`BrandService: asset desconhecido "${chave}"`);
  }
  return nome;
}

function url(chave) {
  return `${WEB_BASE}/${arquivo(chave)}`;
}

function fsPath(chave) {
  return path.join(BRANDING_DIR, arquivo(chave));
}

function dir() {
  return BRANDING_DIR;
}

function meta() {
  return {
    nome: NOME,
    nomeCurto: NOME_CURTO,
    nomeDisplay: NOME_DISPLAY,
    slogan: SLOGAN,
    subtitulo: SUBTITULO,
    versao: VERSAO,
    copyright: COPYRIGHT,
    webBase: WEB_BASE,
    arquivos: { ...ARQUIVOS }
  };
}

/** Caminhos absolutos para Electron / electron-builder */
function electronIconPath() {
  return fsPath('icon');
}

function faviconPath() {
  return fsPath('favicon');
}

module.exports = {
  NOME,
  NOME_CURTO,
  NOME_DISPLAY,
  SLOGAN,
  SUBTITULO,
  VERSAO,
  COPYRIGHT,
  ARQUIVOS,
  WEB_BASE,
  arquivo,
  url,
  fsPath,
  dir,
  meta,
  electronIconPath,
  faviconPath
};
