'use strict';

const { app, safeStorage } = require('electron');
const {
  selecionarPerfilTefExistente
} = require('./services/tef/tefCryptoProfileProvisioner');
const {
  inicializarNativeHostIsolado
} = require('./services/tef/destaxa/tefNativeHostBootstrapIsolado');

const moduloArgumento = process.argv.find((argumento) => argumento.startsWith('--modulo='));
const modulo = moduloArgumento ? moduloArgumento.slice('--modulo='.length) : '';

function registrarFalha(error) {
  console.error(JSON.stringify({
    sucesso: false,
    codigo: error.code || 'TEF_BOOTSTRAP_ISOLADO_FALHOU'
  }));
  process.exitCode = 1;
}

if (!['erp', 'pdv'].includes(modulo)) {
  console.error('Uso: electron backend\\tef-nativehost-bootstrap-isolado.js --modulo=erp|pdv');
  process.exitCode = 2;
  app.quit();
} else {
  let perfilSelecionado = false;
  try {
    selecionarPerfilTefExistente({ app, modulo });
    perfilSelecionado = true;
  } catch (error) {
    registrarFalha(error);
    app.quit();
  }

  if (perfilSelecionado) {
    app.whenReady().then(async () => {
      let handle;
      try {
        handle = await inicializarNativeHostIsolado({ app, modulo, safeStorage });
        console.log(JSON.stringify({
          sucesso: true,
          processType: handle.status.processType,
          securityBootstrapState: handle.status.securityBootstrapState,
          blockedCount: handle.status.blockedFinancialIdentities.length,
          gateReal: handle.status.gateReal,
          dllLoaded: handle.status.diagnostics.dllLoaded
        }));
      } catch (error) {
        registrarFalha(error);
      } finally {
        if (handle) {
          try {
            const encerramento = await handle.encerrar();
            if (!encerramento.encerrado) {
              registrarFalha(Object.assign(
                new Error('O NativeHost não confirmou o encerramento.'),
                { code: 'TEF_BOOTSTRAP_ENCERRAMENTO_FALHOU' }
              ));
            }
          } catch (error) {
            registrarFalha(error);
          }
        }
        app.quit();
      }
    }).catch((error) => {
      registrarFalha(error);
      app.quit();
    });
  }
}
