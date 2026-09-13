/**
 * Layout HTML clássico do DANFE NF-e 55 — A4 retrato profissional.
 * Sem cards, sombras, cores da UI, logo ilustrativa ou botões na área impressa.
 */

'use strict';

const { svgCodigoBarras } = require('./danfeBarcode');
const { fmtMoney, fmtQtd, rotuloModFrete, RODAPE_DANFE, linhaEnderecoEmitente, nomeEmitenteVisual } = require('./danfeModelo');
const { paginarItensDanfe } = require('./danfePaginacao');

function esc(v) {
  return String(v == null ? '' : v)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function cel(label, valor, extraClass = '') {
  return `<div class="c ${extraClass}"><span class="l">${esc(label)}</span><div class="v">${valor === '' || valor == null ? '&nbsp;' : esc(valor)}</div></div>`;
}

function cssDanfe() {
  return `
@page { size: A4 portrait; margin: 5mm; }
* { box-sizing: border-box; }
html, body {
  margin: 0; padding: 0; background: #fff; color: #000;
  font-family: Arial, Helvetica, sans-serif;
}
.danfe-toolbar, .no-print { display: block; }
.danfe-page {
  width: 200mm;
  min-height: 287mm;
  margin: 0 auto 6mm;
  page-break-after: always;
  break-after: page;
}
.danfe-page:last-child { page-break-after: auto; break-after: auto; }
table { border-collapse: collapse; width: 100%; }
.row { display: flex; width: 100%; }
.row > .c { flex: 1; }
.c { border: 0.4pt solid #000; padding: 1px 3px; min-height: 6.6mm; }
.l { display: block; font-size: 5pt; text-transform: uppercase; line-height: 1.15; color: #000; }
.v { font-size: 7.5pt; font-weight: 700; line-height: 1.15; min-height: 8px; }
.sec {
  font-size: 6.5pt; font-weight: 700; background: #f2f2f2;
  border: 0.4pt solid #000; padding: 1px 4px; letter-spacing: .03em;
}
.canhoto { display: flex; border: 0.4pt solid #000; }
.canhoto-main { flex: 1; display: flex; flex-direction: column; min-width: 0; }
.canhoto-txt { padding: 2px 4px; font-size: 6.5pt; line-height: 1.25; flex: 1; }
.canhoto-meta { margin-top: 1.5mm; font-size: 6.5pt; }
.canhoto-assin { display: flex; }
.canhoto-assin .c { flex: 1; min-height: 8mm; border-bottom: 0; }
.canhoto-assin .c:first-child { border-left: 0; }
.canhoto-r {
  width: 42mm; border-left: 0.4pt solid #000; text-align: center;
  padding: 2px 2px 1px; font-size: 8pt; font-weight: 700;
}
.canhoto-r .barcode svg { height: 22px; margin-top: 1mm; }
.corte { border-top: 1px dashed #555; margin: 1.8mm 0 2mm; height: 0; }
.head { display: flex; border: 0.4pt solid #000; min-height: 42mm; }
.head-e { flex: 1.15; padding: 3px 5px; font-size: 6.5pt; border-right: 0.4pt solid #000; text-align: center; line-height: 1.25; overflow: hidden; min-width: 0; }
.head-c { width: 36mm; text-align: center; padding: 2px 2px; border-right: 0.4pt solid #000; overflow: hidden; }
.head-d { width: 78mm; padding: 2px 3px; text-align: center; overflow: hidden; }
.emit-nome { font-size: 9pt; font-weight: 700; line-height: 1.15; margin: 1mm 0 1.5mm; overflow-wrap: anywhere; word-break: break-word; }
.danfe-t { font-size: 13pt; font-weight: 700; letter-spacing: .12em; margin: 1px 0 0; }
.danfe-s { font-size: 5.8pt; margin: 0 0 2px; line-height: 1.15; }
.tp { font-size: 5.5pt; margin: 2px 0 3px; line-height: 1.2; }
.tp-num, .mk.on {
  display: inline-block; width: 11px; height: 11px; border: 0.7pt solid #000;
  text-align: center; font-size: 8pt; font-weight: 700; line-height: 10px; margin: 1px auto;
}
.nnf { font-size: 8.5pt; font-weight: 700; }
.bloco-chave { width: 100%; }
.chave {
  font-size: 7pt; letter-spacing: 0.3px; font-family: Arial, Helvetica, sans-serif;
  font-weight: 700; line-height: 1.25; margin: 1px 0 2px;
}
.consulta { font-size: 5.8pt; line-height: 1.2; margin-top: 1px; }
.barcode svg { width: 100%; height: 26px; display: block; }
.head-cont { min-height: 22mm; }
.head-cont .barcode svg { height: 20px; }
.prod { font-size: 5.5pt; }
.prod th {
  font-size: 4.6pt; background: #f2f2f2; border: 0.3pt solid #000;
  padding: 1px; text-align: center; font-weight: 700; line-height: 1.1;
}
.prod td { border: 0.3pt solid #000; padding: 1px 1.5px; vertical-align: top; }
.prod td.ctr { text-align: center; }
.num { text-align: right; white-space: nowrap; }
.desc { text-align: left; font-size: 5.5pt; }
.marca-previa {
  position: absolute; inset: 28% 8%; text-align: center;
  font-size: 20pt; font-weight: 700; color: rgba(0,0,0,.16);
  transform: rotate(-18deg); pointer-events: none;
}
.page-rel { position: relative; }
.rod {
  font-size: 6pt; margin-top: 2.5mm; text-align: left; color: #000;
}
@media print {
  .danfe-toolbar, .no-print, button { display: none !important; }
  html, body { background: #fff !important; }
  .danfe-page { margin: 0; }
}
`;
}

function canhoto(m) {
  const bar = m.chave ? svgCodigoBarras(m.chave, { width: 140, height: 22 }) : '';
  return `<div class="canhoto">
    <div class="canhoto-main">
      <div class="canhoto-txt">
        Recebemos de <strong>${esc(nomeEmitenteVisual(m.emitente.nome))}</strong> os produtos e/ou serviços constantes da Nota Fiscal Eletrônica indicada ao lado.
        <div class="canhoto-meta">Emissão: ${esc(m.dataEmissao)}&nbsp;&nbsp; Dest/Reme: ${esc(m.destinatario.nome)}&nbsp;&nbsp; Valor Total: ${esc(fmtMoney(m.imposto.vNF))}</div>
      </div>
      <div class="canhoto-assin">
        ${cel('DATA DO RECEBIMENTO', '')}
        ${cel('IDENTIFICAÇÃO E ASSINATURA DO RECEBEDOR', '')}
      </div>
    </div>
    <div class="canhoto-r">
      NF-e Nº ${esc(m.numeroFormatado)}<br>Série ${esc(m.serieFormatada)}
      <div class="barcode">${bar}</div>
    </div>
  </div>
  <div class="corte" aria-hidden="true"></div>`;
}

function blocoChave(m, compacto) {
  const barcode = m.chave ? svgCodigoBarras(m.chave, { width: 280, height: compacto ? 20 : 26 }) : '';
  return `<div class="bloco-chave" data-chave="${esc(m.chave)}">
    <div class="barcode">${barcode}</div>
    <div class="l">CHAVE DE ACESSO</div>
    <div class="chave">${esc(m.chaveFormatada)}</div>
    ${compacto ? '' : `<div class="consulta">Consulta de autenticidade no portal nacional da NF-e<br>www.nfe.fazenda.gov.br/portal<br>ou no site da Sefaz autorizadora</div>`}
  </div>`;
}

function cabecalho(m, folha, total, compacto) {
  const tp = String(m.tpNF) === '0' ? '0' : '1';
  if (compacto) {
    return `<div class="head head-cont">
      <div class="head-e">
        <div class="emit-nome" style="font-size:8pt">${esc(nomeEmitenteVisual(m.emitente.nome))}</div>
      </div>
      <div class="head-c">
        <p class="danfe-t" style="font-size:11pt">DANFE</p>
        <div class="nnf">Nº ${esc(m.numeroFormatado)}</div>
        <div>Série ${esc(m.serieFormatada)}</div>
        <div>Folha ${folha}/${total}</div>
      </div>
      <div class="head-d">${blocoChave(m, true)}</div>
    </div>`;
  }
  const ender = linhaEnderecoEmitente(m.emitente);
  return `<div class="head">
    <div class="head-e">
      <div class="emit-nome">${esc(nomeEmitenteVisual(m.emitente.nome))}</div>
      <div>${esc(ender)}</div>
      <div>Fone: ${esc(m.emitente.fone)}</div>
      ${m.emitente.email ? `<div>${esc(m.emitente.email)}</div>` : ''}
    </div>
    <div class="head-c">
      <p class="danfe-t">DANFE</p>
      <p class="danfe-s">Documento Auxiliar da<br>Nota Fiscal Eletrônica</p>
      <div class="tp">
        0 - ENTRADA<br>
        <span class="mk on">${esc(tp)}</span><br>
        1 - SAÍDA
      </div>
      <div class="nnf">Nº ${esc(m.numeroFormatado)}</div>
      <div><strong>Série ${esc(m.serieFormatada)}</strong></div>
      <div><strong>Folha ${folha}/${total}</strong></div>
    </div>
    <div class="head-d">${blocoChave(m, false)}</div>
  </div>`;
}

function natureza(m) {
  return `<div class="row">
    ${cel('NATUREZA DA OPERAÇÃO', m.natureza)}
    ${cel('PROTOCOLO DE AUTORIZAÇÃO DE USO', [m.protocolo, m.dhAutorizacao].filter(Boolean).join(' '))}
  </div>
  <div class="row">
    ${cel('INSCRIÇÃO ESTADUAL', m.emitente.ie)}
    ${cel('INSCRIÇÃO ESTADUAL DO SUBSTITUTO TRIBUTÁRIO', m.emitente.ieSt)}
    ${cel('CNPJ / CPF', m.emitente.cnpj)}
  </div>`;
}

function destinatario(m) {
  return `<div class="sec">DESTINATÁRIO / REMETENTE</div>
  <div class="row">
    ${cel('NOME / RAZÃO SOCIAL', m.destinatario.nome)}
    ${cel('CNPJ / CPF', m.destinatario.cnpj)}
    ${cel('DATA DA EMISSÃO', m.dataEmissao)}
  </div>
  <div class="row">
    ${cel('ENDEREÇO', m.destinatario.endereco)}
    ${cel('BAIRRO / DISTRITO', m.destinatario.bairro)}
    ${cel('CEP', m.destinatario.cep)}
    ${cel('DATA DA SAÍDA / ENTRADA', m.dataSaida)}
  </div>
  <div class="row">
    ${cel('MUNICÍPIO', m.destinatario.municipio)}
    ${cel('FONE / FAX', m.destinatario.fone)}
    ${cel('UF', m.destinatario.uf)}
    ${cel('INSCRIÇÃO ESTADUAL', m.destinatario.ie)}
    ${cel('HORA DA SAÍDA', m.horaSaida)}
  </div>`;
}

function imposto(m) {
  const i = m.imposto;
  const vIpi = i.vIPI || i.vIPIDevol;
  return `<div class="sec">CÁLCULO DO IMPOSTO</div>
  <div class="row">
    ${cel('BASE DE CÁLCULO DO ICMS', fmtMoney(i.vBC))}
    ${cel('VALOR DO ICMS', fmtMoney(i.vICMS))}
    ${cel('BASE DE CÁLCULO DO ICMS ST', fmtMoney(i.vBCST))}
    ${cel('VALOR DO ICMS ST', fmtMoney(i.vST))}
    ${cel('VALOR TOTAL DOS PRODUTOS', fmtMoney(i.vProd))}
  </div>
  <div class="row">
    ${cel('VALOR DO FRETE', fmtMoney(i.vFrete))}
    ${cel('VALOR DO SEGURO', fmtMoney(i.vSeg))}
    ${cel('DESCONTO', fmtMoney(i.vDesc))}
    ${cel('OUTRAS DESPESAS', fmtMoney(i.vOutro))}
    ${cel('VALOR TOTAL DO IPI', fmtMoney(vIpi))}
    ${cel('VALOR TOTAL DA NOTA', fmtMoney(i.vNF))}
  </div>`;
}

function transporte(m) {
  const t = m.transporte;
  return `<div class="sec">TRANSPORTADOR / VOLUMES TRANSPORTADOS</div>
  <div class="row">
    ${cel('NOME / RAZÃO SOCIAL', t.nome)}
    ${cel('FRETE POR CONTA', rotuloModFrete(t.modFrete))}
    ${cel('CÓDIGO ANTT', t.rntc)}
    ${cel('PLACA DO VEÍCULO', t.placa)}
    ${cel('UF', t.ufVeic)}
    ${cel('CNPJ / CPF', t.cnpj)}
  </div>
  <div class="row">
    ${cel('ENDEREÇO', t.endereco)}
    ${cel('MUNICÍPIO', t.municipio)}
    ${cel('UF', t.uf)}
    ${cel('INSCRIÇÃO ESTADUAL', t.ie)}
  </div>
  <div class="row">
    ${cel('QUANTIDADE', t.qVol)}
    ${cel('ESPÉCIE', t.esp)}
    ${cel('MARCA', t.marca)}
    ${cel('NUMERAÇÃO', t.nVol)}
    ${cel('PESO BRUTO', t.pesoB)}
    ${cel('PESO LÍQUIDO', t.pesoL)}
  </div>`;
}

function tabelaProdutos(itens) {
  const head = `<tr>
    <th>CÓDIGO</th><th>DESCRIÇÃO DO PRODUTO / SERVIÇO</th><th>NCM/SH</th><th>CST/CSOSN</th>
    <th>CFOP</th><th>UN</th><th>QTD.</th><th>VALOR UNITÁRIO</th><th>VALOR TOTAL</th>
    <th>BC ICMS</th><th>VALOR ICMS</th><th>VALOR IPI</th><th>ALÍQ. ICMS</th><th>ALÍQ. IPI</th>
  </tr>`;
  const body = (itens || []).map((it) => `<tr>
    <td class="ctr">${esc(it.codigo)}</td>
    <td class="desc">${esc(it.descricao)}</td>
    <td class="ctr">${esc(it.ncm)}</td>
    <td class="ctr">${esc(it.cst)}</td>
    <td class="ctr">${esc(it.cfop)}</td>
    <td class="ctr">${esc(it.unidade)}</td>
    <td class="num">${esc(fmtQtd(it.qtd))}</td>
    <td class="num">${esc(fmtMoney(it.vUn))}</td>
    <td class="num">${esc(fmtMoney(it.vProd))}</td>
    <td class="num">${esc(fmtMoney(it.vBC))}</td>
    <td class="num">${esc(fmtMoney(it.vICMS))}</td>
    <td class="num">${esc(fmtMoney(it.vIPI))}</td>
    <td class="num">${esc(fmtMoney(it.pICMS))}</td>
    <td class="num">${esc(fmtMoney(it.pIPI))}</td>
  </tr>`).join('');
  return `<div class="sec">DADOS DOS PRODUTOS / SERVIÇOS</div>
  <table class="prod"><thead>${head}</thead><tbody>${body || '<tr><td colspan="14">&nbsp;</td></tr>'}</tbody></table>`;
}

function adicionais(m) {
  const infCpl = m.infCpl ? `<div>${esc(m.infCpl)}</div>` : '';
  const refs = (m.refs || []).map((c, i) => {
    const fmt = (m.refsFormatadas && m.refsFormatadas[i]) || c;
    return `<div data-chave-ref="${esc(c)}">NF-e referenciada:<br>${esc(fmt)}</div>`;
  }).join('');
  return `<div class="sec">DADOS ADICIONAIS</div>
  <div class="row">
    <div class="c" style="flex:1.45;min-height:20mm">
      <span class="l">INFORMAÇÕES COMPLEMENTARES</span>
      <div class="v" style="font-weight:400;font-size:6.5pt">${infCpl}${refs || '&nbsp;'}</div>
    </div>
    <div class="c" style="flex:1;min-height:20mm">
      <span class="l">RESERVADO AO FISCO</span>
      <div class="v">&nbsp;</div>
    </div>
  </div>`;
}

function rodape() {
  return `<div class="rod">${esc(RODAPE_DANFE)}</div>`;
}

function renderizarDanfeHtml(modelo) {
  const pags = paginarItensDanfe(modelo);
  const paginas = pags.map((p, i) => {
    const primeira = i === 0;
    return `<section class="danfe-page page-rel" data-folha="${p.folha}" data-total="${p.total}">
      ${modelo.previa ? '<div class="marca-previa">PRÉVIA — SEM VALOR FISCAL</div>' : ''}
      ${primeira ? canhoto(modelo) : ''}
      ${cabecalho(modelo, p.folha, p.total, !primeira)}
      ${primeira ? natureza(modelo) : ''}
      ${primeira ? destinatario(modelo) : ''}
      ${primeira ? imposto(modelo) : ''}
      ${primeira ? transporte(modelo) : ''}
      ${tabelaProdutos(p.itens)}
      ${p.extra ? adicionais(modelo) : ''}
      ${rodape()}
    </section>`;
  }).join('\n');

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8"/>
  <title>DANFE NF-e ${esc(modelo.numeroFormatado)} Série ${esc(modelo.serieFormatada)}</title>
  <style>${cssDanfe()}</style>
</head>
<body>
  <div class="no-print danfe-toolbar" style="margin:8px">
    <button type="button" onclick="window.print()">Imprimir DANFE</button>
  </div>
  <div class="danfe-nfe-a4">${paginas}</div>
</body>
</html>`;
}

module.exports = {
  renderizarDanfeHtml,
  cssDanfe
};
