/**
 * MUC RC2 — Catálogo oficial de regras de conversão
 * @module motores/muc/constants/catalogoRegras
 */
'use strict';

const CATALOGO_REGRAS = Object.freeze({
  UNIDADE: Object.freeze({
    id: 'MUC-R001',
    versaoRegra: '1.0.0',
    versaoMotor: 'RC2',
    dataRegra: '2026-07-31',
    motivo: 'Conversão 1:1 sem fator multiplicador',
    regraAplicada: 'UNIDADE_DIRETA'
  }),
  MULTIPLICADOR: Object.freeze({
    id: 'MUC-R002',
    versaoRegra: '1.0.0',
    versaoMotor: 'RC2',
    dataRegra: '2026-07-31',
    motivo: 'Qtd compra × fator → estoque',
    regraAplicada: 'EMBALAGEM_MULTIPLICADOR'
  }),
  DIVISOR: Object.freeze({
    id: 'MUC-R003',
    versaoRegra: '1.0.0',
    versaoMotor: 'RC2',
    dataRegra: '2026-07-31',
    motivo: 'Qtd compra ÷ fator → estoque',
    regraAplicada: 'EMBALAGEM_DIVISOR'
  }),
  PESO: Object.freeze({
    id: 'MUC-R004',
    versaoRegra: '1.0.0',
    versaoMotor: 'RC2',
    dataRegra: '2026-07-31',
    motivo: 'Conversão por peso (KG/G/SACO)',
    regraAplicada: 'PESO_VARIAVEL'
  }),
  VOLUME: Object.freeze({
    id: 'MUC-R005',
    versaoRegra: '1.0.0',
    versaoMotor: 'RC2',
    dataRegra: '2026-07-31',
    motivo: 'Conversão por volume (L/ML)',
    regraAplicada: 'VOLUME_LIQUIDO'
  }),
  LINEAR: Object.freeze({
    id: 'MUC-R006',
    versaoRegra: '1.0.0',
    versaoMotor: 'RC2',
    dataRegra: '2026-07-31',
    motivo: 'Conversão linear (MT/BOBINA/ROLO)',
    regraAplicada: 'COMPRIMENTO_LINEAR'
  }),
  KIT: Object.freeze({
    id: 'MUC-R007',
    versaoRegra: '1.0.0',
    versaoMotor: 'RC2',
    dataRegra: '2026-07-31',
    motivo: 'Kit composto — fator explícito',
    regraAplicada: 'KIT_COMPOSTO'
  }),
  PERSONALIZADO: Object.freeze({
    id: 'MUC-R999',
    versaoRegra: '1.0.0',
    versaoMotor: 'RC2',
    dataRegra: '2026-07-31',
    motivo: 'Regra customizada / fallback',
    regraAplicada: 'PERSONALIZADO'
  })
});

function resolverRegra(tipoConversao) {
  const tipo = String(tipoConversao || 'UNIDADE').toUpperCase();
  return CATALOGO_REGRAS[tipo] || CATALOGO_REGRAS.PERSONALIZADO;
}

module.exports = {
  CATALOGO_REGRAS,
  resolverRegra
};
