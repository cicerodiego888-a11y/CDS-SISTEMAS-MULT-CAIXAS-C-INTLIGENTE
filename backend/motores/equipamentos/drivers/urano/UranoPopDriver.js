'use strict';

const createOfficialDriver = require('../comum/oficial/createOfficialDriver');
const perfil = require('./UranoOficialPerfil');

module.exports = createOfficialDriver(perfil);
