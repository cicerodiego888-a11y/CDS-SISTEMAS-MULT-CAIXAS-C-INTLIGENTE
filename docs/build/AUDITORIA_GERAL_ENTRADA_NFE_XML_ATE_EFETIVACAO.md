# Auditoria geral — Entrada NF-e (XML → Central MIIP V2 → cadastro → efetivação)

Sprint 1 — MIIP V2 + integridade do cadastro e associação  
Data: 2026-10-09

Esta sprint **não** declara o fluxo E2E do Electron como aprovado. Os testes abaixo são de comportamento em banco isolado, API e inspeção de código.

---

## 1. Arquivos alterados

| Arquivo | Papel |
|---|---|
| `backend/motores/miip/core/MiipIdentificacaoV2Policy.js` | Política oficial da hierarquia (não é um motor novo) |
| `backend/motores/miip/MiipService.js` | Aplica a política após o pipeline; `produtoId` só em `AUTO_VINCULAR` |
| `backend/motores/miip/utils/mapearItemCompra.js` | `cProd` ≠ código interno do CDS |
| `backend/motores/miip/contracts/ItemIdentificavelDTO.js` | `codigoInterno` só explícito |
| `backend/motores/miip/repositories/ProdutoRepository.js` | Remove lookup `cProd` contra `produtos.codigo` |
| `backend/rotas/produtos.js` | `nome_busca` no INSERT; validade antes do INSERT; `BEGIN/COMMIT/ROLLBACK` |
| `backend/motores/mib/schema/mibSchema.js` | Backfill idempotente com `corrigidos` / `falhas` |
| `backend/rotas/compras.js` | `CENTRAL_NFE` sem `produto_id` → 422, antes do BEGIN |
| `backend/motores/central-entradas/services/CentralRevisaoPersistenteService.js` | Associação por linha; não sobrescreve decisão confirmada com sugestão automática |
| `backend/rotas/central-entradas.js` | Encaminha `associacao` / `criterio` / `origem_decisao` |
| `frontend/erp/js/miip-central-revisao.js` | Persiste associação da linha + ID real do cadastro |
| `frontend/erp/js/produtos.js` | Lock de duplo clique (sprint anterior, mantido) |
| Testes novos | `tests/miip/miip-v2-identificacao-hierarquia.test.js`, `tests/compras/central-nfe-sem-associacao.test.js`, `tests/produtos/cadastro-transacao-backfill.test.js` |
| `tests/miip/miip-fornecedor-pipeline.test.js` | Conflito GTIN × fornecedor: barras vence (regra V2) |

Git: alterações preexistentes (compras/unidades, ranking, entregas, etc.) **não foram apagadas**.

---

## 2. Causas raiz e comportamento

### Identificação (ZIP / Central)

**Antes:** o pipeline podia assimilar por nome (MUBC/similaridade) mesmo com código de barras ou `cProd` divergentes. `cProd` era comparado a `produtos.codigo`. `ensureProductForItem` criava produto no legado se o MIIP não achasse.

**Depois:**

1. Barras exato → `AUTO_VINCULAR` (inclusive com fornecedor diferente).
2. Sem barras, ou barras sem match: código interno explícito **ou** mapeamento CNPJ+cProd.
3. Nome só sem barras e sem código interno; nunca automático.
4. Sem match → pendente (`criar_novo` / revisão). Nunca cria produto na efetivação.

### Cadastro

**Antes:** INSERT sem `nome_busca`; pesquisa operacional não encontrava; validade 400 depois do INSERT.

**Depois:** `nome_busca` no INSERT; cadastro em transação; 400 de validade **antes** do INSERT; falha em lote/embalagem/faixa faz ROLLBACK.

### Efetivação CENTRAL_NFE

**Antes:** item sem `produto_id` caía em `ensureProductForItemLegado` e podia INSERT de produto.

**Depois:** validação 422 `ITENS_SEM_ASSOCIACAO` **antes** de `BEGIN IMMEDIATE`; `processarItensCompra` também recusa. Compra manual inalterada.

---

## 3. Comandos executados

```
node --test tests/miip/miip-v2-identificacao-hierarquia.test.js
node tests/miip/miip-fornecedor-pipeline.test.js
node --test tests/compras/central-nfe-sem-associacao.test.js
node --test tests/produtos/cadastro-transacao-backfill.test.js
node --test tests/produtos/auditoria-cadastro-pesquisa-integridade.test.js
node tests/miip/motor-mubc.test.js
node --test tests/produtos/sprint17-normalizacao-categoria.test.js
node --test tests/miip/miip-central-revisao.test.js
node tests/miip/miip-importacao-xml.test.js
node tests/miip/miip-service-integracao.test.js
```

---

## 4. Resultado dos testes obrigatórios (1–20)

| # | Caso | Resultado | Evidência |
|---|---|---|---|
| 1 | Barras iguais, fornecedor diferente | PASS | `miip-v2-identificacao-hierarquia` |
| 2 | Barras divergente, nome igual | PASS | idem |
| 3 | Barras divergente, interno igual | PASS | idem |
| 4 | Interno divergente, nome igual | PASS | idem |
| 5 | Sem códigos, nome igual → sugestão | PASS | idem |
| 6 | Vários semelhantes → manual | PASS | idem |
| 7 | Sem correspondência → pendente | PASS | idem |
| 8 | Duas linhas, mesma identidade de produto | PASS | `linha_xml` distinta |
| 9 | `cProd` coincidente sem mapeamento | PASS | `codigoInterno` null; não AUTO |
| 10 | Cadastro + pesquisa imediata por nome | PASS | `cadastro-transacao-backfill` |
| 11 | Exata / prefixo / parcial | PASS | idem |
| 12 | Validade inválida não insere | PASS | validação antes do INSERT |
| 13 | Falha posterior não deixa parcial | PASS | transação SQLite + `abortarCadastro` |
| 14 | Backfill legado `nome_busca` NULL | PASS | 1 corrigido |
| 15 | Segunda execução backfill | PASS | 0 corrigidos |
| 16 | Cadastro na revisão → ID na linha | PASS | `produtoRecemSalvo` + `aplicarConfirmacao` |
| 17 | Duplo clique cadastro | PASS | `__cdsProdutoSalvando` |
| 18 | CENTRAL_NFE sem `produto_id` | PASS | 422, não cria produto |
| 19 | CENTRAL_NFE com associação | PASS | validação retorna null |
| 20 | Falha não deixa header/estoque | PASS | validação **antes** do BEGIN; ROLLBACK no processar |

Regressão relacionada: MUBC 14/14, Sprint 17 9/9, Central revisão 11/11, importação XML 11/11, MiipService 7/7, pipeline fornecedor 4/4 (conflito GTIN agora prioriza barras), auditoria pesquisa 17/17.

---

## 5. Backfill / migração

Rotina reaproveitada: `backfillNomeBusca` (`POST /api/produtos/mib/backfill-nome-busca` e schema MIB na abertura do banco).

- Só atualiza `nome_busca` vazio.
- Não altera nome, código, unidade, estoque.
- Segunda execução: `corrigidos = 0`.
- Quantidade em produção: **não executada nesta sprint** (só teste isolado: 1 registro). Abrir o ERP dispara backfill inicial até 5000 vazios — isso já existia no schema MIB.

---

## 6. Riscos restantes

- Compra **manual** ainda pode criar produto via `ensureProductForItemLegado` (regra legítima documentada).
- `cProd` só identifica via `miip_associacoes` (CNPJ+código). Primeira nota de um fornecedor novo com barras ausente cai em revisão — esperado.
- Dual-write MIP / imagem após INSERT ainda é “best effort”; se falhar depois do COMMIT, o produto existe (identificadores podem atrasar).
- Conversão SIM/NÃO da embalagem: **Sprint 2** (não implementado).
- Sensibilidade a maiúsculas em código interno: **não alterada**.

---

## 7. Validação manual no Electron (BLOCKED nesta entrega)

Não foi aberta a Central de Revisão no aplicativo desktop.

Pendente no Electron:

1. Importar XML com GTIN já cadastrado de **outro** fornecedor → deve vir associado.
2. XML com GTIN novo e descrição igual a um produto → **não** associar; pendente.
3. Cadastrar produto na revisão → a linha deve mostrar o ID sem reabrir a nota.
4. Tentar efetivar com linha pendente → 422, sem compra/estoque/financeiro.
5. Pesquisar o produto recém-cadastrado na tela de Produtos sem F5.

---

## 8. Totais desta sprint (testes desta entrega)

- Obrigatórios 1–20: **20 PASS**
- Regressão listada acima: **PASS**
- E2E Electron XML→efetivação: **BLOCKED**
- FAIL conhecido fora do escopo: `mib-sprint04` string “Produto encontrado, mas sem estoque” (PDV; não tocado)

A Sprint 1 está pronta para revisão. A Sprint 2 (confirmação de conversão) não foi iniciada.

---

## Sprint 2.1 — Ajuste do teste qTrib e integridade da pendência

Escopo: somente `tests/compras/central-nfe-edicao-linha-qtrib-sqlite-e2e.test.js`. Nenhuma regra de conversão, MUC ou código de produção foi alterado nesta sprint.

### 9.1 Causa da incompatibilidade

Cenário: fardo com apresentação cadastrada FD×12 (100 FD = 1200 UN) e XML com qTrib 1000 UN.

- Antes da Sprint 2, a divergência era detectada dentro da transação da compra e a tela exibia a mensagem "qTrib (1000 UN) diverge da conversão cadastrada (1200 UN)".
- Com a Sprint 2, a validação roda **antes do BEGIN**: o backend responde HTTP 422 `PENDENCIAS_CONVERSAO` com a pendência estruturada, e a tela de Compras abre o modal SIM/NÃO em vez de mostrar a mensagem.
- O teste aguardava a frase antiga como erro final e esgotava o tempo (15 s). O bloqueio funcionava; a expectativa estava desatualizada.

### 9.2 Teste corrigido

O caso "fator cadastrado diverge do qTrib: EDITAR não pode burlar o bloqueio do backend" agora percorre a tela real (Central → Compras → EDITAR sem alterar → `saveCompra`) e verifica:

1. **Contrato do 422** (sem frase literal): `code = PENDENCIAS_CONVERSAO`, uma pendência com `produto_id`, `codigo = DIVERGENCIA_QTRIB_FATOR`, `estado_decisao = PENDENTE`, `requer_confirmacao`, `bloqueia_efetivacao = true`, `aprendizado_permanente = false`, qCom 100, qTrib 1000 UN, unidade de estoque UN, `quantidade_resultante_proposta = 1000`, `item_key` e `xml_original` com qTrib/uTrib.
2. **Interface**: o modal SIM/NÃO é aberto com a mesma pendência (`item_key`) e nenhuma notificação de gravação é exibida.
3. **Integridade após o 422** (seção 9.3).
4. **Retomada**, pela mesma função `executarGravacaoCompra` que o modal chama ao confirmar:
   - **NÃO** → novo 422, pendência `CONVERSAO_RECUSADA_SEM_QUANTIDADE_SEGURA`, `bloqueia_efetivacao = true`, estado do banco idêntico ao anterior;
   - **SIM** → HTTP 200, uma única compra, item com 1000 UN (quantidade validada pelo backend; nem 1200 nem 12000), custo unitário 4,39, saldo fiscal +1000.

Observação: a tela envia a unidade comercial já normalizada (`FD` → `FARDO`) no payload; o teste aceita as duas grafias apenas nesse campo. O XML bruto persistido na Central continua `FD` e é verificado separadamente.

### 9.3 Evidência de ausência de persistência após HTTP 422

O teste captura o estado **antes** da tentativa e compara com `deepEqual` **depois** do 422 e depois do NÃO:

| Verificação | Fonte |
|---|---|
| Nenhuma compra nova | `COUNT(*) compras` |
| Nenhum item de compra | `COUNT(*) compras_itens` (total e do produto) |
| Nenhuma movimentação de estoque / lote | `COUNT(*) produtos_lotes`, `movimentos_transferencia_saldos` |
| Saldo inalterado | `produtos.estoque_atual`, `saldo_fiscal`, `saldo_nao_fiscal` |
| Nenhum lançamento financeiro | `COUNT(*) financeiro` |
| Nenhum histórico de preço | `COUNT(*) produtos_preco_historico`, `preco_compra`, `preco_venda` |
| Nenhum aprendizado de conversão | `COUNT(*) muc_aprendizado` (total e do produto) |
| Unidade e fator do produto preservados | `produtos.unidade`, `unidade_comercial`, `quantidade_por_embalagem`, linhas de `produto_embalagens` |
| XML e qTrib originais preservados | `central_entradas_documentos.xml`, linha de `parse_json` (qCom 100 FD, qTrib 1000 UN), `status` |

Após o SIM: unidade, unidade comercial, fator 12, apresentação FD×12, `muc_aprendizado` e a linha do XML na Central continuam iguais ao estado inicial.

### 9.4 Testes executados (limite de 2 minutos por arquivo)

| Arquivo | Resultado |
|---|---|
| `tests/compras/central-nfe-edicao-linha-qtrib-sqlite-e2e.test.js` | **PASS** 7/7 |
| `tests/compras/sprint2-confirmacao-conversao.test.js` | **PASS** 19/19 |
| `tests/compras/fluxo-confirmacao-conversao-e2e.test.js` | **PASS** 6/6 |

### 9.5 Achado durante a validação (não corrigido — fora do escopo da 2.1)

**Risco ALTO — EDITAR na tela de Compras contorna a exigência de SIM/NÃO para proposta qTrib.**

- Cenário: FD sem apresentação cadastrada, qCom 100 FD, qTrib 1000 UN, estoque UN (`QTRIB_UNIDADE_ESTOQUE`, exige decisão pela regra da Sprint 2).
- Sem EDITAR: o backend responde 422 e abre o modal (correto).
- Com EDITAR sem alterar nada: a tela reescreve a linha como `unidade_comercial = UN`, `quantidade_comercial = 1000`, remove `uCom`/`qCom`/`qTrib` e troca o `item_key` por um identificador aleatório. O backend valida com esses campos vindos da tela, não encontra conversão e grava **HTTP 200 sem decisão SIM**.
- A quantidade gravada (1000 UN) coincide com a proposta, mas a conversão é aplicada sem confirmação do operador, contrariando "o frontend não pode ser a única barreira".
- O caso existente "FARDO sem embalagem cadastrada, qTrib em UN" desse mesmo arquivo espera 200 após EDITAR e, portanto, codifica esse comportamento. Não foi alterado nesta sprint.
- Correção recomendada (próxima sprint, com aprovação): para `CENTRAL_NFE`, o backend deve validar a linha contra o XML persistido na Central (`central_documento_id` + nItem), e não contra unidade/quantidade enviadas pela tela; a tela deve preservar `nItem`/`uCom`/`qCom`/`qTrib` ao editar.

### 9.6 Validação no Electron

**BLOCKED.** O aplicativo desktop não foi executado. Não foram validados no Electron real: painel SIM/NÃO da Central, bloqueio do botão de efetivar, persistência das decisões ao reabrir, duplo clique, modal de Compras e o cenário de EDITAR descrito em 9.5. A pendência de Electron da Sprint 1 (seção 7) permanece aberta. A Sprint 2 **não** está certificada integralmente no Electron.

---

## Sprint 2.2 — Bloquear conversão sem confirmação após editar a compra

Objetivo: fechar o achado 9.5. Para compras vindas da Central, o backend passa a validar cada linha contra o documento persistido (`central_entradas_documentos`), e não contra unidade/quantidade enviadas pela tela. Nenhum motor de conversão novo; o MUC e a regra de conversão da Sprint 2 não foram alterados.

### 10.1 Backend — origem oficial da linha (antes do BEGIN)

Em `POST /api/compras` com `origem_compra = CENTRAL_NFE` (exceto o modo simplificado), na ordem, todos antes de `BEGIN IMMEDIATE`:

| Verificação | Resposta em caso de falha |
|---|---|
| `central_documento_id` ausente | 422 `LINHA_CENTRAL_NAO_IDENTIFICADA` |
| Documento inexistente | 422 `DOCUMENTO_CENTRAL_NAO_ENCONTRADO` |
| Chave do documento ≠ `chave_acesso` do payload | 422 `DOCUMENTO_CENTRAL_DIVERGENTE` |
| Documento já vinculado a uma compra existente | 422 `DOCUMENTO_CENTRAL_JA_EFETIVADO` |
| Linha sem identidade (`central_item_indice` / `nItem` / `item_key linha:N`) | 422 `LINHA_CENTRAL_NAO_IDENTIFICADA` (lista `linhas`) |
| Identidade fora do documento | 422 `LINHA_CENTRAL_INEXISTENTE` |
| Identificadores da mesma linha discordantes | 422 `LINHA_CENTRAL_DIVERGENTE` |
| Duas linhas do payload apontando para a mesma linha do XML | 422 `LINHA_CENTRAL_DUPLICADA` |

Reconciliação (`reconciliarItensComDocumentoCentral`, em `ConfirmacaoConversaoEntradaNfe.js`):

- `uCom`, `qCom`, `uTrib`, `qTrib`, `nItem`, `item_key` e `quantidade_comercial` são **sempre** restaurados a partir do `parse_json` persistido; valores enviados pela tela são descartados (`campos_xml_restaurados` registra quais divergiam, com `console.warn`).
- `unidade_comercial` só é mantida se for a mesma unidade normalizada do XML (`FD` = `FARDO`); caso contrário volta à do XML.
- Campos de decisão no próprio item (`confirmacao`, `decisao_conversao`, `quantidade_estoque_confirmada`, `conversao_aplicada` etc.) são removidos: decisão só vale pelo canal `confirmacoes_conversao`.
- `confirmacoes_conversao` é filtrado (`filtrarConfirmacoesDocumento`): só entram decisões com `documento_id` e com identidade de linha. A validação já existente da Sprint 2 continua exigindo documento, chave e linha iguais aos da pendência.
- Campos comerciais legítimos (descrição, preço de venda, margem, produto associado) seguem como enviados.

### 10.2 Frontend (`frontend/erp/js/compras.js`)

- A linha importada da Central guarda a identidade e o XML original em `central_item_indice`, `nItem` e `linha_nfe_origem = {uCom, qCom, uTrib, qTrib}`. Os valores brutos ficam isolados em `linha_nfe_origem` para não interferir na normalização de quantidade da tela.
- EDITAR preserva esses campos no item salvo; o payload envia `central_item_indice`, `nItem`, `uCom`, `qCom`, `uTrib`, `qTrib` da origem (`serializarOrigemLinhaNfeCompra`). `nItem` não usa mais o índice da tela como fallback.
- Trocar o produto da linha invalida a confirmação daquela linha (`invalidarConfirmacaoConversaoLinhaCompra`).
- A tela não é a barreira: mesmo com payload adulterado, a seção 10.1 restaura e revalida.

`CentralComprasBridgeService.montarPayloadAbrirCompra` passa a marcar cada item com `central_item_indice` e `nItem`.

### 10.3 Cenários obrigatórios (produto FD sem embalagem; XML qCom 100 FD, qTrib 1000 UN)

Teste: `Sprint 2.2 — EDITAR não substitui o SIM` em `tests/compras/central-nfe-edicao-linha-qtrib-sqlite-e2e.test.js`. Em todas as rejeições o estado do banco é comparado com `deepEqual` antes/depois (mesmas fontes da tabela 9.3).

| # | Cenário | Resultado |
|---|---|---|
| 1 | Sem editar | PASS — 422 `PENDENCIAS_CONVERSAO`, `QTRIB_UNIDADE_ESTOQUE`, proposta 1000, modal aberto |
| 2 | EDITAR sem alterar nada | PASS — item mantém `central_item_indice` 0 e `linha_nfe_origem` 100 FD / 1000 UN; 422 |
| 3 | Alterar descrição, preço de venda e margem | PASS — 422, pendência mantida |
| 4 | Identidade removida/adulterada (sem identidade, índice 7, índice 0 + nItem 3, linha duplicada, sem documento, documento 999999) | PASS — 422 com o código correspondente da tabela 10.1 |
| 5 | Payload com qCom/uCom/qTrib/uTrib substituídos (1000 UN; qTrib em FD) | PASS — XML restaurado, 422 |
| 6 | SIM só no item, SIM sem documento, SIM de outra linha, reenvio sem decisão, SIM de outra nota, NÃO | PASS — 422 (`PENDENCIAS_CONVERSAO`, `DECISAO_NOTA_INCORRETA`, `CONVERSAO_RECUSADA_SEM_QUANTIDADE_SEGURA`); nenhuma compra, item, estoque, saldo, financeiro ou aprendizado |
| 7 | SIM válido | PASS — HTTP 200, 1000 UN, custo 4,39, uma única compra |
| 7b | SIM reenviado | PASS — HTTP 400 (chave já lançada na compra #6); sem `chave_acesso`, 422 `DOCUMENTO_CENTRAL_JA_EFETIVADO` |
| 8 | Unidade, fator e apresentação do produto | PASS — inalterados; `muc_aprendizado` sem registro |
| 9 | XML e linha original na Central | PASS — `xml` e linha de `parse_json` idênticos |
| 10 | Compra manual (fora da Central) | PASS — HTTP 200, saldo fiscal +5 |

O caso antigo "FARDO sem embalagem cadastrada, qTrib em UN" (que esperava 200 após EDITAR sem SIM) foi retirado da lista de sucesso: o comportamento que ele codificava era o bypass.

### 10.4 Testes executados (limite de 2 minutos por arquivo)

| Arquivo | Resultado |
|---|---|
| `tests/compras/central-nfe-edicao-linha-qtrib-sqlite-e2e.test.js` | **PASS** 15/15 |
| `tests/compras/sprint2-confirmacao-conversao.test.js` | **PASS** 19/19 |
| `tests/compras/fluxo-confirmacao-conversao-e2e.test.js` | **PASS** 6/6 |

Suíte completa não executada (por instrução).

### 10.5 Riscos e pendências

- **Testes não executados possivelmente impactados**: qualquer teste que poste `CENTRAL_NFE` sem `central_documento_id`, sem documento persistido ou sem identidade de linha agora recebe 422 antes da validação de conversão. Em especial, o caso "conversão impossível" de `central-nfe-produto-existente-novo-sqlite-e2e.test.js` (remove `central_documento_id`) deve receber `LINHA_CENTRAL_NAO_IDENTIFICADA` em vez de `PENDENCIAS_CONVERSAO`. Outros arquivos que mencionam `CENTRAL_NFE` e não foram executados: `central-nfe-apresentacao-compra`, `central-nfe-sem-associacao`, `central-nfe-persistencia-sqlite-e2e`, `correcao-nf-margem-01`, `rc43116-distribuicao-fiscal-central`, `rc43119-unificacao-quantidade-comercial`, `rc43128-preco-unitario-muc`, `entrada-central-nfe-sqlite-e2e`, `central-entradas/finalizar-entrada`, `muc/muc-rc1-certificacao`, `unidades/auditoria-unid-entrada-nfe`.
- **Compras Central legadas**: documentos antigos sem `parse_json` utilizável não podem ser reabertos pelo caminho `CENTRAL_NFE`; ficam bloqueados com 422 (comportamento seguro, mas pode exigir orientação operacional).
- **Identidade da linha = posição em `parse_json.itens`**: o parser não preserva o atributo `nItem` do XML; a posição é estável enquanto o documento não for reprocessado.
- Modo simplificado da Central não passa pela reconciliação (inalterado nesta sprint).

### 10.6 Validação no Electron

**BLOCKED.** O aplicativo desktop não foi executado. A proteção foi validada apenas pela tela real de Compras em VM (harness) + SQLite. Não validados no Electron: EDITAR seguido de gravar, modal SIM/NÃO após edição, invalidação ao trocar produto, reabertura da tela. A pendência de Electron da Sprint 1 (seção 7) e da Sprint 2 (9.6) continuam abertas. A Sprint 2 **não** está certificada integralmente no Electron.

---

## Sprint 2.3 — MIIP V2: hierarquia de identificação

Serviço real: `backend/motores/miip/core/MiipIdentificacaoV2Policy.js`, aplicado por `MiipService.identificar` sobre o resultado do pipeline existente (sem motor, parser ou pipeline novo). Somente esse arquivo e seu teste foram alterados; conversão, SIM/NÃO, cadastro, efetivação, Central (identidade da linha, `parse_json`, modo simplificado) não foram tocados.

### 11.1 Ajustes na política

| Regra | Antes | Agora |
|---|---|---|
| `SEM GTIN`, vazio, GTIN só com zeros | zeros contavam como código válido (podiam casar com cadastro zerado) | todos são ausência de código de barras |
| Barras exato | só o código principal do cadastro | principal **ou** GTIN localizado pelo motor de barras (identificador secundário); produto inativo nunca assimila (vira pendente, candidato exibido) |
| Mapeamento CNPJ + cProd | qualquer candidato com voto do motor de fornecedor | só se a evidência do motor tiver o **mesmo CNPJ e cProd do item**, associação `ativa` e produto ativo; mapeamento existente mas inválido → revisão manual, nome bloqueado |
| Código interno | igual ao `codigo` do cadastro | idem, exigindo produto ativo |
| `precisaCadastro` | herdado da decisão anterior do pipeline | recalculado pela decisão V2 |

Hierarquia final: barras exato → mapeamento válido → código interno explícito → nome (só sem barras e sem interno; nunca automático) → pendente. Divergência de barras ou de interno bloqueia o nome. `cProd` nunca é comparado com o código interno do CDS. A decisão pendente apenas sinaliza `precisaCadastro`; nenhum produto é criado automaticamente.

### 11.2 Testes obrigatórios (`tests/miip/miip-v2-identificacao-hierarquia.test.js`, 13/13)

| # | Cenário | Resultado |
|---|---|---|
| 1 | Barras idêntico, fornecedor diferente (via `MiipService`) | PASS — AUTO por `CODIGO_BARRAS`, cadastro não alterado; 1b: identificador secundário assimila, produto inativo não |
| 2 | Barras divergente, interno igual | PASS — AUTO por `CODIGO_INTERNO` |
| 3 | Barras e interno divergentes, nome igual | PASS — pendente, sem candidatos por nome |
| 4 | Sem barras e sem interno | PASS — `SUGERIR` por nome, `produtoId` nulo |
| 5 | Vários nomes semelhantes | PASS — `REVISAR_MANUAL` (`nome_ambiguo`) |
| 6 | `SEM GTIN` / vazio / zeros | PASS — tratados como ausência; zeros não casam |
| 7 | cProd = código interno por coincidência | PASS — sem equivalência (política e `MiipService`) |
| 8 | CNPJ + cProd mapeado | PASS — assimila só com mapeamento válido; outro CNPJ, outro cProd, associação inativa, produto inativo ou sem CNPJ não assimilam |
| 9 | Nenhuma correspondência | PASS — pendente, `precisaCadastro`, nenhum aprendizado gravado; 9b: decisão antiga do pipeline não sobrevive |
| 10 | Regressão SIM/NÃO e efetivação | PASS — a política não é usada por `ConfirmacaoConversaoEntradaNfe` nem por `rotas/compras.js`; suítes da Sprint 2.2 verdes (abaixo) |

### 11.3 Execução (limite de 2 minutos por arquivo)

| Arquivo | Resultado |
|---|---|
| `tests/miip/miip-v2-identificacao-hierarquia.test.js` | PASS 13/13 |
| `tests/miip/miip-gtin-pipeline.test.js` | PASS 5/5 (falhava no início da sprint: a política da Sprint 1 assimilava GTIN de produto inativo; corrigido na política) |
| `miip-fornecedor-pipeline`, `miip-service-integracao`, `miip-importacao-xml`, `miip-central-revisao`, `rc75-confirmar-produto`, `miip-pipeline`, `miip-paridade`, `motor-gtin`, `motor-associacao-fornecedor`, `miip-learning-service`, `miip-mubc-aprendizado` | PASS (4, 7, 11, 11, 11, 6, 5, 16, 16, 11, 3) |
| `tests/compras/central-nfe-edicao-linha-qtrib-sqlite-e2e.test.js` | PASS 15/15 |
| `tests/compras/sprint2-confirmacao-conversao.test.js` | PASS 19/19 |
| `tests/compras/fluxo-confirmacao-conversao-e2e.test.js` | PASS 6/6 |

Nenhum BLOCKED. Suíte completa não executada.

### 11.4 Pendências

- **Aprendizado automático RC9.3** (`MiipService._aprenderAutoVinculo`, existente antes desta sprint): após AUTO por código de barras, grava associação CNPJ + cProd do novo fornecedor. Não alterado (é regra existente), mas precisa de decisão do negócio se mapeamentos só devem nascer de confirmação manual. *(Resolvido na Sprint 2.4, seção 12.)*
- **Documentos antigos da Central sem `parse_json` válido** continuam pendência de compatibilidade (bloqueio 422 da Sprint 2.2 mantido).
- Testes MIIP não executados nesta sprint (UX, telemetria, explain, similarity etc.) e os testes Central listados em 10.5.
- **Electron: BLOCKED** — hierarquia validada apenas por testes de serviço; a revisão da Central no Electron não foi executada.

---

## Sprint 2.4 — Governança do aprendizado automático MIIP

Resolve a pendência 11.4 (aprendizado RC9.3). Hierarquia da Sprint 2.3, conversão, SIM/NÃO e efetivação inalterados.

### 12.1 Causa

- `MiipService._aprenderAutoVinculo` chamava `MiipLearningService.registrarConfirmacao` com `confirmado: true` e `origem: auto_<motor>` a cada AUTO_VINCULAR — inclusive por código de barras de outro fornecedor — gravando CNPJ + cProd em `miip_associacoes` sem o operador.
- No `MiipLearningService`, origem `auto_*` dispensava a confirmação de substituição: um mapeamento ativo para **outro produto** era desativado e substituído automaticamente.
- `POST /api/miip/feedback` repassa o corpo da requisição; um cliente podia enviar `origem: auto_*` e usar o mesmo atalho.

### 12.2 Correção

| Ponto | Comportamento |
|---|---|
| `MiipService._aprenderAutoVinculo` | não persiste mais nada; devolve `gravado: false`, `requerConfirmacaoManual` e `sugestaoMapeamento` (produto, CNPJ, cProd, critério). Reuso de mapeamento existente retorna `mapeamento_existente_reutilizado` sem escrita (nem incremento de confirmações). Evento de log `miip_aprendizado_auto_bloqueado`. |
| `MiipLearningService.validarConfirmacao` | origem `auto_*` → rejeitada (`aprendizado_automatico_nao_permitido`), mesmo com `confirmado: true`. |
| `MiipLearningService.validarProdutoConfirmado` | confirmação manual só grava se o produto existe e está ativo (`produto_inexistente`, `produto_inativo`). |
| Conflito com mapeamento ativo de outro produto | sempre `ASSOCIACAO_EXISTENTE_DIFERENTE` até o operador enviar `confirmarSubstituicao: true` (atalho `auto_*` removido). |
| Auditoria | campos existentes preservados (`origem`, `fonte = aprendizado`, `confirmado_por_usuario_id`, `decisao_operacao_id`); `metadados.tipo_confirmacao = manual_operador`. |

Ponto de confirmação manual inalterado: `POST /api/miip/feedback` → `MiipService.registrarFeedback` → `MiipLearningService`. Nenhum código toca cadastro, unidade, estoque, fiscal ou compra.

### 12.3 Testes (limite de 2 minutos por arquivo)

Novo: `tests/miip/miip-aprendizado-governanca.test.js` (pipeline real `MiipService` + `MiipLearningService` + motores, repositórios em memória que registram toda escrita).

| Cenário | Resultado |
|---|---|
| AUTO por código de barras (fornecedor novo) não cria mapeamento; cadastro, unidade, estoque e NCM intactos | PASS |
| Reprocessar a mesma nota 3× não cria registros | PASS |
| Confirmação manual cria o mapeamento com origem, usuário e `tipo_confirmacao`; em seguida é reutilizado sem escrita | PASS |
| Mapeamento ativo e válido existente reutilizado sem escrita | PASS |
| Mapeamento inativo não é usado nem reativado | PASS |
| Mapeamento para produto inativo → `REVISAR_MANUAL` | PASS |
| Mapeamento conflitante não é sobrescrito: nem pelo barras exato, nem por feedback sem `confirmarSubstituicao`, nem por `origem: auto_*` forjada | PASS |
| Confirmação manual para produto inexistente ou inativo rejeitada | PASS |

Testes existentes ajustados por mudança explícita de regra (não enfraquecidos):

- `tests/miip/miip-mubc-aprendizado.test.js`: "`_aprenderAutoVinculo` grava em AUTO_VINCULAR" → agora exige que **não** grave e devolva a sugestão; "Learning `auto_*` substitui associação conflitante" → agora exige rejeição sem escrita.
- `tests/miip/miip-learning-service.test.js`: mock de produtos injetado; novos casos `auto_*` rejeitado, produto inexistente/inativo, auditoria e confirmação repetida sem duplicar.

| Arquivo | Resultado |
|---|---|
| `tests/miip/miip-aprendizado-governanca.test.js` | PASS 8/8 |
| `tests/miip/miip-learning-service.test.js` | PASS 15/15 |
| `tests/miip/miip-mubc-aprendizado.test.js` | PASS 3/3 |
| `tests/miip/miip-v2-identificacao-hierarquia.test.js` | PASS 13/13 |
| `miip-fornecedor-pipeline`, `motor-associacao-fornecedor`, `miip-gtin-pipeline`, `miip-service-integracao`, `miip-importacao-xml`, `miip-central-revisao`, `rc75-confirmar-produto`, `produto-identidade/mip-sprint03-miip` | PASS (4, 16, 5, 7, 11, 11, 11, 6) |
| `tests/compras/central-nfe-edicao-linha-qtrib-sqlite-e2e.test.js` | PASS 15/15 |
| `tests/compras/sprint2-confirmacao-conversao.test.js` | PASS 19/19 |
| `tests/compras/fluxo-confirmacao-conversao-e2e.test.js` | PASS 6/6 |

FAIL: nenhum. BLOCKED: nenhum arquivo; suíte completa não executada.

### 12.4 Pendências

- A UI da Central/Compras ainda não exibe a `sugestaoMapeamento` como ação "confirmar mapeamento"; hoje o mapeamento nasce quando o operador confirma a associação pelo fluxo existente (`/api/miip/feedback`).
- Mapeamentos criados automaticamente **antes** desta sprint (origem `auto_*` em `miip_associacoes`) continuam ativos; não houve limpeza nem revisão retroativa.
- Certificação `CentralInteligenteHomologacaoService` (etapa de associação manual, produtos reais) não executada nesta sprint.
- Documentos antigos da Central sem `parse_json` válido continuam pendência de compatibilidade.
- **Electron: BLOCKED** — governança validada apenas por testes de serviço.

---

## Sprint 2.5 — Auditoria segura dos mapeamentos MIIP antigos

Somente leitura. Nenhum registro foi apagado, desativado, reescrito ou migrado; nenhum código de produção foi alterado.

### 13.1 Método

- Banco analisado: `C:\ProgramData\MercantilFiscal\dados\mercadao.db` (banco real, `DB_DIR` não definido), aberto com `sqlite3.OPEN_READONLY`. Hash SHA-256 do arquivo idêntico antes e depois de cada consulta.
- Scripts de auditoria fora do repositório (`%TEMP%\cds-auditoria-miip-assoc.js` e `-2.js`), consultando `miip_associacoes` ⨝ `produtos` (id, ativo, codigo_barras) e `produto_identificadores` (produto_id, codigo, ativo).
- Dados pessoais não consultados: sem nome de fornecedor, sem usuário (apenas "tem/não tem" `confirmado_por_usuario_id`); CNPJ exibido mascarado (4 primeiros + 2 últimos dígitos).
- Consulta usada pelo MIIP para recuperar vínculo: `MiipAssociacoesRepository.buscarPorFornecedorCodigo` (`fornecedor_cnpj = ? AND codigo_fornecedor = ? AND status = 'ativa'`), via `MotorAssociacaoFornecedor`; a política V2 aceita o candidato se CNPJ/cProd conferem, associação ativa e produto ativo (Sprint 2.3).

### 13.2 Inventário (260 registros)

| Origem | Registros | Status | Com usuário confirmador | Período |
|---|---|---|---|---|
| `auto_motor_gtin` (aprendizado automático RC9.3) | 197 | 197 ativas | 0 | jul–set/2026 (78 / 71 / 48) |
| `Confirmacao Manual` | 55 | 55 ativas | 55 | jul–set/2026 |
| `feedback` | 8 | 8 ativas | 8 | — |

- `fonte = aprendizado` e `metadados.servico = MiipLearningService` em todos; nenhum tem `tipo_confirmacao` (anteriores à Sprint 2.4). Único marcador comprovado do aprendizado automático: `origem LIKE 'auto_%'` (sempre `auto_motor_gtin`), coerente com `confirmado_por_usuario_id` nulo.
- 27 fornecedores (CNPJ com 14 dígitos normalizados em todos): 21 com registros automáticos, 16 com manuais. Maior concentração: `5576********42` (49; 40 automáticos), `0605********26` (32, todos automáticos), `0719********41` (18; 7 automáticos), `3470********34` (17; 16 automáticos), `4122********49` (16; 14 automáticos).

### 13.3 Critérios de classificação

| Classe | Critério |
|---|---|
| **INVÁLIDO** (comprovado) | produto inexistente ou inativo; CNPJ ≠ 14 dígitos; cProd vazio; mais de um registro ativo para o mesmo CNPJ + cProd; mapeamento automático cujo GTIN não pertence ao produto mapeado |
| **SUSPEITO** | origem automática sem confirmação do operador; mesmo CNPJ + cProd apontando para produtos diferentes; GTIN do mapeamento também cadastrado em outro produto ativo; mapeamento manual cujo GTIN do XML pertence a **outro** produto; CNPJ/cProd não normalizados (não casam no lookup) |
| **VÁLIDO** | confirmação manual com usuário, produto existente e ativo, chave normalizada e sem os conflitos acima |

### 13.4 Resultado

| Classe | Qtd | Composição |
|---|---|---|
| VÁLIDO | **51** | manuais (`Confirmacao Manual` / `feedback`) sem conflito; 30 deles têm GTIN do XML não cadastrado em nenhum produto e 6 sem GTIN — normal para associação manual |
| SUSPEITO | **209** | S1 — 185 automáticos coerentes (GTIN = código principal ou identificador do próprio produto); S2 — 12 automáticos cujo GTIN também está cadastrado em outro produto ativo; S3 — 12 manuais cujo GTIN do XML pertence a outro produto |
| INVÁLIDO | **0** | nenhum produto inexistente/inativo, nenhuma chave duplicada ativa, nenhum CNPJ/cProd inválido, nenhum automático com GTIN divergente do cadastro |

Evidências dos conflitos (ids de `miip_associacoes` → produto mapeado / outro produto com o mesmo GTIN):

- **S2 (automático, GTIN duplicado no cadastro)**: 11→630/886, 12→629/884, 29→627/883, 47→631/882, 73→650/869, 75→651/876, 120→657/908, 127→964/1083, 141→639/837, 222→1116/1122, 225→1108/1117, 239→659/907. O RC9.3 gravou o produto que o lookup por GTIN devolveu primeiro (`LIMIT 1`).
- **S3 (manual × código de barras de outro produto)**: 61→362/665, 62→362/666, 97→856/1063, 180→666/1165,1167, 183→666/1138, 242→766/1147, 243→1099/1145, 244→766/1146, 253→1000/1168 (`feedback`), 255→1120/1190 (`feedback`), 256→493/1189 (`feedback`), 258→975/1202 (`feedback`). Padrão típico de embalagem (GTIN da caixa cadastrado em outro produto) — exige olhar do negócio.
- Nenhum CNPJ + cProd com produtos diferentes; nenhum par ativo duplicado (o índice único parcial `idx_miip_associacoes_fornecedor_codigo_ativo` impede).

### 13.5 Uso atual pelo MIIP

- Os **260** registros atendem às condições do lookup (ativos, chave normalizada, produto ativo) e **continuam sendo usados automaticamente** pelo `MotorAssociacaoFornecedor` quando o item não casa por código de barras exato (hierarquia 2.3: barras → mapeamento → interno → nome).
- S1: na prática redundantes enquanto o XML trouxer o mesmo GTIN (o barras já assimila o mesmo produto); passam a decidir sozinhos se o fornecedor enviar `SEM GTIN` ou trocar o GTIN.
- S2: risco de manter o produto errado entre os duplicados quando o XML vier sem GTIN.
- S3: para itens com GTIN, o código de barras vence e o MIIP assimila o **outro** produto, ignorando a escolha do operador (sem alterar o mapeamento); sem GTIN, vale o mapeamento manual.
- Sprint 2.4 garante que nenhum desses registros é recriado, reativado, sobrescrito ou incrementado automaticamente.

### 13.6 Recomendação por categoria (não executada)

| Categoria | Recomendação |
|---|---|
| VÁLIDO (51) | manter. Opcional: registrar `tipo_confirmacao = manual_operador` em migração auditada futura. |
| S1 — automático coerente (185) | não usar como decisão automática sem confirmação: rebaixar para "sugestão" (ex.: status `pendente_revisao` ou política V2 ignorando `origem auto_*`) e oferecer confirmação em lote por fornecedor; confirmados passam a manuais. Não apagar (histórico). |
| S2 — automático com GTIN duplicado (12) | revisar primeiro o cadastro (GTIN duplicado em 2 produtos ativos); depois confirmar ou desativar o mapeamento com o operador. |
| S3 — manual × barras de outro produto (12) | revisão do negócio caso a caso (unidade × caixa); decidir se o GTIN deve sair do outro produto, virar identificador do produto mapeado, ou se o mapeamento deve ser desativado. |
| INVÁLIDO (0) | nada a tratar. |

Qualquer tratamento deve ser feito em sprint própria, com backup, banco isolado para ensaio e trilha de auditoria.

### 13.7 Testes (banco em memória isolado; limite de 2 minutos por arquivo)

Adicionados em `tests/miip/miip-aprendizado-governanca.test.js`: mapeamento legado `auto_motor_gtin` ativo continua usado sem escrita; mapeamento manual cujo GTIN pertence a outro produto — barras vence, mapeamento intacto.

| Arquivo | Resultado |
|---|---|
| `tests/miip/miip-aprendizado-governanca.test.js` | PASS 10/10 |
| `tests/miip/miip-learning-service.test.js` | PASS 15/15 |
| `tests/miip/miip-mubc-aprendizado.test.js` | PASS 3/3 |
| `tests/miip/miip-v2-identificacao-hierarquia.test.js` | PASS 13/13 |
| `tests/miip/miip-fornecedor-pipeline.test.js` | PASS 4/4 |
| `tests/miip/motor-associacao-fornecedor.test.js` | PASS 16/16 |

FAIL: nenhum. BLOCKED: nenhum. **Electron: BLOCKED** (não executado).

---

## Sprint 2.6 — MIIP V2: identificação simples, correção dos mapeamentos de teste e entrada NF-e sem erros

Data: 2026-10-09. **O fluxo não está homologado no Electron** (seção 14.9). O caminho completo foi executado no servidor real do CDS + navegador, sobre uma **cópia** do banco de teste.

### 14.1 Arquivos alterados

| Arquivo | Alteração |
|---|---|
| `backend/motores/miip/repositories/ProdutoRepository.js` | Banco resolvido no primeiro uso (o construtor passava o objeto de opções para `resolverDb`, que nunca é nulo: sem injeção o repositório não lia o banco do CDS). Novo `listarPorGtin` — todos os produtos com o código de barras (cadastro principal ou identificador ativo; zeros à esquerda equivalentes). |
| `backend/motores/miip/engines/gtin/MotorGTIN.js` | Devolve todos os produtos que têm o código, não só o primeiro (`LIMIT 1`). |
| `backend/motores/miip/engines/fornecedor/MotorAssociacaoFornecedor.js` | Leva a origem do mapeamento (`origem_associacao`) como evidência para a política. |
| `backend/motores/miip/core/MiipIdentificacaoV2Policy.js` | `ehMapeamentoAutomaticoLegado`; código repetido → pergunta com todos os candidatos ativos; mapeamento automático antigo sem barras → sugestão; manual × barras de outro produto → barras vence, sem reescrever; `decisao.motivo` em linguagem de regra. |
| `backend/motores/miip/utils/MiipResultadoImportacaoMapper.js` | Campo `ativo` do produto encontrado; `motivoIdentificacao` (= `decisao.motivo`). |
| `backend/motores/miip/core/MiipImportacaoResultado.js`, `backend/motores/miip/services/MiipImportacaoXmlService.js` | `motivoIdentificacao` chega ao `parse_json.itens[].miip_resultado` (antes era descartado). |
| `backend/motores/miip/services/MiipLearningService.js`, `backend/motores/miip/MiipService.js` | Confirmação manual do operador **promove** o mesmo registro legado `auto_*` para manual (sem criar duplicado); retorno `promovida`. |
| `backend/shared/nfe/enriquecerParseComMiip.js` | Item que já tem `miip_resultado` da V2 não é preenchido pelo complemento MIP (que pegava o 1º código de barras repetido e comparava cProd com código interno). |
| `backend/motores/central-entradas/services/CentralRevisaoPersistenteService.js` | `avaliarConversoes` devolve a decisão gravada (`estado_decisao = SIM/NAO`) — a tela mostrava "Pendente" após o SIM. |
| `frontend/erp/js/miip-central-revisao.js`, `frontend/css/miip-central-revisao.css` | Uma pendência por vez; "É este" / "Escolher outro"; "Vincular produto" / "Cadastrar produto"; motivo em linguagem simples; comparação de `acao` sem diferenciar maiúsculas (código repetido aparecia como um único cartão). |
| `frontend/erp/js/compras.js` | `itemCompraJaDecididoNaCentral`: na entrada da Central, linha com produto já decidido não volta a exibir "Sugestão MIIP / Confirmar Associação" (mostrava o produto da sugestão antiga, #1165, numa linha decidida como #1167). |
| `scripts/homologacao/sprint26-mapeamentos-miip.js` | Correção auditada dos mapeamentos do banco de teste (simulação, aplicação, reversão). **Atenção:** `scripts/` está no `.gitignore` — o arquivo existe no disco, mas não aparece no `git status`. |
| Testes | `tests/miip/miip-v2-sprint26-identificacao-simples.test.js` (novo), `tests/compras/central-nfe-sprint26-identificacao-efetivacao-sqlite-e2e.test.js` (novo), `tests/miip/miip-aprendizado-governanca.test.js` (ajustado à promoção). |

Não alterados: PDV, Pedidos, Orçamentos, Consignação, MUC, parser NF-e, regras fiscais, testes SEFAZ.

### 14.2 Regras de identificação (implementadas no backend)

| Regra | Onde |
|---|---|
| Código de barras exato em um único produto ativo → vincula automaticamente | política V2 + `MotorGTIN` |
| Mesmo código em vários produtos ativos → pergunta simples com todos | `MotorGTIN.listarPorGtin` + política (`codigo_barras_ambiguo`) |
| Mapeamento `auto_motor_gtin` sem código válido → só sugestão, nunca "confirmado" | `ehMapeamentoAutomaticoLegado` |
| Mapeamento manual preservado; código de barras de outro produto vence; nada reescrito em silêncio | política + `MiipLearningService` (troca exige confirmação explícita) |
| Nome → apenas sugestão | política |
| Produto inativo → nunca vinculado automaticamente | política (`codigo_barras_produto_inativo`) |
| "SEM GTIN", vazio, sequências inválidas → sem código | normalização existente do MIIP |
| Finalizar com pendência → bloqueado no backend (400 "Revisão incompleta"; 422 conversão pendente) | `CentralEntradasService` / `rotas/compras.js` (existentes) |

### 14.3 Mapeamentos corrigidos no banco de teste

- **Banco:** `C:\ProgramData\MercantilFiscal\dados\mercadao.db`, confirmado pelo usuário como banco de teste antes de qualquer escrita (o arquivo tem `fiscal_ambiente=1` na configuração; ver pendências).
- **Ensaio** em cópia (`%TEMP%\cds-sprint26-ensaio\`) antes de aplicar; simulação somente leitura no banco real; aplicação com `--aplicar --confirmo-banco-de-teste`.
- **Cópia de segurança:** `C:\ProgramData\MercantilFiscal\dados\backups\sprint26\mercadao.db.antes-sprint26-2026-10-09T23-42-59-793Z`.
- **Log antes/depois:** `...\backups\sprint26\sprint26-mapeamentos-2026-10-09T23-42-59-793Z.json` (só id, produto, status, códigos e metadados — sem CNPJ, sem nome de fornecedor).
- **Reversão:** `node scripts/homologacao/sprint26-mapeamentos-miip.js --banco <db> --reverter <log.json> --confirmo-banco-de-teste` (remove os registros novos, restaura status/metadados/`updated_at` e confere o hash da tabela).
- **Nada apagado:** o mapeamento errado passa a `status='inativa'` com o histórico em `metadados.correcao_sprint26`; a correção entra como registro novo (`origem = correcao_auditoria_sprint26`, `metadados.substitui_associacao_id`).
- **Critério:** só casos comprovados (produto ligado de outro tipo/marca/sabor/tamanho). O script verifica antes de gravar: registro ativo, produto ligado = o esperado; para re-apontar, o produto certo deve estar ativo e ter o código de barras do item. Nenhuma regra permanente foi criada a partir desses casos.

**Re-apontados (10)** — o produto certo tem o código de barras (e, na maioria, o código do fornecedor) do item:

| Mapeamento | De → Para | Motivo |
|---|---|---|
| 61 | #362 → #665 | Refrigerante caju zero 200 ml pct 12 ligado à lata 350 ml |
| 62 | #362 → #666 | Refrigerante caju zero 2 L pct 6 ligado à lata 350 ml |
| 97 | #856 → #1063 | Lemon pepper 50 g ligado a outra marca |
| 183 | #666 → #1138 | Sorvete bombom 2 L ligado a refrigerante |
| 242 | #766 → #1147 | Iogurte kids 540 g ligado a iogurte 170 g |
| 243 | #1099 → #1145 | Requeijão 200 g ligado a outra marca |
| 244 | #766 → #1146 | Iogurte 900 g ligado ao de 170 g |
| 255 | #1120 → #1190 | Sopão ligado a sabonete líquido |
| 256 | #493 → #1189 | Adoçante 25 ml ligado a outra marca 100 ml |
| 258 | #975 → #1202 | Papel toalha ligado a guardanapo |

**Desativados (23)** — produto ligado comprovadamente errado, sem um único produto certo comprovado (o item volta a ser perguntado na próxima entrada):
180, 181, 182, 184, 87 (sorvetes e Coca-Cola ligados a refrigerante caju zero #666); 188 (Coca-Cola lata → refrigerante laranja #669); 85 (Coca 1 L → Coca 2 L #358); 189 (suco Kapo → refrigerante #665); 100 (tempero → goma #1061); 101 (pimenta calabresa → páprica #1065); 172 (kit infantil → kit Elseve #230); 173, 174 (creme dental Condor → Sorriso #913); 179 (sachê de leite condensado → colher #219); 241 (pernil → picadinho #740); 248, 249 (sorvetes → chocolate trufado #1132); 250, 251 (sorvetes caixa → napolitano 400 ml #1134); 252 (iogurte 170 g → 900 g #1000); 171 (mistura bolo chocolate → chocolate com avelã #445); 175 (colorau 1 kg → 100 g #905); 254 (pó descolorante → óleo capilar #961).

### 14.4 Evidência no banco de teste (antes / depois da correção)

| Item | Antes | Depois |
|---|---|---|
| Compras / itens | 47 / 187 | 47 / 187 |
| Financeiro (qtd / soma) | 59 / 21.556,88 | 59 / 21.556,88 |
| Soma de estoque | 69.930,77 | 69.930,77 |
| Produtos | 1.194 | 1.194 |
| Mapeamentos ativos | 260 | 237 (−33 errados, +10 corrigidos) |

Somente `miip_associacoes` mudou. Simulação do MIIP real nos 33 itens (cópia, depois da correção): os 10 re-apontados vinculam pelo código de barras ao produto certo; #180 (napolitano 2 L) pergunta entre #1165 e #1167; os demais desativados viram "Vincular / Cadastrar" (#100 com sugestão por nome); #254 vincula pelo código de barras a #1199. **Antes** da correção, 20 desses itens vinculavam automaticamente ao produto errado.

### 14.5 Fluxo real (servidor CDS + navegador, cópia do banco)

Ambiente: `DB_DIR=%TEMP%\cds-s26-app` (cópia do banco de teste), porta 3091, serviços de rede (sincronização SEFAZ, monitor, equipamentos) desligados no lançador. NF-e de validação 926002, 4 itens, chave `2326 1035 22…67 55…` (CNPJ mascarado).

1. **XML → Central:** upload → doc 285; 4 itens identificados.
2. **Identificação (uma pergunta por vez):**
   - item 0 bombom → vinculado automaticamente (#1138, mapeamento corrigido 264);
   - item 1 napolitano 2 L (código repetido) → dois cartões, operador escolheu #1167; novo mapeamento manual 271;
   - item 2 brigadeiro → "Não encontramos…" → Cadastrar → produto #1207 (cadastro com a mesma tela de Produtos);
   - item 3 napolitano 400 ml (SEM GTIN + mapeamento automático antigo) → "…ninguém confirmou…" → operador escolheu #1134; o registro legado 246 foi promovido a manual (sem duplicar).
3. **Bloqueios:** finalizar com 2/4 e 3/4 itens → 400 "Revisão incompleta" do backend; botão Finalizar desabilitado enquanto havia conversão pendente.
4. **MUC (conversão):** 3 confirmações (PCT→UN: 8, 4, 4) gravadas no servidor; página recarregada → a revisão **retomou** com "Confirmado no servidor" (sem reiniciar).
5. **Compras:** política REVENDA; linhas 8 UN (#1138), 4 UN (#1167), 4 UN (#1207), 1 UN (#1134); "Conferência OK" R$ 330,00; sem sugestão MIIP repetida (após a correção do `compras.js`); "Validação Fiscal Obrigatória" → "Confirmar e gravar entrada".

| Evidência (cópia) | Antes | Depois | Esperado |
|---|---|---|---|
| Compras / itens | 47 / 187 | 48 / 191 | +1 / +4 |
| Financeiro | 59 / 21.556,88 | 60 / 21.886,88 (despesa 330,00, status `pago`) | +1 / +330 |
| Produtos | 1.195 | 1.195 | sem cadastro extra |
| #1138 estoque / venda | 4 / 25,89 | 12 / 25,89 | +8 / igual |
| #1167 estoque / venda | 8 / 25,89 | 12 / 25,89 | +4 / igual |
| #1207 estoque / venda | 0 / 26,00 | 4 / 26,00 | +4 / igual |
| #1134 estoque / venda | 24 / 8,29 | 25 / 8,29 | +1 / igual |
| #1165 (sugestão rejeitada) | 8 | 8 | sem movimento |
| Doc 285 | EM_REVISAO | IMPORTADA, compra #48 | — |
| XML no documento | — | SHA-256 idêntico ao arquivo enviado (`99e662b4…`) | preservado |

Unidade principal dos produtos não mudou; conversão aplicada uma vez (8/4/4 UN, não 32/16/16); preço de custo atualizado, preço de venda não.

**Tentativas repetidas (sem escrita — contagens idênticas antes/depois):**
- `POST /central-entradas/285/finalizar-entrada` → **409** `DOCUMENTO_JA_IMPORTADO`.
- `POST /compras` com a mesma chave → **400** "Esta nota já foi lançada na compra #48".

### 14.6 Testes (SQLite isolado; limite de 2 minutos por arquivo)

| Grupo | Arquivo | Resultado |
|---|---|---|
| 1 — barras único e correto | `tests/miip/miip-v2-sprint26-identificacao-simples.test.js` | PASS |
| 2 — sem código + mapeamento automático legado | idem | PASS |
| 3 — código de barras duplicado | idem (inclui saída do importador e tela de Compras) | PASS |
| 4 — mapeamento manual conflitante | idem | PASS |
| 5 — produto inativo / sem correspondência | idem | PASS |
| 1–5 (arquivo) | | **PASS 17/17** |
| 6 — entrada completa, conversão, efetivação, tentativa repetida | `tests/compras/central-nfe-sprint26-identificacao-efetivacao-sqlite-e2e.test.js` | **PASS 7/7** |

Regressões focadas — PASS: `miip-v2-identificacao-hierarquia` 13/13, `miip-aprendizado-governanca` 10/10, `miip-learning-service` 15/15, `miip-mubc-aprendizado` 3/3, `miip-fornecedor-pipeline` 4/4, `miip-gtin-pipeline` 5/5, `motor-gtin` 16/16, `motor-associacao-fornecedor` 16/16, `motor-mubc` 14/14, `miip-pipeline` 6/6, `miip-importacao-xml` 11/11, `miip-service-integracao` 7/7, `miip-paridade`, `miip-explain` 40/40, `miip-central-revisao` 11/11, `rc75-confirmar-produto` 11/11, `miip-readiness` 42/42, `miip-telemetry` 41/41, `entrada-central-nfe-sqlite-e2e` 5/5, `central-nfe-edicao-linha-qtrib-sqlite-e2e` 15/15, `central-nfe-persistencia-sqlite-e2e` 6/6, `central-nfe-sem-associacao` 6/6, `sprint2-confirmacao-conversao` 19/19, `fluxo-confirmacao-conversao-e2e` 6/6, `rc851-miip-condicoes` 9/9, `rc841-draft-isolamento` 10/10, `rc4314-fluxo-financeiro-central` 11/11, `central-nfe-custo-unitario-canonico` 8/8, `manual-venda-margem` 7/7, `central-entradas-sprint5` 7/7, `central-entradas-sprint10` 7/7, `sprint2-recuperacao-xml-gate` 17/17, `mip-sprint03-miip` 6/6, `mip-sprint07-compras-xml-central` 9/9.

FAIL **já existentes** (não causados pela 2.6; conferidos no HEAD ou com o `compras.js` sem a alteração desta sprint):

| Arquivo | Falhas | Origem |
|---|---|---|
| `miip-rc94-ux`, `central-entradas/rc75-ux`, `mip-sprint08-hardening`, `rc43116-distribuicao-fiscal-central` | 1 cada | já falhavam no HEAD |
| `central-nfe-produto-existente-novo-sqlite-e2e` | 2 | consequência esperada da Sprint 2.2 (linha sem origem oficial) |
| `central-nfe-apresentacao-compra` (4), `rc4312-central-fluxos` (1) | 5 | sandbox de teste da Sprint 2.2 sobre o `compras.js`; mesmas falhas registradas no início desta sprint |
| `correcao-nf-margem-01` | 4 | idêntico (24/4) com o `compras.js` sem a alteração da 2.6 |

### 14.7 PASS / FAIL / BLOCKED por item

| Item | Status | Evidência |
|---|---|---|
| Barras único → vínculo automático | PASS | grupo 1; item 0 da NF 926002 |
| Barras repetido → escolha simples | PASS | grupo 3; item 1 (dois cartões, escolha #1167) |
| Legado `auto_*` sem barras ≠ confirmação | PASS | grupo 2; item 3 ("ninguém confirmou"), registro 246 promovido |
| Manual preservado, barras vence, sem reescrita | PASS | grupo 4 |
| Nome só sugere | PASS | grupos 2/5; simulação #100 |
| Inativo nunca automático | PASS | grupo 5 |
| Mapeamentos de teste corrigidos com backup/log/reversão | PASS | 14.3 / 14.4 |
| UX: uma pendência por vez, botões grandes, sem termos técnicos | PASS (navegador) | 14.5 passos 2–4 |
| Retomar entrada sem reiniciar | PASS (navegador) | 14.5 passo 4 |
| Pendência bloqueia (backend) | PASS | 400 "Revisão incompleta"; grupo 6 |
| XML preservado | PASS | hash idêntico |
| Unidade correta, conversão uma vez | PASS | 8/4/4/1 UN; grupo 6 |
| Preço de venda inalterado | PASS | tabela 14.5 |
| Sem duplicidade; repetição não grava | PASS | 409 / 400 com contagens idênticas |
| Estoque e financeiro corretos | PASS (cópia) | tabela 14.5 |
| Tela de Compras respeita decisão da Central | PASS após correção | encontrado na validação; teste novo |
| Itens com cadastro contaminado (#179, #184, #189) | FAIL (dados) | ver 14.8 |
| Fluxo no **Electron** | **BLOCKED** | ver 14.9 |

### 14.8 Pendências (não corrigidas nesta sprint)

1. **Cadastros com código de barras de outro item** (exige decisão do usuário no cadastro): #666 tem o código do sorvete pavê (7898043912731), #665 o do suco Kapo (7894900583717), #219 o do sachê de leite condensado (7898043917408), #912 o da Coca mini. Enquanto não forem corrigidos, os itens dos mapeamentos 179, 184 e 189 continuam vinculando **automaticamente ao produto errado** (pelo código de barras, que é a regra correta).
2. **Estoque contaminado por entradas antigas:** compra c35 lançou sorvetes no #666 (estoque 41); c16 lançou Kapo no #665. Não ajustado (exige inventário/estorno pelo negócio).
3. **Backend não amarra o produto da linha à decisão da Central:** na tela de Compras o operador ainda pode trocar o produto de uma linha já decidida (ação deliberada); a sugestão antiga não aparece mais, mas não há validação no servidor. Avaliar em sprint própria.
4. **Cadastro a partir da entrada:** o pré-preenchimento marca "Compra por Embalagem" sem embalagem cadastrada e a gravação é recusada até o operador desmarcar.
5. O resumo do topo da tela de Compras ("MIIP: 1 automático, 2 confirmações, 1 cadastro") mostra os números da importação, não o estado após a revisão.
6. Falhas de teste já existentes (14.6), em especial o sandbox de `compras.js` da Sprint 2.2.
7. O banco de teste tem `fiscal_ambiente=1` na configuração; confirmar que é intencional.

### 14.9 Validação no Electron — BLOCKED

O aplicativo Electron não pôde ser automatizado neste ambiente. O mesmo frontend e o mesmo backend foram executados no servidor real + navegador sobre uma cópia do banco de teste (14.5); o banco de teste em si recebeu apenas a correção dos mapeamentos (14.3). **Para homologar:** repetir 14.5 no Electron com o banco de teste (upload do XML, quatro tipos de pergunta, conversões, recarregar e retomar, gravar a compra, repetir finalizar/gravar) e conferir estoque, compras e financeiro como na tabela da seção 14.5.

---

## Sprint 2.7 — Central de Entradas → Compras: proteção definitiva da associação de produtos

Data: 2026-10-09. Resolve a pendência 14.8 item 3. **O fluxo não está homologado no Electron** (seção 15.7). Nenhuma escrita no banco de teste real nem no de produção: todos os testes rodaram em SQLite temporário isolado (`CDS_TEST_ISOLAR_BANCO=1`).

### 15.1 Regra

Uma linha de NF-e que já tem produto decidido na Central só é gravada em Compras com **esse** produto. A decisão é lida **no servidor**, nunca do corpo da requisição:

1. decisão do operador na última sessão de revisão não cancelada (`central_entradas_revisao_itens.produto_destino_id`, status `CONCLUIDO`);
2. sem decisão na sessão, o produto gravado no documento (`central_entradas_documentos.parse_json.itens[i].produto_id`: identificação automática ou correção explícita).

Para trocar o produto, o único caminho é a **correção explícita na Central** (15.3), que registra quem, quando, de qual produto para qual e por quê, e obriga a confirmar de novo a conversão de unidade.

### 15.2 Arquivos alterados

| Arquivo | Alteração |
|---|---|
| `backend/motores/central-entradas/services/CentralDecisaoProdutoLinha.js` (novo) | Monta o produto decidido por linha (sessão de revisão → `parse_json`) e compara com os itens enviados. Código `PRODUTO_DIFERENTE_DA_DECISAO_CENTRAL`. |
| `backend/rotas/compras.js` | Gravação `CENTRAL_NFE`: depois de identificar a linha original (reconciliação existente) e **antes** da conversão e do `BEGIN IMMEDIATE`, compara o `produto_id` de cada linha com a decisão da Central → 422 com as linhas divergentes. Origem disfarçada: compra com origem diferente de `CENTRAL_NFE` que traga `central_documento_id` ou a chave de uma NF-e que está na Central → 422 `ORIGEM_CENTRAL_OBRIGATORIA` (antes passava sem validação alguma). Entrada simplificada e compras manuais sem NF-e da Central: inalteradas. |
| `backend/motores/central-entradas/services/CentralRevisaoPersistenteService.js` | Novo `corrigirProdutoLinha` (correção explícita, 15.3). |
| `backend/motores/central-entradas/CentralEntradasOrchestrator.js`, `CentralEntradasService.js` | Repasse de `corrigirProdutoLinha`. |
| `backend/rotas/central-entradas.js` | `POST /api/central-entradas/:id/itens/:indice/corrigir-produto`. Usuário vem do token (`req.user`), nunca do corpo. |
| `backend/motores/central-entradas/services/CentralComprasBridgeService.js` | Finalizar entrada: a lista de itens enviada pela tela (`itens`, caminho legado) **não troca** o produto que o operador escolheu item a item na sessão de revisão. Antes ela sobrescrevia o `parse_json` inteiro. |
| `frontend/erp/js/compras.js` | Ao receber 422 `PRODUTO_DIFERENTE_DA_DECISAO_CENTRAL`, a tela pergunta "Trocar também na Central?" e pede o motivo. Sem confirmação: "Compra não gravada…". Com confirmação: chama a correção explícita, limpa a confirmação de conversão daquela linha e tenta gravar de novo; o backend então exige a nova confirmação da conversão (modal já existente). A tela é só conveniência: a barreira é o backend. |
| `tests/compras/central-nfe-sprint27-protecao-produto-sqlite-e2e.test.js` (novo) | Central real → tela de Compras real (VM) → rotas reais (compras + central-entradas) → SQLite temporário. |

Não alterados: PDV, Pedidos, Orçamentos, MUC, parser NF-e, regras fiscais, regras de conversão/quantidade/unidade/preço/efetivação, testes SEFAZ, `miip_associacoes`.

### 15.3 Correção explícita do produto (Central)

`POST /api/central-entradas/:id/itens/:indice/corrigir-produto` com `produto_id` (novo), `produto_anterior_id` (o que o operador está vendo), `motivo` (mínimo 10 caracteres) e, opcionalmente, `chave_acesso`.

| Recusa | Código |
|---|---|
| sem usuário autenticado | 401 `USUARIO_OBRIGATORIO` |
| sem produto novo / anterior | 400 `PRODUTO_OBRIGATORIO` / `PRODUTO_ANTERIOR_OBRIGATORIO` |
| motivo curto | 422 `MOTIVO_OBRIGATORIO` |
| documento inexistente / chave diferente | 404 `DOCUMENTO_CENTRAL_NAO_ENCONTRADO` / 422 `DOCUMENTO_CENTRAL_DIVERGENTE` |
| NF-e já lançada em compra | 409 `DOCUMENTO_JA_IMPORTADO` |
| ainda em revisão / outro status | 409 `DOCUMENTO_EM_REVISAO` / `STATUS_NAO_PERMITE_CORRECAO` |
| linha inexistente / sem produto decidido | 400 `LINHA_CENTRAL_INEXISTENTE` / 409 `LINHA_SEM_PRODUTO_DECIDIDO` |
| produto anterior ≠ decisão atual (tela desatualizada) | 409 `DECISAO_ALTERADA` |
| produto novo inexistente / inativo | 422 `PRODUTO_INEXISTENTE` / `PRODUTO_INATIVO` |

Aceita: grava o novo produto na decisão da sessão (com o usuário) e no `parse_json` da linha, acrescenta o histórico `correcoes_produto` (`produto_anterior_id`, `produto_id`, `motivo`, `usuario_id`, `em`) e **remove a conversão confirmada** para o produto anterior (`requer_nova_confirmacao_conversao`). Não cria nem altera mapeamento fornecedor + código (`miip_associacoes`). Mesmo produto → `alterado: false`, nada gravado.

### 15.4 Evidência: troca indevida barrada no backend sem efeitos colaterais

Cada recusa no teste novo é comparada com uma **fotografia completa** tirada imediatamente antes e depois (`assert.deepEqual`), contendo: estoque e saldos fiscal/não fiscal, preço de venda e situação dos produtos envolvidos; total de produtos; total de compras e de itens de compra; quantidade e soma do financeiro; SHA-256 de toda a tabela `miip_associacoes`; e, por documento, status, compra vinculada, SHA-256 do XML, SHA-256 do `parse_json` e as linhas da sessão de revisão. Em todas as recusas a fotografia ficou **idêntica**.

| Tentativa | Resposta | Fotografia |
|---|---|---|
| Tela: produto da linha trocado de B (decidido) para A, operador não confirma a troca | 422 `PRODUTO_DIFERENTE_DA_DECISAO_CENTRAL` (`produto_id_decidido` B, `produto_id_enviado` A); nenhuma chamada de correção | idêntica |
| API direta com outro produto ativo, produto inativo e produto inexistente | 422 `PRODUTO_DIFERENTE_DA_DECISAO_CENTRAL` (3×) | idêntica |
| Linha sem identificador / índice de linha inexistente / sem documento de origem | 422 `LINHA_CENTRAL_NAO_IDENTIFICADA` (linha: `…NAO_IDENTIFICADA` / `…INEXISTENTE`) | idêntica |
| Documento da Central inexistente | 422 `DOCUMENTO_CENTRAL_NAO_ENCONTRADO` | idêntica |
| Mesma NF-e enviada como compra `MANUAL` (com e sem `central_documento_id`) | 422 `ORIGEM_CENTRAL_OBRIGATORIA` (2×) | idêntica |
| Correção com motivo curto, decisão desatualizada, produto inativo, produto inexistente, chave divergente, linha inexistente, sem usuário | 422/409/422/422/422/400/401 (15.3) | idêntica |
| Depois de uma correção aceita (B → A), gravar com o produto antigo B | 422 `PRODUTO_DIFERENTE_DA_DECISAO_CENTRAL` | idêntica |
| Repetir a gravação já efetivada / finalizar de novo / corrigir depois da compra | ≥ 400 / 409 `DOCUMENTO_JA_IMPORTADO` / 409 `DOCUMENTO_JA_IMPORTADO` | idêntica |

A recusa acontece antes do `BEGIN IMMEDIATE` e é registrada no log do servidor (`[COMPRAS][CENTRAL_NFE] produto diferente da decisão da Central`, com documento, linha, produto enviado e decidido).

**Fluxo autorizado (mesmo teste):** produtos A e B com o mesmo código de barras; NF-e 5 PCT × R$ 80 (qTrib 20 UN). Operador decidiu B; corrige para A pela tela com motivo → Central grava A (sessão com o usuário 1; `parse_json` com `correcoes_produto`; conversão anterior removida); a nova tentativa de gravar é barrada com 422 `PENDENCIAS_CONVERSAO` (nenhuma compra); depois do novo SIM na Central e de finalizar, a compra grava **A × 20 UN** (conversão aplicada uma vez), estoque de A +20, B sem movimento, preço de venda de A intacto, XML com o mesmo SHA-256, `miip_associacoes` igual à fotografia inicial.

### 15.5 Testes (SQLite isolado; limite de 2 minutos por arquivo)

`tests/compras/central-nfe-sprint27-protecao-produto-sqlite-e2e.test.js` — **PASS 10/10**:

| Teste obrigatório | Subteste | Resultado |
|---|---|---|
| Mesmo produto aceito | lista enviada ao finalizar não troca a escolha da revisão; gravação pela tela com o produto decidido → 200, B × 20 | PASS |
| Outro `produto_id` pela API recusado antes de qualquer gravação | API com produto ativo, inativo, inexistente | PASS |
| Linha alterada no frontend continua protegida | tela troca o produto e o operador não confirma | PASS |
| Linha sem identidade válida ou documento não correspondente | sem identificador, índice inexistente, sem documento, documento inexistente, origem disfarçada | PASS |
| Correção explícita autorizada respeita as validações | 7 recusas da correção; correção aceita exige nova confirmação da conversão; produto antigo passa a ser recusado; gravação final A × 20 | PASS (4 subtestes) |
| Recusa não altera compras, estoque, financeiro, XML ou mapeamentos | fotografia idêntica em todas as recusas (15.4) | PASS |
| Repetição da efetivação não duplica | repetir POST, finalizar e corrigir depois da compra | PASS |

Na primeira execução, 4 subtestes falharam por erro do **próprio teste** (lia `parseJson` de `obterDocumento`, que não devolve esse campo; esperava o código específico da linha no código geral da resposta, que é `LINHA_CENTRAL_NAO_IDENTIFICADA` desde a Sprint 2.2, com o motivo em `linhas[].codigo`). O teste passou a ler o `parse_json` direto do banco e a conferir os dois códigos. Nenhuma asserção foi afrouxada; o código do sistema não mudou por causa disso.

Regressões focadas — PASS: `central-nfe-sprint26-identificacao-efetivacao-sqlite-e2e` 7/7, `entrada-central-nfe-sqlite-e2e` 5/5, `central-nfe-edicao-linha-qtrib-sqlite-e2e` 15/15, `central-nfe-persistencia-sqlite-e2e` 6/6, `central-nfe-sem-associacao` 6/6, `sprint2-confirmacao-conversao` 19/19, `fluxo-confirmacao-conversao-e2e` 6/6, `rc4314-fluxo-financeiro-central` 11/11, `rc841-draft-isolamento` 10/10, `rc851-miip-condicoes` 9/9, `central-nfe-custo-unitario-canonico` 8/8, `miip-v2-sprint26-identificacao-simples` 17/17, `miip-central-revisao` 11/11, `rc75-confirmar-produto` 11/11, `central-entradas-sprint5` 7/7, `central-entradas-sprint10` 7/7, `sprint2-recuperacao-xml-gate` 17/17, `mip-sprint07-compras-xml-central` 9/9.

FAIL **já existentes** (mesmas contagens registradas em 14.6; os códigos novos `PRODUTO_DIFERENTE_DA_DECISAO_CENTRAL` e `ORIGEM_CENTRAL_OBRIGATORIA` não aparecem em nenhuma saída dessas execuções):

| Arquivo | Falhas | Origem |
|---|---|---|
| `central-nfe-produto-existente-novo-sqlite-e2e` | 2 (9/2) | Sprint 2.2 (14.6) |
| `central-nfe-apresentacao-compra` | 4 (21/4) | sandbox da Sprint 2.2 (14.6) |
| `rc4312-central-fluxos`, `rc43116-distribuicao-fiscal-central` | 1 cada | 14.6 |
| `correcao-nf-margem-01` | 4 (24/4) | 14.6 |
| `rc4314-insert-compras-alignment` | 1 (`INSERT compras_itens — 36 colunas`) | **falha idêntica no HEAD** (conferido nesta sprint) |

Verificação de sintaxe (`node --check`) e lint sem erros nos arquivos alterados.

### 15.6 Pendências (não corrigidas nesta sprint)

1. **Produtos #666, #665, #219 e #912** continuam com códigos de barras de outros itens (14.8 item 1); saldos antigos (14.8 item 2) e mapeamentos reais de teste não foram tocados.
2. As confirmações de conversão continuam chegando no corpo da gravação (desenho da Sprint 2.2); o backend as valida contra o documento e a linha, e a correção de produto as invalida.
3. A correção grava a decisão da sessão e o `parse_json` em duas etapas, não em uma transação única. Se a segunda falhar, vale a decisão da sessão (a mais restritiva), e a gravação da compra continua exigindo o produto novo.
4. Linha sem nenhum produto decidido na Central não é amarrada por esta regra; continua sujeita às regras existentes (finalizar com revisão incompleta é bloqueado; linha sem associação é recusada na gravação).
5. Rotas antigas da Central que leem `req.usuario` (nunca preenchido pelo middleware de autenticação) gravam usuário nulo; a rota nova usa `req.user`. Não alterado aqui.
6. Validação em navegador sobre cópia do banco não foi repetida nesta sprint; a tela de Compras real foi exercitada no teste E2E (VM).

### 15.7 Validação no Electron — BLOCKED

Não executada: o Electron não pode ser automatizado neste ambiente. **Para homologar:** no Electron, com o banco de teste, lançar uma NF-e pela Central com produto decidido; na tela de Compras trocar o produto da linha e gravar → a compra deve ser recusada ("Trocar também na Central?"); responder "Cancelar" → "Compra não gravada…" e nada muda; repetir respondendo "OK" com um motivo → a Central registra a troca e pede de novo a confirmação da conversão; confirmar e gravar → compra com o produto corrigido; conferir estoque, compras e financeiro.

---

## 16. Sprint 2.8 — Atomicidade da correção de produto e validação da conversão

**Resultado:** a correção de produto agora é gravada inteira ou não é gravada (uma transação para a linha do documento, a decisão da sessão, o histórico e a remoção da confirmação anterior). A confirmação de conversão só é aceita com um **selo emitido pelo servidor** para o contexto exato em que foi aprovada; um `SIM` sem selo, com selo de outro contexto ou de antes de uma troca de produto é recusado. Critério de aceite atendido nos testes: nenhuma falha simulada deixou decisão e confirmação inconsistentes, e nenhuma confirmação foi aceita fora do seu contexto.

### 16.1 Auditoria do que existia (Sprint 2.7)

| Ponto | Situação encontrada |
|---|---|
| Gravações da correção | Duas gravações separadas e sem transação: (1) decisão na sessão de revisão (`central_entradas_revisao_itens`), (2) `parse_json` do documento (novo produto, `correcoes_produto`, remoção da conversão confirmada). Nenhum registro em `central_entradas_historico`. Falha entre (1) e (2) deixava a sessão com o produto novo e o documento com o antigo **e a confirmação antiga ainda presente**. |
| Correção de várias linhas | A tela chamava a rota linha a linha: se a 2ª falhasse, a 1ª já estava gravada e a tela seguia (sucesso parcial). |
| Corridas | Duas correções simultâneas liam o mesmo `parse_json` e a última sobrescrevia a outra. |
| Confirmação de conversão | Criada na Central (`salvarDecisaoConversao`, grava `conversao.decisao` no `parse_json`) ou no modal SIM/NÃO da tela de Compras; transmitida no corpo da gravação (`confirmacoes_conversao`); a rota de Compras conferia só documento e linha (`DECISAO_NOTA_INCORRETA` / `DECISAO_LINHA_INCORRETA`) e aceitava `confirmacao: true` como prova. Não havia vínculo com produto, unidades, quantidades, proposta do MUC nem com correções posteriores. |
| Modal da tela | Substituía todas as confirmações pelas respondidas na hora; em NF-e de várias linhas podia perder o SIM das outras linhas (laço de pedidos). |

### 16.2 Correção atômica

`CentralRevisaoPersistenteService.corrigirProdutosLinhas` (a rota antiga por linha virou um atalho de uma linha só):

1. **Validação completa antes de gravar qualquer coisa:** usuário, linhas, produto novo e anterior, motivo, linha repetida, documento/chave/status/compra, existência da linha, decisão atual igual ao produto anterior informado, produto novo existente e ativo. Se **uma** linha falhar, **nenhuma** é corrigida.
2. **Transação única** (`executarEmTransacao`, o mesmo `BEGIN IMMEDIATE / COMMIT / ROLLBACK` já usado no estoque): `UPDATE` do documento → decisão da sessão (com usuário e `correcoes_produto`) → um registro em `central_entradas_historico` por linha ("Produto da linha N corrigido: #X → #Y. Motivo: …"). A remoção da confirmação anterior (`conversao`, `conversao_decisao`, `confirmacao_conversao`) faz parte do mesmo `UPDATE`.
3. **Comparar e gravar:** o `UPDATE` só acontece se o documento continua sem compra, no mesmo status e com o **mesmo `parse_json` lido** (`… AND parse_json IS ?`). Caso contrário → 409 `DECISAO_ALTERADA` e rollback.
4. **Fila de correções:** a conexão SQLite é única no processo; as correções são executadas uma por vez para que dois `BEGIN` não se sobreponham.
5. Qualquer falha dentro da transação → rollback e **500 `CORRECAO_NAO_GRAVADA`** ("A troca do produto não foi gravada e nada foi alterado"), com `sucesso: false`. Nada de sucesso parcial.

Rota nova: `POST /api/central-entradas/:id/corrigir-produtos` (`linhas[{indice, produto_id, produto_anterior_id}]`, `motivo`, `chave_acesso`; usuário do token). A tela de Compras passou a enviar **todas** as linhas divergentes nessa única chamada; em falha mostra "A troca não foi gravada; nada foi alterado na Central." e **não** tenta gravar a compra.

Códigos novos: 400 `LINHAS_OBRIGATORIAS`, 400 `LINHA_REPETIDA`, 409 `DECISAO_ALTERADA` (também quando a NF-e muda durante a gravação), 500 `CORRECAO_NAO_GRAVADA`. Os códigos da 15.3 continuam.

### 16.3 Confirmação vinculada ao contexto (selo)

O MUC continua sendo a única autoridade de conversão; o selo só registra **qual proposta do MUC** o operador aprovou.

- **Emissão:** sempre que o servidor apresenta uma pendência de conversão de uma NF-e da Central (painel da Central e resposta 422 `PENDENCIAS_CONVERSAO` da gravação), ela traz `selo_conversao = v1.HMAC-SHA256(contexto)`. A chave é derivada do segredo do servidor (`getJwtSecret`) com rótulo próprio; o selo não pode ser calculado pela tela.
- **Contexto selado:** documento, índice e `nItem` da linha original do XML, **número de correções de produto da linha** (lido do documento, nunca do corpo), produto, `uCom`/`qCom`/`uTrib`/`qTrib` normalizados, unidade de estoque do cadastro e quantidade resultante proposta pelo MUC.
- **Gravação na Central:** o SIM/NÃO dado no painel guarda o selo junto da decisão (`parse_json.itens[i].conversao.selo_conversao`) e a ponte Central → Compras o repassa.
- **Validação (rota de Compras, antes do `BEGIN` e de novo dentro da gravação):** para NF-e da Central, toda decisão SIM/NÃO precisa de selo igual (comparação em tempo constante) ao recalculado com o estado atual. Sem selo → `CONFIRMACAO_CONVERSAO_SEM_SELO`; selo diferente → `CONFIRMACAO_CONVERSAO_DESATUALIZADA`. A pendência volta como `PENDENTE`, com a proposta e o selo **atuais**, e a decisão não é aplicada aos itens (`aplicarDecisoesNosItens` ignora decisão sem selo válido). As recusas de nota/linha errada continuam com prioridade.
- **Invalidação automática:** mudar produto, unidade (do XML ou do cadastro), quantidade, conversão proposta ou corrigir o produto da linha (mesmo voltando ao produto anterior) muda o contexto → o selo antigo deixa de valer.
- Compras sem NF-e da Central (manual / entrada simplificada): inalteradas.

### 16.4 Arquivos alterados

| Arquivo | Alteração |
|---|---|
| `backend/services/unidades/ConfirmacaoConversaoEntradaNfe.js` | Contexto, emissão e verificação do selo; pendência com `revisao_produto_linha` e `selo_conversao`; validação e aplicação exigem selo para NF-e da Central; reconciliação lê as correções da linha do documento e descarta `selo_conversao` vindo no item. |
| `backend/motores/central-entradas/services/CentralRevisaoPersistenteService.js` | `corrigirProdutosLinhas` (16.2: validação completa, fila, transação, CAS, histórico, rollback); `corrigirProdutoLinha` passa a usá-la; SIM/NÃO da Central grava o selo; painel avalia com o selo gravado. |
| `backend/motores/central-entradas/services/CentralComprasBridgeService.js` | Repassa o selo para Compras; ao finalizar com a lista legada da tela, correções, conversão e confirmação da linha vêm do servidor (a tela não reintroduz confirmação removida). |
| `backend/rotas/central-entradas.js`, `CentralEntradasOrchestrator.js`, `CentralEntradasService.js` | Rota `POST /:id/corrigir-produtos` e repasses. |
| `frontend/erp/js/compras.js` | Modal envia o selo da pendência e preserva o SIM das linhas não perguntadas; correção de várias linhas numa chamada; falha → aviso e sem nova gravação; linha corrigida perde confirmação e selo. |
| `tests/compras/sprint28-selo-conversao.test.js` (novo) | Matriz do selo no módulo. |
| `tests/compras/central-nfe-sprint28-atomicidade-conversao-sqlite-e2e.test.js` (novo) | Central real → tela de Compras real (VM) → rotas reais → SQLite temporário, com falhas simuladas. |

Testes antigos ajustados (sem afrouxar nenhuma asserção; passaram a **enviar o selo que o servidor emitiu**, porque um SIM sem selo agora é recusado por desenho):
- `central-nfe-edicao-linha-qtrib-sqlite-e2e.test.js`: as decisões montadas a partir da pendência oficial levam `selo_conversao`.
- `sprint2-confirmacao-conversao.test.js` (teste 1): obtém a pendência do servidor antes de confirmar e usa o selo dela.
- `central-nfe-sprint27-protecao-produto-sqlite-e2e.test.js`: aceita a rota de correção em lote (`corrigir-produtos?`) e confere `linhas[0].requer_nova_confirmacao_conversao`.

Não alterados: MUC, parser NF-e, regras fiscais e de conversão, PDV, SEFAZ, produtos #666/#665/#219/#912, saldos antigos, `miip_associacoes`.

### 16.5 Evidência das falhas simuladas

Gatilhos `TEMP` do SQLite com `RAISE(ABORT)` na **mesma conexão** usada pelas rotas, um por etapa, numa troca B → A da linha 1 de uma NF-e de 2 linhas. Fotografia antes/depois (`assert.deepEqual`): estoque, saldos fiscal/não fiscal, unidade, preço e situação dos produtos; total de produtos; compras e itens; financeiro (quantidade e soma); SHA-256 de `miip_associacoes`; por documento: status, compra, SHA-256 do XML e do `parse_json`, linhas da sessão de revisão e **histórico da Central**.

| Etapa que falhou | Log do servidor | Resposta | Fotografia |
|---|---|---|---|
| `UPDATE` do documento (linha, `correcoes_produto`, remoção da confirmação) | `transação desfeita … falha simulada: documento` | 500 `CORRECAO_NAO_GRAVADA`, `sucesso:false` | idêntica |
| Decisão da sessão (INSERT e UPDATE bloqueados; ocorre **depois** do `UPDATE` do documento) | `transação desfeita … falha simulada: sessão` | 500 `CORRECAO_NAO_GRAVADA` | idêntica (o `UPDATE` do documento foi desfeito) |
| Histórico da Central (última gravação) | `transação desfeita … falha simulada: histórico` | 500 `CORRECAO_NAO_GRAVADA` | idêntica |
| Mesma falha de histórico pela tela de Compras | idem | 1 chamada de correção (500); aviso "A troca não foi gravada; nada foi alterado na Central."; nenhuma 2ª tentativa de gravar a compra; nenhum aviso de sucesso | idêntica |
| Lote com a 2ª linha para produto inativo / linha repetida | — (validação) | 422 `PRODUTO_INATIVO` / 400 `LINHA_REPETIDA` | idêntica (1ª linha também não corrigida) |

Depois das falhas: decisão da linha continua B, `parse_json` sem `correcoes_produto`, selo de B intacto e gravação com A ainda recusada (`PRODUTO_DIFERENTE_DA_DECISAO_CENTRAL`).

**Correção concluída:** duas requisições idênticas simultâneas → exatamente uma 200 e uma 409 `DECISAO_ALTERADA`; documento com A, `correcoes_produto` com 1 registro, sessão com A e usuário 1, **um** registro de histórico (`#9802 → #9801`), conversão removida só na linha corrigida (selo da linha 2 intacto); compras, itens, financeiro, produtos e mapeamentos inalterados. Repetir a mesma troca → 409 sem nova gravação; corrigir para o mesmo produto → 200 `alterado:false` sem gravação.

### 16.6 Testes (SQLite isolado; limite de 2 minutos por arquivo)

`tests/compras/sprint28-selo-conversao.test.js` — **PASS 6/6**; `tests/compras/central-nfe-sprint28-atomicidade-conversao-sqlite-e2e.test.js` — **PASS 12/12** (11 subtestes + teste pai).

| Teste obrigatório | Onde | Resultado |
|---|---|---|
| Correção concluída com sucesso | E2E "correção concluída…" (16.5) | PASS |
| Falha simulada em cada etapa, com rollback | E2E "falha simulada em cada etapa…", "falha na correção pela tela…", "várias linhas: uma inválida…" | PASS |
| Confirmação válida para a linha e conversão corretas | E2E nota Y: B × 20 gravado com o selo; nota X no fim: B × 20 e C × 12 (conversão aplicada uma vez); unitário "confirmação válida…" | PASS |
| Confirmação reaproveitada após troca de produto | E2E: selo de B usado com A → `DESATUALIZADA`; após voltar para B (2ª correção) o selo antigo de B continua `DESATUALIZADA`; unitário "produto da linha corrigido…" | PASS |
| Confirmação de outra linha ou outro documento | E2E: selo da linha 2 na linha 1 → `DESATUALIZADA`; confirmação da nota Y → `DECISAO_NOTA_INCORRETA`; selo da nota Y com o número da nota X → `DESATUALIZADA`; unitário "outro documento" / "outra linha" | PASS |
| Unidade ou quantidade alterada após confirmação | E2E: unidade do cadastro de B mudada para L → `DESATUALIZADA`; unitário: unidade de estoque, `uCom`, `uTrib`, `qCom`, `qTrib` | PASS |
| `SIM` sozinho não é prova | E2E e unitário: SIM/NÃO sem selo → `SEM_SELO`; SIM só no item → `SEM_SELO`; selo forjado/truncado → `DESATUALIZADA`; ausente → pendência original do MUC (`DIVERGENCIA_QTRIB_FATOR`) | PASS |
| Repetição sem duplicar histórico, compra, estoque ou financeiro | E2E: correção simultânea/repetida; POST de compra repetido (notas X e Y); finalizar e corrigir depois da compra → 409 | PASS |
| Estado antes/depois em todas as recusas | `assert.deepEqual` da fotografia em cada recusa e falha | PASS |

Regressões focadas — PASS: `central-nfe-sprint27-protecao-produto-sqlite-e2e` 10/10, `central-nfe-sprint26-identificacao-efetivacao-sqlite-e2e` 7/7, `entrada-central-nfe-sqlite-e2e` 5/5, `central-nfe-edicao-linha-qtrib-sqlite-e2e` 15/15, `central-nfe-persistencia-sqlite-e2e` 6/6, `central-nfe-sem-associacao` 6/6, `sprint2-confirmacao-conversao` 19/19, `fluxo-confirmacao-conversao-e2e` 6/6, `rc4314-fluxo-financeiro-central` 11/11, `rc841-draft-isolamento` 10/10, `rc851-miip-condicoes` 9/9, `central-nfe-custo-unitario-canonico` 8/8, `miip-v2-sprint26-identificacao-simples` 17/17, `miip-central-revisao` 11/11, `rc75-confirmar-produto` 11/11, `central-entradas-sprint5` 7/7, `central-entradas-sprint10` 7/7, `sprint2-recuperacao-xml-gate` 17/17, `mip-sprint07-compras-xml-central` 9/9, `muc-rc1-certificacao` 18/18, `muc-rc2-certificacao` 18/18, `muc-public-contract` 20/20, `rc431-build-certificacao` 29/29, `auditoria-unid-entrada-nfe` PASS.

FAIL **já existentes**, mesmas contagens da 15.5; nenhuma saída desses arquivos contém `SEM_SELO`, `DESATUALIZADA`, `CORRECAO_NAO_GRAVADA` ou `selo_conversao`:

| Arquivo | Falhas | Origem |
|---|---|---|
| `central-nfe-produto-existente-novo-sqlite-e2e` | 2 (9/2) — caso "conversão impossível" | Sprint 2.2 (14.6) |
| `central-nfe-apresentacao-compra` | 4 (21/4) | 14.6 |
| `rc4312-central-fluxos`, `rc43116-distribuicao-fiscal-central` | 1 cada | 14.6 |
| `correcao-nf-margem-01` | 4 (24/4) | 14.6 |
| `rc4314-insert-compras-alignment` | 1 | idêntica no HEAD (15.5) |

`node --check` e lint sem erros nos arquivos alterados e nos testes novos.

**Na primeira execução do E2E novo**, 1 subteste falhou por expectativa errada do **próprio teste**: com a confirmação ausente, esperava o motivo `QTRIB_UNIDADE_ESTOQUE`, mas o MUC classifica essa linha como `DIVERGENCIA_QTRIB_FATOR`. O teste passou a esperar o código do MUC; a asserção continua exigindo a pendência bloqueante e a fotografia idêntica.

### 16.7 Pendências e limites (não corrigidos nesta sprint)

1. **Confirmações antigas sem selo:** NF-e da Central com SIM dado antes desta sprint e ainda não lançada vão pedir o SIM de novo (por desenho: não há como provar o contexto em que foram dadas).
2. **Conexão SQLite compartilhada:** comandos de outros fluxos emitidos enquanto uma transação está aberta entram nela (vale também para a gravação de Compras, que já usava esse modelo). A fila evita sobreposição entre correções; não isola de outros módulos.
3. A falha **no próprio `COMMIT`** não foi simulada (os gatilhos cobrem as três gravações; um `COMMIT` falho é desfeito pelo SQLite, mas não foi provado em teste).
4. A quantidade proposta pelo MUC pode depender de `quantidade_por_embalagem` / `fator_conversao` enviados no corpo quando `uTrib` difere da unidade de estoque; o selo cobre a **quantidade proposta resultante** (uma proposta diferente invalida o selo), mas vale auditar se o corpo deve poder influenciar o MUC nesse caso.
5. O selo prova que o servidor apresentou aquela proposta exata; não substitui autenticação/autorização da rota de Compras.
6. Produtos #666, #665, #219 e #912, saldos antigos e mapeamentos reais: não tocados (14.8).
7. **Observação no banco real** (consulta somente leitura ao final da sprint): o documento #260 da Central passou de `PRONTA_IMPORTACAO` para `EM_IMPORTACAO` ("Compra aberta na tela de Compras", usuário nulo) às 21:04 de 09/10/2026. Não foi causado pelos testes desta sprint (rodam em bancos temporários; nenhum produto, documento ou chave de teste existe no banco real) e nada foi alterado nele; registrado para conferência.

### 16.8 Validação no Electron — BLOCKED

Não executada: o Electron não pode ser automatizado neste ambiente. **Para homologar** (banco de teste): (1) lançar pela Central uma NF-e de 2 linhas com conversão (ex.: PCT → UN), dar SIM nas duas e abrir em Compras; (2) trocar o produto da linha 1, gravar, responder "OK" e informar o motivo → a Central registra a troca (histórico com "Produto da linha 1 corrigido") e a tela pede de novo a confirmação **só** da linha 1; confirmar e gravar → compra com as quantidades convertidas uma vez; (3) repetir o lançamento → recusado, sem nova compra, estoque ou financeiro; (4) com outra NF-e, interromper o servidor durante a troca (ou usar um banco somente leitura) → a tela deve mostrar "A troca não foi gravada; nada foi alterado na Central." e a NF-e deve continuar com o produto e o SIM anteriores.

## 17. Sprint 2.9 — Integridade do MUC e transações SQLite

**Resultado:** para NF-e da Central, o fator de conversão passou a ser decidido **só pelo backend** (cadastro do produto lido pelo repositório do MUC). Fator, tipo de conversão, apresentação e quantidades convertidas enviados pela tela são descartados, e a quantidade que o MUC calcula para gravar é conferida contra a quantidade validada. A correção de produto da Central grava numa **conexão SQLite própria**: operações de outros módulos não entram mais na transação dela, nem a desfazem. Um `COMMIT` recusado tem comportamento definido e testado: a transação é desfeita, o estado gravado é conferido e a resposta é de falha. Repetir a operação grava uma vez.

Critério de aceite atendido nos testes, com uma ressalva: a gravação de Compras continua na conexão compartilhada (17.8, item 1). A homologação no Electron continua **pendente** (17.9).

O documento #260 não foi consultado nem alterado. Os produtos #666, #665, #219 e #912, saldos antigos, mapeamentos e PDV também não foram tocados. Nada foi feito no banco real.

### 17.1 Origens de `quantidade_por_embalagem` (fator)

| Origem | Onde nasce | Chegava ao MUC numa NF-e da Central? |
|---|---|---|
| Cadastro do produto: `produtos.quantidade_por_embalagem`, `unidade_comercial`, `compra_por_embalagem` | `rotas/produtos.js`, importação inicial (`importacao-inicial-produtos/helpers.js`), `ProdutoEmbalagemService`, MIE (`services/embalagens`, `rotas/mie.js`) | Sim, quando `unidade_comercial` = `uCom` do XML; e como apresentação sintética "LEGADO" do MUC (`parseApresentacaoLegadoProduto`) |
| Apresentação cadastrada: `produto_embalagens.quantidade` / `tipo` / `tipo_conversao` | mesmos cadastros; lida por `RepositorioApresentacoes` | Sim, pelo MUC. **A validação de pendências não a via**: avaliava só a linha de `produtos`, então validação e gravação podiam partir de fatores diferentes. |
| Tela de Compras (`frontend/erp/js/compras.js`) | apresentações vindas da API (preenchem `quantidade_por_embalagem`, `fator_conversao`, `embalagem_id`, `produto_apresentacao_id`, `tipo_conversao`, `quantidade_convertida`), campo manual `#quantidade_por_embalagem_item`, cadastro gravado no rascunho, `quantidade_apresentacao = convertida / qCom` | **Sim, sem conferência** (17.2) |
| Central (`parse_json` dos itens, `avaliarConversoes`, `salvarDecisaoConversao`) | não grava fator nos itens; avalia com a linha de `produtos`, sem apresentações | Não; a ponte Central → Compras não bloqueia por pendência de conversão |
| Saídas do MUC | colunas de `compras_itens` (quantidade, fiscal, apresentação…) | resultado, não entrada |

### 17.2 Exposição encontrada (a tela decidia a conversão)

- `MotorUnidadesMedida.resolverQuantidadeEntradaNfe(item, produto, apresentacao)`: na falta de apresentação, o fator vinha de `item.quantidade_por_embalagem ?? item.fator_conversao`, ou seja, do corpo da requisição. `item.tipo_conversao = 'DIVISOR'` também vinha do corpo.
- `processarItemCompra` do MUC usava `item.produto_apresentacao_id || item.embalagem_id` do corpo e buscava a apresentação por `id` **sem conferir o produto**. A tela podia, portanto, aplicar a apresentação CX×500 de outro produto.
- Para produto sem fator cadastrado (`unidade_comercial` UN, fator 0) e NF-e em PCT com `uTrib` PCT, um fator inventado fazia a validação devolver `FATOR_APRESENTACAO` sem pedir confirmação.
- **Reprodução** (mutação temporária que desliga só o descarte da 17.3, já revertida; teste da 17.7 com um corpo real capturado da tela, alterando apenas o fator para 1200): a compra foi **gravada com 6000 UN** para 5 PCT da nota (`quantidade`, `quantidade_convertida` e `quantidade_fiscal` = 6000). Ainda na mesma mutação, num produto com fator 4 no cadastro, a tela enviando 6 fazia a gravação válida virar pendência `DIVERGENCIA_QTRIB_FATOR`. O fator da tela prevalecia sobre o do cadastro.

### 17.3 Correção da conversão

1. **Campos da tela descartados.** Para NF-e da Central, `reconciliarItensComDocumentoCentral` remove do item `quantidade_por_embalagem`, `fator_conversao`, `tipo_conversao`, `quantidade_apresentacao`, `produto_apresentacao_id`, `embalagem_id`, `compra_em`, `quantidade_embalagens`, `quantidade_convertida`, `quantidade_estoque` e `peso_total_compra` (`CAMPOS_CONVERSAO_ITEM`). Isso se soma ao descarte de decisões e selos da 16.3 e às unidades e quantidades restauradas do XML. A rota registra `[COMPRAS][CENTRAL_NFE] fator/quantidade convertida da tela ignorados; vale o cadastro do produto`.
2. **Apresentação autorizada.** `resolverApresentacoesAutorizadas` (rota de Compras) resolve, para cada linha, a apresentação **do próprio produto** com `RepositorioApresentacoes.resolverPorIdentificador`. Os critérios são os do MUC: GTIN, código do fornecedor e CNPJ, depois tipo = `uCom`, sempre filtrando por `produto_id`. Apresentação de outro produto é descartada. O `id` encontrado é fixado no item, e assim a gravação usa a mesma apresentação.
3. **Mesma base na validação, na aplicação do SIM/NÃO, no selo e na gravação.** `avaliarLinha` recebe a apresentação autorizada (`contexto.apresentacao`), repassada por `validarPendenciasConversaoEntrada` e `aplicarDecisoesNosItens` (opção `apresentacoes`). Sem apresentação, valem `produtos.quantidade_por_embalagem` (quando `unidade_comercial` = `uCom`), o `qTrib` na unidade de estoque (com SIM) ou a pendência `FATOR_CONVERSAO_AUSENTE`.
4. **Conversão efetiva conferida.** Antes de gravar cada item, `quantidadeAutorizadaEntradaNfe` define a quantidade permitida:
   - a proposta do MUC, se a linha não exige confirmação;
   - a quantidade de um SIM/NÃO com selo válido, se exige.

   Depois que o MUC calcula, a rota compara `quantidadeEstoque` com essa quantidade (tolerância 0,001). Se divergir, ou se não houver quantidade autorizada, a resposta é **422 `CONVERSAO_EFETIVA_DIVERGENTE`** com `linhas[{indice, nItem, produto_id, quantidade_autorizada, quantidade_calculada}]`, e a transação da compra é desfeita.
5. **Selo.** O contexto selado continua sendo a **quantidade proposta** (não o fator), junto com produto, documento, linha, unidades, quantidades e correções da linha (16.3). Como a proposta agora sai do cadastro, um fator inventado não muda o selo nem passa por ele. A conferência do item 4 garante que a quantidade gravada é a aprovada.
6. **Sem dupla conversão.** `qCom`/`qTrib` voltam do XML, a quantidade convertida da tela é descartada e o MUC converte uma única vez a partir do XML. Exemplo testado: o corpo traz 20 PCT já convertidos para 80, e a gravação registra 20 UN.
7. Uma validação de entrada que já existia (`validarDistribuicaoConversaoUnidadesItem`, antes da Central) recusa com **400**, sem gravar, um corpo em que fiscal + não fiscal ≠ quantidade convertida da tela. Os testes de adulteração mandam corpos **coerentes** (fiscal = convertida inventada), para chegar à proteção nova. O caso incoerente é testado à parte.

O MUC, o parser NF-e, as regras fiscais e os valores do XML não foram alterados.

### 17.4 Transações SQLite

**Mapa.** O processo usa uma única conexão `sqlite3` (`backend/database.js`: WAL, `busy_timeout=30000`, `foreign_keys=ON`) para todas as rotas. Abrem transação nela:
- **Compras:** `rotas/compras.js` (gravação, devolução, cancelamento).
- **Caixa, contas a receber, financeiro e produtos:** `rotas/caixa.js`, `contas_receber.js`, `financeiro.js`, `produtos.js`.
- **Estoque e reservas:** `estoqueSaldosPublico.executarEmTransacao` e `reservasPublico`.
- **Vendas:** cancelamento, devolução, financeiro e pagamento.
- **Entregas:** `CriarVendaEntregaService` e `MotorFinalizacaoVenda`.
- **Fechamento fiscal:** preparação, transmissão e histórico de NFC-e.
- **Outros:** `MotorComercialService`, `PedidoRepository`, `ProdutoEmbalagemService`, importação inicial de produtos e duplicação de devolução.

**Problema:** no SQLite a transação pertence à **conexão**, não ao fluxo. Enquanto a correção de produto (Sprint 2.8) estava entre `BEGIN IMMEDIATE` e `COMMIT`, qualquer comando de outro módulo naquela conexão:
- entrava na transação dela, e era desfeito ou confirmado junto com a correção;
- ou falhava com `cannot start a transaction within a transaction`, se tentasse abrir a sua.

O `ROLLBACK` de outro módulo também podia desfazer a correção. A fila da 16.2 só evitava a sobreposição entre duas correções.

**Correção mínima (só a correção de produto).** `CentralRevisaoPersistenteService` passou a abrir uma **conexão própria** para a transação: mesmo arquivo, `OPEN_READWRITE`, `busy_timeout = 30000`, `foreign_keys = ON`. Os repositórios da sessão e do histórico usados dentro da transação ficam ligados a ela, e a conexão é fechada no fim, com sucesso ou falha. A conexão compartilhada continua sendo usada nas leituras anteriores à transação. Banco em memória ou dublê sem arquivo usa a conexão recebida, como antes.

Efeito colateral aceito: enquanto a correção grava (milissegundos), escritas de outros módulos **esperam** o bloqueio de escrita do SQLite (até 30 s), em vez de entrarem na transação. Leituras não esperam (WAL).

Sem refatoração global: as demais transações continuam na conexão compartilhada.

**Reprodução em banco isolado** (`central-nfe-sprint29-transacoes-sqlite-e2e`). A correção B → A é pausada **dentro** da transação, depois de gravar o documento e a sessão e antes do histórico (`CentralHistoricoRepository.prototype.inserir` controlado pelo teste). O efeito de cada lado é lido numa conexão nova, só leitura:

| Cenário | Conexão compartilhada (mutação temporária, revertida) | Conexão própria (código atual) |
|---|---|---|
| Correção falha; outro módulo faz um `INSERT` avulso durante a pausa | O `INSERT` entrou na transação da correção e foi **perdido** no rollback, embora o outro módulo tenha recebido sucesso | O `INSERT` espera e é gravado. A correção é desfeita inteira (fotografia idêntica) e responde 500 `CORRECAO_NAO_GRAVADA` |
| Outro módulo abre transação (`executarEmTransacao`), insere e desiste (rollback) durante a pausa; a correção conclui | O outro módulo falhou com `SQLITE_ERROR: cannot start a transaction within a transaction` | O outro módulo espera, desfaz só a própria gravação (sem erro de transação) e a correção grava inteira: documento e sessão com A, **um** histórico `#9912 → #9911`, sem efeito em estoque, compras ou financeiro |

Ao fim de cada cenário, `BEGIN IMMEDIATE` + `ROLLBACK` na conexão compartilhada funcionam: ela não ficou presa numa transação.

### 17.5 Falha de `COMMIT`

**Como foi simulada.** O teste cria, no banco temporário, uma chave estrangeira **adiada**:
- `s29_pai(id)`;
- `s29_filho(pai_id REFERENCES s29_pai DEFERRABLE INITIALLY DEFERRED)`.

Um gatilho na tabela gravada insere um filho órfão. O SQLite aceita os comandos e só recusa no `COMMIT` (`SQLITE_CONSTRAINT: FOREIGN KEY constraint failed`).

**Sonda preliminar** (script avulso, banco temporário):
- Um `COMMIT` recusado **deixa a transação aberta**. O `BEGIN` seguinte falha e só um `ROLLBACK` explícito limpa.
- **Sem callback** no `db.run('COMMIT')`, o erro vira **exceção não tratada** no processo Node (o servidor não tem `uncaughtException`) e a transação continua aberta.

**Antes:**
- A gravação de Compras fazia `db.run('COMMIT')` sem callback e respondia sucesso.
- A correção usava `executarEmTransacao`, que já desfazia em erro de `COMMIT`, mas a resposta presumia "nada gravado".

**Agora:**
- **Compras** (`confirmarTransacaoCompra`, nos dois `COMMIT` da criação: entrada simplificada e compra normal). Em erro de `COMMIT`: `ROLLBACK`, depois consulta `compras` por `id` + `chave_acesso`:
  - sem registro: **500 `COMPRA_NAO_GRAVADA`** ("A compra não foi gravada… nada foi alterado. Tente novamente.");
  - registro encontrado, ou consulta falhou: **500 `COMPRA_ESTADO_INDETERMINADO`** com `compra_id` ("Confira a compra antes de repetir").

  Nenhuma das duas segue para auditoria, vínculo com a Central ou resposta de sucesso. Log: `[COMPRAS] COMMIT recusado`.
- **Correção** (`CentralRevisaoPersistenteService`). Depois do rollback, relê o `parse_json` do documento:
  - igual ao anterior: **500 `CORRECAO_NAO_GRAVADA`**;
  - igual ao novo, ou leitura impossível: **500 `CORRECAO_ESTADO_INDETERMINADO`** ("Não foi possível confirmar se a troca foi gravada. Atualize a tela e confira a NF-e antes de repetir.").

  Log com `estado: GRAVADA | INALTERADA | INDETERMINADO`.

**Resultados** (estado conferido numa conexão nova, sem presumir rollback):

| Operação | Resposta | Estado no arquivo após a falha | Recuperação |
|---|---|---|---|
| Correção A → B com gatilho no histórico | 500 `CORRECAO_NAO_GRAVADA`, `sucesso:false` | Fotografia idêntica: documento (status, compra, XML, `parse_json`), sessão de revisão, histórico, estoque, compras, financeiro. `s29_filho` vazio. Conexão compartilhada livre | Sem o gatilho, repetir → 200 com **+1** histórico. Terceira vez → 409 `DECISAO_ALTERADA`, sem gravação |
| Gravação de compra (NF-e da Central, 10 UN) com gatilho em `compras` | 500 `COMPRA_NAO_GRAVADA`, `compra_id: null`, `sucesso:false` | Compras, itens, lotes, estoque (saldo fiscal e total), financeiro e documento (status, `compra_id`, histórico) idênticos. Conexão livre. Servidor segue atendendo (`GET /api/produtos/:id` → 200) | Mesmo corpo de novo → 200: **uma** compra com a chave, +1 item, +10 no saldo fiscal e no estoque, documento vinculado. Terceira vez → recusada, sem duplicar compra, estoque, financeiro ou histórico |

**Mutação temporária, revertida.** Com o `COMMIT` sem callback de antes, o mesmo teste termina com `SQLITE_CONSTRAINT: FOREIGN KEY constraint failed` **não tratado**. Em produção isso derruba o processo.

**Resultados indeterminados:** nenhum nos testes. Em todos os `COMMIT` recusados, a releitura encontrou o estado anterior. Os códigos `*_ESTADO_INDETERMINADO` cobrem o caso em que a releitura falha ou encontra os dados gravados. Esse caminho **não foi provocado em teste**: não há forma confiável de o SQLite relatar erro num `COMMIT` que gravou.

### 17.6 Arquivos alterados

| Arquivo | Alteração |
|---|---|
| `backend/services/unidades/ConfirmacaoConversaoEntradaNfe.js` | `avaliarLinha` usa a apresentação autorizada; opção `apresentacoes` em `validarPendenciasConversaoEntrada` e `aplicarDecisoesNosItens`; `CAMPOS_CONVERSAO_ITEM` descartados na reconciliação (`campos_conversao_descartados`); `quantidadeAutorizadaEntradaNfe` |
| `backend/rotas/compras.js` | `resolverApresentacoesAutorizadas` (só do próprio produto, fixa `produto_apresentacao_id`); validação, aplicação e gravação com a mesma apresentação; conferência `CONVERSAO_EFETIVA_DIVERGENTE`; `confirmarTransacaoCompra` / `responderFalhaCommitCompra` nos dois `COMMIT` da criação |
| `backend/motores/central-entradas/services/CentralRevisaoPersistenteService.js` | Conexão própria para a transação da correção (`abrirConexaoTransacao` / `fecharConexao`), repositórios ligados a ela; releitura após falha e `CORRECAO_ESTADO_INDETERMINADO` |
| `tests/compras/central-nfe-sprint29-fator-conversao-sqlite-e2e.test.js` (novo) | Fator ausente, inválido, adulterado, divergente, de outro produto, dupla conversão, conferência da conversão efetiva |
| `tests/compras/central-nfe-sprint29-transacoes-sqlite-e2e.test.js` (novo) | Concorrência nos dois sentidos e falha de `COMMIT` na correção e na compra |
| `tests/compras/central-nfe-sprint28-atomicidade-conversao-sqlite-e2e.test.js` | Ver abaixo |

Ajustes no E2E da Sprint 2.8, sem afrouxar asserções:
1. As falhas simuladas usam gatilhos **comuns** (criados e removidos no banco temporário) em vez de `TEMP`. Um gatilho `TEMP` só vale na conexão que o criou, e a correção agora grava na conexão própria. As asserções (500 `CORRECAO_NAO_GRAVADA` e fotografia idêntica) não mudaram.
2. O caso "confirmação ausente" volta a esperar `QTRIB_UNIDADE_ESTOQUE`, a expectativa original. Na 16.6, o `DIVERGENCIA_QTRIB_FATOR` vinha do fator 4 **enviado pela tela**. O produto da fixture não tem fator cadastrado, então a proposta legítima do backend é o `qTrib` na unidade de estoque. A asserção continua exata e exige a pendência bloqueante e a fotografia idêntica.

### 17.7 Testes (SQLite isolado; limite de 2 minutos por arquivo)

Os arquivos novos usam o corpo **real** da tela de Compras. Ele é capturado interceptando apenas o `POST /api/compras` com um 409, para nada ser gravado na captura. Em seguida o corpo é adulterado e enviado à rota real.

**PASS:**

| Arquivo | Resultado | O que prova |
|---|---|---|
| `central-nfe-sprint29-fator-conversao-sqlite-e2e` | **8/8** (7 + pai), ~12 s | Ver detalhamento abaixo |
| `central-nfe-sprint29-transacoes-sqlite-e2e` | **5/5** (4 + pai), ~8 s | 17.4 e 17.5 |
| `central-nfe-sprint28-atomicidade-conversao-sqlite-e2e` | 12/12 | Sprint 2.8 com os ajustes da 17.6 |
| `sprint28-selo-conversao` | 6/6 | |
| `central-nfe-sprint27-protecao-produto-sqlite-e2e` | 10/10 | |
| `central-nfe-sprint26-identificacao-efetivacao-sqlite-e2e` | 7/7 | |

O que o arquivo de fator prova:
1. O motor sozinho aplica um fator 1200 vindo no item; a reconciliação o descarta.
2. Produto sem fator, com o corpo da tela inalterado ou com fator ausente, texto, negativo, zero, nulo, ×1200, ×4 com `DIVISOR`, apresentação CX×500 de outro produto ou quantidade convertida coerente: sempre 422 `FATOR_CONVERSAO_AUSENTE`, com fator aceito 0 e fotografia idêntica. Corpo incoerente: 400, sem gravar.
3. Apresentação PCT×4 válida pela tela: 20 UN uma vez.
4. Apresentação PCT×4 com fator ×1200, ×6 (divergente), inválido, ausente, apresentação de outro produto com `DIVISOR` ou dupla conversão: sempre **20 UN uma vez**, saldo fiscal e estoque +20, cadastro de conversão intacto, repetição recusada sem gravar.
5. Fator do cadastro do produto (PCT×4 sem apresentação), válido pela tela e com ×6 da tela: 20.
6. Linha confirmada na Central (`qTrib` 20 UN) com fator ×1200 e `quantidade_estoque_confirmada` 6000 vindos da tela: 20.
7. MUC forçado a devolver o dobro: 422 `CONVERSAO_EFETIVA_DIVERGENTE` com fotografia idêntica; com o cálculo correto, 20 UN uma vez.

Regressões focadas, todas PASS:
- `entrada-central-nfe-sqlite-e2e` 5/5, `central-nfe-edicao-linha-qtrib-sqlite-e2e` 15/15, `central-nfe-persistencia-sqlite-e2e` 6/6, `central-nfe-sem-associacao` 6/6.
- `sprint2-confirmacao-conversao` 19/19, `fluxo-confirmacao-conversao-e2e` 6/6, `central-nfe-custo-unitario-canonico` 8/8.
- `rc4314-fluxo-financeiro-central` 11/11, `rc841-draft-isolamento` 10/10, `rc851-miip-condicoes` 9/9.
- `miip-v2-sprint26-identificacao-simples` 17/17, `miip-central-revisao` 11/11, `rc75-confirmar-produto` 11/11.
- `central-entradas-sprint5` 7/7, `central-entradas-sprint10` 7/7, `sprint2-recuperacao-xml-gate` 17/17, `revisao-persistente` 8/8, `mip-sprint07-compras-xml-central` 9/9.
- `muc-rc1-certificacao` 18/18, `muc-rc2-certificacao` 18/18, `muc-public-contract` 20/20, `rc431-build-certificacao` 29/29, `auditoria-unid-entrada-nfe` PASS.

**Mutações** (alteração temporária do código, execução, reversão; `rg S29_MUTACAO` vazio ao final). Cada teste novo falha sem a proteção correspondente:

| Proteção desligada | Resultado |
|---|---|
| Descarte dos campos de conversão da tela | Compra gravada com 6000 UN para 5 PCT; gravação válida (cadastro ×4, tela ×6) virou pendência; 3 subtestes FAIL |
| Conferência da conversão efetiva | Compra gravada com o dobro (40 UN); 1 subteste FAIL |
| Conexão própria da correção | Gravação de outro módulo perdida; outro módulo com `cannot start a transaction within a transaction`; 2 subtestes FAIL |
| `COMMIT` da compra conferido | `SQLITE_CONSTRAINT` não tratado; 1 subteste FAIL |

**FAIL já existentes**, com as mesmas contagens da 16.6 e não relacionados a esta sprint:

| Arquivo | Falhas | Origem |
|---|---|---|
| `central-nfe-produto-existente-novo-sqlite-e2e` | 2 (9/2): caso "conversão impossível" | Sprint 2.2 (14.6) |
| `central-nfe-apresentacao-compra` | 4 (21/4) | 14.6 |
| `rc4312-central-fluxos`, `rc43116-distribuicao-fiscal-central` | 1 cada | 14.6 |
| `correcao-nf-margem-01` | 4 (24/4) | 14.6 |
| `rc4314-insert-compras-alignment` | 1 | idêntica no HEAD (15.5) |
| `central-entradas/rc75-ux` | 1: `resolverChipEtapaCentral` devolve `AGENDADO` em vez de `AGUARDANDO_XML` | Testa só `frontend/erp/js/central-entradas-ux.js`, inalterado em relação ao HEAD e não tocado nesta sprint; arquivo fora da lista de regressões das sprints anteriores |

**BLOCKED:** validação no Electron (17.9).

`node --check` e lint sem erros nos arquivos alterados e nos testes novos.

### 17.8 Pendências e limites (não corrigidos nesta sprint)

1. **A gravação de Compras continua na conexão compartilhada.** Comandos de outros módulos emitidos durante a transação de uma compra ainda entram nela. Isolá-la exige levar a gravação inteira (MUC, estoque, financeiro, lotes e vínculo) para outra conexão, o que seria uma refatoração do acesso ao banco, fora do escopo pedido.
2. **`COMMIT` sem callback** na devolução (`rotas/compras.js`, ~linha 1436) e no cancelamento de compra (~linha 2449): mesmo risco da 17.5, fora do fluxo NF-e → efetivação.
3. **Linhas sem fator cadastrado** (`FATOR_CONVERSAO_AUSENTE`, `uTrib` diferente da unidade de estoque) que antes passavam com o fator digitado na tela agora ficam **bloqueadas** até o cadastro receber a apresentação ou o fator. Isso é intencional: o fator passa a ser do cadastro. Para o operador, a mudança é cadastrar a embalagem do produto antes de lançar.
4. `codigo_barras` e `codigo_fornecedor` do corpo ainda participam da escolha **entre as apresentações do próprio produto**, quando ele tem mais de uma do mesmo tipo. A escolha nunca sai do produto nem do tipo da `uCom` do XML.
5. A avaliação de conversão do painel da Central não considera apresentações cadastradas. Pode mostrar `FATOR_CONVERSAO_AUSENTE` numa linha que Compras resolve pelo cadastro, e a ponte não bloqueia por isso. O valor gravado é o do backend de Compras.
6. O selo continua sem o fator: sela a quantidade proposta (17.3, item 5).
7. A apresentação sintética "LEGADO" do MUC (produto com `unidade_comercial` UN e fator > 0) pode divergir da validação, que é mais estrita. Nesse caso a gravação é recusada com `CONVERSAO_EFETIVA_DIVERGENTE`, nunca gravada com a conversão errada.
8. O caminho `*_ESTADO_INDETERMINADO` não foi provocado em teste (17.5).
9. #260, #666, #665, #219, #912, saldos antigos e mapeamentos: não tocados.

### 17.9 Validação no Electron — BLOCKED

Não executada: o Electron não pode ser automatizado neste ambiente. **Para homologar** (banco de teste, nunca o de produção):

1. **Produto com embalagem cadastrada** (ex.: PCT com 4 UN): lançar pela Central uma NF-e de 5 PCT e abrir em Compras.
   - Alterar na linha o campo "quantidade por embalagem" para outro valor e gravar.
   - Esperado: a compra registra **20 UN** (o valor do cadastro); o estoque sobe 20.
2. **Produto sem embalagem cadastrada:** lançar uma NF-e em PCT (unidade tributável PCT), informar um fator na tela e gravar.
   - Esperado: a gravação é recusada com pendência de conversão, nada é gravado.
   - Depois de cadastrar a embalagem no produto, a gravação passa com a quantidade do cadastro.
3. **Correção de produto concorrente:** trocar o produto de uma linha na Central enquanto outra estação grava uma venda ou um ajuste de estoque.
   - Esperado: as duas operações concluem e nenhuma desfaz a outra (conferir venda/estoque e o histórico da NF-e).
4. Repetir o lançamento já gravado.
   - Esperado: recusado, sem nova compra, estoque ou financeiro.

---

## 18. Auditoria breve — classificação da finalidade da NF-e (somente leitura)

**Escopo:** leitura do código e dos testes existentes. Nenhum código, banco, configuração ou comportamento de interface foi alterado. Nada foi reproduzido no Electron. **Tratamento previsto: depois da conclusão e homologação do fluxo de entrada e lançamento da NF-e.**

### 18.1 Causa

**O modal, isoladamente, não diverge.** Em "Como deseja registrar esta NF-e?" (`mostrarDialogoPoliticaEntrada`, `frontend/erp/js/compras.js`), o texto da sugestão e a opção marcada vêm da mesma variável:

- `const sugestao = classificacao?.tipoEntrada || …` (linha 2069);
- `const check = (tipo) => (tipo === sugestao ? ' checked' : '')` (linha 2072).

O pacote instalado (`dist/erp/win-unpacked/resources/app.asar`, 06/10/2026) tem o mesmo trecho, e o `ClassificadorEntradaCompra.js` empacotado é idêntico ao do código-fonte. **Não há evidência de um caminho de código em que o modal mostre "Industrialização 95%" com "Revenda" já marcada.** Dois defeitos confirmados explicam a combinação observada (sugestão Industrialização com confiança alta e Revenda escolhida):

1. **A sugestão está errada e com confiança alta (causa principal provável).** `classificarPorCfopItem` (`backend/services/compras/ClassificadorEntradaCompra.js`, linhas 47–88) usa o CFOP do XML. Esse é o CFOP de **saída do fornecedor**, mas é tratado como se fosse o de entrada da empresa.
   - O sufixo `101` está em `CFOP_INDUSTRIALIZACAO` (linha 24). Assim, toda NF-e com CFOP **5101/6101** ("venda de produção do estabelecimento", isto é, o fornecedor é o fabricante) vira **Industrialização com 90%**.
   - Para um mercado comprando de fabricante (bebidas, laticínios, etc.), o correto é **Revenda**. O operador marca Revenda, a compra grava `tipo_entrada_alterado = 1`, e a Central mostra "Tipo sugerido: Industrialização / Tipo escolhido: Revenda / Alterado pelo operador".
   - **De onde vêm os 95%:** 90 do CFOP mais 5 do histórico do fornecedor (≥ 70% das compras como Industrialização). Se a natureza da operação contiver "INDUSTRIALIZ" (ex.: "Venda de produtos industrializados"), a concordância entre os dois sinais (linha 178) leva a 96%.
   - **O histórico não corrige a sugestão.** Um fornecedor sempre lançado como Revenda só prevalece quando a confiança fiscal é **menor que 90** (linha 257). Com CFOP 5101, a confiança é exatamente 90, então a sugestão continua Industrialização em toda nota e o motivo não menciona o histórico.
   - Não existe conversão de CFOP de saída para CFOP de entrada antes da classificação: não há nada no backend equivalente a 5101 → 1102.
   - O classificador também **não usa** o cadastro da empresa (CNAE, regime) nem o uso do produto (revenda ou insumo).
2. **A sugestão pode ser de outra nota (defeito confirmado).** `classificacaoEntradaAtual` recebe a sugestão **antes** de o modal abrir (linha 7680) e só é limpa depois de uma gravação bem-sucedida (linha 7238).
   - **Ela não é limpa** ao abrir uma nova compra (`showCompraModal`), ao cancelar a compra, nem ao fechar o modal da finalidade com **ESC**.
   - O modal tem `data-bs-backdrop="static"`, mas não `data-bs-keyboard="false"`. No Bootstrap 5.1.3 do projeto, ESC fecha o modal sem executar o callback de "Continuar".
   - Nesses casos, o formulário fica em **Revenda**: o rádio está fixo como `checked` (linha 6293) e é redefinido em `showCompraModal` (linhas 6174 e 6613).
   - Mesmo assim, o envio (linhas 6862–6865) leva `tipo_entrada_sugerido`, `tipo_entrada_confianca` e `tipo_entrada_motivo` de uma nota que o operador **não confirmou**. O backend grava `tipo_entrada_alterado = 1`, e a Central exibe uma sugestão de 95% "rejeitada" pelo operador, que ele nunca viu ou aceitou para aquela compra.

**Pontos latentes (sem divergência observada hoje):**

- Se a classificação vier sem `tipoEntrada`, o modal marca **Uso e Consumo** por padrão (linha 2069). Já a falha da API devolve **Revenda 55%** ("Classificação indisponível").
- `normalizarTipoEntrada` (`PoliticaEntradaCompra.js`) converte qualquer valor desconhecido em **REVENDA** sem avisar. Por exemplo, "INDUSTRIALIZAÇÃO" com acentos não é reconhecido. Hoje a tela só envia as constantes sem acento, então isso não ocorre.

### 18.2 Fluxo atual: da sugestão à seleção

1. A Central chama `abrirCompraDesdeCentralEntradas` (linha 7709). Ela chama `showCompraModal`, que coloca o formulário em REVENDA, e depois `finalizarImportacaoXmlCompra` (linha 7677).
2. `classificarEntradaCompraApi` (linha 2038) chama `POST /api/compras/classificar-entrada`, que executa `classificarEntrada`:
   - CFOP: do payload, dos dados, o predominante do XML (`extrairSinaisFiscaisXml.js`, `<CFOP>` dos itens) ou o do primeiro item;
   - natureza (`natOp`) e `finNFe`;
   - `mesclarSinais`: vence a maior confiança; +6 quando dois sinais concordam, limitado a 98; sem sinais, Revenda 55;
   - histórico do fornecedor na tabela `compras`: +3, +5 ou +8; substitui a sugestão só se a confiança for < 90.
3. O resultado vai para `classificacaoEntradaAtual` (linha 7680), e o modal abre com a sugestão marcada.
4. "Continuar" lê o rádio marcado. No callback, `tipoEntradaCompraAtual = tipo` e `classificacaoEntradaAtual = classif`. Depois rodam `preencherFormularioCompra`, `definirTipoEntradaCompra(tipo)` e `aplicarPoliticaEntradaCompra`, que oculta os itens em Uso e Consumo e redistribui o fiscal dos itens.
5. Na gravação:
   - `tipo_entrada` vem do rádio do formulário (`obterTipoEntradaSelecionado`, linha 1950);
   - `tipo_entrada_sugerido`, a confiança e o motivo vêm de `classificacaoEntradaAtual`.
6. Backend (`rotas/compras.js`, ~1716–1760):
   - `normalizarTipoEntrada(tipo_entrada)`;
   - `tipo_entrada_alterado = sugerido ≠ escolhido`;
   - `resolverPolitica` e `montarResumoFiscalEntrada`.
7. A Central (`renderClassificacaoEntradaCentral`, `central-entradas.js` 293–316) mostra o tipo sugerido, o escolhido, a confiança e o selo "Alterado pelo operador".

### 18.3 Riscos concretos

| Área | Risco se a sugestão errada for aceita (ou registrada como sugestão) |
|---|---|
| Estoque | **Uso e Consumo** desliga estoque, cadastro de produtos, custo médio, MIIP e itens operacionais (`resolverPolitica`). Uma NF-e de mercadoria aceita assim não entra no estoque |
| Custo | **Bonificação** não executa custo médio |
| Fiscal / escrituração | **Industrialização** troca o CFOP 5101 do XML por **1101** (compra para industrialização) em `sugerirCfopEscrituracao`; Uso e Consumo troca por **1556**. A distribuição fiscal dos itens (`aplicarDistribuicaoFiscalItemCentral`) também depende do tipo |
| Financeiro | O financeiro roda em todos os tipos. O tratamento específico de Bonificação no financeiro não foi auditado aqui |
| Compras / auditoria | Sugestão e confiança gravadas podem ser de outra nota (18.1, item 2). Isso gera selos "Alterado pelo operador" falsos e indicadores de acerto do classificador sem valor |
| Autorreforço | Uma escolha errada gravada entra no histórico do fornecedor e aumenta a confiança das próximas sugestões (+5/+8). Uma confiança alta (90–99%) induz o operador a aceitar |

### 18.4 Testes existentes e lacunas

- `tests/compras/rc91-classificacao-entrada.test.js`:
  - testa apenas CFOPs **de entrada** (1101, 1102, 1556), nunca os de saída que chegam no XML (5101, 6101, 5102, 5405);
  - as verificações de tela são buscas de texto no código-fonte.
- `tests/compras/rc43111-bonificacao-cfop-item.test.js`: só cobre bonificação por CFOP do item.
- `tests/compras/helpers/centralNfeE2eHarness.js` e os E2E das sprints 2.6–2.9:
  - **forçam** `politica_entrada_import:checked = 'REVENDA'` (linha 445) e clicam "Continuar" automaticamente (linha 304);
  - nenhum teste verifica qual opção vem pré-marcada, o ESC, a limpeza de `classificacaoEntradaAtual` ou a coerência entre sugerido e escolhido gravados.

### 18.5 Testes recomendados

1. **Classificador:** cada CFOP de saída comum para o varejo (5101/6101, 5102/6102, 5403, 5405, 5910, 5949) com e sem natureza. Esperado para mercado: Revenda, exceto bonificação.
2. **Histórico × CFOP:** fornecedor com 3 ou mais compras exclusivamente Revenda e nota com CFOP 5101. A sugestão não deve ser Industrialização com ≥ 90%.
3. **Modal:** renderizar com cada `tipoEntrada` (REVENDA, INDUSTRIALIZACAO, BONIFICACAO, USO_CONSUMO) e conferir que o rádio marcado é igual ao texto da sugestão. Também com `tipoEntrada` ausente, conferindo o padrão.
4. **ESC / cancelar:** fechar o modal com ESC ou cancelar a compra, abrir uma nova compra manual e gravar. Conferir que nenhum `tipo_entrada_sugerido`, confiança ou motivo de outra nota é enviado.
5. **Falha da API de classificação:** a sugestão de reserva aparece como indisponível e não marca `tipo_entrada_alterado`.
6. **E2E da Central sem forçar REVENDA:** aceitar a opção pré-marcada e conferir no banco que `tipo_entrada = tipo_entrada_sugerido` e `tipo_entrada_alterado = 0`. Depois trocar a opção e conferir `alterado = 1`.
7. **Backend:** `tipo_entrada` desconhecido ou acentuado deve ser recusado ou normalizado explicitamente, nunca convertido em Revenda sem aviso.

### 18.6 Proposta de correção futura (não executada)

1. **Classificador:** tratar o CFOP do XML como CFOP de saída do emitente.
   - Não mapear 5101/6101 para Industrialização.
   - Basear Industrialização no perfil da empresa (CNAE/atividade industrial) e no uso do produto (insumo), não no CFOP do fornecedor.
   - Limitar a confiança quando o único sinal for o CFOP.
2. **Histórico:** permitir que um histórico exclusivo e consistente prevaleça sobre o CFOP de saída, e mostrar no motivo quando o histórico discorda.
3. **Tela:**
   - limpar `classificacaoEntradaAtual` em `showCompraModal` e ao cancelar ou fechar;
   - usar `data-bs-keyboard="false"` ou tratar o ESC como cancelamento da importação;
   - vincular a sugestão à nota (chave ou documento da Central) e só enviá-la se o modal tiver sido confirmado para aquela nota.
4. **Padrões:** usar um único padrão sem classificação, sem Uso e Consumo implícito. Quando a confiança for baixa, mostrar o modal sem opção pré-marcada.
5. **Backend:** validar `tipo_entrada` contra a lista fechada e recusar valores desconhecidos em vez de convertê-los em Revenda.
6. Nenhuma reclassificação de compras já gravadas sem decisão explícita: o histórico atual pode conter escolhas influenciadas por sugestões erradas.

---

## 19. Sprint 3.0 — Conclusão da Central e lançamento da NF-e (homologação no Electron)

**Resultado:** o fluxo Central → revisão de produtos → MUC → Compras → efetivação foi **homologado no Electron real**, numa cópia identificada do banco. Foi encontrado **um bloqueador**, corrigido nesta sprint: a troca de produto em Compras usava `window.prompt()`, que o Electron não suporta. As duas NF-e de homologação terminaram sem produto incorreto, sem conversão indevida, sem duplicidade e com compra, estoque, financeiro e XML coerentes.

Não foram alterados: o classificador da finalidade (seção 18), os produtos #260, #666, #665, #219 e #912, os saldos históricos e os mapeamentos do banco real. O banco real não foi aberto para escrita. Sem commit.

### 19.1 Ambiente

| Item | Valor |
|---|---|
| Aplicativo | `electron.js` do repositório, Electron 22.3.27 (o mesmo do `npm start`), carregado por um invólucro em `%TEMP%\cds-s30\electron-main.js` |
| Banco | Cópia `%TEMP%\cds-s30-electron\mercadao.db`, criada por `VACUUM INTO` (somente leitura do original), identificada por `COPIA_HOMOLOGACAO_SPRINT30.txt`. SHA-256 na criação `F848FEF5…3AE4BC`; ao fim da homologação `83F60EA5…E88662` |
| Isolamento | `DB_DIR` na cópia (o invólucro recusa `ProgramData`), `PORT=3095`, `JWT_SECRET` próprio, perfil Electron próprio. O log do servidor confirma "BANCO OFICIAL EM USO: …\cds-s30-electron\mercadao.db" |
| Serviços de fundo desligados | A cópia está com ambiente fiscal = produção. Ficaram sem efeito: sincronização SEFAZ da Central, health da Central, retomada de consultas NF-e, equipamentos e monitor. Nenhum passo do roteiro depende deles (o upload manual não usa rede) |
| Automação | Chrome DevTools Protocol (`--remote-debugging-port=9333`) sobre a janela real: cliques, preenchimento e diálogos nativos (`confirm`). Login pela gravação de `token`/`user` no `localStorage`, como faz `login.js`. Oclusão de janela desligada (`CalculateNativeWinOcclusion`), sem o que a janela coberta deixava de pintar |
| NF-e | Duas NF-e de teste do fornecedor CNPJ `35.***.***/****-67` (mapeamentos existentes). **A:** nº 930001, chave final 300018, R$ 275,00, 3 itens. **B:** nº 930002, chave final 300023, R$ 48,00, 1 item |

A cada passo foi tirada uma fotografia somente leitura da cópia (`%TEMP%\cds-s30\foto-*.json`): compras, itens, financeiro, estoque, produtos, embalagens, hash dos mapeamentos MIIP, histórico da Central e produtos do cenário.

### 19.2 Bloqueador encontrado e corrigido

**Sintoma no Electron (NF-e A):** em Compras, o operador trocou o produto de uma linha que a Central havia decidido. A gravação devolveu 422 `PRODUTO_DIFERENTE_DA_DECISAO_CENTRAL` (correto) e a tela perguntou "Trocar também na Central?" (`confirm`). Ao aceitar, `window.prompt()` lançou "prompt() is and will not be supported." O erro ficou numa promessa sem tratamento: o operador não recebeu mensagem e não havia como concluir a troca pela tela. Nada foi gravado (fotografia idêntica).

**Correção** (`frontend/erp/js/compras.js`):
- `oferecerCorrecaoProdutoCentral` (~linha 7290): o `confirm` + `prompt` foi substituído por `pedirMotivoTrocaProdutoCentral` (~linha 7342). É um modal Bootstrap (`#trocaProdutoCentralModal`, sem fechar pelo fundo) que lista as linhas trocadas ("na Central" → "aqui") e pede o motivo.
- Motivo com menos de 10 caracteres: o modal mostra o erro e não envia nada. "Cancelar" ou fechar: nada é enviado e aparece o aviso "Compra não gravada. Volte ao produto escolhido na Central ou confirme a troca."
- Confirmado: segue o caminho já existente (`POST /central-entradas/:id/corrigir-produtos` e depois `POST /compras`). Nenhuma regra de backend mudou.
- A chamada (~linha 7268) agora trata a falha e mostra "Compra não gravada: …" em vez de uma promessa rejeitada sem mensagem.

**Testes:**
- O harness (`tests/compras/helpers/centralNfeE2eHarness.js`) passou a emular o Electron: `prompt()` lança o mesmo erro, e o modal novo é confirmado pelo mapa `confirmacoesModal`.
- Os testes das sprints 2.7 e 2.8 que passavam por `confirm`/`prompt` agora preenchem `#trocaProdutoCentralMotivo` ou clicam em `#trocaProdutoCentralCancelar`.

### 19.3 Roteiro executado no Electron — NF-e A (produto com embalagem, revisão, troca de produto)

| Passo | Ação na tela | Resultado |
|---|---|---|
| 1 | Central → upload de `nfe-s30-A.xml` | Documento 284 em revisão. Itens: sachê #1161 em 3 PCT (embalagem cadastrada PCT×10), bombom #1138 em 2 PCT com qTrib 8 UN, napolitano com código de barras repetido em #1165 e #1167 |
| 2 | Revisão de produtos | Dois itens vinculados automaticamente. Para o código repetido, a tela perguntou e o operador escolheu #1167 |
| 3 | Conversão na revisão | Só a linha do bombom ficou pendente (`QTRIB_UNIDADE_ESTOQUE`); respondido SIM. Após recarregar a página, a revisão retomou com "Confirmado no servidor" |
| 4 | Finalizar Entrada | Modal de finalidade: Revenda 97%, Revenda marcada (coerente; a seção 18 não foi reproduzida nesta nota) |
| 5 | Compras | Linhas: 30 un (apresentação 72, 3 × 10), 8 UN, 2 UN |
| 6 | Edições do operador | Linha 1 com a embalagem trocada para "Unidade" (fator 1). Linha 3 trocada de #1167 para #1165 |
| 7 | Salvar → validação fiscal → confirmar | Antes da correção: 422 e `prompt()` quebrado, nada gravado (19.2). Depois: o modal da troca apareceu; motivo curto foi recusado na tela; motivo válido → `corrigir-produtos` 200 → `POST /compras` 200, **compra #48** |
| 8 | Repetição | Reabrir pela Central: aviso "Documento já possui compra vinculada (#48)", a tela não abre. `finalizar-entrada`: 409. `POST /compras` com o corpo completo: 400 "Esta nota já foi lançada na compra #48". Fotografia idêntica |

Compra #48, conferida no banco:

| Conferência | Valor |
|---|---|
| Compra | total = total do XML = R$ 275,00, diferença 0; Revenda (sugerido Revenda, alterado 0); concluída |
| Itens (`origem_conversao` CENTRAL_NFE) | #1161: **30** un (3 embalagens × 10, fator 10 do cadastro; o fator 1 da tela foi descartado). #1138: 8. #1165: 2 |
| Financeiro | 1 despesa de R$ 275,00 (paga) |
| Estoque | +40 no total. #1161: 10 → 40. #1138: 4 → 12. #1165: 8 → 10. #1167 sem alteração (8) |
| Preços | Preço de venda sem alteração; custo de compra atualizado |
| XML | SHA-256 guardado igual ao do arquivo (`4c2e18c41468d588…`) |
| Central | Documento 284 IMPORTADA, compra 48. Histórico: "Produto da linha 3 corrigido: #1167 → #1165. Motivo: …" e "Compra #48 gravada" |

Contagens da cópia: compras 47 → 48, itens 187 → 190, financeiro 59 → 60 (R$ 21.556,88 → R$ 21.831,88), estoque 69.930,77 → 69.970,77, produtos 1198 (sem alteração), mapeamentos 272 → 273 (a escolha manual de #1167 no passo 2).

### 19.4 Roteiro executado no Electron — NF-e B (produto sem embalagem cadastrada)

| Passo | Ação na tela | Resultado |
|---|---|---|
| 1 | Central → upload de `nfe-s30-B.xml` (1 CX de #1134, uCom = uTrib = CX, qTrib 1; #1134 é vendido em UN e não tinha embalagem) | Documento 285 PRONTA_IMPORTACAO (item identificado pelo mapeamento existente; sem revisão) |
| 2 | Finalizar Entrada → finalidade | Revenda 99%, Revenda marcada |
| 3 | Compras → Salvar → validação fiscal → confirmar | 422 `PENDENCIAS_CONVERSAO`, código `FATOR_CONVERSAO_AUSENTE`, `bloqueia_efetivacao`. Abre o modal de conversão com "Sugestão: 1 CAIXA = 1 UN" |
| 4 | Modal de conversão: **SIM** | 422 de novo; nada gravado |
| 5 | Modal de conversão: **NÃO** | 422 de novo; nada gravado |
| 6 | Cancelar e fechar a compra | Documento em EM_IMPORTACAO ("Retomar Importação") |
| 7 | Produtos → editar #1134 → "+ Apresentação" CX × 6, valor da embalagem R$ 33,54 (6 × custo atual) → Salvar | Embalagem 76 criada (`PUT /produtos/1134` 200). Custo, preço e estoque de #1134 sem alteração |
| 8 | Central → Retomar Importação → Compras | Linha: 1 CX → **6 un** (apresentação 76), unitário R$ 8,00, subtotal R$ 48,00 |
| 9 | Salvar → validação fiscal → confirmar | 200, **compra #49** |
| 10 | Repetição | `finalizar-entrada`: 409 `DOCUMENTO_JA_IMPORTADO`. `POST /compras` com o corpo completo: 400 "Esta nota já foi lançada na compra #49". Fotografia idêntica |

Fotografias dos passos 3 a 6 idênticas à anterior ao upload (compras, itens, financeiro, estoque, produtos, mapeamentos).

Compra #49: total = XML = R$ 48,00, diferença 0; Revenda; 1 item #1134 com 6 un (1 embalagem × 6, fator 6, `CENTRAL_NFE`); 1 despesa de R$ 48,00. Estoque de #1134: 24 → 30. Nenhum outro produto do cenário mudou. Mapeamentos: hash idêntico. XML: hash guardado igual ao do arquivo (`1f75702b4bc75380…`). Histórico: "Compra aberta na tela de Compras" → "Compra #49 gravada".

### 19.5 Itens de homologação da 17.9

| Item da 17.9 | Situação |
|---|---|
| 1. Embalagem cadastrada, fator alterado na tela | **Validado** (19.3: tela com fator 1, gravado 30 pelo cadastro ×10) |
| 2. Sem embalagem: recusa; depois do cadastro, grava pelo cadastro | **Validado** (19.4) |
| 3. Correção de produto concorrente com outra estação | **Não validado no Electron.** Exige duas estações gravando ao mesmo tempo; o ambiente tem uma só janela automatizada. Coberto em banco isolado por `central-nfe-sprint29-transacoes-sqlite-e2e` (5/5). Para homologar: duas estações na mesma cópia, uma corrigindo o produto da linha na Central enquanto a outra grava uma venda; conferir venda, estoque e histórico da NF-e |
| 4. Repetir o lançamento | **Validado** (19.3 passo 8, 19.4 passo 10) |

### 19.6 Regressões focadas

Executadas uma a uma (limite de 2 minutos cada), com `CDS_TEST_ISOLAR_BANCO=1`. Todas PASS:

| Arquivo | Resultado |
|---|---|
| `entrada-central-nfe-sqlite-e2e` | 5/5 |
| `central-nfe-sprint26-identificacao-efetivacao-sqlite-e2e` | 7/7 |
| `central-nfe-sprint27-protecao-produto-sqlite-e2e` | 10/10 |
| `central-nfe-sprint28-atomicidade-conversao-sqlite-e2e` | 12/12 |
| `central-nfe-sprint29-fator-conversao-sqlite-e2e` | 8/8 |
| `central-nfe-sprint29-transacoes-sqlite-e2e` | 5/5 |
| `central-nfe-edicao-linha-qtrib-sqlite-e2e` | 15/15 |
| `central-nfe-persistencia-sqlite-e2e` | 6/6 |
| `central-nfe-sem-associacao` | 6/6 |
| `fluxo-confirmacao-conversao-e2e` | 6/6 |
| `sprint28-selo-conversao` | 6/6 |
| `sprint2-confirmacao-conversao` | 19/19 |
| `rc4314-fluxo-financeiro-central` | 11 OK |
| `mip-sprint07-compras-xml-central` | 9 OK |
| `rc91-classificacao-entrada` | 16 OK |
| `miip-central-revisao` | 11 OK |

`node --check` e lint sem erros em `compras.js`, no harness e nos dois testes ajustados.

**Ocorrência na execução:** na primeira rodada, o terminal ainda tinha `DB_DIR` apontando para a cópia da homologação. `central-nfe-sem-associacao`, `fluxo-confirmacao-conversao-e2e`, `mip-sprint07` e `rc91` abriram a cópia em vez do banco de teste isolado. A inicialização do banco alterou o hash da cópia (`00D78BE1…7159E5`), mas a fotografia de negócio ficou idêntica à do fim da homologação (compras, itens, financeiro, estoque, produtos, embalagens, mapeamentos, documentos e histórico da Central). Os quatro foram repetidos sem `DB_DIR`, sobre `%TEMP%\cds-sistemas-test-db`, todos PASS. O banco real não foi envolvido.

**Banco real:** `C:\ProgramData\MercantilFiscal\dados\mercadao.db` mostra gravação às 22:22 do dia 9. Ela vem do `npm start` aberto pelo usuário em outro terminal (logs da Central até ~22:20), não desta homologação, cujo servidor registrou apenas a cópia.

### 19.7 Bloqueadores × melhorias futuras

**Bloqueadores reais:** apenas o `window.prompt()` da troca de produto (19.2), corrigido. Nenhum outro passo do roteiro impediu a entrada ou a efetivação seguras.

**Melhorias futuras (não corrigidas; não impedem a entrada segura):**
1. **Mensagem do modal de conversão para `FATOR_CONVERSAO_AUSENTE`.** O texto oferece "aceitar a sugestão 1 CAIXA = 1 UN ou continuar sem conversão", mas SIM e NÃO são recusados, e o modal reabre igual. O bloqueio é correto (nada é gravado), mas o operador não é orientado a cadastrar a embalagem do produto. Sugestão: para esse código, esconder SIM/NÃO e mostrar "Cadastre a embalagem CX de <produto> em Produtos e retome a importação".
2. **A Central não avisa antes de Compras.** O documento B foi direto para PRONTA_IMPORTACAO; a falta de fator só aparece ao gravar em Compras. Relacionado à 17.8, item 5.
3. **Mapeamento após a correção de produto.** A escolha manual de #1167 na revisão criou um mapeamento. A troca para #1165 em Compras corrige o documento e a compra, mas não esse mapeamento. A próxima NF-e do mesmo fornecedor e código tende a vir com #1167. Mapeamentos só mudam por etapa própria e rastreável, por isso fica registrado.
4. **Outros `prompt()` fora do fluxo NF-e → efetivação** (quebram no Electron do mesmo modo):
   - `compras.js` (cancelamento da NF-e de devolução);
   - `central-faturamento.js`, `faturamento.js`, `nfe-central.js`, `vendas.js` e `produtos.js` do ERP;
   - `equipamentos.js`, `central-equipamentos.js`, `laboratorio-equipamentos.js` e `configuracoes.js`;
   - no PDV: `vendas.js` e `pdv-prestacao-entrega.js`.
5. **Classificação da finalidade:** os defeitos da seção 18 continuam. Nas duas notas desta sprint (CFOP 5102) a sugestão e a opção marcada foram Revenda, coerentes.
6. Lista da Central: o nome "D&amp;D DISTRIBUIDORA…" aparece com o `&` escapado duas vezes (cosmético).
7. Pendências da 17.8 (itens 1, 2, 4, 6, 7 e 8) sem alteração.

### 19.8 Evidências

Em `%TEMP%\cds-s30\`:
- **Capturas de tela:**
  - `s30-01-pergunta-codigo-repetido.png`, `s30-02-retomada-confirmado.png`, `s30-03-politica-entrada.png`;
  - `s30-04-compras-linhas.png`, `s30-05-editar-linha0.png`, `s30-06-modal-troca-produto.png`;
  - `s30-08-doc285-conversao-pendente.png`, `s30-09-central-final.png`.
- **Fotografias:** `foto-0-antes.json` … `foto-13-pos-regressoes.json`.
- **Logs:** `electron.log`, `electron2.log` e `reg-*.txt` (regressões).

A instância Electron da homologação foi encerrada ao fim (apenas os processos com `cds-s30` na linha de comando). A cópia foi mantida para conferência.

---

## 20. Auditoria — MIIP: candidato incompatível na associação de produto (sem correção)

**Caso:** na revisão da NF-e, o item `POLPA MARACUJA 400G` (fornecedor MARTINS POLPAS LTDA - EPP, CNPJ `52…18`, cProd `1`, UN, SEM GTIN, NCM 20089900) mostra `Frango do Dia` (produto #763, código interno `1`) com 70% e "Sem campos para comparar".

**Restrições cumpridas:** nenhum código de produção, mapeamento, produto, estoque, compra ou XML alterado; banco real não aberto para escrita; sem commit. A leitura foi feita em cópia `VACUUM INTO` (`%TEMP%\cds-a31\mercadao.db`, SHA-256 `B25BE210…4D77F107`, identificação em `COPIA_AUDITORIA_MIIP_CPROD.txt`).

### 20.1 Causa comprovada

O candidato não veio de mapeamento persistido nem de nome. Veio de uma busca que comparava o **cProd do fornecedor com o código interno do CDS, no catálogo inteiro, sem filtro de fornecedor**, e rotulava o acerto como `codigo_fornecedor`.

`ProdutoRepository.buscarCandidatosUniversais`, versão do commit `ed22c31` (HEAD) e do pacote instalado (`dist/erp/win-unpacked/resources/app.asar`, 06/10/2026), linhas 245–257:

```js
if (codigoFornecedor) {
  const rowsCod = await this._helpers.all(
    `SELECT ${COLUNAS_LEITURA_JOIN} ${fromJoin}
     WHERE p.codigo = ? OR p.codigo = ?
     LIMIT 10`,
    [codigoFornecedor, String(codigoFornecedor).replace(/^0+/, '') || codigoFornecedor]
  );
  this._acumularHits(mapa, rowsCod, 'codigo_fornecedor');
}
```

Nessa mesma versão, `mapearItemCompra` e `ItemIdentificavelDTO` também usavam `item.codigo` como código interno quando não havia um explícito. Com cProd `1`, qualquer produto cujo `produtos.codigo` fosse `1` virava candidato para qualquer fornecedor.

**Rastro, do XML à tela (cópia de auditoria):**

| Etapa | Evidência |
|---|---|
| XML | doc 264 (16/09), item 0: cProd `1`, `POLPA MARACUJA 400G`, SEM GTIN, UN |
| Resposta MIIP gravada (`parse_json` → `miip_resultado`) | candidato #763, `motor_mubc`, scoreTotal 70, MEDIA, evidências `codigo_fornecedor` + `unidade_diff`; decisão `criar_novo`, nível BAIXA, motivos `score_baixo_cadastro`, `score_abaixo_80`, `score_70`, precisaCadastro |
| Mapeamento | `miip_associacoes`: 0 linhas para cProd `1`, para o CNPJ do fornecedor ou para o produto #763 |
| Produto #763 | código `1`, KG, sem GTIN e sem NCM, criado em 31/07/2026; identificadores PLU `1` e INTERNO `1` |
| Tela | 70% exibido direto do score bruto; comparação sem linhas (20.4) |

**Linha do tempo do mesmo fornecedor** (todas com o item cProd `1` = POLPA): doc 39 (29/07, antes de existir o #763) sem candidato; docs 179 (05/08) e 264 (16/09) com #763 a 70%; doc 70 cancelado. Os docs 179 e 264 seguem EM_REVISAO.

**Por que o candidato continua aparecendo:** o resultado MIIP fica congelado no documento. `CentralProcessamentoService.processar` reutiliza `parse_json`/`miip_resumo_json` ("Processamento já existente — resultado reutilizado") salvo `forcarReprocessamento`. `GET /:id/payload-compra` (`CentralComprasBridgeService.montarPayloadAbrirCompra` → `_obterPayloadParsePersistido`) e a sessão de revisão (`CentralRevisaoPersistenteService`) entregam esse resultado sem reidentificar. Além disso, o pacote instalado ainda contém a busca defeituosa.

### 20.2 Regra de pontuação (heurística, não probabilidade)

`MotorUniversalBuscaCandidatos` soma pesos fixos por evidência e limita a 0–94. Não há calibração estatística: o "70%" é um escore aditivo exibido como porcentagem.

| Evidência | Peso |
|---|---|
| gtin_exato / codigo_fornecedor / codigo_interno / plu / gtin_parcial | 90 / 82 / 80 / 78 / 68 |
| descricao_base / descricao_token (máx. 5) / sinonimo | 35 / 8 cada / 6 |
| marca / ncm / cest | 12 / 10 / 6 |
| unidade igual / diferente | +5 / −12 |
| embalagem igual / diferente | +4 / −6 |

Faixas: ALTA ≥ 80, MEDIA ≥ 50, BAIXA abaixo. **Caso real: 82 (`codigo_fornecedor`) − 12 (UN × KG) = 70, MEDIA.**

Três pontos permitiram exibir um candidato sem evidência mínima:
1. **Nenhuma penalidade por ausência de nome.** Zero tokens em comum não reduz o escore.
2. **Corte de 25 ignorado para "motivo forte"** (`MotorUniversalBuscaCandidatos.js:332`): candidatos com `codigo_fornecedor`, `codigo_interno`, `plu`, `gtin_*` nunca são descartados.
3. **A barreira de compatibilidade não foi aplicada.** `ProductCompatibilityGuard` (`IDENTIFICADORES_FORTES`, linha 15) considera `codigo_fornecedor` identificador forte e devolve "compatível" antes de comparar tipo de produto, NCM e unidade. POLPA × FRANGO passou sem avaliação.

A decisão final não vinculou automaticamente (`criar_novo`, BAIXA), mas a tela mostrou o candidato como sugestão com 70%.

### 20.3 Isolamento por fornecedor

- **Mapeamentos:** `MotorAssociacaoFornecedor` → `MiipAssociacoesRepository.buscarPorFornecedorCodigo` filtra `fornecedor_cnpj = ? AND codigo_fornecedor = ? AND status = 'ativa'`. Isolamento correto; nenhum mapeamento antigo envolvido.
- **Contaminação:** não houve vazamento de outro fornecedor nem de consulta anterior. O cruzamento era estrutural (a consulta global acima). O estado por instância do MUBC (`_ultimoDiagnostico`) é só diagnóstico.
- **Seleção e ordenação:** candidatos ordenados pelo escore aditivo; o #763 era o único, portanto ranking 1.
- Na consulta da auditoria só foram lidos dados de produto e documento; nenhum dado pessoal foi necessário.

### 20.4 Tela "Sem campos para comparar"

O módulo de comparação `frontend/erp/js/miip-central-revisao-inteligente.js` (`window.MiipRevisaoInteligente`, `montarComparacaoVisual`) **nunca é carregado**. Os manifestos lazy de `frontend/erp/js/app.js` (`compras`, linha 17; `central-entradas`, a partir da linha 18) incluem `miip-central-revisao.js`, mas não o módulo inteligente; o marcador `application/cds-lazy` do `index.html` não é executado. Sem ele, `intel()` em `miip-central-revisao.js` retorna nulo, a barra usa o score bruto e `renderLinhasComparacao` (linha 176) mostra "Sem campos para comparar." Igual no HEAD e no pacote.

### 20.5 Estado da árvore de trabalho (não commitado)

Alterações já presentes na árvore, não feitas nesta auditoria e ainda sem commit:
- `ProdutoRepository.js` não tem mais a busca global por cProd;
- `mapearItemCompra.js` e `ItemIdentificavelDTO.js` não transformam mais cProd em código interno.

Lacunas que permanecem mesmo com essas alterações:
1. **Política V2** (`MiipIdentificacaoV2Policy.js`, não rastreado; ausente no pacote): `ehMatchNome` (linha 147) aceita qualquer candidato cujo motor case com `/similar|synonym|mubc|canonical/`. O candidato gravado no doc 264, reaplicado à política, resulta em `sugerir` (teste `todo` em 20.6).
2. **Manifesto lazy** sem o módulo de comparação (20.4).
3. `ProductCompatibilityGuard` continua tratando `codigo_fornecedor` como forte sem exigir escopo de fornecedor.
4. O mock de `tests/miip/motor-mubc.test.js` ainda reproduz o comportamento antigo (`codigo_fornecedor` = `p.codigo`).

### 20.6 Testes isolados

Arquivo novo: `tests/miip/auditoria-miip-cprod-candidato-incompativel.test.js`. Usa `MiipService` com o pipeline padrão e a política V2, os motores reais de código de barras, fornecedor e MUBC, e os repositórios reais sobre SQLite em memória. CNPJs fictícios. O #763 é reproduzido com PLU `1` e INTERNO `1`.

| Caso | Resultado |
|---|---|
| Caracterização: busca antiga (cProd = `produtos.codigo`) produz 82 − 12 = 70, MEDIA, `[codigo_fornecedor, unidade_diff]` | PASS (reproduz o doc 264) |
| Barreira de compatibilidade não avalia quando o motivo é `codigo_fornecedor` | PASS (confirma o desvio) |
| POLPA cProd 1, fornecedor de polpas, sem GTIN, sem mapeamento | PASS: Frango não é candidato; `criar_novo` |
| Outro fornecedor com cProd 1 mapeado | PASS: vincula só para ele; a polpa não recebe o produto dele nem o Frango |
| Mapeamento persistido do fornecedor errado apontando para o Frango | PASS: não contamina a polpa |
| Nome e unidade incompatíveis, mesmo NCM | PASS: não sugerido |
| Controle: nome parecido (Polpa de Goiaba) | PASS: só sugestão, nunca vínculo |
| Duas consultas seguidas na mesma instância | PASS: sem herança de candidato |
| `todo` — V2 não deve sugerir candidato MUBC sem evidência de nome | falha hoje: retorna `sugerir` |
| `todo` — manifestos devem carregar o módulo de comparação antes da revisão | falha hoje |

Em todos os casos aprovados vale a garantia pedida: nenhum vínculo automático, candidato ou "produto encontrado" resulta só da coincidência de cProd.

Execução: `node --test` com `CDS_TEST_ISOLAR_BANCO=1` e `DB_DIR` vazio → 10 testes, 8 PASS, 0 falhas, 2 `todo`. A inicialização de logs abriu apenas o banco de teste isolado (`%TEMP%\cds-sistemas-test-db`). Regressões focadas: `motor-mubc`, `miip-v2-sprint26-identificacao-simples` (17), `product-compatibility-guard`, `faca-passa-fio-compatibility`, todas sem falhas.

### 20.7 Correção mínima recomendada (sprint posterior)

1. **Publicar a remoção da busca global por cProd** já presente na árvore (`ProdutoRepository`, `mapearItemCompra`, `ItemIdentificavelDTO`): commit e novo pacote. Enquanto o pacote de 06/10 estiver instalado, a falha continua para qualquer NF-e nova.
2. **`ProductCompatibilityGuard`:** retirar `codigo_fornecedor` de `IDENTIFICADORES_FORTES`, ou aceitá-lo só quando vier do motor de associação com CNPJ conferido. No MUBC, tirar o mesmo motivo da exceção ao corte de 25.
3. **Política V2, `ehMatchNome`:** exigir evidência real de nome (`descricao_base`/`descricao_token`/`sinonimo`) em vez de aceitar qualquer candidato do MUBC. Converte o `todo` correspondente em teste obrigatório.
4. **Manifestos de `app.js`:** incluir `/erp/js/miip-central-revisao-inteligente.js` antes de `/erp/js/miip-central-revisao.js` em `compras` e `central-entradas`.
5. **Documentos já gravados (179 e 264):** reprocessar com `forcarReprocessamento` em etapa própria e rastreável, depois do novo pacote. Não há mapeamento a corrigir.
6. Atualizar o mock de `tests/miip/motor-mubc.test.js` para não codificar o comportamento antigo.

**Nenhum código de produção alterado nesta auditoria.** Único arquivo novo: o teste de 20.6. Esta seção foi acrescentada ao relatório. Sem commit.

---

## 21. Sprint 3.1 — Associação incorreta por cProd e candidatos MIIP

**Resultado:** o código do fornecedor (cProd) não é mais tratado como código interno do CDS em nenhum ponto da identificação. Candidatos sem semelhança real de nome não são mais sugeridos. O módulo de comparação passa a ser carregado; se faltar, a tela avisa em vez de mostrar uma comparação vazia. Os documentos 179 e 264 **não foram alterados**: há um procedimento reversível, ensaiado numa cópia, para rodar depois de publicar o pacote.

A hierarquia V2 não mudou: código de barras → mapeamento CNPJ + cProd → código interno explícito → nome. Nenhum motor novo. O classificador de finalidade da NF-e (seção 18) não foi tocado.

### 21.1 Arquivos alterados

| Arquivo | Alteração |
|---|---|
| `backend/motores/miip/repositories/ProdutoRepository.js` | Sem edição nesta sprint. A árvore já não tem a busca global `WHERE p.codigo = cProd` (alteração anterior, sem commit, conferida no `git diff`). O mesmo vale para `mapearItemCompra.js` e `ItemIdentificavelDTO.js`. |
| `backend/motores/miip/engines/mubc/MotorUniversalBuscaCandidatos.js` | Peso e evidência `codigo_fornecedor` removidos. O MUBC não usa mais `dto.codigo` como código interno quando há cProd; só um `codigoInterno` explícito. `codigo_fornecedor` saiu da exceção ao corte de 25. Nome que coincide só em medida ou unidade (`400G`, `KG`, `CAIXA`) gera a evidência `descricao_medida`, e não `descricao`. |
| `backend/motores/miip/utils/ProductCompatibilityGuard.js` | `codigo_fornecedor` saiu de `IDENTIFICADORES_FORTES`. Agora só código de barras exato, código interno e PLU dispensam a checagem de compatibilidade. |
| `backend/motores/miip/core/MiipIdentificacaoV2Policy.js` | `ehMatchNome` exige a evidência `descricao` (palavra descritiva em comum) ou `sinonimo`. Ter vindo do MUBC, ou coincidir só em cProd, NCM, marca, CEST, unidade ou medida, não basta. Sem essa evidência a linha fica pendente (`criar_novo`) e sem candidato. |
| `frontend/erp/js/app.js` | `/erp/js/miip-central-revisao-inteligente.js` incluído antes de `/erp/js/miip-central-revisao.js` nos manifestos `compras` e `central-entradas`. |
| `frontend/erp/js/miip-central-revisao.js` | O valor aparece como "Semelhança X/100" com o aviso "Não é a probabilidade de ser o mesmo produto" (antes era "70%"). Se o módulo de comparação não estiver disponível, mostra o alerta "Comparação indisponível… Recarregue a tela (F5) antes de confirmar o produto" no lugar da barra e das linhas. |
| `scripts/homologacao/sprint31-reidentificar-miip-documentos.js` (novo) | Procedimento reversível para refazer a identificação dos docs 179 e 264 (21.4). |
| `tests/miip/auditoria-miip-cprod-candidato-incompativel.test.js` | Reescrito: casos obrigatórios da sprint; os dois `todo` da seção 20 viraram testes. |
| `tests/miip/sprint31-comparacao-revisao-ui.test.js` (novo) | Carrega o lazy loader real de `app.js` e a tela de revisão. |
| `tests/miip/motor-mubc.test.js`, `tests/miip/product-compatibility-guard.test.js` | Mock e expectativas antigas (cProd como código forte) atualizados para a regra nova. |

Falha de download de script: o lazy loader já rejeita o carregamento da página inteira, e a revisão não é montada. O teste de UI cobre esse caso.

### 21.2 Testes obrigatórios

Execução com `node --test`, `CDS_TEST_ISOLAR_BANCO=1` e `DB_DIR` vazio. SQLite em memória, CNPJs fictícios, repositórios e motores reais com a política V2.

| Caso | Resultado |
|---|---|
| POLPA MARACUJA 400G, cProd 1, fornecedor de polpas, sem GTIN: nunca sugere o Frango do Dia; linha pendente | PASS |
| Outro fornecedor com cProd 1: Frango não aparece | PASS |
| Mapeamento válido CNPJ + cProd do próprio fornecedor: vínculo automático ao produto mapeado | PASS |
| Mapeamento de outro fornecedor não vaza; mapeamento errado apontando para o Frango não contamina | PASS |
| Nome semelhante (Polpa de Maracujá 400g): sugestão por nome, sem vínculo automático | PASS |
| Nome incompatível com mesmo NCM: linha pendente | PASS |
| Coincidência só de medida (Geleia Morango 400G): linha pendente | PASS |
| Candidato gravado no doc 264 reaplicado à política V2: `criar_novo`, sem sugestão | PASS |
| NCM + unidade, marca + CEST, medida + unidade ou só similaridade não sugerem | PASS |
| Consultas seguidas não herdam candidato | PASS |
| Manifestos: módulo de comparação antes da revisão (Compras e Central) | PASS |
| Tela: linhas Descrição/NCM/Unidade/Fornecedor, "Semelhança 62/100", aviso de que não é probabilidade, sem "62%" e sem "Sem campos para comparar" | PASS |
| Módulo carregado sem registrar a API: "Comparação indisponível", sem barra | PASS |
| Download do módulo falha: carregamento rejeitado, revisão não montada | PASS |
| Tela real no Electron com os docs 179/264 | **BLOCKED**: abrir e conduzir o Electron por automação foi bloqueado pela revisão automática (seção 20). A validação da tela foi feita com o código real de `app.js` e `miip-central-revisao.js` em VM. Falta a conferência visual manual após o novo pacote. |

Totais: `auditoria-miip-cprod-candidato-incompativel` 21/21; `sprint31-comparacao-revisao-ui` 6/6; `miip-v2-identificacao-hierarquia` 13/13; `miip-v2-sprint26-identificacao-simples` 17/17; `motor-mubc` e `product-compatibility-guard` PASS. `node --check` e o linter sem erros em todos os arquivos alterados.

### 21.3 Regressões MIIP e Central

53 arquivos, cada um com no máximo 2 minutos: **49 PASS, 4 FAIL**. Nenhuma das falhas vem desta sprint.

| Arquivo | Falha | Causa |
|---|---|---|
| `tests/miip/miip-rc94-ux.test.js` | fallback de `motivosSemCandidatoPadrao` | Testa só o módulo de comparação, que não foi alterado; falha anterior. |
| `tests/central-entradas/central-entradas-sprint2.test.js` | PATCH de status, histórico e filtro | Anterior; não envolve identificação. |
| `tests/compras/central-nfe-apresentacao-compra.test.js` (21 PASS, 4 FAIL) | `ReferenceError: extrairOrigemLinhaNfeCompra is not defined` dentro do teste | Defeito do próprio teste; anterior. |
| `tests/compras/central-nfe-produto-existente-novo-sqlite-e2e.test.js` (9 PASS, 2 FAIL) | espera `PENDENCIAS_CONVERSAO`, recebe `LINHA_CENTRAL_NAO_IDENTIFICADA` | Comportamento desde a Sprint 2.2, já previsto em 10.5. |

Passaram, entre outros: todos os e2e Central NF-e das sprints 2.6 a 2.9, `edicao-linha-qtrib` (15), `miip-aprendizado-governanca` (10), `central-nfe-sem-associacao` (6), `sprint2-confirmacao-conversao` (19), `rc11-4-lazy-erp`, `finalizar-entrada`, `rc376-revisao-inteligente`, `revisao-persistente`.

### 21.4 Documentos já afetados (179 e 264)

**Nada foi alterado no banco real nem nos documentos.** O resultado MIIP desses documentos está congelado em `parse_json` e `miip_resumo_json` (20.1). `forcarReprocessamento` refaz o parse inteiro e muda o status, por isso não foi usado.

`scripts/homologacao/sprint31-reidentificar-miip-documentos.js`:
- **Simulação por padrão.** A identificação roda numa cópia temporária do banco (`VACUUM INTO`), com o código publicado.
- **Gravação** só com `--aplicar --confirmo-reidentificacao`. Antes de gravar, faz cópia de segurança do banco ao lado do log e confere numa única transação que o documento não mudou desde a simulação.
- **Altera só** o resultado e a sugestão MIIP dos itens e o resumo MIIP do documento. Registra uma linha de histórico `[sprint31-reidentificacao]` com o mesmo status.
- **Preserva:** XML, status, compra, histórico anterior, sessões de revisão e decisões manuais.
- **Pula:**
  - documento com compra efetivada ou com status fora de revisão/pronta;
  - item com produto já escolhido;
  - item com decisão de revisão;
  - item com conversão confirmada;
  - item sem mudança no resultado.
- **Reversão:** `--reverter <log> --confirmo-reidentificacao`. Restaura o conteúdo anterior (verificado por hash), o `updated_at` e remove a própria linha de histórico.

**Simulação na cópia de ensaio** (cópia da cópia de auditoria; fornecedor `52…18`):

| Doc | Itens alterados | Antes | Depois |
|---|---|---|---|
| 179 (EM_REVISAO, sem compra) | 7 de 8 (TAMARINDO já estava sem candidato) | candidatos #763, #744, #755, #721, #686, #746, #761; ABACAXI com sugestão #721 (87) | todos pendentes, sem candidato |
| 264 (EM_REVISAO, sem compra) | 6 de 6 | candidatos #763, #744, #694, #686, #746, #713, todos com 70 | todos pendentes, sem candidato |

Todos os candidatos removidos eram incompatíveis com polpas de fruta: Frango do Dia, Rabada de Boi, Tomate, Linguiça Frango Aurora, Bife Amaciado kg, Ração Dog Chow, Calabresa Seara, Carneiro, Goiaba (KG). O catálogo não tem produto "POLPA", então pendente é o resultado correto.

**Ensaio de gravação e reversão na cópia:**

| Verificação | Após aplicar | Após reverter |
|---|---|---|
| XML (hash) | inalterado | inalterado |
| Status / compra | EM_REVISAO / nenhuma | EM_REVISAO / nenhuma |
| Decisões de revisão (hash) | inalterado | inalterado |
| Resultado MIIP (hash `parse_json` / resumo) | alterado; candidatos "–" | idêntico ao inicial |
| Resumo MIIP | 179: 0 auto, 0 sugestão, 8 pendentes; 264: 0/0/6 | 179: 0/1/7; 264: 0/0/6 (inicial) |
| Histórico | +1 linha (179: 7, 264: 12) | volta a 6 e 11 |
| `updated_at` | atualizado | restaurado |
| Compras / mapeamentos / soma de estoque | 47 / 272 / 69930,77 | 47 / 272 / 69930,77 |

A fotografia após a reversão é idêntica, byte a byte, à inicial. Documento com compra efetivada (doc 283, IMPORTADA, compra 34): o script recusa (`PULAR (tem_compra_34)`).

**Como executar, só depois de instalar o pacote com esta correção:**
1. Fechar o sistema nos caixas e no ERP.
2. Simular:
   `node scripts/homologacao/sprint31-reidentificar-miip-documentos.js --banco "C:\ProgramData\MercantilFiscal\dados\mercadao.db" --documentos 179,264`
3. Conferir a lista de itens.
4. Repetir o comando com `--aplicar --confirmo-reidentificacao`.
5. Guardar o caminho do log impresso.
6. Para desfazer: `--reverter "<log>" --confirmo-reidentificacao`.

### 21.5 Pendências e limitações

1. **Publicação:** nada disto chega ao pacote de 06/10. É preciso commit e novo pacote, incluindo as alterações anteriores ainda sem commit em `ProdutoRepository`, `mapearItemCompra` e `ItemIdentificavelDTO`. Até lá, NF-e novas continuam sujeitas à falha.
2. **Conferência visual no Electron:** BLOCKED (21.2). Fazer manualmente após o novo pacote, abrindo um item do doc 264.
3. **Acentos na busca por nome:** `UPPER` do SQLite não converte letras acentuadas. Nomes cadastrados com acento podem não ser encontrados pela busca por nome. Observado, não corrigido nesta sprint.
4. Os produtos #666, #665, #219, #912 e #763, os saldos e os mapeamentos não foram alterados.

**Banco real aberto só para leitura (cópias por `VACUUM INTO`). Documentos 179 e 264 não modificados. Sem commit.**

---

## 22. Sprint 3.2 — Dashboard Comercial removido de "Conferir produtos da nota"

**Resultado:** a tela de revisão abre direto no produto da nota e nas ações. O Dashboard Comercial e os demais blocos comerciais saíram da tela. O fluxo de identificação, vínculo, cadastro, conversão, retomada e envio para Compras continua igual. Nenhum cálculo comercial, API, serviço ou dado foi alterado; o módulo `miip-central-revisao-inteligente.js` ficou intacto.

### 22.1 O que saiu da tela

| Bloco | Onde ficava | Situação |
|---|---|---|
| Dashboard Comercial (Impacto Financeiro, Resumo Comercial, maior aumento/redução) | topo | removido |
| Cartões Produtos, Produtos Novos, Custo Aumentou/Reduziu, Sem Alteração, Sem Cadastro | topo | removidos |
| Precisão desta importação, Tempo de processamento | topo | removidos da tela. A precisão continua no resultado entregue a Compras (`estatisticas.precisao`). |
| Filtros Todos/Alterados/Novos/Sem Cadastro/Divergentes | topo | removidos; a lista não aplica mais filtro comercial |
| Comparador de custos (custo, preço, margem, preço sugerido) | topo | removido |
| Sugestão de preço (preço, margem, preço sugerido) | detalhes do item | removida |
| Barra comercial do rodapé e resumo comercial da tela final | rodapé / tela final | removidos |
| Aviso "Resumo: N produtos · N novos · N custo alterado…" ao concluir | notificação | removido; os mesmos dados seguem em `estatisticas.inteligenciaComercial` para Compras |

**Filtro salvo antes:** a preferência de filtro fica no navegador (`localStorage`). Sem os botões, um filtro antigo como "Alterados" esconderia itens pendentes sem que o operador pudesse desfazer. Por isso a lista deixou de aplicar o filtro. O teste 22.3 cobre esse caso.

**Mantidos:** lista de itens com ordenação e prioridade; pergunta "É este / Escolher outro / Vincular produto / Cadastrar produto"; "Ver detalhes" com a comparação MIIP V2, os identificadores, o Histórico Comercial e as Últimas Compras (painéis recolhíveis, só leitura, usados para conferir custo e unidade); confirmação de conversão; Ignorar item; Modo Foco; atalhos; ações do documento.

### 22.2 Disposição da tela

- **Topo:** os blocos comerciais deram lugar a uma faixa de uma linha (37 px em 1366×768) com Itens da nota, Associados automaticamente, Precisam confirmação e Precisam cadastro.
- **Telas a partir de 993 px:** a lista e o painel do item ocupam toda a altura restante, cada um com rolagem própria, e a página não rola como um todo. Em 1366×768 o botão "É este" aparece sem rolar.
- **Telas estreitas:** mantêm o empilhamento de antes, com a página rolando.
- **Conversões de unidade:** o bloco saiu do pé da página e foi para o painel do item, logo abaixo das ações.
- **Tela final ("Pronto para finalizar a entrada"):** a coluna vazia da lista some e o painel ocupa a largura toda.

### 22.3 Arquivos alterados

| Arquivo | Alteração |
|---|---|
| `frontend/erp/js/miip-central-revisao.js` | Faixa de contagens no lugar de `renderResumoTopo` com dashboard. Removidos os renderizadores do dashboard, filtros, comparador, sugestão de preço e barra comercial, além do clique dos filtros, do filtro na lista, do resumo comercial da tela final e do aviso comercial ao concluir. O contêiner de conversões foi para o painel do item. |
| `frontend/css/miip-central-revisao.css` | Removidos os estilos dos blocos retirados. Novos estilos da faixa de contagens, das alturas com rolagem própria (só em tela larga), da coluna da lista que some quando vazia e do bloco de conversões dentro do painel. |
| `tests/miip/sprint32-revisao-sem-dashboard-ui.test.js` (novo) | Abre a revisão real por `MiipCentralRevisao.iniciar`, com jQuery mínimo e API simulada. |

Sem alteração em backend, APIs, `miip-central-revisao-inteligente.js`, `compras.js`, `central-entradas.js`, regras fiscais, preços, margens ou estoque.

### 22.4 Testes

**Teste automatizado novo:** 10/10 PASS.

| Caso | Resultado |
|---|---|
| Revisão abre sem Dashboard Comercial, cartões, precisão, tempo, filtros, comparador ou sugestão de preço | PASS |
| Topo mostra só as quatro contagens da conferência | PASS |
| Lista mostra todos os pendentes mesmo com o filtro "Alterados" salvo antes | PASS |
| Detalhe do item: produto da nota, "É este", "Escolher outro" e comparação de campos | PASS |
| Item sem candidato: "Vincular produto" e "Cadastrar produto" | PASS |
| Retomada: item já decidido não volta para a lista | PASS |
| Confirmação de conversão no painel do item | PASS |
| Tela final sem resumo comercial | PASS |
| Concluir mantém `ABRIR_COMPRA` e entrega os dados comerciais a Compras | PASS |
| Funções do módulo comercial continuam disponíveis | PASS |

**Controle por mutação:** uma cópia temporária da tela, com "Impacto Financeiro" e o filtro da lista reinseridos, faz 3 desses testes falharem. Os testes detectam a regressão.

**Ensaio no navegador:** página temporária fora do repositório, servida por um servidor estático local só de leitura. Ela carrega o jQuery, o Bootstrap, os CSS do ERP e os dois scripts reais, com a API simulada. O cadastro de produto é simulado, porque o formulário não é objeto desta sprint.

| Passo | Resultado |
|---|---|
| Abrir: nenhum texto do dashboard; topo com 37 px; 3 itens na lista | PASS |
| "É este" no refrigerante: decisão CONFIRMAR, produto 901 gravada; avança para o próximo | PASS |
| Conversão da goiaba: SIM gravado, "Confirmado no servidor" | PASS |
| "É este" na goiaba: CONFIRMAR, produto 904 | PASS |
| Recarregar (F5): retomada com 2 decisões; só a polpa de maracujá pendente; conversão continua confirmada; "Revisão retomada do ponto em que parou" | PASS |
| "Vincular produto": busca abre e filtra o catálogo | PASS |
| "Cadastrar produto": cadastro abre; ao salvar grava CADASTRAR, produto 950, e mostra "Produto cadastrado e vinculado ao item da NF." | PASS |
| Tela final sem resumo comercial; "Finalizar Entrada" habilitado | PASS |
| Finalizar: `ABRIR_COMPRA`, 4 itens com produtos 950/901/902/904, revisão fechada sem resto de modal | PASS |
| Layout em 1366×768: página sem rolagem, painel do item com rolagem própria, "É este" visível sem rolar | PASS |

**Regressões MIIP, Central e Compras:** mesmos 53 arquivos da seção 21.3 mais o teste novo. Resultado: 50 PASS e 4 FAIL. As 4 falhas são as mesmas da Sprint 3.1, com as mesmas contagens: `miip-rc94-ux`, `central-entradas-sprint2`, `central-nfe-apresentacao-compra` (4) e `central-nfe-produto-existente-novo` (2). Entre os aprovados:
- e2e Central NF-e das sprints 2.6 a 2.9;
- `edicao-linha-qtrib` (15);
- `entrada-central-nfe-sqlite-e2e`;
- `fluxo-confirmacao-conversao-e2e`;
- `sprint2-confirmacao-conversao` (19);
- `finalizar-entrada`;
- `revisao-persistente`;
- `rc376-revisao-inteligente` (cálculos do dashboard e do comparador);
- `rc11-4-lazy-erp`;
- `sprint31-comparacao-revisao-ui`.

Extras: `cadastro-transacao-backfill` (7) e `cfop-padrao-empresa-cadastro-nfe` (2) passaram. `correcao-nf-margem-01` deu 24 PASS e 4 FAIL, todas em `compras.js`, por exemplo `calcularMargemEntradaManualCompra is not defined`. Esse arquivo já tinha alterações sem commit antes da sprint e não foi tocado nela; a falha é independente desta mudança.

**Outras telas:** o Dashboard Comercial, os filtros e o comparador só existiam nesta tela. Compras abre a mesma revisão e recebe a mesma tela simplificada. Os cálculos continuam no módulo inteligente, coberto pelo `rc376-revisao-inteligente`.

| Verificação | Resultado |
|---|---|
| Tela real no Electron com documento real | **BLOCKED**: não abri o Electron nem o banco real (restrição da sprint; a automação do Electron já tinha sido bloqueada pela revisão automática na seção 20). Fazer a conferência visual após o novo pacote. |

### 22.5 Pendências

1. Publicar junto com a Sprint 3.1: commit e novo pacote.
2. Conferir no Electron, com um documento EM_REVISAO, que a tela abre sem o dashboard.

**Nenhum dado real alterado. Sem commit.**

---

## 23. Sprint 3.3 — Exibição do produto como "NOME — MARCA"

**Resultado:** o Cadastro de Produtos e o PDV mostram o produto como `NOME — MARCA` (ex.: `Molho de Alho 150 ml — Gota`), pela mesma função. Só a apresentação mudou: o nome gravado, a busca, os preços, o estoque, os atalhos, o carrinho salvo, a venda enviada ao servidor, a NFC-e e os documentos continuam com o nome original. Sem alteração em backend, banco, cadastros, marcas, regras fiscais ou mapeamentos; sem migração.

### 23.1 Regra

A função comum é `CdsBuscaProdutoTexto.formatarNomeProdutoComMarca(produto | nome, marca?)` em `frontend/shared/js/buscaProdutoTexto.js`. Ela devolve texto puro, e cada tela faz o próprio escape de HTML. A marca vem de `marca`, `marca_nome` ou `marca.nome`, conforme o formato devolvido por cada API.

1. Sem marca: mostra só o nome. Marcas que funcionam como "sem marca" (`-`, `NA`, `N/A`, `SEM MARCA`, `S/M`, `NENHUMA`, `NÃO INFORMADA`) contam como vazias. A função nunca escreve "SEM MARCA" por conta própria.
2. Marca já presente no nome: mostra só o nome. A comparação ignora maiúsculas, acentos, pontuação e espaços extras, e considera palavras inteiras **em qualquer posição** do nome, não só no final.
3. Nos demais casos: `nome + " — " + marca`.

**Por que "em qualquer posição":** na cópia de auditoria (somente leitura), 1198 produtos, 251 deles com marca:

| Situação | Produtos |
|---|---|
| Marca já aparece no nome (no início, no meio ou no fim) | 211 |
| Marca acrescentada (`NOME — MARCA`) | 40 |
| Sem marca (só o nome) | 947 |
| Marca duplicada / divergência PDV × Cadastro | 0 / 0 |

A maioria dos nomes traz a marca no meio, por exemplo "Desinfetante **Unic Limp** fragrância Citros 2 L" com a marca Unic Limp. Se só o final fosse verificado, 211 nomes passariam a mostrar a marca duas vezes. A regra também aceita, sem duplicar, um nome que já chegue formatado da API, e aplicá-la de novo sobre a própria saída não muda o texto.

**Observação de cadastro (não corrigida, conforme restrição):** quando a marca cadastrada difere da grafia usada no nome, as duas aparecem. Exemplo: "Tempero Chimichurri 40g Chef Nobre — Nobre cheff". Corrigir exige alterar marcas, o que não fazia parte desta sprint.

### 23.2 Onde foi aplicado

| Tela | Pontos |
|---|---|
| PDV: busca e autocomplete | Nome da sugestão. O selo de marca separado, que ficava antes do nome, saiu; a marca agora vem depois do nome. |
| PDV: consulta F1 | Tabela, acordeão por categoria e agrupamento por categoria (função `nomeExibicaoProdutoConsultaPdv`, agora ligada à regra comum) |
| PDV: itens da venda | Nome da linha e texto alternativo da miniatura. A marca vem do catálogo pelo id do produto; `item.nome` continua com o nome original. |
| PDV: diálogos e avisos | Diálogo de quantidade, escolha peso/unidade, falta de NCM, avisos "adicionado ao carrinho" e "removido do carrinho" |
| Produtos (ERP) | Listagem em árvore e plana (`[PLU] NOME — MARCA`), detalhes do produto, título de Ajustar Estoque, histórico, relatório de estoque, estoque baixo, vencimentos e lista de produtos da promoção. Quando a API não traz a marca, como em `GET /produtos/:id`, ela é tirada da listagem já carregada. |

**Mantido com o nome original, de propósito:**
- campo Nome do formulário e o que é salvo;
- etiqueta de gôndola impressa;
- envio à balança (MGV);
- cupom, NFC-e (`xProd`), DANFE e XML;
- venda e entrega enviadas ao servidor;
- carrinho salvo no navegador;
- mensagens de "Saldo insuficiente…", que são validações usadas pelos motores de estoque;
- botão "copiar nome" do diálogo de NCM, que copia o nome original para colar na busca do NCM.

### 23.3 Arquivos alterados

| Arquivo | Alteração |
|---|---|
| `frontend/shared/js/buscaProdutoTexto.js` | Novas `obterMarcaProduto` e `formatarNomeProdutoComMarca`, exportadas em `CdsBuscaProdutoTexto` |
| `frontend/shared/js/pdvBuscaProduto.js` | `nomeExibicaoProdutoPdv` usa a regra comum (antes punha a marca na frente). O autocomplete mostra o nome formatado sem o selo separado. `renderizarItemAutocomplete` exportada em `_test`. |
| `frontend/pdv/js/pdv.js` | `nomeExibicaoProdutoConsultaPdv` usa a regra comum, com a marca do catálogo para os itens do carrinho. Aplicada nos itens da venda, nos diálogos e nos avisos. A cópia do NCM usa o nome original. |
| `frontend/css/pdv.css` | Removido o estilo `.pdv-autocomplete-marca`, que ficou sem uso |
| `frontend/erp/js/produtos.js` | Nova `nomeExibicaoProdutoErp`. `formatarNomeProdutoComPlu` e os pontos de exibição da tabela 23.2 passam a usá-la. O arquivo já tinha alterações sem commit, que não foram tocadas. |
| `tests/pdv/pdv-busca-marca-nome.test.js` | Atualizado para o formato `NOME — MARCA` e para a ausência do selo separado |
| `tests/produtos/sprint33-nome-marca-exibicao.test.js` (novo) | Os 10 casos exigidos pela sprint |

### 23.4 Testes

**Teste novo:** 9 casos, cobrindo os 10 itens exigidos (busca por nome e por marca no mesmo caso), todos PASS. O teste antigo atualizado deu 3 PASS.

| # | Caso | Resultado |
|---|---|---|
| 1 | Produto com marca: `TRENA 5 METROS — STARRETT` | PASS |
| 2 | Produto sem marca (vazia, nula ou marcador "sem marca"): só o nome | PASS |
| 3 | Marca já no final do nome (`… Q-odor`): sem repetição | PASS |
| 4 | Marca no início ou no meio (`Unic Limp`, nome com "—"): sem repetição. Parte de palavra não conta (`TIOZINHO` × `TIO`) | PASS |
| 5 | Maiúsculas, acentos e espaços extras (`TRESEMME` × `TRESemmé`) | PASS |
| 6 | Busca pelo nome original encontra o produto (Cadastro e PDV) | PASS |
| 7 | Busca pela marca, pelo PLU e pelo código de barras encontra o produto | PASS |
| 8 | PDV: autocomplete com id, preço e indicação de estoque iguais aos de antes; item do carrinho guarda o nome original e não é alterado | PASS |
| 9 | Nenhuma marca duplicada; aplicar a regra de novo não muda o texto | PASS |
| 10 | Produtos (ERP) e PDV dão o mesmo texto; nome do formulário e etiqueta continuam com o nome original | PASS |

**Controle por mutação** (fonte alterado só em memória):

| Mutação | Casos que falharam |
|---|---|
| Sem deduplicação | 4 |
| Comparar só o final, com diferença de maiúsculas | 2 |
| Marca na frente do nome | 5 |
| Sem filtro de marcas "sem marca" | 1 |

**Catálogo real:** a regra foi aplicada aos 1198 produtos da cópia de auditoria, somente leitura (resultado na tabela 23.1): nenhuma duplicação e nenhuma divergência entre PDV e Cadastro.

**Regressões:** 102 arquivos de teste que leem os arquivos alterados, cada um com limite de 2 minutos. Resultado: 90 PASS e 12 FAIL. Os 12 falham com as **mesmas contagens** numa cópia do repositório com os 5 arquivos de código na versão anterior à sprint, portanto já falhavam antes:
- `lista-estoque-ux` (2): saldo em KG;
- `rc43112.2-habilitacao-embalagem-comercial`;
- `release-composition`: manifesto do ERP;
- `rc2-central-vendas-faturadas` (1) e `sprint313-central-vendas-faturadas` (8);
- `mib-sprint03-cadastro-pdv` e `mib-sprint04-busca-operacional`: textos de busca e de estoque ausentes;
- `tef-destaxa-07a-auditoria-pdv`;
- `vendas-entrega` `sprint-ux01`, `ux02`, `ux03` e `ux03.3`: botão Entrega e larguras de coluna.

Entre os aprovados:
- PDV: `pdv-busca-nome-nao-plu`, `rc141515-busca-plu-exata`, `f1-busca-nao-bloquear-adicionar`, `consulta-f1-botao-buscar`, `pdv-foto-produto-miniatura`, `pdv-ncm-cadastro`, `bloqueio-sem-saldo-inclusao`, `venda-aberta-persistencia`, `catalogo-produto-venda-aberta`, `pdv-composicao-itens`, `atacado-quantidade-escopo`;
- estoque: `sprint8`, `sprint9` e `sprint11` FX/NF;
- Produtos: `rc80z-produtos-ux`, `sprint71-otimizacao-lista`, `auditoria-cadastro-pesquisa-integridade`, `smart-select-marcas`;
- busca: `mib-401-busca-cadastro-produtos`, `mib-audit-01`;
- outros: `rc11-4-lazy-erp`, `nfce-cupom-unico`, `auditoria-motor-termico`.

**Ensaio visual (navegador, fora do Electron):** páginas temporárias fora do repositório, servidas por servidor estático local só de leitura. Elas carregam o CSS real (Bootstrap, `style.css`, `pdv.css`, `produtos-listagem.css`) e os scripts reais `pdv.js`, `pdvBuscaProduto.js`, `buscaProdutoTexto.js` e `produtos.js`, com 10 produtos reais da cópia de auditoria e sem backend. Capturas em 1366×768 com o Edge headless, em `%TEMP%\cds-s33\`:

| Passo | Resultado |
|---|---|
| `01-pdv-1366.png`: autocomplete "desinfetante" com `… — Nobre cheff`, nomes com a marca no meio sem repetição, preços e "Verificar estoque" corretos | PASS |
| `03-pdv-carrinho-1366.png`: itens da venda com `Molho de Alho 150 ml — Gota`, unitário, total e resumo corretos; `carrinho[].nome` com o nome original | PASS |
| Consulta F1 (lida pelo DOM): mesma regra para os 10 produtos | PASS |
| `02-produtos-1366.png`: listagem `[PLU] NOME — MARCA` com status e estoque iguais aos de antes | PASS |
| Busca no Cadastro: "desinfetante unic" (nome) → 2; "gota" e "jua" (marca) → 1 cada; código de barras → 1; PLU → 1; nomes gravados intactos | PASS |
| Nenhum erro de script nas duas páginas | PASS |

### 23.5 Telas não cobertas

| Verificação | Resultado |
|---|---|
| Electron real (Produtos e PDV com o banco real) | **BLOCKED**: não abri o Electron nem o banco real (restrição; a automação do Electron já foi bloqueada pela revisão automática na seção 20). Conferir após recarregar o app (F5) ou no novo pacote. |
| "PDV Normal" | Não existe tela separada: há um único PDV (`frontend/pdv`, chamado de "PDV Express"), coberto acima. |
| Favoritos e catálogo em grade no PDV | Não existem no código atual; a busca, o autocomplete e a consulta F1 estão cobertos. |
| Outras telas com nome de produto: Compras, Central de Entradas, Vendas, Relatórios, Ranking, Entregas, Etiquetas, Balança | Fora do escopo (a sprint pede Produtos e PDV); continuam com o nome original |

### 23.6 Pendências

1. Conferir no Electron, após recarregar ou no novo pacote, as telas Produtos e PDV com produtos que têm marca.
2. Opcional, em etapa própria: revisar marcas cuja grafia difere da usada no nome do produto (ex.: "Nobre cheff" × "Chef Nobre").

**Nenhum dado real alterado. Sem commit.**

---

## 24. Sprint 3.4 — Integridade do cadastro e pesquisa imediata

**Resultado:** os produtos criados automaticamente pela Compra e pela Importação Inicial passam a gravar `nome_busca` no próprio `INSERT` e a ser publicados no catálogo de pesquisa (cache MIP do PDV e MIB) logo depois do `COMMIT`. Assim aparecem na pesquisa do Cadastro e do PDV imediatamente, sem reiniciar o sistema, mesmo quando o termo também traz outros produtos. A publicação usa o mesmo mecanismo do cadastro pela tela de Produtos, sem um sistema paralelo. O `POST /api/produtos`, já corrigido antes, não foi reimplementado. Sem migração, sem backfill e sem alteração de dados existentes.

### 24.1 Causa raiz corrigida

A pesquisa por nome no servidor (`BuscaOperacionalProdutosService`) consulta só a coluna `produtos.nome_busca`.

| Caminho | Antes | Agora |
|---|---|---|
| Compra (`ensureProductForItemLegado` em `backend/rotas/compras.js`) | `INSERT` sem `nome_busca` e sem `ativo`. Nenhum aviso ao MIB nem ao cache do MIP do PDV. Espelho de identificadores (EAN/PLU) disparado sem esperar. | `INSERT` com `nome_busca = normalizarNomeBusca(nome)` e `ativo = 1`. Espelho de identificadores aguardado **dentro** da transação da compra. Ids criados recolhidos e publicados **depois** do `COMMIT`. |
| Importação Inicial (`inserirProduto` em `importer.js`) | `INSERT` sem `nome_busca`. `notificarProdutoImportado` existia mas nunca era chamado. | `INSERT` com `nome_busca`. Uma publicação consolidada por lote, depois do `COMMIT` (`notificarProdutoImportado` + limpeza do cache MIP). |

**Sintoma reproduzido antes da correção** (mesmo teste novo rodado sobre a cópia do código anterior à sprint, 12 de 17 casos falham):
- busca pelo nome completo do produto recém-criado → `[]`;
- busca "arroz" → só `ARROZ CAMIL 1KG | ARROZ TIO JOAO 5KG | ARROZ PARBOILIZADO PRATO FINO 1KG`, sem o produto novo;
- busca "feijao" → só os 2 concorrentes;
- PDV `GET /produtos/identificar` com o EAN logo após a importação → `encontrado: false`: o lookup negativo ficava no cache do MIP.

### 24.2 Publicação (MIB / MIP)

- **Mecanismo oficial reaproveitado.** `publicarProdutoNoCatalogoOperacional` continua em `backend/rotas/produtos.js`, junto com a instância única do serviço MIP do PDV, e agora é exportada. Compras a chama pela própria rota de Produtos. Com isso, o cache limpo é exatamente o que o PDV consulta em `GET /produtos/identificar`. Ao lado dela foi criada `publicarImportacaoNoCatalogoOperacional`: limpa o mesmo cache e chama `MibService.notificarProdutoImportado`, que agenda um único rebuild do MIB por lote. As duas funções agora devolvem `{ mip, mib, erros }`; o comportamento do cadastro pela tela não mudou.
- **Ordem na Compra:**
  1. `BEGIN IMMEDIATE`.
  2. Por item novo: `INSERT`, depois limpeza do cache MIP de Compras, depois espelho de EAN/PLU (aguardado).
  3. Financeiro.
  4. `COMMIT` conferido (`confirmarTransacaoCompra`).
  5. Publicação: relê os produtos criados, com o PLU, e chama o publicador oficial para cada um.
  6. Vínculo com a Central e resposta.
  - Em `ROLLBACK` nada é publicado.
  - Em `COMMIT` recusado a resposta continua sendo o erro da Sprint 2.9.
- **Ordem na Importação:**
  1. `BEGIN IMMEDIATE`.
  2. Linhas.
  3. `COMMIT`.
  4. `publicarLoteNoCatalogoOperacional`, uma vez por lote, com `ids_criados`, `ids_enriquecidos` e `ids_atualizados`.
  - A rota `/api/produtos/importacao-inicial/importar` injeta o publicador oficial. Uma chamada direta ao serviço sem publicador devolve `NAO_CONFIGURADO`, nunca um sucesso falso.
- **Cache do MIP de Compras.** Esse catálogo também guarda lookups negativos. Sem limpá-lo, um segundo item com o mesmo EAN na mesma compra, ou na compra seguinte, cairia na busca só por nome e poderia criar um cadastro duplicado. Foi adicionada `limparCacheCatalogo()` ao `EntradasProdutoIdentificacaoService`, idêntica à do PDV, e ela é chamada logo após cada criação.
- **Falha de publicação, sem sucesso enganoso.** A gravação já está confirmada e não é desfeita.
  - Compra: `catalogoOperacional: { produtos_criados, publicados, falhas[] }`. Com falha, há também um `aviso`, e a tela de Compras, que já trata esse campo, mostra um alerta em vez do "sucesso".
  - Importação: `catalogo_operacional.status = PUBLICADO | FALHA | SEM_ALTERACOES | NAO_CONFIGURADO`, com `aviso` quando há falha. A tela de importação passou a mostrar o `aviso` como alerta.
  - Como `nome_busca` já foi gravado, o produto continua encontrado pela busca operacional, que lê o banco, mesmo sem o MIB.
- **Nova tentativa sem duplicidade:**
  - Compra: a busca por código, EAN ou nome reaproveita o cadastro, e a reutilização não publica de novo.
  - Compra desfeita: o `ROLLBACK` remove o produto, e a nova tentativa cria um único cadastro.
  - Importação: a mesma sessão devolve `ja_importado`, e a mesma planilha validada de novo traz a linha como já existente, sem `PRONTO`.

### 24.3 Arquivos alterados

| Arquivo | Alteração |
|---|---|
| `backend/rotas/compras.js` | `INSERT` com `nome_busca` e `ativo`. Espelho de identificadores aguardado, com proteção contra callback duplo. Limpeza do cache MIP de Compras. Coletor `produtosCriados` (`processarItensCompra` → `ensureProductForItem` → `ensureProductForItemLegado`). Nova `publicarProdutosCriadosNaCompra`, chamada após o `COMMIT`. Avisos acumulados com o do vínculo da Central. |
| `backend/rotas/produtos.js` | O publicador oficial devolve o resultado. Nova `publicarImportacaoNoCatalogoOperacional`. Exportação das duas. As alterações sem commit que já existiam no arquivo foram preservadas. |
| `backend/motores/produto-identidade/services/EntradasProdutoIdentificacaoService.js` | Nova `limparCacheCatalogo()` |
| `backend/services/importacao-inicial-produtos/importer.js` | `INSERT` com `nome_busca` (37 → 38 colunas). Opção `publicarCatalogo`. `publicarLoteNoCatalogoOperacional` após o `COMMIT`. `catalogo_operacional` e `aviso` no resultado. |
| `backend/services/importacao-inicial-produtos/index.js` | `importarSessao` repassa `publicarCatalogo` |
| `backend/rotas/importacao-inicial-produtos.js` | Injeta o publicador oficial de `rotas/produtos.js` |
| `frontend/erp/js/importacao-inicial-produtos.js` | Mostra o `aviso` como alerta, em vez de "Importação concluída com sucesso." |
| `tests/produtos/sprint34-cadastro-automatico-pesquisa-imediata.test.js` (novo) | 17 casos pelas rotas reais (seção 24.4) |
| 14 testes antigos, só a DDL do fixture | Ver abaixo |

**Fixtures antigos atualizados (só o `CREATE TABLE produtos`, nenhuma asserção mudou):**
- `importacao-inicial-*` (12 arquivos), `formacao-preco-persistido-v118` e `sprint17-normalizacao-categoria`.
- Esses testes criam um `produtos` reduzido, sem `nome_busca`. Com a correção falhavam com `SQLITE_ERROR: table produtos has no column named nome_busca`.
- **Prova de que o fixture estava obsoleto:**
  - o schema real sempre tem a coluna, garantida em `backend/database.js` (`garantirSchemaMib`, na inicialização);
  - o `INSERT` oficial do cadastro (`POST /api/produtos`) já grava `nome_busca` e `ativo`.
- Foi acrescentado `nome_busca TEXT`, e também `ativo INTEGER DEFAULT 1` no fixture de cadastro da Sprint 17.

### 24.4 Cenários (rotas reais, SQLite temporário, sem reiniciar entre cadastro e pesquisa)

Base: 5 produtos concorrentes ("ARROZ TIO JOAO 5KG", "ARROZ CAMIL 1KG", "ARROZ PARBOILIZADO…", "FEIJAO CARIOCA…", "FEIJAO PRETO…").

**Correção A: `POST /api/compras` (compra manual, item sem `produto_id`)**

| # | Cenário | Resultado |
|---|---|---|
| A1 | Antes da compra: o PDV consulta o EAN, recebe `encontrado: false` e o lookup negativo fica em cache | PASS |
| A2 | Um único `INSERT` de produto, com `nome_busca` normalizado nos parâmetros (gravado no INSERT, não por backfill). `ativo = 1`, nome original preservado. MIB notificado 1× com id, `nome_busca` e PLU. Resposta `catalogoOperacional = { produtos_criados: [id], publicados: 1, falhas: [] }`, sem aviso. | PASS |
| A3 | Busca imediata por nome completo, prefixo ("ARROZ SPRINT34"), trecho em minúsculas, trecho do meio ("PREMIUM"), código interno/EAN e PLU | PASS |
| A4 | Termo concorrente "arroz": o servidor devolve 4 itens e o novo está entre eles | PASS |
| A5 | Cache MIP do PDV invalidado: EAN e PLU identificados logo após a compra | PASS |
| A6 | Cadastro único: uma linha, `saldo_fiscal = 5`, `saldo_nao_fiscal = 0`, `estoque_atual = 5` | PASS |
| A7 | Nova compra do mesmo item: nenhum produto criado, nenhuma republicação. Continua uma linha, com `saldo_fiscal = 7`, e o item aponta para o mesmo id. | PASS |
| A8 | Compra com o 2º item inválido: HTTP de erro, `ROLLBACK` sem produto e sem publicação. A nova tentativa cria um único cadastro, publicado e pesquisável. | PASS |
| A9 | MIB indisponível (simulado): compra gravada com `aviso`, `publicados = 0` e a falha descrita. O produto tem `nome_busca` e é encontrado pela busca operacional. | PASS |
| — | Busca por marca | N/A: a compra não informa marca; o produto nasce sem marca, como antes |

**Correção B: Importação Inicial (`/validar` + `/importar`, planilha XLSX)**

| # | Cenário | Resultado |
|---|---|---|
| B1 | Antes da importação: lookup negativo do EAN no PDV | PASS |
| B2 | Um único `INSERT`, com `nome_busca`. Ativação preservada (padrão do schema). `catalogo_operacional.status = PUBLICADO`. `notificarProdutoImportado` 1× por lote, com `ids_criados = [id]`, e nenhum evento por produto. | PASS |
| B3 | Busca imediata por nome completo, prefixo, trecho, trecho do meio, **marca** ("MARCA S34 IMPORT"), código interno ("S34-IMP-01") e EAN | PASS |
| B4 | Termo concorrente "feijao": o produto importado aparece junto dos 2 concorrentes | PASS |
| B5 | Cache MIP do PDV invalidado: EAN identificado logo após a importação | PASS |
| B6 | Cadastro único, com `saldo_fiscal + saldo_nao_fiscal = estoque_atual` na mesma linha | PASS |
| B7 | Nova tentativa: a mesma planilha validada de novo não traz `PRONTO`, e `criados = 0`. A mesma sessão devolve `ja_importado`. Continua 1 cadastro. | PASS |
| B8 | MIB indisponível (simulado): importação gravada, `status = FALHA` com o erro, `aviso` na resposta, produto pesquisável | PASS |
| — | PLU | N/A: a planilha da importação não tem coluna de PLU |

**Teste novo:** 17/17 PASS. Na cópia do código anterior à sprint: 5 PASS e 12 FAIL (seção 24.1). A diferença prova que o teste detecta o defeito.

**Normalização consistente com a pesquisa:**
- `nome_busca` gravado = `normalizarNomeBusca(nome)`, a mesma função da busca e do cadastro oficial (`motores/mib`);
- prefixo, trecho, maiúsculas e minúsculas e espaços encontram o produto (A3, B3).

### 24.5 Regressões (cada arquivo com limite de 2 minutos, sem suíte completa)

| Grupo | Arquivos | Resultado |
|---|---|---|
| As 64 de referência (`sprint33-nome-marca-exibicao`, `pdv-busca-marca-nome`, `auditoria-cadastro-pesquisa-integridade`, `cadastro-transacao-backfill`, `mib-401`, `mib-audit-01`, `mib-busca-tokens-and`, `pdv-busca-nome-nao-plu`, `rc141515-busca-plu-exata`) | 9 (também contados no último grupo) | **64/64 PASS** |
| Importação Inicial e afins (`importacao-inicial-*`, `formacao-preco-persistido-v118`, `backup-path-config`, `sprint17-normalizacao-categoria`) | 19 | 18 PASS e 1 FAIL antigo |
| Compras (`tests/compras/*`, 51 arquivos) + `mip-sprint07-compras-xml-central`, `mip-sprint05-pdv`, `catalogo-produto-venda-aberta` | 54 | 44 PASS e 10 FAIL antigos |
| PDV, Produtos, MIB, MIP e testes que leem os arquivos alterados (`tests/pdv`, `tests/produtos`, `tests/mib`, `tests/produto-identidade`, `rc4315-insert-alignment`, `miip-v2-identificacao-hierarquia`, `muc-*`, `faturamento/*devolucao*`, `sprint1-cnpj-fundacao`) | 79 | 75 PASS e 4 FAIL antigos |

**Falhas novas:** nenhuma.

**Falhas antigas: 15 arquivos.** Cada um foi rodado numa cópia do repositório sem as alterações desta sprint (a mesma da Sprint 3.3), e o **conjunto de testes que falham é idêntico** ao comparar os nomes, não só as contagens:
- `importacao-inicial-navegacao-v103`: breadcrumb "Estoque Inicial";
- `central-nfe-apresentacao-compra` (4);
- `central-nfe-produto-existente-novo-sqlite-e2e` (1);
- `correcao-nf-margem-01` (4);
- `rc43110-recursao-embalagens`;
- `rc43112-compra-manual-muc`;
- `rc43112.1-finalizacao-embalagem-comercial`;
- `rc43112.2-habilitacao-embalagem-comercial`;
- `rc43116-distribuicao-fiscal-central`;
- `rc4312-central-fluxos`;
- `rc4314-insert-compras-alignment`;
- `lista-estoque-ux` (2);
- `mib-sprint03-cadastro-pdv`;
- `mib-sprint04-busca-operacional`;
- `mip-sprint08-hardening`: script que sai com código ≠ 0 também na cópia.

### 24.6 Cadastro único e saldos

Nenhum caminho cria cadastro separado para fiscal e não fiscal. A6 e B6 conferem uma única linha por produto, com `saldo_fiscal` e `saldo_nao_fiscal` lado a lado. A7 confirma que a entrada seguinte soma na mesma linha.

Preservados:
- código interno, EAN e PLU, que continuam sendo espelhados em `produto_identificadores`;
- unidade, dados fiscais e preços;
- nome original gravado e exibição `NOME — MARCA` (Sprint 3.3);
- bloqueio `ITEM_SEM_ASSOCIACAO` da Central. A Central nunca cria produto por esta rota: o cadastro novo da Central usa `POST /api/produtos`, já corrigido.

### 24.7 Limitações restantes

1. **`COMMIT` com estado indeterminado** (Sprint 2.9, `COMPRA_ESTADO_INDETERMINADO`): não há publicação. Se o produto tiver sido gravado, a busca operacional o encontra pelo `nome_busca`; o MIB o recebe no próximo rebuild.
2. **Erro assíncrono do rebuild do MIB:** o resultado da publicação reflete o agendamento síncrono. Erro interno posterior do rebuild só aparece no log do MIB. É o mesmo comportamento do cadastro pela tela de Produtos.
3. **Produtos criados antes desta correção sem `nome_busca`:** dependem do backfill que já roda na inicialização (até 5000 vazios). Nenhum backfill foi executado nesta sprint (restrição).
4. **Termo muito genérico com mais de 20 resultados:** o limite e a ordenação da busca podem deixar qualquer produto fora, novo ou antigo. É o comportamento atual da busca, não uma regressão.
5. **Electron real: BLOCKED.** Não abri o Electron nem o banco real. Conferir no app, após recarregar ou no novo pacote:
   - uma compra manual com produto novo;
   - uma importação inicial;
   - em ambos os casos, pesquisar o produto imediatamente no Cadastro e no PDV.
6. A investigação de concorrência entre cadastro e venda continua em espera, como pedido.

**Nenhum dado real alterado. Sem migração. Sem commit.**
