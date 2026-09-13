# TEF-03 — Descoberta e Preparação da Integração REDE Real

**Data:** 2026-09-10  
**Tipo:** Auditoria técnica / preparação arquitetural  
**Alterações funcionais:** nenhuma  

## Decisão

**OPÇÃO B — INTEGRAÇÃO REDE NÃO IDENTIFICADA**

**Resultado do sprint:**  
`TEF-03 CONCLUÍDO — INTEGRAÇÃO AINDA NÃO IDENTIFICADA.`

**Não avançar para TEF-04** até obter informação oficial do caminho de integração.

---

## Evidências resumidas

| Camada | Status |
|--------|--------|
| `redeAdapter.js` | Somente simulação (`SimulatedGatewayAdapter`) |
| SDK / DLL / EXE REDE | Não encontrados no Windows nem no projeto |
| Middleware CliSiTef / PayGo | Pastas e programas ausentes |
| PPC930 | Confirmado (COM4 + driver USB CDC Gertec) |
| Doc oficial REDE no workspace | Ausente |

---

## Fluxo pretendido (com lacunas honestas)

```
CDS PDV
  ↓
TefManager
  ↓
RedeAdapter (hoje: SIMULAÇÃO)
  ↓
??? integração oficial REDE   ← PENDENTE DE INFORMAÇÃO OFICIAL
  ↓
??? componente local/remoto   ← PENDENTE DE INFORMAÇÃO OFICIAL
  ↓
PPC930 (COM4)                 ← CONFIRMADO (hardware)
  ↓
Cartão / Autorização / REDE   ← PENDENTE DE INFORMAÇÃO OFICIAL
  ↓
TefManager → Venda
```

## Possíveis caminhos (sem escolha arbitrária)

| Caminho | Evidência no ambiente | Status |
|---------|----------------------|--------|
| A — SDK/API local REDE | Nenhum componente | DESCONHECIDO |
| B — Middleware (CliSiTef/PayGo) operando pinpad Rede | Só docs internas CDS; software não instalado | PROVÁVEL intenção de produto (comentários UI), NÃO CONFIRMADO como requisito deste ambiente |
| C — API cloud e-Rede | Zero evidência no projeto/Windows | DESCONHECIDO |
| D — Outro mecanismo oficial | Sem documentação | DESCONHECIDO |

## O que obter antes do TEF-04

1. Documento oficial do adquirente/fornecedor TEF escolhido (REDE / Vero / Software Express / PayGo / outro).
2. Nome do produto/software a instalar no Windows do caixa.
3. Tipo de integração: DLL, EXE, TCP, HTTP API, middleware.
4. Como o PPC930 é endereçado nesse produto (COM, auto, etc.).
5. Credenciais e códigos (empresa/loja/terminal) exigidos.
6. Ambiente e roteiro de homologação.
7. Regras oficiais de retry/idempotência/reversão.

## Preservado

TEF-01 e TEF-02 intactos (config única, diagnóstico, detecção PPC930/COM4, testes).
