/**
 * Hotfix RC1.3 — Status da Plataforma CDS (barra do rodapé ERP).
 * Não altera regras de licenciamento/bloqueio — apenas leitura para UX.
 */
'use strict';

const path = require('path');
const fs = require('fs');
const licencaService = require('./licencaService');
const configService = require('./configuracaoService');

function lerVersaoSistema() {
  try {
    const pkgPath = path.join(__dirname, '..', '..', 'package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    const versao = String(pkg.version || '').trim();
    if (versao) return versao;
  } catch { /* ignore */ }
  return '0.0.0';
}

function formatarDataBr(isoOuData) {
  if (!isoOuData) return null;
  const d = new Date(isoOuData);
  if (Number.isNaN(d.getTime())) return null;
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = d.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

/**
 * Plano: preferência licenca_plano (config) → derivado do tipo de implantação.
 * Sem hardcode de "Enterprise" fixo — deriva do estado real do sistema.
 */
function resolverPlano(config, licenca) {
  const explicito = String(config?.licenca_plano || licenca?.plano || '').trim();
  if (explicito) return explicito;

  const tipo = String(config?.tipoImplantacao || '').toUpperCase();
  if (tipo === 'ERP_MULTICAIXA') return 'Enterprise';
  if (tipo === 'ERP_FISCAL') return 'Fiscal';
  if (tipo === 'ERP_SEM_FISCAL') return 'Essencial';
  return tipo || '—';
}

/**
 * Política oficial de cores / mensagens (assinatura).
 */
function resolverTomAssinatura({ status, diasRestantes, dataExpiracaoFmt }) {
  const statusNorm = String(status || '').toLowerCase();
  const dias = Number(diasRestantes);

  if (statusNorm === 'pendente' || !dataExpiracaoFmt) {
    return {
      tom: 'neutral',
      cor: 'cinza',
      mensagem: 'Assinatura não ativada',
      dias_restantes: 0
    };
  }

  if (statusNorm === 'data_alterada') {
    return {
      tom: 'critical',
      cor: 'vermelho',
      mensagem: 'Inconsistência de data do sistema',
      dias_restantes: Number.isFinite(dias) ? Math.max(0, dias) : 0
    };
  }

  if (statusNorm === 'vencida' || !Number.isFinite(dias) || dias <= 0) {
    return {
      tom: 'critical',
      cor: 'vermelho',
      mensagem: 'Assinatura expirada — renove em Assinatura',
      dias_restantes: 0
    };
  }

  if (dias === 1) {
    return {
      tom: 'warn-strong',
      cor: 'laranja',
      mensagem: 'Assinatura expira amanhã',
      dias_restantes: 1
    };
  }

  if (dias === 2) {
    return {
      tom: 'warn',
      cor: 'amarelo',
      mensagem: 'Assinatura expira em 2 dias',
      dias_restantes: 2
    };
  }

  if (dias === 3) {
    return {
      tom: 'warn',
      cor: 'amarelo',
      mensagem: 'Assinatura expira em 3 dias',
      dias_restantes: 3
    };
  }

  return {
    tom: 'ok',
    cor: 'verde',
    mensagem: `Assinatura válida até: ${dataExpiracaoFmt}`,
    dias_restantes: dias
  };
}

async function obterBarraStatusPlataforma() {
  const config = configService.readConfig();
  const licenca = await licencaService.obterLicenca().catch(() => null);
  const versao = lerVersaoSistema();
  const plano = resolverPlano(config, licenca);
  const dataExpiracao = licenca?.data_expiracao || null;
  const dataExpiracaoFmt = formatarDataBr(dataExpiracao);
  const diasRestantes = Number(
    licenca?.diasRestantes != null
      ? licenca.diasRestantes
      : licencaService.diasRestantes(dataExpiracao)
  );
  const status = licenca?.status || 'pendente';
  const assinatura = resolverTomAssinatura({
    status,
    diasRestantes,
    dataExpiracaoFmt
  });

  return {
    marca: 'CDS Sistemas',
    plano,
    versao,
    assinatura: {
      status,
      data_vencimento: dataExpiracao,
      data_vencimento_fmt: dataExpiracaoFmt,
      dias_restantes: assinatura.dias_restantes,
      tom: assinatura.tom,
      cor: assinatura.cor,
      mensagem: assinatura.mensagem
    },
    // Etapa 7 — arquitetura futura (não implementada)
    slots_futuros: {
      servidor: { preparado: true, ativo: false },
      backup: { preparado: true, ativo: false },
      sincronizacao: { preparado: true, ativo: false },
      portal: { preparado: true, ativo: false },
      licenca: { preparado: true, ativo: false }
    }
  };
}

module.exports = {
  lerVersaoSistema,
  formatarDataBr,
  resolverPlano,
  resolverTomAssinatura,
  obterBarraStatusPlataforma
};
