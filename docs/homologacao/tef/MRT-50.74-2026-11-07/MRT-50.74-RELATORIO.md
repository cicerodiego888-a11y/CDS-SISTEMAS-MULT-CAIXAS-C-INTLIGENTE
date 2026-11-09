# MRT-50.74 — Homologação controlada CRT débito (`Debito`)

| Campo | Valor |
|---|---|
| Data | 2026-11-07 |
| Autorização | Explícita — **uma** CRT R$ 1,00 débito A vista |
| Correção validada | MRT-50.73 (`Débito` → `Debito`) |
| Gate após | `0` / OFF |
| NativeHost após | STOPPED / ausente |
| Segunda tentativa | **Não** |

---

## Classificação final

### `REJEITADA`

Retorno Destaxa **`09`** — “Transação cancelada pelo Client.”  
`financialState=CONFIRMED_DENIED`. Sem retry. Sem PinPad `99`/coleta evidenciada no ciclo CDS.

---

## 1. Pré-voo

Aprovado (`preflight.json` + `revalidacao-execucao.json`).

| Item | Status |
|---|---|
| Hash `destaxaProtocolo.js` = MRT-50.73 | OK |
| Hash `destaxaConstantes.js` = MRT-50.73 | OK |
| CRT montada = `…tipo_cartao=Debito…` | OK |
| COM4 / PPC-930 Windows | OK |
| V$Pague PID 44484 / TCP 60906 | OK |
| NativeHost ausente no start | OK |
| Gate OFF no start | OK |
| Pendências `tef_transacoes` | Nenhuma |
| DLL SHA esperado | OK |
| UNKNOWN históricos | Preservados (sem reconciliação) |

Códigos estabelecimento/loja/terminal: ainda **null** (opcionais; não inventados).

---

## 2. Identificador e payload

| Campo | Valor |
|---|---|
| `transactionId` | `mrt74_032a3f9732f75c24` |
| Entrada CRT | `transacao_valor=1.00;transacao_tipo_cartao=Debito;transacao_pagamento=A vista` |
| INIT Client | `00` / CLIENT_INITIALIZED |
| TX_START | **`09`** (~12 s) |
| CONTINUE | Não (sem `99`) |
| FINALIZE CDS | Não (ciclo encerrado em 09) |

---

## 3. Retorno bruto / estados

```json
{
  "codigo": "09",
  "estado": "DENIED",
  "financialState": "CONFIRMED_DENIED",
  "mensagem": "Transação cancelada pelo Client.",
  "requerContinuacao": false,
  "naoExecutada": false
}
```

Gate OFF em `2026-11-07T22:23:50.143Z` (`pos-ciclo-crt`). NH encerrado controlado (`STOPPED`).

---

## 4. V$Pague (log existente)

Horário local do Client ~`2026-11-07 19:23:38`–`19:23:50`:

| Sequência | Fato |
|---|---|
| iniciar | Aceito (`aplicacao:CDS Sistemas`, `versao:1.0.3`) após ajuste de sequencial |
| executar | `tipoCartao:Debito`, `pagamento:A vista`, `valor:1.00` — **aceito na parse** (sem erro de tag) |
| Identificar cloud | Reconexão `app-partner.destaxa.cloud:60410` → connection breaked |
| Resultado | `coletaRetorno:9` — “Tempo de resposta foi excedido…” |
| finalizar | sequencial 5 |

Contraste MRT-50.69: rejeição imediata `Tag <transacao_tipo_cartao>… inválido` → `05` com `Débito`.  
Nesta 50.74: literal **`Debito` passou a validação de conteúdo**; a falha foi **timeout Partner Cloud** → Destaxa `09`.

Arquivo: `vspague-log-tail.txt`.

---

## 5. PinPad

`evidenciaInteracao=false` no runner (sem DISPLAY/COLETA/OPCAO via `99`).  
Timeout cloud **antes** de ciclo interativo comprovado. Homologação financeira do débito **não** concluída; porém o contrato local `Debito` deixou de ser rejeitado como na 50.69.

---

## 6. Resultado financeiro

Negação/cancelamento pelo Client (`09` / `CONFIRMED_DENIED`). Sem aprovação. Sem estorno/reconciliação automática.

---

## 7. Conformidade

| Restrição | Cumprida |
|---|---|
| Uma única CRT | Sim |
| Literal `Debito` | Sim |
| Sem segunda tentativa | Sim |
| Gate OFF ao fim | Sim (`0`) |
| NH encerrado | Sim |
| UNKNOWN históricos intactos | Sim |
| Sem cancelamento/estorno auto | Sim |

---

## Parecer

**`REJEITADA`** por código **`09`** (Client cancelou / timeout de resposta no V$Pague), não por `05` de tag inválida. A correção local MRT-50.73 foi **exercitada** no payload; homologação financeira **não** concluída. Nova CRT exige nova autorização explícita.
