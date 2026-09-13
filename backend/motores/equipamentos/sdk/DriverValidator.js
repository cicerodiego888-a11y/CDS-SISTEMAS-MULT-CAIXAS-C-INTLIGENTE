/**
 * Sprint 15.7 — DriverValidator: manifesto + classe + métodos + compatibilidade.
 */

'use strict';

const { parseManifest, isCategoriaValida, isTransporteValido, CATEGORIAS } = require('./DriverManifest');
const { avaliarCompatibilidade } = require('./DriverCompatibility');
const BaseDriver = require('../drivers/BaseDriver');

const METODOS_SDK_RECOMENDADOS = Object.freeze([
  'conectar',
  'desconectar',
  'status',
  'diagnostico',
  'informacoes',
  'fabricante',
  'modelo',
  'versao'
]);

/**
 * @param {Object} rawManifest
 * @param {Object} [opcoes]
 * @returns {{ valido: boolean, erros: string[], avisos: string[], manifesto: Object, compatibilidade: Object|null }}
 */
function validarManifest(rawManifest, opcoes = {}) {
  const erros = [];
  const avisos = [];
  const manifesto = parseManifest(rawManifest || {});

  if (!manifesto.id) erros.push('Manifest: id é obrigatório');
  if (!manifesto.fabricante) erros.push('Manifest: fabricante é obrigatório');
  if (!manifesto.modelo) erros.push('Manifest: modelo é obrigatório');
  if (!isCategoriaValida(manifesto.categoria)) {
    erros.push(`Manifest: categoria inválida (${manifesto.categoria}). Use: ${CATEGORIAS.join(', ')}`);
  }
  if (!manifesto.transportes.length) {
    avisos.push('Manifest: transportes vazio');
  } else {
    manifesto.transportes.forEach((t) => {
      if (!isTransporteValido(t)) avisos.push(`Manifest: transporte desconhecido (${t})`);
    });
  }
  if (!manifesto.protocolo && !manifesto.protocolos.length) {
    avisos.push('Manifest: protocolo não informado');
  }
  if (!manifesto.capabilitiesLista.length) {
    avisos.push('Manifest: nenhuma capability habilitada');
  }

  const compatibilidade = avaliarCompatibilidade(manifesto, opcoes);
  if (!compatibilidade.compativel) {
    erros.push(...compatibilidade.erros.map((e) => `Compatibilidade: ${e}`));
  }
  avisos.push(...compatibilidade.avisos.map((a) => `Compatibilidade: ${a}`));

  return {
    valido: erros.length === 0,
    erros,
    avisos,
    manifesto,
    compatibilidade
  };
}

/**
 * @param {Function|null} Classe
 * @param {Object} [opcoes]
 * @returns {{ valido: boolean, erros: string[], avisos: string[], heranca: Object|null }}
 */
function validarClasse(Classe, opcoes = {}) {
  const erros = [];
  const avisos = [];
  const exigirBaseDriver = opcoes.exigirBaseDriver !== false;

  if (!Classe) {
    if (opcoes.classeObrigatoria) {
      erros.push('Classe do driver não encontrada');
    } else {
      avisos.push('Classe do driver ausente (perfil somente manifesto)');
    }
    return { valido: erros.length === 0, erros, avisos, heranca: null };
  }

  if (typeof Classe !== 'function') {
    erros.push('Classe do driver inválida');
    return { valido: false, erros, avisos, heranca: null };
  }

  let heranca = null;
  if (exigirBaseDriver) {
    heranca = BaseDriver.validarHeranca(Classe);
    if (!heranca.valido) {
      // Perfis novos podem usar stub parcial — avisa em vez de bloquear se soft=true
      if (opcoes.soft === true) {
        avisos.push(...heranca.erros.map((e) => `Classe: ${e}`));
      } else {
        erros.push(...heranca.erros.map((e) => `Classe: ${e}`));
      }
    }
  }

  const proto = Classe.prototype || {};
  METODOS_SDK_RECOMENDADOS.forEach((m) => {
    if (typeof proto[m] !== 'function') {
      avisos.push(`Método recomendado ausente: ${m}`);
    }
  });

  return { valido: erros.length === 0, erros, avisos, heranca };
}

/**
 * Validação completa: manifesto + classe + compatibilidade.
 * @param {Object} entrada
 * @returns {Object}
 */
function validarDriver(entrada = {}) {
  const man = validarManifest(entrada.manifest || entrada.manifesto || entrada, entrada);
  const cls = validarClasse(entrada.Classe || null, {
    soft: entrada.soft !== false,
    classeObrigatoria: entrada.classeObrigatoria === true,
    exigirBaseDriver: entrada.exigirBaseDriver !== false
  });

  const erros = [...man.erros, ...cls.erros];
  const avisos = [...man.avisos, ...cls.avisos];

  return {
    valido: erros.length === 0,
    erros,
    avisos,
    manifesto: man.manifesto,
    compatibilidade: man.compatibilidade,
    classe: cls
  };
}

module.exports = {
  METODOS_SDK_RECOMENDADOS,
  validarManifest,
  validarClasse,
  validarDriver
};
