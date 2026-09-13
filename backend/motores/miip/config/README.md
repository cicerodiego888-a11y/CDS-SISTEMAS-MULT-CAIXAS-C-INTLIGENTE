# config/

Configuração e defaults do MIIP.

## Arquivos previstos (Sprint 2+)

| Arquivo | Responsabilidade |
|---------|------------------|
| `miip.defaults.json` | Pesos, thresholds, engines ativos |
| `miip.schema.json` | Schema de validação de config |

## Parâmetros configuráveis

| Chave | Default | Descrição |
|-------|---------|-----------|
| `usarMiip` | `true` | Feature flag — desativa integração ERP imediatamente |

## Arquivos

| Arquivo | Responsabilidade |
|---------|------------------|
| `miip.defaults.json` | Defaults (`usarMiip: true`) |
| `miipFeatureFlags.js` | Resolução de feature flags (env + banco + override) |
