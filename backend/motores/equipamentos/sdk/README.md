# Device Profile SDK — Sprint 15.7

Plataforma extensível do Motor Universal de Equipamentos.

Novos fabricantes (balanças, impressoras, coletores, leitores) são integrados **somente** com um Driver Profile + protocolo específico, reutilizando Discovery, Connection Manager, Orquestrador, Telemetria e Laboratório.

## Fluxo

```
Inicialização
    ↓
Scan (sdk/profiles + drivers/**/device.profile.js)
    ↓
Manifest
    ↓
Validator + Compatibilidade
    ↓
Registry
    ↓
Driver disponível (API / UI / Lab)
```

## Manifesto (exemplo)

```js
module.exports = {
  id: 'toledo-prix4',
  fabricante: 'Toledo',
  modelo: 'Prix IV Uno',
  categoria: 'balanca',
  protocolo: '90AX',
  transportes: ['ethernet', 'serial'],
  discovery: { ports: [9000, 9100, 4001], timeout: 500 },
  capabilities: {
    identify: true,
    sync: true,
    rollback: true,
    scheduler: true,
    telemetry: true
  }
};
```

## Capabilities padronizadas

Discovery · Connection · Identification · Synchronization · Scheduler · Telemetry · Diagnostics · Rollback · Update · Backup

## Criar novo driver

```bash
npm run driver:create -- --fabricante Acme --modelo X100 --categoria balanca --protocolo acme-x100
```

Gera automaticamente: pasta do driver, `device.profile.js`, classe scaffold, README, teste e perfil em `sdk/profiles`.

## API

| Método | Rota | Descrição |
|--------|------|-----------|
| GET | `/api/equipamentos/drivers` | Lista drivers (SDK) |
| GET | `/api/equipamentos/drivers/:id` | Detalhe |
| GET | `/api/equipamentos/drivers/categories` | Categorias / fabricantes |
| POST | `/api/equipamentos/drivers/reload` | Recarrega manifests |
| GET | `/api/equipamentos/drivers/laboratorio` | Visão lab (validação / tempo de carga) |

## Checklist de integração

- [ ] Criar perfil (`npm run driver:create` ou `device.profile.js`)
- [ ] Implementar protocolo no driver
- [ ] Validar manifesto (`DriverValidator`)
- [ ] `POST /drivers/reload`
- [ ] Homologar no Laboratório
- [ ] Expor capabilities corretas
- [ ] Testes `npm run test:device-sdk`

## Módulos

| Arquivo | Papel |
|---------|--------|
| `DeviceProfile.js` | Contrato canônico |
| `DriverManifest.js` | Schema / parse |
| `DriverCapabilities.js` | Capacidades |
| `DriverValidator.js` | Manifest + classe |
| `DriverCompatibility.js` | Versão motor |
| `DriverRegistry.js` | Registro |
| `DriverLoader.js` | Scan dinâmico |
| `DriverTemplateGenerator.js` | Scaffold |
