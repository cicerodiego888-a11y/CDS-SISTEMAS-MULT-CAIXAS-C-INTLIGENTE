# RC14.15.18-AUDIT — Investigação EACCES na execução do MGV6

**Status:** CONCLUÍDA (SOMENTE LEITURA)  
**Código alterado:** 0  
**Banco / TXITENS / TCP / MGV6:** 0 alterações  

---

## 0. Evidência do cliente (fato)

```text
17:36:53 ✔ MGV6 encontrado
17:36:53 Aguardando decisão do usuário para iniciar MGV6...
17:36:55 ❌ Não foi possível iniciar o MGV6.
17:36:55 Motivo: spawn C:\Program Files (x86)\Toledo do Brasil\MGV6\MGV6.exe EACCES
17:36:55 Código: MGV6_LAUNCH_FAILED
```

| Etapa | Resultado |
|-------|-----------|
| Localização do EXE | **OK** (`validarExecutavel` passou) |
| Clique SIM / POST `/launch` | **OK** (chegou ao launcher) |
| `CreateProcess` via `spawn` | **RECUSADO** → `EACCES` |
| Processo MGV6 criado | **NÃO** |

Mensagem `spawn <path> EACCES` é o formato clássico do Node/`libuv` no evento `error` do `ChildProcess` quando `CreateProcessW` falha com acesso negado / elevação.

---

## 1. Spawn atual (código — sem alteração)

Arquivo: `backend/motores/equipamentos/mgv6/MGV6Launcher.js` (RC14.15.17)

```text
child_process.spawn(exeAbs, [], {
  shell: false,
  cwd: path.dirname(exeAbs),   // pasta do MGV6
  detached: true,
  stdio: 'ignore',
  windowsHide: false
})
```

| Opção | Valor | Comentário |
|-------|--------|------------|
| API | `spawn` → **CreateProcess** (não ShellExecute) | Não dispara diálogo UAC |
| `shell` | `false` | Correto como 1ª linha; não usa `cmd` |
| `cwd` | pasta do EXE | Já corrigido na RC14.15.17 |
| `windowsHide` | `false` | Já corrigido |
| `env` | default do processo pai | Sem override |
| `uid`/`gid` | N/A (Windows) | — |
| Wrapper | nenhum `.bat`/`.cmd` no CDS | Path absoluto do EXE |

Cadeia:

```text
UI SIM
 → POST /api/equipamentos/mgv6/launch
 → MGV6Controller.iniciar
 → MGV6SyncService.iniciarMgv6
 → MGV6Launcher.launch
 → spawn(exeAbs, …)
 → child 'error' { code: 'EACCES', syscall: 'spawn', path: '…\MGV6.exe' }
 → MGV6_LAUNCH_FAILED
 → UI: ❌ Não foi possível iniciar o MGV6
```

---

## 2. Processo pai (CDS)

Evidência de código (`electron.js`):

```text
const server = require('./backend/server');
```

O backend **não** é um Windows Service separado: roda **dentro do processo Electron** (Node embutido no Electron).

| Item | Nesta máquina de auditoria | No cliente |
|------|----------------------------|------------|
| `process.execPath` | `…\nodejs\node.exe` (Cursor/CLI) | tipicamente `…\CDS….exe` / Electron |
| Plataforma | `win32` / `x64` | win32 (evidência do path Program Files x86) |
| Elevação do CDS | não medida no cliente | **a confirmar** (Task Manager → CDS → Elevated?) |

Implicação: o token de segurança do `spawn` é o **mesmo** do Electron (usuário normal ou admin).  
`CreateProcess` **não** eleva o filho automaticamente.

---

## 3. Testes no ambiente de auditoria (Cursor)

| Verificação | Resultado |
|-------------|-----------|
| EXE existe | **NÃO** — `C:\Program Files (x86)\Toledo do Brasil\MGV6\MGV6.exe` ausente nesta máquina |
| icacls / Zone.Identifier / manifest binário | **Não executáveis** aqui |
| Explorer / PowerShell normal / Admin | **Não executáveis** aqui |
| Atalhos Start Menu/Desktop `*MGV6*.lnk` | não aplicável sem instalação |

Portanto: permissões NTFS, MoTW, UAC real e execução manual **dependem do PC do cliente**. A classificação abaixo combina (A) sintoma do log, (B) código CDS, (C) comportamento documentado Node/Windows.

---

## 4. Pergunta principal

> Por que Explorer abre `MGV6.exe`, mas `spawn()` do Electron recebe `EACCES`?

### Mecanismo Windows relevante

| Origem | API típica | Comportamento se EXE exige elevação |
|--------|------------|-------------------------------------|
| Explorer / atalho / `ShellExecute` | ShellExecuteEx | Pode mostrar **UAC**; se o usuário aceitar, o processo sobe elevado |
| Node/Electron `child_process.spawn` | **CreateProcess** | **Não** mostra UAC; falha imediata → Node reporta **`EACCES`** ou `UNKNOWN` |

Referência canônica: [nodejs/node#9464](https://github.com/nodejs/node/issues/9464) — *“spawn … if exe requires elevation”* → CreateProcess falha; ShellExecute funcionaria com prompt UAC.

Isso casa **exatamente** com o sintoma:

1. Arquivo encontrado (existência/leitura OK).  
2. `spawn` falha com `EACCES` **antes** de PID.  
3. Operador provavelmente abre o MGV6 pelo Explorer/atalho (ShellExecute).

### Classificação da causa

| Hipótese | Status |
|----------|--------|
| **Elevação/UAC + Manifest (`requireAdministrator` / `highestAvailable`)** | **CAUSA MAIS PROVÁVEL** (padrão sintoma + CreateProcess) — **comprovação final no cliente**: ler manifest / comparar Explorer vs spawn |
| Permissão NTFS (DENY / sem RX) | Possível, mas **menos provável** se Explorer no **mesmo usuário** abre o EXE |
| Windows Security / Controlled Folder Access / AV bloqueando CreateProcess do Electron | Possível secundário — verificar Protection History no cliente |
| Processo pai (CDS não elevado) | **Contribui** se o MGV6 exige admin: pai unelevated + CreateProcess = EACCES |
| Caminho/cwd | **Improvável como EACCES** — path existe; cwd já é pasta do EXE |
| Wrapper/atalho no CDS | **Não** — CDS chama o `.exe` absoluto |
| Política AppLocker/WDAC | Possível em ambiente corporativo — a checar no cliente |
| DLL ausente | Em geral **outro** sintoma (exit rápido / erro de load), não EACCES no `spawn` |

**Causa comprovada nesta máquina de auditoria:** não — EXE ausente.  
**Causa comprovada pelo sintoma + modelo Windows/Node:** falha de `CreateProcess` por **acesso/elevação** (`EACCES`), tipicamente EXE que exige elevação ou política que bloqueia criação de processo a partir do Electron.

---

## 5. Checklist obrigatório no PC do cliente (somente leitura)

Executar e colar resultados em adendo futuro:

```powershell
$exe = 'C:\Program Files (x86)\Toledo do Brasil\MGV6\MGV6.exe'

# 1) Propriedades
Get-Item $exe | Select FullName,Length,CreationTime,LastWriteTime,Attributes
(Get-Item $exe).VersionInfo | Format-List

# 2) ADS / Mark of the Web
Get-Item $exe -Stream * -ErrorAction SilentlyContinue

# 3) NTFS
icacls $exe
icacls (Split-Path $exe)

# 4) Manifest (string)
Select-String -Path $exe -Pattern 'requestedExecutionLevel|asInvoker|requireAdministrator|highestAvailable' -Encoding byte -ErrorAction SilentlyContinue
# ou mt.exe / strings no PE

# 5) Execução manual Explorer — anotar: abre? UAC?

# 6) PowerShell NORMAL (mesmo usuário do CDS)
& $exe

# 7) PowerShell ADMIN
& $exe

# 8) CDS elevado?
# Task Manager → detalhes → CDS/Electron → Elevated column
```

Interpretação:

| Resultado | Interpretação |
|-----------|----------------|
| Explorer abre com UAC; spawn EACCES | **Confirma elevação + CreateProcess** |
| Explorer abre **sem** UAC; spawn EACCES | Preferir AV/política/AppLocker; ainda assim CreateProcess bloqueado |
| Só Admin abre; usuário normal falha também no Explorer | NTFS / política de usuário |
| Zone.Identifier presente | MoTW — possível bloqueio SmartScreen (menos clássico como EACCES no spawn) |

---

## 6. Dependências / antivírus

- Pasta típica MGV6 contém DLLs/INI/SQL client — relevantes para **após** o processo iniciar.  
- EACCES no `spawn` ocorre **antes** do loader carregar DLLs → priorizar elevação/política, não “falta de DLL”.  
- Windows Defender / Controlled Folder Access: verificar **Protection history** se o checklist de UAC/manifest for negativo.

---

## 7. Wrapper / atalho

- CDS: **sem** wrapper — `spawn(exeAbs, [])`.  
- Operador pode usar atalho `.lnk` com “Executar como administrador” — isso explica Explorer/atalho OK e spawn falho. Verificar propriedades do atalho no cliente (Destino, “Executar este programa como administrador”).

---

## 8. Correção recomendada (NÃO IMPLEMENTAR NESTA RC)

Ordem sugerida após confirmar checklist no cliente:

1. **Se manifest exigir admin / UAC no Explorer:**  
   - Abrir via API estilo **ShellExecute** (ex.: `shell.openPath(exeAbs)` no processo Electron, ou `cmd /c start "" "path"` / utilitário elevate), **não** `CreateProcess` puro;  
   - Ou documentar: “execute o CDS como Administrador” (pior UX).  

2. **Se NTFS/DENY:** ajustar ACL do usuário (TI) — fora do código CDS.  

3. **Se AV/CFA:** exclusão do CDS/MGV6 (TI).  

4. **Não** como 1ª opção cega: `shell: true` sem entender UAC; pode mascarar ou abrir prompt inconsistente.

Manter: TXITENS na pasta TXT; sem SQL MGV6; sem carga automática; sem TCP.

---

## 9. Respostas do aceite

| # | Item | Resultado |
|---|------|-----------|
| 1 | Evidência EACCES | Log cliente + `child.on('error')` no launcher |
| 2 | NTFS | **Não medido aqui** (EXE ausente) — checklist §5 |
| 3 | Execução manual | **Não medido aqui** — checklist |
| 4 | CMD/PowerShell normal | **Não medido aqui** — checklist |
| 5 | PowerShell Admin | **Não medido aqui** — checklist |
| 6 | UAC | **Hipótese principal**; confirmar no cliente |
| 7 | Manifest | **A ler no cliente**; se `requireAdministrator` → causa fechada |
| 8 | Processo pai | Electron embute backend → mesmo token; CreateProcess |
| 9 | Spawn atual | `shell:false`, `cwd=dirname(exe)`, `windowsHide:false`, `detached:true` |
| 10 | cwd | Pasta do MGV6 (OK pós-RC14.15.17) |
| 11 | Wrapper CDS | Nenhum |
| 12 | Dependências | Improváveis para EACCES pré-PID |
| 13 | Windows Security | A checar se UAC/manifest negativos |
| 14 | Causa provável | **CreateProcess bloqueado por elevação/UAC (ou política equivalente)** |
| 15 | Causa comprovada | Sintoma compatível; **prova binária no cliente pendente** |
| 16 | Correção recomendada | ShellExecute / openPath (ou elevação consciente), após confirmar manifest/UAC |

### Checkbox da RC

- [x] Elevação/UAC — **mais provável**  
- [ ] Manifest do MGV6 — **a confirmar no cliente**  
- [ ] Permissão NTFS — secundário / checklist  
- [ ] Windows Security/antivírus — secundário / checklist  
- [x] Processo pai — Electron + CreateProcess (contribuinte)  
- [ ] Caminho/cwd — improvável para este EACCES  
- [ ] Wrapper/launcher CDS — não  
- [ ] Política Windows — possível  
- [ ] Outro — se checklist negar UAC  

---

## 10. Entrega

**RC14.15.18-AUDIT — CONCLUÍDA**

```text
Código alterado: 0
Banco alterado: 0
TXITENS alterado: 0
TCP alterado: 0

EACCES:
CreateProcess (spawn) recusado pelo Windows — tipicamente elevação/UAC
(manifest requireAdministrator) ou política que bloqueia criação do processo
a partir do Electron; Explorer usa ShellExecute e pode funcionar.

EXECUÇÃO MANUAL / CMD / ADMIN / NTFS / MANIFEST:
Não medidos nesta máquina (MGV6.exe ausente).
Checklist §5 obrigatório no PC do cliente.

PROCESSO PAI:
Electron → require(backend/server) → mesmo processo/token → spawn CreateProcess

CORREÇÃO RECOMENDADA (próxima RC, NÃO agora):
Abrir MGV6 via ShellExecute/shell.openPath (ou fluxo com UAC explícito)
após confirmar manifest/UAC no cliente — não insistir só em spawn CreateProcess.
```
