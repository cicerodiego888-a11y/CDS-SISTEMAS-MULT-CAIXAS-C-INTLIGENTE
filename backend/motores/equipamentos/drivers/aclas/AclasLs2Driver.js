'use strict';

const createOfficialDriver = require('../comum/oficial/createOfficialDriver');
const perfil = require('./AclasOficialPerfil');

module.exports = createOfficialDriver(perfil);
