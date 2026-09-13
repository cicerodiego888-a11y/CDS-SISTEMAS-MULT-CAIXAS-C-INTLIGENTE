# Princípio de Comunicação entre Motores — CDS Sistemas V1

A partir do MTS V1.0 fica estabelecido o seguinte princípio arquitetural
obrigatório da plataforma CDS Sistemas:

> **Nenhum Motor poderá acessar diretamente a estrutura interna de outro Motor.**
> **Toda comunicação entre Motores deverá ocorrer exclusivamente através de Interfaces Públicas (API Interna / Serviços Públicos).**

## Objetivo

- Baixo acoplamento
- Alta reutilização
- Facilidade de manutenção
- Evolução independente de cada Motor
- Maior estabilidade da plataforma

Se um Motor alterar sua implementação interna, nenhum outro Motor precisará ser modificado.

## Escopo

Aplica-se a todos os Motores existentes e futuros, incluindo:

- Motor Comercial
- Motor Fiscal × Não Fiscal
- MIIP
- MIDP
- Motor Financeiro
- Motor de Equipamentos
- MTS
- Motores futuros

## Exemplo (MTS)

O MTS **não** executa SELECT/UPDATE/INSERT/DELETE em tabelas de estoque.
Ele consome apenas a Interface Pública em `backend/services/fiscalNaoFiscal`
(`consultarSaldo`, `debitarSaldo`, `creditarSaldo`, `executarEmTransacao`).
