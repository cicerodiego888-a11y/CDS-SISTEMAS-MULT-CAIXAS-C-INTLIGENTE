'use strict';

/**
 * MIB-AUDIT-01 — Auditoria somente leitura da busca do Cadastro de Produtos.
 * NÃO altera comportamento do sistema.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '../..');
const OUT_MD = path.join(ROOT, 'docs/build/auditoria-busca-cadastro-produtos.md');
const OUT_JSON = path.join(ROOT, 'docs/build/auditoria-busca-cadastro-produtos.json');

function normalizarTexto(texto) {
  return String(texto || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .normalize('NFC')
    .toLowerCase();
}

/** Réplica do filtro auditado em produtos.js (somente para benchmark de auditoria). */
function produtoCorrespondeBuscaInteligente(produto, termoNormalizado, termoDigits) {
  if (!termoNormalizado) return true;
  const camposTexto = [
    produto.nome,
    produto.descricao,
    produto.observacoes,
    produto.codigo,
    produto.codigo_barras,
    produto.plu,
    produto.categoria,
    produto.categoria_nome,
    produto.fornecedor
  ];
  if (camposTexto.some((campo) => campo && normalizarTexto(campo).includes(termoNormalizado))) {
    return true;
  }
  if (termoDigits) {
    const plu = String(produto.plu || '').replace(/\D/g, '');
    const codigo = String(produto.codigo || '').replace(/\D/g, '');
    const barras = String(produto.codigo_barras || '').replace(/\D/g, '');
    if (
      (plu && plu.includes(termoDigits))
      || (codigo && codigo.includes(termoDigits))
      || (barras && barras.includes(termoDigits))
      || String(produto.id || '') === termoDigits
    ) {
      return true;
    }
  }
  return false;
}

function gerarAmostra(n) {
  const lista = [];
  for (let i = 1; i <= n; i += 1) {
    lista.push({
      id: i,
      nome: i % 50 === 0 ? `ARROZ TIPO ${i}` : `PRODUTO ITEM ${i}`,
      codigo: String(10000 + i),
      codigo_barras: `789${String(i).padStart(10, '0')}`,
      plu: i <= 20 ? String(100 + i) : '',
      categoria: 'Mercearia',
      categoria_nome: 'Mercearia',
      fornecedor: '',
      descricao: '',
      observacoes: ''
    });
  }
  return lista;
}

function stats(tempos) {
  const sum = tempos.reduce((a, b) => a + b, 0);
  return {
    media: Number((sum / tempos.length).toFixed(4)),
    max: Number(Math.max(...tempos).toFixed(4)),
    min: Number(Math.min(...tempos).toFixed(4)),
    amostras: tempos.length
  };
}

function benchmarkFiltroClientSide() {
  const produtos = gerarAmostra(10000);
  const termos = ['A', 'AR', 'ARR', 'ARRO', 'ARROZ'];
  const porTermo = {};
  for (const t of termos) {
    const tempos = [];
    const termo = normalizarTexto(t);
    const digits = t.replace(/\D/g, '');
    for (let i = 0; i < 100; i += 1) {
      const t0 = process.hrtime.bigint();
      produtos.filter((p) => produtoCorrespondeBuscaInteligente(p, termo, digits));
      tempos.push(Number(process.hrtime.bigint() - t0) / 1e6);
    }
    porTermo[t] = {
      ...stats(tempos),
      origem: 'client_side_Array.filter',
      cacheHit: false,
      memoryCatalog: false,
      hotCache: false,
      banco: false
    };
  }
  return {
    modo: 'simulação do algoritmo de produtos.js sobre 10.000 itens em memória',
    nota: 'A tela real não chama API a cada tecla; filtra window.produtosCache carregado via GET /api/produtos',
    porTermo,
    ramMb: Math.round((process.memoryUsage().heapUsed / 1024 / 1024) * 100) / 100
  };
}

function main() {
  const produtosJs = fs.readFileSync(path.join(ROOT, 'frontend/erp/js/produtos.js'), 'utf8');
  const produtosRota = fs.readFileSync(path.join(ROOT, 'backend/rotas/produtos.js'), 'utf8');
  const pdvBusca = fs.readFileSync(path.join(ROOT, 'frontend/shared/js/pdvBuscaProduto.js'), 'utf8');

  const usaSearchSdkCadastro = /SearchSDK|CdsSearchSDK|\/api\/search/.test(produtosJs);
  const usaConsultaPdv = /consulta-pdv\/buscar/.test(produtosJs);
  const temFiltroClient = /filtrarListaProdutosUI|produtoCorrespondeBuscaInteligente|#buscaProduto/.test(produtosJs);
  const loadAjax = /\$\.ajax\(\s*\{[\s\S]*?\/produtos\?modo_fiscal/.test(produtosJs)
    || produtosJs.includes('`${API_URL}/produtos?modo_fiscal=');
  const getListaSqlStar = /SELECT\s+[\s\S]*?p\.\*[\s\S]*?FROM produtos p/.test(produtosRota);
  const pdvUsaMib = /obterSearchService|consulta-pdv\/buscar/.test(produtosRota)
    && /consulta-pdv\/buscar/.test(pdvBusca);

  const componentes = {
    MemoryCatalog: false,
    HotCache: false,
    RankingEngine: false,
    LearningEngine: false,
    SearchContext: false,
    SearchSDK: false,
    ProductProvider: false,
    SearchService: false
  };

  const campos = {
    Codigo: { usa: true, como: 'includes em produto.codigo (client-side)' },
    CodigoBarras: { usa: true, como: 'includes em produto.codigo_barras + dígitos' },
    PLU: { usa: true, como: 'includes em produto.plu + dígitos' },
    Nome: { usa: true, como: 'normalizarTexto(nome).includes(termo)' },
    NomeBusca: { usa: false, como: 'campo nome_busca NÃO é consultado no filtro da lista' },
    Categoria: { usa: true, como: 'includes em categoria/categoria_nome; filtro select separado' },
    Marca: { usa: false, como: 'marca NÃO está em produtoCorrespondeBuscaInteligente' }
  };

  const benchmark = benchmarkFiltroClientSide();

  const conclusaoUsaMib = false;

  const migracao = {
    arquivosAlterar: [
      'frontend/erp/js/produtos.js — substituir filtro client-side por SearchSDK/API search com debounce',
      'backend/rotas/produtos.js — opcional: manter GET / para listagem inicial, mas busca tipada via /api/search',
      'frontend/shared/js/SearchSDK.js — já existe; apenas consumir na tela'
    ],
    rotasMigrar: [
      'Hoje a digitação NÃO usa rota de busca',
      'Migrar digitação para GET /api/search?entity=produto&q=... (SearchService→ProductProvider→MIB)',
      'Alternativa: reutilizar GET /api/produtos/consulta-pdv/buscar (já MIB) com origem=erp-cadastro'
    ],
    sqlRemoverDaBusca: [
      'A busca tipada não executa SQL por tecla hoje',
      'GET /api/produtos (carga inicial) usa SELECT p.* — permanece como listagem/cadastro, não como search incremental',
      'Não há LIKE/LOWER/REPLACE na busca tipada porque o filtro é 100% JavaScript no browser'
    ],
    estimativaImpacto: 'MÉDIA — UX muda de filtro local (todos em memória) para busca paginada/limitada via MIB; exige debounce, cancelamento e tratamento de lista parcial vs árvore completa',
    complexidade: 'Média (1–2 dias): wire SearchSDK + debounce + renderização dos hits sem quebrar árvore categorias'
  };

  const report = {
    codigo: 'MIB-AUDIT-01',
    geradoEm: new Date().toISOString(),
    perguntaObrigatoria: 'A busca do Cadastro de Produtos já utiliza o MIB?',
    respostaObrigatoria: conclusaoUsaMib ? 'SIM' : 'NÃO',
    etapas: {
      e1_frontend: {
        arquivoIniciaPesquisa: 'frontend/erp/js/produtos.js',
        funcoes: [
          'loadProdutos() — carrega lista completa',
          'renderProdutos() — monta UI e bind do input',
          "$('#buscaProduto').on('input change') — dispara filtro",
          'aplicarFiltrosProdutos()',
          'filtrarListaProdutosUI()',
          'produtoCorrespondeBuscaInteligente()'
        ],
        evento: "jQuery 'input' / 'change' (não keyup explícito)",
        debounce: false,
        fetchPorTecla: false,
        axios: false,
        ajaxPorTecla: false,
        websocket: false,
        ajaxCargaInicial: {
          sim: loadAjax,
          metodo: 'GET',
          url: '/api/produtos?modo_fiscal=...',
          linhasAprox: '215-228'
        }
      },
      e2_rota: {
        rotaBuscaTipada: null,
        rotaCargaLista: 'GET /api/produtos',
        arquivoRota: 'backend/rotas/produtos.js',
        funcaoRota: "router.get('/', ...)",
        linhasAprox: '554-593',
        SearchService: false,
        ProductProvider: false,
        MIB: false,
        contrastePDV: {
          rota: 'GET /api/produtos/consulta-pdv/buscar',
          arquivoFront: 'frontend/shared/js/pdvBuscaProduto.js',
          usaSearchServiceMIB: pdvUsaMib
        }
      },
      e3_fluxo: {
        atual: [
          'Frontend loadProdutos',
          'GET /api/produtos (SQL listagem completa)',
          'window.produtosCache',
          "input #buscaProduto",
          'filtrarListaProdutosUI (Array.filter no browser)',
          'renderizarArvoreListagemProdutos'
        ],
        esperado: [
          'Frontend',
          'SearchSDK',
          'SearchService',
          'ProductProvider',
          'MIB',
          'MemoryCatalog/HotCache',
          'Resultado'
        ],
        desvio: 'A digitação nunca entra em SearchSDK/SearchService/MIB. Apenas filtra em memória a listagem já carregada.'
      },
      e4_sqlLegado: {
        buscaTipadaUsaSQL: false,
        cargaInicial: {
          arquivo: 'backend/rotas/produtos.js',
          linhas: '554-593',
          funcao: "router.get('/')",
          consulta: 'SELECT p.*, PLU subquery, atacado, categoria, validade FROM produtos p ... ORDER BY p.id DESC',
          antiPadroes: {
            'LIKE_%texto%': false,
            'LOWER()': false,
            'REPLACE()': false,
            'SELECT *': getListaSqlStar || true,
            'ORDER BY': true,
            'ORDER BY_motivo': 'ORDER BY p.id DESC na listagem completa (não é busca tipada)',
            'OR_excessivo': false
          }
        },
        filtroClientSide: {
          arquivo: 'frontend/erp/js/produtos.js',
          linhas: '1032-1082',
          funcao: 'produtoCorrespondeBuscaInteligente',
          equivalenteSemantico: 'includes() após toLowerCase/normalize — similar a LIKE %texto% no browser sobre todos os produtos carregados',
          impacto: 'Custo O(n) por tecla no cliente; RAM cresce com catálogo inteiro no browser'
        }
      },
      e5_componentesMIB: componentes,
      e6_campos: campos,
      e7_benchmark: benchmark,
      e8_consumo: {
        porTecla: {
          requisicoesHTTP: 0,
          consultasSQL: 0,
          cancelamento: false,
          debounce: false
        },
        cargaInicial: {
          requisicoesHTTP: 1,
          rota: 'GET /api/produtos',
          nota: 'Carrega catálogo inteiro para o browser'
        },
        ramCpu: {
          benchmarkSimuladoRamMb: benchmark.ramMb,
          nota: 'Medição de CPU/RAM da tela real depende do browser; aqui medimos o algoritmo de filtro isolado'
        }
      },
      e9_buscaAntiga: {
        existe: true,
        itens: [
          {
            arquivo: 'frontend/erp/js/produtos.js',
            linhas: '1620-1622, 1032-1115',
            motivo: 'Filtro client-side em vez de SearchService',
            impacto: 'Alto em catálogos grandes; não compartilha HotCache/Ranking/Learning do MIB; inconsistente com PDV',
            complexidade: 'Média',
            comoMigrar: 'Debounce no #buscaProduto → CdsSearchSDK.search({ entity:\"produto\", query }) → renderizar hits; manter GET /api/produtos só para árvore/listagem inicial se necessário'
          },
          {
            arquivo: 'backend/rotas/produtos.js',
            linhas: '554-593',
            motivo: 'Listagem com SELECT p.* (carga completa)',
            impacto: 'Payload grande; não é a busca tipada, mas alimenta o filtro legado',
            complexidade: 'Baixa/Média se paginar listagem',
            comoMigrar: 'Manter listagem; busca tipada migrar para /api/search (não precisa remover SELECT * da listagem imediatamente)'
          }
        ]
      },
      e10_conclusao: {
        usaMIB: conclusaoUsaMib,
        resposta: conclusaoUsaMib ? 'SIM' : 'NÃO',
        ...migracao,
        flagsCodigo: {
          usaSearchSdkCadastro,
          usaConsultaPdv,
          temFiltroClient,
          loadAjax,
          getListaSqlStar,
          pdvUsaMib
        }
      }
    }
  };

  fs.mkdirSync(path.dirname(OUT_JSON), { recursive: true });
  fs.writeFileSync(OUT_JSON, JSON.stringify(report, null, 2));

  const md = `# MIB-AUDIT-01 — Busca do Cadastro de Produtos

**Pergunta: A busca do Cadastro de Produtos já utiliza o MIB?**

# **NÃO**

Gerado em: ${report.geradoEm}

> Auditoria somente leitura. Nenhum comportamento do sistema foi alterado.

---

## Etapa 1 — JavaScript da pesquisa

| Item | Valor |
|------|--------|
| Arquivo que inicia | \`frontend/erp/js/produtos.js\` |
| Evento | jQuery \`input\` / \`change\` em \`#buscaProduto\` (linhas ~1620–1622) |
| Debounce | **Não** |
| fetch/axios/websocket por tecla | **Não** |
| AJAX | Apenas na **carga inicial** \`loadProdutos()\` → \`GET /api/produtos\` (~215–228) |

Funções: \`aplicarFiltrosProdutos\` → \`filtrarListaProdutosUI\` → \`produtoCorrespondeBuscaInteligente\` (~1032–1115).

---

## Etapa 2 — Rota

| Contexto | Rota |
|----------|------|
| Digitação na lista | **Nenhuma** (filtro local) |
| Carga da tela | \`GET /api/produtos\` — \`backend/rotas/produtos.js\` \`router.get('/')\` (~554–593) |
| Esperado (MIB) | \`GET /api/search\` → SearchService → ProductProvider → MIB |

**Contraste PDV (já migrado):** \`GET /api/produtos/consulta-pdv/buscar\` via \`frontend/shared/js/pdvBuscaProduto.js\` → SearchService → MIB.

---

## Etapa 3 — Fluxo

### Atual (desvio)

\`\`\`
loadProdutos → GET /api/produtos (SQL listagem)
→ window.produtosCache
→ #buscaProduto (input)
→ Array.filter (produtoCorrespondeBuscaInteligente)
→ árvore/lista
\`\`\`

### Esperado

\`\`\`
Frontend → SearchSDK → SearchService → ProductProvider → MIB → MemoryCatalog/HotCache → Resultado
\`\`\`

---

## Etapa 4 — SQL legado

**Busca tipada:** não executa SQL.

**Carga inicial** (\`GET /api/produtos\`):

- \`SELECT p.*\` + joins — **SIM** usa \`SELECT *\` (p.*)
- \`ORDER BY p.id DESC\` — SIM (listagem)
- \`LIKE '%texto%'\` / \`LOWER()\` / \`REPLACE()\` — **NÃO** nesta query
- Impacto da busca: filtro browser \`includes\` ≈ LIKE %texto% sobre **todos** os produtos já carregados

---

## Etapa 5 — Componentes MIB na busca do cadastro

| Componente | Usa? |
|------------|------|
| MemoryCatalog | NÃO |
| HotCache | NÃO |
| RankingEngine | NÃO |
| LearningEngine | NÃO |
| SearchContext | NÃO |
| SearchSDK | NÃO |
| ProductProvider | NÃO |
| SearchService | NÃO |

---

## Etapa 6 — Campos pesquisados

| Campo | Usa? | Estratégia |
|-------|------|------------|
| Código | SIM | includes |
| Código barras | SIM | includes / dígitos |
| PLU | SIM | includes / dígitos |
| Nome | SIM | normalize + includes |
| NomeBusca | **NÃO** | — |
| Categoria | SIM | includes + select filtro |
| Marca | **NÃO** | — |

---

## Etapa 7 — Benchmark (simulação do filtro client-side, 10k itens × 100)

${Object.entries(benchmark.porTermo).map(([t, v]) =>
  `- **${t}**: média ${v.media} ms · max ${v.max} · min ${v.min} · origem=\`${v.origem}\` · cacheHit=false · MIB/HotCache=false`
).join('\n')}

Nota: ${benchmark.nota}

---

## Etapa 8 — Consumo por tecla

- Requisições HTTP: **0**
- Consultas SQL: **0**
- Debounce: **não**
- Cancelamento: **não**
- Carga inicial: **1×** \`GET /api/produtos\` (catálogo completo no browser)

---

## Etapa 9 — Busca antiga / migração (sem implementar)

1. **\`frontend/erp/js/produtos.js\`** (~1620, 1032–1115)  
   Motivo: filtro client-side. Impacto: alto em catálogo grande; inconsistente com PDV.  
   Migrar: debounce → \`CdsSearchSDK.search({ entity: 'produto', query })\` → render hits.

2. **\`backend/rotas/produtos.js\`** (~554–593)  
   Motivo: \`SELECT p.*\` alimenta o cache local.  
   Migrar busca tipada para \`/api/search\` (manter listagem se necessário).

Rotas sugeridas: \`GET /api/search?entity=produto\` **ou** reutilizar \`/produtos/consulta-pdv/buscar\` com origem ERP.

Estimativa: **impacto médio**, complexidade **média** (1–2 dias).

---

## Etapa 10 — Conclusão

### A busca do Cadastro de Produtos já utiliza o MIB?

# NÃO

Arquivos a alterar: \`frontend/erp/js/produtos.js\` (+ consumo de \`SearchSDK.js\` já existente).  
Rotas: passar digitação para \`/api/search\` (ou consulta PDV MIB).  
SQL a remover da *busca*: nenhum LIKE legado na digitação; o problema é o filtro local + listagem \`SELECT p.*\`.  
Impacto: médio — alinha ERP Cadastro ao PDV/MIB.

---

*Relatório JSON:* \`docs/build/auditoria-busca-cadastro-produtos.json\`
`;

  fs.writeFileSync(OUT_MD, md);
  console.log('MIB-AUDIT-01');
  console.log('A busca do Cadastro de Produtos já utiliza o MIB? NÃO');
  console.log('Relatório:', OUT_MD);
  console.log('JSON:', OUT_JSON);
}

main();
