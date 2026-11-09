# Consulta formal Destaxa — verificação investigativa de operação TEF

**Natureza:** exclusivamente investigativa  
**Solicitação:** confirmação do estado financeiro da operação no ambiente Destaxa  
**Não solicitar:** cancelamento, estorno, finalização, captura, retry, nova autorização ou qualquer comando de transação  
**Referência interna CDS:** TEF-DESTAXA-51.17 / TEF-DESTAXA-51.18  
**Data da solicitação (preparação):** 2026-11-09  
**Fuso horário dos logs locais:** America/Sao_Paulo (UTC−3)

---

## 1. Identificação da operação (lado Aplicação Comercial / CDS)

| Campo | Valor |
| --- | --- |
| Ambiente | Homologação / PDV Mercantil Fiscal |
| Provedor TEF | Destaxa (via DLL / V$Pague Client) |
| Banco local | `C:\ProgramData\MercantilFiscal\dados\mercadao.db` |
| Tabela | `tef_transacoes` |
| ID local | `1` |
| Valor | **R$ 1,00** |
| Modalidade | **Débito** (`cartao_debito`) |
| Parcelas | 1 |
| Status local | `pendente` |
| NSU local | **NULL** (ausente) |
| Código de autorização local | **NULL** (ausente) |
| Código de resposta local | **NULL** |
| Venda vinculada | **NULL** (`venda_id`) |
| Criado em (local DB) | `2026-11-09 16:58:43` (armazenado no SQLite; correlacionado à sessão UTC `16:58:43Z`) |
| Atualizado em (local DB) | `2026-11-09 16:59:12` |

---

## 2. Identificadores técnicos

| Identificador | Valor |
| --- | --- |
| `operation_id` | `op_ef2ed65b9230_744378e59797f9a7` |
| Fingerprint | `90b41858f0aff5d47c573e5c3d86bc62` |
| `idempotency_key` | `tef-fp-90b41858f0aff5d47c573e5c3d86bc62` |
| `requestId` (TX_START NativeHost) | `d3cd929385f4281e` |
| Autorização excepcional CDS (homologação 51.03) | `5aed71f2b6e19f7f14303f69242c6796` |
| Lease CDS (inconclusivo) | `lease_94f8eeedd1bbebbe` |
| Sessão V$Pague (log cliente) | `vspg-id-66c550a0` |
| Porta V$Pague observada | `60906` |
| PinPad | COM4 |

**Não incluídos neste documento:** PAN completo, track, senha, CVV ou dados sensíveis de cartão.

**Observação de coleta no PinPad (apenas contexto, sem PAN):** logs V$Pague indicam leitura posterior de cartão **VISA ELECTRON**, BIN **496068** (parcial), após timeout da AC — sem NSU Destaxa espelhado no CDS.

---

## 3. Horários (local America/Sao_Paulo e UTC)

| Evento | Local (UTC−3) | UTC |
| --- | --- | --- |
| Autorização CDS 51.03 emitida | 13:54:10 | 2026-11-09T16:54:10.595Z |
| NativeHost START / INIT_CLIENT | ≈13:58:40 | ≈2026-11-09T16:58:40Z |
| Autorização CDS consumida | 13:58:43 | 2026-11-09T16:58:43.030Z |
| INSERT `tef_transacoes` id=1 + log INICIO | 13:58:43 | 2026-11-09T16:58:43Z |
| **TX_START** (CRT Débito R$ 1,00) | 13:58:43 | 2026-11-09T16:58:43Z |
| **TX_START_RESULT** código **99** | 13:59:12 | 2026-11-09T16:59:12.872Z |
| Persistência solicitação 99 + `displayAck` | 13:59:12 | 2026-11-09T16:59:12Z |
| **TX_CONTINUE** (DISPLAY / `display_ack`) → **`HOST_SECURITY_OPERATION_BLOCKED`** | 13:59:12 | 2026-11-09T16:59:12Z |
| Timeout V$Pague aguardando AC (coleta cartão, 120 s) | ≈14:01:12 | ≈2026-11-09T17:01:12Z |
| Leitura de cartão / “Configura Transacao” (TLS Destaxa, lado V$Pague) | ≈14:02:06–14:02:10 | ≈2026-11-09T17:02:06Z–17:02:10Z |
| Timeout AC na coleta de senha | ≈14:04:10 | ≈2026-11-09T17:04:10Z |
| Encerramento V$Pague: “Transação cancelada pela Aplicação Comercial” (**resposta 78**) | ≈14:04:10 / 14:06:10 | ≈2026-11-09T17:04:10Z / 17:06:10Z |

---

## 4. Sequência dos eventos (resumo técnico)

1. Aplicação Comercial (CDS / TefManager) persistiu a operação **antes** da DLL (`persistidoAntesDll: true`), com estado financeiro inicial **UNKNOWN**.
2. Foi enviado **TX_START** (débito R$ 1,00) — `requestId` `d3cd929385f4281e`.
3. Destaxa/V$Pague retornou **código 99** (solicitação de continuidade / coleta PinPad — **não** tratado pela AC como aprovação financeira).
4. A AC persistiu a solicitação 99 e tentou **TX_CONTINUE** com ack de DISPLAY (`display_ack`).
5. O NativeHost/host de segurança respondeu **`HOST_SECURITY_OPERATION_BLOCKED`** — o ciclo CDS ficou **inconclusivo** (`DESTAXA_CICLO_INCONCLUSIVO`, `financialState: UNKNOWN`, `retryAllowed: false`).
6. No CDS: **sem NSU**, **sem código de autorização**, status local permanece **`pendente`**.
7. No V$Pague Client: após timeouts aguardando a Aplicação Comercial, houve continuidade local (leitura de cartão / coleta de senha) e encerramento com mensagem de **cancelamento pela Aplicação Comercial** e **resposta 78**, além de erro de envio ao servidor em trechos do log.
8. **Importante:** a AC **não** interpreta automaticamente o código **78** do V$Pague como recusa financeira Destaxa conclusiva; tampouco há espelho local de NSU/autorização Destaxa.

---

## 5. Erros e códigos observados (lado AC / cliente)

| Código / mensagem | Onde | Interpretação da AC (não conclusiva Destaxa) |
| --- | --- | --- |
| Resultado **99** | TX_START_RESULT (NativeHost) | Continuação / coleta PinPad — **não** aprovação |
| `HOST_SECURITY_OPERATION_BLOCKED` | TX_CONTINUE_RESULT | Bloqueio de segurança do host; ciclo CDS inconclusivo |
| `DESTAXA_CICLO_INCONCLUSIVO` | `tef_logs` RETORNO | Sem resultado financeiro conclusivo no CDS |
| Timeout 120 s aguardando AC | V$Pague | Operacional (comunicação AC ↔ V$Pague) |
| **Resposta 78** + “Transação cancelada pela Aplicação Comercial” | V$Pague | Encerramento operacional no cliente; **não** usado pela AC como DECLINED Destaxa comprovado |
| Erro de envio ao server (trechos do log V$Pague) | V$Pague | Comunicacional; sem NSU no CDS |

---

## 6. Estado registrado na Aplicação Comercial

| Dimensão | Classificação interna | Justificativa resumida |
| --- | --- | --- |
| Financeiro | **UNKNOWN** | Ausência de NSU/autorização/aprovação ou recusa emissor conclusiva no CDS |
| Operacional | **PENDING_WITH_EVIDENCE** | Linha `pendente` com trilha START → 99 → CONTINUE bloqueado → encerramento V$Pague |

A linha local **não** foi alterada, cancelada nem finalizada pela AC após o ciclo inconclusivo.

---

## 7. Perguntas objetivas ao suporte Destaxa

Solicitamos resposta **formal e investigativa** (sem executar comando de transação em nosso nome), confirmando:

1. **Existência:** a operação correspondente aos identificadores e horários acima consta no ambiente Destaxa?
2. **Estado financeiro:** qual o estado financeiro registrado (aprovada, recusada, cancelada, inexistente, pendente, outra)?
3. **NSU / autorização:** existe NSU e/ou código de autorização associados? Em caso afirmativo, quais valores?
4. **Captura / processamento / liquidação:** houve captura, processamento ou liquidação financeira?
5. **Cancelamento:** existe cancelamento registrado no ambiente Destaxa para esta operação?
6. **Comunicação com a Aplicação Comercial:** qual o resultado da comunicação Destaxa ↔ AC / V$Pague no intervalo 13:58–14:06 (America/Sao_Paulo) de 2026-11-09, em especial após o resultado **99** e o bloqueio de **TX_CONTINUE**?
7. **Procedimento formal de encerramento:** existe procedimento recomendado pela Destaxa para encerrar/reconciliar esta operação **sem** iniciar nova transação financeira, caso o estado remoto seja conhecido?

---

## 8. Escopo explícito do que **não** solicitamos neste contato

- Não executar TX_START / TX_CONTINUE / TX_FINALIZE / TX_CANCEL em nosso nome.  
- Não executar estorno, cancelamento ou captura.  
- Não iniciar nova autorização/transação de R$ 1,00.  
- Não alterar o banco local da AC.  
- Não presumir resultado financeiro a partir apenas do código **78** do V$Pague ou do status local `pendente`.

---

## 9. Solicitação de resposta formal

Pedimos retorno escrito (e-mail / ticket) contendo, no mínimo:

- Confirmação de existência ou inexistência da operação no Destaxa.  
- Estado financeiro oficial.  
- NSU e código de autorização, se existirem.  
- Indicação de captura/liquidação/cancelamento, se houver.  
- Procedimento formal recomendado para encerramento seguro, se aplicável.  
- Referência ao `requestId` `d3cd929385f4281e` e ao horário **2026-11-09 13:58:43–14:06:10** (America/Sao_Paulo).

**Contato interno CDS / referência de ticket:** TEF-DESTAXA-51.18 — operação local id=1 / `op_ef2ed65b9230_744378e59797f9a7`.

---

## 10. Anexos sugeridos (envio manual pelo solicitante)

Quando o usuário enviar este pedido ao suporte, pode anexar (sem dados de cartão/senha):

- Trechos de `destaxa-nativehost-observability.jsonl` do `requestId` `d3cd929385f4281e` (TX_START / result 99).  
- Trechos de `destaxa-dll.log` ≈13:58:40–13:59:12.  
- Trechos de `vspague-client.log` da sessão `vspg-id-66c550a0` (timeouts AC / resposta 78), **redigindo PAN**.  
- Relatório interno `docs/homologacao/tef/TEF-DESTAXA-51.17/RELATORIO.md`.

**Este documento não foi enviado automaticamente.** O envio é responsabilidade do usuário após revisão.
