# SPRINT 51.53 — Diagnóstico pós-rejeição NFC-e #67 (cStat 392)

**Data:** 2026-11-10  
**Classificação:** `DIAGNOSTICO_SOMENTE_LEITURA`  
**Escopo:** investigação readonly — **sem** cobrança, CRT/TX_*, retransmissão NFC-e, cancelamento, estorno, alteração de venda/TEF/financeiro ou gate.

Artefato bruto: `diag-raw.json`.

---

## 1. Resumo executivo

| Item | Valor |
| --- | --- |
| Venda | **#67** — `concluida` / `quitada` / `cartao_debito` / total R$ 1,00 |
| TEF vinculada | **id = 4** (`tef_transacao_id=4`) |
| Estado financeiro | **APPROVED** (`CONFIRMED_SUCCESS`) |
| NSU atual | **2348** |
| Autorização atual | **211139** ( Destaxa; também no comprovante) |
| One-shot 51.52 | **CONSUMED** em `2026-11-11T00:56:33.388Z` |
| NFC-e | id **52**, nº **10052**, status **`rejeitada`**, cStat **392** |
| Causa 392 | Grupo `<card>` com `tpIntegra=1` **sem CNPJ da credenciadora/instituição** (e bandeira/adquirente nulos na persistência TEF) |

Nenhuma correção ou reprocessamento nesta sprint.

---

## 2. Transação TEF da venda #67

| Campo | Evidência |
| --- | --- |
| `tef_transacoes.id` | **4** |
| `venda_id` | **67** |
| `status` CDS | `aprovado` |
| `nsu` | `2348` |
| `autorizacao` | `211139` |
| `valor` / `tipo` | `1` / `cartao_debito` |
| `idempotency_key` | `tef-fp-3013003139b3377c3a00c365209ce13e` |
| `bandeira` / `adquirente` | **null** / **null** |
| Comprovantes | persistidos (len cliente/estab. **1057**, cifrados; distintos da TX3) |
| Criação / atualização | `2026-11-11 00:56:33` → `00:56:52` |

Log `INICIO` (id 44): *“Transação TEF iniciada — persistida antes do Adapter/DLL”* — identidade TEF existia **antes** do CRT.

Log `DECISAO_RETRY` (id 55):

- `financialState`: **`CONFIRMED_SUCCESS`**
- `resultCode`: `00`
- `retryAllowed`: `false`

Log `RETORNO` (id 54): `sucesso=true`, `status=aprovado`, `nsu=2348`, `autorizacao=211139`, **`cnpj_credenciadora=null`**. Comprovante Destaxa contém `AUTORIZACAO: 211139`, `COMPR:022111391`, terminal `Destaxa 10100017275719`.

**Estado financeiro real:** **APPROVED** (não DECLINED, não UNKNOWN).

---

## 3. One-shot `c3fb636267106ce343ca300d64cf7041`

| Campo | Valor |
| --- | --- |
| Status ledger | **`CONSUMED`** |
| Emitida (51.52) | `2026-11-11T00:54:25.964Z` |
| Consumida | **`2026-11-11T00:56:33.388Z`** |
| Expiração | `2026-11-11T01:00:00.011Z` (22:00 BRT) |
| Consumo | `valorCentavos=100`, `tipo=cartao_debito`, vínculo Destaxa/COM4/Gertec/`pdv_oficial` |

Consumo alinhado ao `criado_em` da TX 4 (início do fluxo financeiro). **Não** reutilizável.

---

## 4. Comparação TX3 (venda 66) × TX4 (venda 67)

| | TX **3** (venda 66) | TX **4** (venda 67) |
| --- | --- | --- |
| Status | `aprovado` | `aprovado` |
| NSU | **2338** | **2348** |
| Autorização | **211139** | **211139** |
| Idempotency | `tef-segunda-tentativa-bd6a8809bc64abb7` | `tef-fp-3013003139b3377c3a00c365209ce13e` |
| Comprovantes | distintos (ciphertext diferente) | distintos |
| Payload cifrado | distinto | distinto |

**Conclusão sobre `cAut=211139` no XML:** não é reaproveitamento da linha TX3 no banco. A TX4 é operação nova (NSU **2348**, comprovantes e idempotency próprios). O código **211139** veio do **retorno Destaxa** da própria TX4 (campo `autorizacao` + texto do comprovante). Coincidência/homologação Destaxa reutilizando o mesmo código de autorização em NSUs diferentes — o XML apenas ecoou o que estava persistido em `tef_transacoes.autorizacao` / `venda_pagamentos.tef_autorizacao`.

NSU **2348** **não** aparece no XML da NFC-e (só `cAut`); isso é esperado no schema (NSU não é tag do grupo `card`).

---

## 5. NFC-e #52 — cStat 392

| Campo | Valor |
| --- | --- |
| `nfce_notas.id` | 52 |
| Número / série | 10052 / 1 |
| Chave | `23261147627408000151650010000100521206093071` |
| Status CDS | `rejeitada` |
| Ambiente | 1 (produção SVRS) |
| Retorno lote | cStat 104 “Lote processado” |
| Prot. documento | **cStat 392** |

**xMotivo SEFAZ:**  
`Rejeicao: Nao informados os dados da operacao de pagamento por cartao de credito/debito`

### 5.1 Grupo `<card>` emitido

```xml
<detPag>
  <tPag>04</tPag>
  <vPag>1.00</vPag>
  <card>
    <tpIntegra>1</tpIntegra>
    <tBand>99</tBand>
    <cAut>211139</cAut>
  </card>
</detPag>
```

### 5.2 Campos presentes × ausentes (tpIntegra = 1, cartão)

Conforme `xmlBuilder.montarPagamentos` (integração TEF):

| Campo | Situação na NFC-e 52 | Origem esperada |
| --- | --- | --- |
| `tpIntegra` | Presente (`1`) | TEF vinculado |
| `CNPJ` (credenciadora/instituição) | **AUSENTE** | `tef.cnpj_credenciadora` — veio **null** no RETORNO |
| `tBand` | Presente (`99` = Outros) | `bandeira` TEF **null** → default 99 |
| `cAut` | Presente (`211139`) | `autorizacao` TEF |

**Causa técnica do 392:** pagamento cartão com **`tpIntegra=1`** sem os dados completos da operação — em especial **sem CNPJ** da credenciadora/instituição de pagamento. O validador local (`validarXmlFiscal`) só exige `tpIntegra` ∈ {1,2}; a SEFAZ aplica regra mais estrita e rejeita com 392.

Código em `xmlBuilder.js`: CNPJ só é emitido se houver 14 dígitos em `cnpj_credenciadora` / `cnpjCredenciadora`; com null, a tag é omitida — exatamente o XML observado.

---

## 6. Persistência antes da finalização da venda

| Etapa | Timestamp | Evidência |
| --- | --- | --- |
| One-shot consumida | 00:56:33.388Z | ledger |
| TEF id=4 INSERT / INICIO | 00:56:33 | `tef_logs` + `criado_em` |
| Ciclo CRT (START→CONTINUE*→FINALIZE) | 00:56:33–00:56:52 | `CICLO_CRT` |
| RETORNO aprovado + comprovantes | 00:56:52 | log RETORNO; lens comprovantes 1057 |
| `venda_pagamentos` #80 | 00:56:52 | tef_id=4, nsu=2348, aut=211139 |
| `venda_recebimentos` #80 | 00:56:52 | fiscal, aprovado, mesmo nsu/aut |
| NFC-e #52 | 21:56:53 BRT | rejeitada 392 |

Persistência TEF **completa o suficiente** para marcar venda quitada/aprovada **antes/no mesmo instante** da tentativa fiscal. A rejeição é **somente fiscal**; o financeiro TEF permanece APPROVED.

---

## 7. Integridade venda / financeiro

| Entidade | Estado | Integridade |
| --- | --- | --- |
| Venda 67 | `concluida` + `quitada` | Mantida; vínculo TEF **4** |
| TEF 4 | `aprovado` / NSU 2348 / aut 211139 | Mantida; comprovantes presentes |
| Pagamento #80 | cartão débito R$1 + TEF 4 | OK |
| Recebimento #80 | fiscal / aprovado | OK |
| NFC-e 52 | rejeitada 392 | Fiscal **não** autorizada; sem protocolo |
| Gate global | (não alterado nesta sprint) | — |
| TX 2 / TX 3 / venda 66 | fora do escopo de escrita | Intactas (somente leitura) |

**Divergência operacional:** dinheiro TEF **aprovado**; documento fiscal **rejeitado**. Não houve estorno/cancelamento nesta investigação.

---

## 8. Respostas diretas ao checklist

1. TEF da venda 67 → **id 4**  
2. One-shot `c3fb636…` → localizada no ledger  
3. Status → **CONSUMED** em **2026-11-11T00:56:33.388Z**  
4. NSU **2348**, autorização **211139**, comprovantes persistidos (cifrados; texto Destaxa no log RETORNO)  
5. XML `cAut=211139` = autorização persistida da TX4 (igual numericamente à TX3, origem Destaxa da TX4)  
6. Motivo do 211139 “histórico” → **coincidência Destaxa** em homologação; NSU diferente prova operação distinta  
7. Ausente no `<card>`: **CNPJ**; `bandeira`/`adquirente`/`cnpj_credenciadora` nulos na TEF  
8. Persistência TEF antes/na finalização → **sim** (INICIO pré-DLL + RETORNO/CONFIRMED_SUCCESS antes da NFC-e rejeitada)

---

## 9. Restrições cumpridas

Não executados: `/api/tef/pagar`, CRT/TX_*, nova cobrança, retransmissão NFC-e, cancelamento, estorno, alteração de venda 67/TEF/financeiro, alteração de gate.

**Nenhuma correção nesta sprint** — diagnóstico apenas.
