/**
 * RC4.1.0 — Catálogo de permissões Comercial/Fiscal V4 (estrutura preparada).
 *
 * NÃO altera regras fiscais nem motores.
 * Enforcement granular é opcional/futuro: enquanto o usuário não tiver
 * nenhuma permissão do grupo, o gate permanece apenas o módulo licenciado
 * (exigirRecurso / recursoHabilitado), preservando compatibilidade.
 */

'use strict';

/** Ações canônicas do fluxo V4 */
const ACOES_COMERCIAL_FISCAL_V4 = Object.freeze({
  EXPEDIR: 'expedicao_expedir',
  FATURAR_COMERCIAL: 'expedicao_expedir', // alias semântico (= criar venda no Núcleo)
  EMITIR_NFE: 'nfe_emitir',
  CANCELAR_NFE: 'nfe_cancelar',
  REENVIAR_NFE: 'nfe_reenviar',
  CONSULTAR_NFE: 'nfe_consultar',
  EXPORTAR_XML: 'nfe_exportar_xml',
  REIMPRIMIR_DANFE: 'nfe_reimprimir_danfe',
  ALTERAR_DADOS_FISCAIS: 'nfe_alterar_dados',
  ACOES_LOTE: 'nfe_acoes_lote'
});

/** Lista para cadastro de perfis (UI/usuários) */
const PERMISSOES_COMERCIAL_FISCAL_V4 = Object.freeze([
  {
    codigo: ACOES_COMERCIAL_FISCAL_V4.EXPEDIR,
    label: 'Expedir pedido (Expedição comercial)',
    recurso: 'expedicao',
    grupo: 'comercial'
  },
  {
    codigo: ACOES_COMERCIAL_FISCAL_V4.EMITIR_NFE,
    label: 'Emitir NF-e',
    recurso: 'nfe',
    grupo: 'fiscal'
  },
  {
    codigo: ACOES_COMERCIAL_FISCAL_V4.CANCELAR_NFE,
    label: 'Cancelar NF-e',
    recurso: 'nfe',
    grupo: 'fiscal'
  },
  {
    codigo: ACOES_COMERCIAL_FISCAL_V4.REENVIAR_NFE,
    label: 'Reenviar NF-e',
    recurso: 'nfe',
    grupo: 'fiscal'
  },
  {
    codigo: ACOES_COMERCIAL_FISCAL_V4.CONSULTAR_NFE,
    label: 'Consultar situação NF-e',
    recurso: 'nfe',
    grupo: 'fiscal'
  },
  {
    codigo: ACOES_COMERCIAL_FISCAL_V4.EXPORTAR_XML,
    label: 'Exportar / visualizar XML',
    recurso: 'nfe',
    grupo: 'fiscal'
  },
  {
    codigo: ACOES_COMERCIAL_FISCAL_V4.REIMPRIMIR_DANFE,
    label: 'Reimprimir / visualizar DANFE',
    recurso: 'nfe',
    grupo: 'fiscal'
  },
  {
    codigo: ACOES_COMERCIAL_FISCAL_V4.ALTERAR_DADOS_FISCAIS,
    label: 'Alterar dados fiscais na Central',
    recurso: 'nfe',
    grupo: 'fiscal'
  },
  {
    codigo: ACOES_COMERCIAL_FISCAL_V4.ACOES_LOTE,
    label: 'Ações em lote na Central',
    recurso: 'nfe',
    grupo: 'fiscal'
  }
]);

const CODIGOS_V4 = Object.freeze(
  PERMISSOES_COMERCIAL_FISCAL_V4.map((p) => p.codigo)
);

/**
 * Verifica ação V4.
 * - Sem permissões V4 no usuário → compatível (libera; módulo já foi checado na rota).
 * - Com ao menos uma permissão V4 → exige a específica.
 *
 * @param {string[]} permissoesUsuario
 * @param {string} codigoAcao
 * @returns {{ permitido: boolean, modo: 'compat'|'rbac', motivo?: string }}
 */
function avaliarPermissaoV4(permissoesUsuario, codigoAcao) {
  const lista = Array.isArray(permissoesUsuario) ? permissoesUsuario : [];
  const temAlgumaV4 = lista.some((p) => CODIGOS_V4.includes(p));
  if (!temAlgumaV4) {
    return { permitido: true, modo: 'compat' };
  }
  if (lista.includes(codigoAcao)) {
    return { permitido: true, modo: 'rbac' };
  }
  return {
    permitido: false,
    modo: 'rbac',
    motivo: `Permissão necessária: ${codigoAcao}`
  };
}

module.exports = {
  ACOES_COMERCIAL_FISCAL_V4,
  PERMISSOES_COMERCIAL_FISCAL_V4,
  CODIGOS_V4,
  avaliarPermissaoV4
};
