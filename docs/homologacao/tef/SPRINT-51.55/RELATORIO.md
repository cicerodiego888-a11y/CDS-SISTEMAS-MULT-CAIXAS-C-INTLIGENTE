# SPRINT 51.55 — Pré-homologação TEF Destaxa após correção do CNPJ

**Data:** 2026-11-11  
**Classificação:** `READY_FOR_NEXT_REAL_HOMOLOGATION`  
**Escopo:** validação do fluxo Destaxa → XML fiscal **sem** cobrança, CRT/TX_*, one-shot, SEFAZ ou escrita no banco oficial.

---

## 1. Veredito

Todos os critérios da seção 7 foram cumpridos. O sistema está **tecnicamente preparado** para solicitar uma **nova autorização específica** de homologação real.

Este resultado **não** autoriza cobrança automática.

| Critério | Resultado |
| --- | --- |
| CNPJ oficial recuperado | `01425787000104` (`transacao_rede_cnpj`) |
| XML demonstrativo completo | `tPag=04`, `tpIntegra=1`, CNPJ, `tBand=01`, `cAut=211139` |
| Validador local aceita demo | **OK** |
| Cenários inválidos bloqueados | sem CNPJ / sem cAut / CNPJ inválido |
| Sem operação financeira/fiscal real | **Sim** |
| Ambiente e registros anteriores intactos | **Sim** (`MAX(id)=4`) |

---

## 2. Arquivos examinados e alterados

### Examinados (somente leitura / código já entregue na 51.54)

| Arquivo | Papel |
| --- | --- |
| `backend/services/tef/destaxa/destaxaProtocolo.js` | parser + `transacao_rede_cnpj` → CNPJ 14 dígitos |
| `backend/services/tef/adapters/DestaxaRealAdapter.js` | `_mapearResultadoCrt` (CNPJ/adquirente/bandeira) |
| `backend/services/tef/tefContrato.js` | `paraPersistencia` inclui `cnpj_credenciadora` no payload |
| `backend/services/fiscal/tefPagamentoHydrator.js` | recuperação top-level / `parametros` |
| `backend/services/fiscal/xmlBuilder.js` | montagem `<card>` |
| `backend/services/fiscal/validarXmlFiscal.js` | gate local anti-392 |
| `docs/homologacao/tef/SEGUNDA-TENTATIVA/venda-http-resultado.json` | fixture oficial de retorno Userede |

### Alterados nesta sprint (artefatos de validação apenas)

| Arquivo | Tipo |
| --- | --- |
| `docs/homologacao/tef/SPRINT-51.55/_precheck-integridade.js` | novo |
| `docs/homologacao/tef/SPRINT-51.55/_validacao-fluxo-fixture.js` | novo |
| `docs/homologacao/tef/SPRINT-51.55/integridade-readonly.json` | evidência |
| `docs/homologacao/tef/SPRINT-51.55/validacao-fluxo.json` | evidência |
| `docs/homologacao/tef/SPRINT-51.55/demo-pag-debito.xml` | XML demo |
| `docs/homologacao/tef/SPRINT-51.55/RELATORIO.md` | este relatório |

**Nenhuma alteração** em código de produção nesta sprint.

---

## 3. Origem dos dados

| Campo | Origem na fixture |
| --- | --- |
| `transacao_rede_cnpj` | `01.425.787/0001-04` → normalizado **`01425787000104`** |
| `transacao_rede` | `Userede` → adquirente |
| `transacao_administradora` | `Visa` → bandeira → `tBand=01` |
| `transacao_nsu` | `2338` |
| `transacao_autorizacao` | `211139` → `cAut` |
| CNPJ Destaxa no comprovante | `18.760.540/0001-39` — **não utilizado** |

Fixture: `docs/homologacao/tef/SEGUNDA-TENTATIVA/venda-http-resultado.json` (`resposta.payloadRetorno`).

---

## 4. Etapas A–D — resultados

### A — Auditoria do mapeamento

29 checks no harness `_validacao-fluxo-fixture.js` — **0 falhas**.

Confirmado: parser → evidências → `_mapearResultadoCrt` → payload com `cnpj_credenciadora=01425787000104`, adquirente `Userede`, bandeira `Visa`; NSU/autorização distintos e preservados.

### B — Persistência (isolada, sem DB oficial)

- `tefContrato.paraPersistencia` mantém CNPJ no `payload_retorno`.
- Hydrator recupera de top-level e de `parametros.transacao_rede_cnpj`.
- Ausência / comprovante Destaxa → **null** (sem invenção).

### C — XML sem transmissão

```xml
<pag>
  <detPag>
    <tPag>04</tPag>
    <vPag>1.00</vPag>
    <card>
      <tpIntegra>1</tpIntegra>
      <CNPJ>01425787000104</CNPJ>
      <tBand>01</tBand>
      <cAut>211139</cAut>
    </card>
  </detPag>
</pag>
```

Validador local: **aceito**.

Bloqueios locais confirmados:

| Cenário | Código |
| --- | --- |
| Cartão sem CNPJ | `XML_PAGAMENTO_CNPJ_CREDENCIADORA_AUSENTE` |
| Cartão sem cAut | `XML_PAGAMENTO_CAUT_AUSENTE` |
| CNPJ inválido (`123`) | `XML_PAGAMENTO_CNPJ_CREDENCIADORA_AUSENTE` |
| PIX `tpIntegra=2` | aceito sem CNPJ de cartão |
| Dinheiro | aceito sem `<card>` |

**SEFAZ:** não acionada.

### D — Integridade e segurança

| Item | Antes/Depois |
| --- | --- |
| Gate `DESTAXA_REAL_TRANSACTION_ENABLED` | **`0`** (OFF) |
| One-shot ISSUED | **nenhuma** |
| One-shot recente | `c3fb636…` **CONSUMED** (51.52); `7528947…` **EXPIRED** |
| `MAX(tef_transacoes.id)` | **4** → **4** |
| TX2 | `negado` intacta |
| TX3 | `aprovado` NSU 2338 / aut 211139 intacta |
| TX4 | `aprovado` NSU 2348 / aut 211139 intacta |
| Venda 66 / 67 | `concluida`/`quitada`; vínculos TEF 3 / 4 |
| Recebimento 80 | intacto |
| Pendente / UNKNOWN | **nenhum** |
| ERP/V$Pague reiniciados | **Não** |

---

## 5. Testes direcionados

| Suite | Resultado |
| --- | --- |
| `tests/tef/tef-destaxa-51-54-cnpj-credenciadora.test.js` | **12/12 OK** |
| `tests/fiscal/rc321-pix-grupo-pagamento-nfce.test.js` | **28/28 OK** |
| Harness 51.55 (`_validacao-fluxo-fixture.js`) | **29/29 OK** |

Suíte geral do projeto: **não** executada.

---

## 6. Pendências / impedimentos

Nenhum impedimento técnico para a **próxima** homologação real controlada.

Observações operacionais (fora desta sprint):

1. TX4 histórica ainda tem `bandeira`/`adquirente` null nas colunas (pré-51.54); novas autorizações passam a mapear esses campos.
2. Cobrança real exige **GO específico do PO** + one-shot (gate permanece OFF).
3. NFC-e #52 permanece rejeitada; reemissão fiscal da venda 67 **não** faz parte desta sprint.

---

## 7. Restrições cumpridas

Não executados: cobrança, CRT/TX_*, `/api/tef/pagar`, emissão/consumo one-shot, alteração de gate, reinício ERP/V$Pague, transmissão/retransmissão SEFAZ, alteração de venda 67 / TEF 4 / recebimento 80 / TX2–TX4.

---

## 8. Veredito final

**`READY_FOR_NEXT_REAL_HOMOLOGATION`**

Aguardar autorização específica do Product Owner para a próxima operação real.
