# RC14.15.19 — Correção do launcher MGV6 via ShellExecute

**Status:** CONCLUÍDA  
**TXITENS / PLU / SQL / TCP:** inalterados  
**Carga:** MANUAL  

---

## Problema (RC14.15.18)

```text
spawn(exeAbs) → CreateProcess → EACCES → MGV6 não abre
```

Causa mais provável: MGV6 exige elevação/UAC; `CreateProcess` não mostra UAC.

## Solução

Launcher primário:

```text
Electron shell.openPath(exeAbs)  →  ShellExecute  →  UAC do Windows (se necessário)
```

`child_process.spawn` **não** é mais o launcher.

## Arquivos

| Arquivo | Mudança |
|---------|---------|
| `MGV6Launcher.js` | `shell.openPath` / `openPath` injetável |
| `MGV6SyncService.js` | sucesso sem PID; logs “aberto pelo Windows” |
| `MGV6Errors.js` | `MGV6_EXECUTABLE_NOT_FOUND` |
| `electronDialogoService.js` | `abrirCaminhoComShell` |
| `enviar-produtos-balanca.js` | mensagens sem PID |

## Resposta de sucesso

```json
{
  "sucesso": true,
  "iniciado": true,
  "metodo": "shell-execute",
  "pid": null,
  "path": "C:\\Program Files (x86)\\Toledo do Brasil\\MGV6\\MGV6.exe"
}
```

## Logs

```text
✔ MGV6 aberto pelo Windows
ℹ A carga da balança é realizada manualmente no MGV6.
```

## Teste manual (cliente)

Exportar → “Deseja iniciar…?” → **Sim** → UAC se necessário → MGV6 visível → Carga manual.
