/**
 * RC4.31.8 — Geração de XML NF-e para homologação operacional da Central Inteligente
 */
'use strict';

function pad(n, len) {
  return String(n).padStart(len, '0');
}

function gtinHomolog(seed, offset = 0) {
  return `789${String(Number(seed) + Number(offset)).padStart(10, '0').slice(-10)}`;
}

/**
 * Gera chave NF-e de 44 dígitos (homologação — não valida DV SEFAZ).
 * @param {number} seed
 */
function gerarChave(seed) {
  const base = `3526011234567800019955001${pad(seed % 999999999, 9)}${pad(Math.floor(seed / 1000) % 999999999, 9)}`;
  return base.slice(0, 43) + String((seed % 9) + 1);
}

/**
 * @param {Object} opcoes
 * @param {number} [opcoes.qtdItens=1]
 * @param {number} [opcoes.seed=1]
 * @param {boolean} [opcoes.comCobranca=false]
 * @param {number} [opcoes.qtdParcelas=3]
 * @param {Array<{ gtin?: string, codigo?: string, nome?: string }>} [opcoes.itensCustom]
 * @returns {{ xml: string, chave: string, meta: Object }}
 */
function gerarXmlNfe(opcoes = {}) {
  const qtdItens = Math.max(1, Number(opcoes.qtdItens) || 1);
  const seed = Number(opcoes.seed) || Date.now();
  const chave = gerarChave(seed);
  const nNF = (seed % 900000) + 100;
  const comCobr = opcoes.comCobranca === true;
  const qtdParcelas = Math.max(1, Number(opcoes.qtdParcelas) || 3);

  const itens = [];
  let vProdTotal = 0;

  for (let i = 0; i < qtdItens; i += 1) {
    const custom = opcoes.itensCustom?.[i] || {};
    const idx = i + 1;
    const qCom = custom.quantidade ?? 10;
    const vUn = custom.preco ?? (5 + (idx % 7));
    const vProd = Math.round(qCom * vUn * 100) / 100;
    vProdTotal += vProd;
    const gtin = custom.gtin ?? gtinHomolog(seed, idx);
    const codigo = custom.codigo ?? `RC4318-${pad(idx, 4)}`;
    const nome = custom.nome ?? `Produto Homolog RC4318 #${idx}`;

    itens.push(`
      <det nItem="${idx}">
        <prod>
          <cProd>${codigo}</cProd>
          <cEAN>${gtin}</cEAN>
          <xProd>${nome}</xProd>
          <NCM>22021000</NCM>
          <uCom>UN</uCom>
          <qCom>${qCom.toFixed(4)}</qCom>
          <vUnCom>${vUn.toFixed(2)}</vUnCom>
          <vProd>${vProd.toFixed(2)}</vProd>
        </prod>
      </det>`);
  }

  const vNF = Math.round(vProdTotal * 100) / 100;
  let blocoCobr = '';
  let blocoPag = '';

  if (comCobr) {
    const valorParcela = Math.round((vNF / qtdParcelas) * 100) / 100;
    const dups = [];
    for (let p = 0; p < qtdParcelas; p += 1) {
      const mes = ((p % 12) + 1);
      dups.push(`
          <dup>
            <nDup>${pad(p + 1, 3)}</nDup>
            <dVenc>2026-${pad(mes, 2)}-15</dVenc>
            <vDup>${valorParcela.toFixed(2)}</vDup>
          </dup>`);
    }
    blocoCobr = `
      <cobr>
        <fat>
          <nFat>${nNF}</nFat>
          <vOrig>${vNF.toFixed(2)}</vOrig>
          <vDesc>0.00</vDesc>
          <vLiq>${vNF.toFixed(2)}</vLiq>
        </fat>${dups.join('')}
      </cobr>`;
    blocoPag = `
      <pag>
        <detPag>
          <tPag>15</tPag>
          <vPag>${vNF.toFixed(2)}</vPag>
          <indPag>1</indPag>
        </detPag>
      </pag>`;
  }

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<nfeProc versao="4.00" xmlns="http://www.portalfiscal.inf.br/nfe">
  <NFe xmlns="http://www.portalfiscal.inf.br/nfe">
    <infNFe Id="NFe${chave}" versao="4.00">
      <ide>
        <nNF>${nNF}</nNF>
        <serie>1</serie>
        <mod>55</mod>
        <dhEmi>2026-06-01T10:00:00-03:00</dhEmi>
        <dhSaiEnt>2026-06-02T08:00:00-03:00</dhSaiEnt>
      </ide>
      <emit>
        <CNPJ>12345678000199</CNPJ>
        <xNome>Fornecedor Homolog RC4318 Ltda</xNome>
        <enderEmit>
          <xLgr>Rua Homolog</xLgr>
          <nro>4318</nro>
          <xBairro>Centro</xBairro>
          <xMun>Fortaleza</xMun>
          <UF>CE</UF>
          <CEP>60000000</CEP>
        </enderEmit>
      </emit>${itens.join('')}
      <total>
        <ICMSTot>
          <vProd>${vProdTotal.toFixed(2)}</vProd>
          <vNF>${vNF.toFixed(2)}</vNF>
        </ICMSTot>
      </total>${blocoCobr}${blocoPag}
    </infNFe>
  </NFe>
</nfeProc>`;

  return {
    xml,
    chave,
    meta: {
      seed,
      qtdItens,
      nNF,
      vNF,
      comCobranca: comCobr,
      qtdParcelas: comCobr ? qtdParcelas : 0
    }
  };
}

module.exports = { gerarXmlNfe, gerarChave, gtinHomolog };
