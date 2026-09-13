# RC14.15.17 — Correção definitiva da execução do MGV6.exe

**Status:** CONCLUÍDA  
**TXITENS / PLU / SQL / TCP:** inalterados  

---

## Causa (RC14.15.16)

1. `windowsHide: true` — GUI oculta  
2. `cwd = pasta do TXITENS`  
3. Sucesso otimista no mesmo tick do `spawn()` (sem PID estável)

## Alterações

| Arquivo | Mudança |
|---------|---------|
| `MGV6Launcher.js` | `windowsHide: false`; `cwd = dirname(exe)`; listeners `spawn`/`error`/`exit`; estabilidade 400 ms; `unref` só após sucesso; PID obrigatório |
| `MGV6SyncService.js` | não passa mais `cwd` da pasta TXT; `iniciarMgv6` exige PID; propaga falha |
| `MGV6Controller.js` | HTTP 500 + `sucesso:false` quando launch falha |
| `enviar-produtos-balanca.js` | sucesso só com `iniciado===true` e PID; mensagem de erro clara |

## Parâmetros finais do spawn

```text
spawn(exeAbs, [], {
  shell: false,
  cwd: path.dirname(exeAbs),   // pasta do MGV6
  detached: true,
  stdio: 'ignore',
  windowsHide: false           // GUI visível
})
```

## Tratamento

```text
spawn → PID válido → aguarda estabilidade (sem exit) → unref → iniciado:true
error → iniciado:false + código (ENOENT/EACCES/EPERM/…)
exit imediato → "MGV6 encerrou imediatamente" → falha
PID ausente → falha (nunca sucesso)
```

## Teste manual (PC com MGV6 instalado)

1. Exportar produto → TXITENS válido  
2. “Deseja iniciar o software da balança?” → **Sim**  
3. MGV6 abre **visível**  
4. Task Manager: `MGV6.exe` com PID retornado  

**Não** → MGV6 não inicia.

## Suites

`test:mgv6-execucao-v1` + regressões MGV6/TCP.
