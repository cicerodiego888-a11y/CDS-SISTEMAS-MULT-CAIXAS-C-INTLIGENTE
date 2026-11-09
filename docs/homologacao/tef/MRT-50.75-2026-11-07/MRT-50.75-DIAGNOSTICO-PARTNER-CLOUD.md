# MRT-50.75 — Diagnóstico V$Pague / Partner Cloud

| Campo | Valor |
|---|---|
| Data | 2026-11-07 |
| Dependência | MRT-50.74 (`09` / timeout) |
| Gate | `DESTAXA_REAL_TRANSACTION_ENABLED=0` |
| NativeHost / DLL / CRT / TX | **Não executados** |
| Certificados / códigos / banco / UNKNOWN | **Não alterados** |

---

## Classificação

### `PENDENTE DE FORNECEDOR`

Evidência local **comprova** que DNS, TCP e TLS até `app-partner.destaxa.cloud:60410` **estabelecem**, e que o peer `129.148.36.0` **encerra a sessão** imediatamente após o TLS durante o serviço **Identificar**, culminando em timeout (~10 s) e código **09**. A razão do fechamento no lado Destaxa/Partner Cloud **não** é observável daqui sem o fornecedor.

Não classificado como `CAUSA IDENTIFICADA` de um defeito CDS/CRT: o literal `Debito` foi aceito; o bloqueio é na conversa Identificar com o servidor remoto.

---

## 1. Linha do tempo MRT-50.74 (V$Pague)

Fonte: `vspague-client.log` (fuso JVM `America/Recife`). Detalhe: `linha-tempo-mrt74.json`.

| Horário | Evento |
|---|---|
| 19:23:38.089 | AC ↔ Client local `:60906` OK |
| 19:23:38.232 | `iniciar` seq=1 |
| 19:23:38.277 | **Sequencial inválido** → Client pede seq=3 |
| 19:23:38.280–.289 | `iniciar` seq=3 **aceito** |
| 19:23:38.299 | `executar` `tipoCartao:Debito` **aceito** |
| 19:23:38.829 | Envia **Identificar** ao Partner Cloud |
| 19:23:39.643 | TLS **Connected successfull** (`ECDHE_RSA_AES_256_GCM`) |
| 19:23:39.649 | **`Connection breaked (-1) (129.148.36.0)`** (~6 ms após TLS) |
| 19:23:49.842–50.038 | Timeout ~10 s → `coletaRetorno:9` → Destaxa **09** |
| 19:23:50.042 | `finalizar` |

**Sequencial:** anomalia de sessão (estado residual pós-50.69), **recuperada antes** do Identificar. **Não** explica o `Connection breaked` cloud.

**Padrão do dia (mesmo log):** 00:21, 15:20 e 19:23 — TLS OK → Identificar → breaked no IP Destaxa → timeout/problema de conexão.

---

## 2. Diagnóstico de rede (passivo)

Artefatos: `dns-resolve.json`, `tls-inspecao.json`, `rede-snapshot.json`, `diagnostico-rede.json`.

| Camada | Resultado | Interpretação |
|---|---|---|
| DNS `app-partner.destaxa.cloud` | A → `129.148.36.0` | **OK** — não é falha DNS |
| TCP `:60410` | `TcpTestSucceeded=true` | **OK** — porta alcançável |
| ICMP ping | falhou | Irrelevante (TCP sobe) |
| TLS probe | autenticado, Tls12, Aes256, `sslPolicyErrors=None` | Handshake **OK** |
| Cert `CN=*.destaxa.cloud` | válido até **2026-11-28** | Não expirado |
| Chain offline | avisos só de revogação offline | Esperado no modo Offline; **não** prova cert inválido |
| Proxy IE | `ProxyEnable=0` | Sem proxy de sistema evidenciado |
| Firewall | perfis ON; TCP/TLS saem | Bloqueio total de 60410 **não comprovado** |
| Traceroute | Wi-Fi → CGNAT `100.81.96.1` → hops ISP; vários `0.0.0.0` | Rota parcial; não prova bloqueio (TCP/TLS dedicados OK) — `traceroute.json` |
| Config Client | `-h app-partner.destaxa.cloud -p 60410 -atv server -tls` | Alinhada ao alvo |

**Diferença crítica:** conexão TCP/TLS **estabelecida** ≠ conversa Identificar **concluída**. O servidor (peer Destaxa) **derruba** o canal logo após o handshake, antes de resposta útil ao Identificar.

---

## 3. Onde NÃO está o bloqueio (comprovado)

| Hipótese | Status |
|---|---|
| Rede local sem rota / DNS quebrado | **Refutada** |
| Porta 60410 inacessível (SYN bloqueado) | **Refutada** |
| Certificado TLS expirado / nome inválido no probe | **Refutada** (validade + `None`) |
| Rejeição de `Debito` | **Refutada** (MRT-50.74) |
| Sequencial inválido como causa do 09 | **Refutada** (recuperado pré-Identificar) |
| Proxy HTTP forçado | **Não evidenciado** |

---

## 4. Onde está o bloqueio (evidência + limites)

| Hipótese | Avaliação |
|---|---|
| Serviço / sessão Partner Cloud Destaxa fecha após TLS no Identificar | **PROVÁVEL / evidência forte** — peer `129.148.36.0`, padrão recorrente |
| Middlebox que deixa SYN/TLS e corta payload | Possível, **não comprovada**; peer reportado é o IP Destaxa |
| Autenticação/Identificar rejeitada silenciosamente (cadastro terminal/MAC) | **Hipótese** — requer Destaxa; alinhada a Identificar + break |
| Configuração terminal CDS (códigos null) | **Não comprovada** como causa do break cloud (opcionais; init local OK) |

Sem logs do servidor Destaxa: **não** elevar a “causa identificada” de um bug CDS.

---

## 5. Próxima ação recomendada

1. Abrir chamado Destaxa/ACB com: host/porta, IP `129.148.36.0`, janelas 00:21 / 15:20 / 19:23, trechos TLS OK + `Connection breaked` pós-Identificar, identidade `Destaxa-LojaACB-TACB0120`, MAC/hostname da estação.
2. Pedir status do endpoint Partner Cloud e se o terminal/MAC está autorizado a Identificar nesta data.
3. Operacional: confirmar com Destaxa procedimento de prontidão **sem** CRT (se existir).
4. **Não** repetir CRT até estabilizar Identificar (nova autorização seria necessária de qualquer forma).
5. Manter gate OFF; não alterar certificados/códigos sem confirmação oficial.

---

## 6. Conformidade

Gate OFF; zero NativeHost/DLL/CRT/TX; zero alteração de config/banco/UNKNOWN; apenas DNS/TCP/TLS passivos + logs existentes.

---

## Parecer

**`PENDENTE DE FORNECEDOR`** — falha recorrente na etapa **Identificar** após TLS bem-sucedido com `app-partner.destaxa.cloud:60410`; causa raiz do fechamento pelo peer Destaxa exige confirmação do fornecedor.
