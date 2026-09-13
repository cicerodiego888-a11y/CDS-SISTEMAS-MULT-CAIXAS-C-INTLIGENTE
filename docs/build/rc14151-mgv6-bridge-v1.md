# RC14.15.1 — Bridge de Compatibilidade Toledo / MGV6 V1.0

## Objetivo

Disponibilizar no CDS uma **camada paralela de compatibilidade** com o fluxo legado do cliente (exportação de produtos em TXT para consumo pelo `MGV6.exe`), **sem substituir** o Motor Universal de Equipamentos nem o Driver Toledo TCP homologado.

**Status:** `MGV6 Bridge V1.0 — IMPLEMENTADO — COMPATIBILIDADE INICIAL`  
**Não declarar:** `MGV6 HOMOLOGADO`.

> O formato MGV6 implementado nesta RC é baseado nas amostras reais disponíveis e ainda não constitui especificação oficial completa do MGV6.

## Arquitetura

```
CDS
 ↓
MGV6SyncService
 ↓
MGV6FileBuilder
 ↓
MGV6Exporter
 ↓
TXT (pasta configurada)
 ↓
MGV6.exe (somente se autoLaunch=true)
 ↓
Balança Toledo
```

Fluxo oficial (inalterado):

```
CDS → ToledoPrixIVDriver → Operation Engine → ConnectionManager → TCP:9000 → Balança
```

### Pacote

`backend/motores/equipamentos/mgv6/`

| Módulo | Responsabilidade |
|--------|------------------|
| `MGV6Configuration` | Defaults + normalização |
| `MGV6Validator` | Config, produto, path, exe |
| `MGV6FileBuilder` | Produto → registro TXT |
| `MGV6Encoding` | Buffer WINDOWS-1252 / UTF-8 |
| `MGV6Exporter` | Escrita `.tmp` + rename atômico |
| `MGV6Launcher` | Spawn seguro (`shell:false`) |
| `MGV6Repository` | Config JSON + histórico |
| `MGV6SyncService` | Orquestração |

## Configuração

Persistida em `equipamentos_configuracoes` com chave `mgv6.config` (JSON).

Defaults de compatibilidade (configuráveis):

| Campo | Default |
|-------|---------|
| enabled | false |
| fileName | CDS.TXT |
| encoding | WINDOWS-1252 |
| lineEnding | CRLF |
| autoLaunch | false |
| modoVariavel | VALOR |
| digitosPlu | 6 |
| prefixoEtiqueta | 2 |
| diferenciarPesoUnidade | false |
| tipoRegistro | 01 |

## Formato inicial do TXT

Comprovado nas amostras:

```
01000000001001050000Frango Do Dia Kg
01000000002002899000Picadinho Kg
01000000003001999000Costela Bovina Kg
```

| Posição | Conteúdo |
|---------|----------|
| 0–1 | `tipoRegistro` (default `01` — semântica **não** homologada) |
| 2–10 | código numérico 9 dígitos (zero-pad) |
| 11–19 | preço: `0` + centavos(5) + `000` |
| 20+ | descrição (sem delimitadores artificiais) |

Prioridade do código: PLU → codigo_balanca → codigo. Overflow **rejeita** (nunca trunca).

## Segurança

- Path traversal bloqueado no nome do arquivo
- Pasta absoluta existente + permissão de escrita
- Export **não** executa MGV6
- Launcher: caminho absoluto, `.exe`, arquivo existente, `shell:false`, sem concatenação de comando
- Histórico **não** armazena o conteúdo do TXT

## APIs

| Método | Rota |
|--------|------|
| POST | `/api/equipamentos/mgv6/export` |
| POST | `/api/equipamentos/mgv6/export-all` |
| GET | `/api/equipamentos/mgv6/history` |
| GET | `/api/equipamentos/mgv6/config/:equipamentoId` |
| PUT | `/api/equipamentos/mgv6/config/:equipamentoId` |
| POST | `/api/equipamentos/mgv6/test-folder` |

## UI

Tela **Configurações → Motor de Equipamentos → Balanças → Editar**: seção **Compatibilidade MGV6**, distinta do TCP oficial.

## Diferenças MGV6 × TCP

| | MGV6 Bridge | Toledo TCP oficial |
|--|-------------|--------------------|
| Transporte | Arquivo + app externo | TCP 9000 / 90AX |
| Driver | Nenhum (não é driver) | `ToledoPrixIVDriver` |
| PLU Engine | Não usa | Sprint 14.7/14.8 |
| Homologação | Compatibilidade inicial | Homologado |

## Limitações / pontos não comprovados

- Significado semântico completo do prefixo `01`
- Encoding/terminador reais de todas as instalações MGV6
- Nome de arquivo oficial exigido pelo MGV6
- CLI/args do `MGV6.exe`
- Registros de produtos unitários (peso × unidade)
- Contrato oficial Toledo/MGV6

## Testes

```bash
npm run test:mgv6-v1
```

Fixture golden: `tests/fixtures/mgv6/expected.CDS.TXT` (comparação byte a byte).

## Não alterado nesta RC

`ToledoPrixIVDriver`, `ConnectionManager`, `TcpConnection`, `ToledoProtocol`, framing/parser/RX/ACK, `ToledoPluEngine`, Operation Engine, Discovery, Fingerprint, Monitor, Configuration Engine.
