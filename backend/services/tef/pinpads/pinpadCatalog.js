/**
 * Catálogo de modelos PinPad suportados pelo CDS.
 * Comunicação física via adapter do provedor (arquitetura agnóstica).
 *
 * integracaoTefStatus:
 *   INTEGRADO     — há caminho de PinPad/provedor reconhecido no CDS
 *   NAO_INTEGRADO — modelo cadastrado para seleção/config; sem adapter TEF financeiro
 */

const INTEGRACAO_TEF = Object.freeze({
  INTEGRADO: 'INTEGRADO',
  NAO_INTEGRADO: 'NAO_INTEGRADO'
});

const MODELOS = {
  GERTEC_PPC930: {
    codigo: 'GERTEC_PPC930',
    nome: 'Gertec PPC930',
    /**
     * Rótulo de seleção: fabricante + modelo + conexão física.
     * NÃO inclui provedor TEF nem adquirente — isso vem da aba Geral / adapter.
     */
    nomeExibicao: 'Gertec PPC930 (USB CDC → COM virtual)',
    fabricante: 'Gertec',
    modelo: 'PPC930',
    interfaceEsperada: 'USB_CDC_SERIAL',
    /** Interfaces físicas já usadas no fluxo Destaxa/V$Pague — não copiar para outros modelos. */
    interfacesFisicasDocumentadas: Object.freeze(['USB_CDC_SERIAL']),
    descricaoConexao: 'USB físico → driver Gertec → COM virtual (ex.: COM3). Comunicação TEF via adapter do provedor selecionado (ex.: Destaxa/V$Pague).',
    /**
     * Hint de mercado legado — NÃO seleciona provedor TEF nem substitui Destaxa/SiTef/PayGo/Stone.
     */
    adquirenteSugerido: 'Rede',
    observacaoAdquirente: 'Adquirente sugerido é metadado comercial legado; o provedor TEF efetivo é o configurado em Geral (ex.: destaxa).',
    integracaoTefStatus: INTEGRACAO_TEF.INTEGRADO,
    ativo: true,
    aliases: [
      'PPC930',
      'GERTEC PPC930',
      'Gertec PPC930',
      'Gertec PPC930 (USB CDC → COM virtual)',
      'Gertec PPC930 (Rede/Itaú)'
    ]
  },
  VERIFONE_P200: {
    codigo: 'VERIFONE_P200',
    nome: 'Verifone P200',
    nomeExibicao: 'Verifone P200 (cadastro — TEF ainda não integrado)',
    fabricante: 'Verifone',
    modelo: 'P200',
    /**
     * Inventário físico informado pelo fabricante/mercado (USB serial / USB RNDIS).
     * NÃO declara compatibilidade TEF comprovada no CDS.
     */
    interfacesFisicasDocumentadas: Object.freeze(['USB_CDC_SERIAL', 'USB_RNDIS']),
    interfaceEsperada: null,
    descricaoConexao: 'Modelo cadastrado para seleção. Integração TEF financeira ainda não disponível no CDS.',
    adquirenteSugerido: null,
    integracaoTefStatus: INTEGRACAO_TEF.NAO_INTEGRADO,
    ativo: true,
    aliases: [
      'P200',
      'VERIFONE P200',
      'Verifone P200',
      'Verifone P200 (Stone)',
      'Stone P200'
    ]
  }
};

const ALIAS_MAP = {};

Object.values(MODELOS).forEach((item) => {
  ALIAS_MAP[item.codigo] = item;
  ALIAS_MAP[item.codigo.toLowerCase()] = item;
  ALIAS_MAP[item.modelo] = item;
  ALIAS_MAP[item.modelo.toLowerCase()] = item;
  ALIAS_MAP[item.nomeExibicao] = item;
  ALIAS_MAP[item.nomeExibicao.toLowerCase()] = item;
  (item.aliases || []).forEach((alias) => {
    ALIAS_MAP[alias] = item;
    ALIAS_MAP[String(alias).toLowerCase()] = item;
  });
});

function listarAtivos() {
  return Object.values(MODELOS).filter((m) => m.ativo !== false);
}

function resolverPorCodigo(codigo) {
  if (!codigo) return null;
  return ALIAS_MAP[codigo] || ALIAS_MAP[String(codigo).toLowerCase()] || null;
}

function resolver(config = {}) {
  const codigo = config.codigo || config.pinpadCodigo || config.pinpad_codigo;
  if (codigo) {
    const porCodigo = resolverPorCodigo(codigo);
    if (porCodigo) return porCodigo;
  }

  const modelo = String(config.modelo || config.pinpadModelo || '').trim();
  const fabricante = String(config.fabricante || '').trim();

  if (modelo) {
    const porModelo = ALIAS_MAP[modelo] || ALIAS_MAP[modelo.toLowerCase()];
    if (porModelo) return porModelo;
  }

  if (fabricante === 'Gertec' && /^ppc\s*930$/i.test(modelo)) {
    return MODELOS.GERTEC_PPC930;
  }

  if (/verifone/i.test(fabricante) && /^p\s*200$/i.test(modelo)) {
    return MODELOS.VERIFONE_P200;
  }

  return null;
}

function isGertecPPC930(config = {}) {
  const meta = resolver(config);
  return meta?.codigo === 'GERTEC_PPC930';
}

function isIntegracaoTefDisponivel(config = {}) {
  const meta = resolver(config);
  return meta?.integracaoTefStatus === INTEGRACAO_TEF.INTEGRADO;
}

module.exports = {
  MODELOS,
  INTEGRACAO_TEF,
  listarAtivos,
  resolverPorCodigo,
  resolver,
  isGertecPPC930,
  isIntegracaoTefDisponivel
};
