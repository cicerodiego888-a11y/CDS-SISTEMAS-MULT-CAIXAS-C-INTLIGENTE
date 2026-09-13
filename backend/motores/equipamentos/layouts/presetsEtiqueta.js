/**
 * Presets oficiais de layout de etiqueta de balança (Sprint EQUIPAMENTOS 02).
 * São apenas modelos de formulário — o parser usa a config persistida.
 */

const PRESETS_ETIQUETA = Object.freeze([
  {
    id: 'toledo_prix4_uno_valor',
    nome: 'Toledo Prix IV Uno',
    fabricante: 'Toledo',
    modelo: 'Prix IV Uno',
    layout: {
      preset_id: 'toledo_prix4_uno_valor',
      prefixo: '2',
      digitos_plu: 6,
      tipo_variavel: 'VALOR',
      posicao_inicial: 8,
      posicao_final: 12,
      digitos_variavel: 5,
      tamanho_total: 13,
      digito_verificador: true
    }
  },
  {
    id: 'toledo_prix4_uno_peso',
    nome: 'Toledo Prix IV Uno (Peso)',
    fabricante: 'Toledo',
    modelo: 'Prix IV Uno',
    layout: {
      preset_id: 'toledo_prix4_uno_peso',
      prefixo: '2',
      digitos_plu: 6,
      tipo_variavel: 'PESO',
      posicao_inicial: 8,
      posicao_final: 12,
      digitos_variavel: 5,
      tamanho_total: 13,
      digito_verificador: true
    }
  },
  {
    id: 'toledo_prix_v_valor',
    nome: 'Toledo Prix V',
    fabricante: 'Toledo',
    modelo: 'Prix V',
    layout: {
      preset_id: 'toledo_prix_v_valor',
      prefixo: '2',
      digitos_plu: 6,
      tipo_variavel: 'VALOR',
      posicao_inicial: 8,
      posicao_final: 12,
      digitos_variavel: 5,
      tamanho_total: 13,
      digito_verificador: true
    }
  },
  {
    id: 'filizola_valor',
    nome: 'Filizola',
    fabricante: 'Filizola',
    modelo: 'Padrão',
    layout: {
      preset_id: 'filizola_valor',
      prefixo: '2',
      digitos_plu: 5,
      tipo_variavel: 'VALOR',
      posicao_inicial: 7,
      posicao_final: 12,
      digitos_variavel: 6,
      tamanho_total: 13,
      digito_verificador: true
    }
  },
  {
    id: 'urano_valor',
    nome: 'Urano',
    fabricante: 'Urano',
    modelo: 'Padrão',
    layout: {
      preset_id: 'urano_valor',
      prefixo: '2',
      digitos_plu: 5,
      tipo_variavel: 'VALOR',
      posicao_inicial: 7,
      posicao_final: 12,
      digitos_variavel: 6,
      tamanho_total: 13,
      digito_verificador: true
    }
  },
  {
    id: 'elgin_valor',
    nome: 'Elgin',
    fabricante: 'Elgin',
    modelo: 'Padrão',
    layout: {
      preset_id: 'elgin_valor',
      prefixo: '2',
      digitos_plu: 5,
      tipo_variavel: 'VALOR',
      posicao_inicial: 7,
      posicao_final: 12,
      digitos_variavel: 6,
      tamanho_total: 13,
      digito_verificador: true
    }
  },
  {
    id: 'legado_cds_valor_56',
    nome: 'Legado CDS (5+6)',
    fabricante: 'CDS',
    modelo: 'Legado',
    layout: {
      preset_id: 'legado_cds_valor_56',
      prefixo: '2',
      digitos_plu: 5,
      tipo_variavel: 'VALOR',
      posicao_inicial: 7,
      posicao_final: 12,
      digitos_variavel: 6,
      tamanho_total: 13,
      digito_verificador: true
    }
  },
  {
    id: 'outro',
    nome: 'Outro',
    fabricante: '',
    modelo: '',
    layout: {
      preset_id: 'outro',
      prefixo: '2',
      digitos_plu: 6,
      tipo_variavel: 'VALOR',
      posicao_inicial: 8,
      posicao_final: 12,
      digitos_variavel: 5,
      tamanho_total: 13,
      digito_verificador: true
    }
  }
]);

/** Aliases legados MIP → preset id */
const ALIAS_LAYOUT_IDS = Object.freeze({
  legado_cds_valor_56: 'legado_cds_valor_56',
  toledo_prix4_valor_65: 'toledo_prix4_uno_valor',
  toledo_prix4_valor_55: 'toledo_prix4_uno_valor',
  toledo_prix4_peso: 'toledo_prix4_uno_peso'
});

function listarPresets() {
  return PRESETS_ETIQUETA.map((p) => ({
    id: p.id,
    nome: p.nome,
    fabricante: p.fabricante,
    modelo: p.modelo,
    layout: { ...p.layout }
  }));
}

function obterPreset(presetId) {
  const id = ALIAS_LAYOUT_IDS[presetId] || presetId;
  const found = PRESETS_ETIQUETA.find((p) => p.id === id);
  return found ? { ...found.layout } : null;
}

module.exports = {
  PRESETS_ETIQUETA,
  ALIAS_LAYOUT_IDS,
  listarPresets,
  obterPreset
};
