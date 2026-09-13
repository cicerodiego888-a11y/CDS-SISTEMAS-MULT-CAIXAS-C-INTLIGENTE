const { iniciarAplicacaoElectron } = require('./electron-common');

process.env.CDS_APP_MODULO = process.env.CDS_APP_MODULO || 'pdv';

iniciarAplicacaoElectron({
  tituloJanela: 'CDS Sistemas - PDV',
  modulo: 'pdv'
});
