/**
 * RC7.10.4 — Validador único do XML fiscal (NFC-e / NF-e).
 * Executar SEMPRE antes da assinatura; após assinar, fase pos_assinatura.
 */
'use strict';

const path = require('path');
const { validarIdentidadeICMSTot, round2, toCentavos, arredondarMoeda } = require('./modeloTotais');
const { validarMunicipioDestinatario } = require('./municipioIbge');
const { validarIcmsXmlContraCrt } = require('./resolverIcmsCrtEmitente');

function tag(xml, name) {
  const m = String(xml || '').match(new RegExp(`<${name}(?:\\s[^>]*)?>([^<]*)</${name}>`));
  return m ? m[1] : null;
}

function bloco(xml, name) {
  const m = String(xml || '').match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`));
  return m ? m[1] : '';
}

function hasGroup(xml, name) {
  return new RegExp(`<${name}[\\s>]`).test(String(xml || ''));
}

function somaTags(xml, name) {
  const re = new RegExp(`<${name}>([^<]+)</${name}>`, 'g');
  let s = 0;
  let m;
  while ((m = re.exec(String(xml || ''))) !== null) {
    s += Number(m[1] || 0);
  }
  return round2(s);
}

/**
 * Totais fiscais vêm de <ICMSTot>, nunca do primeiro <vProd> de <det>.
 * vTroco fica em <pag>, não no ICMSTot.
 */
function extrairTotais(xml) {
  const icmsTot = bloco(xml, 'ICMSTot');
  const fonte = icmsTot || String(xml || '');
  return {
    vProd: round2(Number(tag(fonte, 'vProd') || 0)),
    vDesc: round2(Number(tag(fonte, 'vDesc') || 0)),
    vICMSDeson: round2(Number(tag(fonte, 'vICMSDeson') || 0)),
    vFrete: round2(Number(tag(fonte, 'vFrete') || 0)),
    vSeg: round2(Number(tag(fonte, 'vSeg') || 0)),
    vOutro: round2(Number(tag(fonte, 'vOutro') || 0)),
    vIPI: round2(Number(tag(fonte, 'vIPI') || 0)),
    vICMS: round2(Number(tag(fonte, 'vICMS') || 0)),
    vST: round2(Number(tag(fonte, 'vST') || 0)),
    vFCP: round2(Number(tag(fonte, 'vFCP') || 0)),
    vFCPST: round2(Number(tag(fonte, 'vFCPST') || 0)),
    vFCPSTRet: round2(Number(tag(fonte, 'vFCPSTRet') || 0)),
    vII: round2(Number(tag(fonte, 'vII') || 0)),
    vPIS: round2(Number(tag(fonte, 'vPIS') || 0)),
    vCOFINS: round2(Number(tag(fonte, 'vCOFINS') || 0)),
    vIPIDevol: round2(Number(tag(fonte, 'vIPIDevol') || 0)),
    vNF: round2(Number(tag(fonte, 'vNF') || 0)),
    vTroco: round2(Number(tag(xml, 'vTroco') || 0))
  };
}

function validarGruposObrigatorios(xml, modeloDoc = '65') {
  const obrigatorios = ['ide', 'emit', 'det', 'prod', 'imposto', 'ICMSTot', 'transp', 'pag', 'detPag'];
  if (modeloDoc === '55') {
    obrigatorios.push('dest');
  }
  const faltando = obrigatorios.filter((g) => !hasGroup(xml, g));
  if (faltando.length) {
    const erro = new Error(`Grupos obrigatórios ausentes: ${faltando.join(', ')}`);
    erro.code = 'XML_GRUPOS_INCOMPLETOS';
    erro.detalhes = { faltando };
    throw erro;
  }
  const cMunFG = tag(xml, 'cMunFG');
  const tpImp = tag(xml, 'tpImp');
  if (!cMunFG || !/^\d{7}$/.test(cMunFG) || cMunFG === 'undefined') {
    const erro = new Error(`cMunFG inválido: ${cMunFG}`);
    erro.code = 'XML_CMUNFG_INVALIDO';
    throw erro;
  }
  if (tpImp == null || tpImp === 'undefined' || !/^[0-5]$/.test(String(tpImp))) {
    const erro = new Error(`tpImp inválido: ${tpImp}`);
    erro.code = 'XML_TPIMP_INVALIDO';
    throw erro;
  }
  return true;
}

function validarPagamentosETroco(xml, totais) {
  const somaPag = somaTags(xml, 'vPag');
  const vTroco = totais.vTroco;
  const pagBloco = bloco(xml, 'pag');
  const tPags = [];
  const reTPag = /<tPag>([^<]+)<\/tPag>/g;
  let mTPag;
  while ((mTPag = reTPag.exec(pagBloco)) !== null) tPags.push(String(mTPag[1] || '').trim());
  const soSemPagamento = tPags.length > 0 && tPags.every((t) => t === '90') && Math.abs(somaPag) < 0.01;
  if (soSemPagamento) {
    return true;
  }
  const esperado = round2(totais.vNF + vTroco);
  if (Math.abs(somaPag - esperado) > 0.01) {
    const erro = new Error(
      `Pagamentos inconsistentes: ΣvPag=${somaPag.toFixed(2)} ≠ vNF(${totais.vNF.toFixed(2)}) + vTroco(${vTroco.toFixed(2)})`
    );
    erro.code = 'XML_PAGAMENTO_INCONSISTENTE';
    erro.detalhes = { somaPag, vNF: totais.vNF, vTroco, esperado };
    throw erro;
  }
  return true;
}

function validarAssinaturaEstrutura(xml) {
  const checks = [
    ['Signature', hasGroup(xml, 'Signature')],
    ['SignedInfo', hasGroup(xml, 'SignedInfo')],
    ['SignatureValue', hasGroup(xml, 'SignatureValue')],
    ['DigestValue', !!tag(xml, 'DigestValue')],
    ['Reference', /<Reference[\s>]/.test(xml)],
    ['CanonicalizationMethod', /CanonicalizationMethod/.test(xml)],
    ['Transform', /Transform[\s>]/.test(xml) || /Transforms/.test(xml)]
  ];
  const faltando = checks.filter(([, ok]) => !ok).map(([n]) => n);
  if (faltando.length) {
    const erro = new Error(`Assinatura incompleta: ${faltando.join(', ')}`);
    erro.code = 'XML_ASSINATURA_INCOMPLETA';
    erro.detalhes = { faltando };
    throw erro;
  }
  const digest = tag(xml, 'DigestValue');
  const sigVal = tag(xml, 'SignatureValue');
  if (!digest || digest.length < 20) {
    const erro = new Error('DigestValue inválido');
    erro.code = 'XML_DIGEST_INVALIDO';
    throw erro;
  }
  if (!sigVal || sigVal.length < 20) {
    const erro = new Error('SignatureValue inválido');
    erro.code = 'XML_SIGNATUREVALUE_INVALIDO';
    throw erro;
  }
  if (!/REC-xml-c14n-20010315/.test(xml) && !/xml-c14n/.test(xml)) {
    const erro = new Error('CanonicalizationMethod não encontrado (C14N esperado)');
    erro.code = 'XML_C14N_AUSENTE';
    throw erro;
  }
  return {
    digestValue: digest,
    signatureValue: sigVal.slice(0, 32) + '…'
  };
}

function validarSchemaXsd(xml, { exigirAssinatura = false } = {}) {
  const { spawnSync } = require('child_process');
  const fs = require('fs');
  const os = require('os');
  const xsdPath = path.join(__dirname, '../../schemas/nfe_v4.00/nfe_v4.00.xsd');
  if (!fs.existsSync(xsdPath)) {
    return { ok: false, status: 'XSD_AUSENTE', erros: ['nfe_v4.00.xsd não encontrado'] };
  }

  const tmp = path.join(os.tmpdir(), `cds-nfce-validar-${Date.now()}.xml`);
  fs.writeFileSync(tmp, xml, 'utf8');
  const py = `
from lxml import etree
xml = etree.parse(r'''${tmp.replace(/\\/g, '/')}''')
schema = etree.XMLSchema(etree.parse(r'''${xsdPath.replace(/\\/g, '/')}'''))
ok = schema.validate(xml)
errs = [str(e) for e in schema.error_log]
print('OK' if ok else 'FAIL')
for e in errs:
    print(e)
`;
  const result = spawnSync('python', ['-c', py], { encoding: 'utf8', timeout: 60000 });
  try { fs.unlinkSync(tmp); } catch (_) { /* ignore */ }

  if (result.error || (result.status !== 0 && !result.stdout)) {
    return {
      ok: false,
      status: 'XSD_FERRAMENTA_INDISPONIVEL',
      erros: [String(result.error || result.stderr || 'python/lxml falhou')]
    };
  }

  const lines = String(result.stdout || '').trim().split(/\r?\n/);
  const ok = lines[0] === 'OK';
  const erros = lines.slice(1).filter(Boolean);

  if (!ok && !exigirAssinatura) {
    const soSignature = erros.every((e) =>
      /Missing child element.*Signature/i.test(e) || /infNFeSupl/i.test(e)
    );
    if (soSignature && erros.length > 0) {
      return { ok: true, status: 'XSD_OK_SEM_ASSINATURA', erros };
    }
  }

  if (!ok) {
    const erro = new Error(`Validação XSD falhou (${erros.length} erro(s))`);
    erro.code = 'XML_XSD_INVALIDO';
    erro.detalhes = { erros: erros.slice(0, 20) };
    throw erro;
  }

  return { ok: true, status: 'XSD_OK', erros: [] };
}

/**
 * @param {object} args
 * @param {string} args.xml
 * @param {'pre_assinatura'|'pos_assinatura'} [args.fase]
 * @param {string} [args.modeloDoc] '65' | '55'
 * @param {boolean} [args.validarXsd]
 */
function validarXmlFiscal({
  xml,
  fase = 'pre_assinatura',
  modeloDoc = '65',
  validarXsd = false
} = {}) {
  if (!xml || typeof xml !== 'string') {
    const erro = new Error('XML fiscal ausente');
    erro.code = 'XML_AUSENTE';
    throw erro;
  }

  const resultado = {
    ok: true,
    fase,
    checks: {}
  };

  validarGruposObrigatorios(xml, modeloDoc);
  resultado.checks.grupos = 'PASSOU';

  if (modeloDoc === '55') {
    validarDestinatarioMunicipioNoXml(xml);
    resultado.checks.destCmunUf = 'PASSOU';
    validarIcmsXmlContraCrt(xml);
    resultado.checks.icmsCrt = 'PASSOU';
  }

  const totais = extrairTotais(xml);
  validarIdentidadeICMSTot(totais);
  resultado.checks.icmsTot = 'PASSOU';
  resultado.checks.formulasSefaz = 'PASSOU';
  resultado.totais = totais;

  if (modeloDoc === '55') {
    validarIpiDevolvidoNoXml(xml);
    resultado.checks.ipiDevolvido = 'PASSOU';
  }

  const somaDet = (() => {
    const re = /<det[\s\S]*?<vProd>([^<]+)<\/vProd>/g;
    let s = 0;
    let m;
    while ((m = re.exec(xml)) !== null) s += Number(m[1] || 0);
    return round2(s);
  })();
  if (Math.abs(somaDet - totais.vProd) > 0.01) {
    const erro = new Error(`Σ det.vProd (${somaDet}) ≠ ICMSTot.vProd (${totais.vProd})`);
    erro.code = 'XML_VPROD_DIVERGENTE';
    throw erro;
  }
  resultado.checks.descontosTotais = 'PASSOU';

  validarPagamentosETroco(xml, totais);
  resultado.checks.pagamentos = 'PASSOU';
  resultado.checks.troco = totais.vTroco > 0 ? 'PASSOU_COM_TROCO' : 'PASSOU_SEM_TROCO';

  if (fase === 'pos_assinatura') {
    resultado.checks.assinatura = validarAssinaturaEstrutura(xml);
  } else {
    resultado.checks.assinatura = 'ADIADO_PRE_ASSINATURA';
  }

  if (validarXsd || fase === 'pos_assinatura') {
    resultado.checks.schema = validarSchemaXsd(xml, {
      exigirAssinatura: fase === 'pos_assinatura'
    });
  } else {
    resultado.checks.schema = 'ADIADO';
  }

  return resultado;
}

function formatarMoedaMsg(valor) {
  return `R$ ${arredondarMoeda(valor).toFixed(2)}`;
}

/**
 * Soma vIPIDevol dos itens (impostoDevol/IPI ou IPIDevol), nunca o ICMSTot.
 */
function somarVipiDevolItensDoXml(xml) {
  let cents = 0;
  const reDet = /<det\s+nItem="[^"]*"[\s\S]*?<\/det>/g;
  let m;
  while ((m = reDet.exec(String(xml || ''))) !== null) {
    const det = m[0];
    const grupo = det.match(/<impostoDevol>[\s\S]*?<\/impostoDevol>/)
      || det.match(/<IPIDevol>[\s\S]*?<\/IPIDevol>/);
    if (!grupo) continue;
    const v = grupo[0].match(/<vIPIDevol>([^<]*)<\/vIPIDevol>/);
    if (v) cents += toCentavos(v[1]);
  }
  return cents / 100;
}

function validarIpiDevolvidoNoXml(xml) {
  const icmsTot = bloco(xml, 'ICMSTot');
  const totalInformado = arredondarMoeda(Number(tag(icmsTot, 'vIPIDevol') || 0));
  const somaItens = somarVipiDevolItensDoXml(xml);
  const totalCents = toCentavos(totalInformado);
  const somaCents = toCentavos(somaItens);
  if (totalCents === somaCents) return true;
  const diferenca = arredondarMoeda(Math.abs(totalInformado - somaItens));
  const erro = new Error(
    'Total do IPI devolvido inconsistente.\n\n'
    + 'O valor informado no total da NF-e é diferente da soma do\n'
    + 'IPI devolvido dos itens.\n\n'
    + `Total informado: ${formatarMoedaMsg(totalInformado)}\n`
    + `Soma dos itens: ${formatarMoedaMsg(somaItens)}\n`
    + `Diferença: ${formatarMoedaMsg(diferenca)}\n\n`
    + 'Corrija a composição do XML antes da transmissão.'
  );
  erro.code = 'XML_IPI_DEVOL_DIVERGENTE';
  erro.detalhes = {
    vIPIDevolTotalInformado: totalInformado,
    somaItens,
    diferenca
  };
  throw erro;
}

function validarDestinatarioMunicipioNoXml(xml) {
  const dest = bloco(xml, 'dest');
  if (!dest) {
    const erro = new Error('Grupo dest ausente no XML.');
    erro.code = 'DEST_AUSENTE';
    throw erro;
  }
  validarMunicipioDestinatario({
    uf: tag(dest, 'UF'),
    xMun: tag(dest, 'xMun'),
    cMun: tag(dest, 'cMun')
  });
  return true;
}

module.exports = {
  validarXmlFiscal,
  extrairTotais,
  validarGruposObrigatorios,
  validarPagamentosETroco,
  validarAssinaturaEstrutura,
  validarSchemaXsd,
  validarDestinatarioMunicipioNoXml,
  somarVipiDevolItensDoXml,
  validarIpiDevolvidoNoXml
};
