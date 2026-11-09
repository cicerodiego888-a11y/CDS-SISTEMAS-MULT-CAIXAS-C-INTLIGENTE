process.env.CDS_APP_MODULO = 'pdv';

const { iniciarAplicacaoElectron } = require('./electron-common');

iniciarAplicacaoElectron({
  tituloJanela: 'CDS Sistemas - PDV',
  modulo: 'pdv'
});
