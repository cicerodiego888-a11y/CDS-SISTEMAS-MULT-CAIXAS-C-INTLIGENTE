# Marco oficial — Arquitetura Comercial/Fiscal V4

| Campo | Valor |
|---|---|
| **Nome** | Arquitetura Comercial/Fiscal V4 |
| **Versão** | 4.0 |
| **RC** | RC4.1.0 |
| **Status** | **CONGELADA** |
| **Data** | 2026-07-25 |
| **Documento mestre** | [ARQUITETURA_COMERCIAL_FISCAL_V4.md](./ARQUITETURA_COMERCIAL_FISCAL_V4.md) |

---

## Declaração

A partir desta data, o fluxo canônico abaixo é **oficial e congelado**:

```
Pedido → Separação → Expedição → Núcleo Transacional → Central de Faturamento → NF-e → DANFE
```

### Congelado (não alterar no fluxo principal)

- Separação comercial × fiscal (Expedição não emite NF-e)
- Emissão canônica via Central de Faturamento
- Contrato do Núcleo para `VendaOrigin.FATURAMENTO`
- Checklist de pendências como gate pré-SEFAZ
- Painel operacional (fila, dashboard, monitoramento)

### Permitido apenas em módulos independentes

- MDF-e, CT-e, CT-e OS  
- CC-e, Manifestação do Destinatário  
- NFC-e (já existente em outro pipeline)  
- Novos eventos SEFAZ  
- RBAC granular obrigatório (estrutura já preparada)

### Proibido sem nova RC arquitetural

- Reacoplar emissão NF-e dentro de `FaturamentoService.faturarPedido`
- Remover a Central como hub operacional
- Alterar motores/XML/SOAP/assinatura sob pretexto de “UX da Central”
- Mudar enums/schema de venda/pedido sem RC dedicada

---

## Aprovações de congelamento (checklist)

- [x] Auditoria do fluxo Comercial / Logístico / Fiscal  
- [x] Expedição sem `emitirNfePorVendaId`  
- [x] Central RC4.0.0–4.0.2 operacional  
- [x] Nomenclatura Comercial × Fiscal  
- [x] Estrutura de permissões V4 preparada  
- [x] Documentação oficial publicada  
- [x] Testes de regressão RC4.0.x + RC4.1.0  

---

**Assinatura do marco:** CDS Sistemas — Arquitetura Comercial/Fiscal V4 — **CONGELADA** — RC4.1.0.
