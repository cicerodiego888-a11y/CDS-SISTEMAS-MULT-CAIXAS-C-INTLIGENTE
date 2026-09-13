/**
 * Barreira preventiva de NF-e modelo 55 (devolução de compra/venda).
 * Nenhuma emissão pode assinar ou transmitir se a auditoria reprovar.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { getFiscalSubDir } = require('./paths');
const {
  validarXmlFiscal,
  extrairTotais,
  somarVipiDevolItensDoXml
} = require('./validarXmlFiscal');
const {
  calcularVNFSefaz,
  arredondarMoeda,
  toCentavos,
  somarMoeda,
  calcularIpiDevolucaoItem
} = require('./modeloTotais');
const {
  cMunPertenceAUf,
  lookupCodigoMunicipio,
  codigoUfIbge
} = require('./municipioIbge');

function tag(xml, name) {
  const m = String(xml || '').match(new RegExp(`<${name}(?:\\s[^>]*)?>([^<]*)</${name}>`));
  return m ? m[1] : null;
}

function bloco(xml, name) {
  const m = String(xml || '').match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`));
  return m ? m[1] : '';
}

function soDigitos(v) {
  return String(v == null ? '' : v).replace(/\D/g, '');
}

function money(n) {
  return arredondarMoeda(n).toFixed(2);
}

function erroItem({ codigo, categoria, mensagem, detalhe, item }) {
  return {
    codigo,
    categoria,
    severidade: 'ERRO',
    mensagem,
    detalhe: detalhe || mensagem,
    item: item == null ? null : item
  };
}

function nomeProdutoItem(item, det) {
  const candidatos = [
    item && item.produto_nome,
    item && item.descricao_produto,
    item && item.produto,
    item && item.xProd,
    item && item.espelhamento && item.espelhamento.original && item.espelhamento.original.xProd,
    det && det.xProd
  ];
  for (const c of candidatos) {
    const s = String(c || '').trim();
    if (s) return s;
  }
  return '';
}

function rotuloItemAuditoria(nItem, nome) {
  const n = nItem == null ? '—' : String(nItem);
  const desc = String(nome || '').trim();
  return desc ? `item ${n} (${desc})` : `item ${n}`;
}

function parseDets(xml) {
  const dets = [];
  const re = /<det\s+nItem="(\d+)"[^>]*>([\s\S]*?)<\/det>/g;
  let m;
  while ((m = re.exec(String(xml || ''))) !== null) {
    const body = m[2];
    const icms = (body.match(/<ICMS>([\s\S]*?)<\/ICMS>/) || [])[1] || '';
    const grupo = (icms.match(/<(ICMS(?:SN)?\d{2,3})\b/) || [])[1] || '';
    const ipiDevol = (body.match(/<impostoDevol>[\s\S]*?<\/impostoDevol>/) || [])[0] || '';
    dets.push({
      nItem: Number(m[1]),
      cProd: tag(body, 'cProd'),
      xProd: tag(body, 'xProd'),
      CFOP: tag(body, 'CFOP'),
      NCM: soDigitos(tag(body, 'NCM')),
      qCom: Number(tag(body, 'qCom') || 0),
      vUnCom: Number(tag(body, 'vUnCom') || 0),
      vProd: Number(tag(body, 'vProd') || 0),
      vDesc: Number(tag(body, 'vDesc') || 0),
      vFrete: Number(tag(body, 'vFrete') || 0),
      vSeg: Number(tag(body, 'vSeg') || 0),
      vOutro: Number(tag(body, 'vOutro') || 0),
      grupoIcms: grupo,
      CST: tag(icms, 'CST'),
      CSOSN: tag(icms, 'CSOSN'),
      vBC: Number(tag(icms, 'vBC') || 0),
      vICMS: Number(tag(icms, 'vICMS') || 0),
      vICMSST: Number(tag(icms, 'vICMSST') || 0),
      vFCP: Number(tag(icms, 'vFCP') || 0),
      vFCPST: Number(tag(icms, 'vFCPST') || 0),
      vFCPSTRet: Number(tag(icms, 'vFCPSTRet') || 0),
      vIPI: Number((body.match(/<IPITrib>[\s\S]*?<vIPI>([^<]*)/) || [])[1] || 0),
      vIPIDevol: Number((ipiDevol.match(/<vIPIDevol>([^<]*)/) || [])[1] || 0),
      vPIS: Number(tag(body, 'vPIS') || 0),
      vCOFINS: Number(tag(body, 'vCOFINS') || 0),
      vICMSUFDest: Number(tag(body, 'vICMSUFDest') || 0)
    });
  }
  return dets;
}

function mapearErroValidarXml(err) {
  const code = err && err.code;
  if (code === 'DEST_CMUN_UF_INCONSISTENTE') {
    return erroItem({
      codigo: 'AUD-DEST-001',
      categoria: 'DESTINATARIO',
      mensagem: err.message,
      detalhe: JSON.stringify(err.detalhes || {})
    });
  }
  if (code === 'ICMS_CRT_INCOMPATIVEL') {
    return erroItem({
      codigo: 'AUD-ICMS-CRT-001',
      categoria: 'ICMS',
      mensagem: err.message,
      detalhe: JSON.stringify(err.detalhes || {}),
      item: err.detalhes && err.detalhes.item
    });
  }
  if (code === 'XML_IPI_DEVOL_DIVERGENTE') {
    return erroItem({
      codigo: 'AUD-IPI-DEVOL-001',
      categoria: 'IPI',
      mensagem: err.message,
      detalhe: JSON.stringify(err.detalhes || {})
    });
  }
  if (code === 'ICMSTOT_INCONSISTENTE') {
    return erroItem({
      codigo: 'AUD-TOTAL-VNF-001',
      categoria: 'TOTAL',
      mensagem: err.message,
      detalhe: JSON.stringify(err.detalhes || {})
    });
  }
  return erroItem({
    codigo: 'AUD-XML-001',
    categoria: 'XML',
    mensagem: err.message || 'XML fiscal inconsistente.',
    detalhe: code || ''
  });
}

function auditarEmitente(xml, erros) {
  const emit = bloco(xml, 'emit');
  const ender = bloco(emit, 'enderEmit') || emit;
  const cnpj = soDigitos(tag(emit, 'CNPJ'));
  const xNome = String(tag(emit, 'xNome') || '').trim();
  const crt = String(tag(emit, 'CRT') || '').trim();
  const cMun = soDigitos(tag(ender, 'cMun'));
  const uf = String(tag(ender, 'UF') || '').trim().toUpperCase();
  const xMun = String(tag(ender, 'xMun') || '').trim();
  if (cnpj.length !== 14 || /^0+$/.test(cnpj)) {
    erros.push(erroItem({
      codigo: 'AUD-EMIT-001',
      categoria: 'EMITENTE',
      mensagem: 'CNPJ do emitente ausente ou inválido.'
    }));
  }
  if (!xNome) {
    erros.push(erroItem({
      codigo: 'AUD-EMIT-002',
      categoria: 'EMITENTE',
      mensagem: 'Razão social do emitente ausente.'
    }));
  }
  if (!tag(ender, 'xLgr') || !tag(ender, 'nro') || !tag(ender, 'xBairro')) {
    erros.push(erroItem({
      codigo: 'AUD-EMIT-003',
      categoria: 'EMITENTE',
      mensagem: 'Endereço do emitente incompleto.'
    }));
  }
  if (!['1', '2', '3', '4'].includes(crt)) {
    erros.push(erroItem({
      codigo: 'AUD-EMIT-004',
      categoria: 'EMITENTE',
      mensagem: `CRT do emitente inválido: ${crt || '—'}.`
    }));
  }
  if (cMun.length !== 7 || !cMunPertenceAUf(cMun, uf)) {
    erros.push(erroItem({
      codigo: 'AUD-EMIT-005',
      categoria: 'EMITENTE',
      mensagem: `Município IBGE do emitente incompatível com a UF (${xMun}/${uf}/${cMun || '—'}).`
    }));
  }
  return { cnpj, xNome, crt, cMun, uf, xMun, ie: tag(emit, 'IE') };
}

function auditarDestinatario(xml, erros) {
  const dest = bloco(xml, 'dest');
  const ender = bloco(dest, 'enderDest') || dest;
  const doc = soDigitos(tag(dest, 'CNPJ') || tag(dest, 'CPF'));
  const xNome = String(tag(dest, 'xNome') || '').trim();
  const cMun = soDigitos(tag(ender, 'cMun'));
  const uf = String(tag(ender, 'UF') || '').trim().toUpperCase();
  const xMun = String(tag(ender, 'xMun') || '').trim();
  const cep = soDigitos(tag(ender, 'CEP'));
  if (!xNome) {
    erros.push(erroItem({
      codigo: 'AUD-DEST-002',
      categoria: 'DESTINATARIO',
      mensagem: 'Nome/razão social do destinatário ausente.'
    }));
  }
  if (!(doc.length === 11 || doc.length === 14)) {
    erros.push(erroItem({
      codigo: 'AUD-DEST-003',
      categoria: 'DESTINATARIO',
      mensagem: 'CPF/CNPJ do destinatário ausente ou inválido.'
    }));
  }
  if (!tag(ender, 'xLgr') || !tag(ender, 'nro') || !tag(ender, 'xBairro') || cep.length !== 8) {
    erros.push(erroItem({
      codigo: 'AUD-DEST-004',
      categoria: 'DESTINATARIO',
      mensagem: 'Endereço do destinatário incompleto (rua, número, bairro ou CEP).'
    }));
  }
  if (!uf || !xMun || cMun.length !== 7 || !cMunPertenceAUf(cMun, uf)) {
    erros.push(erroItem({
      codigo: 'AUD-DEST-001',
      categoria: 'DESTINATARIO',
      mensagem:
        'Dados do destinatário inconsistentes: município, UF e código IBGE não representam o mesmo município.\n\n'
        + `Município: ${xMun || '—'}\nUF: ${uf || '—'}\nCódigo IBGE: ${cMun || '—'}`
    }));
  } else {
    const esperado = lookupCodigoMunicipio(xMun, uf);
    if (esperado && esperado !== cMun) {
      erros.push(erroItem({
        codigo: 'AUD-DEST-001',
        categoria: 'DESTINATARIO',
        mensagem:
          `Município "${xMun}/${uf}" deveria usar IBGE ${esperado}, mas o XML tem ${cMun}.`,
        detalhe: `esperado=${esperado}`
      }));
    }
  }
  const emitCmun = soDigitos(tag(bloco(xml, 'emit'), 'cMun'));
  const emitUf = String(tag(bloco(xml, 'emit'), 'UF') || '').trim().toUpperCase();
  if (cMun && emitCmun && cMun === emitCmun && uf && emitUf && uf !== emitUf) {
    erros.push(erroItem({
      codigo: 'AUD-DEST-005',
      categoria: 'DESTINATARIO',
      mensagem: 'O código IBGE do destinatário não pode ser o município do emitente quando a UF é outra.'
    }));
  }
  return { xNome, doc, cMun, uf, xMun, cep, ie: tag(dest, 'IE') };
}

function auditarIcmsCrt(xml, dets, erros) {
  const crt = Number(tag(bloco(xml, 'emit'), 'CRT') || 0);
  const simples = crt === 1 || crt === 4;
  for (const det of dets) {
    const grupoNormal = /^ICMS\d{2}$/.test(det.grupoIcms || '');
    const grupoSn = /^ICMSSN\d{3}$/.test(det.grupoIcms || '');
    const incompativel = simples
      ? (!!det.CST || grupoNormal || !grupoSn)
      : (!!det.CSOSN || grupoSn || !grupoNormal);
    if (incompativel) {
      erros.push(erroItem({
        codigo: 'AUD-ICMS-CRT-001',
        categoria: 'ICMS',
        item: det.nItem,
        mensagem:
          `Emitente configurado com CRT=${crt}, porém o item ${det.nItem} possui `
          + `grupo ${det.grupoIcms || '—'} com CST=${det.CST || '—'} / CSOSN=${det.CSOSN || '—'}.\n\n`
          + (simples
            ? 'Para Simples Nacional o ICMS deve utilizar grupo ICMSSN e CSOSN compatível.'
            : 'Para regime normal o ICMS deve utilizar grupo ICMS com CST compatível.')
      }));
    }
  }
}

function auditarItensProdutos(dets, erros, avisos, itensEstruturados) {
  for (const det of dets) {
    if (!det.xProd) {
      erros.push(erroItem({
        codigo: 'AUD-PROD-001',
        categoria: 'PRODUTO',
        item: det.nItem,
        mensagem: `Item ${det.nItem} sem descrição.`
      }));
    }
    if (!det.NCM || det.NCM.length !== 8) {
      erros.push(erroItem({
        codigo: 'AUD-PROD-002',
        categoria: 'PRODUTO',
        item: det.nItem,
        mensagem: `Item ${det.nItem} com NCM inválido.`
      }));
    }
    if (!(det.qCom > 0)) {
      erros.push(erroItem({
        codigo: 'AUD-PROD-003',
        categoria: 'PRODUTO',
        item: det.nItem,
        mensagem: `Item ${det.nItem} com quantidade inválida.`
      }));
    }
    const cfop = soDigitos(det.CFOP);
    if (cfop.length !== 4 || !/^[1256]/.test(cfop)) {
      erros.push(erroItem({
        codigo: 'AUD-CFOP-001',
        categoria: 'CFOP',
        item: det.nItem,
        mensagem: `Item ${det.nItem} com CFOP inválido para devolução (${det.CFOP || '—'}).`
      }));
    }
  }

  (itensEstruturados || []).forEach((item, idx) => {
    const qDev = Number(item.quantidade || 0);
    const qOrig = Number(item.quantidade_original || item.espelhamento?.quantidade_original || 0);
    const xmlItem = dets[idx];
    const rotulo = rotuloItemAuditoria(idx + 1, nomeProdutoItem(item, xmlItem));
    if (qOrig > 0 && qDev > qOrig + 1e-9) {
      erros.push(erroItem({
        codigo: 'AUD-RATEIO-001',
        categoria: 'RATEIO',
        item: idx + 1,
        mensagem: `Quantidade devolvida (${qDev}) maior que a original (${qOrig}) no ${rotulo}.`
      }));
    }
    if (qOrig > 0 && qDev > 0 && Number(item.v_ipi_original) > 0) {
      const calc = calcularIpiDevolucaoItem({
        quantidadeOriginal: qOrig,
        quantidadeDevolvida: qDev,
        vIPIOriginal: item.v_ipi_original
      });
      if (xmlItem && toCentavos(xmlItem.vIPIDevol) !== toCentavos(calc.vIPIDevol)) {
        erros.push(erroItem({
          codigo: 'AUD-RATEIO-002',
          categoria: 'IPI',
          item: idx + 1,
          mensagem:
            `IPI devolvido do ${rotulo} diverge do rateio oficial `
            + `(XML ${money(xmlItem.vIPIDevol)} × calculado ${money(calc.vIPIDevol)}).`
        }));
      }
    }
  });
}

function auditarTotais(xml, dets, totaisEstruturados, erros) {
  const tot = extrairTotais(xml);
  const soma = (campo) => somarMoeda(dets.map((d) => d[campo] || 0));
  const pares = [
    ['vProd', 'vProd', 'AUD-TOTAL-VPROD-001'],
    ['vDesc', 'vDesc', 'AUD-TOTAL-VDESC-001'],
    ['vFrete', 'vFrete', 'AUD-TOTAL-VFRETE-001'],
    ['vSeg', 'vSeg', 'AUD-TOTAL-VSEG-001'],
    ['vOutro', 'vOutro', 'AUD-TOTAL-VOUTRO-001'],
    ['vST', 'vICMSST', 'AUD-TOTAL-ST-001'],
    ['vFCPST', 'vFCPST', 'AUD-TOTAL-FCPST-001'],
    ['vFCPSTRet', 'vFCPSTRet', 'AUD-TOTAL-FCPSTRET-001'],
    ['vIPI', 'vIPI', 'AUD-TOTAL-VIPI-001'],
    ['vPIS', 'vPIS', 'AUD-TOTAL-VPIS-001'],
    ['vCOFINS', 'vCOFINS', 'AUD-TOTAL-VCOFINS-001']
  ];
  for (const [totCampo, detCampo, codigo] of pares) {
    const s = soma(detCampo);
    if (toCentavos(tot[totCampo]) !== toCentavos(s)) {
      erros.push(erroItem({
        codigo,
        categoria: totCampo === 'vST' || totCampo === 'vFCPST' ? 'ST' : 'TOTAL',
        mensagem: `ICMSTot/${totCampo}=${money(tot[totCampo])} diverge da soma dos itens (${money(s)}).`
      }));
    }
  }

  const somaIpiDevol = somarVipiDevolItensDoXml(xml);
  if (toCentavos(tot.vIPIDevol) !== toCentavos(somaIpiDevol)) {
    erros.push(erroItem({
      codigo: 'AUD-IPI-DEVOL-001',
      categoria: 'IPI',
      mensagem:
        'Total do IPI devolvido divergente da soma dos itens.\n\n'
        + `Total informado: ${money(tot.vIPIDevol)}\n`
        + `Soma dos itens: ${money(somaIpiDevol)}\n`
        + `Diferença: ${money(Math.abs(tot.vIPIDevol - somaIpiDevol))}`
    }));
  }
  if (tot.vIPIDevol > 0 && tot.vIPI > 0) {
    erros.push(erroItem({
      codigo: 'AUD-IPI-DUP-001',
      categoria: 'IPI',
      mensagem: 'IPI devolvido não pode ser duplicado em ICMSTot/vIPI.'
    }));
  }

  const vNFEsperado = calcularVNFSefaz(tot);
  const componentes = {
    vProd: tot.vProd,
    vDesc: tot.vDesc,
    vICMSDeson: tot.vICMSDeson,
    vST: tot.vST,
    vFCPST: tot.vFCPST,
    vFCPSTRet: tot.vFCPSTRet,
    vFrete: tot.vFrete,
    vSeg: tot.vSeg,
    vOutro: tot.vOutro,
    vII: tot.vII,
    vIPI: tot.vIPI,
    vIPIDevol: tot.vIPIDevol,
    vPIS: tot.vPIS,
    vCOFINS: tot.vCOFINS,
    vNF_xml: tot.vNF,
    vNF_esperado: vNFEsperado
  };
  if (toCentavos(tot.vNF) !== toCentavos(vNFEsperado)) {
    erros.push(erroItem({
      codigo: 'AUD-TOTAL-VNF-001',
      categoria: 'TOTAL',
      mensagem:
        'vNF diverge da fórmula oficial (sem PIS/COFINS).\n\n'
        + `vProd:       ${money(tot.vProd)}\n`
        + `-vDesc:         ${money(tot.vDesc)}\n`
        + `-vICMSDeson:    ${money(tot.vICMSDeson)}\n`
        + `+vST:           ${money(tot.vST)}\n`
        + `+vFCPST:        ${money(tot.vFCPST)}\n`
        + `+vFCPSTRet:     ${money(tot.vFCPSTRet)}\n`
        + `+vFrete:        ${money(tot.vFrete)}\n`
        + `+vSeg:          ${money(tot.vSeg)}\n`
        + `+vOutro:        ${money(tot.vOutro)}\n`
        + `+vII:           ${money(tot.vII)}\n`
        + `+vIPI:          ${money(tot.vIPI)}\n`
        + `+vIPIDevol:     ${money(tot.vIPIDevol)}\n`
        + '──────────────────────\n'
        + `vNF esperado: ${money(vNFEsperado)}\n`
        + `vNF XML:      ${money(tot.vNF)}`,
      detalhe: JSON.stringify(componentes)
    }));
  }

  const vNFComPisCofins = arredondarMoeda(vNFEsperado + tot.vPIS + tot.vCOFINS);
  if (tot.vPIS + tot.vCOFINS > 0 && toCentavos(tot.vNF) === toCentavos(vNFComPisCofins)) {
    erros.push(erroItem({
      codigo: 'AUD-TOTAL-VNF-001',
      categoria: 'TOTAL',
      mensagem: 'vNF contém PIS e/ou COFINS. Esses valores são informativos e não entram na fórmula oficial.'
    }));
  }

  if (totaisEstruturados && totaisEstruturados.vNF != null
    && toCentavos(totaisEstruturados.vNF) !== toCentavos(tot.vNF)) {
    erros.push(erroItem({
      codigo: 'AUD-XML-ESTRUTURA-001',
      categoria: 'XML',
      mensagem:
        `XML final diverge do objeto interno: vNF interno ${money(totaisEstruturados.vNF)} × XML ${money(tot.vNF)}.`
    }));
  }

  return { tot, componentes };
}

function auditarPagamento(xml, erros) {
  const pag = bloco(xml, 'pag');
  const tPag = tag(pag, 'tPag');
  const vPag = Number(tag(pag, 'vPag') || 0);
  if (tPag !== '90' || toCentavos(vPag) !== 0) {
    erros.push(erroItem({
      codigo: 'AUD-PAG-001',
      categoria: 'PAGAMENTO',
      mensagem: `Pagamento de devolução deve ser tPag=90 e vPag=0.00 (encontrado tPag=${tPag || '—'} vPag=${money(vPag)}).`
    }));
  }
}

function auditarEstruturaVsObjeto(xml, dets, itensEstruturados, erros) {
  if (!Array.isArray(itensEstruturados) || !itensEstruturados.length) return;
  if (itensEstruturados.length !== dets.length) {
    erros.push(erroItem({
      codigo: 'AUD-XML-ESTRUTURA-001',
      categoria: 'XML',
      mensagem:
        `XML estruturalmente divergente do objeto interno: ${itensEstruturados.length} item(ns) interno(s) × ${dets.length} det(s) no XML.`
    }));
  }
}

function auditarNumeracao(xml, erros, contexto = {}) {
  if (contexto.fase === 'pre_numeracao') return;
  const ide = bloco(xml, 'ide') || xml;
  const nNF = soDigitos(tag(ide, 'nNF'));
  const serie = soDigitos(tag(ide, 'serie'));
  const mod = soDigitos(tag(ide, 'mod')) || '55';
  const cNF = soDigitos(tag(ide, 'cNF'));
  const tpEmis = soDigitos(tag(ide, 'tpEmis')) || '1';
  if (!nNF) {
    erros.push(erroItem({
      codigo: 'AUD-NUM-001',
      categoria: 'NUMERACAO',
      mensagem: 'O número da NF-e (nNF) deve estar presente.'
    }));
  }
  if (mod !== '55') {
    erros.push(erroItem({
      codigo: 'AUD-NUM-002',
      categoria: 'NUMERACAO',
      mensagem: 'Modelo do documento deve ser 55.'
    }));
  }
  if (!serie) {
    erros.push(erroItem({
      codigo: 'AUD-NUM-003',
      categoria: 'NUMERACAO',
      mensagem: 'A série da NF-e deve estar presente.'
    }));
  }
  const conflito = (contexto.documentosPorNumero || []).filter((d) =>
    Number(d.numero) === Number(nNF)
    && Number(d.serie) === Number(serie)
    && (d.xml_enviado || d.xml_assinado)
    && Number(d.id) !== Number(contexto.ignorarNotaId || 0)
  );
  if (conflito.length) {
    erros.push(erroItem({
      codigo: 'AUD-NUM-004',
      categoria: 'NUMERACAO',
      mensagem: `Já existe emissão local ativa com o mesmo modelo/série/nNF (${nNF}/${serie}).`
    }));
  }
  const idAttr = String(xml || '').match(/Id="NFe(\d{44})"/i);
  const chave = idAttr ? idAttr[1] : '';
  if (chave.length === 44) {
    const chaveMod = chave.slice(20, 22);
    const chaveSerie = String(Number(chave.slice(22, 25)));
    const chaveNNF = String(Number(chave.slice(25, 34)));
    const chaveTp = chave.slice(34, 35);
    const chaveCNF = chave.slice(35, 43);
    if (chaveMod !== '55' || chaveSerie !== String(Number(serie)) || chaveNNF !== String(Number(nNF))
      || (tpEmis && chaveTp !== tpEmis) || (cNF && chaveCNF !== cNF.padStart(8, '0'))) {
      erros.push(erroItem({
        codigo: 'AUD-NUM-005',
        categoria: 'NUMERACAO',
        mensagem: 'A chave de acesso não corresponde a UF/AAMM/CNPJ/modelo/série/nNF/tpEmis/cNF.'
      }));
    }
  }
}

/**
 * @param {object} args
 * @param {string} args.xml
 * @param {string} [args.tipoDocumento]
 * @param {object} [args.emitente]
 * @param {object} [args.destinatario]
 * @param {Array} [args.itens]
 * @param {object} [args.totais]
 * @param {object} [args.contexto]
 */
function auditarNfe({
  tipoDocumento = 'DEVOLUCAO_COMPRA',
  emitente,
  destinatario,
  itens,
  totais,
  xml,
  contexto = {}
} = {}) {
  const erros = [];
  const avisos = [];
  const validacoes = [];

  if (!xml || typeof xml !== 'string') {
    erros.push(erroItem({
      codigo: 'AUD-XML-000',
      categoria: 'XML',
      mensagem: 'XML pré-assinatura ausente.'
    }));
    return finalizar({ tipoDocumento, erros, avisos, validacoes, contexto, emitente, destinatario, xml });
  }

  try {
    validarXmlFiscal({
      xml,
      fase: 'pre_assinatura',
      modeloDoc: '55',
      validarXsd: false
    });
    validacoes.push({ codigo: 'VALIDAR_XML_FISCAL', resultado: 'PASSOU' });
  } catch (err) {
    erros.push(mapearErroValidarXml(err));
    validacoes.push({ codigo: err.code || 'VALIDAR_XML_FISCAL', resultado: 'FALHOU' });
  }

  const emitXml = auditarEmitente(xml, erros);
  const destXml = auditarDestinatario(xml, erros);
  const dets = parseDets(xml);
  auditarIcmsCrt(xml, dets, erros);
  auditarItensProdutos(dets, erros, avisos, itens);
  const { tot, componentes } = auditarTotais(xml, dets, totais, erros);
  auditarPagamento(xml, erros);
  auditarEstruturaVsObjeto(xml, dets, itens, erros);

  if (emitente && emitente.cnpj && soDigitos(emitente.cnpj) !== emitXml.cnpj) {
    erros.push(erroItem({
      codigo: 'AUD-XML-ESTRUTURA-001',
      categoria: 'XML',
      mensagem: 'CNPJ do emitente no XML diverge da configuração da empresa.'
    }));
  }
  if (destinatario && destinatario.cMun && soDigitos(destinatario.cMun) !== destXml.cMun) {
    erros.push(erroItem({
      codigo: 'AUD-XML-ESTRUTURA-001',
      categoria: 'XML',
      mensagem: 'cMun do destinatário no XML diverge do município resolvido internamente.'
    }));
  }

  auditarNumeracao(xml, erros, contexto);

  return finalizar({
    tipoDocumento,
    erros,
    avisos,
    validacoes,
    contexto,
    emitente: emitXml,
    destinatario: destXml,
    xml,
    dets,
    tot,
    componentes
  });
}

function finalizar({
  tipoDocumento, erros, avisos, validacoes, contexto, emitente, destinatario, xml, dets, tot, componentes
}) {
  const errosUnicos = [];
  const seen = new Set();
  for (const e of erros) {
    const k = `${e.codigo}|${e.item || ''}|${e.mensagem}`;
    if (seen.has(k)) continue;
    seen.add(k);
    errosUnicos.push(e);
  }
  const relatorio = {
    timestamp: new Date().toISOString(),
    tipo: tipoDocumento,
    compraId: contexto.compraId != null ? contexto.compraId : null,
    vendaId: contexto.vendaId != null ? contexto.vendaId : null,
    nfeNumero: contexto.nfeNumero != null ? contexto.nfeNumero : null,
    aprovado: errosUnicos.length === 0,
    emitente: emitente || {},
    destinatario: destinatario || {},
    itens: {
      total: (dets || []).length,
      auditados: (dets || []).length
    },
    totais: tot || {},
    componentesVNF: componentes || {},
    validacoes,
    erros: errosUnicos,
    avisos,
    resumo: {
      totalItens: (dets || []).length,
      itensAuditados: (dets || []).length,
      erros: errosUnicos.length,
      avisos: avisos.length
    }
  };
  if (contexto.debugPrefix) {
    salvarDebugAuditoria(contexto.debugPrefix, xml, relatorio);
  }
  return relatorio;
}

function salvarDebugAuditoria(prefixo, xml, auditoria) {
  try {
    const pasta = getFiscalSubDir('debug/nfe-devolucao');
    fs.writeFileSync(path.join(pasta, `${prefixo}-xml-pre-auditoria.xml`), String(xml || ''), 'utf8');
    fs.writeFileSync(
      path.join(pasta, `${prefixo}-auditoria-fiscal.json`),
      JSON.stringify(auditoria, null, 2),
      'utf8'
    );
    if (auditoria.aprovado) {
      fs.writeFileSync(path.join(pasta, `${prefixo}-xml-auditado.xml`), String(xml || ''), 'utf8');
    }
  } catch (_) { /* debug não bloqueia */ }
}

function formatarMensagemAuditoria(auditoria) {
  const linhas = (auditoria.erros || []).map((e, i) =>
    `${i + 1}. [${e.codigo}] ${e.mensagem}`
  );
  return (
    'Auditoria fiscal reprovada. A NF-e não será assinada nem transmitida.\n\n'
    + linhas.join('\n\n')
  );
}

function erroFiscalBloqueante(auditoria) {
  const err = new Error(formatarMensagemAuditoria(auditoria));
  err.code = 'AUDITORIA_FISCAL_REPROVADA';
  err.statusCode = 400;
  err.auditoria = auditoria;
  return err;
}

function executarAuditoriaPreAssinatura(args) {
  const auditoria = auditarNfe(args);
  if (!auditoria.aprovado) {
    throw erroFiscalBloqueante(auditoria);
  }
  return auditoria;
}

module.exports = {
  auditarNfe,
  executarAuditoriaPreAssinatura,
  erroFiscalBloqueante,
  formatarMensagemAuditoria,
  salvarDebugAuditoria,
  parseDets,
  codigoUfIbge
};
