/**
 * Gate global de API — Hotfix RC1
 * Ordem: Autenticação → Licenciamento → (recurso nas rotas)
 */

'use strict';

const { verificarToken } = require('./auth');
const licencaMiddleware = require('./licencaMiddleware');
const { isPublicApiPath, normalizeApiPath } = require('./apiPublicPaths');

function apiAuthLicencaGate(req, res, next) {
  const apiPath = normalizeApiPath(req);

  if (isPublicApiPath(apiPath)) {
    return next();
  }

  return verificarToken(req, res, () => {
    licencaMiddleware(req, res, next);
  });
}

module.exports = {
  apiAuthLicencaGate,
  isPublicApiPath,
  normalizeApiPath
};
