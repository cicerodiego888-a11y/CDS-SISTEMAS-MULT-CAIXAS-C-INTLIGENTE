# Sprint 17 — Relatório final

## 1. Status

**PASSOU — implementação e validação isolada.** A regra está centralizada e integrada aos fluxos operacionais auditados. A normalização global de dados reais não foi executada, conforme a proibição desta Sprint; deverá ser feita depois por procedimento operacional aprovado.

## 2. Arquivos alterados

- `backend/services/categorias/categoriaPadroes.js`
- `backend/services/categorias/normalizacaoProdutosCategoriaEspecial.js` — novo serviço idempotente
- `backend/rotas/produtos.js`
- `backend/rotas/categorias.js`
- `backend/rotas/compras.js`
- `backend/services/importacao-inicial-produtos/importer.js`
- `tests/produtos/categoria-padroes-cadastro.test.js`
- `tests/produtos/sprint17-normalizacao-categoria.test.js` — novos testes isolados
- `docs/SPRINT17_RELATORIO_FINAL.md`

## 3. Arquivos auditados sem alteração

- `backend/rotas/subcategorias.js`
- `backend/services/importacao-inicial-produtos/classificadorCategoria.js`
- `backend/database.js`
- `backend/services/estoque/produtoControlaEstoque.js`
- `backend/certification/CentralInteligenteHomologacaoService.js`
- `backend/certification/ReleaseCertificationService.js`
- `frontend/erp/js/produtos.js`
- `frontend/erp/js/importacao-inicial-produtos.js`
- testes de compra, importação, F×NF, F12 e venda sem estoque

Os dois serviços de `backend/certification` inserem produtos em cenários de certificação/homologação; não são caminhos de cadastro da aplicação. A busca de escrita operacional encontrou os três caminhos abaixo.

## 4. Caminhos de criação e alteração encontrados

| Arquivo e função | Fluxo e origem dos flags | Prioridade observada |
|---|---|---|
| `backend/rotas/produtos.js` — `router.post('/')` / `iniciarComFlags` | Cadastro manual. Busca a categoria por `categoria_id` e chama `resolverFlagsNovoProduto`. | Açougue/Hortifruti força 0/0, mesmo se payload enviar 1/1. Nas demais categorias, `controla_estoque` explícito prevalece sobre padrão da categoria; `item_fiscal`/`controle_comercial` explícito prevalece sobre padrão da categoria. Sem categoria, mantém o default global/comportamento anterior. |
| `backend/services/importacao-inicial-produtos/importer.js` — `inserirProduto` | Importação inicial cria o produto com a categoria resolvida pela classificação/importação. Lê o nome da categoria persistida e aplica `resolverFlagsObrigatoriosCategoria`. | As duas categorias forçam 0/0. Nos demais casos, a regra preexistente da importação permanece: estoque vem da origem (com default 1) e item fiscal permanece 0 apenas quando a origem informa 0; caso contrário, 1. |
| `backend/rotas/compras.js` — `ensureProductForItemLegado`, chamada por `ensureProductForItem` e `processarItensCompra` | Fallback de criação automática durante entrada/compra após tentativas MIP/MIIP. Quando categoria é informada, resolve por ID ou nome normalizado. A classificação fiscal da entrada continua sendo calculada separadamente pela quantidade fiscal do item. | Açougue/Hortifruti força os flags do cadastro em 0/0. Para categorias comuns, preserva o legado: `item_fiscal` deriva da quantidade fiscal e `controla_estoque` fica no default 1. |
| `backend/rotas/produtos.js` — `router.put('/:id')` | Alteração do produto/categoria. Depois de salvar, normaliza o produto na categoria efetiva. | Destino especial força 0/0. Fora dessas categorias, não restaura nem inventa flags; os campos seguem o payload e o comportamento anterior. |
| `backend/rotas/categorias.js` — `router.put('/:id')` | Renomear uma categoria para Açougue/Hortifruti normaliza os produtos vinculados àquele ID. | A regra especial prevalece para os produtos já vinculados. |
| `backend/services/importacao-inicial-produtos/importer.js` — `atualizarProdutoExistente` | Pode associar classificação a produto existente quando permitido pela política do importador; depois verifica a categoria atual e normaliza se especial. | 0/0 se a categoria efetiva for especial; sem mudança de saldo. |

**Outros caminhos:** MIP/MIIP localizam e associam produtos existentes, mas não inserem linhas em `produtos`. A busca ampla de `INSERT INTO produtos` não encontrou outro caminho operacional de criação no backend.

## 5. Regra central

`categoriaPadroes.js` é a definição central: normaliza acentos, caixa, espaços e pontuação e reconhece Açougue/Hortifruti e suas extensões nominais já aceitas pelo serviço. `resolverFlagsObrigatoriosCategoria(nome)` retorna os flags obrigatórios 0/0. Cadastro manual, importação, compra automática e normalização reutilizam essa identificação; os controllers não mantêm definições textuais conflitantes.

A auditoria não encontrou IDs ou códigos reservados para essas categorias. A identificação oficial disponível no sistema é o nome normalizado já usado pelo serviço central e pelo classificador de importação.

## 6. Normalização de produtos existentes

`normalizacaoProdutosCategoriaEspecial.js` expõe `normalizarProdutosCategoriaEspecial(db, opcoes)` e `normalizarProdutoCategoriaEspecial(db, produtoId, categoriaId)`. A rotina seleciona categorias pelo identificador central e executa somente:

```sql
UPDATE produtos
SET item_fiscal = 0, controla_estoque = 0
WHERE categoria_id IN (...) AND (...flags divergentes...)
```

É idempotente: uma segunda execução não altera linhas já normalizadas. Pode ser chamada para todos os produtos especiais, para uma categoria ou para um produto. Não há execução automática na inicialização; isso evita escrita global inadvertida.

## 7. Integridade de estoque e histórico

A rotina não inclui nem atualiza `saldo_fiscal`, `saldo_nao_fiscal`, `estoque_atual`, reservas ou comprometimentos. Também não chama serviços de ajuste, não grava movimentação, venda ou documento fiscal. Os testes com SQLite `:memory:` comparam esses campos antes/depois e verificam que `produtos_ajustes_estoque` permanece vazio.

## 8. Testes e resultado

- Sprint 17 isolada: **8 PASS, 0 FAIL, 0 SKIP**.
- Padrões/cadastro de categoria: **17 PASS, 0 FAIL, 0 SKIP**.
- Importação inicial V1.1.2: **36 PASS, 0 FAIL, 0 SKIP**.
- Importação inicial V1.1.4: **16 PASS, 0 FAIL, 0 SKIP**.
- Regressão RC9.1 de classificação fiscal de entrada: teste passou (16 verificações internas OK).
- Regressão MIP Sprint 07 de compra/XML: teste passou (9 verificações internas OK).
- Bateria certificada F×NF, Sprint 8, Sprint 9 e venda sem estoque: **55 PASS, 0 FAIL, 0 SKIP**.
- Política F12 no runner Mocha do repositório: **30 PASS, 10 FAIL** em operações de estado de caixa/fixture. F12 não foi alterado. O teste avulso inicialmente invocado com `node --test` também não é compatível com seu runner Mocha; o resultado Mocha acima é o válido.

As regressões de importação utilizaram bancos sob `%TEMP%`; os novos testes de Sprint 17 usam SQLite `:memory:`. Nenhum dos testes abriu `C:\ProgramData\MercantilFiscal\dados\mercadao.db`.

## 9. Casos principais cobertos

- Produto manual em categoria especial com flags explícitos conflitantes: central resolver retorna 0/0.
- Produto novo importado para Açougue: grava 0/0 apesar da origem 1/1.
- Produto criado automaticamente em compra para Hortifruti: grava 0/0; natureza fiscal do item de entrada não é reclassificada.
- Produto comum em compra: mantém o default legado 1/1.
- Produtos já existentes de Açougue/Hortifruti: normalização altera somente flags e é idempotente.
- Produto comum: não é normalizado.
- Mudança para Açougue e para Hortifruti: flags passam a 0/0 sem alterar saldo.
- Mudança de categoria especial para comum: não cria regra reversa nem restaura valores automaticamente.
- Saldo fiscal/não fiscal, estoque total, reserva, comprometimento e tabela de ajustes permanecem intactos.

## 10–13. Restrições confirmadas

- **BANCO REAL NÃO ALTERADO.** A rotina global não foi executada contra banco real.
- **MOTOR F×NF NÃO ALTERADO NESTA SPRINT.** O arquivo `backend/services/distribuidorEstoqueVenda.js` não foi editado por esta tarefa; a bateria passou 55/55.
- **F12 NÃO ALTERADO NESTA SPRINT.** Os arquivos de F12 não foram editados por esta tarefa; a suíte Mocha teve 10 falhas em operações de estado de caixa registradas acima.
- **VENDA SEM ESTOQUE NÃO ALTERADO NESTA SPRINT.** O motor não foi editado por esta tarefa; 11/11 casos desse grupo passaram.
- TEF, impressão, Electron/ASAR e manifestos não foram alterados. Não houve build nem geração de ASAR/manifesto.

Nota do worktree: a checagem final mostrou outras alterações staged/unstaged e arquivos não rastreados em diversos módulos, incluindo F×NF, F12, TEF, Electron e manifestos. Eles não foram editados nem limpos por esta tarefa; não se atribui aqui a origem ou o estado-base dessas alterações. Uma verificação global `git diff --check` também reportou trailing whitespace em `docs/build/release-certification-report.pdf`, fora do escopo e não alterado nesta Sprint.

## 14. Caminhos que ainda podem escapar

Nenhum caminho alternativo de criação operacional foi encontrado na busca de `INSERT INTO produtos` e nos fluxos MIP/MIIP auditados. A criação automática em compra só recebe categoria quando o chamador informa ID/nome; sem categoria informada, o produto continua sem categoria, como no fluxo anterior. Escritas externas diretas no SQLite, fora dos fluxos da aplicação, não são interceptadas por esta regra e devem ser cobertas pelo procedimento operacional aprovado.
