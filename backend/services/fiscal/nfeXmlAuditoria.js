/**
 * RC3.16.10 — Auditoria completa do XML da NF-e antes do envio à SEFAZ.
 * Somente diagnóstico: NÃO altera XML, builder, assinatura, SOAP nem regras fiscais.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { onlyDigits } = require('./utils');
const { resolverNomeDestinatarioNfe } = require('./nfeRetornoAutorizacao');

/** Ordem oficial dos filhos diretos de <dest> no schema NF-e 4.00. */
const DEST_ORDEM_SCHEMA = [
  'CPF/CNPJ',
  'xNome',
  'enderDest',
  'indIEDest',
  'IE',
  'ISUF',
  'IM',
  'email'
];

const DEST_TAGS_DOC = new Set(['CPF', 'CNPJ', 'idEstrangeiro']);

function getProjectRoot() {
  return path.resolve(__dirname, '../../..');
}

function getXmlEnviadoDir() {
  const dir = path.join(getProjectRoot(), 'logs', 'nfe', 'xml-enviado');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

function timestampArquivo(date = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return (
    `${date.getFullYear()}${p(date.getMonth() + 1)}${p(date.getDate())}` +
    `-${p(date.getHours())}${p(date.getMinutes())}${p(date.getSeconds())}`
  );
}

function caminhoDiagnostico() {
  return path.join(getXmlEnviadoDir(), 'diagnostico.log');
}

function appendDiagnostico(bloco) {
  const linha = String(bloco).endsWith('\n') ? String(bloco) : `${bloco}\n`;
  const stamp = new Date().toISOString();
  const texto = `\n========== ${stamp} ==========\n${linha}`;
  try {
    fs.appendFileSync(caminhoDiagnostico(), texto, 'utf8');
  } catch (err) {
    console.error('[NFE][XML] Falha ao gravar diagnostico.log:', err.message);
  }
}

function logEGravar(prefixo, corpo) {
  const msg = `${prefixo}\n${corpo}`;
  console.log(msg);
  appendDiagnostico(msg);
}

function salvarXmlExato(nomeArquivo, conteudo) {
  const pasta = getXmlEnviadoDir();
  const arquivo = path.join(pasta, nomeArquivo);
  // Conteúdo exatamente como recebido — sem formatar / sem alterar encoding lógico
  fs.writeFileSync(arquivo, String(conteudo ?? ''), 'utf8');
  return arquivo;
}

/**
 * Espelho somente-leitura dos campos usados no DEST (não altera o builder).
 */
function resolverCamposDestDiagnostico({ config = {}, venda = {}, dadosNfe = {} } = {}) {
  const bruto = onlyDigits(
    dadosNfe.dest_cnpj
    || dadosNfe.dest_cpf
    || dadosNfe.dest_documento
    || venda.cliente_cpf
    || venda.cpf_cnpj_nota
    || venda.cliente_cnpj
    || venda.cliente_documento
    || ''
  );

  const tipoRaw = String(
    dadosNfe.dest_tipo_pessoa
    || venda.cliente_tipo_pessoa
    || venda.tipo_pessoa
    || venda.cliente_tipo
    || ''
  ).toUpperCase().trim();

  let tipoPessoa = 'DESCONHECIDO';
  if (tipoRaw === 'F' || tipoRaw === 'PF' || tipoRaw.includes('FISIC')) tipoPessoa = 'PF';
  else if (tipoRaw === 'J' || tipoRaw === 'PJ' || tipoRaw.includes('JURID')) tipoPessoa = 'PJ';
  else if (bruto.length === 11) tipoPessoa = 'PF';
  else if (bruto.length === 14) tipoPessoa = 'PJ';

  const docInvalidoZerado = !bruto
    || /^0+$/.test(bruto)
    || bruto === '00000000000000'
    || bruto === '00000000000';

  let cpf = null;
  let cnpj = null;
  if (!docInvalidoZerado) {
    if ((tipoPessoa === 'PF' && bruto.length === 11) || bruto.length === 11) {
      cpf = bruto;
      tipoPessoa = 'PF';
    } else if ((tipoPessoa === 'PJ' && bruto.length === 14) || bruto.length === 14) {
      cnpj = bruto;
      tipoPessoa = 'PJ';
    }
  }

  const ambiente = Number(config.ambiente) === 1 ? 1 : 2;
  const homologacao = ambiente === 2;
  const nome = resolverNomeDestinatarioNfe(ambiente, venda.cliente_nome);

  return {
    cpf,
    cnpj,
    nome,
    tipoPessoa,
    ambiente,
    homologacao,
    endereco: String(dadosNfe.dest_logradouro || venda.cliente_rua || ''),
    municipio: String(
      dadosNfe.dest_municipio
      || venda.cliente_cidade
      || config.municipio_nome
      || ''
    ),
    uf: String(dadosNfe.dest_uf || venda.cliente_uf || config.uf_sigla || ''),
    ie: onlyDigits(dadosNfe.dest_ie || venda.cliente_ie || venda.ie || '') || null,
    indicadorIE: dadosNfe.dest_ind_ie != null ? String(dadosNfe.dest_ind_ie) : '9'
  };
}

/**
 * Diagnóstico do DEST a partir dos dados de negócio (antes da montagem do XML).
 */
function registrarDestAntesMontagem(contexto = {}) {
  const payload = resolverCamposDestDiagnostico(contexto);
  logEGravar('[NFE][DEST]', JSON.stringify(payload, null, 4));
  return payload;
}

function extrairBlocoDest(xml) {
  const m = String(xml || '').match(/<dest\b[^>]*>[\s\S]*?<\/dest>/i);
  return m ? m[0] : null;
}

function extrairXNomeDoDest(destXml) {
  if (!destXml) return null;
  const m = String(destXml).match(/<xNome\b[^>]*>([\s\S]*?)<\/xNome>/i);
  return m ? m[1] : null;
}

function detectarCaracteresInvisiveis(texto, rotulo = 'xNome') {
  const s = texto == null ? '' : String(texto);
  const achados = [];
  for (let i = 0; i < s.length; i += 1) {
    const code = s.charCodeAt(i);
    let motivo = null;
    if (code === 0x00) motivo = 'NULL';
    else if (code === 0x09) motivo = 'TAB';
    else if (code === 0x0A) motivo = 'LF';
    else if (code === 0x0D) motivo = 'CR';
    else if (code < 0x20) motivo = 'CONTROLE';
    else if (code === 0x7F) motivo = 'DEL';
    else if (code > 0xFF) motivo = 'UNICODE_INVALIDO_TSTRING';

    if (motivo) {
      achados.push({
        posicao: i,
        char: s[i],
        codigoHex: `0x${code.toString(16).toUpperCase().padStart(2, '0')}`,
        motivo
      });
    }
  }

  if (achados.length) {
    const linhas = achados.map(
      (a) => `  pos=${a.posicao} hex=${a.codigoHex} motivo=${a.motivo}`
    ).join('\n');
    logEGravar('[NFE][XNOME][INVISIVEIS]', `${rotulo}:\n${linhas}`);
  }
  return achados;
}

/**
 * Valida xNome contra regras típicas do schema (TString + min 2 / max 60).
 * Apenas registra — NÃO corrige.
 */
function validarXNome(valorXNome) {
  const existe = valorXNome != null;
  const valor = existe ? String(valorXNome) : '';
  const qtd = valor.length;
  const soEspacos = existe && valor.trim().length === 0 && qtd > 0;
  const vazio = !existe || qtd === 0;
  const invisivel = detectarCaracteresInvisiveis(valor, 'xNome');

  // TString NF-e: [!-ÿ]{1}[ -ÿ]*[!-ÿ]{1}|[!-ÿ]{1}
  const tStringOk = /^(?:[!-\u00FF]|[!-\u00FF][ -\u00FF]*[!-\u00FF])$/.test(valor);
  const tamanhoOk = qtd >= 2 && qtd <= 60;
  const semControle = invisivel.length === 0;

  const valido = existe && !vazio && !soEspacos && tamanhoOk && tStringOk && semControle;

  const motivos = [];
  if (!existe) motivos.push('ausente');
  if (vazio) motivos.push('string_vazia');
  if (soEspacos) motivos.push('somente_espacos');
  if (!tamanhoOk) motivos.push(`tamanho_invalido(${qtd}; esperado 2..60)`);
  if (!tStringOk) motivos.push('caracteres_invalidos_TString');
  if (!semControle) motivos.push('caracteres_invisiveis_ou_controle');

  const corpo = [
    'Valor:',
    `"${valor}"`,
    '',
    `Quantidade de caracteres: ${qtd}`,
    '',
    `Válido: ${valido ? 'SIM' : 'NÃO'}`,
    motivos.length ? `Motivos: ${motivos.join(', ')}` : ''
  ].filter(Boolean).join('\n');

  logEGravar('[NFE][XNOME]', corpo);
  return { valor, qtd, valido, motivos, invisivel };
}

function normalizarTagDest(localName) {
  if (DEST_TAGS_DOC.has(localName)) return 'CPF/CNPJ';
  return localName;
}

/**
 * Extrai ordem dos elementos filhos diretos de <dest>.
 */
function extrairSequenciaDest(destXml) {
  if (!destXml) return [];
  const flat = String(destXml).replace(
    /<enderDest\b[^>]*>[\s\S]*?<\/enderDest>/i,
    '<enderDest/>'
  );
  const tags = [];
  const re = /<(CPF|CNPJ|idEstrangeiro|xNome|enderDest|indIEDest|IE|ISUF|IM|email)\b[^>]*\/?>/gi;
  let m;
  while ((m = re.exec(flat)) !== null) {
    tags.push(normalizarTagDest(m[1]));
  }
  return tags;
}

function validarOrdemDest(destXml) {
  const encontrada = extrairSequenciaDest(destXml);
  const esperadaFiltrada = DEST_ORDEM_SCHEMA.filter((t) => encontrada.includes(t));
  const esperadaUnica = [];
  for (const t of esperadaFiltrada) {
    if (!esperadaUnica.includes(t)) esperadaUnica.push(t);
  }

  const ordemOk = encontrada.length === esperadaUnica.length
    && encontrada.every((t, i) => t === esperadaUnica[i]);

  const linhasSeq = encontrada.length
    ? encontrada.join('\n')
    : '(nenhum elemento encontrado)';

  let corpo = `Sequência encontrada:\n\n${linhasSeq}`;
  if (!ordemOk) {
    corpo += `\n\nERRO DE ORDEM DETECTADO\nEsperado (relativo ao schema 4.00):\n${esperadaUnica.join('\n')}`;
  } else {
    corpo += '\n\nOrdem: OK (compatível com schema NF-e 4.00)';
  }

  logEGravar('[NFE][SCHEMA]', corpo);
  return { encontrada, esperada: esperadaUnica, ordemOk };
}

function registrarDestXml(xml) {
  const bloco = extrairBlocoDest(xml);
  if (!bloco) {
    logEGravar('[NFE][DEST_XML]', '(bloco <dest> não encontrado no XML)');
    return null;
  }
  logEGravar('[NFE][DEST_XML]', bloco);
  return bloco;
}

/**
 * Sessão de auditoria para uma emissão (timestamp único original/assinado).
 */
function iniciarAuditoriaXmlNfe(contexto = {}) {
  const ts = timestampArquivo();
  const pasta = getXmlEnviadoDir();
  let pathOriginal = null;
  let pathAssinado = null;
  let tamanhoAssinado = 0;

  // 6 — DEST antes da montagem
  registrarDestAntesMontagem(contexto);

  return {
    timestamp: ts,
    pasta,

    /**
     * Após XML Builder / antes da assinatura.
     */
    aposGerarXml(xmlOriginal) {
      const xml = String(xmlOriginal ?? '');
      pathOriginal = salvarXmlExato(`xml-original-${ts}.xml`, xml);

      const destXml = registrarDestXml(xml);
      const xNome = extrairXNomeDoDest(destXml);
      validarXNome(xNome);
      if (destXml) {
        validarOrdemDest(destXml);
        detectarCaracteresInvisiveis(destXml, 'dest');
      }

      console.log('[NFE][XML]');
      console.log(`XML Original:\n${pathOriginal}`);
      appendDiagnostico(`[NFE][XML]\nXML Original:\n${pathOriginal}`);
      return pathOriginal;
    },

    /**
     * Após assinatura — XML exatamente como será transmitido (NFe assinada).
     */
    aposAssinar(xmlAssinado) {
      const xml = String(xmlAssinado ?? '');
      pathAssinado = salvarXmlExato(`xml-assinado-${ts}.xml`, xml);
      tamanhoAssinado = Buffer.byteLength(xml, 'utf8');

      const destXml = extrairBlocoDest(xml);
      if (destXml) {
        logEGravar('[NFE][DEST_XML][ASSINADO]', destXml);
      }

      const corpo = [
        'XML Original:',
        pathOriginal || '(não gravado)',
        '',
        'XML Assinado:',
        pathAssinado,
        '',
        'Tamanho:',
        `${tamanhoAssinado} bytes`
      ].join('\n');

      logEGravar('[NFE][XML]', corpo);
      return { pathOriginal, pathAssinado, tamanhoAssinado };
    },

    /**
     * Ponto imediatamente anterior ao envio SOAP (evidência final).
     */
    antesEnvioSefaz() {
      const corpo = [
        'Pré-envio SEFAZ (auditoria RC3.16.10)',
        `XML Original: ${pathOriginal || '(n/a)'}`,
        `XML Assinado: ${pathAssinado || '(n/a)'}`,
        `Tamanho: ${tamanhoAssinado} bytes`,
        `Pasta: ${pasta}`
      ].join('\n');
      logEGravar('[NFE][XML][PRE_ENVIO]', corpo);
    }
  };
}

module.exports = {
  iniciarAuditoriaXmlNfe,
  getXmlEnviadoDir,
  extrairBlocoDest,
  extrairXNomeDoDest,
  validarXNome,
  validarOrdemDest,
  detectarCaracteresInvisiveis,
  registrarDestAntesMontagem,
  DEST_ORDEM_SCHEMA
};
