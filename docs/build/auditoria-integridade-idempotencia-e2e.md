# Auditoria de integridade, pesquisa de produtos, idempotência e E2E

Gerado em: 2026-10-09  
Escopo: a partir do ponto 11 da auditoria anterior + relato do cliente.  
Regra: auditar primeiro; corrigir somente o comprovado.

O sistema **não** está “100% seguro” nem “sem bugs”.

---

## 1. Resumo executivo

O relato **“cadastra o produto e não encontra”** é reproduzível e tem causa exata no código.

O cadastro **grava o produto no SQLite**. A pesquisa do Cadastro e do PDV **não usa o nome original**: usa a coluna `produtos.nome_busca`. O `POST /api/produtos` **não preenchia** essa coluna no `INSERT` (só disparava um `UPDATE` assíncrono depois). Com `nome_busca` nulo, `GET /produtos/busca-operacional` devolve zero. O frontend, com zero hits, **não consulta o cache local** e mostra “Nenhum produto encontrado”.

**O produto não some do banco. Some da pesquisa.**

Nesta sprint foi corrigido somente isso (e dois satélites comprovados: validação de validade depois do INSERT; duplo clique no salvar do cadastro). Idempotência de venda/PIX/TEF, concorrência de estoque, backup/restore e E2E de UI **não foram “consertados”** — foram classificados.

---

## 2. Bug do produto não encontrado

### Causa exata

```
CADASTRO (modal ERP, saveProduto)
  → POST /api/produtos
  → INSERT produtos  (nome gravado; nome_busca AUSENTE no INSERT legado)
  → COMMIT implícito SQLite
  → 200 + produto no JSON
  → frontend atualiza produtosCache
  → usuário pesquisa
  → GET /api/produtos/busca-operacional?q=...
  → SQL: WHERE p.nome_busca = ? / LIKE ...
  → 0 itens
  → UI lista vazia  ← AQUI o produto “desaparece”
```

**Onde está o bug:** junção `POST INSERT` (sem `nome_busca`) + `BuscaOperacionalProdutosService` (só `nome_busca`) + frontend (`executarBuscaProdutosViaMib` ignora o cache quando a API volta vazia).

Não é tenant. Não é F12/item_fiscal na listagem do cadastro. Não é categoria obrigatória. Não é LIMIT 50 da árvore (a busca tipada tem limite 20, mas termo específico encontra se `nome_busca` existe).

### Mapa técnico

| Etapa | Arquivo | Função / endpoint | Tabela / campos |
|---|---|---|---|
| Tela cadastro | `frontend/erp/pages/produtos.html` + `frontend/erp/js/produtos.js` | modal `#produtoModal` | — |
| Salvar | `produtos.js` | `saveProduto()` | payload JSON |
| Request | jQuery `$.ajax` | `POST /api/produtos` ou `PUT /api/produtos/:id` | — |
| Rota | `backend/rotas/produtos.js` | `router.post('/')` | `produtos` |
| SQL | mesmo arquivo | `INSERT INTO produtos (...)` | `codigo, nome, nome_busca, ativo, codigo_barras, item_fiscal, saldo_*` |
| GET por ID | `router.get('/:id')` | `SELECT p.* ... WHERE p.id = ?` | `produtos` |
| Lista cadastro | `router.get('/')` | `GET /api/produtos?modo_fiscal=` | **sem filtro item_fiscal** |
| Pesquisa Cadastro/PDV | `BuscaOperacionalProdutosService.buscar` | `GET /api/produtos/busca-operacional` | `nome_busca`, `codigo`, `codigo_barras`, `ativo` |
| Frontend pesquisa | `produtos.js` `executarBuscaProdutosViaMib` | fetch operacional `limite=20` | não usa SQL local |
| PDV | `frontend/shared/js/pdvBuscaProduto.js` | mesma API operacional | — |
| Catálogo sessão | `window.produtosCache` / `__cdsProdutosCatalogoSessao` | memória | invalidação F12 / save |

Tenant: tabela `produtos` **não tem** `empresa_id` / `tenant_id` / `company_id`. Isolamento = arquivo SQLite da instalação.

---

## 3. Reprodução

1. Cadastrar produto com nome único, ex.: `PRODUTO TESTE AUDITORIA 2026`, código `AUD-2026-001`.
2. Receber “Produto salvo com sucesso”.
3. **Sem recarregar**, digitar o nome (ou parte) em `#buscaProduto`.
4. **Antes da correção:** API operacional retorna `itens: []` se `nome_busca` ainda estiver NULL; UI vazia. `SELECT * FROM produtos WHERE id = ?` encontra a linha.
5. **Depois da correção:** o INSERT já grava `nome_busca`; a mesma pesquisa encontra.

Prova automatizada: `tests/produtos/auditoria-cadastro-pesquisa-integridade.test.js`  
- caso “legado: INSERT sem nome_busca…” **reproduz a falha**  
- caso “corrigido: cadastrar → banco → nome → código…” **passa**

---

## 4. Correção (somente o comprovado)

Arquivos alterados:

- `backend/rotas/produtos.js` — `nome_busca` + `ativo=1` no INSERT; `codigo_barras` como string; validação de validade **antes** do INSERT.
- `frontend/erp/js/produtos.js` — trava `__cdsProdutoSalvando` contra duplo clique em Salvar.
- `tests/sql/rc4315-insert-alignment.test.js` — INSERT de produtos com 39 colunas.
- `tests/produtos/auditoria-cadastro-pesquisa-integridade.test.js` — suíte de auditoria.

**Não feito de propósito:** não alargar a busca para “encontrar tudo”; não misturar filtro de PDV no cadastro; não mudar o isolamento Sprint 04 (`PICOLE CRE` vs `MORANGO`).

---

## 5. Produto ponta a ponta (após correção)

| Superfície | Visível? | Filtro |
|---|---|---|
| Banco por ID | sim | `id` |
| API `GET /produtos/:id` | sim | sem filtro fiscal de visibilidade |
| API `GET /produtos` (lista cadastro) | sim | categoria opcional; **não** oculta por `item_fiscal` |
| Pesquisa cadastro (`busca-operacional`) | sim, se `ativo=1` e `nome_busca` preenchido | `COALESCE(ativo,1)=1`; nome via `nome_busca` |
| Catálogo árvore | sim (grupo “Sem Categoria” se sem categoria; nós podem estar recolhidos) | cache de sessão |
| PDV | sim via a **mesma** busca operacional; estoque 0 **não** remove o hit | regras de venda/F12 são **outra** camada na identificação/fechamento, não nesta query de catálogo |

Cadastro ≠ PDV: `filtroSqlModoFiscalProduto` retorna `''` (item_fiscal não esconde no catálogo).

---

## 6. Idempotência (ponto 11+)

| Operação | Situação | Severidade |
|---|---|---|
| Duplo clique **salvar produto** | Corrigido no frontend (`__cdsProdutoSalvando`). Backend ainda aceita 2 POST com códigos auto diferentes → 2 produtos mesmo nome. UNIQUE só em `codigo`. | 🟠 Alto (residual) |
| Duplo clique **finalizar venda** | `confirmarPagamento` não tem lock de request. Enter/F10 pode reabrir fluxo. Sem chave de idempotência em `POST /api/vendas`. | 🔴 Crítico (não corrigido) |
| Compra mesma chave NF-e | `compras.js` consulta `chave_acesso` e UNIQUE; 400 se já lançada. | 🟢 Tratado |
| NF-e processar 2× | Depende da Central + UNIQUE da compra. Não houve teste ao vivo nesta sprint. | 🟡 Médio (não reproduzido ao vivo) |
| PIX | `mercadoPagoProvider` / `stoneProvider` geram chave com `Date.now()` / random — **retry cria outra cobrança**. | 🔴 Crítico |
| TEF | Há `idempotency_key` + unique index + lock service. Timeout/retry depende do cliente enviar a **mesma** chave. | 🟠 Alto |

---

## 7. Concorrência

| Operação | Achado |
|---|---|
| Estoque na venda | `VendaPagamentoService.atualizarSaldoProdutoAposBaixa`: um `UPDATE saldo_fiscal = saldo_fiscal - ?` atômico **por request**, sem `WHERE saldo >= qtd`. Dois caixas: last-write-wins clássico (10−1 e 10−1 → 9, não 8) se as transações intercalarem leituras antigas. SQLite serializa writers no mesmo arquivo, o que **mitiga** mas não substitui reserva/versão. | 🔴 Crítico (classificado, não corrigido) |
| Preço | PUT produto sem `updated_at` como versão; última gravação vence. | 🟡 Médio |
| Cadastro mesmo código | UNIQUE `produtos.codigo`; segundo recebe 400. Dois auto-códigos simultâneos podem gerar dois SKUs. | 🟠 Alto |
| Compra + venda simultâneas | Não testado ao vivo. | 🟠 Alto (bloqueado) |

---

## 8. Banco

- `produtos.categoria_id` FK declarada; JOIN de listagem é `LEFT JOIN` — categoria nula **não** some o produto.
- Exclusão de produto é **hard delete** (`DELETE FROM produtos`), não soft delete. Recriar o mesmo código funciona depois de apagar.
- Sem `empresa_id` em `produtos`: multi-empresa na mesma base **não existe** neste schema.
- `nome_busca` era preenchido só depois (MIB); produtos antigos com NULL continuam invisíveis na pesquisa por nome até backfill (`POST /api/produtos/mib/backfill-nome-busca`).
- Órfãos em produção **não** foram varridos em base de cliente nesta sprint (bloqueado: sem dump do cliente).
- SQL da busca operacional usa **parâmetros** (`?`), não concatenação do termo.

HTTP: dezenas de `res.status(500).json({ error: err.message })` em `produtos.js` e outras rotas. UNIQUE de código no POST vira **400** (ok). Validação normal em 500 permanece 🟠.

---

## 9. Backup

- Backup manual existe: `backend/services/backupManual.js`, `POST /api/backup/manual` (autenticado).
- Testes de **path/gravação**: `tests/backup/backup-path-config.test.js` (não reexecutado como restore).
- **Restore de banco da aplicação: não há rota/serviço geral de restore** (só `tefBackupService.restaurarBackup` para TEF).
- Backup **não validado** por restore completo de produtos/vendas/estoque/financeiro nesta sprint.

**Backup testado?** parcial (path). **Restore testado?** não.

---

## 10. E2E

| Fluxo | Resultado |
|---|---|
| Cadastro → banco → pesquisa (serviço + SQL) | PASS (suíte nova) |
| Acento / espaço / EAN / código / categoria vazia / UNIQUE / recriar | PASS |
| UI real (modal → tecla → lista) | BLOQUEADO (sem sessão browser do ERP nesta execução) |
| Compra NF-e → estoque → financeiro | Não reexecutado; há e2e em `tests/compras/` de sprints anteriores |
| Venda PDV → pagamento → estoque | Não reexecutado ao vivo |
| Cancelamento venda | Não reexecutado |
| Reinício no meio da venda | Não reexecutado |

---

## 11. Segurança (somente classificação — sem correção)

| Ponto | Severidade | Arquivo | Correção recomendada |
|---|---|---|---|
| JWT fallback se `JWT_SECRET` ausente | 🔴 | `backend/config/secrets.js` | Falhar boot em produção sem secret |
| Admin seed com senha padrão (valor omitido; definir via `ADMIN_SEED_PASSWORD`) | 🔴 | `backend/database.js` (~3295) | `ADMIN_SEED_PASSWORD`; bloquear se ainda for default |
| TEF encryption key fallback de desenvolvimento | 🔴 | `backend/services/crypto/cryptoService.js` | Exigir `TEF_ENCRYPTION_KEY` em produção |
| Token via URL | não encontrado `req.query.token` neste passe | — | manter recusa |
| Heartbeat público | `/ping`, `/api/ping`, `/api/terminais/auto`, `/api/dashboard` sem `verificarToken` na montagem | `backend/server.js` | autenticar dashboard; restringir auto-terminal |
| PIX idempotency `Date.now()` | 🔴 | providers Mercado Pago / Stone | chave estável = `venda_id` + tentativa |
| `err.message` na API | 🟠 | `produtos.js` e outros | envelope `{ ok, codigo, mensagem, request_id }` |

---

## 12. Tabela final

| Problema | Severidade | Reproduzido | Corrigido | Arquivo | Observação |
|---|---|---|---|---|---|
| Pesquisa não acha produto recém-cadastrado (`nome_busca` NULL) | 🔴 | sim | sim | `backend/rotas/produtos.js` | causa do relato |
| Frontend ignora cache se operacional volta 0 | 🟠 | sim (código) | não | `frontend/erp/js/produtos.js` | some se backfill falhar; não alargar busca |
| Validação validade após INSERT (órfão) | 🔴 | código | sim | `backend/rotas/produtos.js` | 400 agora **antes** do INSERT |
| POST “criado, mas falhou apresentações/atacado/lote” | 🟠 | código | não | `produtos.js` POST | transação não envolve o INSERT |
| Duplo clique salvar produto | 🟠 | código | sim (UI) | `produtos.js` front | 2 POST auto-código ainda possível |
| Código interno `abc001` ≠ `ABC001` | 🟡 | sim (teste) | não | busca operacional `codigo = ?` | regra atual; não alterar |
| Isolamento prefixo esconde CONTEM se outro produto tem prefixo | 🟡 | sim (Sprint 04) | não | `BuscaOperacionalProdutosService` | intencional |
| Produtos legados `nome_busca` NULL | 🟠 | inferido | não | coluna MIB | backfill |
| Duplo clique venda | 🔴 | código | não | `pdv.js` / `POST /vendas` | sprint própria |
| PIX retry nova cobrança | 🔴 | código | não | providers PIX | sprint própria |
| Estoque dois caixas | 🔴 | código | não | `VendaPagamentoService.js` | sprint própria |
| Sem tenant em produtos | 🟠 | schema | não | `database.js` | 1 base = 1 empresa |
| Restore ausente | 🔴 | código | não | `rotas/backup.js` | backup sem prova de restore |
| JWT/admin/TEF fallback | 🔴 | código | não | secrets / database | sprint segurança |
| `error: err.message` | 🟠 | grep | não | várias rotas | sprint HTTP |
| Árvore recolhida “não vejo o produto” | 🟢 | UX | não | listagem | pesquisa deve achar |

---

## 13. Testes

| Nome | Resultado |
|---|---|
| POST inclui nome_busca e ativo no INSERT | PASS |
| frontend trava duplo clique em saveProduto | PASS |
| legado: INSERT sem nome_busca invisível por nome | PASS (reproduz o bug) |
| corrigido: ID + nome + código + parte do nome + token AUDITORIA | PASS |
| acentos e espaços | PASS |
| EAN zeros à esquerda | PASS |
| ABC001 vs abc001 (regra atual) | PASS |
| sem categoria | PASS |
| ativo=1 entra / ativo=0 fora | PASS |
| mesmo nome códigos diferentes | PASS |
| UNIQUE código | PASS |
| excluir e recriar código | PASS |
| paginação termo específico | PASS |
| isolamento PICOLE CRE (Sprint 04) | PASS |
| schema sem empresa_id | PASS |
| GET lista não filtra item_fiscal | PASS |
| RC4.31.5 INSERT alignment | PASS |
| mib-sprint04 “Produto encontrado, mas sem estoque” | FAIL (pré-existente no PDV; **fora desta correção**) |
| E2E UI cadastro | BLOQUEADO |
| Restore backup | BLOQUEADO |
| Venda/compra/PIX/TEF ao vivo | BLOQUEADO |
| Dois caixas simultâneos | BLOQUEADO |
| Login usuário A/B (tenant) | N/A (sem tenant na tabela) |

---

## 14. Total (esta sprint)

- **17 PASS** na suíte de cadastro/pesquisa  
- **7 PASS** alignment INSERT  
- **1 FAIL** pré-existente (Sprint 04 string PDV) — não alterado  
- **6+ BLOQUEADOS** (UI, restore, concorrência ao vivo, pagamentos ao vivo)

---

## 15. Riscos restantes (reais)

1. Produtos já gravados com `nome_busca` NULL continuam invisíveis na pesquisa por nome até backfill.
2. Venda/PIX sem idempotência estável — duplicidade possível.
3. Baixa de estoque sem reserva/versão — saldo pode divergir com dois caixas.
4. Cadastro POST não é transação única — falha em embalagem/lote deixa produto “parcial” com 500.
5. Não há restore oficial do SQLite da aplicação — backup sem prova de recuperação.
6. Segredos com fallback de desenvolvimento em produção se env não estiver setado.
7. Pesquisa `abc001` não acha `ABC001` (identificador case-sensitive).
8. Se o operador só olha a árvore recolhida e não pesquisa, o produto “some” visualmente (UX).

---

## Visibilidade por módulo (item 49)

| Módulo | Fonte | Filtros |
|---|---|---|
| Cadastro lista/árvore | `GET /api/produtos` + cache | categoria UI; não item_fiscal |
| Cadastro pesquisa | `busca-operacional` | `ativo`, `nome_busca`, identificadores, limite 20 |
| Catálogo sessão | memória | reuso até F12/forçar |
| PDV autocomplete | `busca-operacional` | mesmo; estoque 0 permanece hit |
| Autocomplete pedidos | `consulta-pdv/buscar` (MIB) | SearchService |
| Central NF-e | matching GTIN/código/nome próprio | não é a busca do cadastro |

Um filtro de um módulo **não deve** ser usado para explicar sumiço no cadastro. Neste bug, o sumiço era da **pesquisa operacional**, não do PDV fiscal.
