# SPRINT 51.48 — Verificação pós-51.47 (erro `node:sqlite` × SUCESSO_RECUPERACAO)

**Data:** 2026-11-10  
**Natureza:** somente leitura — sem runner, DLL, NativeHost, INIT, FINALIZE, CRT, permit ou escrita no banco  
**Conclusão:** recuperação protocolar **comprovada**; erro `node:sqlite` = **falha de compatibilidade do runner na 1ª tentativa**, **antes** de qualquer chamada nativa, em processo distinto do sucesso.

---

## 1. Veredito

| Dimensão | Resultado |
| --- | --- |
| Erro Electron `ERR_UNKNOWN_BUILTIN_MODULE: node:sqlite` | **1ª execução** (abortou no *load* do script) |
| Execução que gerou `SUCESSO_RECUPERACAO` | **2ª execução**, após correção do import SQLite |
| FINALIZE(0) único / retorno 00 | **Comprovado** nos logs nativos |
| INIT pós 00 | **Comprovado** |
| Erro invalidou a sequência financeira? | **Não** — sequências cronologicamente separadas |
| Estado CDS TX 3 / venda 66 | Intactos; sem nova TEF |

---

## 2. Investigação do erro `node:sqlite`

### 2.1 Localização real no stack

Stack da tentativa falha (terminal 203875):

```text
tef-51-47-executar-recuperacao-tx3.js:14:26
Error [ERR_UNKNOWN_BUILTIN_MODULE]: No such built-in module: node:sqlite
```

- **`14:26` = linha 14, coluna 26** (posição do `require`), **não** a linha 26 atual do arquivo.
- Na **versão que falhou**, a linha 14 era: `const { DatabaseSync } = require('node:sqlite');`
- A **linha 26 atual** do arquivo é o `require` de `tefSigningKeyProvisioner` — irrelevante para o erro.
- Após o abort, o runner foi corrigido para `const sqlite3 = require('sqlite3').verbose();` (linha 15 atual).

### 2.2 Runtime efetivo

| Processo | Runtime | `node:sqlite` |
| --- | --- | --- |
| Electron do runner | **22.3.27** (Chromium/Node embarcado ≈ 16.x) | **Ausente** → erro no load |
| Node CLI do workspace | **v24.19.0** | Presente (usado só em scripts readonly auxiliares) |

O erro ocorreu no **Electron 22.3.27**, não no Node 24 do shell.

### 2.3 Quando ocorreu (antes × depois da recuperação)

| Tentativa | Janela UTC | PID shell / Electron | Resultado |
| --- | --- | --- | --- |
| **#1 (falha)** | `22:39:06` → kill ~`22:42:33` | shell 13188; app abortou no load | **Sem** NativeHost, **sem** INIT/FINALIZE |
| **#2 (sucesso)** | `22:44:10` → `22:44:12` | Electron PPID **13820**, NativeHost **9264** | `SUCESSO_RECUPERACAO` |

Evidência da #1: saída `App threw an error during load` + exit `4294967295` em `terminals/203875.txt`.  
Evidência da #2: `auditoria-fases.jsonl` + `resultado-execucao.json` + observability @ `22:44:*`.

**O erro `node:sqlite` ocorreu antes da recuperação e em outro processo.** Não interrompeu nem invalidou a sequência protocolar bem-sucedida.

---

## 3. Correlação da execução bem-sucedida (logs nativos)

Fonte: `%LOCALAPPDATA%\CDS-SISTEMAS\logs\destaxa-nativehost-observability.jsonl`  
Sessão: NativeHost PID **9264**, PPID **13820**, `hostSessionId` **`df3ca68fb6cc5080d823efb9485228c3`**

| Etapa | requestId | Horário (UTC) | Código |
| --- | --- | --- | --- |
| INIT_CLIENT (pré) | `8e0dff0c80b4ff3e` | 22:44:11.240 → `.244` | **A1** (`iniciaClientDestaxa`) |
| TX_FINALIZE | `75407b78ceda91c9` | 22:44:11.432 → 22:44:12.447 | **00** (`nativa.fim` ok; IPC `resultCode=00`) |
| INIT_CLIENT (pós) | `3035541d67820326` | 22:44:12.510 → `.522` | **00** (`iniciaClientDestaxa`) |

Confirmações:

| Pergunta | Resposta |
| --- | --- |
| Exatamente uma chamada FINALIZE(0) no Host 9264? | **Sim** — um único `nativa.inicio`/`nativa.fim` de `TX_FINALIZE` com requestId `75407b78ceda91c9` |
| Retorno original 00? | **Sim** — `resultCode":"00"` no IPC; duração ~1015 ms; `ok:true` |
| INIT posterior 00? | **Sim** — `native.call.return` / `client.init.result` código **00** |
| `node:sqlite` na mesma sequência? | **Não** — ausência total de eventos nativos dessa falha; falha #1 sem Host 9264 |

Não há segundo `TX_FINALIZE` no PID 9264 após 22:44.

---

## 4. Conferência CDS (somente leitura)

Consulta readonly ao banco oficial (`mercadao.db`):

| Checagem | Valor |
| --- | --- |
| TX 3 status | `aprovado` |
| NSU | `2338` |
| Autorização | `211139` |
| Venda 66 → `tef_transacao_id` | `3` |
| Comprovante cliente | len **1057** |
| Comprovante estabelecimento | len **1057** |
| `MAX(tef_transacoes.id)` | **3** (sem nova transação) |
| Total linhas TEF | 3 |
| Pendentes | `[]` |
| TX 2 | `negado`, nsu/auth null, venda_id 65 — **inalterada** |

---

## 5. Classificação do erro

| Tipo | Descrição |
| --- | --- |
| **Falha de compatibilidade do runner** | Uso de built-in `node:sqlite` (Node ≥22.5) dentro do **Electron 22.3.27**, que não expõe esse módulo |
| **Separado do resultado financeiro/protocolar** | A recuperação Destaxa ocorreu só na 2ª execução, com driver `sqlite3` npm, e está comprovada por requestIds + CDS |

Correção já aplicada no fonte atual da 51.47: `require('sqlite3')` em vez de `node:sqlite`.

---

## 6. Confirmação de não-execução nesta sprint

Nesta verificação **não** foram executados: runner, DLL, NativeHost, V$Pague, INIT_CLIENT, FINALIZE, CRT, permit, escrita em TX 2/3 ou venda 66.

Nenhuma outra operação foi iniciada automaticamente.
