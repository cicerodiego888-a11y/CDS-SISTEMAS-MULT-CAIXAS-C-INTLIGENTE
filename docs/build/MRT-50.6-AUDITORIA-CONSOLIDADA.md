# MRT-50.6 — Auditoria consolidada de segurança TEF

## Decisão

**B. BLOQUEADO — CORREÇÕES NECESSÁRIAS**

Não avançar ao preflight da primeira transação simbólica. O bloqueio decorre do fluxo integrado de continuidade Destaxa: a persistência durável da resposta 99 é opcional e, quando habilitada, uma exceção de gravação é absorvida antes de o código tentar `TX_CONTINUE`. Além disso, o timeout pode não ser avaliado quando falta o timestamp original da solicitação. São lacunas de replay/expiração, não resolvidas pelo bootstrap assinado.

Esta auditoria não autoriza operação financeira. Uma autorização específica continuará necessária mesmo após correções futuras.

### Menor correção necessária

1. Exigir persistência durável da resposta aceita antes de qualquer `TX_CONTINUE`; falha, retorno inválido ou indisponibilidade do armazenamento deve impedir a chamada ao Host.
2. Persistir o timestamp original da solicitação 99 e recuperá-lo após reinício. Rejeitar continuidade se timestamp obrigatório estiver ausente, inválido ou expirado.
3. Adicionar testes isolados de falha de gravação, reinicialização, ausência/expiração de timestamp e contadores independentes do driver.

## Escopo e segurança

- Auditoria de código de produção somente leitura.
- Nenhum arquivo de produção, configuração ou variável de ambiente foi alterado.
- Banco oficial não foi aberto nem modificado.
- Nenhuma DLL foi carregada; nenhuma operação financeira foi executada.
- V$Pague, PinPad, adquirentes e SEFAZ não foram acessados.
- MRT-24, MRT-36 e MRT-42 não foram modificadas, reutilizadas ou reconciliadas.
- Testes registrados utilizaram mocks/IPC simulado e SQLite temporário, com gate financeiro OFF.

## Matriz de proteções

| Área | Classificação | Evidência | Limitação/risco |
|---|---|---|---|
| Evidência RELEASE/COMMIT | CONCLUÍDO | [TefManager.js](../../backend/services/tef/TefManager.js:1850), [tefRepository.js](../../backend/services/tef/tefRepository.js:141), [tefReconciliationEvidence.js](../../backend/services/tef/tefReconciliationEvidence.js:8) validam cardinalidade, assinatura Ed25519, versão, timestamps, estado e identidade completa; COMMIT referencia RELEASE. | Não se considera hash SHA-256 isolado como autenticidade. |
| Recuperação e bootstrap | CONCLUÍDO | [recarregarPendencias](../../backend/services/tef/TefManager.js:1338) forma candidatos de marcadores, transações finalizadas e evidências; erros ou divergências mantêm bloqueio. [_criarBootstrapSeguranca](../../backend/services/tef/TefManager.js:293) aguarda recuperação e incorpora bloqueios. | A rejeição do agendamento inicial é absorvida; a segurança depende do bootstrap/guard de operação, que falha fechado. |
| Isolamento da chave | CONCLUÍDO | [DestaxaNativeHostClient.js](../../backend/services/tef/destaxa/DestaxaNativeHostClient.js:68) constrói o ambiente filho por allowlist sem `TEF_ENCRYPTION_KEY`; [cryptoService.js](../../backend/services/crypto/cryptoService.js:122) proíbe derivação privada no NativeHost. | Não foi executado Host ligado ao ambiente financeiro/DLL. |
| Bootstrap assinado e IPC | TESTADO | [DestaxaNativeHost.js](../../backend/services/tef/destaxa/DestaxaNativeHost.js:338) e [destaxaNativeHostProtocolo.js](../../backend/services/tef/destaxa/destaxaNativeHostProtocolo.js:220) validam sessão, revisão, assinatura, replay e permissão; MRT-49 e MRT-50 IPC passaram. | Os testes usam componentes simulados/isolados; não representam uma DLL carregada. |
| UNKNOWN/PENDING e reconciliação | TESTADO | [reconciliarNativeHost](../../backend/services/tef/TefManager.js:1850) só exclui bloqueio após evidências, COMMIT e bootstrap confirmado. Testes MRT-47/49/50 exercitam bloqueios e falhas. | No cenário 16 do MRT-47, `inicia=1` é a chamada inicial que cria UNKNOWN; o teste demonstra que as tentativas seguintes são recusadas, não que a primeira TX_START tenha ocorrido sob bloqueio prévio. |
| Continuidade 99 | **BLOQUEADO** | [continuarPagamento](../../backend/services/tef/adapters/DestaxaRealAdapter.js:673) habilita persistência somente por opção/flag; o `catch` de gravação é best-effort e o fluxo continua para `continuarCicloCrt`. [avaliarTimeoutColeta](../../backend/services/tef/destaxa/destaxaContinuidadeContrato.js:215) retorna `ok:true, avaliado:false` sem `solicitadaEm`. | Risco de continuidade após falha/reinício sem prova durável e após expiração não aplicada. |
| Gate financeiro | TESTADO | [transacaoRealHabilitada](../../backend/services/tef/destaxa/destaxaConstantes.js:69) só habilita com valor exato `1`; o adapter valida persistência antes do ciclo. MRT-47 e MRT-50.3 registram gate OFF e zero operações financeiras reais. | Gate OFF não corrige a lacuna de continuidade e não é autorização de operação. |

## Evidência do fluxo RELEASE / COMMIT

Em [TefManager.js](../../backend/services/tef/TefManager.js:1850), o caminho de reconciliação:

1. valida identidade e resultado autorizados;
2. pede RELEASE assinado ao NativeHost;
3. atualiza a transação de forma condicional e relê a linha final;
4. valida o registro e grava a evidência RELEASE assinada;
5. autoriza COMMIT vinculado ao RELEASE;
6. grava a evidência COMMIT;
7. valida e atualiza o bootstrap;
8. só então remove a identidade de `_pendencias` e `_liberacoesBootstrapPendentes`.

Falha antes da confirmação do bootstrap não executa a remoção local. A recuperação relê provas e mantém identidades inválidas/incompletas bloqueadas.

O formato da evidência assina claims em ordem fixa, incluindo `version`, `evidenceId`, `eventType`, `transacao_id`, `transactionId`, `operation_id`, `idempotency_key`, `fingerprint`, `financialState`, `resultStatus`, `usuario` e timestamp. COMMIT também contém `releaseEvidenceId` e `releaseTimestamp`. A validação verifica canonicalização, campos, estado, timestamp e assinatura Ed25519.

## Lacunas de continuidade

Trecho observado em [DestaxaRealAdapter.js](../../backend/services/tef/adapters/DestaxaRealAdapter.js:686):

```js
const usarPersistencia = dados.persistenciaContinuidade === true
  || String(process.env.DESTAXA_CONTINUIDADE_PERSISTENTE || '').trim() === '1';
```

Mais adiante, a gravação é envolvida em `try/catch`; o `catch` ignora o erro e, na sequência, o método chama `continuarCicloCrt` ([DestaxaRealAdapter.js](../../backend/services/tef/adapters/DestaxaRealAdapter.js:742)). Assim, com persistência habilitada, uma exceção pode ainda levar a `TX_CONTINUE`; sem persistência habilitada, o caminho também prossegue sem gravação durável.

O avaliador de timeout aceita a ausência da data como “não avaliado”:

```js
if (inicioMs == null) {
  return { ok: true, avaliado: false, motivo: 'solicitadaEm ausente — timeout não avaliado' };
}
```

Referência: [destaxaContinuidadeContrato.js](../../backend/services/tef/destaxa/destaxaContinuidadeContrato.js:227). O [TefManager.js](../../backend/services/tef/TefManager.js:416) registra `desde` apenas em memória; o caminho de continuação lê `solicitadaEm` de campos opcionais ou do payload persistido ([TefManager.js](../../backend/services/tef/TefManager.js:2178)). Não ficou comprovada a persistência e propagação do timestamp original da ação 99 em todas as reinicializações.

## Resultados dos testes

| Suíte | Resultado observado | Observação |
|---|---:|---|
| MRT-47 adaptado | **16/16 passou** | SQLite temporário, bootstrap assinado, IPC simulado, gate OFF; nenhum acesso direto sem bootstrap alcançou o driver. |
| MRT-49 | **20/20 passou** | Bootstrap ausente/inválido/de sessão anterior, UNKNOWN/PENDING, recuperação e guards. |
| MRT-50 IPC | **31/31 passou** | `failures` vazio; harness child-process/IPC. |
| MRT-50.2 | **Passou** | Todas as verificações da execução reportada passaram; sem contagem consolidada no relatório MRT-47. |
| MRT-50.3 | **12/12 passou** | Gate OFF, DLL não carregada e zero chamadas financeiras reais, conforme registro de execução. |

Comandos registrados:

```text
node tests\tef\mrt-47-reconciliacao-segura.test.js
node tests\tef\mrt-49-bootstrap-seguro-nativehost.test.js
node tests\tef\mrt-50-child-process-ipc.test.js
node tests\tef\mrt-50-2-integridade-evidencia-reconciliacao.test.js
node tests\tef\mrt-50-3-isolamento-recuperacao.test.js
```

### Divergência histórica MRT-47

O relatório JSON antigo declarava 16/16; registro de auditoria anterior mencionava 9 falhas e 7 aprovações, mas o log bruto não foi localizado. O baseline reproduzido antes da adaptação obteve 10 falhas e 6 aprovações. A divergência permanece explicitamente não resolvida e não é atribuída apenas ao harness sem prova.

### Contadores e ressalva do cenário UNKNOWN

O relatório MRT-47 registra zero chamadas em acesso direto sem bootstrap, reconciliação sem autorização e identidade pendente após reinício. No cenário 16, os contadores observados foram `{ inicia: 1, continua: 0, finaliza: 0 }`: a chamada `inicia` é usada pelo próprio cenário para criar UNKNOWN; então `TX_CONTINUE`, `TX_FINALIZE` e uma segunda `TX_START` são recusadas. Portanto, não interpretar esse `inicia=1` como uma chamada sob uma identidade já bloqueada nem como prova de zero TX_START inicial nesse cenário.

## Classificação por estado

### CONCLUÍDO
- Inspeção estática da recuperação, evidências assinadas, sequência RELEASE/COMMIT e isolamento de chave.
- Relatórios MRT-50.6 JSON e Markdown criados.

### TESTADO
- MRT-47 adaptado 16/16; MRT-49 20/20; MRT-50 IPC 31/31; MRT-50.2 passou conforme registro; MRT-50.3 12/12.
- Testes registrados usaram mocks/SQLite temporário; gate financeiro OFF e zero operação financeira real.

### BLOQUEADO
- Prontidão para preflight devido à persistência opcional/best-effort da resposta de continuidade 99.
- Timeout não aplicado quando o timestamp original está ausente.

### NÃO TESTADO
- Teste integrado específico de falha de persistência 99 seguido de tentativa de `TX_CONTINUE`, reinicialização e timeout ausente/expirado no ciclo produtivo.
- DLL, Host financeiro, banco oficial, V$Pague, PinPad, adquirentes, SEFAZ e qualquer operação simbólica/real.

## Próximo passo

Executar uma sprint corretiva restrita à continuidade 99, adicionar testes fail-closed com contadores independentes e repetir as regressões seguras. Só reavaliar o preflight depois de demonstrar persistência obrigatória recuperável, timestamp original válido e nenhuma chamada ao driver em todos os cenários bloqueados. Não executar transação até nova autorização específica.
