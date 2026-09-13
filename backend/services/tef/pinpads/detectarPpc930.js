/**
 * TEF-02 — Identificação robusta do Gertec PPC930 / família PPC-920/930.
 *
 * Funções puras (sem I/O) para testes unitários e uso pelo sdkDetector.
 */

const ESTADO_DETECCAO = Object.freeze({
  DETECTADO: 'DETECTADO',
  PARCIAL: 'PARCIAL',
  NAO_DETECTADO: 'NAO_DETECTADO',
  NAO_CONFIRMADO: 'NAO_CONFIRMADO'
});

const STATUS_EVIDENCIA = Object.freeze({
  CONFIRMADO: 'confirmado',
  NAO_CONFIRMADO: 'nao_confirmado',
  AUSENTE: 'ausente',
  INDISPONIVEL: 'indisponivel'
});

/**
 * Indica se o texto descreve claramente um PPC930 / PPC-920/930.
 * NÃO classifica USB Serial genérico, CH340, FTDI ou Bluetooth.
 */
function textoIndicaPpc930(texto) {
  const t = String(texto || '').trim();
  if (!t) return false;

  // Gertec + qualquer menção a PPC
  if (/gertec/i.test(t) && /\bppc\b/i.test(t)) {
    return true;
  }

  // PPC930 | PPC-930 | PPC 930 (borda de palavra após 930)
  if (/\bppc[\s\-]?930\b/i.test(t)) {
    return true;
  }

  // Família Windows CDC: PPC-920/930 | PPC 920/930 | PPC920/930
  if (/\bppc[\s\-]?920\s*\/\s*930\b/i.test(t)) {
    return true;
  }

  return false;
}

/**
 * Extrai COMx de um texto (ex.: "... (COM4)").
 */
function extrairPortaCom(texto) {
  const m = /\b(COM\d+)\b/i.exec(String(texto || ''));
  return m ? m[1].toUpperCase() : null;
}

/**
 * Normaliza item de porta serial.
 */
function normalizarPorta(item = {}) {
  const nome = String(item.nome || item.Name || item.FriendlyName || '');
  const descricao = String(item.descricao || item.Description || '');
  const manufacturer = String(item.manufacturer || item.Manufacturer || item.fabricante || '');
  let porta = item.porta || item.DeviceID || item.deviceId || null;
  if (porta) {
    porta = String(porta).toUpperCase();
  }
  if (!porta) {
    porta = extrairPortaCom(`${nome} ${descricao}`);
  }
  return {
    porta,
    nome,
    descricao,
    manufacturer,
    texto: `${nome} ${descricao} ${manufacturer}`.trim()
  };
}

/**
 * Classifica uma lista de portas/dispositivos quanto ao PPC930.
 * Não altera configuração — apenas analisa evidências.
 *
 * @param {Array} portas
 * @param {object} [opcoes]
 * @param {string|null} [opcoes.portaConfigurada] - ex.: COM4 (somente contexto; não muda config)
 * @param {Array} [opcoes.dispositivosPnp]
 * @param {boolean|null} [opcoes.driverConfirmado]
 * @param {boolean|null} [opcoes.usbConfirmado]
 * @param {boolean} [opcoes.verificacaoDriverDisponivel]
 * @param {boolean} [opcoes.verificacaoUsbDisponivel]
 */
function classificarDeteccaoPpc930(portas = [], opcoes = {}) {
  const lista = (Array.isArray(portas) ? portas : []).map(normalizarPorta).filter((p) => p.porta || p.texto);
  const pnp = (Array.isArray(opcoes.dispositivosPnp) ? opcoes.dispositivosPnp : [])
    .map((d) => normalizarPorta({
      nome: d.nome || d.FriendlyName,
      descricao: d.descricao || d.Description || '',
      manufacturer: d.manufacturer || d.Manufacturer,
      porta: d.porta || extrairPortaCom(d.nome || d.FriendlyName)
    }));

  const candidatosPorta = lista.filter((p) => textoIndicaPpc930(p.texto));
  const candidatosPnp = pnp.filter((p) => textoIndicaPpc930(p.texto));
  const confirmados = [...candidatosPorta];

  // PnP com porta associada e nome PPC — confirma se ainda não está na lista serial
  candidatosPnp.forEach((p) => {
    if (!p.porta) return;
    const jaTem = confirmados.some((c) => c.porta === p.porta);
    if (!jaTem) {
      confirmados.push(p);
    }
  });

  const dispositivoConfirmado = confirmados.length > 0;
  const melhor = confirmados[0] || null;

  // Porta configurada existe na enumeração, mas sem nome PPC → parcial
  const portaConfigurada = opcoes.portaConfigurada
    ? String(opcoes.portaConfigurada).toUpperCase()
    : null;
  const portaConfigNaLista = portaConfigurada
    ? lista.find((p) => p.porta === portaConfigurada)
    : null;

  let estado = ESTADO_DETECCAO.NAO_DETECTADO;
  let fonteDeteccao = null;
  let detectado = false;
  let parcial = false;

  if (dispositivoConfirmado && melhor) {
    estado = ESTADO_DETECCAO.DETECTADO;
    detectado = true;
    if (candidatosPorta.length > 0) {
      fonteDeteccao = 'windows_serial';
    } else if (candidatosPnp.length > 0) {
      fonteDeteccao = 'windows_pnp';
    } else {
      fonteDeteccao = 'windows_serial';
    }
  } else if (portaConfigNaLista && !textoIndicaPpc930(portaConfigNaLista.texto)) {
    estado = ESTADO_DETECCAO.PARCIAL;
    parcial = true;
    fonteDeteccao = 'configured_port';
  }

  // Driver / USB: null quando não confirmado (nunca false por ausência de info)
  let driver = null;
  let driverStatus = STATUS_EVIDENCIA.NAO_CONFIRMADO;
  if (opcoes.driverConfirmado === true) {
    driver = true;
    driverStatus = STATUS_EVIDENCIA.CONFIRMADO;
  } else if (opcoes.verificacaoDriverDisponivel === false) {
    driver = null;
    driverStatus = STATUS_EVIDENCIA.INDISPONIVEL;
  }

  let usb = null;
  let usbStatus = STATUS_EVIDENCIA.NAO_CONFIRMADO;
  if (opcoes.usbConfirmado === true) {
    usb = true;
    usbStatus = STATUS_EVIDENCIA.CONFIRMADO;
  } else if (opcoes.verificacaoUsbDisponivel === false) {
    usb = null;
    usbStatus = STATUS_EVIDENCIA.INDISPONIVEL;
  }

  const porta = melhor?.porta || (parcial ? portaConfigurada : null) || null;
  const portaDetectada = Boolean(
    (melhor && melhor.porta) ||
    (portaConfigurada && lista.some((p) => p.porta === portaConfigurada)) ||
    lista.some((p) => p.porta === porta)
  );

  return {
    codigo: 'GERTEC_PPC930',
    modelo: 'Gertec PPC930',
    detectado,
    estado,
    parcial,
    porta,
    driver,
    usb,
    driverStatus,
    usbStatus,
    portaDetectada,
    portaComDetectada: portaDetectada,
    dispositivoConfirmado,
    dispositivoDetectado: dispositivoConfirmado,
    driverDetectado: driver,
    usbDetectado: usb,
    usbFisicamenteConfirmado: usb === true,
    usbDiretoDetectado: usb === true,
    comSerialDetectada: portaDetectada,
    hardwareDetectado: detectado,
    fonteDeteccao,
    dispositivo: melhor
      ? {
        porta: melhor.porta,
        nome: melhor.nome,
        descricao: melhor.descricao || melhor.nome
      }
      : null,
    portasProvaveis: dispositivoConfirmado
      ? confirmados.map((p) => ({
        porta: p.porta,
        nome: p.nome,
        descricao: p.descricao,
        confirmado: true
      }))
      : (parcial && portaConfigNaLista
        ? [{
          porta: portaConfigNaLista.porta,
          nome: portaConfigNaLista.nome,
          descricao: portaConfigNaLista.descricao,
          confirmado: false
        }]
        : []),
    observacao: detectado
      ? 'Hardware PPC930 identificado via enumeração Windows (detecção ≠ operação TEF)'
      : 'PPC930 não identificado nas portas/dispositivos enumerados'
  };
}

module.exports = {
  ESTADO_DETECCAO,
  STATUS_EVIDENCIA,
  textoIndicaPpc930,
  extrairPortaCom,
  normalizarPorta,
  classificarDeteccaoPpc930
};
