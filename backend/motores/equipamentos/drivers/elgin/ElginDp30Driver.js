'use strict';

const createOfficialDriver = require('../comum/oficial/createOfficialDriver');
const perfil = require('./ElginOficialPerfil');

module.exports = createOfficialDriver(perfil);
