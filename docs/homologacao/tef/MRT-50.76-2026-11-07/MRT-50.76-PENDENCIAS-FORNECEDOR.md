# MRT-50.76 — Pendências e perguntas ao fornecedor Destaxa / ACB

**Classificação:** `PENDENTE DE FORNECEDOR`

Pacote anexo sugerido ao chamado: este diretório + referências `MRT-50.74` / `MRT-50.75` + trechos de `vspague-client.log`.

---

## Dados técnicos para o chamado (copiar)

```
Estação hostname: desktop-4b8amm3 / DESKTOP-4B8AMM3
Identidade V$Pague: Destaxa-LojaACB-TACB0120
.conf: V$PagueClient_Destaxa_LojaACB_TACB0120.conf
Endpoint: app-partner.destaxa.cloud:60410 (TLS)
IP resolvido: 129.148.36.0
Client: V$PagueClient 5.0.0 (5.0.0-1-e094d4f-1084-release)
AC: CDS Sistemas 1.0.3
PinPad: Gertec PPC-930 / COM4 (CDS)
MAC Wi-Fi física (amostra): C0:A8:10:DB:EE:9E
HostMacAddressGet (00:21): 00:15:5D:D0:2D:3E
HostMacAddressGet (15:20): 00:15:5D:65:9B:C4
MacAdressFilter inclui: Hyper-V + C0:A8:10:DB:EE:9E
Janelas falha Identificar (America/Recife): 2026-11-07 00:21, 15:20, 19:23
Padrão: TLS Connected → Identificar → Connection breaked (-1) (129.148.36.0) → timeout ~10s
CRT 19:23: tipoCartao=Debito aceito localmente; Destaxa retorno 09
CRT anterior 18:01: tipoCartao=Débito rejeitado (tag inválida) → 05
```

---

## Perguntas objetivas

### Partner Cloud / Identificar

1. Por que a sessão TLS em `app-partner.destaxa.cloud:60410` é **fechada pelo peer** `129.148.36.0` imediatamente após o handshake durante **Identificar**?
2. O terminal/hostname/MAC desta estação está **autorizado** a Identificar em homologação nesta data?
3. Qual MAC deve ser o canônico quando existem Hyper-V + Wi-Fi no `MacAdressFilter`?
4. Há incidente ou degradação conhecida do Partner Cloud em **2026-11-07** (00:21 / 15:20 / 19:23 Recife)?
5. Qual procedimento oficial confirma prontidão do PinPad/Client **sem** executar compra?

### Identidade e cadastro

6. `Destaxa-LojaACB-TACB0120` corresponde a qual cadastro (estabelecimento / loja / terminal)?
7. Quais são os literais oficiais de **estabelecimento**, **loja** e **terminal** para a AC enviar em `iniciaClientDestaxa` (se necessários)?
8. A aplicação **`CDS Sistemas`** está corretamente cadastrada no Partner Cloud?

### Contrato CRT (já mitigado localmente)

9. Confirmam que o literal canônico de débito é **`Debito`** (ASCII), e não `Débito`?
10. Após estabilizar Identificar, há restrição adicional para CRT homologação R$ 1,00 débito A vista?

### Equipamento

11. A PPC-930 / COM4 deve estar associada a esse terminal no V$Pague — como validar na UI sem CRT?
12. O retorno **`09`** pós-timeout de Identificar durante CRT é o comportamento esperado?

---

## O que pedir em resposta do fornecedor

- Confirmação se o Identificar desta estação **deveria** completar.
- Logs server-side das sessões nos horários acima (se disponíveis).
- Literais oficiais de códigos (se forem obrigatórios operacionalmente).
- Orientação se restart do Client, re-provisionamento ou ajuste de MAC filter é necessário (**sem** pedirmos alterar nada até aprovação).

---

## Restrições CDS (informar)

Não repetiremos CRT sem nova autorização explícita. Gate real permanece OFF. UNKNOWN históricos não serão reconciliados automaticamente.
