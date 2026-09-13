# RC14.15.16-AUDIT — Auditoria da execução do MGV6.exe

**Status:** CONCLUÍDA (SOMENTE LEITURA)  
**Alterações de código:** 0  
**Alterações de banco:** 0  
**Migration:** NÃO  
**TXITENS / MGV6 / TCP:** NÃO ALTERADOS  

---

## 0. Veredito — CAUSA EXATA (mais provável)

O CDS **encontra** o EXE e **chama** `child_process.spawn`, mas declara sucesso de forma **otimista e prematura**, e inicia o processo com opções hostis a um aplicativo GUI Windows:

| Fator | Evidência no código | Efeito |
|--------|---------------------|--------|
| **`windowsHide: true`** | `MGV6Launcher.js` L63 | Em Windows, esconde a janela do subprocesso. Para um EXE com UI (MGV6), o processo pode “iniciar” sem o operador ver a janela. |
| **Sucesso = spawn retornou objeto** | Resolve `iniciado: true` no mesmo tick, **antes** de aguardar falha assíncrona | UI mostra `✔ MGV6 iniciado` mesmo se o processo morrer ou falhar logo em seguida. |
| **`settled = true` imediato** | Após registrar `error`, já marca settled e `resolve` | Listener `error` **não rejeita** depois — erro tardio só vai para log de `exit`, se houver. |
| **`cwd = exportFolder` (pasta TXT)** | `iniciarMgv6` → `cwd: cfg.exportFolder` | Não é o diretório do EXE (`…\MGV6\`). Pode afetar INI/relativos; DLLs costumam resolver pela pasta do EXE, mas cwd errado permanece risco. |
| **`detached: true` + `unref()`** | Launcher | CDS não acompanha o processo; falha silenciosa para o operador. |
| **`stdio: 'ignore'`** | Launcher | Sem stdout/stderr capturados para diagnóstico. |

**Não é** (nesta cadeia) falha de localização do arquivo: o log `✔ MGV6 encontrado: C:\Program Files (x86)\Toledo do Brasil\MGV6\MGV6.exe` prova que `validarExecutavel` passou.

**Diferença crítica auditada:**

```text
ARQUIVO EXISTE  ≠  PROCESSO VISÍVEL / UI ABERTA
spawn() chamado ≠  MGV6 utilizável pelo operador
HTTP 200 + iniciado:true ≠  janela MGV6 na tela
```

---

## 1. Frontend — diálogo e botão SIM

| Item | Valor |
|------|--------|
| Arquivo | `frontend/erp/js/enviar-produtos-balanca.js` |
| Diálogo | `epbPerguntarIniciarSoftwareBalanca()` — título **Aviso**, mensagem **Deseja iniciar o software da balança?** |
| Botão SIM | `#epbBtnMgv6Sim` → `finish(true)` |
| Botão NÃO | `#epbBtnMgv6Nao` / dismiss → `finish(false)` |
| Fluxo | `epbEnviarSelecionadosMGV6` → após export → se `mgv6.encontrado` → pergunta → se SIM → **POST** |

### Request ao clicar SIM

```http
POST {API_URL}/equipamentos/mgv6/launch
Content-Type: application/json
Authorization: Bearer <token>

{ "equipamentoId": <id> }
```

### Tratamento da resposta

Sucesso UI (`✔ MGV6 iniciado`) quando:

- `launchResp.ok` **e**
- `launchBody.sucesso !== false` **e**
- `launchBody.iniciado !== false`

Ou seja: confia no JSON do backend (`iniciado: true`).  
Falha: loga aviso, **não** afirma início.

Também em `frontend/erp/js/produtos.js` (envio unitário): mesmo POST `/launch` após confirm.

**Conclusão:** o botão SIM **dispara** o POST (pelo código). Se no DevTools o request não aparecer, investigar se `desejaIniciar` ficou `false` (modal/`hidden.bs.modal`) — há flag `settled` para evitar double-resolve; SIM deve prevalecer se clicado primeiro.

---

## 2. Backend — rota e serviços

| Camada | Arquivo | Função |
|--------|---------|--------|
| Mount | `backend/rotas/equipamentos.js` | `router.use('/mgv6', MGV6Routes())` → `/api/equipamentos/mgv6/*` |
| Rota | `backend/motores/equipamentos/mgv6/MGV6Routes.js` | `POST /launch` → `ctrl.iniciar` |
| Controller | `MGV6Controller.js` → `iniciar` | lê `equipamentoId`, chama sync |
| Serviço | `MGV6SyncService.js` → `iniciarMgv6` | valida EXE + `launch({ autoLaunch: true }, { cwd: exportFolder })` |
| Spawn | `MGV6Launcher.js` → `launch` | `child_process.spawn` |
| Validação path | `MGV6Validator.js` → `validarExecutavel` | exists + isFile + `.exe` absoluto |

Resposta de sucesso atual:

```json
{
  "sucesso": true,
  "iniciado": true,
  "pid": <number|null>,
  "path": "<exeAbs>",
  "motivo": null,
  "aviso": "A carga da balança é realizada manualmente no MGV6.",
  "transmitidoBalanca": false
}
```

---

## 3. Spawn — parâmetros exatos (código atual)

Implementação: **`child_process.spawn`** (não `exec` / `execFile`).

```text
comando:     <mgv6Executable absoluto validado>
argumentos:  []
cwd:         cfg.exportFolder   // pasta do TXITENS, NÃO dirname(exe)
detached:    true
windowsHide: true          ← crítico para GUI
shell:       false
stdio:       'ignore'
windowsVerbatimArguments: (default / não setado)
```

Listeners:

| Evento | Presente? | Comportamento |
|--------|-----------|---------------|
| `error` | Sim (`once`) | Rejeita **somente se** `!settled` |
| `exit` | Sim (`once`) | Só `console.log` |
| `spawn` | Não | — |
| `close` | Não | — |

Ordem problemática:

1. `spawn(...)`  
2. registra `error` / `exit`  
3. `unref()`  
4. **`settled = true`**  
5. `resolve({ iniciado: true, pid })`  

Qualquer `error` assíncrono **depois** do passo 4 é ignorado para a Promise (UI já recebeu sucesso).

---

## 4. Critério atual de “✔ MGV6 iniciado”

```text
spawn() não lançou exceção síncrona
  → Promise resolve iniciado:true
    → HTTP 200 JSON
      → frontend loga "✔ MGV6 iniciado"
```

**Não exige:**

- janela visível;
- processo ainda vivo após N ms;
- ausência de `exit` imediato;
- `child.pid` não-nulo (PID só é logado **se** existir; ausência de PID não falha o fluxo).

Isso explica log positivo **sem** o operador ver o MGV6.

Sobre **`PID: ?`** (log antigo): versão anterior fazia `child?.pid \|\| '?'`. A RC14.15.12 removeu o `?`; se o PID não existir, a linha de PID simplesmente **não é impressa**. `pid === undefined/null` após spawn costuma indicar falha de criação ou objeto inválido — mas o sucesso otimista ainda pode ter sido reportado na versão antiga com `?`.

---

## 5. Working directory

| Fonte | Valor |
|-------|--------|
| Código | `cwd = cfg.exportFolder` (pasta configurada do TXITENS) |
| Doc RC14.15.10 | `cwd` = pasta do TXT |
| Diretório do EXE | `path.dirname(exe)` → tipicamente `C:\Program Files (x86)\Toledo do Brasil\MGV6\` |

**Não inventado:** não há no repositório prova de que o legado usa exatamente `cwd = pasta do EXE`. Há evidência de que o CDS usa a **pasta TXT**.  
Risco: INI/arquivos relativos ao CWD; menos comum para DLL (Windows procura primeiro o diretório do executável).

---

## 6. Dependências / UAC / execução manual

### Nesta máquina de auditoria (Cursor)

```text
C:\Program Files (x86)\Toledo do Brasil\MGV6\MGV6.exe  → NÃO EXISTE
```

Não foi possível:

- abrir manualmente o EXE;
- ler manifest/UAC do binário;
- obter PID real via spawn diagnóstico.

### No computador do cliente (onde o log mostrou “encontrado”)

Reproduzir obrigatoriamente (checklist operacional):

1. Explorer: duplo clique no EXE → abre? UAC? fecha?  
2. Comparar Task Manager: processo `MGV6.exe` após “Sim” no CDS.  
3. DevTools Network: POST `/api/equipamentos/mgv6/launch` → status + body (`iniciado`, `pid`).  
4. Log do backend: `Iniciando MGV6` / `✔ MGV6 iniciado` / `Processo MGV6 encerrou (exit=…)`.

Dependências típicas de instalação Toledo (observação genérica, **não comprovada** aqui): DLLs na pasta MGV6, INI, SQL/local DB, registro — qualquer falha de runtime pode matar o processo sem a Promise do CDS falhar.

---

## 7. Teste isolado Node (auditoria)

Comando diagnóstico executado (sem alterar runtime):

- EXE ausente nesta VM → trials de spawn **não rodaram**.
- Script preparado para comparar: (a) flags atuais CDS (`windowsHide:true`, cwd TXT), (b) `windowsHide:false` + cwd pasta MGV6, (c) `shell:true`.

**No cliente**, rodar o equivalente e registrar `pid_immediate`, `error.code`, `exit`.

---

## 8. Respostas objetivas (aceite)

| # | Pergunta | Resposta |
|---|----------|----------|
| 1 | SIM dispara POST? | **Sim** (código): `POST …/mgv6/launch` com `{ equipamentoId }` |
| 2 | POST chega ao backend? | **Sim**, se a UI chamar — rota montada em `equipamentos.js` |
| 3 | Backend encontra EXE? | **Sim**, quando config aponta ao path válido (`validarExecutavel`) — log já comprovou |
| 4 | spawn é chamado? | **Sim** — `child_process.spawn(exeAbs, [], opts)` |
| 5 | Parâmetros? | args `[]`, `shell:false`, `detached:true`, `stdio:'ignore'`, **`windowsHide:true`** |
| 6 | cwd? | **`cfg.exportFolder`** (TXT), não necessariamente pasta do EXE |
| 7 | PID? | Pode existir; se null, UI/backend ainda podem reportar iniciado; log antigo podia mostrar `?` |
| 8 | Erro de spawn? | Listener existe, mas **corrida** com `settled=true` impede rejeitar após sucesso |
| 9 | Qual erro? | **Não capturado nesta VM** (EXE ausente). No cliente: olhar `exit` no log e Task Manager |
| 10 | Abre manualmente? | **Não testável aqui**; checklist §6 no PC do cliente |
| 11 | UAC? | Manifest não lido aqui; se `requireAdministrator`, spawn sem elevação pode falhar/silenciar |
| 12 | cwd? | CDS usa pasta TXT — risco relativo |
| 13 | DLL/config? | Possível; pasta do EXE normalmente contém deps — não alterado |
| 14 | Por que diz iniciado sem ver o programa? | **Sucesso otimista** + **`windowsHide:true`** (+ possível death imediata sem falhar a Promise) |
| 15 | Correção mínima? | Ver §9 |

---

## 9. CORREÇÃO MÍNIMA RECOMENDADA (NÃO IMPLEMENTAR NESTA RC)

Ordem sugerida (cirúrgica, só launcher/sync):

1. **`windowsHide: false`** ao iniciar aplicativo GUI (`MGV6.exe`).  
2. **`cwd = path.dirname(exeAbs)`** (pasta do MGV6), mantendo TXITENS na pasta configurada — **não** mudar layout/TXT.  
3. **Não marcar sucesso até:**  
   - próximo tick / ~300–500 ms sem `error` e sem `exit` imediato; **ou**  
   - evento `spawn` + `pid` numérico válido.  
4. Se `error` / exit rápido → `iniciado: false` + mensagem clara (não `✔ MGV6 iniciado`).  
5. Opcional Windows: `shell.openPath(exeAbs)` / `cmd /c start "" "path"` apenas se spawn continuar invisível — avaliar em RC de correção.

**Não** (proibições da RC): copiar EXE, alterar registro/UAC, SQL, TCP, carga automática, TXITENS.

---

## 10. Hipóteses ordenadas

1. **`windowsHide: true`** → processo sobe oculto / sem UI perceptível.  
2. **Sucesso prematuro** → UI mente se o processo aborta em seguida.  
3. **cwd = TXT** → falha de config relativa (secundário).  
4. **UAC / permissão** → falha só via Node (manual Explorer ok) — a confirmar no cliente.  
5. **POST não disparado** — improvável pelo código; validar Network se sintoma persistir após corrigir launcher.

---

## 11. Proibições respeitadas

- Código de produção: **0 alterações**  
- Banco / migration: **0**  
- TXITENS / TCP / SQL MGV6 / carga: **intocados**  
- Sem cópia de EXE / alteração de registro / UAC  

---

## 12. Entrega

**RC14.15.16-AUDIT — CONCLUÍDA**

Relatório: `docs/build/rc141516-auditoria-execucao-mgv6.md`

**CAUSA EXATA (síntese):** o CDS trata `spawn()` otimista com `windowsHide: true` e `cwd` da pasta TXT como “MGV6 iniciado”, sem garantir processo visível/estável — por isso o log afirma sucesso enquanto o operador não vê o programa.

**CORREÇÃO MÍNIMA:** `windowsHide: false` + `cwd = dirname(exe)` + sucesso só com PID estável / sem erro-exit imediato.
