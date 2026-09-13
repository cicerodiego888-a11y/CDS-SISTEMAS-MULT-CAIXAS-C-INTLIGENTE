/**
 * Validação de recurso de implantação — Hotfix RC1
 * Resposta padronizada: MODULO_NAO_LICENCIADO
 */

'use strict';

const configService = require('../services/configuracaoService');
const { responderModuloNaoLicenciado } = require('./errosLicenciamento');

function exigirRecurso(nomeRecurso) {
  return (req, res, next) => {
    if (configService.recursoHabilitado(nomeRecurso)) {
      return next();
    }
    return responderModuloNaoLicenciado(res, nomeRecurso);
  };
}

module.exports = {
  exigirRecurso
};
