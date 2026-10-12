# Auditoria completa — Central Inteligente de Entradas

Data: 10/10/2026. Somente auditoria: **nenhum código de produção, dado, banco ou configuração foi alterado**. Sem commit.

Base: relatório `docs/build/AUDITORIA_GERAL_ENTRADA_NFE_XML_ATE_EFETIVACAO.md` (seções 1–24), `docs/build/auditoria-integridade-idempotencia-e2e.md`, resultados das Sprints 3.5–3.8 e inspeção pontual do código atual (árvore de trabalho). Banco real não aberto.

Legenda de confiança: **comprovado** (código + reprodução ou teste), **provável** (leitura estática consistente, sem reprodução), **não verificado** (hipótese).

---

## 1. Resumo executivo

1. **O cliente não roda nenhuma das correções das Sprints 2.x a 3.8.** O pacote instalado (`dist/erp/win-unpacked/resources/app.asar`, 06/10 22:30) corresponde ao último commit (`431df09`, 06/10 22:27). Desde então há 79 arquivos alterados e 31 novos sem commit, incluindo a política de identificação V2 (`MiipIdentificacaoV2Policy.js`, não rastreado). Nenhuma correção foi validada no Electron (todas as sprints registram BLOCKED). Este é o maior risco atual e precede qualquer nova sprint corretiva.
2. **Caso POLPA MARACUJA 400G × Frango do Dia (70/100): causa comprovada, em três camadas.**
   - O resultado MIIP do documento foi gravado pela busca antiga, que comparava o cProd do fornecedor com o código interno do CDS. Esse resultado nunca mais é recalculado.
   - O mapper de importação entrega o candidato como `produtoEncontrado` mesmo quando a decisão é "cadastrar".
   - Contadores, selo da lista, pergunta e painel de comparação usam regras diferentes para decidir o estado do item.

   Por isso a tela diz ao mesmo tempo "6 precisam de cadastro / 0 de confirmação", mostra o selo "Confirmação" e compara com o Frango. A busca já foi corrigida na árvore (Sprint 3.1), mas o estado contraditório do item continua possível e o score residual 70 sobrevive mesmo no código novo (comprovado nesta auditoria).
3. **Transações SQLite:** todo o backend usa uma única conexão compartilhada. Compras, vendas, caixa e cadastro abrem `BEGIN IMMEDIATE` nela. Comandos de outras requisições podem entrar na transação aberta. O próprio código documenta o risco em `CentralRevisaoPersistenteService`. Provável, não reproduzido (escopo estático).
4. **Duplicidade de compra pela mesma chave:** a verificação é feita fora da transação e não existe índice único em `compras.chave_acesso`. A trava do frontend cobre o clique duplo na mesma janela, mas não dois terminais.
5. **Mensagens técnicas ainda visíveis:** o detalhe do documento aguardando XML mostra MIRX, Gate, backoff, `DistDFe → consChNFe` e "🔴 Consulta temporariamente bloqueada (656)". A Sprint 3.5 tratou só as mensagens de sincronização.
6. **Suíte de testes vermelha em áreas centrais:** 15 arquivos de Compras/Produtos/MIB e 4 da Central falham também no código anterior às sprints. Isso reduz a capacidade de detectar regressões.

**Recomendação de ordem:**
1. Publicação controlada + homologação no Electron.
2. Estado único do item na revisão + reidentificação dos documentos afetados.
3. Concorrência e duplicidade de compra.
4. Mensagens técnicas remanescentes.
5. Saúde da suíte.

Detalhes nas seções 6 e 7.

---

## 2. Estado real do módulo e dos componentes

| Componente | Conectado ao fluxo? | No pacote do cliente? | Evidência |
|---|---|---|---|
| Upload manual de XML (`CentralUploadService`) | Sim | Sim | menu "Adicionar XML" |
| Sincronização DF-e (`CentralSyncExecucaoService` → `CentralSincronizacaoService`) | Sim | Sim | rota `POST /sincronizar`, scheduler |
| Gate SEFAZ (`CentralSefazOperationalGate`): cooldown 656, bloqueio, histórico | Sim | Sim | chamado em `executar` (autorização) e após cada resposta com cStat |
| Mutex por CNPJ+ambiente (`obterDistNsuSyncLock`) | Sim | Sim | `comLockDistDfe` |
| MIRX / XmlWaitScheduler (recuperação de XML completo) | Sim | Sim | card "XML Completo — MIRX" |
| Parser oficial + `CentralProcessamentoService` | Sim; **reutiliza resultado gravado** | Sim | "Processamento já existente — resultado reutilizado" (seção 20.1) |
| MIIP pipeline (GTIN, associação fornecedor, MUBC) | Sim | Sim (versão antiga) | `MiipService` |
| Política V2 (`MiipIdentificacaoV2Policy`) | Sim na árvore | **Não** (arquivo não rastreado) | `MiipService.js:202` |
| `ProductCompatibilityGuard` (sem `codigo_fornecedor` como forte) | Sim na árvore | Versão antiga | Sprint 3.1 |
| Módulo de comparação `miip-central-revisao-inteligente.js` | Sim na árvore (manifesto lazy) | **Não carregado** no pacote | seção 20.4 / 21.1 |
| Revisão persistente (`CentralRevisaoPersistenteService`) | Sim; correção de produto usa **conexão própria** | Parcial | linhas 29–45 |
| Compras (`backend/rotas/compras.js`) | Sim | Versão antiga | `POST /compras` |
| MIB/MIP (publicação após cadastro) | Sim na árvore (Sprint 3.4) | Não | seção 24 |
| Importação de XML legado | Rota e tela ativas; menu removido (Sprint 3.7) | Sim (com menu) | `data-view="importacao-xml-legado"` |
| Script de reidentificação dos docs 179/264 | Existe no disco | **Ignorado pelo git** (`.gitignore:40 scripts/`) | `git check-ignore` |

---

## 3. Mapa do fluxo (XML → efetivação)

```
Entrada
  ├─ Upload manual (Adicionar XML) ──────────────┐
  └─ Sync DF-e: Gate autoriza → mutex CNPJ → SEFAZ │
       └─ resposta cStat → Gate (656 → cooldown)  │
          evento SYNC_* + notificação + log        │
                                                  ▼
Documento central (central_entradas_documentos, chave UNIQUE)
  ├─ RES_NFE → Ciência (claim único) → MIRX/XmlWait → PROC_NFE
  └─ PROC_NFE → Parser → MIIP (pipeline + política V2)
        → mapper de importação → parse_json / miip_resumo_json   ← GRAVADO E REUTILIZADO
                                                  ▼
Revisão (miip-central-revisao.js)
  contadores = miip.resumo gravado (decremento local)
  lista/selo = precisaCadastro && !produtoEncontrado
  pergunta   = produtosDaPergunta (só !precisaCadastro)
  comparação = produtoEncontrado || candidatoSelecionado
  decisões persistidas (sessão de revisão, conexão própria para correção)
                                                  ▼
Finalizar Entrada → payload-compra (resultado gravado) → Compras
  POST /compras: SELECT por chave (fora da TX) → BEGIN IMMEDIATE (conexão compartilhada)
  → INSERT compra/itens → conversões (MUC) → estoque/custo → financeiro → COMMIT
  → publicação MIB/MIP dos produtos criados (após COMMIT)
```

---

## 4. Achados

### Grupo R1 — O código corrigido não chega ao cliente

**AUD-01 — Pacote instalado anterior a todas as correções 2.x–3.8**
- Área: publicação / F.
- Descrição: o `app.asar` de 06/10 22:30 corresponde ao commit `431df09` (06/10 22:27). Há 79 arquivos rastreados alterados e 31 novos sem commit. Entre eles estão a política V2, a remoção da busca global por cProd, a publicação MIB/MIP, as conversões confirmadas (2.2–2.9) e as Sprints 3.1–3.8.
- Causa-raiz: correções acumuladas sem commit nem build.
- Evidência: `git log`, `git diff --name-only HEAD` (79), `git ls-files --others` (31), data do `app.asar`.
- Impacto: para NF-e novas, o cliente continua sujeito a candidato por cProd (Frango para polpa), pesquisa sem produto recém-criado, conversões sem confirmação etc.
- Condição: toda instalação com o pacote de 06/10.
- Dependências: base de AUD-04, AUD-19.
- Prioridade: **P0**. Confiança: **comprovado**.
- Recomendação: commits agrupados por sprint, build versionado (`package.json` ainda em 1.0.3), roteiro de homologação no Electron.
- Aceite: o pacote novo contém `MiipIdentificacaoV2Policy.js`, não contém `WHERE p.codigo = ? OR p.codigo = ?` em `ProdutoRepository` e carrega `miip-central-revisao-inteligente.js`; roteiro da seção 7 executado no Electron.

**AUD-02 — Script de reidentificação fora do versionamento**
- Área: publicação / dados.
- Descrição: `scripts/homologacao/sprint31-reidentificar-miip-documentos.js` existe no disco (09/10 23:13), mas `.gitignore:40` ignora `scripts/`.
- Evidência: `git check-ignore -v`.
- Impacto: o procedimento reversível para corrigir os docs 179/264 (seção 21.4) se perde em outra máquina ou após limpeza.
- Prioridade: **P1**. Confiança: **comprovado**.
- Recomendação: versionar o script (exceção no `.gitignore` ou mover a pasta).
- Aceite: `git ls-files` lista o script.

**AUD-19 — Nenhuma validação no Electron real desde a Sprint 2.1**
- Área: F / processo.
- Descrição: todas as seções 7, 9.6, 10.6, 14.9, 15.7, 16.8, 17.9, 21.2, 22.4, 23.5 e 24.7 registram BLOCKED. A homologação de 19 (Sprint 3.0) foi a única no Electron.
- Impacto: integração real (lazy loader, sessão, modais, banco real) não comprovada após as correções.
- Prioridade: **P1**. Confiança: **comprovado** (registros).
- Aceite: roteiro mínimo da seção 7 executado no pacote novo, com evidências.

### Grupo R2 — Estado do item na revisão (caso POLPA × Frango)

**AUD-04 — Resultado MIIP congelado em documentos processados com a lógica antiga**
- Área: B.
- Descrição: o resultado gravado em `parse_json`/`miip_resumo_json` é reutilizado por `CentralProcessamentoService`, `montarPayloadAbrirCompra` e pela sessão de revisão, sem reidentificar.
  - Docs 179 e 264: candidatos #763 (Frango), #744, #694, #686, #746, #713, todos com 70 (seção 21.4).
  - Doc 264 tem 6 itens. Isso corresponde exatamente aos contadores observados ("6 precisam de cadastro, 0 de confirmação").
- Causa-raiz: busca global por cProd (corrigida na árvore) + ausência de reidentificação.
- Evidência: seções 20.1 e 21.4; verificação desta auditoria (seção 5).
- Impacto: operador vê sugestão absurda; risco de vínculo errado se escolher manualmente.
- Frequência: docs 179 e 264 comprovados. Os demais documentos em revisão processados pelo pacote de 06/10 (a fila mostra 228 "Em Revisão") estão **não verificados**.
- Dependências: AUD-01 (publicar antes de reidentificar), AUD-02, AUD-05.
- Prioridade: **P1**. Confiança: **comprovado** para 179/264.
- Recomendação:
  1. Inventário somente leitura, numa cópia `VACUUM INTO`, dos documentos EM_REVISAO cujo resultado tem candidato com evidência `codigo_fornecedor`.
  2. Rodar o script da 21.4 (simular → aplicar → guardar log).
- Aceite: nenhum documento em revisão exibe candidato cuja única evidência forte seja cProd; log de reversão guardado.

**AUD-05 — Item "precisa cadastro" com produto encontrado: quatro sinais contraditórios**
- Área: B / C.
- Descrição: `mapearDecisaoPipelineParaImportacao` (`MiipResultadoImportacaoMapper.js:80–142`) usa `decisao.melhorCandidato ?? resultado.candidatos[0]`. Ele devolve `produtoEncontrado` e `candidatoSelecionado` também quando `acao = criar_novo` / `precisaCadastro = true`. Na tela, cada parte decide por uma regra diferente:

  | Parte da tela | Regra | Resultado no doc 264 (derivado do código e dos dados da seção 20.1) |
  |---|---|---|
  | Contadores (`renderResumoTopo`) | `miip.resumo` gravado | "Precisam cadastro 6 / confirmação 0" |
  | Selo da lista (`renderListaPendencias:1185`) | `precisaCadastro && !produtoEncontrado` → senão "Confirmação" | **"Confirmação"** + "Semelhança 70/100" |
  | Pergunta (`produtosDaPergunta:1245`) | mostra produto só se `!precisaCadastro` | "Este produto já existe? Vincular / Cadastrar" |
  | Comparação (`renderComparacaoV2:539`) | `produtoEncontrado || candidatoSelecionado` | POLPA × **Frango do Dia** |

- Causa-raiz: ausência de um estado único do item (identificado / sugerido / pendente). Cada componente infere o estado de flags independentes.
- Evidência: código citado; verificação da seção 5 (resultado congelado → `produtoEncontrado=763`, `precisaCadastro=true`, `precisaConfirmacao=false`, `score=70`).
- Impacto: confusão do operador; sugestão de produto incompatível no painel "Ver detalhes".
- Condição:
  - todo resultado gravado com candidato e decisão `criar_novo`;
  - no código novo, o caso `codigo_barras_produto_inativo` (`MiipIdentificacaoV2Policy.js:251`) também devolve candidato com `criar_novo`, mas de forma intencional (aviso "desativado").
- Dependências: AUD-04, AUD-06, AUD-07.
- Prioridade: **P1**. Confiança: **comprovado**.
- Recomendação:
  - Derivar o estado do item numa única função (backend ou módulo compartilhado) a partir de `acao`/`identificacaoV2.estado`.
  - Comparação e selo só mostram candidato em `sugerir`/`revisar_manual` ou no caso explícito de produto inativo.
  - Contadores recalculados a partir dos itens, não do resumo gravado.
- Aceite: para um resultado `criar_novo` com candidato gravado, selo = "Cadastro", sem comparação com produto e "Sem candidato"; contadores = contagem dos itens por estado; teste de UI cobrindo o doc 264 reproduzido.

**AUD-06 — Score residual 70 sem candidato, mesmo com a política V2**
- Área: B.
- Descrição: `aplicarPoliticaNoResultado` esvazia `candidatos` e `melhorCandidato`, mas preserva `...decisaoAnterior` (inclusive `score`). O mapper usa `decisao.score ?? resultado.score.valor`. Resultado: `criar_novo`, sem candidato, `score: 70`. A lista mostraria "Semelhança 70/100" num item sem candidato.
- Evidência: verificação pura desta auditoria (seção 5, casos 1 e 2: `produtoEncontrado: null`, `candidatos: 0`, `score: 70`).
- Impacto: a mensagem sugere semelhança onde não há candidato.
- Condição: qualquer item em que o MUBC encontrou candidatos e a política V2 os descartou (ex.: POLPA reprocessada).
- Prioridade: **P2**. Confiança: **comprovado** (funções reais, sem banco; a tela não foi aberta).
- Recomendação: zerar o score quando a V2 decide `criar_novo` sem candidato.
- Aceite: `criar_novo` sem candidato → `score = 0` e "Sem candidato" na lista.

**AUD-07 — Contadores não derivados do estado dos itens**
- Área: C.
- Descrição: os contadores vêm de `miip.resumo` gravado e são decrementados localmente por `atualizarIndicadoresAposResolucao` (`miip-central-revisao.js:1607`) conforme as flags da pendência. Não há recálculo a partir dos itens.
- Impacto: divergência entre contadores e lista sempre que as flags forem contraditórias (AUD-05) ou o resumo gravado estiver desatualizado.
- Prioridade: **P2**. Confiança: **comprovado** (código).
- Recomendação: tratar junto com AUD-05.
- Aceite: soma dos contadores = número de itens da lista por estado, antes e depois de cada decisão.

**AUD-08 — Pontuação aditiva não calibrada**
- Área: B.
- Descrição: o MUBC soma pesos fixos (seção 20.2).
  - Coincidir só em unidade ou medida não gera mais sugestão (Sprint 3.1).
  - A V2 exige evidência de nome para sugerir.
  - A tela mostra "Semelhança X/100" com aviso de que não é probabilidade.
- Risco remanescente: ausência de nome não penaliza o score (só a decisão).
- Prioridade: **P3**. Confiança: **comprovado** (código e seção 20.2).
- Recomendação: manter; calibrar só com amostra rotulada.

### Grupo R3 — Concorrência e integridade transacional (avaliação estática)

**AUD-09 — Transações sobre a conexão SQLite compartilhada**
- Área: G / E.
- Descrição: `backend/database.js:81` abre uma única conexão (WAL, `busy_timeout` 30 s). Compras (`compras.js:1320, 1956, 2423`), caixa, cancelamento de venda, cadastro (`produtos.js:2494`) e outros emitem `BEGIN IMMEDIATE` nessa conexão.
  - Com o node-sqlite3, comandos de outras requisições emitidos enquanto a transação está aberta entram nela.
  - `db.run('BEGIN IMMEDIATE')` sem callback (`compras.js`) ignora o erro "cannot start a transaction within a transaction".
  - `executarComTxOuReutilizar` (`reservasPublico.js:50`) reaproveita **qualquer** transação ativa, inclusive de outra requisição.
  - O próprio código registra o risco: comentário em `CentralRevisaoPersistenteService.js:29–32`, que por isso abre conexão própria só para a correção de produto.
- Impacto potencial: o `ROLLBACK` de uma compra desfaz escritas de uma venda simultânea (ou o inverso); `COMMIT` confirma escritas de outra operação ainda incompleta.
- Condição: operações de escrita simultâneas no mesmo servidor (vários caixas + ERP).
- Dependências: AUD-10; riscos de estoque/PIX da auditoria de integridade (seção 7 daquele relatório).
- Prioridade: **P1**. Confiança: **provável** (não reproduzido; escopo estático por decisão do usuário).
- Recomendação: decisão de arquitetura antes de corrigir. Opções:
  - fila única de transações de escrita;
  - conexão dedicada por transação (padrão já usado na correção de produto);
  - wrapper que falha em vez de reutilizar transação alheia.

  Investigação experimental em cópia descartável antes da escolha.
- Aceite: teste com compra e venda concorrentes em SQLite temporário em que o `ROLLBACK` de uma não afeta a outra.

**AUD-10 — Duplicidade de compra pela mesma chave de acesso**
- Área: E / A.
- Descrição:
  - `POST /compras` verifica `SELECT id FROM compras WHERE chave_acesso = ?` (`compras.js:2378`) **antes** do `BEGIN IMMEDIATE`, sem repetir dentro da transação.
  - `compras.chave_acesso` é `TEXT` sem índice único (`database.js:1798`, `:305`, `:2824`). O tratamento de erro UNIQUE em `compras.js:2024` é código morto.
  - O frontend impede a reentrada na mesma janela (`window.__cdsExecutandoGravacaoCompra`, `compras.js:7225`).
- Impacto: duas compras, dois lançamentos de estoque e de financeiro para a mesma NF-e.
- Condição: envio simultâneo da mesma nota por duas abas ou dois terminais. A repetição sequencial é barrada (teste `central-nfe-sprint28-atomicidade-conversao`, caso "repetição depois da compra").
- Prioridade: **P2**. Confiança: **provável**.
- Recomendação:
  - Repetir a checagem dentro da transação.
  - Índice único parcial em `compras.chave_acesso` (não nulo), precedido de verificação somente leitura de duplicatas existentes em cópia.
- Aceite: dois `POST /compras` simultâneos com a mesma chave em SQLite temporário → uma compra e um 400.

### Grupo R4 — Mensagens técnicas e experiência

**AUD-12 — Card "XML Completo — MIRX" com termos técnicos no detalhe do documento**
- Área: C / A.
- Descrição: `renderCardXmlWaitOperacionalCentral` (`central-entradas-ux.js:1269–1330`), exibido no detalhe de documentos `AGUARDANDO_XML_COMPLETO` (`central-entradas.js:3627`), mostra:
  - "Estado MIRX", "Dormindo", "Status do Gate" (BLOCKED/NORMAL), "Backoff atual";
  - "Método programado: DistDFe → consChNFe";
  - "Motivo do bloqueio: cStat 656";
  - "🔴 Consulta temporariamente bloqueada (656)".
- Impacto: mesma impressão de erro tratada na Sprint 3.5, em outro ponto.
- Prioridade: **P2**. Confiança: **comprovado** (código). Não visto na tela real.
- Recomendação: resumo amigável no card ("Aguardando o XML completo da SEFAZ; nova tentativa automática às HH:MM"); detalhes técnicos no bloco recolhível já existente (`renderInfoTecnicasRecolhivelCentral`).
- Aceite: o card não contém "MIRX", "Gate", "Backoff", "consChNFe" nem "656"; os dados continuam no bloco técnico.

**AUD-13 — Texto "Cooldownoldown SEFAZ"**
- Área: C. Evidência: `central-entradas.js:1857` (badge do painel do serviço com cooldown ativo).
- Prioridade: **P3**. Confiança: **comprovado**.
- Aceite: badge com texto revisado (ex.: "Aguardando SEFAZ").

**AUD-14 — Tab capturado na revisão**
- Área: C (teclado/acessibilidade).
- Descrição: `onKeydown` (`miip-central-revisao.js:3068`) faz `preventDefault` em todo Tab para trocar de item. Não é possível navegar pelo teclado entre "É este", "Escolher outro", "Ignorar" etc.
  - Enter é seguro: só confirma com exatamente um produto oferecido (`confirmarAtual:1594`).
  - Esc pausa com progresso salvo.
- Prioridade: **P3**. Confiança: **comprovado** (código).
- Recomendação: trocar de item com outra tecla (ex.: Ctrl+→) e devolver o Tab ao navegador.

**AUD-15 — Orientação obsoleta para "Importação de XML Legado"**
- Área: C. Evidência: `central-entradas.js` (`abrirCentralRecuperacaoXml`) orienta "Ferramentas Administrativas → Importação de XML Legado", item removido na Sprint 3.7.
- Condição: só com a flag `recuperacaoPortalNacional` ligada (padrão: desligada).
- Prioridade: **P3**. Confiança: **comprovado**.

**AUD-16 — Painéis "Monitoramento — SEFAZ/Saúde" na tela operacional**
- Área: C.
- Descrição: os painéis recolhíveis do dashboard incluem "Operational Gate", NSU e estados técnicos (`renderPainelSaudeSefazCentral`).
- Prioridade: **P3**. Confiança: **não verificado** se abrem expandidos para o cliente.
- Recomendação: avaliar junto com AUD-12.

### Grupo R5 — Cadastro e identificação

**AUD-20 — Acentos na busca por nome do MIIP (falsos negativos)**
- Área: B / D.
- Descrição: a busca por nome do MIIP usa `UPPER` do SQLite, que não converte letras acentuadas (seção 21.5, item 3). Produto cadastrado com acento pode não ser candidato.
- Impacto: item vai para "precisa cadastro" e o operador pode cadastrar um duplicado.
- Prioridade: **P2**. Confiança: **provável** (registro da 21.5; não reproduzido nesta auditoria).
- Recomendação: usar o `nome_busca` normalizado (mesma função da pesquisa operacional) também na busca do MIIP.
- Aceite: "AÇÚCAR" encontrado ao buscar "ACUCAR" e vice-versa, num teste com SQLite temporário.

**AUD-21 — Produtos legados sem `nome_busca`**
- Área: D. Dependem do backfill da inicialização (até 5000 vazios; seção 24.7).
- Prioridade: **P3**. Confiança: **não verificado** na base do cliente.
- Aceite: consulta somente leitura numa cópia mostra 0 produtos ativos com `nome_busca` nulo após a inicialização.

Correções das Sprints 3.3 e 3.4 (exibição "NOME — MARCA", `nome_busca` no INSERT, publicação MIB/MIP após o COMMIT) **não** foram reabertas: o código atual confirma as correções e os testes passam (seção 24).

### Grupo R6 — Testes e mecanismos internos

**AUD-17 — Suíte com falhas antigas em áreas centrais**
- Área: F.
- Descrição: falham também no código anterior às sprints (mesmos nomes de teste):
  - **Compras/Produtos/MIB (15 arquivos):**
    - `central-nfe-apresentacao-compra` (4);
    - `central-nfe-produto-existente-novo` (1);
    - `correcao-nf-margem-01` (4);
    - `rc43110`, `rc43112`, `rc43112.1`, `rc43112.2`;
    - `rc43116-distribuicao-fiscal-central`;
    - `rc4312-central-fluxos`;
    - `rc4314-insert-compras-alignment`;
    - `importacao-inicial-navegacao-v103`;
    - `lista-estoque-ux` (2);
    - `mib-sprint03`, `mib-sprint04`;
    - `mip-sprint08-hardening`.
  - **Central (4):**
    - `rc3753-ux-cooldown-656` e `central-entradas-sprint9`: o Node 24 define `navigator` sem `onLine` e o estado vira "offline". Causa comprovada, defeito do ambiente de teste.
    - `rc333-hardening`: caso "mutex único". Uma execução efetiva (o mutex funciona), mas as chamadas recusadas não voltam como ignoradas.
    - `rc743-operational-gate`: caso `casoXmlWaitIntegrado`. `gate.estaBloqueado656()` fica `false` após um 656 do XmlWait.
- Impacto: regressões reais podem passar despercebidas em Compras e na Central.
- Prioridade: **P2**. Confiança: **comprovado** (execução comparada com cópia de controle).
- Recomendação: sprint de saúde da suíte. Corrigir o ambiente de teste (`navigator`) e classificar cada falha como teste obsoleto ou defeito.
- Aceite: os 19 arquivos passam ou têm defeito registrado com achado próprio.

**AUD-18 — Gate em `CONFIG_ERROR` pode não armar o bloqueio 656**
- Área: A / F.
- Descrição:
  - No `rc743`, o log mostra `SEFAZ_GATE_CONFIG_ERROR` / `Estado: CONFIG_ERROR` antes do caso falhar.
  - No `rc333`, as chamadas recusadas não voltam como ignoradas.
  - Hipótese: com o Gate em `CONFIG_ERROR`, a resposta 656 não registra o bloqueio e as recusas usam outro código.
- Impacto potencial: se ocorrer em produção (configuração fiscal inválida e depois corrigida), novas consultas poderiam ser feitas durante o período de espera, agravando o consumo indevido.
- Prioridade: **P2**. Confiança: **não verificado** (pode ser só o ambiente do teste).
- Recomendação: investigar com o teste `rc743` isolado antes de qualquer alteração no Gate.
- Aceite: causa classificada (teste ou produto) com evidência.

---

## 5. Evidências produzidas nesta auditoria

**Verificação pura (sem banco):** `%TEMP%\cds-aud-central\verif-score-residual.js`. Carrega `MiipIdentificacaoV2Policy` e `MiipResultadoImportacaoMapper` reais da árvore. A entrada é um item POLPA MARACUJA 400G (cProd 1, UN, SEM GTIN) e o candidato #763 com 70, como no doc 264.

| Caso | acao | precisaCadastro | precisaConfirmacao | produtoEncontrado | candidatos | score |
|---|---|---|---|---|---|---|
| Política V2 aplicada; decisão com score 70 | criar_novo | true | false | null | 0 | **70** |
| Política V2 aplicada; decisão sem score | criar_novo | true | false | null | 0 | **70** (de `resultado.score`) |
| Resultado gravado antes da 3.1 (sem reaplicar) | criar_novo | true | false | **763** | 1 | 70 |

O que isso comprova:
- a linha 3 reproduz os campos que a tela recebe nos docs 179/264 (AUD-04, AUD-05);
- as linhas 1 e 2 comprovam o score residual no código novo (AUD-06).

O que **não** comprova: a renderização no Electron, nem quantos documentos além de 179/264 estão afetados.

**Inspeções de código** (somente leitura):
- `miip-central-revisao.js`: contadores, selo, pergunta, comparação, atalhos;
- `MiipResultadoImportacaoMapper.js`;
- `MiipIdentificacaoV2Policy.js`;
- `compras.js`: duplicidade e transações;
- `database.js`: conexão, PRAGMA, schema de `compras`;
- `reservasPublico.js`;
- `CentralRevisaoPersistenteService.js`;
- `central-entradas(-ux).js`: card MIRX, badge.

**Repositório:** `git log`, `git diff --stat`, `git ls-files`, `git check-ignore` e data do `app.asar`. Os caminhos duplicados com barra invertida no `git status` são só exibição: há uma única entrada no índice e `core.ignorecase=true`. Não é achado.

**Resultados reaproveitados** (não reexecutados): regressões das Sprints 3.1–3.4 (seções 21.3, 22.4, 24.5) e as execuções de hoje das Sprints 3.5–3.8 (`rc333`, `rc743`, `rc3753`, `central-entradas-sprint9` falham igual na cópia de controle).

Nenhum teste novo foi adicionado ao repositório. Nenhum banco real ou cópia de banco foi aberto.

---

## 6. Causas comuns e dependências

| Causa comum | Achados | Observação |
|---|---|---|
| Correções sem commit/pacote/homologação | AUD-01, AUD-02, AUD-19 | Precede tudo: corrigir mais sem publicar aumenta o delta não validado |
| Estado do item inferido por flags independentes + resultado gravado nunca recalculado | AUD-04, AUD-05, AUD-06, AUD-07 | Uma única sprint; a reidentificação (AUD-04) só depois do pacote |
| Conexão SQLite compartilhada sem fila de transações | AUD-09, AUD-10 (e riscos de estoque/PIX da auditoria de integridade) | Decisão de arquitetura; investigação experimental em cópia |
| Mensagens técnicas na visão operacional | AUD-12, AUD-13, AUD-15, AUD-16 | Continuação da Sprint 3.5, só apresentação |
| Suíte de testes não confiável | AUD-17, AUD-18 | Necessária para validar as sprints acima |
| Normalização de nome diferente entre pesquisa e MIIP | AUD-20, AUD-21 | Afeta falsos negativos e duplicidade de cadastro |

---

## 7. Plano de sprints recomendado (não executado)

| Ordem | Sprint | Achados | Pré-requisito |
|---|---|---|---|
| 1 | Publicação controlada: commits por sprint, versionar o script, build 1.0.4, homologação no Electron | AUD-01, 02, 19 | — |
| 2 | Estado único do item na revisão + score residual + contadores derivados; depois reidentificar docs afetados (inventário somente leitura antes) | AUD-04 a 07 | 1 |
| 3 | Saúde da suíte (ambiente Node 24, classificar as 19 falhas, investigar Gate `CONFIG_ERROR`) | AUD-17, 18 | — (pode correr em paralelo a 1) |
| 4 | Concorrência: decisão de arquitetura de transações + duplicidade de compra | AUD-09, 10 | 3 |
| 5 | Mensagens técnicas remanescentes (card MIRX, badge, orientação legada, painéis) | AUD-12 a 16 | — |
| 6 | Normalização de nome no MIIP | AUD-20, 21 | 2 |

**Roteiro mínimo de homologação no Electron (sprint 1):**
1. Abrir o doc 264 e conferir a revisão (sem dashboard comercial, "Semelhança X/100", módulo de comparação carregado).
2. Adicionar um XML novo do fornecedor de polpas: nenhum candidato por cProd.
3. Compra manual com produto novo: pesquisar no Cadastro e no PDV logo depois.
4. Central com 656: sem mensagem técnica.
5. Filtro inicial "Em Revisão", painel sem NSU, modo no cabeçalho, menu sem "XML Legado".

---

## 8. Fatos, hipóteses e pontos não verificados

**Fatos comprovados:** AUD-01, 02, 04 (docs 179/264), 05, 06, 07, 08, 12, 13, 14, 15, 17, 19.

**Prováveis (estáticos, sem reprodução):** AUD-09, 10, 20.

**Não verificados / hipóteses:**
- AUD-16 (painéis expandidos?);
- AUD-18 (Gate em `CONFIG_ERROR`);
- AUD-21 (legados sem `nome_busca` na base do cliente);
- quantos dos 228 documentos "Em Revisão" têm resultado gravado com candidato por cProd;
- comportamento das telas em janelas menores que 993 px fora da revisão (a revisão foi medida em 1366×768 na seção 22.2);
- fluxo de cancelamento de NF-e após compra efetivada (o estado CANCELADA existe na máquina de estados, mas o estorno da compra não foi rastreado);
- tratamento de RES_NFE que nunca recebe XML completo após longo período (MIRX coberto por testes de unidade, não por cenário real).

**Fora do escopo desta auditoria, já classificados em `auditoria-integridade-idempotencia-e2e.md`:**
- estoque com dois caixas;
- idempotência de PIX/venda;
- restore de backup inexistente;
- segredos com valor padrão.

**Nenhum código de produção, dado, banco ou configuração alterado. Sem commit.**
