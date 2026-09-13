'use strict';

const createOfficialDriver = require('../comum/oficial/createOfficialDriver');
const perfil = require('./BematechOficialPerfil');

module.exports = createOfficialDriver(perfil);
