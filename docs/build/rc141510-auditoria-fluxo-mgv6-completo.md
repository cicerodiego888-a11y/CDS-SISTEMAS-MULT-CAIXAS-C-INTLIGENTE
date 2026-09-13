# RC14.15.10-AUDIT — Auditoria forense: MGV6 → TXITENS → CARGA → BALANÇA

**Tipo:** SOMENTE LEITURA  
**Data:** 2026-08-10  
**Alterações de código / banco / TXITENS / TCP:** **0**

---

## 1. Status da auditoria

| Item | Estado |
|------|--------|
| Ambiente SQL | `.\SQL_MGV7` / banco **`MGV6_0001`** acessível (SELECT) |
| Pasta MGV6 neste PC | **`C:\Program Files (x86)\Toledo do Brasil\MGV6`** → **NÃO EXISTE** (`Test-Path` = False) |
| `TXITENS.TXT` no path padrão | **AUSENTE** neste ambiente no momento da auditoria |
| Item `ITN_CODIGO=99` / “TESTE CDS” no SQL | **0 linhas** |
| `tbSituacaoCargaTCP` / `tbLogCargaRemotaTCP` | **0 linhas** |
| Erro UI `modo is not defined` | **LOCALIZADO** (frontend, pós-export) |

**Pergunta central — resposta:**

> O CDS gera `TXITENS.TXT` e faz `spawn(MGV6.exe)` **sem argumentos**, **sem** importação programática, **sem** associação `tbItemBalanca`, **sem** criação/disparo de carga e **sem** leitura de ACK do MGV6.  
> A etapa que falta entre o arquivo e a balança é, no mínimo: **(1) importação do TXITENS pelo MGV6 → SQL**, **(2) associação item↔balança**, **(3) geração/transmissão da carga** — todas **fora do Bridge atual**.  
> O erro `modo is not defined` ocorre **depois** do export/spawn e **não** é a causa da ausência do produto na balança; apenas mascara o sucesso aparente com uma falha de UI.

---

## 2. Fluxo real encontrado (CDS)

```text
UI Enviar Selecionados (modo MGV6)
  → POST /api/equipamentos/mgv6/export
      → MGV6Controller.exportar
      → MGV6SyncService.exportarPorIds / syncProdutos
          → carregar produtos + PLU (produto_identificadores.tipo=PLU)
          → MGV6IdentityResolver (PLU obrigatório + integrar_balanca)
          → MGV6Exporter.exportarProdutos
              → MGV6FileBuilder.buildProdutos (320 chars)
              → escrita atômica TXITENS.TXT
          → MGV6Launcher.launch  [se autoLaunch]
              → spawn(exe, [], {detached, stdio:ignore})
          → resposta HTTP: sucesso + aviso “Aguardando importação/carga…”
  → UI: logs ✔ arquivo / ✔ MGV6 iniciado / ⚠ aguardando
  → UI: “Finalizado”
  → UI: ReferenceError: modo is not defined  ← bug pós-fluxo
```

**Não existe** no CDS etapa: importar TXT no SQL MGV6 · chamar `spAssociaitem` · incrementar/disparar carga · ler `tbSituacaoCargaTCP` / ACK MGV6.

---

## 3. Origem exata de `modo is not defined`

| Campo | Valor |
|-------|--------|
| **Arquivo** | `frontend/erp/js/enviar-produtos-balanca.js` |
| **Função** | `epbEnviarSelecionados` |
| **Linha** | **596** |
| **Variável** | `modo` (não declarada neste escopo) |
| **Deveria ser** | `__epbModoEnvio` (já definido na linha 578: `__epbModoEnvio = await epbObterModoEnvio(id)`) |
| **Trecho** | `const okMsg = modo === 'MGV6' ? ...` |
| **Quem chama** | Clique “Enviar Selecionados” → `epbEnviarSelecionados` |
| **Fluxo** | Após pipeline MGV6 **já concluído** (export + launch) |
| **Antes ou depois do spawn?** | **Depois** (logs mostram arquivo gerado + MGV6 iniciado + “Finalizado”, depois `❌ modo is not defined`) |
| **Interrompe o fluxo MGV6 backend?** | **Não** — o HTTP já retornou sucesso; o `catch` só exibe o erro na UI |
| **Mascara falha anterior?** | **Não mascara falha de export**; mascara o **feedback de sucesso** (usuário vê erro vermelho após operação que já gravou o TXT) |

Evidência alinhada ao log do cliente (16:20:17): sequência termina com `Finalizado` e em seguida `❌ modo is not defined`.

**Nesta RC: NÃO corrigido** (somente documentado).

---

## 4. Fluxo atual do Bridge (por etapa)

| Etapa | Arquivo / função | Entrada | Saída | Confirmação real? |
|-------|------------------|---------|-------|-------------------|
| Seleção UI | `enviar-produtos-balanca.js` `epbEnviarSelecionadosMGV6` | produtoIds, equipamentoId | POST JSON | Log UI |
| Controller | `MGV6Controller.exportar` | body | chama Sync | HTTP |
| Modo | `MGV6ModoEnvio.assertPermitidoExportMgv6` | modo_envio | bloqueia se TCP | Sim (gate) |
| Load produtos | `MGV6SyncService.carregarProdutosPorIds` | IDs | rows + PLU SQL | DB CDS |
| Identidade | `MGV6IdentityResolver.resolverIdentidade` | produto | PLU / erro | Lógica |
| Build | `MGV6FileBuilder.buildProdutos` | produtos | buffer 320×N + CRLF | Bytes |
| Export | `MGV6Exporter.escreverAtomico` | buffer, pasta | arquivo em disco | `fs` + hash |
| Launch | `MGV6Launcher.launch` | config.exe | `{iniciado,pid}` | Só spawn OK |
| Importação MGV6 | — | — | — | **Não implementado** |
| Associação | — | — | — | **Não implementado** |
| Carga / TX | — | — | — | **Não implementado** |
| ACK balança (via MGV6) | — | — | — | **Não implementado** |

Logs “⚠ Aguardando importação/carga pelo MGV6” são **explícitos**: o Bridge **não** declara produto na balança.

---

## 5. Fluxo real do MGV6 (evidência)

Modelo comprovado no SQL `MGV6_0001`:

```text
tbItens (ITN_CODIGO)
  → tbItemBalanca (ITN_CODIGO, BAL_CODIGO, ITB_ESTADO, …)
  → tbBalanca (IP, carga prog/atual, ativa)
  → (transmissão) tbSituacaoCargaTCP / tbLogCargaRemotaTCP / …
```

Procedures de associação presentes (definição lida parcialmente; **não executadas**):

- `spAssociaitem`, `spAssociaitens`, `spAssociaDadosBalancas`, `spAssociacaoAutomatica`, …

Tabelas de carga/transmissão existentes:

- `tbSituacaoCargaTCP`, `tbLogCargaRemotaTCP`, `tbHorariosCargaRemota`, `tbCancelaCarga`, `tbTransacoesBalanca`, …

**Balança ativa atual:**

| Campo | Valor |
|-------|--------|
| `BAL_CODIGO` | **1** |
| `BAL_ENDERECO_IP` | 10.0.0.170 |
| `BAL_PORTA_COMUNICACAO` | 0 |
| `BAL_ATIVA` | 1 |
| `BAL_NUMERO_CARGA_PROG` / `_ATUAL` | **83 / 83** |

---

## 6. Como TXITENS é importado

| Hipótese | Evidência |
|----------|-----------|
| CDS envia argumento de importação ao `MGV6.exe` | **Falso** — `spawn(exeAbs, [], …)` args vazios (`MGV6Launcher.js`) |
| CDS chama procedure/SQL de importação | **Falso** — Bridge não conecta ao SQL MGV6 |
| Abrir `MGV6.exe` importa automaticamente `TXITENS.TXT` | **Não comprovado** neste ambiente |
| Usuário/ação MGV6 “Importar itens” / padrão de arquivo | **Inferido** (prática indústria + docs RC14.15.6; help Toledo trata arquivos de cadastro distintos de Itensmgv) |

**Declaração:** mecanismo exato de ingestão automática do TXT pelo MGV6 ao spawn **não comprovado**. O que está comprovado no CDS: **apenas grava o arquivo e abre o executável**.

Neste PC de auditoria: pasta MGV6 **inexistente**; arquivo TXITENS no path padrão **ausente**. No teste do cliente (16:20), a UI reportou pasta  
`C:\Program Files (x86)\Toledo do Brasil\MGV6\TXT\TXITENS.TXT` — consistente com config do equipamento, mas **não** prova importação SQL.

---

## 7. Como a carga é criada

**Comprovado no schema:**

- `tbBalanca.BAL_NUMERO_CARGA_PROG` / `BAL_NUMERO_CARGA_ATUAL` (ex.: 83/83)
- `tbSituacaoCargaTCP` (colunas: `SCT_SITUACAO_CRWM`, `SCT_TOTAL_REGISTROS`, `SCT_ATUAL`, `SCT_BAL_WM`, …)
- `tbLogCargaRemotaTCP` (colunas: `LCR_BALANCA`, `LCR_COMUNICAO_HANDLE`, `LCR_DESCRICAO`, `LCR_TIPO`, …)

**Estado atual dos dados de carga:**

- `tbSituacaoCargaTCP`: **0 registros**
- `tbLogCargaRemotaTCP`: **0 registros**

**CDS:** não escreve nessas tabelas; não incrementa número de carga; não dispara transmissão.

**Como o MGV6 cria carga a partir do TXT:** **não comprovado** em código CDS (ocorre dentro do produto Toledo).

---

## 8. Como o item é associado à balança

**Comprovado (SELECT em `MGV6_0001`):**

```text
tbItens.ITN_CODIGO
  → tbItemBalanca.ITN_CODIGO / BAL_CODIGO / ITB_ESTADO / ITB_MANUAL / ITB_DATA
  → tbBalanca.BAL_CODIGO
```

Rotinas SQL relevantes (metadata): `spAssociaitem`, `spAssociaitens`, …

**CDS:** checkbox `integrar_balanca` só filtra export TXT. **Não** chama `spAssociaitem` e **não** grava `tbItemBalanca`.

---

## 9. Como a transmissão acontece

**Evidência estrutural:** tabelas TCP de carga/log no MGV6.  
**Evidência operacional neste backup:** logs de carga **vazios**.  
**CDS:** não participa da transmissão MGV6 (modo MGV6 exclusão de TCP Toledo do CDS).

Separação obrigatória:

| Canal | Caminho | ACK no CDS |
|-------|---------|------------|
| **A — TCP direto** | CDS → Driver → ConnectionManager → balança | ACK do protocolo 90AX (ex.: teste PLU 99 em 240 ms) |
| **B — MGV6** | CDS → TXITENS → MGV6 → carga → balança | **Não existe** no Bridge |

O ACK do caminho A **não** prova o caminho B.

---

## 10. Como ACK/resultado é registrado

| Sistema | Registro |
|---------|----------|
| CDS TCP | `produto_balanca_sync_log` / resposta upload-plus |
| CDS MGV6 | `equipamentos_mgv6_exports` (arquivo, hash, `mgv6_iniciado`) — **sem** confirmação de carga |
| MGV6 | `tbLogCargaRemotaTCP`, `tbSituacaoCargaTCP`, `tbLogAplicacao` (`LAP_*`) |

No backup atual: carga/log TCP **vazios** → sem evidência de transmissão recente via MGV6 neste DB.

---

## 11. Evidências do banco `MGV6_0001`

- Conexão: `Cicero-Diego\SQL_MGV7` / `MGV6_0001` OK  
- Balança ativa: `BAL_CODIGO=1`, IP `10.0.0.170`, porta `0`, carga `83/83`  
- Procedures `spAssocia*` presentes  
- Tabelas de carga presentes, **sem linhas** de situação/log  
- Item 99 / TESTE CDS: **não existe** no SQL após o teste CDS reportado  

---

## 12. Evidências do item 39

| Campo | Valor (SELECT atual) |
|-------|----------------------|
| `ITN_CODIGO` | **39** |
| `ITN_DESCRITIVO` | Milho Grão Kg$#$ |
| `ITN_PRECO` | 2.7900 |
| `ITN_EAN` / `ITN_CODIGO_ESPECIAL` | vazio |
| `ITN_INFO_PLU` / `ITN_INFO_PLU2` | **NULL** |
| `ITN_ATIVO` | 1 |
| `ITB_CODIGO` | 39 |
| `BAL_CODIGO` | **1** (balança ativa 10.0.0.170) |
| `ITB_ESTADO` | 1 |
| `ITB_MANUAL` | 0 |
| `ITB_DATA` | 2026-07-30 15:39:05.233 |

---

## 13. Evidências do item 12746

| Campo | Valor |
|-------|--------|
| `ITN_CODIGO` | **12746** |
| `ITN_DESCRITIVO` | Milho Grao$#$ |
| `ITN_PRECO` | 2.5000 |
| `ITN_INFO_PLU` / `PLU2` | **NULL** |
| `ITB_CODIGO` | 97 |
| `BAL_CODIGO` | **1** (mesma balança) |
| `ITB_DATA` | 2026-04-01 10:15:10.760 |

**Conclusão:** 39 e 12746 são **dois itens distintos** no MGV6, ambos associados à balança `BAL_CODIGO=1`.

---

## 14. Comparação CDS × legado

| Etapa | MGV6 legado | CDS atual | Comprovado? |
|-------|-------------|-----------|-------------|
| Cadastro do item | `tbItens` / ERP legado | Produto CDS | Sim (modelos diferentes) |
| PLU / código item | `ITN_CODIGO` (INFO_PLU NULL nos casos) | `produto_identificadores.tipo=PLU` | Sim (semântica alinhada RC14.15.8/9) |
| Integrar balança | associação `tbItemBalanca` (+ SPs) | checkbox → filtro export | Parcial (CDS não associa) |
| TXITENS | arquivo importável | gera TXITENS 320 | Sim (geração) |
| Importação | processo MGV6 (UI/serviço) | **só spawn exe** | Importação **não** no CDS |
| Associação | `spAssociaitem` / `tbItemBalanca` | ausente | Sim ausência |
| Carga | `BAL_NUMERO_CARGA_*` + tabelas TCP | ausente | Sim ausência |
| Transmissão | pipeline MGV6 TCP interno | ausente no modo MGV6 | Sim ausência |
| ACK | logs carga MGV6 | aviso “aguardando…” | Sem ACK MGV6 no CDS |
| Balança | `tbBalanca` IP/porta/carga | equipamento CDS (config pasta/exe) | Paths distintos |

---

## 15. Pontos comprovados

1. Bug UI `modo` vs `__epbModoEnvio` na linha 596 de `enviar-produtos-balanca.js` (pós-sucesso).  
2. Bridge termina em: **TXT + spawn opcional**.  
3. `spawn` sem argumentos, `stdio:'ignore'`, `detached:true`, sem wait de exit code.  
4. Layout TXITENS do CDS para PLU 99 (fixture): `01000000099000299000TESTE CDS SISTEMAS` + pad 320 + CRLF.  
5. SQL: itens 39 e 12746 distintos; balança 1 @ 10.0.0.170; carga 83/83.  
6. Item 99 **não** entrou em `tbItens` neste backup.  
7. Tabelas de situação/log de carga vazias.  
8. TCP direto e MGV6 são pipelines mutuamente exclusivos (`modo_envio`).

---

## 16. Pontos não comprovados

1. Se o `MGV6.exe` do cliente, ao abrir, importa automaticamente `TXT\TXITENS.TXT`.  
2. Se o arquivo gerado às 16:20 ainda existia/foi consumido/apagado.  
3. Sequência interna exata MGV6: Importar → Associar → Gerar carga → Transmitir (ordem/UI/comandos).  
4. Conteúdo byte-a-byte do arquivo gerado às 16:20 neste ambiente (pasta MGV6 ausente aqui).  
5. Se `BAL_PORTA_COMUNICACAO=0` implica canal específico de carga (não TCP 9000 do CDS).

---

## 17. Divergências

| Tema | Divergência |
|------|-------------|
| Expectativa usuário | “Enviar” = produto na balança |
| Realidade Bridge | “Enviar” = arquivo + abrir MGV6 |
| Integrar (CDS) | Gate de export |
| Integrar (MGV6) | Linha em `tbItemBalanca` |
| ACK TCP CDS | Prova só do canal A |
| Erro UI `modo` | Ruído pós-sucesso, não causa raiz da balança |

---

## 18. Causa raiz provável

O Bridge MGV6 do CDS está **implementado apenas até a geração do arquivo (e spawn do exe)**.  
Faltam as etapas do ecossistema MGV6 que realmente colocam o item na balança: **importação → associação → carga → transmissão**.

O erro `modo is not defined` é um **defeito de UI secundário** que ocorre depois do fluxo e não explica a ausência na balança.

---

## 19. Causa raiz comprovada

**Comprovado por código:**

1. Nenhuma chamada além de `spawn(MGV6.exe, [])` após gravar TXT.  
2. Nenhuma integração com SQL MGV6 / `spAssocia*` / tabelas de carga.  
3. Resposta oficial do Sync: *“Não declara produto enviado à balança.”*

**Comprovado por dados:**

4. Após o teste reportado (PLU 99), `ITN_CODIGO=99` **não existe** em `MGV6_0001`.  
5. Sem registros em `tbSituacaoCargaTCP` / `tbLogCargaRemotaTCP`.

Portanto, **comprovado**: o produto não chega à balança pelo fluxo MGV6 porque o CDS **não executa (nem verifica) a cadeia pós-TXITENS** — e, neste backup, o item de teste **nem chegou a existir** no SQL do MGV6.

---

## 20. Recomendação para próxima RC

**Não misturar com TCP oficial.**

Prioridade sugerida (implementação futura — **fora desta auditoria**):

1. **RC rápida (UI):** corrigir `modo` → `__epbModoEnvio` para não alarmar falso negativo após export.  
2. **RC operacional MGV6:**  
   - documentar/operacionalizar o passo humano ou automatizado de **Importar TXITENS** no MGV6;  
   - verificar pós-export se `ITN_CODIGO` aparece no SQL (quando houver acesso) e/ou se o arquivo permanece/some;  
   - **não** declarar sucesso de balança só com spawn.  
3. **Investigar com MGV6 aberto no PC do cliente:**  
   - padrão de arquivo = TXITENS.TXT;  
   - se há “carga automática” / horário (`tbHorariosCargaRemota`, `tbCfgEscolhaManualCargaAutomatica`);  
   - se associação automática existe após import (`spAssociacaoAutomatica`).  
4. **Homologação:** PLU 99 → import manual no MGV6 → conferir `tbItens`/`tbItemBalanca` → transmitir carga → confirmar na balança — separado do TCP CDS.

---

## Apêndice A — Layout esperado PLU 99 (código/fixture)

Registro lógico (320 chars + CRLF externo):

```text
01 000000099 000299000 TESTE CDS SISTEMAS + espaços
│  │         │         └─ D1 descrição
│  │         └─ PPPPPP+VVV (2,99 → 000299 + 000)
│  └─ TT+Z+CCCCCC (PLU 99 → 000000099 ⇒ CCCCCC=000099)
└─ DD departamento
```

Fixture CDS: `tests/fixtures/mgv6/real-client/TXITENS.TXT`.

---

## Apêndice B — Spawn (código)

`MGV6Launcher.launch`:

- `child_process.spawn`
- args: `[]`
- `shell: false`, `detached: true`, `stdio: 'ignore'`, `windowsHide: true`
- `cwd` = pasta do TXT
- `unref()` — CDS não espera o processo
- **não** lê stdout/stderr/exit code além do evento `error` imediato

---

## Entrega

**RC14.15.10-AUDIT — CONCLUÍDA (SOMENTE LEITURA — SEM ALTERAÇÕES)**

**Relatório:** `docs/build/rc141510-auditoria-fluxo-mgv6-completo.md`
