# Validação fiscal pendente — Fechamento Fiscal do Dia

**Status:** AGUARDANDO VALIDAÇÃO FISCAL
**Escopo:** diagnóstico do CSOSN do snapshot, sem alteração de cadastro, documento histórico ou regra fiscal.

## Identificação interna do incidente

- Fechamento: ID 6
- Documento interno: ID 16
- Sequência: 1
- Produto: ID 366
- Valor histórico confirmado no snapshot: `60`
- Evidência histórica: consulta read-only anteriormente autorizada ao snapshot do documento. Nenhuma consulta ao banco oficial foi feita nesta sprint.

## Matriz da auditoria técnica

| Elemento | Evidência local |
|---|---|
| Origem do CSOSN | Na preparação, `carregarProdutos()` seleciona `csosn` da tabela `produtos` para os produtos presentes na prévia. O cadastro atual não foi consultado nesta sprint; não se presume que corresponda ao valor histórico. |
| Snapshot | O serviço copia `String(prod.csosn || '').trim()` para o snapshot do item e persiste o valor em `fechamentos_fiscais_documentos_itens.csosn` e `snapshot_json`. O documento transmitido recupera `snapshot_json` e usa esse snapshot na montagem. Ver [FechamentoFiscalPreparacaoService.js](../../backend/services/fechamento-fiscal/FechamentoFiscalPreparacaoService.js) e [FechamentoFiscalTransmissaoService.js](../../backend/services/fechamento-fiscal/FechamentoFiscalTransmissaoService.js). |
| Normalização | `normalizarCsosn()` remove caracteres não numéricos e completa à esquerda até três posições. Assim, a entrada histórica `"60"` produz `"060"`. Ver [xmlBuilder.js](../../backend/services/fiscal/xmlBuilder.js). |
| Validação | `montarBlocoIcmsSimplesNacional()` seleciona ramos para `101`, `102`, `103`, `300`, `400`, `500` e `900`; valores que não correspondem a esses ramos chegam ao `throw`. Portanto, a entrada `"60"` é rejeitada após normalização para `"060"`. Esta descrição registra o comportamento implementado, não valida sua conformidade fiscal para o caso concreto. |
| Mensagem original | `CSOSN 060 inválido para NFC-e. Use 102, 103, 300, 400, 500 ou 900 no cadastro do produto.` A mensagem não lista `101`, embora exista ramo para esse código no builder. Essa inconsistência textual não foi alterada. |
| Escopo | O helper é chamado por `buildNfceXml()`. No código local, esse builder é usado pelo serviço de preparação do fechamento e por `backend/services/fiscal/emissor.js`; os pontos de chamada são NFC-e. Não foi identificada evidência de que o helper seja uma validação compartilhada com NF-e. |
| API e interface | A rota serializa `XML_ERRO` por `criarPayloadErroXml()`; `ffdErroApi()` exibe diagnósticos sanitizados dos documentos e registra metadados limitados no console. Ver [fechamento-fiscal.js](../../backend/rotas/fechamento-fiscal.js), [DiagnosticoPreparacaoFiscal.js](../../backend/services/fechamento-fiscal/DiagnosticoPreparacaoFiscal.js) e [fechamento-fiscal-dia.js](../../frontend/erp/js/fechamento-fiscal-dia.js). |
| Testes | O teste de diagnóstico reproduz o snapshot com `csosn: '60'`, verifica a mensagem contendo `CSOSN 060`, a etapa `montagem_xml` e o diagnóstico sanitizado. Há testes de geração NFC-e com `102` em [rc7104-estabilizacao-nfce.test.js](../../tests/fiscal/rc7104-estabilizacao-nfce.test.js), [rc71021-icmstot-modelo-totais.test.js](../../tests/fiscal/rc71021-icmstot-modelo-totais.test.js) e [rc7105-icmstot-multiplos-itens.test.js](../../tests/fiscal/rc7105-icmstot-multiplos-itens.test.js). Esses testes cobrem o comportamento do código, não aprovam a classificação do produto do incidente. |
| Classificação correta | **Pendente.** O código-fonte e a rejeição do builder não comprovam qual classificação se aplica ao produto e à operação. Não foi encontrada evidência fiscal específica no workspace que permita decidir. |

## Ficha para o responsável fiscal

Preencher após examinar documentação vigente e específica do produto e da operação. Não inferir uma classificação a partir da lista implementada no builder.

### Evidências a examinar

- Regime tributário do emitente aplicável na data e operação em questão.
- Identificação/classificação fiscal documentada do produto, incluindo NCM, CEST se aplicável, características e documentação de aquisição.
- Operação concreta: natureza, CFOP, origem/destino, data e tratamento tributário aplicável ao documento.
- Documentação fiscal de suporte e orientação do contador/responsável fiscal.
- Se houver divergência entre fontes, referência à consulta ou parecer competente que a resolva.

### Conclusão — preencher pelo responsável fiscal

- **Conclusão sobre o CSOSN aplicável:** ______________________________________
- **Justificativa, incluindo regime, produto e operação:**
  __________________________________________________________________________
  __________________________________________________________________________
- **Referência documental (identificação/data, sem anexar dados pessoais desnecessários):**
  __________________________________________________________________________
- **Origem do problema identificada** (selecionar e justificar):
  - [ ] Cadastro de origem incorreto
  - [ ] Geração do snapshot incorreta
  - [ ] Regra de validação do builder incompatível com a classificação comprovada
  - [ ] Outra causa ou inconclusivo: _________________________________________
- **Ação autorizada e escopo:** ______________________________________________
- **Responsável pela aprovação:** ____________________________________________
- **Data da aprovação:** ____________________________________________________

**Não alterar cadastro, snapshots históricos ou regra do builder com esta ficha em branco ou inconclusiva.** Uma eventual correção de cadastro exige autorização explícita separada; uma eventual alteração do builder exige evidência de compatibilidade fiscal e teste isolado.

## Decisão técnica desta auditoria

A evidência disponível comprova o caminho técnico `csosn="60"` → `"060"` → rejeição durante a montagem do XML, mas não identifica se a falha está no cadastro de origem, na geração do snapshot ou na regra do builder. Não há base para escolher ou substituir um código. A implementação fiscal permanece bloqueada até a conclusão documentada acima.
