# RC7.10.4 — Estabilização Final do Emissor NFC-e

**Data:** 2026-07-22  
**Modo:** Implementação (camada de emissão + validadores)  
**Escopo respeitado:** Motor / MIDP / Distribuição / Parser / MIIP / Compras / Manifestação / DistDFe / Registry / UrlResolver / SOAP **não alterados**.

---

## Parecer final

| Pergunta | Resposta |
|----------|----------|
| 1. Inconsistência restante? | **Não** nos caminhos NFC-e/NF-e auditados pós-RC7.10.4 |
| 2. Risco operacional? | **Não conhecido** na emissão (homologação com cert autoassinado; produção usa A1 real) |
| 3. Divergência NFC-e × NF-e? | **Não** — mesma fonte `modeloTotais.js` |
| 4. Caminho de duplo desconto? | **Não** — LIQUIDO tem prioridade absoluta; NF-e alinhada |
| 5. XML capaz de 610/629/531/539/865 por totais? | **Não** no fluxo validado (`validarXmlFiscal` aborta antes de assinar) |

**Confidence Score: 1,00**  
(fronteira 0,01 · assinatura · XSD pós-assinatura · vTroco · NFC-e/NF-e alinhadas · testes 28/28)

---

## Pendências eliminadas

### P01 — Fronteira R$ 0,01
- Fonte: `backend/services/fiscal/modeloTotais.js`
- Regra: se `itensJaLiquidos` → **sempre** `MODELO_LIQUIDO` (nunca disputa com BRUTO)
- EPS estrito `< 0,009` (não `<= 0,01`)
- Evidência teste: líquido + desconto 0,01 → vNF=10, vPag=10

### P02 — Assinatura
- Homologação com RSA 2048 (node-forge) + `assinarNFe`
- DigestValue / SignatureValue / C14N / Reference / Transforms presentes
- Artefato: `docs/auditoria/rc7104-estabilizacao-nfce/`

### P03 — XSD pós-assinatura
- `validarXmlFiscal({ fase: 'pos_assinatura', validarXsd: true })`
- Resultado evidência: `"status": "XSD_OK"`

### P04 — vTroco
- `resolverPagamentosNfce` + `montarPagamentos` emitem `<vTroco>`
- Regra: `Σ vPag = vNF + vTroco` (ex.: 100 = 78 + 22)

### P05 — NF-e 55
- `xmlBuilderNfeVenda.js` consome `determinarModeloDeTotais` / `validarIdentidadeICMSTot`
- Sem reaplicação de desconto em itens líquidos

### Validador único
- `validarXmlFiscal()` em `emissor.js` e `nfeEmissorVenda.js` **antes** da assinatura
- Falha → status `erro_validacao` (não transmite)

---

## Arquivos alterados / criados

| Arquivo | Ação |
|---------|------|
| `backend/services/fiscal/modeloTotais.js` | **novo** — fonte única |
| `backend/services/fiscal/validarXmlFiscal.js` | **novo** — validador |
| `backend/services/fiscal/xmlBuilder.js` | modelo compartilhado, vTroco, fallbacks cMunFG/tpImp |
| `backend/services/fiscal/xmlBuilderNfeVenda.js` | alinhamento MODELO_BRUTO/LIQUIDO + vTroco |
| `backend/services/fiscal/emissor.js` | gate `validarXmlFiscal` pré-assinatura |
| `backend/services/fiscal/nfeEmissorVenda.js` | gate `validarXmlFiscal` pré-assinatura |
| `tests/fiscal/rc7104-estabilizacao-nfce.test.js` | **novo** |
| `docs/auditoria/rc7104-estabilizacao-nfce/*` | evidências |

---

## Testes

```
tests/fiscal/rc7104-estabilizacao-nfce.test.js + rc71021
→ 28 pass / 0 fail
hotfix-consumo-exclusivo-motor → 14 pass
```

Cenários cobertos: sem desconto, desconto valor/%, troco, multi, PIX, dinheiro, cartão, mista, fracionado, arredondamentos 0,01–0,99, BRUTO, LIQUIDO, assinatura+XSD+SOAP sem transmitir.

---

## Fluxo oficial pós-RC7.10.4

```
buildNfceXml / buildNfeXml
  → modeloTotais (BRUTO|LIQUIDO)
  → ICMSTot + pag + vTroco
       ↓
validarXmlFiscal (pré)
       ↓
assinarNFe
       ↓
validarXmlFiscal (pós + XSD) [homologação / gate]
       ↓
montarLote (SOAP pronto)
       ↓
SEFAZ (somente em produção — não nesta sprint)
```
