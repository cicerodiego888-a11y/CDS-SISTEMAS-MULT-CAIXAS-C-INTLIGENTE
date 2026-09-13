# events/

Sistema de eventos do MIIP.

**Sprint 1.1:** pasta reservada — sem implementação.

## Finalidade

Desacoplar reações do MIIP (logs, aprendizado, notificações)
da lógica principal de identificação via publicação de eventos.

## Eventos previstos

| Evento | Quando dispara |
|--------|----------------|
| **ProdutoAssociado** | MIIP vinculou item a produto existente com confiança ALTA |
| **ProdutoCriado** | Decisão `criar_novo` ou fallback legado criou produto |
| **AssociacaoConfirmada** | Operador confirmou sugestão do MIIP |
| **AssociacaoRecusada** | Operador rejeitou sugestão e escolheu outro produto |
| **ConfiancaBaixa** | Score abaixo do threshold — requer atenção do operador |

## Princípios

- Eventos são imutáveis (payload em DTO)
- Publicação assíncrona — não bloqueia o pipeline
- Consumidores futuros: `AprendizadoService`, `LogService`, webhooks MIIP Cloud

## Arquivos previstos

- `MiipEventEmitter.js` — barramento interno
- `MiipEventTypes.js` — constantes dos eventos acima
- `MiipEventPayload.js` — envelope padrão (requestId, timestamp, dados)
