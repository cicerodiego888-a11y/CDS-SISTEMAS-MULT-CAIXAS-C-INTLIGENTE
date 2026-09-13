/**
 * Modelo de dados do DANFE a partir do XML autorizado (somente leitura).
 * Não recalcula impostos nem altera identidade fiscal.
 */

'use strict';

function onlyDigits(v) {
  return String(v || '').replace(/\D/g, '');
}

function bloco(xml, name) {
  const m = String(xml || '').match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'i'));
  return m ? m[0] : '';
}

function tag(xml, name) {
  const m = String(xml || '').match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'i'));
  if (!m) return '';
  return String(m[1]).replace(/<[^>]+>/g, '').trim();
}

function fmtMoney(v) {
  if (v === '' || v == null) return '';
  const n = Number(v);
  if (!Number.isFinite(n)) return String(v);
  return n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtQtd(v) {
  if (v === '' || v == null) return '';
  const n = Number(v);
  if (!Number.isFinite(n)) return String(v);
  if (Number.isInteger(n)) return String(n);
  return n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 4 });
}

function fmtDoc(doc) {
  const d = onlyDigits(doc);
  if (d.length === 14) return d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
  if (d.length === 11) return d.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4');
  return doc || '';
}

function fmtNnf(n) {
  const d = String(Number(n || 0) || n || '0').replace(/\D/g, '').padStart(9, '0').slice(-9);
  return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6)}`;
}

function fmtSerie(s) {
  return String(s || '1').replace(/\D/g, '').padStart(3, '0');
}

function fmtChaveGrupos(chave) {
  const d = onlyDigits(chave).padEnd(44, ' ').slice(0, 44);
  return d.replace(/(.{4})/g, '$1 ').trim();
}

function fmtChaveLinhas(chave) {
  const grupos = fmtChaveGrupos(chave).split(/\s+/).filter(Boolean);
  return [grupos.slice(0, 6).join(' '), grupos.slice(6).join(' ')].filter(Boolean);
}

function fmtCep(cep) {
  const d = onlyDigits(cep);
  if (d.length === 8) return `${d.slice(0, 5)}-${d.slice(5)}`;
  return cep || '';
}

function fmtFone(v) {
  const d = onlyDigits(v);
  if (d.length === 11) return `(${d.slice(0, 2)})${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)})${d.slice(2, 6)}-${d.slice(6)}`;
  return v || '';
}

function linhaEnderecoEmitente(e) {
  return [e.endereco, e.bairro, e.municipio, e.uf, e.cep ? `CEP: ${e.cep}` : '']
    .filter(Boolean)
    .join(' - ');
}

function nomeEmitenteVisual(nome) {
  const s = String(nome || '').trim();
  const m = s.match(/^(.*?)[:;\s|/]+(\d{11,14})$/);
  if (m && m[1].trim()) return m[1].trim();
  return s;
}

const RODAPE_DANFE = 'Emitida no sistema CDS Sistemas';

function fmtDataIso(iso) {
  if (!iso) return '';
  const m = String(iso).match(/(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})/);
  if (m) return `${m[3]}/${m[2]}/${m[1]}`;
  const d = String(iso).match(/(\d{4})-(\d{2})-(\d{2})/);
  if (d) return `${d[3]}/${d[2]}/${d[1]}`;
  return String(iso);
}

function fmtHoraIso(iso) {
  const m = String(iso || '').match(/T(\d{2}):(\d{2}):(\d{2})/);
  return m ? `${m[1]}:${m[2]}:${m[3]}` : '';
}

function fmtDataHoraIso(iso) {
  const d = fmtDataIso(iso);
  const h = fmtHoraIso(iso);
  return [d, h].filter(Boolean).join(' ');
}

function enderecoTexto(ender) {
  const lgr = tag(ender, 'xLgr');
  const nro = tag(ender, 'nro');
  const cpl = tag(ender, 'xCpl');
  return [lgr, nro, cpl].filter(Boolean).join(', ');
}

function cstItem(imposto) {
  const icms = bloco(imposto, 'ICMS');
  return tag(icms, 'CSOSN') || tag(icms, 'CST') || '';
}

function icmsCampo(imposto, nome) {
  return tag(bloco(imposto, 'ICMS'), nome);
}

function ipiCampo(imposto, nome) {
  return tag(bloco(imposto, 'IPI'), nome);
}

function extrairItens(xml) {
  const dets = String(xml || '').match(/<det\b[\s\S]*?<\/det>/gi) || [];
  return dets.map((det) => {
    const prod = bloco(det, 'prod');
    const imposto = bloco(det, 'imposto');
    const devol = bloco(det, 'impostoDevol');
    return {
      codigo: tag(prod, 'cProd'),
      descricao: tag(prod, 'xProd'),
      ncm: tag(prod, 'NCM'),
      cst: cstItem(imposto),
      cfop: tag(prod, 'CFOP'),
      unidade: tag(prod, 'uCom'),
      qtd: tag(prod, 'qCom'),
      vUn: tag(prod, 'vUnCom'),
      vDesc: tag(prod, 'vDesc'),
      vProd: tag(prod, 'vProd'),
      vBC: icmsCampo(imposto, 'vBC'),
      vICMS: icmsCampo(imposto, 'vICMS'),
      vIPI: ipiCampo(imposto, 'vIPI') || tag(devol, 'vIPIDevol'),
      pICMS: icmsCampo(imposto, 'pICMS'),
      pIPI: ipiCampo(imposto, 'pIPI')
    };
  });
}

function montarModeloDanfe({ xml = '', extras = {} } = {}) {
  const src = String(xml || '');
  const inf = bloco(src, 'infNFe') || src;
  const ide = bloco(inf, 'ide');
  const emit = bloco(inf, 'emit');
  const dest = bloco(inf, 'dest');
  const enderEmit = bloco(emit, 'enderEmit');
  const enderDest = bloco(dest, 'enderDest');
  const tot = bloco(inf, 'ICMSTot');
  const trans = bloco(inf, 'transp');
  const vol = bloco(trans, 'vol');
  const transporta = bloco(trans, 'transporta');
  const prot = bloco(src, 'infProt') || bloco(src, 'protNFe');
  const chave = onlyDigits(extras.chave || tag(prot, 'chNFe') || (inf.match(/Id="NFe(\d{44})"/i) || [])[1]);
  const tpNF = tag(ide, 'tpNF') || extras.tpNF || '1';
  const protocolo = extras.protocolo || tag(prot, 'nProt');
  const dhRecbto = extras.dhAutorizacao || tag(prot, 'dhRecbto');
  const infCpl = tag(bloco(inf, 'infAdic'), 'infCpl');
  const refs = [];
  const refMatches = String(ide).match(/<refNFe>([^<]+)<\/refNFe>/gi) || [];
  refMatches.forEach((m) => {
    const ch = onlyDigits(m);
    if (ch) refs.push(ch);
  });
  if (extras.chaveReferenciada) refs.push(onlyDigits(extras.chaveReferenciada));

  const status = String(extras.status || 'autorizada');
  const previa = /previa|prévia|rascunho/i.test(status);
  const autorizado = !previa && /autorizad|^100$|^150$/i.test(status);

  return {
    previa,
    autorizado,
    chave,
    chaveFormatada: fmtChaveGrupos(chave),
    chaveLinhas: fmtChaveLinhas(chave),
    numero: extras.numero != null && extras.numero !== '' ? extras.numero : tag(ide, 'nNF'),
    numeroFormatado: fmtNnf(extras.numero != null && extras.numero !== '' ? extras.numero : tag(ide, 'nNF')),
    serie: extras.serie != null && extras.serie !== '' ? extras.serie : tag(ide, 'serie'),
    serieFormatada: fmtSerie(extras.serie != null && extras.serie !== '' ? extras.serie : tag(ide, 'serie')),
    natureza: extras.natureza || tag(ide, 'natOp'),
    tpNF,
    tipoLabel: String(tpNF) === '0' ? '0 - ENTRADA' : '1 - SAÍDA',
    dhEmi: tag(ide, 'dhEmi'),
    dhSaiEnt: tag(ide, 'dhSaiEnt'),
    dataEmissao: fmtDataIso(tag(ide, 'dhEmi')),
    horaEmissao: fmtHoraIso(tag(ide, 'dhEmi')),
    dataSaida: fmtDataIso(tag(ide, 'dhSaiEnt')),
    horaSaida: fmtHoraIso(tag(ide, 'dhSaiEnt')),
    protocolo,
    dhAutorizacao: fmtDataHoraIso(dhRecbto),
    emitente: {
      nome: tag(emit, 'xNome') || extras.empresa?.nome || '',
      fantasia: tag(emit, 'xFant'),
      cnpj: fmtDoc(tag(emit, 'CNPJ') || extras.empresa?.cnpj),
      ie: tag(emit, 'IE') || extras.empresa?.ie || '',
      ieSt: tag(emit, 'IEST'),
      endereco: enderecoTexto(enderEmit) || extras.empresa?.endereco || '',
      bairro: tag(enderEmit, 'xBairro'),
      municipio: tag(enderEmit, 'xMun'),
      uf: tag(enderEmit, 'UF'),
      cep: fmtCep(tag(enderEmit, 'CEP')),
      fone: fmtFone(tag(enderEmit, 'fone')),
      email: tag(emit, 'email') || extras.empresa?.email || ''
    },
    destinatario: {
      nome: tag(dest, 'xNome') || extras.venda?.cliente_nome || '',
      cnpj: fmtDoc(tag(dest, 'CNPJ') || tag(dest, 'CPF') || extras.venda?.cliente_cpf),
      ie: tag(dest, 'IE'),
      endereco: enderecoTexto(enderDest),
      bairro: tag(enderDest, 'xBairro'),
      municipio: tag(enderDest, 'xMun'),
      uf: tag(enderDest, 'UF'),
      cep: fmtCep(tag(enderDest, 'CEP')),
      fone: tag(enderDest, 'fone')
    },
    imposto: {
      vBC: tag(tot, 'vBC'),
      vICMS: tag(tot, 'vICMS'),
      vBCST: tag(tot, 'vBCST'),
      vST: tag(tot, 'vST'),
      vProd: tag(tot, 'vProd'),
      vFrete: tag(tot, 'vFrete'),
      vSeg: tag(tot, 'vSeg'),
      vDesc: tag(tot, 'vDesc'),
      vOutro: tag(tot, 'vOutro'),
      vIPI: tag(tot, 'vIPI'),
      vIPIDevol: tag(tot, 'vIPIDevol'),
      vNF: tag(tot, 'vNF')
    },
    transporte: {
      nome: tag(transporta, 'xNome'),
      modFrete: tag(trans, 'modFrete'),
      rntc: tag(bloco(trans, 'veicTransp'), 'RNTC'),
      placa: tag(bloco(trans, 'veicTransp'), 'placa'),
      ufVeic: tag(bloco(trans, 'veicTransp'), 'UF'),
      cnpj: fmtDoc(tag(transporta, 'CNPJ') || tag(transporta, 'CPF')),
      endereco: tag(transporta, 'xEnder'),
      municipio: tag(transporta, 'xMun'),
      uf: tag(transporta, 'UF'),
      ie: tag(transporta, 'IE'),
      qVol: tag(vol, 'qVol'),
      esp: tag(vol, 'esp'),
      marca: tag(vol, 'marca'),
      nVol: tag(vol, 'nVol'),
      pesoB: tag(vol, 'pesoB'),
      pesoL: tag(vol, 'pesoL')
    },
    itens: extrairItens(inf).length
      ? extrairItens(inf)
      : (extras.itens || []).map((it, i) => ({
        codigo: it.codigo || String(i + 1),
        descricao: it.produto_nome || it.descricao || '',
        ncm: it.ncm || '',
        cst: it.cst || it.csosn || '',
        cfop: it.cfop || '',
        unidade: it.unidade || 'UN',
        qtd: it.quantidade_fiscal != null ? it.quantidade_fiscal : it.quantidade,
        vUn: it.preco_unitario,
        vDesc: it.desconto || '',
        vProd: it.valor_fiscal != null ? it.valor_fiscal : it.subtotal,
        vBC: it.vBC || '',
        vICMS: it.vICMS || '',
        vIPI: it.vIPI || '',
        pICMS: it.pICMS || '',
        pIPI: it.pIPI || ''
      })),
    infCpl,
    refs: [...new Set(refs.filter(Boolean))],
    refsFormatadas: [...new Set(refs.filter(Boolean))].map(fmtChaveGrupos)
  };
}

function rotuloModFrete(cod) {
  const m = {
    0: '0-Emitente',
    1: '1-Destinatário',
    2: '2-Terceiros',
    3: '3-Próprio rem.',
    4: '4-Próprio dest.',
    9: '9-Sem frete'
  };
  return m[String(cod)] || (cod === '' || cod == null ? '' : String(cod));
}

module.exports = {
  RODAPE_DANFE,
  montarModeloDanfe,
  fmtMoney,
  fmtQtd,
  fmtNnf,
  fmtSerie,
  fmtChaveGrupos,
  fmtChaveLinhas,
  fmtCep,
  fmtFone,
  linhaEnderecoEmitente,
  nomeEmitenteVisual,
  fmtDoc,
  rotuloModFrete,
  onlyDigits,
  tag,
  bloco
};
