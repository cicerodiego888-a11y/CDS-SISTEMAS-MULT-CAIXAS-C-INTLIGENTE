# engines/fiscal/

Motor de identificação por **dados fiscais** (NCM, CFOP, tributação).

**Sprint 1.1:** pasta reservada — sem implementação.

## Responsabilidade

- Usar NCM como hint para restringir candidatos
- Correlacionar categoria fiscal com produtos cadastrados
- Score baixo — nunca decisão automática isolada

## Entrada

`ItemIdentificavelDTO.ncm`

## Peso sugerido

0.3 — score máximo ~50

## Integração

Alinhado ao Motor Fiscal do CDS — apenas hints, sem cálculo tributário.
