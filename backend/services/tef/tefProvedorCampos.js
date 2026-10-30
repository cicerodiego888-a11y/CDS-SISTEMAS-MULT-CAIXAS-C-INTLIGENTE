'use strict';

/**
 * MRT-10/11 — Contrato genérico dos campos de mapeamento TEF no CDS.
 *
 * Persistência (tef_configuracao) é provedor-agnóstica:
 *   empresa_codigo, loja_codigo, terminal_codigo, pdv_codigo, caixa_codigo
 *
 * Interpretação é por adapter/provedor — NÃO presumir que PayGo/SiTef/Destaxa
 * usem os mesmos identificadores. Destaxa mapeia via destaxaMapeamentoTerminal.js.
 *
 * MRT-11/12 (extensibilidade):
 * - Identificação do provedor ativo: coluna `provedor` (LIMIT 1 / singleton instalação).
 * - Factory (tefFactory.criarAdapter) seleciona adapter por `registro.provedor`.
 * - Autorização (MRT-12): tefAdapterSelection consome RouteDecision.adapterBinding
 *   — sem fallback cego LIMIT 1; singleton Destaxa via COMPAT_SINGLETON do Router.
 * - Router/Allocator usam políticas por provedor (ex. GLOBAL_SERIALIZE Destaxa),
 *   sem consumir campos Destaxa (estabelecimento/loja DLL).
 * - Dois provedores persistidos na mesma instalação ainda exigem evolução de schema;
 *   Registry em memória + seleção por RouteDecision já preparam o caminho.
 */

const CAMPOS_MAPEAMENTO_TEF = Object.freeze({
  estabelecimentoProvedor: Object.freeze({
    cds: 'empresa_codigo',
    cdsApi: 'empresaCodigo',
    uiLabel: 'Estabelecimento do provedor',
    escopo: 'provedor',
    nota: 'Código oficial do provedor selecionado; interpretação pelo adapter'
  }),
  lojaProvedor: Object.freeze({
    cds: 'loja_codigo',
    cdsApi: 'lojaCodigo',
    uiLabel: 'Loja do provedor',
    escopo: 'provedor',
    nota: 'Código oficial do provedor selecionado; interpretação pelo adapter'
  }),
  terminalLogicoProvedor: Object.freeze({
    cds: 'terminal_codigo',
    cdsApi: 'terminalCodigo',
    uiLabel: 'Terminal lógico do provedor',
    escopo: 'provedor',
    nota: 'Código lógico contratado no provedor — distinto do PinPad e do pdvId CDS'
  }),
  pdvCds: Object.freeze({
    cds: 'pdv_codigo',
    cdsApi: 'pdvCodigo',
    uiLabel: 'PDV CDS',
    escopo: 'cds_local',
    nota: 'Identidade local CDS — não enviar como identificador do provedor'
  }),
  caixaCds: Object.freeze({
    cds: 'caixa_codigo',
    cdsApi: 'caixaCodigo',
    uiLabel: 'Caixa CDS',
    escopo: 'cds_local',
    nota: 'Identidade local CDS — não enviar como identificador do provedor'
  })
});

/** Interpretação conhecida por provedor (documentação; adapters reais não são alterados aqui). */
const INTERPRETACAO_POR_PROVEDOR = Object.freeze({
  destaxa: Object.freeze({
    provedor: 'destaxa',
    modulo: 'destaxa/destaxaMapeamentoTerminal.js',
    empresa_codigo: 'estabelecimento (iniciaClientDestaxa, opcional)',
    loja_codigo: 'loja (opcional)',
    terminal_codigo: 'terminal (opcional)',
    pdv_codigo: 'não enviado à DLL',
    caixa_codigo: 'não enviado à DLL',
    identidadeMaquina: 'hostname/MAC via V$PagueClient (fora destes campos)'
  }),
  sitef: Object.freeze({
    provedor: 'sitef',
    modulo: null,
    nota: 'Contrato SiTef próprio — não presumir mesmos campos Destaxa; integração futura'
  }),
  paygo: Object.freeze({
    provedor: 'paygo',
    modulo: null,
    nota: 'Contrato PayGo próprio — não presumir mesmos campos Destaxa; integração futura'
  })
});

function interpretacaoProvedor(provedor) {
  const p = String(provedor || '').toLowerCase();
  return INTERPRETACAO_POR_PROVEDOR[p] || {
    provedor: p || 'desconhecido',
    modulo: null,
    nota: 'Sem mapeamento específico documentado — adapter deve definir contrato'
  };
}

function camposLocaisCds() {
  return Object.values(CAMPOS_MAPEAMENTO_TEF).filter((c) => c.escopo === 'cds_local');
}

function camposProvedor() {
  return Object.values(CAMPOS_MAPEAMENTO_TEF).filter((c) => c.escopo === 'provedor');
}

module.exports = {
  CAMPOS_MAPEAMENTO_TEF,
  INTERPRETACAO_POR_PROVEDOR,
  interpretacaoProvedor,
  camposLocaisCds,
  camposProvedor
};
