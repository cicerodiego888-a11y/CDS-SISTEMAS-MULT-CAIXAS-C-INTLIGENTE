'use strict';

const assert = require('assert');
const path = require('path');
const {
  validarPerfilTefOriginalSomenteLeitura,
  PROFILE_NAMES
} = require('../../backend/services/tef/tefCryptoProfileProvisioner');

const appDataPath = path.win32.normalize('C:\\Users\\Mrt53Test\\AppData\\Roaming');
const erpUserDataPath = path.win32.join(appDataPath, PROFILE_NAMES.erp);

assert.throws(
  () => validarPerfilTefOriginalSomenteLeitura({
    appName: 'cds-sistemas',
    modulo: 'pdv',
    appDataPath,
    userDataPath: erpUserDataPath,
    fsApi: {
      readFileSync() {
        throw new Error('incompatible profile must be rejected before file access');
      }
    }
  }),
  (error) => error.code === 'TEF_CONTEXTO_PERFIL_DIVERGENTE'
);

assert.throws(
  () => validarPerfilTefOriginalSomenteLeitura({
    appName: 'Electron',
    modulo: 'erp',
    appDataPath,
    userDataPath: erpUserDataPath,
    fsApi: {
      readFileSync() {
        throw new Error('generic application must be rejected before file access');
      }
    }
  }),
  (error) => error.code === 'TEF_CONTEXTO_PERFIL_DIVERGENTE'
);

console.log('MRT-50.53 profile snapshot: incompatible module and generic app rejected before file access.');
