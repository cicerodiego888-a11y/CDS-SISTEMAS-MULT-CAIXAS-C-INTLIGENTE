# RC6.9 — Alinhamento oficial da Manifestação do Destinatário (Ambiente Nacional)

**Versão:** CDS Sistemas V1.0  
**Data:** 2026-07-18  
**Escopo:** somente roteamento oficial da Plataforma Fiscal (Registry / UrlResolver / Runtime / Legado / Central hardcode).  
**Fora de escopo:** Parser, MIIP, Compras, máquina de estados, regras de negócio.

---

## 1. Confirmação documental — AN ou SVRS?

### Resposta objetiva

A Manifestação do Destinatário deve utilizar:

**(X) Ambiente Nacional (AN)**  
( ) SVRS

### Evidências

| Fonte | Evidência |
|-------|-----------|
| **Portal Nacional da NF-e** — Relação de Serviços Web (seção Ambiente Nacional) | `RecepcaoEvento \| 4.00 \| https://www.nfe.fazenda.gov.br/NFeRecepcaoEvento4/NFeRecepcaoEvento4.asmx` |
| **NT 2020.001 v1.60** §6.3 | *“Os endereços dos Web Services estão publicados no Portal da NF-e, no **ambiente nacional** (https://www.nfe.fazenda.gov.br, menu Serviços, Relação de Serviços Web).”* |
| **NT 2020.001** campo P08 `cOrgao` | Código do órgão = **91 — Ambiente Nacional** |
| **NT 2020.001** regra H07 | Validação de UF do destinatário × UF do WS **não se aplica ao Ambiente Nacional** (atende todas as UF) |
| **NT 2016.002 (NF-e 4.00)** | Eliminação de `nfeCabecMsg` (área de cabeçalho SOAP) nas requisições |
| **NFePHP** `Tools::sefazManifesta` | `return $this->sefazEvento('AN', ...)` + WSDL AN `NFeRecepcaoEvento4` |
| **FlexDocs** | `siglaWS = "AN"` (RS apenas opcional para destinatário RS) |
| **TecnoSpeed** | Manifestação com layout nacional — `aCOrgao = 91` |

---

## 2. Justificativa técnica

Na RC6.8 constatou-se que o CDS enviava o evento 210210 (já com `cOrgao=91`, assinatura e XSD corretos) ao **SVRS**, enquanto o contrato oficial exige o webservice **RecepcaoEvento4 do Ambiente Nacional**.

Isso é incompatível com:

1. Portal / NT 2020.001 (roteamento AN)  
2. Referência NFePHP / FlexDocs / TecnoSpeed  

O cStat **215** (Falha no schema XML) com XML válido offline é consistente com envio do layout nacional ao autorizador estadual.

RC6.9 corrige **apenas** o roteamento — sem mudar ciclo DF-e, políticas ou persistência.

---

## 3. Arquivos alterados

| Arquivo | Alteração |
|---------|-----------|
| `backend/services/fiscal/core/RegistryBuilder.js` | `MANIFESTACAO_*` → `uf: AN` + `ENDPOINTS.AN_RECEPCAO_EVENTO` |
| `backend/services/fiscal/core/UrlResolver.js` | Força `uf=AN` para qualquer `isManifestacaoOperation` |
| `backend/services/fiscal/core/OperationType.js` | Helper `isManifestacaoOperation` |
| `backend/services/fiscal/core/index.js` | Export do helper |
| `backend/services/fiscal/manifestacaoRuntime.js` | Resolve sempre AN; envelope com `cOrgao=91` |
| `backend/services/fiscal/manifestacaoLegado.js` | URL via Registry; remove `nfeCabecMsg`; sem URL hardcoded |
| `backend/motores/central-entradas/services/CentralManifestacaoDfeService.js` | Remove `uf:'SVRS'`; Central não escolhe autorizador |
| `backend/motores/central-entradas/services/CentralConfiguracaoService.js` | Painel resolve Manifestação via `UF_AN` |
| `tests/fiscal/webservice-registry.test.js` | Expectativas AN |
| `tests/fiscal/url-resolver.test.js` | Teste força AN |
| `tests/fiscal/fiscal-manifestacao-runtime.test.js` | Endpoint AN + sem header |
| `tests/central-entradas/rc41-endpoints-ux.test.js` | URLs AN no painel |
| `tests/central-entradas/rc4-configuracao.test.js` | URLs AN no painel |
| `docs/RC6.9_MANIFESTACAO_AN.md` | Este relatório |

---

## 4. Comparação Antes × Depois

| Item | Antes (RC6.8) | Depois (RC6.9) |
|------|---------------|----------------|
| Autorizador | SVRS | **Ambiente Nacional (AN)** |
| Endpoint produção | `https://nfe.svrs.rs.gov.br/ws/recepcaoevento/recepcaoevento4.asmx` | `https://www.nfe.fazenda.gov.br/NFeRecepcaoEvento4/NFeRecepcaoEvento4.asmx` |
| Endpoint homolog | `https://nfe-homologacao.svrs.rs.gov.br/.../recepcaoevento4.asmx` | `https://hom1.nfe.fazenda.gov.br/NFeRecepcaoEvento4/NFeRecepcaoEvento4.asmx` |
| Registry `uf` | `SVRS` | `AN` |
| Central hardcode | `uf: 'SVRS'` | **removido** |
| Legado URL | Hardcoded SVRS | `RegistryBuilder.buildOfficial()` |
| Header SOAP | `nfeCabecMsg` + `cUF` UF autor | **eliminado** (NT 2016.002) |
| Body `cOrgao` | 91 (já ajustado) | **91** (default + ajuste) |
| SOAPAction | `.../NFeRecepcaoEvento4/nfeRecepcaoEvento` | **inalterado (correto)** |
| `versaoDados` / leiaute | `1.00` | **1.00** |

---

## 5. Header SOAP

Com respaldo da **NT 2016.002 (NF-e 4.00)**:

- Eliminado `soap12:Header` / `nfeCabecMsg` do envelope de Manifestação.
- Envelope = XML declaration + `soap12:Envelope` + `soap12:Body` + `nfeDadosMsg` + `envEvento`.
- Cancelamento NFC-e e demais serviços **não** foram alterados nesta sprint.

---

## 6. Resultado dos testes

| Suite | Resultado |
|-------|-----------|
| `test:webservice-registry` | **16 ok, 0 falha** |
| `test:url-resolver` | **19 ok, 0 falha** |
| `test:fiscal-manifestacao-runtime` | **OK (todos)** — endpoint AN confirmado nos logs |
| `test:soap-transport` | **OK** |
| `test:fiscal-telemetria` | **14 ok, 0 falha** |
| `rc4-configuracao` / `rc41-endpoints-ux` | **OK** após alinhar asserts ao AN |
| `test:central-integridade` (cadeia) | Demais testes OK; assertion UI `Configurações Avançadas` em `rc31` é **fora do escopo** RC6.9 (frontend não alterado) |

### Log de runtime (homologação simulada)

```
Endpoint: https://hom1.nfe.fazenda.gov.br/NFeRecepcaoEvento4/NFeRecepcaoEvento4.asmx
UF: AN
SOAPAction: http://www.portalfiscal.inf.br/nfe/wsdl/NFeRecepcaoEvento4/nfeRecepcaoEvento
HTTP: 200 (httpClient mock)
```

---

## 7. Auditoria final do contrato (produção)

| Campo | Valor |
|-------|-------|
| **Endpoint** | `https://www.nfe.fazenda.gov.br/NFeRecepcaoEvento4/NFeRecepcaoEvento4.asmx` |
| **Host** | `www.nfe.fazenda.gov.br` |
| **Autorizador** | Ambiente Nacional (AN) |
| **WSDL** | `NFeRecepcaoEvento4` |
| **SOAPAction** | `http://www.portalfiscal.inf.br/nfe/wsdl/NFeRecepcaoEvento4/nfeRecepcaoEvento` |
| **Header** | Ausente (`nfeCabecMsg` removido) |
| **Body** | `nfeDadosMsg` → `envEvento` → `evento` (`cOrgao=91`, `tpEvento=210210`) |
| **cStat esperado** | **135** (Evento registrado) ou **573** (duplicidade) — **não 215** |

### Resultado real SEFAZ (certificado / produção)

Não executado nesta sprint (sem POST real com certificado nesta sessão).  
Validação operacional: enviar Ciência 210210 pela Central e conferir `cStat` ∈ {135, 573} e `endpoint` contendo `nfe.fazenda.gov.br`.

---

## 8. Critério de sucesso

| Critério | Status |
|----------|--------|
| Documentação confirma AN | **Sim** |
| Registry publica Manifestação em AN | **Sim** |
| UrlResolver força AN | **Sim** |
| Central sem hardcode de autorizador | **Sim** |
| Legado sem URL própria | **Sim** |
| Header alinhado à NT 2016.002 | **Sim** |
| Testes de roteamento verdes | **Sim** |
| cStat 135/573 em produção | **Pendente validação operacional** |

---

## 9. Confirmação de não-impacto

Não foram alterados: Parser Oficial, MIIP, Compras, máquina de estados, DistDFe (já era AN), Autorização/Cancelamento SVRS, políticas de Manifestação.
