/**
 * RC8.5.2 — Padrões textuais do Motor Inteligente de Embalagens (MIE).
 * @module services/embalagens/MiePadroes
 */

'use strict';

const MAPA_UNIDADE = Object.freeze({
  PACOTE: 'PACOTE',
  PCT: 'PACOTE',
  'PCT.': 'PACOTE',
  CAIXA: 'CAIXA',
  CX: 'CAIXA',
  'CX.': 'CAIXA',
  CXA: 'CAIXA',
  FARDO: 'FARDO',
  FD: 'FARDO',
  'FD.': 'FARDO',
  DISPLAY: 'DISPLAY',
  DISP: 'DISPLAY',
  KIT: 'KIT',
  BANDEJA: 'BANDEJA',
  BDJ: 'BANDEJA',
  SACO: 'SACO',
  SC: 'SACO',
  LATA: 'LATA',
  BALDE: 'BALDE',
  ROLO: 'ROLO',
  BARRA: 'BARRA'
});

/** Unidades comerciais de embalagem (não UN/KG/L isolados). */
const UNIDADES_EMBALAGEM = Object.freeze([
  'PACOTE', 'CAIXA', 'FARDO', 'DISPLAY', 'KIT', 'BANDEJA',
  'SACO', 'LATA', 'BALDE', 'ROLO', 'BARRA'
]);

function normalizarTexto(valor) {
  return String(valor || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/,/g, '.')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizarUCom(uCom) {
  const raw = normalizarTexto(uCom).replace(/\s+/g, '');
  if (!raw || raw === 'UN' || raw === 'UND' || raw === 'UNI') return 'UN';
  if (MAPA_UNIDADE[raw]) return MAPA_UNIDADE[raw];
  if (UNIDADES_EMBALAGEM.includes(raw)) return raw;
  return raw;
}

/**
 * Extrai unidade de embalagem do texto (descrição / infAd).
 * @returns {{ unidade: string|null, match: string|null }}
 */
function extrairUnidadeDoTexto(texto) {
  const t = normalizarTexto(texto);
  if (!t) return { unidade: null, match: null };

  // Ordem: termos mais específicos / abreviações comuns
  const padroes = [
    { re: /\bPACOTES?\b|\bPCT\.?\b/, unidade: 'PACOTE' },
    { re: /\bCAIXAS?\b|\bCXA?\b|\bCX\.?\b/, unidade: 'CAIXA' },
    { re: /\bFARDOS?\b|\bFD\.?\b/, unidade: 'FARDO' },
    { re: /\bDISPLAYS?\b|\bDISP\.?\b/, unidade: 'DISPLAY' },
    { re: /\bKITS?\b/, unidade: 'KIT' },
    { re: /\bBANDEJAS?\b|\bBDJ\.?\b/, unidade: 'BANDEJA' },
    { re: /\bSACOS?\b|\bSC\.?\b/, unidade: 'SACO' },
    { re: /\bLATAS?\b/, unidade: 'LATA' },
    { re: /\bBALDES?\b/, unidade: 'BALDE' },
    { re: /\bROLOS?\b/, unidade: 'ROLO' },
    { re: /\bBARRAS?\b/, unidade: 'BARRA' }
  ];

  for (const p of padroes) {
    const m = t.match(p.re);
    if (m) return { unidade: p.unidade, match: m[0] };
  }
  return { unidade: null, match: null };
}

/**
 * Extrai quantidade por embalagem (C/12, 12 UN, 6X1.5L, COM 24…).
 * @returns {{ quantidade: number|null, match: string|null, tipo: string|null }}
 */
function extrairQuantidadeDoTexto(texto) {
  const t = normalizarTexto(texto);
  if (!t) return { quantidade: null, match: null, tipo: null };

  const tentativas = [
    { re: /\bC\s*\/\s*(\d{1,4})\b/, tipo: 'C/' },
    { re: /\bCOM\s+(\d{1,4})\b/, tipo: 'COM' },
    { re: /\bC\s+(\d{1,4})\b/, tipo: 'C' },
    { re: /\b(\d{1,4})\s*X\s*\d+(?:\.\d+)?\s*(?:ML|L|KG|G|UN|UND)?\b/, tipo: 'NxMEDIDA' },
    { re: /\b(\d{1,4})\s*X\s*(\d{1,4})\b/, tipo: 'NxN' },
    { re: /\b(\d{1,4})\s*(?:UN|UND|UNID|UNIDADES?)\b/, tipo: 'N_UN' }
  ];

  for (const p of tentativas) {
    const m = t.match(p.re);
    if (m) {
      const qtd = Number(m[1]);
      if (Number.isFinite(qtd) && qtd > 1 && qtd <= 9999) {
        return { quantidade: qtd, match: m[0], tipo: p.tipo };
      }
    }
  }
  return { quantidade: null, match: null, tipo: null };
}

/**
 * Detecta menção a peso/volume de embalagem (20KG, 1.5L) — reforça embalagem, não qty.
 */
function extrairMedidaEmbalagem(texto) {
  const t = normalizarTexto(texto);
  const m = t.match(/\b(\d+(?:\.\d+)?)\s*(KG|G|L|ML)\b/);
  if (!m) return { medida: null, match: null };
  return { medida: `${m[1]}${m[2]}`, match: m[0] };
}

module.exports = {
  MAPA_UNIDADE,
  UNIDADES_EMBALAGEM,
  normalizarTexto,
  normalizarUCom,
  extrairUnidadeDoTexto,
  extrairQuantidadeDoTexto,
  extrairMedidaEmbalagem
};
