# contracts/

DTOs de entrada e saída do MIIP.

Objetos de transporte imutáveis entre camadas — sem lógica de negócio.

## Arquivos

| Arquivo | Direção | Responsabilidade |
|---------|---------|------------------|
| `ItemIdentificavelDTO.js` | Entrada | Item externo a identificar |
| `ProdutoCandidatoDTO.js` | Saída parcial | Candidato retornado por um engine |
| `DecisaoIdentificacaoDTO.js` | Saída | Ação e confiança recomendadas |
| `RelatorioDecisaoDTO.js` | Saída | Relatório completo da operação |
