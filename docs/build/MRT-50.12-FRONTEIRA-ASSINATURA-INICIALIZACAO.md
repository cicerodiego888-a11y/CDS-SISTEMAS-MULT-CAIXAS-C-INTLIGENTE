# MRT-50.12 — Fronteira de assinatura e inicialização segura

## Etapa 1 — auditoria pré-alteração

**Estado desta seção:** análise concluída antes de qualquer alteração de código da MRT-50.12.

### Contratos e chamadores encontrados

#### `assinarEvidencia(claims)`

O chamador de produção é `TefManager.reconciliarNativeHost()`: ele usa `criarClaimsEvidencia()` para criar uma RELEASE depois da persistência do estado reconciliado e um COMMIT depois da confirmação do NativeHost. Os testes MRT-50.2/MRT-50.3 e MRT-50.11 também chamam o assinador diretamente.

O contrato atualmente produzido por `criarClaimsEvidencia()` tem exatamente: `version`, `evidenceId`, `eventType`, `transacao_id`, `transactionId`, `operation_id`, `idempotency_key`, `fingerprint`, `financialState`, `resultStatus`, `usuario`, `timestamp`, `releaseEvidenceId` e `releaseTimestamp`. `version` é `1`; o ID da transação é repetido em `transacao_id` e `transactionId`; estado/resultado obedecem a `CONFIRMED_SUCCESS→aprovado`, `CONFIRMED_DENIED→negado` ou `CANCELLED→cancelado`. O timestamp é ISO válido. RELEASE exige referência RELEASE nula; COMMIT exige ID e timestamp RELEASE válidos e timestamp não anterior ao RELEASE. A função pública de assinatura atualmente não repete essas validações.

#### `assinarAutorizacaoReconciliacao(claims)`

O chamador de produção é o helper `assinarAutorizacaoReconciliacao()` de `TefManager`, usado nas fases `release` e `commit` de `reconciliarNativeHost()`. O helper constrói exatamente: `version`, `authorizationId`, `hostSessionId`, `transactionId`, `operation_id`, `idempotency_key`, `fingerprint`, `financialState`, `recordStatus`, `resultStatus`, `usuario`, `observacao`, `phase` e `issuedAt`.

O protocolo NativeHost aceita estados finais `CONFIRMED_SUCCESS`, `CONFIRMED_DENIED` e `CANCELLED`; fase `release`/`commit`; status de registro `pendente` no RELEASE e o status final no COMMIT; usuário/observação não vazios; timestamp numérico dentro de cinco minutos; sessão e transação não vazias. O validador atual permite campos de identidade nulos/opcionais e não rejeita propriedades extras. O chamador real, após `validarRegistroReconciliacao()`, fornece identidade completa e dados persistidos. A função pública de assinatura ainda não valida esse contrato.

#### `assinarBootstrapSeguranca(claims)`

O chamador de produção é o provedor instalado pelo construtor do TefManager; `_criarBootstrapSeguranca()` cria exatamente: `version`, `protocol`, `hostSessionId`, `bootstrapId`, `revision`, `issuedAt`, `recoveryComplete`, `recoveryResult`, `securityState`, `blockedIdentities` e `permit`.

O validador do protocolo exige exatamente esses campos, versão/protocolo corretos, sessão e ID válidos, revisão positiva, timestamp dentro de cinco minutos, recuperação concluída com `SUCCESS`, estado compatível com a lista de bloqueios, identidades bloqueadas ordenadas e sem duplicatas, e permissão nula ou com os três campos `permitId`, `operation`, `transactionId` válidos. A função pública de assinatura atualmente não valida o contrato.

### Chamadores e importação do TefManager

Os três usos de produção estão limitados aos helpers e a `reconciliarNativeHost()` do TefManager. O módulo exporta uma instância singleton (`module.exports = new TefManager()`), e o TefManager calcula `obterChavePublica()` no escopo do módulo antes da construção da instância. Portanto, ausência/invalidez de segredo lança durante `require()`.

O impacto não fica isolado ao endpoint TEF: `backend/server.js` importa `rotas/vendas` e `rotas/tef` no escopo do módulo; elas alcançam `VendaPagamentoService`/`services/tef/index.js`, que importam o TefManager. `electron-common.js` importa `backend/server.js` ao iniciar o backend e, no caminho de erro, encerra o aplicativo. Assim, a falha criptográfica atual pode impedir a inicialização do backend e do CDS inteiro.

### Conclusão pré-alteração

A validação na fronteira pode ser implementada no serviço de evidências usando os contratos acima e os validadores de protocolo já existentes. O impacto de inicialização pode ser isolado sem refatoração ampla: retirar a derivação do escopo de módulo, armazenar estado criptográfico explicitamente na instância TefManager e bloquear os pontos de entrada financeiros/reconciliação quando a configuração estiver inválida. A aplicação geral poderá continuar inicializando; o subsistema TEF ficará explicitamente indisponível e sem chave fictícia.

**Nenhum código de produção foi alterado antes desta análise.**

## Implementação, validação e conclusão

### Implementação

`backend/services/tef/tefReconciliationEvidence.js` agora valida os claims antes de cada assinatura:

- Evidência: conjunto exato de campos, evento RELEASE/COMMIT permitido, identidade completa e coerente, estado/resultado compatíveis, timestamp ISO canônico e vínculo RELEASE obrigatório para COMMIT.
- Autorização: conjunto exato do protocolo, identidade completa, sessão e IDs válidos, fase RELEASE/COMMIT, estado/resultado compatíveis com o status persistido e `issuedAt` dentro da janela já exigida pelo NativeHost.
- Bootstrap: conjunto exato do protocolo, sessão, revisão, timestamp, recuperação concluída, lista de bloqueios ordenada/sem duplicatas, estado derivado da lista e permissão restrita às operações transacionais válidas.

Claims desconhecidos, incompletos, com propriedades extras ou pertencentes a outro contrato são rejeitados antes da assinatura. Os validadores reproduzem as regras do protocolo e dos chamadores auditados; nenhum campo novo foi introduzido.

Em `backend/services/tef/TefManager.js`, a obtenção da chave pública saiu do escopo de módulo e ocorre durante a construção da instância. Falha de configuração é registrada como estado explícito `INDISPONIVEL`; não há chave fictícia. Autorizar, continuar, cancelar, reconciliação e criação de bootstrap ficam bloqueados nesse estado, sem retry financeiro. A importação geral pode prosseguir.

O formato histórico, algoritmo Ed25519, contexto HMAC, chave derivada, fixtures históricas e formato persistido não foram alterados.

### Testes e verificações

- `node tests/tef/mrt-50-12-fronteira-assinatura.test.js`: **17/17 PASSOU**. Inclui contratos válidos/inválidos, separação entre tipos, chave ausente/malformada/fixa, verificação por chave pública e indisponibilidade fail-closed do TefManager.
- `node tests/tef/mrt-50-11-isolamento-criptografico.test.js`: **12/12 PASSOU**, incluindo verificação das fixtures históricas RELEASE/COMMIT.
- `node --check` nos dois arquivos de produção alterados e no novo teste: **PASSOU**.
- `git diff --check`: **PASSOU**.

O teste de indisponibilidade importou TefManager sem segredo e um módulo independente em processo de teste com `DB_DIR` isolado em diretório temporário. O diretório foi removido após o teste. Não houve acesso ao banco oficial nem inicialização completa do CDS.

### Impacto e restrições

- Falha de segredo não é mais lançada durante a importação do TefManager; o módulo permanece carregável e informa explicitamente que TEF está indisponível.
- O teste isolado confirmou que os métodos de entrada/reconciliação retornam bloqueio ou rejeitam com `TEF_CRIPTOGRAFIA_INDISPONIVEL`. Não houve invocação de adapter/driver.
- Gate financeiro: `DESTAXA_REAL_TRANSACTION_ENABLED=0` nos processos de teste.
- `TX_START=0`, `TX_CONTINUE=0`, `TX_FINALIZE=0`; nenhum driver financeiro foi chamado.
- Banco oficial, NativeHost, CDS em execução, DLL, V$Pague, PinPad, adquirentes e SEFAZ: **não acessados/iniciados**.
- O NativeHost continua recebendo somente a chave pública; nenhuma chave privada foi exportada.
- Pré-flight e operação financeira continuam bloqueados. Esta conclusão não homologa integração física nem autoriza operação real.

### Conclusão

**MRT-50.12 APROVADA nos testes isolados solicitados.** Contratos determinados pelos usos reais e pelo protocolo; os três assinadores validam na fronteira; falha criptográfica mantém TEF indisponível sem impedir a importação do módulo e de um serviço independente. A inicialização integral do CDS não foi executada por restrição de escopo.
