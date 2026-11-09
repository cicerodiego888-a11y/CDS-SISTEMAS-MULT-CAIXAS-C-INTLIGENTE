# MRT-50.77 — Adequação documental e configuração Destaxa 1.83

| Campo | Valor |
|---|---|
| Data | 2026-11-07 |
| Gate | `0` (OFF) — nunca habilitado |
| NativeHost / CRT / TX | **Não** |
| DLL substituída | **Não** |
| Códigos / certificados / UNKNOWN | **Não alterados** |

---

## Parecer final

### `APTO PARA VERIFICAÇÃO DO AMBIENTE`

A integração CDS está **configurada em conformidade** com as orientações oficiais confirmadas (DLL 1.83, `nivel_log=1`, logs em arquivo, códigos opcionais no init, `Debito` preservado). Não há ajuste de parâmetros obrigatório pendente nesta sprint. A próxima etapa é verificação operacional do ambiente liberado (Identificar/Partner Cloud), **somente com autorização explícita** e fora do escopo desta MRT.

---

## Arquivos inspecionados

| Arquivo | Papel |
|---|---|
| `backend/services/tef/destaxa/DestaxaNativeBridge.js` | `montarEntradaClient` / init |
| `backend/services/tef/destaxa/destaxaMapeamentoTerminal.js` | Projeção entrada; códigos opcionais |
| `backend/services/tef/destaxa/destaxaDllLogConfig.js` | `nivel_log=1` + dir log |
| `backend/services/tef/destaxa/destaxaProtocolo.js` | Literal `Debito` |
| `backend/services/tef/destaxa/destaxaConstantes.js` | Aplicação / encoding |
| `backend/services/tef/destaxa/destaxaBinarios.js` | Metadado pacote 1.83 + hashes |
| DLL instalada CDS ERP win-x64 | Hash × `1_83/build64` |
| Pacote Desktop `DLL DESTAXA\1_83\...` | Referência 1.83 |

Artefatos gerados: `dll-inspecao.json`, `projecao-estatica.json`, `MRT-50.77-CONFIGURACAO.md`, `MRT-50.77-DIVERGENCIAS.md`.

---

## Versões e hashes

| Artefato | Evidência |
|---|---|
| Pacote | **1.83** (`destaxaBinarios.versaoPacote`) |
| DLL instalada SHA-256 | `65972ACA50ED6CA90ECA4B88A73489E57D9BA08A73D4077A4CCC3EBDC4D69279` |
| Match `1_83/build64` | **Sim** (tamanho 136782) |
| App AC | `CDS Sistemas` / `1.0.3` |

---

## Critérios de aceitação

| Critério | Status |
|---|---|
| Versão DLL identificada | Cumprido (1.83 / hash) |
| Parâmetros init documentados | Cumprido |
| `nivel_log=1` | **Confirmado** |
| Gravação de logs (estática) | Cumprido (dir gravável + `destaxa-dll.log`) |
| Sem obrigatoriedade indevida dos 3 códigos no init | Cumprido |
| `Debito` preservado | Cumprido (9/9 testes 50.73) |
| Nenhuma TX / gate OFF | Cumprido |

---

## Testes executados (isolados)

1. Projeção estática `projetarEntradaIniciaClient` + asserts (`nivel_log=1`, sem trio códigos, gate OFF) → **ASSERTS_OK**
2. `garantirDiretorioLogDll` → ok / gravável
3. `node tests/tef/mrt-50-73-crt-literal-debito.test.js` → **9 ok / 0 falhas**

---

## Orientação do fornecedor × CDS

| Orientação | CDS |
|---|---|
| DLL 1.83 | Hash = build64 1.83 |
| Códigos não obrigatórios | Omitidos quando null |
| Terminal liberado | Documentado; verificação ambiente pendente (50.75/76) |
| `nivel_log=1` + arquivo | Presente |
| Sem adquirentes | Sem exigência no fluxo DLL |
| Cartões teste/reais sem cobrança | **Não exercitado** aqui |

---

## Próximo passo (fora desta sprint)

Verificação controlada do ambiente Partner Cloud / Identificar (e eventual CRT só com nova autorização). Não ampliar escopo automaticamente.
