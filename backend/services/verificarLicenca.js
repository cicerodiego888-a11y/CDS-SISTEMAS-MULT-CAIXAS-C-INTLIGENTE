const licencaService = require('./licencaService');

async function verificarLicenca() {
  try {
    const licenca = await licencaService.obterLicenca();

    if (!licenca.codigo_licenca) {
      return {
        valido: false,
        motivo: 'PENDENTE',
        status: 'pendente',
        codigo_instalacao: licenca.codigo_instalacao
      };
    }

    if (!licenca) {
      return {
        valido: false,
        motivo: 'PENDENTE',
        status: 'pendente',
        codigo_instalacao: null,
        data_expiracao: null,
        diasRestantes: 0,
        ultima_execucao: null,
        ultima_verificacao: null
      };
    }

    const agora = new Date();
    licenca.ultima_verificacao = licenca.ultima_verificacao || null;
    licencaService.registrarExecucao();
    licencaService.atualizarUltimaVerificacao(licenca.id);

    const dataAlterada = licencaService.verificarDataAlterada(licenca.ultima_execucao);
    const diasRestantes = licencaService.diasRestantes(
      licenca.data_expiracao
    );

    const vencida = diasRestantes <= 0;
    const diasAposVencimento = vencida
      ? licencaService.calcularDiasAposVencimento(licenca.data_expiracao)
      : 0;
    const emToleranciaPdv = vencida
      ? licencaService.estaEmToleranciaPdv(licenca.data_expiracao)
      : false;

    if (dataAlterada) {
      licenca.status = 'data_alterada';
      licencaService.registrarHistorico('Tentativa de fraude', `Última execução registrada: ${licenca.ultima_execucao}`);
      return {
        valido: false,
        motivo: 'DATA_ALTERADA',
        status: licenca.status,
        codigo_instalacao: licenca.codigo_instalacao,
        data_ativacao: licenca.data_ativacao,
        data_expiracao: licenca.data_expiracao,
        diasRestantes: 0,
        diasAposVencimento,
        emToleranciaPdv: false,
        ultima_execucao: licenca.ultima_execucao,
        ultima_verificacao: agora.toISOString()
      };
    }

    if (vencida) {
      licenca.status = 'vencida';
      licencaService.registrarHistorico('Licença expirada', `Expirada em: ${licenca.data_expiracao}`);
      return {
        valido: false,
        motivo: 'VENCIDA',
        status: licenca.status,
        codigo_instalacao: licenca.codigo_instalacao,
        data_ativacao: licenca.data_ativacao,
        data_expiracao: licenca.data_expiracao,
        diasRestantes: 0,
        diasAposVencimento,
        emToleranciaPdv,
        diasToleranciaRestantes: licencaService.diasToleranciaPdvRestantes(licenca.data_expiracao),
        ultima_execucao: licenca.ultima_execucao,
        ultima_verificacao: agora.toISOString()
      };
    }

    return {
      valido: true,
      diasRestantes,
      status: licenca.status || 'ativa',
      codigo_instalacao: licenca.codigo_instalacao,
      data_ativacao: licenca.data_ativacao,
      data_expiracao: licenca.data_expiracao,
      diasAposVencimento: 0,
      emToleranciaPdv: false,
      ultima_execucao: licenca.ultima_execucao,
      ultima_verificacao: agora.toISOString()
    };
  } catch (err) {
    return {
      valido: false,
      motivo: 'ERRO_INTERNO',
      detalhes: err.message || String(err)
    };
  }
}

module.exports = verificarLicenca;
