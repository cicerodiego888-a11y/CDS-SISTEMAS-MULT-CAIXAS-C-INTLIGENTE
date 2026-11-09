# TEF-DESTAXA-51.03 Etapa 2 — STATUS INTERMEDIÁRIO

**Horário:** 2026-11-09 ~13:56 (America/Sao_Paulo)  
**Classificação parcial:** aguardando operador no PDV (ainda **sem** chamada financeira)

## Pré-checks (§1) — APROVADOS

| Item | Resultado |
| --- | --- |
| Ledger operacional | Ausente antes da emissão (sem ISSUED prévia) |
| Op financeira em andamento | Não (DLL sem TX hoje; último INIT 12:29) |
| NativeHost em voo | Não |
| VSPagueClient | PID 10256, Responding |
| Terminal ativado (sessão) | Sim (12:24 — Destaxa-LojaACB-TACB0120) |
| Gate global | OFF (User/Machine/Process ≠ `1`) |
| Conf Destaxa | Preservada (`V$PagueClient_Destaxa_LojaACB_TACB0120.conf`) |

## Emissão (§2) — CONCLUÍDA (única)

| Campo | Valor |
| --- | --- |
| authorizationId | `5aed71f2b6e19f7f14303f69242c6796` |
| status | **ISSUED** |
| valorCentavos | 100 |
| tipo | cartao_debito / debito |
| forma | A vista |
| operacao | CRT |
| emitidoEm | 2026-11-09T16:54:10.595Z |
| expiresAt | 2026-11-09T17:24:10.595Z (~14:24 local) |
| emitidoPor | responsavel-autorizado-51.03 |
| Gate após emissão | permanece OFF |

Ledger: `%LOCALAPPDATA%\CDS-SISTEMAS\tef\destaxa-autorizacao-excepcional.json`

## Preparação da venda (§3) — BLOQUEADA

- PDV workspace iniciado (`electron-pdv.js --cds-forcar-local`) — janela **CDS Sistemas - PDV**.
- Instalado `C:\Program Files\CDS PDV` **não** contém o módulo 51.02; por isso usa-se o PDV do workspace.
- Tela atual: **login** (Usuário/Senha). Sem credenciais do operador, a confirmação de venda R$1,00 débito à vista **não** pode ser feita.
- Regra §3: **PARAR antes da chamada financeira** até a venda estar confirmada.

## Ainda não executado

- CRT / TX_START / CONTINUE / FINALIZE
- Consumo da autorização (permanece ISSUED)
- Segunda emissão (proibida)

## Ação necessária do responsável

1. Fazer login no PDV que está aberto (workspace / código 51.02).
2. Abrir caixa se necessário.
3. Montar **uma** venda: total **R$ 1,00**, pagamento **somente débito à vista** (sem mistos/parcelas/crédito/PIX).
4. Terminal Destaxa homologado.
5. Avisar neste chat quando a tela de pagamento estiver pronta **ou** ao finalizar — ter o **cartão pessoal** no PinPad (COM4).
6. Após o aviso, a Etapa 2 segue com **uma** tentativa oficial e coleta de evidências.

**TTL:** autorização expira em **17:24:10Z (14:24 local)**. Depois disso será EXPIRED; nova emissão exigiria nova autorização explícita.
