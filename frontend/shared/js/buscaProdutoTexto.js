/**
 * Comparação de nome na busca (cadastro + PDV).
 * Acentos, concatenação e 02M ≡ 2M.
 */
(function (global) {
  'use strict';

  function compactarMedidas(texto) {
    return String(texto || '').replace(/(^|[^0-9])0+(\d)/g, '$1$2');
  }

  function normalizarTextoBusca(texto) {
    return String(texto || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .normalize('NFC')
      .toLowerCase();
  }

  function compactarTextoBusca(texto) {
    return normalizarTextoBusca(texto).replace(/[^a-z0-9]/g, '');
  }

  function textoContemToken(haystack, token) {
    const h = String(haystack || '');
    const t = String(token || '');
    if (!t) return false;
    if (h.includes(t)) return true;
    const semZero = t.replace(/^0+(?=\d)/, '');
    if (semZero && semZero !== t && h.includes(semZero)) return true;
    const hc = compactarMedidas(h);
    if (hc.includes(t)) return true;
    if (semZero && semZero !== t && hc.includes(semZero)) return true;
    return compactarMedidas(t) !== t && hc.includes(compactarMedidas(t));
  }

  function textoContemFraseCompacta(haystack, fraseCompacta) {
    const h = String(haystack || '');
    const f = String(fraseCompacta || '');
    if (!f) return false;
    if (h.includes(f)) return true;
    return compactarMedidas(h).includes(compactarMedidas(f));
  }

  function tokensBuscaSignificativos(termoNormalizado) {
    const vistos = new Set();
    const out = [];
    String(termoNormalizado || '')
      .split(/[^a-z0-9]+/)
      .filter(Boolean)
      .forEach((t) => {
        if (vistos.has(t)) return;
        vistos.add(t);
        if (t.length >= 3 || (t.length >= 2 && /\d/.test(t))) out.push(t);
      });
    return out;
  }

  function idsNumericosBuscaIguais(a, b) {
    const da = String(a ?? '').replace(/\D/g, '');
    const db = String(b ?? '').replace(/\D/g, '');
    if (!da || !db) return false;
    const na = da.replace(/^0+(?=\d)/, '') || '0';
    const nb = db.replace(/^0+(?=\d)/, '') || '0';
    return na === nb;
  }

  function produtoCorrespondeBuscaNome(produto, termoBruto) {
    const bruto = String(termoBruto || '').trim();
    if (!bruto || !produto) return false;

    if (/^\d+$/.test(bruto.replace(/\s+/g, ''))) {
      const digits = bruto.replace(/\D/g, '');
      return idsNumericosBuscaIguais(produto.plu, digits)
        || idsNumericosBuscaIguais(produto.codigo, digits)
        || idsNumericosBuscaIguais(produto.codigo_barras, digits);
    }

    const termo = normalizarTextoBusca(bruto);
    const termoCompacto = compactarTextoBusca(bruto);
    const nomeN = normalizarTextoBusca(produto.nome);
    const compacto = compactarTextoBusca([
      produto.nome,
      produto.nome_busca,
      produto.descricao,
      produto.observacoes,
      produto.marca,
      produto.marca_nome,
      produto.categoria,
      produto.categoria_nome,
      produto.fornecedor
    ].filter(Boolean).join(' '));

    if (nomeN.includes(termo) || textoContemFraseCompacta(compacto, termoCompacto)) {
      return true;
    }

    const codigo = String(produto.codigo || '').toLowerCase();
    const barras = String(produto.codigo_barras || '').toLowerCase();
    const plu = String(produto.plu || '').toLowerCase();
    const tl = bruto.toLowerCase();
    if (codigo === tl || barras === tl || plu === tl) return true;

    const palavrasNome = nomeN.split(/[^a-z0-9]+/).filter((w) => w.length >= 3);
    const tokenNoNome = (t) => {
      if (/^\d+$/.test(t)) {
        return idsNumericosBuscaIguais(produto.codigo, t)
          || idsNumericosBuscaIguais(produto.codigo_barras, t)
          || idsNumericosBuscaIguais(produto.plu, t)
          || textoContemToken(compacto, t);
      }
      if (textoContemToken(compacto, t)) return true;
      if (t.length < 2 || !/[a-z]/.test(t)) return false;
      return palavrasNome.some((w) => w === t || w.startsWith(t) || t.startsWith(w));
    };

    const fortes = tokensBuscaSignificativos(termo);
    if (!fortes.length) {
      const curtos = String(termo || '').split(/[^a-z0-9]+/).filter(Boolean);
      return curtos.length > 0 && curtos.every(tokenNoNome);
    }

    return fortes.every(tokenNoNome);
  }

  /** Marcas cadastradas como marcador de "sem marca" não aparecem no nome exibido. */
  const MARCAS_SEM_VALOR = new Set(['na', 'n a', 'sem marca', 's m', 'nenhuma', 'nao informada', 'nao informado']);

  function chaveComparacaoMarca(texto) {
    return normalizarTextoBusca(texto).replace(/[^a-z0-9]+/g, ' ').trim();
  }

  function obterMarcaProduto(produto) {
    const marca = produto?.marca && typeof produto.marca === 'object'
      ? produto.marca.nome
      : (produto?.marca || produto?.marca_nome);
    return String(marca || '').replace(/\s+/g, ' ').trim();
  }

  /**
   * Nome de exibição "NOME — MARCA" (só tela; o nome gravado não muda).
   * Sem marca, ou com a marca já no nome como palavra inteira em qualquer posição, devolve só o nome.
   * @param {Object|string} produtoOuNome - produto ({ nome, marca | marca_nome }) ou o nome
   * @param {string} [marca] - marca explícita (quando o primeiro argumento é o nome)
   */
  function formatarNomeProdutoComMarca(produtoOuNome, marca) {
    const produto = produtoOuNome && typeof produtoOuNome === 'object' ? produtoOuNome : null;
    const nome = String((produto ? produto.nome : produtoOuNome) || '').trim();
    const marcaTexto = marca !== undefined
      ? String(marca || '').replace(/\s+/g, ' ').trim()
      : obterMarcaProduto(produto);
    const chaveMarca = chaveComparacaoMarca(marcaTexto);
    if (!nome || !chaveMarca || MARCAS_SEM_VALOR.has(chaveMarca)) return nome;
    if (` ${chaveComparacaoMarca(nome)} `.includes(` ${chaveMarca} `)) return nome;
    return `${nome} — ${marcaTexto}`;
  }

  global.CdsBuscaProdutoTexto = {
    obterMarcaProduto,
    formatarNomeProdutoComMarca,
    compactarMedidas,
    normalizarTextoBusca,
    compactarTextoBusca,
    textoContemToken,
    textoContemFraseCompacta,
    tokensBuscaSignificativos,
    idsNumericosBuscaIguais,
    produtoCorrespondeBuscaNome
  };
})(typeof window !== 'undefined' ? window : globalThis);
