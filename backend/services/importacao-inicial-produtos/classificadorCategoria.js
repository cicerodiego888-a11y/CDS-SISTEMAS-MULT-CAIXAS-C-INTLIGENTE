/**
 * Classificação assistida do Importador Inicial V1.1.4.
 * Reutiliza categorias/subcategorias de produto ativas; cria as que faltarem
 * quando a classificação for ALTA/MÉDIA. Nunca usa despesa. Nunca altera MIB.
 */
'use strict';

const { texto, normalizarNomeCadastroSimples } = require('./helpers');

const CONFIANCA = Object.freeze({
  ALTA: 'ALTA',
  MEDIA: 'MÉDIA',
  BAIXA: 'BAIXA'
});

const ORIGEM = Object.freeze({
  XLSX: 'XLSX',
  AUTOMATICA: 'AUTOMATICA',
  BANCO: 'BANCO',
  SUGESTAO_IMPORTADOR: 'SUGESTAO_IMPORTADOR',
  NOVA_CATEGORIA: 'NOVA_CATEGORIA',
  NOVA_SUBCATEGORIA: 'NOVA_SUBCATEGORIA'
});

const STATUS_CLASSIFICACAO = Object.freeze({
  CLASSIFICADO: 'CLASSIFICADO',
  PENDENTE_CLASSIFICACAO: 'PENDENTE_CLASSIFICACAO',
  CATEGORIA_NAO_ENCONTRADA: 'CATEGORIA_NAO_ENCONTRADA',
  SUBCATEGORIA_INCOMPATIVEL: 'SUBCATEGORIA_INCOMPATIVEL',
  PRESERVADO: 'PRESERVADO'
});

function normalizarTextoClassificacao(valor) {
  return String(valor || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function escaparRegexToken(token) {
  return String(token).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function temToken(textoNorm, token) {
  const t = normalizarTextoClassificacao(token);
  if (!t) return false;
  const re = new RegExp(`(^|[^A-Z0-9])${escaparRegexToken(t)}([^A-Z0-9]|$)`);
  return re.test(textoNorm);
}

function temAlgumToken(textoNorm, tokens) {
  return (tokens || []).some((t) => temToken(textoNorm, t));
}

function chaveCategoriaEquivalente(valor) {
  return String(valor || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('pt-BR')
    .replace(/\s+/g, ' ')
    .trim();
}

function categoriaProdutoAtiva(c) {
  return c && String(c.tipo || 'produto') === 'produto' && Number(c.ativo) !== 0;
}

function subcategoriaAtiva(s) {
  return s && Number(s.ativo) !== 0;
}

function encontrarCategoriaOficial(catalogo, nomeBruto) {
  const chave = chaveCategoriaEquivalente(nomeBruto);
  if (!chave) return null;
  return (catalogo.categorias || []).find(
    (c) => categoriaProdutoAtiva(c) && chaveCategoriaEquivalente(c.nome) === chave
  ) || null;
}

function encontrarCategoriaBloqueada(catalogo, nomeBruto) {
  const chave = chaveCategoriaEquivalente(nomeBruto);
  if (!chave) return null;
  return (catalogo.categorias || []).find((c) => {
    if (chaveCategoriaEquivalente(c.nome) !== chave) return false;
    return String(c.tipo || 'produto') !== 'produto' || Number(c.ativo) === 0;
  }) || null;
}

function encontrarSubcategoriaOficial(catalogo, categoriaId, nomeBruto) {
  const chave = chaveCategoriaEquivalente(nomeBruto);
  if (!chave || !categoriaId) return null;
  return (catalogo.subcategorias || []).find(
    (s) => subcategoriaAtiva(s)
      && Number(s.categoria_id) === Number(categoriaId)
      && chaveCategoriaEquivalente(s.nome) === chave
  ) || null;
}

function subcategoriaExisteEmOutraCategoria(catalogo, nomeBruto, categoriaId) {
  const chave = chaveCategoriaEquivalente(nomeBruto);
  if (!chave || !categoriaId) return false;
  return (catalogo.subcategorias || []).some(
    (s) => subcategoriaAtiva(s)
      && chaveCategoriaEquivalente(s.nome) === chave
      && Number(s.categoria_id) !== Number(categoriaId)
  );
}

function montarResultado({
  categoria = null,
  subcategoria = null,
  confianca,
  origem,
  status,
  motivo = null,
  criar_categoria = false,
  criar_subcategoria = false
}) {
  return {
    categoria_id: categoria && categoria.id != null ? categoria.id : null,
    categoria_nome: categoria ? categoria.nome : null,
    subcategoria_id: subcategoria && subcategoria.id != null ? subcategoria.id : null,
    subcategoria_nome: subcategoria ? subcategoria.nome : null,
    confianca,
    origem,
    status,
    motivo,
    criar_categoria: criar_categoria === true,
    criar_subcategoria: criar_subcategoria === true
  };
}

function pendente(motivo) {
  return montarResultado({
    confianca: CONFIANCA.BAIXA,
    origem: ORIGEM.AUTOMATICA,
    status: STATUS_CLASSIFICACAO.PENDENTE_CLASSIFICACAO,
    motivo
  });
}

function origemComCriacao(criarCategoria, criarSubcategoria, origemBase) {
  if (criarCategoria) return ORIGEM.NOVA_CATEGORIA;
  if (criarSubcategoria) return ORIGEM.NOVA_SUBCATEGORIA;
  return origemBase;
}

function resolverParOficial(catalogo, nomeCategoria, nomeSubcategoria) {
  let categoria = encontrarCategoriaOficial(catalogo, nomeCategoria);
  const criarCategoria = !categoria;
  if (!categoria) {
    categoria = {
      id: null,
      nome: normalizarNomeCadastroSimples(nomeCategoria),
      tipo: 'produto',
      ativo: 1
    };
  }
  let subcategoria = null;
  let criarSubcategoria = false;
  if (nomeSubcategoria) {
    subcategoria = categoria.id
      ? encontrarSubcategoriaOficial(catalogo, categoria.id, nomeSubcategoria)
      : null;
    if (!subcategoria) {
      criarSubcategoria = true;
      subcategoria = {
        id: null,
        nome: normalizarNomeCadastroSimples(nomeSubcategoria),
        categoria_id: categoria.id,
        ativo: 1
      };
    }
  }
  return { categoria, subcategoria, criarCategoria, criarSubcategoria };
}

function classificarPorRegra(catalogo, nomeCategoria, nomeSubcategoria, { motivo, confianca } = {}) {
  const par = resolverParOficial(catalogo, nomeCategoria, nomeSubcategoria);
  const temSub = Boolean(nomeSubcategoria);
  return montarResultado({
    categoria: par.categoria,
    subcategoria: par.subcategoria,
    confianca: confianca || (temSub ? CONFIANCA.ALTA : CONFIANCA.MEDIA),
    origem: origemComCriacao(par.criarCategoria, par.criarSubcategoria, ORIGEM.AUTOMATICA),
    status: STATUS_CLASSIFICACAO.CLASSIFICADO,
    motivo,
    criar_categoria: par.criarCategoria,
    criar_subcategoria: par.criarSubcategoria
  });
}

function classificarAutomatico(descricao, catalogo) {
  const textoNorm = normalizarTextoClassificacao(descricao);
  if (!textoNorm) return pendente('Descrição vazia');

  const soqueteAmbiguo = temAlgumToken(textoNorm, ['SOQUETE', 'SOQUETES'])
    && !temAlgumToken(textoNorm, ['ELETRICO', 'FOXLUX', 'TOMADA']);
  if (soqueteAmbiguo) {
    return pendente('SOQUETE ambíguo (elétrica vs ferramentas)');
  }

  if (temAlgumToken(textoNorm, ['FUNIL', 'GRAMPEADOR']) || (temToken(textoNorm, 'OLEO') && temToken(textoNorm, 'SINGER'))) {
    return pendente('Descrição sem regra segura');
  }

  const hidro = temAlgumToken(textoNorm, [
    'JOELHO', 'BUCHA', 'CURVA', 'NIPLE', 'NIPPLE', 'RALO', 'TUBO', 'VALVULA',
    'REGISTRO', 'ESG', 'KRONA', 'AMANCO', 'LUVA', 'CAP', 'TE', 'UNIAO', 'RED'
  ]) || (temToken(textoNorm, 'PLUG') && temAlgumToken(textoNorm, ['ROSCAVEL', 'ROSC', 'SOLD', 'KRONA', 'AMANCO']))
    || (temToken(textoNorm, 'ADAP') && temAlgumToken(textoNorm, ['SOLD', 'ESG', 'KRONA', 'AMANCO', 'AGUA']));

  if (hidro) {
    return classificarPorRegra(catalogo, 'Hidráulica', 'Tubos e Conexões', {
      motivo: 'Regra hidráulica (conexões/tubos)'
    });
  }

  if (temToken(textoNorm, 'LIXA')) {
    return classificarPorRegra(catalogo, 'Ferramentas', 'Discos e Abrasivos', { motivo: 'Regra lixa' });
  }

  if (temToken(textoNorm, 'TELHA')) {
    return classificarPorRegra(catalogo, 'Materiais de Construção', 'Telhas e Coberturas', { motivo: 'Regra telha' });
  }

  if (temToken(textoNorm, 'ARAME')) {
    return classificarPorRegra(catalogo, 'Materiais de Construção', 'Arames e Grampos', { motivo: 'Regra arame' });
  }

  if (temToken(textoNorm, 'GANCHO')) {
    return classificarPorRegra(catalogo, 'Ferragens', 'Ganchos e Pitões', { motivo: 'Regra gancho' });
  }

  if (temAlgumToken(textoNorm, ['ABRACADEIRA', 'ABRAÇADEIRA'])) {
    return classificarPorRegra(catalogo, 'Ferragens', 'Abraçadeiras', { motivo: 'Regra abraçadeira' });
  }

  if (temAlgumToken(textoNorm, ['TRINCHA', 'ROLO']) && temAlgumToken(textoNorm, ['TRINCHA', 'PINTURA', 'ROLO'])) {
    const soRoloSemPintura = temToken(textoNorm, 'ROLO') && !temToken(textoNorm, 'PINTURA') && !temToken(textoNorm, 'TRINCHA');
    if (soRoloSemPintura) return pendente('ROLO sem contexto de pintura');
    return classificarPorRegra(catalogo, 'Pintura e Adesivos', null, {
      motivo: 'Pintura sem subcategoria oficial adequada',
      confianca: CONFIANCA.MEDIA
    });
  }

  const eletrica = temAlgumToken(textoNorm, [
    'DISJUNTOR', 'DISJ', 'INTERRUPTOR', 'DPS', 'FOXLUX'
  ]) || (temToken(textoNorm, 'SOQUETE') && temAlgumToken(textoNorm, ['ELETRICO', 'FOXLUX', 'TOMADA']))
    || (temToken(textoNorm, 'PLUG') && !temAlgumToken(textoNorm, ['ROSCAVEL', 'ROSC', 'SOLD', 'KRONA', 'AMANCO']))
    || (temToken(textoNorm, 'PLUGUE'))
    || (temToken(textoNorm, 'CENTRO') && temAlgumToken(textoNorm, ['DISTRIBUICAO', 'DIST']));

  if (eletrica) {
    let nomeSub = 'Materiais Elétricos';
    if (temToken(textoNorm, 'INTERRUPTOR') || temToken(textoNorm, 'TOMADA')) {
      nomeSub = 'Interruptores e Tomadas';
    } else if (temToken(textoNorm, 'PLUG') || temToken(textoNorm, 'PLUGUE')) {
      nomeSub = 'Plugues e Conectores';
    } else if (temToken(textoNorm, 'CABO') || temToken(textoNorm, 'FIO')) {
      nomeSub = 'Cabos e Fios';
    } else if (temToken(textoNorm, 'CENTRO') && temAlgumToken(textoNorm, ['DISTRIBUICAO', 'DIST'])) {
      nomeSub = 'Quadros de Distribuição';
    }
    return classificarPorRegra(catalogo, 'Elétrica', nomeSub, { motivo: 'Regra elétrica' });
  }

  return pendente('Sem regra determinística segura');
}

/**
 * @param {{ descricao?: string, marca?: string, categoriaInformada?: string, subcategoriaInformada?: string }} entrada
 * @param {{ categorias?: object[], subcategorias?: object[] }} catalogo
 */
function classificarProduto(entrada = {}, catalogo = { categorias: [], subcategorias: [] }) {
  const categoriaInformada = texto(entrada.categoriaInformada || entrada.categoria);
  const subcategoriaInformada = texto(entrada.subcategoriaInformada || entrada.subcategoria);
  const descricao = texto(entrada.descricao || entrada.nome);

  if (categoriaInformada) {
    const bloqueada = encontrarCategoriaBloqueada(catalogo, categoriaInformada);
    if (bloqueada) {
      const despesa = String(bloqueada.tipo || 'produto') !== 'produto';
      return montarResultado({
        confianca: CONFIANCA.BAIXA,
        origem: ORIGEM.XLSX,
        status: STATUS_CLASSIFICACAO.CATEGORIA_NAO_ENCONTRADA,
        motivo: despesa
          ? `Categoria "${categoriaInformada}" é de despesa e não pode ser usada`
          : `Categoria "${categoriaInformada}" está inativa`
      });
    }
    let categoria = encontrarCategoriaOficial(catalogo, categoriaInformada);
    let criarCategoria = false;
    if (!categoria) {
      criarCategoria = true;
      categoria = {
        id: null,
        nome: normalizarNomeCadastroSimples(categoriaInformada),
        tipo: 'produto',
        ativo: 1
      };
    }
    if (subcategoriaInformada) {
      let subcategoria = categoria.id
        ? encontrarSubcategoriaOficial(catalogo, categoria.id, subcategoriaInformada)
        : null;
      let criarSub = false;
      if (!subcategoria) {
        if (categoria.id && subcategoriaExisteEmOutraCategoria(catalogo, subcategoriaInformada, categoria.id)) {
          return montarResultado({
            categoria,
            confianca: CONFIANCA.BAIXA,
            origem: ORIGEM.XLSX,
            status: STATUS_CLASSIFICACAO.SUBCATEGORIA_INCOMPATIVEL,
            motivo: `Subcategoria "${subcategoriaInformada}" não pertence a ${categoria.nome}`,
            criar_categoria: false
          });
        }
        criarSub = true;
        subcategoria = {
          id: null,
          nome: normalizarNomeCadastroSimples(subcategoriaInformada),
          categoria_id: categoria.id,
          ativo: 1
        };
      }
      return montarResultado({
        categoria,
        subcategoria,
        confianca: CONFIANCA.ALTA,
        origem: origemComCriacao(criarCategoria, criarSub, ORIGEM.XLSX),
        status: STATUS_CLASSIFICACAO.CLASSIFICADO,
        motivo: criarCategoria || criarSub ? 'Estrutura será criada na importação' : 'Informado no XLSX',
        criar_categoria: criarCategoria,
        criar_subcategoria: criarSub
      });
    }
    return montarResultado({
      categoria,
      subcategoria: null,
      confianca: CONFIANCA.ALTA,
      origem: origemComCriacao(criarCategoria, false, ORIGEM.XLSX),
      status: STATUS_CLASSIFICACAO.CLASSIFICADO,
      motivo: criarCategoria ? 'Categoria será criada na importação' : 'Categoria informada no XLSX',
      criar_categoria: criarCategoria
    });
  }

  if (subcategoriaInformada && !categoriaInformada) {
    return pendente('Subcategoria informada sem categoria oficial');
  }

  return classificarAutomatico(`${descricao} ${texto(entrada.marca)}`.trim(), catalogo);
}

function classificacaoPermiteImportar(classificacao) {
  if (!classificacao) return false;
  if (classificacao.status === STATUS_CLASSIFICACAO.PENDENTE_CLASSIFICACAO) return false;
  if (classificacao.status === STATUS_CLASSIFICACAO.CATEGORIA_NAO_ENCONTRADA) return false;
  if (classificacao.status === STATUS_CLASSIFICACAO.SUBCATEGORIA_INCOMPATIVEL) return false;
  return classificacao.status === STATUS_CLASSIFICACAO.CLASSIFICADO
    || classificacao.status === STATUS_CLASSIFICACAO.PRESERVADO;
}

function classificacaoEhSegura(resultado) {
  return resultado
    && resultado.status === STATUS_CLASSIFICACAO.CLASSIFICADO
    && (resultado.confianca === CONFIANCA.ALTA || resultado.confianca === CONFIANCA.MEDIA);
}

function anexarCamposExistente(resultado, produtoDb, extras = {}) {
  return {
    ...resultado,
    categoria_atual_id: produtoDb?.categoria_id || null,
    categoria_atual_nome: produtoDb?.categoria_nome || null,
    subcategoria_atual_id: produtoDb?.subcategoria_id || null,
    subcategoria_atual_nome: produtoDb?.subcategoria_nome || null,
    categoria_sugerida_id: extras.categoria_sugerida_id != null ? extras.categoria_sugerida_id : null,
    categoria_sugerida_nome: extras.categoria_sugerida_nome != null ? extras.categoria_sugerida_nome : null,
    subcategoria_sugerida_id: extras.subcategoria_sugerida_id != null ? extras.subcategoria_sugerida_id : null,
    subcategoria_sugerida_nome: extras.subcategoria_sugerida_nome != null ? extras.subcategoria_sugerida_nome : null,
    alterar_categoria: extras.alterar_categoria === true,
    alterar_subcategoria: extras.alterar_subcategoria === true,
    criar_categoria: resultado.criar_categoria === true || extras.criar_categoria === true,
    criar_subcategoria: resultado.criar_subcategoria === true || extras.criar_subcategoria === true
  };
}

/**
 * Classificação de produto EXISTENTE.
 * Nunca sugere sobrescrever categoria/subcategoria já preenchidas no banco.
 */
function resolverClassificacaoExistente(produtoDb, entrada = {}, catalogo = { categorias: [], subcategorias: [] }) {
  const catId = produtoDb?.categoria_id || null;
  const subId = produtoDb?.subcategoria_id || null;
  const catNome = produtoDb?.categoria_nome || null;
  const subNome = produtoDb?.subcategoria_nome || null;

  if (catId && subId) {
    return anexarCamposExistente(
      montarResultado({
        categoria: { id: catId, nome: catNome },
        subcategoria: { id: subId, nome: subNome },
        confianca: CONFIANCA.ALTA,
        origem: ORIGEM.BANCO,
        status: STATUS_CLASSIFICACAO.PRESERVADO,
        motivo: 'Cadastro existente preservado'
      }),
      produtoDb
    );
  }

  const sugestao = classificarProduto(entrada, catalogo);

  if (catId && !subId) {
    const mesmaCategoria = sugestao.categoria_id
      ? Number(sugestao.categoria_id) === Number(catId)
      : chaveCategoriaEquivalente(sugestao.categoria_nome) === chaveCategoriaEquivalente(catNome);
    const subCompativel = classificacaoEhSegura(sugestao)
      && (sugestao.subcategoria_id || sugestao.criar_subcategoria)
      && mesmaCategoria
      && Boolean(sugestao.subcategoria_nome);
    const criarSub = Boolean(subCompativel && sugestao.criar_subcategoria);
    return anexarCamposExistente(
      montarResultado({
        categoria: { id: catId, nome: catNome },
        subcategoria: subCompativel
          ? { id: sugestao.subcategoria_id, nome: sugestao.subcategoria_nome }
          : null,
        confianca: subCompativel ? sugestao.confianca : CONFIANCA.ALTA,
        origem: subCompativel
          ? origemComCriacao(false, criarSub, ORIGEM.SUGESTAO_IMPORTADOR)
          : ORIGEM.BANCO,
        status: STATUS_CLASSIFICACAO.PRESERVADO,
        motivo: subCompativel
          ? (criarSub ? 'Subcategoria será criada na categoria existente' : 'Subcategoria sugerida na categoria existente')
          : 'Categoria existente preservada',
        criar_subcategoria: criarSub
      }),
      produtoDb,
      {
        subcategoria_sugerida_id: subCompativel ? sugestao.subcategoria_id : null,
        subcategoria_sugerida_nome: subCompativel ? sugestao.subcategoria_nome : null,
        alterar_subcategoria: Boolean(subCompativel),
        criar_subcategoria: criarSub
      }
    );
  }

  if (sugestao.status === STATUS_CLASSIFICACAO.CATEGORIA_NAO_ENCONTRADA
    || sugestao.status === STATUS_CLASSIFICACAO.SUBCATEGORIA_INCOMPATIVEL) {
    return anexarCamposExistente(sugestao, produtoDb);
  }

  if (!classificacaoEhSegura(sugestao)) {
    return anexarCamposExistente(
      pendente(sugestao.motivo || 'Sem classificação segura'),
      produtoDb
    );
  }

  return anexarCamposExistente(
    {
      ...sugestao,
      origem: origemComCriacao(
        sugestao.criar_categoria,
        sugestao.criar_subcategoria,
        ORIGEM.SUGESTAO_IMPORTADOR
      ),
      motivo: sugestao.motivo || 'Sugestão do importador para cadastro sem categoria'
    },
    produtoDb,
    {
      categoria_sugerida_id: sugestao.categoria_id,
      categoria_sugerida_nome: sugestao.categoria_nome,
      subcategoria_sugerida_id: sugestao.subcategoria_id,
      subcategoria_sugerida_nome: sugestao.subcategoria_nome,
      alterar_categoria: Boolean(sugestao.categoria_id || sugestao.criar_categoria),
      alterar_subcategoria: Boolean(sugestao.subcategoria_id || sugestao.criar_subcategoria),
      criar_categoria: sugestao.criar_categoria === true,
      criar_subcategoria: sugestao.criar_subcategoria === true
    }
  );
}

module.exports = {
  CONFIANCA,
  ORIGEM,
  STATUS_CLASSIFICACAO,
  classificarProduto,
  resolverClassificacaoExistente,
  encontrarCategoriaOficial,
  encontrarSubcategoriaOficial,
  classificacaoPermiteImportar,
  classificacaoEhSegura,
  normalizarTextoClassificacao,
  chaveCategoriaEquivalente,
  temToken
};
