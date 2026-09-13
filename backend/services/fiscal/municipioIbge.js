/**
 * Resolução e validação de código IBGE de município (cMun × UF).
 * Base: backend/data/municipios-ibge.json gerada da API oficial do IBGE.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const UF_CODIGO = Object.freeze({
  RO: '11', AC: '12', AM: '13', RR: '14', PA: '15', AP: '16', TO: '17',
  MA: '21', PI: '22', CE: '23', RN: '24', PB: '25', PE: '26', AL: '27', SE: '28', BA: '29',
  MG: '31', ES: '32', RJ: '33', SP: '35',
  PR: '41', SC: '42', RS: '43',
  MS: '50', MT: '51', GO: '52', DF: '53'
});

let mapaMunicipios = null;

function normalizarNomeMunicipio(nome) {
  return String(nome || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim();
}

function codigoUfIbge(uf) {
  const sigla = String(uf || '').trim().toUpperCase();
  return UF_CODIGO[sigla] || null;
}

function cMunPertenceAUf(cMun, uf) {
  const codigo = String(cMun || '').replace(/\D/g, '');
  const prefUf = codigoUfIbge(uf);
  return codigo.length === 7 && !!prefUf && codigo.slice(0, 2) === prefUf;
}

function carregarMapaMunicipios() {
  if (mapaMunicipios) return mapaMunicipios;
  const arquivo = path.join(__dirname, '../../data/municipios-ibge.json');
  if (!fs.existsSync(arquivo)) {
    throw Object.assign(
      new Error('Base de municípios IBGE não encontrada (backend/data/municipios-ibge.json).'),
      { code: 'BASE_MUNICIPIOS_AUSENTE', statusCode: 500 }
    );
  }
  mapaMunicipios = JSON.parse(fs.readFileSync(arquivo, 'utf8'));
  return mapaMunicipios;
}

function lookupCodigoMunicipio(cidade, uf) {
  const sigla = String(uf || '').trim().toUpperCase();
  const nome = normalizarNomeMunicipio(cidade);
  if (!sigla || !nome) return null;
  const mapa = carregarMapaMunicipios();
  return mapa[`${sigla}|${nome}`] || null;
}

/**
 * Resolve cMun do destinatário (fornecedor). Nunca usa o município do emitente.
 */
function resolverMunicipioDestinatario({ cidade, uf, codigoMunicipio } = {}) {
  const ufLimpa = String(uf || '').trim().toUpperCase();
  const cidadeLimpa = String(cidade || '').trim();
  const informado = String(codigoMunicipio || '').replace(/\D/g, '');

  if (informado.length === 7 && cMunPertenceAUf(informado, ufLimpa)) {
    return informado;
  }

  const porNome = lookupCodigoMunicipio(cidadeLimpa, ufLimpa);
  if (porNome && cMunPertenceAUf(porNome, ufLimpa)) {
    return porNome;
  }

  return null;
}

function mensagemDestinatarioInconsistente({ uf, xMun, cMun } = {}) {
  return (
    'Dados do destinatário inconsistentes:\n' +
    'o município informado não pertence à UF do destinatário.\n\n' +
    `UF: ${uf || '—'}\n` +
    `Município: ${xMun || '—'}\n` +
    `Código IBGE: ${cMun || '—'}`
  );
}

function validarMunicipioDestinatario({ uf, xMun, cMun } = {}) {
  const ufLimpa = String(uf || '').trim().toUpperCase();
  const mun = String(xMun || '').trim();
  const codigo = String(cMun || '').replace(/\D/g, '');
  const inconsistente = !ufLimpa || !mun || codigo.length !== 7 || !cMunPertenceAUf(codigo, ufLimpa);
  if (inconsistente) {
    const erro = new Error(mensagemDestinatarioInconsistente({ uf: ufLimpa, xMun: mun, cMun: codigo }));
    erro.code = 'DEST_CMUN_UF_INCONSISTENTE';
    erro.statusCode = 400;
    erro.detalhes = { uf: ufLimpa, xMun: mun, cMun: codigo };
    throw erro;
  }
  return true;
}

module.exports = {
  UF_CODIGO,
  normalizarNomeMunicipio,
  codigoUfIbge,
  cMunPertenceAUf,
  lookupCodigoMunicipio,
  resolverMunicipioDestinatario,
  validarMunicipioDestinatario,
  mensagemDestinatarioInconsistente
};
