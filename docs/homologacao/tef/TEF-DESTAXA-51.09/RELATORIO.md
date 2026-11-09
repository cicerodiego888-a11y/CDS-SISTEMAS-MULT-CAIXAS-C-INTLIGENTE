# TEF-DESTAXA-51.09 — Pré-validação final para homologação controlada

**Status:** CONCLUÍDA (preparação técnica passiva; **sem** operação financeira)  
**Data:** 2026-11-09 (~15:40 America/Sao_Paulo)  
**Classificação final:** **PREPARADO**  
**Autorização financeira:** **não concedida** — execução real exige ordem expressa e pontual posterior

Base: 51.05 (código) · 51.06 (diagnóstico CONTINUE) · 51.07 (BLOQUEADO pré-PDV) · 51.08 (PDV workspace PREPARADO)

---

## Checklist obrigatório

| # | Verificação | Resultado |
| --- | --- | --- |
| 1 | PDV PID 6464, Responding, workspace | **OK** |
| 2 | V$Pague PID 10256 + listener 60906 | **OK** |
| 3 | COM4 / PinPad (inspeção passiva) | **OK** |
| 4 | Gate global OFF | **OK** |
| 5 | Ledger excepcional (somente leitura) | **OK** |
| 6 | Auth anterior CONSUMED + expirada | **OK** |
| 7 | Ausência de TX em andamento | **OK** |
| 8 | Plano de acompanhamento de eventos | **OK** (preparado) |
| 9 | Caminhos dos logs identificados | **OK** |
| 10 | Sem alteração de código pendente para **iniciar** homologação | **OK** (com avisos) |

---

## 1. PDV (PID 6464)

| Campo | Valor |
| --- | --- |
| PID | **6464** (vivo) |
| Responding | **True** |
| Título | CDS Sistemas - PDV |
| StartTime | 2026-11-09 15:30:08 |
| CommandLine | `"...\CDS-SISTEMAS-MULT-CAIXAS C-INTLIGENTE\node_modules\electron\dist\electron.exe" electron-pdv.js --cds-forcar-local` |
| Workspace | **Confirmado** (mesmo da 51.08) |
| Filhos | GPU 5680, network 11160, renderer 11588 — todos Responding |

Sem reinício nesta sprint.

---

## 2. V$Pague

| Campo | Valor |
| --- | --- |
| PID | **10256** |
| Responding | True |
| StartTime | 2026-11-09 12:24:10 (**não reiniciado**) |
| Listener | `0.0.0.0:60906` / `[::]:60906` LISTENING → PID 10256 |
| Sessão TEF CDS ativa em 60906 | **Não** (sem ESTABLISHED peer no momento) |

---

## 3. COM4 / PinPad (passivo)

| Campo | Valor |
| --- | --- |
| Dispositivo | `PPC-920/930 CDC USB-to-Serial Port (COM4)` |
| Status PnP / SerialPort | **OK** |
| Identificação conhecida | Gertec PPC-930 (evidência sessão 51.03) |
| Comunicação aberta nesta sprint | **Nenhuma** |

Aviso residual (não bloqueante da pré-validação): **TABELA EXPIRADA** observada em 51.03 — monitorar no primeiro 99 da homologação.

---

## 4. Gate global

| Escopo | `DESTAXA_REAL_TRANSACTION_ENABLED` |
| --- | --- |
| User | vazio |
| Machine | vazio |
| Process (shell) | `0` |

**OFF.** Não habilitado.

---

## 5–6. Ledger excepcional (somente leitura)

**Arquivo:** `%LOCALAPPDATA%\CDS-SISTEMAS\tef\destaxa-autorizacao-excepcional.json`

| Campo | Valor |
| --- | --- |
| SHA256 | `5CE9D885483A6629FCBC1555F32E184E94BAE88E5FD46541C5062D9A7B953B0B` (inalterado vs 51.08) |
| mtime UTC | 2026-11-09T16:58:43.030Z |
| authorizationId | `5aed71f2b6e19f7f14303f69242c6796` |
| status | **CONSUMED** |
| valorCentavos | 100 |
| emitidoEm | 2026-11-09T16:54:10.595Z |
| expiresAt | 2026-11-09T17:24:10.595Z |
| consumidoEm | 2026-11-09T16:58:43.030Z |
| Expirada agora (UTC ~18:40) | **Sim** |
| ISSUED disponível | **Não** |

Ledger **não** alterado nesta sprint. A auth `5aed71f2…` **não** serve para nova CRT.

---

## 7. Transação em andamento

| Sinal | Achado |
| --- | --- |
| Processo NativeHost / DestaxaNativeHost | **Ausente** |
| TCP ESTABLISHED CDS↔60906 | **Ausente** |
| Último TX IPC real no observability | `TX_START` 2026-11-09T16:59:12Z (`d3cd929…`, result 99) — histórico |
| DLL log | parado em 13:59:12 (coleta cartão da tentativa antiga) |
| V$Pague | última TX finalizada 14:06:11; sem atividade nova |

**Nenhuma transação Destaxa em voo** no momento da pré-validação.

Históricos UNKNOWN / NÃO COMPROVADO (MRT-24/36/42/50.69 e 51.03) permanecem preservados — **sem** retry/reconciliação nesta sprint.

---

## 8. Acompanhamento de eventos (plano para a etapa financeira)

Quando houver ordem expressa de homologação, observar na ordem:

| # | Evento | Onde olhar |
| --- | --- | --- |
| 1 | `TX_START` / `TX_START_RESULT` | Observability NativeHost + `fluxo.*` |
| 2 | Coleta **99** (ex.: `transacao_cartao_numero` / senha) | Obs CDS + DLL + V$Pague `coletaMensagem` |
| 3 | `continuidade.pinpad_ack_vazio` | Observability (`continuidade.*`) |
| 4 | `TX_CONTINUE` | Obs IPC `operation":"TX_CONTINUE"` + ciclo |
| 5 | `TX_CONTINUE_RESULT` | Ciclo / fluxo |
| 6 | Retorno final (00 / negado / cancel / timeout) | Obs + DLL + V$Pague + ledger se auth nova |

Critérios de sucesso técnico do CONTINUE (para a sprint financeira futura):

- Após 99 PinPad, aparecer **TX_CONTINUE** IPC **antes** de 120 s no V$Pague.
- V$Pague **não** emitir “Tempo excedido ao aguardar resposta da aplicação comercial” na coleta PinPad.
- PDV main permanecer **Responding**.

Emissão no código (referência, sem executar): `destaxaCrtCicloOrquestracao.js` → `emitir('TX_START'|'TX_CONTINUE'|'TX_CONTINUE_RESULT'|…)`.

---

## 9. Caminhos dos logs

| Fonte | Caminho |
| --- | --- |
| CDS / NativeHost observability | `%LOCALAPPDATA%\CDS-SISTEMAS\logs\destaxa-nativehost-observability.jsonl` |
| Ledger excepcional | `%LOCALAPPDATA%\CDS-SISTEMAS\tef\destaxa-autorizacao-excepcional.json` |
| DLL Destaxa | `C:\CDS-SISTEMAS\logs\destaxa\destaxa-dll.log` |
| V$Pague Client | `C:\VBI\V$Pague\Client\logs\vspague-client.log` |
| PDV boot 51.08 (captura) | `docs/homologacao/tef/TEF-DESTAXA-51.08/pdv-stdout.log` / `pdv-stderr.log` |
| Relatórios cadeia | `docs/homologacao/tef/TEF-DESTAXA-51.0[3-8]/` |

Nenhum log truncado ou modificado nesta sprint.

---

## 10. Alteração de código pendente?

Para **iniciar** a homologação controlada do TX_CONTINUE pós-51.05:

| Item | Necessário agora? |
| --- | --- |
| Patch 51.05 (PinPad ack / `_emExecucao` / `solicitadaEm`) | Já no workspace em execução (51.08) |
| Serialização literal `informacao=` (H4 / 51.06) | **Não** — hipótese PENDENTE; homologar com entrada vazia atual e observar |
| Republicar manifesto RC3.16.6 (hashes divergentes) | **Não** para teste controlado; aviso cosmético/integridade |
| Atualizar tabelas EMV / TABELA EXPIRADA | **Não** como pré-requisito de código CDS; risco operacional a monitorar |
| Ligar gate global | **Não** — usar só auth excepcional pontual quando autorizada |

**Conclusão item 10:** não há alteração de código obrigatória antes de iniciar a homologação. O que falta para a **execução** financeira é exclusivamente **autorização humana** (nova emissão de ledger + ordem de CRT), fora do escopo desta sprint.

---

## Bloqueios / avisos

| Tipo | Descrição |
| --- | --- |
| Não bloqueante | Auth `5aed71f2…` CONSUMED/expirada — nova emissão só com ordem expressa |
| Não bloqueante | Manifesto de integridade desatualizado (51.08) |
| Não bloqueante | Risco TABELA EXPIRADA no PinPad |
| Nenhum | PDV/V$Pague/COM4/gate/TX-em-voo |

---

## Restrições respeitadas

Sem emitir/consumir auth, CRT, TX_*, DLL, NativeHost operacional, gate ON, reinício PDV/V$Pague, alteração de código/protocolo/serialização/config, pagamento.

---

## STATUS FINAL

**PREPARADO** — ambiente técnico apto para a homologação controlada do TX_CONTINUE pós-51.05.

Esta conclusão **não autoriza** operação financeira. A execução real depende de autorização expressa e pontual do responsável (incluindo nova autorização excepcional, se aplicável) em etapa posterior.
