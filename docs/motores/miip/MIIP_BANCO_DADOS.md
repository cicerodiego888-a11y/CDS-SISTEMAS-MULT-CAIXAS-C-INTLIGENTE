# MIIP — Estrutura de Banco de Dados (Versão Profissional)

> **MIIP V1.0 RC1** — Documentação congelada. Pipeline oficial com 6 motores. Ver [ARQUITETURA_MIIP.md](./ARQUITETURA_MIIP.md).


**Sprint:** 2 — Banco de Dados  
**Status:** ✅ Estrutura implementada em `backend/database.js` — **aguardando aprovação formal**  
**Escopo:** Somente persistência. Sem lógica de negócio, rotas, repositories, motores ou alterações no ERP.

Este documento descreve as tabelas estruturais do **MIIP — Motor Inteligente de Identificação de Produtos**.

As migrations estão em `backend/database.js`, função `criarTabelasMiip()`, usando `CREATE TABLE IF NOT EXISTS` e `CREATE INDEX IF NOT EXISTS` — mesmo padrão do CDS (`tef_*`, `equipamentos`, etc.).

---

## Arquivos envolvidos

| Arquivo | Papel |
|---------|-------|
| `backend/database.js` | Função `criarTabelasMiip()` — DDL das 5 tabelas + 29 índices |
| `docs/MIIP_BANCO_DADOS.md` | Este documento |

**Não alterados (critério de aceite):** tabelas ERP (`produtos`, `compras`, …), rotas, XML, `ensureProductForItem()`, telas.

---

## Mapeamento — Prompt Sprint 2 → Implementação

A versão implementada **expande** os campos sugeridos no prompt para suportar escala (1M+ decisões), motores plugáveis e sincronização Cloud, sem perder a semântica original.

### `miip_associacoes` (tabela principal — aprendizado)

| Campo no prompt | Campo implementado | Observação |
|-----------------|-------------------|------------|
| `id` | `id` | PK autoincremental |
| `fornecedor_id` | — | Reservado: usar `fornecedor_cnpj` (independente de FK ERP) |
| `fornecedor_cnpj` | `fornecedor_cnpj` | Lookup principal Motor Fornecedor |
| `codigo_fornecedor` | `codigo_fornecedor` | cProd do XML/NF-e |
| `descricao_fornecedor` | `nome_item` + `fornecedor_nome` | Descrição XML + razão social |
| `produto_id` | `produto_id` | Produto interno vinculado |
| `confianca` | `confianca` | `ALTA`, `MEDIA`, `BAIXA`, `NENHUMA` |
| `confirmacoes` | `metadados` (futuro) / `last_used_at` | Contador explícito em sprint futura |
| `origem` | `origem` | `manual`, `feedback`, `xml`, `compra`, `cloud` |
| `ativo` | `status` | `ativa` / `inativa` / `revisao` |
| `criado_em` | `created_at` | |
| `atualizado_em` | `updated_at` | |
| `ultima_confirmacao` | `last_used_at` | Último uso / confirmação |

**Campos extras (versão profissional):** `codigo_barras`, `nome_normalizado`, `ncm`, `unidade`, `score`, `fonte`, `decisao_operacao_id`, `confirmado_por_usuario_id`, `metadados`.

### `miip_decisoes` (histórico append-only)

| Campo no prompt | Campo implementado | Observação |
|-----------------|-------------------|------------|
| `request_id` | `operacao_id` + `metadados.requestId` | UUID público da operação |
| `produto_xml` | `item_snapshot` | JSON completo do item externo |
| `produto_escolhido` | `produto_decidido_id` | Produto final escolhido |
| `acao` | `acao_recomendada` | `auto_vincular`, `sugerir`, … |
| `confianca` | `confianca` | |
| `score` | `score_final` | |
| `tempo_execucao` | `duracao_total_ms` | |
| `relatorio_json` | `candidatos_snapshot` + `motores_snapshot` | Relatório estruturado |
| `usuario` | `usuario_id` | Referência lógica (sem obrigatoriedade) |
| `data` | `created_at` | |

**Campos extras:** `origem`, `item_hash`, `contexto_snapshot`, `produto_sugerido_id`, `score_gap`, `conflito`, `feedback_status`, `erro`, `decided_at`.

### `miip_sinonimos`

| Campo no prompt | Campo implementado |
|-----------------|-------------------|
| `palavra_original` | `termo` |
| `palavra_normalizada` | `termo_normalizado` |
| `categoria` | `tipo` (`geral`, `produto`, `marca`, …) |
| `confirmacoes` | `uso_count` |
| `ativo` | `ativo` |
| `origem` | `origem` |

### `miip_estatisticas`

| Campo no prompt | Campo implementado |
|-----------------|-------------------|
| `produto_id` | Via `escopo='produto'` + `chave` |
| `total_consultas` | `total_decisoes` |
| `total_acertos` | `total_acertos` |
| `total_erros` | `total_erros` |
| `ultima_utilizacao` | `updated_at` |

**Modelo expandido:** agregação por `escopo` + `chave` + `periodo_tipo` (global, engine, fornecedor, produto, origem).

### `miip_configuracoes`

| Campo no prompt | Campo implementado |
|-----------------|-------------------|
| `chave` | `chave` (UNIQUE) |
| `valor` | `valor` |
| `descricao` | `descricao` |

**Campos extras:** `tipo`, `categoria`, `editavel`, `versao`, `metadados`.

---

## Tabelas criadas

| Tabela | Finalidade | Volume esperado |
|--------|------------|-----------------|
| `miip_associacoes` | Vínculos aprendidos item externo → produto interno | 10k – 500k |
| `miip_decisoes` | Auditoria de cada identificação | **1M+** (crescimento contínuo) |
| `miip_sinonimos` | Sinônimos e aliases textuais | 10k – 200k |
| `miip_estatisticas` | Agregados por período/escopo | Baixo (milhares) |
| `miip_configuracoes` | Configuração runtime (thresholds, motores, cache) | Baixo (dezenas) |

---

## `miip_decisoes`

Registra cada decisão de identificação feita pelo MIIP. Tabela de **append-only** — principal candidata a ultrapassar 1 milhão de registros.

| Coluna | Tipo | Obrigatório | Descrição |
|--------|------|-------------|-----------|
| `id` | INTEGER | Sim | PK autoincremental |
| `operacao_id` | TEXT | Sim | UUID público da operação (feedback e auditoria) |
| `origem` | TEXT | Sim | `xml`, `compra`, `pdv`, `api`, `cloud`, `indefinida` |
| `item_hash` | TEXT | Não | Hash estável do item para deduplicação |
| `item_snapshot` | TEXT | Sim | JSON do `ItemIdentificavelDTO` recebido |
| `contexto_snapshot` | TEXT | Não | JSON do `MiipContext` |
| `candidatos_snapshot` | TEXT | Não | JSON dos candidatos avaliados |
| `motores_snapshot` | TEXT | Não | JSON dos engines executados |
| `produto_sugerido_id` | INTEGER | Não | FK → `produtos.id` (top 1 sugerido) |
| `produto_decidido_id` | INTEGER | Não | FK → `produtos.id` (produto final) |
| `acao_recomendada` | TEXT | Não | `auto_vincular`, `sugerir`, `criar_novo`, `revisar_manual` |
| `confianca` | TEXT | Não | `ALTA`, `MEDIA`, `BAIXA`, `NENHUMA` |
| `score_final` | REAL | Não | Score do melhor candidato (0–100) |
| `score_gap` | REAL | Não | Diferença entre 1º e 2º candidato |
| `conflito` | INTEGER | Não | 0/1 — conflito entre motores de alta precisão |
| `feedback_status` | TEXT | Não | `pendente`, `confirmado`, `corrigido`, `ignorado` |
| `usuario_id` | INTEGER | Não | FK → `usuarios.id` |
| `duracao_total_ms` | INTEGER | Não | Tempo total da decisão (ms) |
| `erro` | TEXT | Não | Mensagem de erro do pipeline |
| `metadados` | TEXT | Não | JSON livre (`requestId`, `cacheHit`, `version`, etc.) |
| `created_at` | DATETIME | Sim | Criação do registro |
| `updated_at` | DATETIME | Sim | Última atualização |
| `decided_at` | DATETIME | Não | Confirmação da decisão final |

### Índices

| Índice | Colunas | Tipo | Finalidade |
|--------|---------|------|------------|
| `UNIQUE` | `operacao_id` | Constraint | Lookup direto por operação |
| `idx_miip_decisoes_operacao` | `operacao_id` | B-tree | Busca por UUID |
| `idx_miip_decisoes_origem_created` | `origem`, `created_at` | Composto | Histórico por origem e período |
| `idx_miip_decisoes_item_hash` | `item_hash` | B-tree | Deduplicação |
| `idx_miip_decisoes_produto_decidido` | `produto_decidido_id` | B-tree | Auditoria por produto |
| `idx_miip_decisoes_confianca` | `confianca` | B-tree | Métricas por confiança |
| `idx_miip_decisoes_created_at` | `created_at` | B-tree | Retenção, purge e range scans |
| `idx_miip_decisoes_origem_confianca_created` | `origem`, `confianca`, `created_at` | Composto | Dashboards filtrados |
| `idx_miip_decisoes_feedback_pendente` | `feedback_status`, `created_at` | Parcial | Fila de feedback pendente |

---

## `miip_associacoes`

Vínculos aprendidos ou confirmados entre item externo e produto interno. Tabela de **lookup frequente**.

| Coluna | Tipo | Obrigatório | Descrição |
|--------|------|-------------|-----------|
| `id` | INTEGER | Sim | PK autoincremental |
| `produto_id` | INTEGER | Sim | FK → `produtos.id` ON DELETE CASCADE |
| `origem` | TEXT | Sim | `manual`, `feedback`, `xml`, `compra`, `cloud` |
| `fornecedor_cnpj` | TEXT | Não | CNPJ normalizado do fornecedor |
| `fornecedor_nome` | TEXT | Não | Razão social / nome do fornecedor |
| `codigo_fornecedor` | TEXT | Não | cProd do fornecedor |
| `codigo_barras` | TEXT | Não | EAN/GTIN do item |
| `nome_item` | TEXT | Sim | Nome original do item externo |
| `nome_normalizado` | TEXT | Não | Nome tratado para busca |
| `ncm` | TEXT | Não | NCM do item |
| `unidade` | TEXT | Não | Unidade de medida |
| `score` | REAL | Não | Score no momento da associação |
| `confianca` | TEXT | Não | Confiança no momento da associação |
| `status` | TEXT | Sim | `ativa`, `inativa`, `revisao` |
| `fonte` | TEXT | Sim | `local`, `cloud`, `manual`, `aprendizado` |
| `decisao_operacao_id` | TEXT | Não | FK lógica → `miip_decisoes.operacao_id` |
| `confirmado_por_usuario_id` | INTEGER | Não | FK → `usuarios.id` |
| `metadados` | TEXT | Não | JSON livre |
| `created_at` | DATETIME | Sim | Criação |
| `updated_at` | DATETIME | Sim | Última atualização |
| `last_used_at` | DATETIME | Não | Último uso (LRU / estatísticas) |

### Índices

| Índice | Colunas | Tipo | Finalidade |
|--------|---------|------|------------|
| `idx_miip_associacoes_produto` | `produto_id` | B-tree | Aliases por produto |
| `idx_miip_associacoes_fornecedor_codigo` | `fornecedor_cnpj`, `codigo_fornecedor` | Composto | Lookup Motor Fornecedor |
| `idx_miip_associacoes_codigo_barras` | `codigo_barras` | B-tree | Lookup por GTIN |
| `idx_miip_associacoes_nome_normalizado` | `nome_normalizado` | B-tree | Busca textual |
| `idx_miip_associacoes_status` | `status` | B-tree | Filtro ativo/inativo |
| `idx_miip_associacoes_created` | `created_at` | B-tree | Auditoria por período |
| `idx_miip_associacoes_fornecedor_codigo_ativo` | `fornecedor_cnpj`, `codigo_fornecedor` | Único parcial | Uma associação ativa por CNPJ+cProd |
| `idx_miip_associacoes_status_fornecedor_codigo` | `status`, `fornecedor_cnpj`, `codigo_fornecedor` | Composto | Query com filtro de status |
| `idx_miip_associacoes_last_used_at` | `last_used_at` | B-tree | LRU e limpeza |
| `idx_miip_associacoes_decisao_operacao` | `decisao_operacao_id` | B-tree | Rastreio à decisão origem |

---

## `miip_sinonimos`

Sinônimos, termos normalizados e aliases para motores de similaridade.

| Coluna | Tipo | Obrigatório | Descrição |
|--------|------|-------------|-----------|
| `id` | INTEGER | Sim | PK autoincremental |
| `termo` | TEXT | Sim | Termo original |
| `termo_normalizado` | TEXT | Sim | Termo tratado para busca |
| `termo_canonico` | TEXT | Não | Forma canônica preferencial |
| `tipo` | TEXT | Sim | `geral`, `produto`, `marca`, `fornecedor`, `unidade` |
| `produto_id` | INTEGER | Não | FK → `produtos.id` ON DELETE CASCADE |
| `fornecedor_cnpj` | TEXT | Não | CNPJ quando sinônimo é específico |
| `peso` | REAL | Não | Peso na similaridade (default 1.0) |
| `origem` | TEXT | Sim | `manual`, `feedback`, `cloud`, `sistema` |
| `ativo` | INTEGER | Não | 0/1 — sinônimo habilitado |
| `uso_count` | INTEGER | Não | Contador de uso |
| `metadados` | TEXT | Não | JSON livre |
| `created_at` | DATETIME | Sim | Criação |
| `updated_at` | DATETIME | Sim | Última atualização |

### Índices

| Índice | Colunas | Tipo | Finalidade |
|--------|---------|------|------------|
| `idx_miip_sinonimos_normalizado` | `termo_normalizado` | B-tree | Busca textual |
| `idx_miip_sinonimos_tipo` | `tipo` | B-tree | Filtro por tipo |
| `idx_miip_sinonimos_produto` | `produto_id` | B-tree | Sinônimos por produto |
| `idx_miip_sinonimos_fornecedor` | `fornecedor_cnpj` | B-tree | Sinônimos por fornecedor |
| `idx_miip_sinonimos_ativo` | `ativo` | B-tree | Filtro ativos |
| `idx_miip_sinonimos_escopo` | `tipo`, `termo_normalizado`, `produto_id`, `fornecedor_cnpj` | Único | Anti-duplicidade |
| `idx_miip_sinonimos_tipo_ativo_normalizado` | `tipo`, `ativo`, `termo_normalizado` | Composto | Lookup motor similaridade |
| `idx_miip_sinonimos_ativo_normalizado` | `termo_normalizado` | Parcial (`ativo = 1`) | Busca só em ativos |

---

## `miip_estatisticas`

Agregados para dashboard, métricas e MIIP Cloud. Volume controlado por design (um registro por escopo/chave/período).

| Coluna | Tipo | Obrigatório | Descrição |
|--------|------|-------------|-----------|
| `id` | INTEGER | Sim | PK autoincremental |
| `escopo` | TEXT | Sim | `global`, `engine`, `fornecedor`, `produto`, `origem` |
| `chave` | TEXT | Sim | Identificador dentro do escopo (ex.: `motor_gtin`) |
| `periodo_tipo` | TEXT | Sim | `diario`, `semanal`, `mensal`, `total` |
| `periodo_inicio` | DATE | Sim | Início do período |
| `periodo_fim` | DATE | Não | Fim do período |
| `total_decisoes` | INTEGER | Não | Total de decisões |
| `total_auto_vinculadas` | INTEGER | Não | Ação `auto_vincular` |
| `total_sugestoes` | INTEGER | Não | Ação `sugerir` |
| `total_criados_novos` | INTEGER | Não | Ação `criar_novo` |
| `total_revisao_manual` | INTEGER | Não | Ação `revisar_manual` |
| `total_feedbacks` | INTEGER | Não | Feedbacks recebidos |
| `total_acertos` | INTEGER | Não | Feedbacks confirmados |
| `total_erros` | INTEGER | Não | Feedbacks corrigidos |
| `confianca_alta` | INTEGER | Não | Decisões ALTA |
| `confianca_media` | INTEGER | Não | Decisões MEDIA |
| `confianca_baixa` | INTEGER | Não | Decisões BAIXA |
| `confianca_nenhuma` | INTEGER | Não | Decisões NENHUMA |
| `score_medio` | REAL | Não | Score médio do período |
| `tempo_medio_ms` | REAL | Não | Tempo médio de decisão |
| `metadados` | TEXT | Não | JSON livre |
| `created_at` | DATETIME | Sim | Criação |
| `updated_at` | DATETIME | Sim | Última atualização |

### Índices

| Índice | Colunas | Tipo | Finalidade |
|--------|---------|------|------------|
| `UNIQUE(escopo, chave, periodo_tipo, periodo_inicio)` | — | Constraint | Um agregado por escopo/período |
| `idx_miip_estatisticas_periodo` | `periodo_tipo`, `periodo_inicio` | Composto | Dashboard temporal |
| `idx_miip_estatisticas_escopo` | `escopo` | B-tree | Filtro por escopo |
| `idx_miip_estatisticas_chave` | `chave` | B-tree | Filtro por chave |
| `idx_miip_estatisticas_escopo_periodo` | `escopo`, `periodo_tipo`, `periodo_inicio` | Composto | Query combinada |

---

## `miip_configuracoes`

Configuração runtime do MIIP (thresholds, motores ativos, cache, cloud). Padrão key-value alinhado a `tef_configuracoes`.

| Coluna | Tipo | Obrigatório | Descrição |
|--------|------|-------------|-----------|
| `id` | INTEGER | Sim | PK autoincremental |
| `chave` | TEXT | Sim | Chave única (ex.: `motores.motor_gtin.ativo`) |
| `valor` | TEXT | Não | Valor serializado (string, número ou JSON) |
| `tipo` | TEXT | Sim | `string`, `number`, `boolean`, `json` |
| `categoria` | TEXT | Sim | `geral`, `motores`, `thresholds`, `cache`, `cloud`, `retencao` |
| `descricao` | TEXT | Não | Descrição legível para admin |
| `editavel` | INTEGER | Sim | 0/1 — permite edição via UI |
| `versao` | INTEGER | Sim | Versão do schema da chave |
| `metadados` | TEXT | Não | JSON livre (validação, default, etc.) |
| `created_at` | DATETIME | Sim | Criação |
| `updated_at` | DATETIME | Sim | Última atualização |

### Índices

| Índice | Colunas | Tipo | Finalidade |
|--------|---------|------|------------|
| `UNIQUE` | `chave` | Constraint | Lookup por chave |
| `idx_miip_configuracoes_categoria` | `categoria` | B-tree | Listagem por categoria |
| `idx_miip_configuracoes_tipo` | `tipo` | B-tree | Filtro por tipo de valor |

### Chaves previstas (seed futuro)

| Chave | Categoria | Tipo | Exemplo |
|-------|-----------|------|---------|
| `threshold.auto_vincular` | thresholds | number | `85` |
| `threshold.sugerir` | thresholds | number | `50` |
| `motores.motor_gtin.ativo` | motores | boolean | `true` |
| `cache.habilitado` | cache | boolean | `true` |
| `cache.ttl_gtin_segundos` | cache | number | `300` |
| `cloud.habilitado` | cloud | boolean | `false` |
| `retencao.decisoes_dias` | retencao | number | `365` |

---

## Relacionamentos futuros

```
produtos ─────────────┬──< miip_associacoes (produto_id)
                      ├──< miip_sinonimos (produto_id)
                      ├──< miip_decisoes (produto_sugerido_id)
                      └──< miip_decisoes (produto_decidido_id)

usuarios ─────────────┬──< miip_decisoes (usuario_id)
                      └──< miip_associacoes (confirmado_por_usuario_id)

miip_decisoes ────────< miip_associacoes (decisao_operacao_id → operacao_id)

miip_configuracoes ────> MotorRegistry / MiipOrchestrator (runtime)

miip_estatisticas ────> metrics/ + MiipService.obterEstatisticas()
```

**Nota:** `decisao_operacao_id` é FK lógica (TEXT → TEXT), não FK SQLite, para evitar dependência circular e permitir decisões órfãs em purge de retenção.

---

## Índices — inventário completo (29)

Índices exigidos pelo prompt e cobertura adicional para desempenho.

| Índice | Tabela | Colunas | Atende prompt |
|--------|--------|---------|---------------|
| `idx_miip_associacoes_produto` | associacoes | `produto_id` | ✅ `produto_id` |
| `idx_miip_associacoes_fornecedor_codigo` | associacoes | `fornecedor_cnpj`, `codigo_fornecedor` | ✅ CNPJ + cProd |
| `idx_miip_associacoes_fornecedor_codigo_ativo` | associacoes | CNPJ + cProd (único parcial, `status='ativa'`) | ✅ Anti-duplicidade |
| `idx_miip_associacoes_status_fornecedor_codigo` | associacoes | `status`, CNPJ, cProd | Composto |
| `idx_miip_associacoes_codigo_barras` | associacoes | `codigo_barras` | GTIN |
| `idx_miip_associacoes_nome_normalizado` | associacoes | `nome_normalizado` | Textual |
| `idx_miip_associacoes_status` | associacoes | `status` | Filtro ativo |
| `idx_miip_associacoes_created` | associacoes | `created_at` | Auditoria |
| `idx_miip_associacoes_last_used_at` | associacoes | `last_used_at` | LRU |
| `idx_miip_associacoes_decisao_operacao` | associacoes | `decisao_operacao_id` | Rastreio |
| `idx_miip_decisoes_operacao` | decisoes | `operacao_id` | ✅ `request_id` |
| `idx_miip_decisoes_origem_created` | decisoes | `origem`, `created_at` | Histórico |
| `idx_miip_decisoes_item_hash` | decisoes | `item_hash` | Deduplicação |
| `idx_miip_decisoes_produto_decidido` | decisoes | `produto_decidido_id` | Por produto |
| `idx_miip_decisoes_confianca` | decisoes | `confianca` | Métricas |
| `idx_miip_decisoes_created_at` | decisoes | `created_at` | Purge 1M+ |
| `idx_miip_decisoes_origem_confianca_created` | decisoes | composto | Dashboard |
| `idx_miip_decisoes_feedback_pendente` | decisoes | parcial `feedback_status` | Fila feedback |
| `idx_miip_sinonimos_normalizado` | sinonimos | `termo_normalizado` | ✅ normalizada |
| `idx_miip_sinonimos_tipo` | sinonimos | `tipo` | Categoria |
| `idx_miip_sinonimos_produto` | sinonimos | `produto_id` | Escopo produto |
| `idx_miip_sinonimos_fornecedor` | sinonimos | `fornecedor_cnpj` | Escopo fornecedor |
| `idx_miip_sinonimos_ativo` | sinonimos | `ativo` | Filtro |
| `idx_miip_sinonimos_escopo` | sinonimos | único composto | Anti-duplicidade |
| `idx_miip_sinonimos_tipo_ativo_normalizado` | sinonimos | composto | Lookup motor |
| `idx_miip_sinonimos_ativo_normalizado` | sinonimos | parcial `ativo=1` | Só ativos |
| `idx_miip_estatisticas_periodo` | estatisticas | `periodo_tipo`, `periodo_inicio` | Temporal |
| `idx_miip_estatisticas_escopo` | estatisticas | `escopo` | Filtro |
| `idx_miip_estatisticas_chave` | estatisticas | `chave` | Filtro |
| `idx_miip_estatisticas_escopo_periodo` | estatisticas | composto | Dashboard |
| `idx_miip_configuracoes_categoria` | configuracoes | `categoria` | Agrupamento |
| `idx_miip_configuracoes_tipo` | configuracoes | `tipo` | Tipo de valor |

> **Nota:** `fornecedor_id` do prompt não foi criado como FK — o MIIP usa `fornecedor_cnpj` (texto normalizado) para independência total das tabelas ERP e sincronização Cloud.

---

## Crescimento esperado

| Tabela | Volume esperado | Estratégia |
|--------|-----------------|------------|
| `miip_associacoes` | 10k → **500k – 1M+** | Índice único parcial CNPJ+cProd; lookup O(log n) |
| `miip_decisoes` | **1M+** contínuo | Append-only; purge por `created_at`; snapshots JSON |
| `miip_sinonimos` | 10k → 200k | Índice parcial `ativo=1`; FTS5 futuro |
| `miip_estatisticas` | Baixo (milhares) | Pré-agregação — evita scan em decisões |
| `miip_configuracoes` | Dezenas | Cache em memória no runtime |

### Retenção recomendada (sprint futura)

- `miip_decisoes`: arquivar/purgar após N dias (`retencao.decisoes_dias` em `miip_configuracoes`)
- `miip_associacoes` / `miip_sinonimos`: soft-delete via `status`/`ativo`, sem purge automático
- `miip_estatisticas`: manter agregados mesmo após purge de decisões

---

## Estratégia para sincronização MIIP Cloud (futuro)

As tabelas MIIP são **totalmente independentes** do ERP. Nenhuma FK obrigatória para `produtos` ou `fornecedores` — apenas referências lógicas por ID/CNPJ.

```
┌─────────────────┐     push incremental      ┌──────────────────┐
│  CDS Local      │ ─────────────────────────► │  MIIP Cloud      │
│  miip_*         │     pull delta + merge     │  tenant sync     │
└─────────────────┘ ◄───────────────────────── └──────────────────┘
```

| Tabela | Direção sync | Chave natural | Conflito |
|--------|--------------|---------------|----------|
| `miip_associacoes` | Bidirecional | `fornecedor_cnpj` + `codigo_fornecedor` | Cloud vence se `fonte=cloud` e score maior |
| `miip_decisoes` | Push only (local → cloud) | `operacao_id` | Append-only, sem merge |
| `miip_sinonimos` | Bidirecional | `tipo` + `termo_normalizado` + escopo | `uso_count` somado |
| `miip_estatisticas` | Push agregados | `escopo` + `chave` + `periodo` | Recalculado no cloud |
| `miip_configuracoes` | Pull preferencial | `chave` | Cloud é fonte de thresholds globais |

**Colunas preparadas para Cloud:** `fonte`, `origem`, `metadados` (JSON com `cloud_id`, `synced_at`, `version`).

**Offline-first:** motores locais (GTIN, Associação Fornecedor) funcionam sem rede; sync assíncrono em background.

---

## Restrições desta sprint

- Nenhuma tabela ERP (`produtos`, `compras`, etc.) alterada.
- Nenhuma rota criada ou modificada.
- Nenhum repository implementado ou alterado.
- Nenhuma consulta SELECT/INSERT de negócio.
- Compras, XML e `ensureProductForItem()` intactos.
- Tabelas existem como estrutura validada para sprints subsequentes.

---

## Sugestões arquiteturais (para aprovação)

| # | Sugestão | Impacto | Quando |
|---|----------|---------|--------|
| 1 | **Manter schema atual** (versão profissional) em vez do schema simplificado do prompt | Evita quebra de motores/repos já implementados | ✅ Recomendado |
| 2 | Adicionar `fornecedor_id` opcional em `miip_associacoes` via `ALTER TABLE` | Link opcional ao ERP sem FK obrigatória | Sprint futura |
| 3 | Adicionar `confirmacoes INTEGER` em `miip_associacoes` | Contador explícito de confirmações do prompt | Sprint futura |
| 4 | Renomear alias `request_id` → documentar `operacao_id` como equivalente | Alinhamento semântico com prompt | Documentação ✅ |
| 5 | Remover FKs SQLite de `miip_decisoes` / `miip_associacoes` | 100% independente (prompt) | Avaliar — hoje são `ON DELETE SET NULL` |
| 6 | Job de purge `miip_decisoes` | Controlar 1M+ | Sprint operação |
| 7 | FTS5 em `nome_normalizado` / `termo_normalizado` | Similaridade em escala | Sprint similaridade |

---

## Checklist de aceite — Sprint 2

| Critério | Status |
|----------|--------|
| 5 tabelas MIIP criadas | ✅ |
| Índices de desempenho (CNPJ, cProd, produto, request/operacao, sinônimos) | ✅ 29 índices |
| Nenhuma tabela ERP alterada | ✅ |
| Nenhuma rota alterada (nesta sprint) | ✅ |
| Nenhum repository nesta sprint | ✅ (estrutura only) |
| Documentação atualizada | ✅ |
| Preparado para MIIP Cloud | ✅ |

**Aguardando aprovação formal** para prosseguir ou aplicar ajustes do schema simplificado (itens 2, 3, 5 acima).

---

## Melhorias sugeridas (antes da Sprint 3)

| # | Melhoria | Motivo |
|---|----------|--------|
| 1 | **Seed de `miip_configuracoes`** com defaults | Thresholds e motores ativos sem hardcode |
| 2 | **Job de purge** em `miip_decisoes` | Controlar crescimento além de 1M |
| 3 | **FTS5** em `nome_normalizado` / `termo_normalizado` | Busca textual em escala |
| 4 | **`MiipConfiguracoesRepository`** estendendo `IRepository` | Leitura/escrita tipada |
| 5 | **Coluna `request_id`** em `miip_decisoes` | Correlacionar com `MiipResult.requestId` (migration segura) |
| 6 | **Export parquet/JSON** de decisões antigas | Arquivo frio antes do purge |
