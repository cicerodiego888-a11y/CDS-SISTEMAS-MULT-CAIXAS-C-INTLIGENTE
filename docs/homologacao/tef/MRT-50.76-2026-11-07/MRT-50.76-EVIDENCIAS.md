# MRT-50.76 — Pacote de evidências Destaxa / Partner Cloud

| Campo | Valor |
|---|---|
| Data | 2026-11-07 |
| Gate | `DESTAXA_REAL_TRANSACTION_ENABLED=0` |
| NativeHost / DLL / CRT / TX | **Não executados** |
| Classificação | **`PENDENTE DE FORNECEDOR`** |

---

## 1. Identidade operacional (fatos)

| Item | Valor comprovado | Fonte |
|---|---|---|
| Hostname | `desktop-4b8amm3` / `DESKTOP-4B8AMM3` | Log V$Pague + OS |
| Identidade Client | `Destaxa-LojaACB-TACB0120` | Log `iniciando Destaxa-LojaACB-TACB0120` |
| Arquivo `.conf` | `V$PagueClient_Destaxa_LojaACB_TACB0120.conf` | `C:\VBI\V$Pague\Client\` |
| Application title | `Destaxa` | Startup log |
| Client | V$PagueClient **5.0.0** (`5.0.0-1-e094d4f-1084-release`) | Startup log |
| Endpoint | `-h app-partner.destaxa.cloud -p 60410 -atv server -tls` | Processo PID 44484 |
| DNS / IP | `app-partner.destaxa.cloud` → **`129.148.36.0`** | MRT-50.75 |
| Encoding JVM | `ISO8859-1` | Linha de comando Client |
| Timezone JVM | `America/Recife` | Linha de comando Client |
| AC | `CDS Sistemas` / `1.0.3` | Automação `iniciar` |
| PinPad CDS | `GERTEC_PPC930` / `COM4` | Banco RO (50.71/50.74) |

### MAC / filtro (não inferir invalidade)

| Momento | `HostMacAddressGet()` | `MacAdressFilter` (trecho) |
|---|---|---|
| 00:21 startup | `00:15:5D:D0:2D:3E` | inclui Hyper-V + `C0:A8:10:DB:EE:9E` |
| 15:20 startup | `00:15:5D:65:9B:C4` | idem família |
| Wi-Fi física (OS agora) | — | `C0-A8-10-DB-EE-9E` (Up) |

**Fato:** o Client sobe identidade `Destaxa-LojaACB-TACB0120` **mesmo após** timeout de Identificar (00:22 / 15:20).  
**Não comprovado:** que o fechamento da sessão signifique identidade inválida no Partner Cloud.

---

## 2. Consolidação MRT-50.69 → 50.75

| MRT | Resultado | Fato central |
|---|---|---|
| **50.69** | INCONCLUSIVA / `05` | `tipoCartao:Débito` → tag/conteúdo inválido; `financialState=UNKNOWN` |
| **50.70** | INCONCLUSIVO | Init sem códigos; CRT ABI ok; hipótese PinPad/roteamento |
| **50.71** | PENDENTE DE FORNECEDOR | `empresa/loja/terminal` **null**; `LojaACB-TACB0120` ≠ códigos API |
| **50.72** | INCOMPATIBILIDADE PROVÁVEL | docs/06 `Débito` × examples/docs07 `Debito` |
| **50.73** | CORREÇÃO IMPLEMENTADA | CDS canônico = **`Debito`** (ASCII) |
| **50.74** | REJEITADA / `09` | `Debito` **aceito**; Identificar → breaked → timeout → `09` |
| **50.75** | PENDENTE DE FORNECEDOR | DNS/TCP/TLS OK; peer fecha ~6 ms pós-TLS no Identificar |

UNKNOWN históricos (incl. 50.69): **preservados**.

---

## 3. Fatos × hipóteses

### Fatos comprovados

1. TLS a `app-partner.destaxa.cloud:60410` estabelece (cipher ECDHE/AES-GCM).
2. Imediatamente após, `Connection breaked (-1) (129.148.36.0)` no Identificar — **recorrente** 00:21, 15:20, 19:23.
3. Timeout ~10 s → mensagem “Tempo de resposta foi excedido” / “Problema de conexão”.
4. Em CRT 50.74: literal **`Debito`** passa validação local; falha é **cloud**, não tag.
5. Em CRT 50.69: falha era **conteúdo** `Débito` (`05`), sem chegar ao mesmo padrão de Identificar na automação.
6. Códigos Destaxa estabelecimento/loja/terminal no CDS: **null** (opcionais na doc).
7. Certificado `*.destaxa.cloud` válido até 2026-11-28 (probe 50.75).

### Hipóteses (não causa identificada)

- Sessão/Identificar rejeitada ou dropada no Partner Cloud (cadastro MAC/hostname/terminal).
- Instabilidade ou política do endpoint remoto Destaxa.
- Middlebox que corta após TLS (possível; peer reportado é IP Destaxa).

### Explicitamente não inferido

- Identidade `Destaxa-LojaACB-TACB0120` **inválida** só porque a sessão fechou.
- Códigos null como causa única do break (não comprovado).

---

## 4. Artefatos de suporte neste pacote

| Arquivo | Conteúdo |
|---|---|
| `MRT-50.76-LINHA-DO-TEMPO.md` | Linha do tempo única |
| `MRT-50.76-PENDENCIAS-FORNECEDOR.md` | Perguntas objetivas |
| `startup-header-amostra.txt` | Header 00:21 |
| `extrato-log-identidade.txt` | Trechos filtrados do log |

Referências cruzadas: pastas `MRT-50.69` … `MRT-50.75` em `docs/homologacao/tef/`.
