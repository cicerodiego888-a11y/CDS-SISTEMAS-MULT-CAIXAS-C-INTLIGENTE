# MRT-50.70 — Auditoria estática Destaxa (retorno `05` da MRT-50.69)

**Parecer final: `INCONCLUSIVO` (com causa mais provável apontada, sem correção nesta sprint)**

Gerado em 2026-11-07T21:15:00Z. Somente leitura. Gate OFF. Sem NativeHost, DLL, V$Pague, PinPad, TX, SEFAZ, alteração de código/config/banco. Estados UNKNOWN das MRT-24/36/42/50.69 preservados.

Diretório: `docs/homologacao/tef/MRT-50.70-20261107T211500Z`

---

## 1. Resumo executivo

A MRT-50.69 enviou uma CRT débito R$1,00 válida na forma documental e recebeu Destaxa **`05`** (“Dados coletados insuficientes ou invalidos”) em ~695 ms, **sem** `99`, **sem** PinPad e **sem** CONTINUE/FINALIZE.

A auditoria estática comprovou:

1. O payload de `iniciaClientDestaxa` da sessão financeira **não incluiu** `estabelecimento` / `loja` / `terminal` (campos opcionais na doc; ausentes também no banco CDS).
2. O tamanho da entrada de init observado no JSONL da 50.69 (`159`) **bate exatamente** com a projeção estática atual (versão + aplicação + 5 params de log).
3. A montagem CRT (latin1, NUL, `tamanho_entrada`, buffers) está alinhada ao contrato CDS documentado; **não** há evidência estática de truncamento do CRT de 77 bytes.
4. O código `05` é mapeado como erro de protocolo (`ERROR`) e, na política financeira, cai em `financialState=UNKNOWN` com `retryAllowed=false` — coerente com o resultado da 50.69.
5. O `.conf` V$Pague existe e referencia `LojaACB` / identidade de host; **não** contém literal `COM4`; conteúdo é predominantemente serialização Java, não `chave=valor` legível.

**Causa mais provável (ainda hipótese operacional, não bug de ABI comprovado):** falha de prontidão/roteamento do terminal PinPad no V$Pague no momento da CRT (Client devolveu `05` em vez de abrir ciclo `99`), em cenário com códigos Destaxa de estabelecimento/loja/terminal **nulos** no CDS e harness 50.69 que também não os enviou.

---

## 2. Payload de inicialização encontrado

### 2.1 Implementação efetiva

| Item | Evidência |
| --- | --- |
| Função | `DestaxaNativeBridge.iniciarClient` → `montarEntradaClient` → `projetarEntradaIniciaClient` |
| Assinatura Koffi | `void iniciaClientDestaxa(uint8 *resultado, uint8 *entrada, int tamanho_entrada)` |
| Encoding | `latin1` (`ENCODING_DESTAXA`) |
| Chamada | `fn(resultadoBuf, entradaBuf, entrada.texto.length)` — tamanho = chars da string **sem** contar o NUL alocado no buffer |

### 2.2 Campos e origens

| Campo Destaxa | Valor efetivo (projeção / 50.69) | Origem | Nulo/ausente |
| --- | --- | --- | --- |
| `versao` | `1.0.3` | `package.json` via `obterVersaoAplicacao()` | Obrigatório no CDS; sem versão → erro de config |
| `aplicacao` | `CDS Sistemas` | constante `APLICACAO` | Sempre enviado |
| `estabelecimento` | **ausente** | `empresa_codigo` / `empresaCodigo` do config | Só entra se texto não vazio |
| `loja` | **ausente** | `loja_codigo` / `lojaCodigo` | Idem |
| `terminal` | **ausente** | `terminal_codigo` / `terminalCodigo` | Idem |
| Log DLL (5) | `diretorio_trabalho`, `nivel_log=1`, `nome_arquivo_log`, `tam_max_log=10`, `total_bkp_log=5` | `DESTAXA_DLL_LOG_PARAMS` (MRT-28) | Anexados por padrão |

String projetada (estática, config vazio — mesmo padrão do harness 50.69):

```text
versao=1.0.3;aplicacao=CDS Sistemas;diretorio_trabalho=C:\CDS-SISTEMAS\logs\destaxa;nivel_log=1;nome_arquivo_log=destaxa-dll.log;tam_max_log=10;total_bkp_log=5
```

`tamanhoEntrada=159` — **COMPROVADO** igual ao log MRT-50.69 (`client.init.start`).

### 2.3 Config persistida × memória × payload

| Camada | estabelecimento/loja/terminal |
| --- | --- |
| Banco `tef_configuracao` (RO) | `empresa_codigo`, `loja_codigo`, `terminal_codigo` = **null** |
| Harness MRT-50.69 | passou só `{ sdkPath, provedor, ambiente }` — **não** leu o banco |
| Payload DLL | **sem** os três campos |

**COMPROVADO:** não há divergência “persistido preenchido × payload omitido”. Persistido e payload estão ambos sem códigos Destaxa.

`pdv_codigo` / `caixa_codigo` existem no schema CDS e **nunca** entram em `iniciaClientDestaxa` (**COMPROVADO** no mapeamento).

---

## 3. Comparação com a documentação Destaxa

| Requisito doc | CDS | Classificação |
| --- | --- | --- |
| `versao` + `aplicacao` na entrada | Enviados | **COMPROVADO** |
| `estabelecimento` / `loja` / `terminal` opcionais | Omitidos quando nulos | **COMPROVADO** (comportamento alinhado à opcionalidade) |
| Identidade Partner Cloud = hostname/MAC do Client | CDS não deriva terminal lógico de PDV | **COMPROVADO** (comentário/código + evidências operacionais) |
| Códigos = cadastro V$Pague (não inventar a partir de `LojaACB-TACB0120`) | CDS não mapeia esse literal para os 3 campos | **COMPROVADO** |
| Params de log na mesma string `entrada` | MRT-28 anexados | **COMPROVADO** |

---

## 4. Análise de estabelecimento, loja e terminal (Etapa B)

Leitura RO: `file:mercadao.db?mode=ro` + `PRAGMA query_only=ON`.

### `tef_pinpads`

| Campo | Valor |
| --- | --- |
| codigo | `GERTEC_PPC930` |
| porta_com | `COM4` |
| habilitado | 1 |
| fabricante/modelo | Gertec / PPC930 |
| `tef_configuracao_id` | 1 |

### `tef_configuracao` (id=1)

| Campo | Valor |
| --- | --- |
| provedor | `destaxa` |
| ambiente | `homologacao` |
| tipo_integracao | `dll` |
| empresa_codigo | **null** |
| loja_codigo | **null** |
| terminal_codigo | **null** |
| pdv_codigo / caixa_codigo | **null** |

### Consumo no fluxo de init

- `projetarEntradaIniciaClient` / `lerCampos`: string vazia → campo **não** entra no `texto`.
- Não há outra fonte no harness 50.69 que preenchesse esses códigos.
- V$Pague identificou `LojaACB-TACB0120` no log operacional prévio; isso **não** é lido pelo CDS para montar `estabelecimento`/`loja`/`terminal`.

**COMPROVADO:** códigos nulos no CDS → omitidos no payload.  
**NÃO COMPROVADO:** que a ausência desses três campos seja a causa única do `05` (doc: opcionais; init retornou `00`).

---

## 5. Inspeção do `.conf` (Etapa C)

| Item | Valor |
| --- | --- |
| Caminho | `C:\VBI\V$Pague\Client\V$PagueClient_Destaxa_LojaACB_TACB0120.conf` |
| Existe | sim |
| Tamanho | 89309 bytes |
| mtime (UTC) | 2026-11-05T20:05:39Z |
| SHA-256 | `603D28AFDDC9477ED1EDD5AE10758FAF02EAA5DB2BF0B5BC1CC28596D4E436A9` |
| Forma | serialização Java / binário (decode latin-1); **não** é `.ini` chave=valor limpo |
| Credenciais | mascaradas / não reproduzidas |

Achados operacionais (texto embutido na serialização):

| Sinal | Observação | Classificação |
| --- | --- | --- |
| `LojaACB` / `Destaxa` / CNPJ parcial | Presentes | **COMPROVADO** (existência de strings) |
| `TACB0120` | Presente no arquivo (nome + conteúdo) | **COMPROVADO** |
| Literal `COM4` / `COM3` | **0** ocorrências | **COMPROVADO** (ausência no dump textual) |
| Lista de modelos PinPad | Inclui PPC900/920/940 etc. | **COMPROVADO** |
| Relação CDS `porta_com=COM4` ↔ `.conf` | Não há campo legível de porta COM no dump | **NÃO VERIFICÁVEL** sem ferramenta V$Pague |

**Lacuna:** estrutura interna completa do `.conf` não é auditável como configuração textual; não se pode afirmar, só pelo arquivo, qual COM o Client usa para a PPC-930.

---

## 6. ABI e payload CRT (Etapa D)

Assinatura documentada / Koffi:

```text
void iniciaTransacaoDestaxa(uint8 *resultado, const char *operacao, uint8 *entrada, int tamanho_entrada, uint8 *saida, int *tamanho_saida);
```

| Verificação | Achado | Classificação |
| --- | --- | --- |
| Encoding CRT | `Buffer.from(texto, 'latin1')` | **COMPROVADO** |
| `Débito` | byte `0xE9` para `é` (latin1), não UTF-8 `C3 A9` | **COMPROVADO** |
| Bytes CRT 50.69 | 77 + buffer 78 (NUL) | **COMPROVADO** |
| `tamanho_entrada` | `bytes.length` **sem** NUL | **COMPROVADO** (espelha init) |
| `resultado` | `Buffer.alloc(2+1)`; leitura 2 chars | **COMPROVADO** |
| `saida` | 99000 bytes sugeridos; `Int32Array([capacidade])` | **COMPROVADO** |
| `operacao` | string JS `"CRT"` (Koffi `const char *`) | **COMPROVADO** |
| Truncamento CRT | 77 ≪ capacidade; string curta | **NÃO COMPROVADO** como causa |
| Conversão indevida do `05` | `lerCodigoBuffer` → upper 2 chars; tabela mantém `05` | **COMPROVADO** (preservado) |

Doc CDS (`destaxaConstantes`): *char\* = bytes 0–255 conforme ASCII*; implementação latin1 é a escolha explícita. **NÃO VERIFICÁVEL** nesta sprint se a DLL Destaxa 1.83 exige outra página de código para `Débito` (exigiria execução nativa — proibida).

---

## 7. Análise do retorno `05` e fluxo `99` (Etapa E)

| Etapa | Comportamento |
| --- | --- |
| Tabela Destaxa CDS | `05` → “Dados coletados insuficientes ou invalidos” |
| `classificarCodigoTransacao` | `CLASSIFICACAO_CODIGO.ERROR`, `estadoTransacao=ERROR` |
| `classificarCodigoFinanceiro` | **não** trata `05` à parte → `financialState=UNKNOWN`, `retryAllowed=false`, `TEF_UNKNOWN_NO_RETRY` |
| Orquestrador | `requerContinuacao` só se `ACTION_REQUIRED` (`99`) → **false** para `05` |
| Ciclo CRT | sem CONTINUE/FINALIZE (coerente) |
| UNKNOWN | bloqueio de retry / nova TX no orquestrador | **COMPROVADO** no código |

**COMPROVADO:** CDS **não** converte `05` em `99`.  
**COMPROVADO:** o caminho da 50.69 (parar sem CONTINUE) segue o contrato de classificação.  
**NÃO COMPROVADO:** que o Client “deveria” ter devolvido `99` para coletar no PinPad — isso seria expectativa operacional, não regra implementada no CDS.

---

## 8. Testes estáticos executados

| Suite | Resultado | Observação |
| --- | --- | --- |
| `tef-destaxa-03-crt-protocolo.test.js` | **25 ok** | Montagem CRT, 99, classificação; mock only |
| `mrt-28-configuracao-log-dll-destaxa.test.js` | **aprovada** | Entrada init com log; amostra = string de 159 chars |
| `tef-destaxa-05-financial-safety.test.js` | **15 ok** | UNKNOWN / sem retry |
| `tef-destaxa-10-mapeamento-terminal.test.js` | 7 ok / **3 falhas** | Falhas de **integridade de backup de fixture** (arquivo ausente), não do mapeamento em si |

Nenhuma suite carregou DLL, NativeHost, V$Pague ou PinPad.

---

## 9. Achados comprovados

1. **COMPROVADO** — Init 50.69 sem `estabelecimento`/`loja`/`terminal`; `tamanhoEntrada=159` reproduzível estaticamente.
2. **COMPROVADO** — Banco oficial com esses três códigos **null**; `porta_com=COM4` só em `tef_pinpads`.
3. **COMPROVADO** — CRT débito montada como documentado; ABI/buffers coerentes com o código CDS.
4. **COMPROVADO** — `05` → ERROR protocolo + UNKNOWN financeiro + sem CONTINUE.
5. **COMPROVADO** — `.conf` Destaxa/LojaACB existe; sem literal COM4 no dump textual.
6. **COMPROVADO** — Nenhuma ação nativa/financeira nesta sprint.

---

## 10. Hipóteses ainda não comprovadas

| Hipótese | Status |
| --- | --- |
| H1 — PinPad/COM não operacional no V$Pague no instante da CRT → Client `05` | **NÃO COMPROVADO** (proibido reabrir V$Pague/PinPad aqui) |
| H2 — Ausência de estabelecimento/loja/terminal contribui para `05` | **NÃO COMPROVADO** (opcionais; init `00`) |
| H3 — Encoding `Débito` (latin1 `é`) rejeitado pela DLL | **NÃO COMPROVADO** / **NÃO VERIFICÁVEL** sem DLL |
| H4 — `.conf` sem COM correta para PPC-930 | **NÃO VERIFICÁVEL** (formato opaco) |
| H5 — Campos CRT omitidos deveriam gerar `99` e geraram `05` | **NÃO COMPROVADO** (comportamento do Client, não do CDS) |

---

## 11. Evidências adicionais necessárias (próximas sprints — só com aprovação)

1. Log detalhado do V$PagueClient **no instante** da TX_START 50.69 (já existente no host? coletar RO).
2. Confirmação Destaxa/V$Pague: códigos oficiais de estabelecimento/loja/terminal (literais) e se são necessários para CRT homologação.
3. Confirmação da porta PinPad efetiva no Client (ferramenta V$Pague / UI), sem alterar `.conf` até aprovação.
4. Se Destaxa exigir, teste controlado **futuro** com init preenchido com códigos oficiais — **nova autorização explícita**, não retry da 50.69.
5. Esclarecimento documental Destaxa: `05` vs `99` quando PinPad indisponível.

---

## 12. Recomendação técnica (sem implementar agora)

**Próxima ação segura:** sprint de **preparação de configuração** (não financeira):

1. Obter junto à Destaxa/ACB os literais oficiais de estabelecimento/loja/terminal.
2. Persisti-los no CDS (`tef_configuracao`) **somente após validação** — fora desta sprint.
3. Validar no V$Pague (UI/logs RO) que a PPC-930/COM4 está o terminal ativo **antes** de qualquer nova CRT.
4. Só então solicitar **nova confirmação explícita** para uma CRT R$1,00 — tratando a 50.69 como encerrada (`05` / UNKNOWN preservado).

**Não** reenviar a CRT da 50.69. **Não** reconciliar UNKNOWN nesta etapa.

---

## Parecer

| Critério | Resultado |
| --- | --- |
| Payload init identificado | Sim |
| Origens de roteamento documentadas | Sim |
| Relação CDS ↔ V$Pague ↔ `.conf` | Analisada com lacunas do `.conf` opaco |
| ABI/CRT sem execução nativa | Auditada |
| Caminho do `05` rastreado | Sim |
| UNKNOWN intocado / sem TX nativa | Sim |
| Correção implementada | **Não** (proibido) |

**Parecer final: `INCONCLUSIVO`**

Há evidência suficiente para priorizar a hipótese de **prontidão/roteamento PinPad + códigos Destaxa ausentes no CDS**, mas **não** para declarar bug de ABI/CRT nem autorizar correção automática. A sprint seguinte deve ser de configuração/validação RO ou de coleta de literais oficiais — não retry financeiro.
