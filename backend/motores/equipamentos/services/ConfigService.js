/**
 * ConfigService — Configuração do Motor de Equipamentos
 */

const db = require('../../../database');

function get(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) return reject(err);
      resolve(row || null);
    });
  });
}

class ConfigService {
  async estaHabilitado() {
    const row = await get("SELECT valor FROM configuracoes WHERE chave = 'equipamentos_ativo'");
    if (!row) return true;
    const valor = String(row.valor || '').toLowerCase();
    return valor === 'true' || valor === '1';
  }

  async obterConfiguracaoGlobal() {
    const habilitado = await this.estaHabilitado();
    return {
      habilitado,
      syncAutomatica: false,
      syncIntervaloHoras: null,
      timeoutMs: Number(process.env.EQUIPAMENTOS_TIMEOUT_MS) || 5000
    };
  }

  validarConfiguracao(config) {
    const pendencias = [];
    if (!config?.nome) pendencias.push('Nome é obrigatório');
    if (config?.transporte === 'ethernet' && !config?.ip) {
      pendencias.push('IP é obrigatório para transporte Ethernet');
    }
    if (config?.transporte === 'serial' && !config?.porta_com) {
      pendencias.push('Porta COM recomendada para transporte Serial');
    }
    return { valida: pendencias.length === 0, pendencias };
  }
}

const configService = new ConfigService();

module.exports = configService;
