# RC7.1 — Rastreamento do PROC_NFE

**Data:** 2026-07-18  
**Modo:** somente leitura (nenhuma regra de negócio alterada)  
**Chave alvo:** `23260725757840006327550010010248001140985160`

---

## Veredito

A chave **chega** no DistDFe da SEFAZ, mas **somente como `resNFe` (RES_NFE)**, nunca como `procNFe` / `nfeProc`.

O XML completo **não entra** na Central porque a SEFAZ **não entrega PROC_NFE** para essa chave via DistDFe (consulta por chave nem lote por NSU). A ruptura operacional anterior que reforça esse bloqueio é a **manifestações 210210 rejeitada com cStat 596** (prazo de 10 dias vencido).

`CentralDocumentoAtualizacaoService` e o **Parser** **nunca são acionados** para essa chave: o pipeline para em “aguardar XML completo” sem nunca receber um documento classificado como `PROC_NFE`/`NFE`.

---

## 1. Caso na Central (antes da reprova DistDFe)

| Campo | Valor |
|-------|--------|
| Documento id | **21** |
| Status | `AGUARDANDO_XML_COMPLETO` |
| status_detalhe | Resumo DF-e recebido. Aguardando XML completo. |
| tipo_documento | `RES_NFE` |
| NSU | `000000000000011` |
| XML | 557 bytes (`<resNFe>…</resNFe>`) |
| Fornecedor | PEIXOTO COMERCIO INDUSTRIA SERVICOS E TRANSPORTES S/A |
| Valor | 447.79 |
| Criado | 2026-07-18 23:15:25 |

### Eventos do documento 21

| id | tipo | resultado | quando |
|----|------|-----------|--------|
| 52 | `DOCUMENTO_RECEBIDO` | `AGUARDANDO_XML_COMPLETO` | 23:15:25 |
| 110 | `CIENCIA_ENVIADA` | `ENVIADA` (210210) | 23:17:59 |
| 111 | `MANIFESTACAO_REJEITADA` | **cStat `596`** | 23:17:59 |

Detalhe da rejeição (AN — RC6.9):

- Endpoint: `https://www.nfe.fazenda.gov.br/NFeRecepcaoEvento4/NFeRecepcaoEvento4.asmx`
- HTTP 200 / ~396 ms
- `xMotivo`: *Rejeicao: Evento apresentado apos o prazo permitido para o evento: [10 dias]*
- Emissão da NF-e (`dhEmi` no resNFe): **2026-07-03**
- Ciência na Central: **2026-07-18** (> 10 dias)

---

## 2. DistDFe executado (mesmo stack da Central)

**Ambiente:** produção (`tpAmb=1`)  
**CNPJ:** `65957340000150`  
**UF autor:** `23` (CE)  
**Endpoint:** `https://www1.nfe.fazenda.gov.br/NFeDistribuicaoDFe/NFeDistribuicaoDFe.asmx`  
**Evidências em:** `C:\ProgramData\MercantilFiscal\dados\fiscal\debug-rc71\`

### 2.1 Consulta por chave (`consChNFe`) — o mesmo tipo de DistDFe para buscar a NF

Payload (`01-consulta-consChNFe.xml`):

```xml
<distDFeInt ...>
  <tpAmb>1</tpAmb>
  <cUFAutor>23</cUFAutor>
  <CNPJ>65957340000150</CNPJ>
  <consChNFe>
    <chNFe>23260725757840006327550010010248001140985160</chNFe>
  </consChNFe>
</distDFeInt>
```

| Campo | Valor |
|-------|--------|
| HTTP | 200 |
| cStat | **138** — Documento localizado |
| docZip | **sim** (1 documento) |
| NSU | **000000000000011** |
| schema | **resNFe_v1.01.xsd** |
| raiz descompactada | **resNFe** |
| classificação Central | **RES_NFE** |
| veio como procNFe / nfeProc? | **não** |
| tempo SOAP | ~592 ms |

SOAP bruto: `02-soap-retorno-consChNFe.xml`  
XML descompactado: `03-docZip-nsu-000000000000011-RES_NFE.xml`

```xml
<resNFe ... versao="1.01" ...>
  <chNFe>23260725757840006327550010010248001140985160</chNFe>
  <CNPJ>25757840006327</CNPJ>
  <xNome>PEIXOTO COMERCIO INDUSTRIA SERVICOS E TRANSPORTES S/A</xNome>
  <IE>065104897</IE>
  <dhEmi>2026-07-03T00:00:00-03:00</dhEmi>
  <tpNF>1</tpNF>
  <vNF>447.79</vNF>
  <digVal>zFyog1Icf1jAfN9x0CA47FRQzcI=</digVal>
  <dhRecbto>2026-07-03T06:47:48-03:00</dhRecbto>
  <nProt>223260069560325</nProt>
  <cSitNFe>1</cSitNFe>
</resNFe>
```

### 2.2 Lote `distNSU` a partir do ultNSU corrente (27)

| Campo | Valor |
|-------|--------|
| HTTP | 200 |
| cStat | **138** — Documento(s) localizado(s) |
| docZip | 8 documentos (NSU 28–35) |
| schemas | todos `procNFe_v4.00.xsd` / raiz `nfeProc` |
| chave alvo presente em algum docZip? | **não** |

SOAP bruto: `05-soap-retorno-distNSU-27.xml`  
Conclusão: o lote atual traz PROC de **outras** notas; **esta chave não reaparece** no stream de NSU após o NSU 011 (já consumido como `resNFe`).

---

## 3. Pipeline — onde a NF-e deixa de evoluir

```
DistDFe (consChNFe / distNSU)
        ↓
   docZip presente?  → SIM (NSU 011, schema resNFe_v1.01.xsd)
        ↓
   descompactação    → OK (557 bytes, raiz resNFe)
        ↓
   classificação     → RES_NFE (DocumentoDfeClassifier)
        ↓
   persistência      → CentralDfePersistenciaService
                       (já existente → duplicado; status permanece
                        AGUARDANDO_XML_COMPLETO)
        ↓
   Manifestação 210210 → REJEITADA cStat 596 (prazo 10 dias)
        ↓
   DistDFe PROC_NFE  → SEFAZ NÃO entrega procNFe desta chave
        ↓
   CentralDocumentoAtualizacaoService.atualizarComXmlCompleto
                       → NÃO EXECUTADO
                       (só entra se tipoDfe ∈ {PROC_NFE, NFE}
                        e status = AGUARDANDO_XML_COMPLETO)
        ↓
   Parser / MIIP     → NÃO EXECUTADO
```

### Ponto exato de ruptura para o PROC_NFE

**Entre “classificação/persistência do RES_NFE” e “recebimento de XML completo”.**

Não é bug de descompactação, classificação, atualização nem Parser. A Central **espera** `PROC_NFE`/`NFE` para chamar `atualizarComXmlCompleto`; a SEFAZ, neste caso, **só devolve o resumo**.

Compatível com comportamento do Ambiente Nacional: sem ciência/manifestação válida no prazo (e com 596 após os 10 dias), o DistDFe por chave costuma continuar liberando apenas `resNFe`. O download manual no Portal Nacional **não implica** que o mesmo XML completo esteja disponível via webservice DistDFe.

---

## 4. Entregáveis solicitados

| Item | Conteúdo |
|------|----------|
| Log completo | `debug-rc71/00-log-rc71.json` + logs `[FISCAL:DISTRIBUICAO_DFE]` da execução |
| XML bruto SEFAZ | `02-soap-retorno-consChNFe.xml` + docZip descompactado `03-…-RES_NFE.xml` |
| Tipo do documento | **RES_NFE** (`resNFe_v1.01.xsd`) |
| Classificação | `DocumentoDfeTipo.RES_NFE` |
| Status final na Central | **`AGUARDANDO_XML_COMPLETO`** (sem alteração nesta auditoria) |
| procNFe? | **não** |
| NSU da chave | **000000000000011** |

---

## 5. O que *não* foi a causa

- Certificado / CNPJ-Base (config atual alinhada; DistDFe retornou 138).
- Roteamento Manifestação fora do AN (endpoint AN em uso; rejeição é 596 de prazo, não 215 de schema).
- Falha do parser DistDFe / `docZip` (descompactação e classificação corretas).
- Falha silenciosa de `CentralDocumentoAtualizacaoService` (o serviço simplesmente **não recebe** entrada elegível).

---

## 6. Implicação operacional (informativa; sem mudança de regra)

Para esta chave evoluir além de `AGUARDANDO_XML_COMPLETO` seria necessário obter o XML completo por **outro canal já previsto** (ex.: upload manual do XML do Portal) **ou** outra via SEFAZ que entregue `nfeProc` — o DistDFe atual **não** o entrega. Ciência 210210 agora está **fora do prazo legal** (596).
