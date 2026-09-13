# Instruções: Upload de Certificado Digital

## 1. Usando o Postman

### Endpoint
```
POST http://localhost:3000/api/fiscal/config/certificado
```

### Configuração

1. **Método**: POST
2. **Tipo de dados**: form-data
3. **Campos obrigatórios**:
   - `certificado` (tipo: File) → Selecione o arquivo .pfx ou .p12
   - `senha` (tipo: Text) → Senha do certificado

### Passos no Postman

1. Abra o Postman
2. Crie uma nova requisição POST
3. Cole a URL: `http://localhost:3000/api/fiscal/config/certificado`
4. Vá para a aba **Body**
5. Selecione **form-data**
6. Adicione os campos:
   - Key: `certificado` | Value: [selecione o arquivo .pfx ou .p12]
   - Key: `senha` | Value: [insira a senha]
7. Clique em **Send**

### Resposta de sucesso (200)
```json
{
  "success": true,
  "message": "Certificado validado e salvo com sucesso.",
  "certificado": {
    "fileName": "certificado.pfx",
    "filePath": "backend/storage/temp-certificados/abc123xyz",
    "serialNumber": "123456789ABC",
    "validFrom": "2024-01-01",
    "validTo": "2025-12-31",
    "subject": "CN=Empresa Ltda",
    "issuer": "CN=Autoridade Certificadora"
  }
}
```

### Erros possíveis

#### 400 - Arquivo não enviado
```json
{
  "error": "Arquivo do certificado não enviado."
}
```

#### 400 - Certificado inválido
```json
{
  "error": "Certificado inválido",
  "detalhes": "Senha incorreta ou arquivo corrompido"
}
```

#### 400 - Sem configuração fiscal
```json
{
  "error": "Cadastre primeiro a configuração fiscal da empresa antes de enviar o certificado."
}
```

---

## 2. Usando cURL

```bash
curl -X POST http://localhost:3000/api/fiscal/config/certificado \
  -F "certificado=@/caminho/para/certificado.pfx" \
  -F "senha=suaSenha123"
```

---

## 3. Usando JavaScript/Frontend

### HTML Form

```html
<div class="card">
  <div class="card-header">
    <i class="fas fa-certificate"></i> Upload do Certificado Digital
  </div>
  <div class="card-body">
    <form id="formUploadCertificado">
      <div class="form-group mb-3">
        <label for="certificadoFile">Arquivo do Certificado (.pfx ou .p12)</label>
        <input 
          type="file" 
          class="form-control" 
          id="certificadoFile"
          name="certificado"
          accept=".pfx,.p12"
          required
        >
        <small class="text-muted">Máximo 5 MB</small>
      </div>

      <div class="form-group mb-3">
        <label for="certificadoSenha">Senha do Certificado</label>
        <input 
          type="password" 
          class="form-control" 
          id="certificadoSenha"
          name="senha"
          placeholder="Digite a senha do certificado"
          required
        >
      </div>

      <button type="submit" class="btn btn-primary">
        <i class="fas fa-upload"></i> Enviar Certificado
      </button>
      <span id="uploadStatus"></span>
    </form>

    <div id="certificadoInfo" class="mt-4" style="display:none;">
      <div class="alert alert-success">
        <h6>Certificado Carregado com Sucesso</h6>
        <p><strong>Serial:</strong> <span id="infoSerial"></span></p>
        <p><strong>Válido de:</strong> <span id="infoValidFrom"></span></p>
        <p><strong>Válido até:</strong> <span id="infoValidTo"></span></p>
        <p><strong>Assunto:</strong> <span id="infoSubject"></span></p>
      </div>
    </div>
  </div>
</div>
```

### JavaScript

```javascript
$('#formUploadCertificado').on('submit', function(e) {
  e.preventDefault();

  const formData = new FormData();
  const fileInput = document.getElementById('certificadoFile');
  const senhaInput = document.getElementById('certificadoSenha');

  formData.append('certificado', fileInput.files[0]);
  formData.append('senha', senhaInput.value);

  const statusSpan = $('#uploadStatus');
  statusSpan.html('<span class="spinner-border spinner-border-sm text-primary me-2"></span>Enviando...');

  $.ajax({
    url: `${API_URL}/fiscal/config/certificado`,
    type: 'POST',
    data: formData,
    processData: false,
    contentType: false,
    success: function(response) {
      if (response.success) {
        statusSpan.html('<span class="badge bg-success ms-2">Salvo com sucesso!</span>');
        
        // Exibir informações do certificado
        $('#infoSerial').text(response.certificado.serialNumber);
        $('#infoValidFrom').text(response.certificado.validFrom);
        $('#infoValidTo').text(response.certificado.validTo);
        $('#infoSubject').text(response.certificado.subject);
        $('#certificadoInfo').show();

        // Limpar formulário
        fileInput.value = '';
        senhaInput.value = '';

        setTimeout(() => {
          statusSpan.html('');
        }, 3000);
      }
    },
    error: function(xhr) {
      const error = xhr.responseJSON || {};
      const message = error.error || 'Erro ao enviar certificado';
      statusSpan.html(`<span class="badge bg-danger ms-2">${escapeHtml(message)}</span>`);
    }
  });
});
```

---

## 4. Testar o Certificado Salvo

### Endpoint
```
GET http://localhost:3000/api/fiscal/config/certificado/testar
```

### Usando Postman
1. Método: GET
2. URL: `http://localhost:3000/api/fiscal/config/certificado/testar`
3. Clique em Send

### Usando cURL
```bash
curl http://localhost:3000/api/fiscal/config/certificado/testar
```

### Resposta esperada
```json
{
  "success": true,
  "message": "Certificado válido.",
  "certificado": {
    "serialNumber": "123456789ABC",
    "validFrom": "2024-01-01",
    "validTo": "2025-12-31",
    "subject": "CN=Empresa Ltda",
    "issuer": "CN=Autoridade Certificadora"
  }
}
```

---

## 📋 Checklist de Requisitos

- [ ] Arquivo certificado em formato .pfx ou .p12
- [ ] Senha do certificado disponível
- [ ] Configuração fiscal da empresa já cadastrada
- [ ] Backend rodando na porta 3000
- [ ] Dependências instaladas (`multer`, `node-forge`, `xml-crypto`)

---

## 🔒 Nota de Segurança

- A senha do certificado é armazenada no banco de dados (SQLite)
- Em produção, considere usar criptografia adicional para as senhas
- Proteja o acesso ao arquivo do certificado no servidor
- Use HTTPS em produção
