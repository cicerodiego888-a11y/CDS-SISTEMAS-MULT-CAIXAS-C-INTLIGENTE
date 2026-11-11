# SPRINT 51.54 — Correção da identificação da credenciadora Destaxa

**Data:** 2026-11-10  
**Classificação:** `CORRECAO_MAPEAMENTO_CNPJ_CREDENCIADORA`  
**Cobrança / CRT / SEFAZ:** **não executados**  
**Venda 67 / TEF 4 / recebimento 80 / NFC-e 52:** **inalterados**

---

## 1. Origem documental do CNPJ

| Fonte | Uso fiscal? | Evidência |
| --- | --- | --- |
| **`transacao_rede_cnpj`** na saída CRT Destaxa (docs/06 / parâmetros `chave=valor`) | **Sim — origem oficial** | Homologação: `01.425.787/0001-04` (Userede) em `SEGUNDA-TENTATIVA/venda-http-resultado.json` → `payloadRetorno.parametros` |
| `transacao_rede` | Adquirente (`Userede`) | Mesmo retorno |
| `transacao_administradora` | Bandeira (`Visa` / etc.) | Mesmo retorno |
| CNPJ Destaxa no comprovante / `.conf` (`18.760.540/0001-39`) | **Não** | Empresa Destaxa — proibido como `<CNPJ>` do card (MRT-50.71 / política README) |
| V$Pague / DLL | Transportam a `saída` CRT; não há campo paralelo inventado | Campo chega em `parametros` após `parseParametrosDestaxa` |
| Configuração do estabelecimento CDS | **Não** usada para CNPJ do card | — |

**Regra:** persistir `cnpj_credenciadora` **somente** quando `transacao_rede_cnpj` normaliza para **14 dígitos**. Sem inventar, sem scrape de comprovante, sem default.

---

## 2. Causa do bug (51.53)

`_mapearResultadoCrt` já recebia `parametros.transacao_rede_cnpj`, mas **não** promovia a `cnpj_credenciadora` → RETORNO TX4 com `cnpj_credenciadora:null` → XML sem `<CNPJ>` → SEFAZ **392**.

---

## 3. Arquivos alterados

| Arquivo | Mudança |
| --- | --- |
| `backend/services/tef/destaxa/destaxaProtocolo.js` | `normalizarCnpjCredenciadoraDestaxa`, `extrairCnpjCredenciadoraDeParametros`; evidências 00 expõem CNPJ/rede/administradora |
| `backend/services/tef/adapters/DestaxaRealAdapter.js` | `_mapearResultadoCrt` preenche `cnpj_credenciadora`, `adquirente`, `bandeira` + payload |
| `backend/services/fiscal/tefPagamentoHydrator.js` | Fallback legítimo: top-level → `parametros.transacao_rede_cnpj` |
| `backend/services/fiscal/validarXmlFiscal.js` | Bloqueia cartão `tPag` 03/04 + `tpIntegra=1` sem CNPJ/cAut (`XML_PAGAMENTO_CNPJ_CREDENCIADORA_AUSENTE`) |
| `backend/services/tef/README_INTEGRACAO_REAL.md` | Contrato atualizado (51.54) |
| `tests/tef/tef-destaxa-51-54-cnpj-credenciadora.test.js` | **12** testes (débito/crédito/anti-invenção/validação) |
| `tests/fiscal/rc321-pix-grupo-pagamento-nfce.test.js` | Expectativa alinhada: cartão sem CNPJ **falha** localmente |
| `docs/homologacao/tef/SPRINT-51.54/demo-xml-card.*` | XML demonstrativo **sem** transmissão |

Fluxo pós-correção (novas autorizações):

```text
CRT saida → transacao_rede_cnpj
  → DestaxaRealAdapter._mapearResultadoCrt
  → tefContrato (cnpj_credenciadora + payload)
  → tef_transacoes / venda_pagamentos (bandeira/adquirente colunas; CNPJ no payload)
  → hydrator → xmlBuilder <CNPJ>
  → validarXmlFiscal (gate local)
```

---

## 4. Testes

| Suite | Resultado |
| --- | --- |
| `tef-destaxa-51-54-cnpj-credenciadora.test.js` | **12/12 OK** |
| `rc321-pix-grupo-pagamento-nfce.test.js` | **28/28 OK** |

Cobertura: débito, crédito, ausência de campo → null, comprovante Destaxa **não** vira CNPJ, XML com Userede `01425787000104`, bloqueio local sem CNPJ, PIX fora da regra de cartão.

---

## 5. XML de demonstração (sem SEFAZ)

Artefatos:

- `demo-pag-debito.xml` / `demo-pag-credito.xml`
- `demo-xml-card.json`

Trecho débito montado:

```xml
<card>
  <tpIntegra>1</tpIntegra>
  <CNPJ>01425787000104</CNPJ>
  <tBand>01</tBand>
  <cAut>211139</cAut>
</card>
```

Validação local: **OK** (débito e crédito). **Nenhuma** transmissão à SEFAZ.

Comparativo com o XML rejeitado da NFC-e 52:

```xml
<!-- antes (392) -->
<card><tpIntegra>1</tpIntegra><tBand>99</tBand><cAut>211139</cAut></card>
```

---

## 6. Restrições cumpridas

| Restrição | Status |
| --- | --- |
| Sem cobrança / CRT / TX_* | Sim |
| Sem retransmitir NFC-e 52 | Sim |
| Venda 67 / TEF 4 / recebimento 80 intactos | Sim (readonly confirmou bandeira/adquirente ainda null na TX4) |
| Sem cancel/estorno/financeiro | Sim |
| Gate inalterado | Sim |
| Sem eventos fiscais SEFAZ | Sim |

**Nota:** TX4 histórica permanece sem `cnpj_credenciadora` no top-level até uma eventual reemissão fiscal futura que use o hydrator + `parametros` já cifrados no payload (se presentes) — **fora do escopo desta sprint** (proibido alterar TX4 / retransmitir #52).

---

## 7. Próximo passo sugerido (fora desta sprint)

Com GO do PO: reemissão fiscal controlada da venda 67 **sem nova cobrança**, desde que o `payload_retorno` cifrado da TX4 contenha `parametros.transacao_rede_cnpj` (hydrator 51.54), ou nova venda TEF pós-correção de mapeamento.
