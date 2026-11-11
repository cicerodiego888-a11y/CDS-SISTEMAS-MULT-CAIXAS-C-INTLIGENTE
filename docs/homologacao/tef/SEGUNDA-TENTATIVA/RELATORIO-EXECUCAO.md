# Relatório — Segunda tentativa TEF (R$ 1,00 débito)

**Data:** 2026-11-10 ~17:24–17:27 BRT  
**Autorização PO:** uma CRT; operador no PinPad.  
**Decisão pós-retorno:** **parar** (financialState=UNKNOWN). **Sem retry.**

---

## Pré-checks (imediatos)

| Item | Resultado |
| --- | --- |
| Electron oficial | **5700** em `:3001` |
| TX id=2 | `negado` |
| TX ativa/UNKNOWN prévia | nenhuma |
| Gate global | OFF |
| COM4 Gertec | presente |
| V$Pague | 20760 UP |
| Permit | novo ISSUED `cff481501f704f672b3e956f4bcb62b4` (não reutilizado) |

---

## Execução

1. Tentativa sem `venda_id` → **403** `TEF_CONTEXTO_FISCAL_AUSENTE` (sem CRT / permit intacto).  
2. Persistida **venda 66** (R$1 fiscal).  
3. **Única CRT:** `POST /api/tef/pagar` no backend do Electron **5700**:
   - `venda_id=66`, `cartao_debito`, `valor=1.00`
   - `idempotency_key=tef-segunda-tentativa-bd6a8809bc64abb7`
4. NativeHost utility **9260** (PPID **5700**).

---

## Resultado Destaxa (automação)

| Campo | Valor |
| --- | --- |
| codigoDestaxa | **00** |
| mensagem | Transacao aprovada |
| NSU | **2338** |
| NSU rede | 241255 |
| Autorização | **211139** |
| Valor | 1,00 |
| Tipo | Débito / à vista |
| Rede | Userede |
| Cartão | Visa `496068******4745` |
| Horário PinPad | 10/11/26 20:26:22 |
| Comprovantes | 1ª e 2ª via presentes (Destaxa) |

---

## Resultado CDS (camada oficial)

| Campo | Valor |
| --- | --- |
| HTTP | **422** |
| codigo | `DESTAXA_CICLO_INCONCLUSIVO` |
| mensagem | `TX_FINALIZE sem bootstrap/permit de segurança válido` |
| financialState | **UNKNOWN** |
| protocolState | UNKNOWN |
| aprovado | false |
| retryAllowed | **false** (`TEF_CONFIRMED_SUCCESS_NO_RETRY`) |
| Gate global | permanece OFF |

A automação Destaxa entregou **00** com NSU/autorização/comprovantes; o ciclo CDS **não concluiu FINALIZE(0)** por falha de bootstrap/permit de segurança na etapa FINALIZE.

---

## Estado final no banco oficial

**`tef_transacoes.id = 3`**

| Campo | Valor |
| --- | --- |
| status | **`pendente`** |
| venda_id | 66 |
| valor / tipo | 1,00 / cartao_debito |
| nsu | **2338** |
| autorizacao | **211139** |
| comprovante_cliente | persistido (1057 chars) |
| comprovante_estabelecimento | persistido (1057 chars) |
| criado_em | 2026-11-10 20:26:08 |
| atualizado_em | 2026-11-10 20:26:23 |

**Lease:** `MARCAR_INCONCLUSIVO` (TEF-14) — sem segunda CRT.

**Permit:** `cff48150…` → **CONSUMED** em `20:26:08Z`.

**Venda 66:** `concluida` / `quitada`; `tef_transacao_id` ainda **null** (vínculo TEF não fechado no status de sucesso CDS).

**TX id=2:** inalterada (`negado`).

---

## Conformidade

- Sem gate global.  
- Sem reutilização de permit anterior.  
- Sem segunda CRT / sem retry automático após UNKNOWN.  
- NSU/autorização/comprovantes **não fabricados** — vieram do retorno Destaxa 00 e foram gravados na linha id=3.

Artefatos: `venda-http-resultado.json`, `estado-final-db.json`, `emissao-autorizacao.json`.
