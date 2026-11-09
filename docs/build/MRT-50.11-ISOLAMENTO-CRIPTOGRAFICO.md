# MRT-50.11 — Isolamento criptográfico

**Classificação:** APROVADA nos critérios unitários desta sprint  
**Gate financeiro:** OFF  
**NativeHost/CDS, DLL, banco oficial e serviços financeiros:** não iniciados/acessados

## Resultado

A chave privada Ed25519 deixou de ser exportada pelo serviço de evidências e não é mais entregue ao `TefManager`. O TefManager solicita assinaturas por funções específicas e encaminha ao cliente NativeHost somente a chave pública codificada em Base64. O ambiente construído para o NativeHost exclui `TEF_ENCRYPTION_KEY` e outros segredos.

A assinatura exige `TEF_ENCRYPTION_KEY` explicitamente configurada com 32 bytes (64 caracteres hexadecimais). Ausência, formato inválido, chave fixa de desenvolvimento e tentativa de derivação no processo NativeHost falham fechadas, sem depender de `NODE_ENV`. O derivador Ed25519 foi removido do `cryptoService` genérico.

## Compatibilidade e separação de chaves

Não houve rotação nem mudança no formato histórico. Para manter a compatibilidade das evidências assinadas com uma chave de ambiente válida, foram preservados:

- HMAC-SHA-256 sobre os mesmos 32 bytes decodificados de `TEF_ENCRYPTION_KEY`;
- contexto `CDS:TEF:ED25519:reconciliation-evidence-v1`;
- prefixo PKCS#8 Ed25519 e serialização ordenada dos claims;
- versão e campos dos registros RELEASE/COMMIT.

Fixtures RELEASE e COMMIT assinadas pelo código anterior com uma chave de teste configurada foram verificadas com sucesso. Evidências continuam dependendo da mesma chave de ambiente para validação; não foi feita migração nem acesso ao banco oficial.

**Decisão sobre separação:** a chave de assinatura permanece derivada do mesmo segredo configurado `TEF_ENCRYPTION_KEY`, pois introduzir uma variável de assinatura distinta mudaria a chave pública e poderia invalidar evidências persistidas. Nenhuma rotação automática foi feita. Uma separação futura requer versionamento/seleção de chaves verificadoras e migração explícita antes da troca. A chave fixa de desenvolvimento, por outro lado, não é aceita para novas assinaturas.

## Arquivos alterados nesta sprint

- `backend/config/secrets.js` — documenta requisito e compatibilidade da chave.
- `backend/services/crypto/cryptoService.js` — remove a API genérica de derivação da chave privada Ed25519.
- `backend/services/tef/tefReconciliationEvidence.js` — encapsula derivação e assinatura; expõe apenas operações específicas e chave pública.
- `backend/services/tef/TefManager.js` — usa assinadores/verificadores, sem importar ou armazenar objeto privado; vincula validação à identidade completa.
- `tests/tef/mrt-50-11-isolamento-criptografico.test.js` — suíte unitária sem inicializar NativeHost, CDS ou banco.
- `docs/build/MRT-50.11-ISOLAMENTO-CRIPTOGRAFICO.md`
- `docs/build/mrt-50-11-isolamento-criptografico-report.json`

Os arquivos MRT-50.8, MRT-50.9 e MRT-50.10, assim como MRT-24, MRT-36 e MRT-42, não foram modificados nesta sprint.

## Testes e evidências

`node tests\tef\mrt-50-11-isolamento-criptografico.test.js`: **12/12 PASSOU**. Foram cobertos segredo ausente e malformado, chave fixa proibida, assinatura/verificação com chave válida, adulteração, divergência de identidade, bloqueio da derivação no NativeHost, filtragem do ambiente, validação por chave pública e compatibilidade RELEASE/COMMIT histórica.

`node --check` passou nos arquivos alterados; `git diff --check` não reportou problemas. A revisão estática confirmou ausência de exportação de `obterParChavesReconciliacao()` e de referências a `privateKey` no TefManager e no NativeHost.

O teste carregou apenas módulos de criptografia, protocolo e construção do ambiente do cliente; não carregou `DestaxaNativeHost.js`, não iniciou processo, não acessou banco e não chamou driver. Contadores financeiros: TX_START=0, TX_CONTINUE=0, TX_FINALIZE=0; cargas de DLL=0.

## Limites

O fallback existente de AES no `cryptoService` para outras operações não é usado pelo assinador Ed25519; esta sprint remove o fallback apenas do caminho de assinatura. Evidências assinadas com a chave fixa de desenvolvimento não podem ser tratadas como prova confiável; a validação histórica aprovada aqui é a de registros assinados com a chave de ambiente correspondente.

Esta aprovação não libera pré-flight, operação financeira ou homologação física.
