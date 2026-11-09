# MRT-50.77 — Configuração Destaxa 1.83 (estática)

Gate: `DESTAXA_REAL_TRANSACTION_ENABLED=0`. Sem NativeHost/DLL/TX nesta sprint.

---

## DLL efetivamente carregada (evidência)

| Item | Valor |
|---|---|
| Caminho instalado | `C:\Program Files\CDS ERP\resources\app.asar.unpacked\resources\tef\destaxa\win-x64\libdll-integracao-tef.dll` |
| Tamanho | 136782 bytes |
| SHA-256 | `65972ACA50ED6CA90ECA4B88A73489E57D9BA08A73D4077A4CCC3EBDC4D69279` |
| Pacote oficial 1.83 `build64` | **mesmo SHA-256 e tamanho** |
| Metadado CDS `destaxaBinarios.js` | `versaoPacote: 1.83` / origem `1_83/build64` |
| Substituição nesta sprint | **Não** |

Conclusão: a DLL x64 instalada **coincide** com o binário `1.83/build64` do pacote Destaxa na máquina. Sem reinstalação.

---

## `iniciaClientDestaxa` — parâmetros projetados

Implementação: `DestaxaNativeBridge.montarEntradaClient` → `projetarEntradaIniciaClient` + `DESTAXA_DLL_LOG_PARAMS` (MRT-28).

Projeção com config CDS atual (códigos null, versao app `1.0.3`):

```
versao=1.0.3;aplicacao=CDS Sistemas;diretorio_trabalho=C:\CDS-SISTEMAS\logs\destaxa;nivel_log=1;nome_arquivo_log=destaxa-dll.log;tam_max_log=10;total_bkp_log=5
```

| Parâmetro | Valor | Orientação fornecedor |
|---|---|---|
| `versao` | `1.0.3` | Obrigatório (doc) |
| `aplicacao` | `CDS Sistemas` | Obrigatório (doc) |
| `estabelecimento` / `loja` / `terminal` | **omitidos** (null no banco) | **Não obrigatórios** — alinhado |
| `nivel_log` | **`1`** | Confirmado pelo fornecedor — **alinhado** |
| `diretorio_trabalho` | `C:\CDS-SISTEMAS\logs\destaxa` | Log em arquivo |
| `nome_arquivo_log` | `destaxa-dll.log` | Log em arquivo |
| `tam_max_log` / `total_bkp_log` | `10` / `5` | MRT-28 / doc |

Obrigatoriedade indevida dos três códigos na montagem do init: **ausente** (`estabelecimentoLojaTerminalObrigatorios: false`).

---

## Logs

| Item | Status |
|---|---|
| Diretório | `C:\CDS-SISTEMAS\logs\destaxa` — existe |
| Escrita | `garantirDiretorioLogDll` / probe → **gravável** |
| Arquivo | `destaxa-dll.log` presente (evidência de uso prévio) |
| Alteração de config de log | Nenhuma nesta sprint |

---

## CRT literal

| Item | Status |
|---|---|
| `TIPOS_CARTAO_CRT_DOCUMENTADOS.DEBITO` | `Debito` (MRT-50.73) |
| Regressão `mrt-50-73` | **9/9 OK** |

---

## Ambiente de integração (evidência existente)

| Camada | Evidência |
|---|---|
| CDS `tef_configuracao.ambiente` | `homologacao` |
| V$Pague Client | `-h app-partner.destaxa.cloud -p 60410 -tls` |
| Fornecedor | Terminal de integração **liberado** (orientação desta sprint) |
| Observação 50.75/76 | Identificar ainda apresentou `Connection breaked` em 07/11 — verificação operacional do ambiente **pendente** (fora do ajuste de parâmetros CDS) |

Adquirentes: **não** há cadastro/exigência de adquirentes no fluxo Destaxa 1.83 inspecionado (alinhado à orientação “não necessário cadastrar adquirentes”).
