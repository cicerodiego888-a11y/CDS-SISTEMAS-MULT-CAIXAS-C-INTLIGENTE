# RC7.10.3 — Auditoria final NFC-e (somente leitura)

**Data:** 2026-07-22  
**Modo:** Homologação definitiva do XML NFC-e — **sem alteração de código**  
**Caso canônico:** bruto 83,40 → desconto 5,40 → líquido 78,00 (100% fiscal)

---

## 1. Parecer final

**( )** XML totalmente consistente. Pronto para produção.

**(x)** Ainda existe risco operacional.

### Onde está o risco

1. **Heurística `MODELO_BRUTO` / `MODELO_LIQUIDO` na fronteira de R$ 0,01**  
   Com itens já líquidos e `venda.desconto = 0,01`, `determinarModeloDeTotais` marca **ambos** `itensJaLiquidos` e `itensAindaBrutos` (tolerância `<= 0,01`). Prefere BRUTO → `vNF = 9,99` enquanto o pagamento informado permanece `10,00` (ajuste de `resolverPagamentosNfce` só dispara se `|soma − vNF| > 0,01`). Identidade ICMSTot fecha; **Σ pag ≠ vNF** em exatamente 0,01.

2. **Assinatura digital não evidenciável nesta rodada**  
   Código de `signer.js` (C14N 20010315, RSA-SHA1, SHA1, enveloped, Reference por `Id`) está íntegro e inalterado pela RC7.10.2.1. XML gerado é **pré-assinatura**. Sem certificado A1 no harness, não há `Signature` / `DigestValue` / `SignatureValue` no artefato.

3. **XSD completo do envelope `NFe` exige `Signature`**  
   Com config fiscal completa (`municipioCodigo`, `tpImp`), o único erro XSD do XML sem assinar é: *Missing Signature / infNFeSupl*. Esperado antes de `assinarNFe`. Fixture incompleta (sem `municipioCodigo`/`tpImp`) gera `undefined` em `cMunFG`/`tpImp` e **falha XSD** — produção usa `configService.getFiscalConfig()` que preenche esses campos.

4. **`vTroco` ausente no builder NFC-e**  
   Não há emissão de `<vTroco>`. Pagamento único acima de `vNF` é **clipado** para `vNF` (sem troco no XML). Fluxo comercial de troco não é refletido no documento fiscal.

5. **NF-e modelo 55 (fora do fluxo NFC-e, residual)**  
   `xmlBuilderNfeVenda.js` ainda aplica `vDesc = min(venda.desconto, vProd)` sobre itens — risco de duplo desconto se o motor líquido for reutilizado na NF-e.

**Confidence score: 0,86**  
(não 1,00: falta assinatura evidenciada + XSD pós-assinatura + risco fronteira 0,01)

---

## 2. Fluxograma e produção de valores

```
Motor (distribuidorEstoqueVenda)
  → valorFiscalBruto = 83,40
  → RC7.10.1 valorFiscalLiquido / itens.valor_fiscal = 78,00
       ↓
Distribuição / MIDP
  → alvo fiscal = 78,00 · saldoFiscal = 0
       ↓
Pagamento (Orquestrador)
  → dinheiro/PIX/cartão/multi OK em 78,00
       ↓
XML Builder (buildNfceXml)          ← RC7.10.2.1 (ICMSTot)
  → MODELO_LIQUIDO: vProd=78 · vDesc=0 · vNF=78
  → det/prod/imposto/ICMS/PIS/COFINS · pag/detPag
       ↓
Assinatura (assinarNFe / xml-crypto)
  → C14N + enveloped + SHA1 + RSA-SHA1  [não executada nesta auditoria]
       ↓
SOAP (soapClient / Autorizacao)
  → envelope pronto no runtime [não transmitido]
       ↓
SEFAZ
  → cStat 610 esperado eliminado no caso canônico (identidade vNF)
```

| Etapa | Valores produzidos |
|-------|--------------------|
| Motor | bruto, líquido por item, `valorFiscalEfetivo` |
| MIDP / Orquestrador | alocação fiscal, `saldoFiscal`, bloqueio insuficiente |
| XML Builder | `ide/emit/dest/det/ICMSTot/pag`, modelo totais, identidade SEFAZ |
| Assinatura | `Signature`, DigestValue, SignatureValue |
| SOAP | lote de autorização |
| SEFAZ | `protNFe` / cStat |

---

## 3. Validação 1 — XML gerado (sem transmitir)

| Arquivo | Descrição |
|---------|-----------|
| `nfce-caso-real-8340-540-7800-sem-assinar.xml` | Caso real (fixture parcial → `cMunFG`/`tpImp` undefined) |
| `nfce-caso-real-config-completa-sem-assinar.xml` | Mesmo caso com `municipioCodigo`+`tpImp` (caminho produção) |
| `relatorio-rc7103.json` | Evidência machine-readable |
| `auditar-rc7103.js` | Script de reprodução (somente leitura operacional) |

---

## 4. Validação 2 — Grupos do XML (caso canônico)

| Grupo | Presente | Observação |
|-------|----------|------------|
| ide | sim | `mod=65`, `tpAmb=2` |
| emit | sim | CRT=1 |
| dest | sim | CPF + indIEDest=9 |
| det[] / prod / imposto | sim | 1 item, vProd=78,00 |
| ICMS | sim | ICMSSN102 / CSOSN 102 |
| PIS / COFINS | sim | PISNT/COFINSNT CST 07 |
| IPI | não | mercadoria SN sem IPI |
| ISSQN | não | não serviço |
| ICMSTot | sim | MODELO_LIQUIDO |
| transp | sim | modFrete=9 |
| pag / detPag | sim | tPag=01, vPag=78,00 |
| infAdic | sim | homologação |
| infRespTec | não | opcional |
| Signature | não | pré-assinatura |
| protNFe | não | sem SEFAZ |
| vTotTrib | não | opcional NFC-e |
| infNFeSupl | não | anexado no emissor pós-QR |

---

## 5. Validação 3 — Totais

| Campo | Calculado | Enviado | Diff |
|-------|-----------|---------|------|
| Σ det.vProd | 78,00 | vProd 78,00 | 0,00 |
| vDesc | 0,00 | 0,00 | 0,00 |
| vFrete / vSeg / vOutro / vIPI / vST | 0 | 0 | 0 |
| vNF (SEFAZ) | 78 − 0 + 0… = 78,00 | 78,00 | **0,00** |
| Σ vPag | 78,00 | 78,00 | 0,00 |
| vTroco | — | ausente | N/A |

---

## 6. Validação 4 — Fórmulas SEFAZ

| Fórmula | Resultado |
|---------|-----------|
| vNF | **PASSOU** |
| Σ produtos = vProd | **PASSOU** |
| identidade ICMSTot (`validarIdentidadeICMSTot`) | **PASSOU** |
| Σ pag = vNF | **PASSOU** (caso canônico) |
| vBC / vICMS (CRT1 CSOSN102) | **PASSOU** (0) |
| vPIS / vCOFINS | **PASSOU** (0 NT) |
| vTotTrib | AUSENTE (opcional) |

---

## 7. Validação 5 — Arredondamentos

Todos os cenários de stress fecharam identidade `vNF = vProd − vDesc` com **diff 0,00**.  
Exceção operacional (não de arredondamento): desconto **0,01** com itens líquidos → modelo BRUTO e possível Δ pagamento = 0,01 (ver parecer).

| Desconto | Modelo | vProd | vDesc | vNF | Diff identidade |
|----------|--------|-------|-------|-----|-----------------|
| 0,01 | BRUTO | 10 | 0,01 | 9,99 | 0 |
| 0,02…0,99 | LIQUIDO* | 10 | 0 | 10 | 0 |
| Fracionado 1,511×5 | LIQUIDO | 7,55 | 0 | 7,55 | 0 |

\*Heurística com itens já no valor líquido informado.

**Diferença > R$ 0,01 nos totais ICMSTot do caso canônico:** não.

---

## 8. Validação 6 — Pagamentos

| Cenário | Orquestrador | saldoFiscal |
|---------|--------------|-------------|
| Dinheiro 78 | OK | 0 |
| PIX 78 | OK | 0 |
| Cartão 78 | OK | 0 |
| Multi PIX 50 + Dinheiro 28 | OK | 0 |
| Insuficiente 70 | FALHA esperada | 8 |

Regra observada no XML: `Σ vPag = vNF` (clip em pagamento único). **`vTroco` não é gerado.**

---

## 9. Validação 7 — Assinatura (código)

| Item | Status |
|------|--------|
| Canonicalization C14N 20010315 | presente em `signer.js` |
| Digest SHA1 | presente |
| RSA-SHA1 | presente |
| Enveloped-signature | presente |
| Reference URI / Id infNFe | `addReference` por Id |
| XML auditado contém Signature | **não** (pré-assinar) |
| RC7.10.2.1 alterou signer? | **não** (`git` sem diff em `signer.js`) |

---

## 10. Validação 8 — Schema XSD

- Schemas: `backend/schemas/nfe_v4.00/` (`nfe_v4.00.xsd`, `leiauteNFe_v4.00.xsd`, …)
- Ferramenta: **lxml 6.1.1** (xmllint ausente)
- Resultado XML config completa **sem assinatura:**  
  `VALID: False` — falta `Signature` (obrigatório no elemento `NFe`)
- Resultado fixture incompleta: falhas adicionais em `cMunFG`/`tpImp` = `undefined`
- Namespaces: `http://www.portalfiscal.inf.br/nfe` · versão `infNFe versao="4.00"`

---

## 11. Validação 9 — Regressão RC7.10.2.1

Escopo declarado da RC7.10.2.1: **somente ICMSTot / modelo de totais em `xmlBuilder.js`**.

| Módulo | Alterado pela RC7.10.2.1? | Nota |
|--------|---------------------------|------|
| Motor (`distribuidorEstoqueVenda`) | não (RC7.10.1 / working tree) | líquido fiscal |
| MIDP | não | sem diff HEAD nesta auditoria |
| Manifestação / DistDFe / Parser / MIIP / Compras / Central Entradas | não auditados como tocados por 7.10.2.1 | |
| SOAP / Certificado / UrlResolver | UrlResolver sem diff; RegistryBuilder dirty no tree (outro escopo) | |
| `signer.js` | não | |
| `xmlBuilder.js` | **sim** — MODELO_BRUTO/LIQUIDO + `validarIdentidadeICMSTot` | |

---

## 12. Validação 10 — Código duplicado

| Responsabilidade | Arquivos |
|------------------|----------|
| XML Builder NFC-e 65 | `backend/services/fiscal/xmlBuilder.js` |
| XML Builder NF-e 55 | `backend/services/fiscal/xmlBuilderNfeVenda.js` |
| ICMSTot devolução | `backend/services/fiscal/nfeDevolucaoCompra.js` |
| Cálculo desconto líquido | `backend/services/vendas/valorFiscalLiquido.js` |
| Rateio vDesc em itens (só BRUTO) | `xmlBuilder.js` `ratearDescontoNosItens` |
| vNF NF-e 55 | `xmlBuilderNfeVenda.js` (~L164–166) |

---

## 13. Validação 12 — Emissão simulada

| Check | Status |
|-------|--------|
| XML gerado sem transmitir | OK |
| Totais / identidade SEFAZ (caso 78) | OK |
| Schema envelope completo | FALHA esperada sem Signature |
| Assinatura | não executada |
| SOAP | não enviado |
| Inconsistência ICMSTot canônica | nenhuma |
| Inconsistência residual | fronteira 0,01 pag×vNF; sem vTroco |

---

## 14. Arquivos auditados

- `backend/services/fiscal/xmlBuilder.js`
- `backend/services/fiscal/signer.js`
- `backend/services/fiscal/emissor.js`
- `backend/services/fiscal/configService.js`
- `backend/services/fiscal/soapClient.js`
- `backend/services/fiscal/xmlBuilderNfeVenda.js`
- `backend/services/fiscal/nfeDevolucaoCompra.js`
- `backend/services/fiscal/core/UrlResolver.js`
- `backend/services/fiscal/core/RegistryBuilder.js`
- `backend/services/distribuidorEstoqueVenda.js`
- `backend/services/vendas/valorFiscalLiquido.js`
- `backend/services/midp/*`
- `backend/services/OrquestradorPagamento.js`
- `backend/schemas/nfe_v4.00/nfe_v4.00.xsd`
- Artefatos em `docs/auditoria/rc7103-homologacao-nfce/`

---

## 15. Conclusão operacional NFC-e (cStat 610)

Para o **caso real pós-RC7.10.1 + RC7.10.2.1** (itens líquidos 78, desconto comercial 5,40):

- `MODELO_LIQUIDO` → `vProd=78`, `vDesc=0`, `vNF=78`
- Fórmula SEFAZ fecha com diferença **0,00**
- Pagamento 78 aceito (`saldoFiscal=0`)

A rejeição **cStat 610** observada antes da RC7.10.2.1 está **eliminada nesse caminho**.  
A homologação **definitiva para produção absoluta** ainda é bloqueada pelos riscos listados no parecer (fronteira 0,01, assinatura/XSD pós-sign não evidenciados, `vTroco`, NF-e 55).
