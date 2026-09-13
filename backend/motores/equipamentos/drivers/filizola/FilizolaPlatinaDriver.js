'use strict';

const createOfficialDriver = require('../comum/oficial/createOfficialDriver');
const perfil = require('./FilizolaOficialPerfil');

module.exports = createOfficialDriver(perfil);
