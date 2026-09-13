/**
 * Serviço de mascaramento de dados sensíveis
 * Conforme PCI-DSS 3.2.1 - Proteção de dados sensíveis em logs e exibições
 */
class DataMaskingService {
  
  /**
   * Mascarar número de cartão de crédito
   * Mantém apenas os primeiros 6 e últimos 4 dígitos
   * @param {string} numeroCartao - Número do cartão
   * @returns {string} Número mascarado
   */
  static mascararCartao(numeroCartao) {
    if (!numeroCartao) return null;
    
    // Remover caracteres não numéricos
    const apenasNumeros = String(numeroCartao).replace(/\D/g, '');
    
    if (apenasNumeros.length < 10) {
      // Se for muito curto, mascarar tudo exceto últimos 4
      return apenasNumeros.substring(0, apenasNumeros.length - 4).replace(/./g, '*') + 
             apenasNumeros.substring(apenasNumeros.length - 4);
    }
    
    // Mascarar mantendo primeiros 6 e últimos 4 dígitos (padrão PCI-DSS)
    const inicio = apenasNumeros.substring(0, 6);
    const fim = apenasNumeros.substring(apenasNumeros.length - 4);
    const meio = '*'.repeat(apenasNumeros.length - 10);
    
    return inicio + meio + fim;
  }
  
  /**
   * Mascarar código de autorização
   * Mantém apenas os últimos 4 caracteres
   * @param {string} autorizacao - Código de autorização
   * @returns {string} Código mascarado
   */
  static mascararAutorizacao(autorizacao) {
    if (!autorizacao) return null;
    
    const texto = String(autorizacao);
    if (texto.length <= 4) return texto;
    
    return '*'.repeat(texto.length - 4) + texto.substring(texto.length - 4);
  }
  
  /**
   * Mascarar NSU (Número Sequencial Único)
   * Mantém apenas os últimos 4 dígitos
   * @param {string} nsu - NSU
   * @returns {string} NSU mascarado
   */
  static mascararNsu(nsu) {
    if (!nsu) return null;
    
    const texto = String(nsu).replace(/\D/g, '');
    if (texto.length <= 4) return texto;
    
    return '*'.repeat(texto.length - 4) + texto.substring(texto.length - 4);
  }
  
  /**
   * Mascarar CPF/CNPJ
   * Mantém apenas os primeiros 3 e últimos 2 dígitos
   * @param {string} documento - CPF ou CNPJ
   * @returns {string} Documento mascarado
   */
  static mascararDocumento(documento) {
    if (!documento) return null;
    
    const apenasNumeros = String(documento).replace(/\D/g, '');
    
    if (apenasNumeros.length <= 5) {
      return apenasNumeros.substring(0, apenasNumeros.length - 2).replace(/./g, '*') + 
             apenasNumeros.substring(apenasNumeros.length - 2);
    }
    
    const inicio = apenasNumeros.substring(0, 3);
    const fim = apenasNumeros.substring(apenasNumeros.length - 2);
    const meio = '*'.repeat(apenasNumeros.length - 5);
    
    return inicio + meio + fim;
  }
  
  /**
   * Mascarar e-mail
   * Mantém apenas o primeiro caractere do usuário e domínio completo
   * @param {string} email - E-mail
   * @returns {string} E-mail mascarado
   */
  static mascararEmail(email) {
    if (!email) return null;
    
    const partes = String(email).split('@');
    if (partes.length !== 2) return email;
    
    const usuario = partes[0];
    const dominio = partes[1];
    
    if (usuario.length <= 2) {
      return '*'.repeat(usuario.length) + '@' + dominio;
    }
    
    return usuario[0] + '*'.repeat(usuario.length - 1) + '@' + dominio;
  }
  
  /**
   * Mascarar telefone
   * Mantém apenas os primeiros 2 e últimos 2 dígitos
   * @param {string} telefone - Telefone
   * @returns {string} Telefone mascarado
   */
  static mascararTelefone(telefone) {
    if (!telefone) return null;
    
    const apenasNumeros = String(telefone).replace(/\D/g, '');
    
    if (apenasNumeros.length <= 4) {
      return apenasNumeros.substring(0, apenasNumeros.length - 2).replace(/./g, '*') + 
             apenasNumeros.substring(apenasNumeros.length - 2);
    }
    
    const inicio = apenasNumeros.substring(0, 2);
    const fim = apenasNumeros.substring(apenasNumeros.length - 2);
    const meio = '*'.repeat(apenasNumeros.length - 4);
    
    return inicio + meio + fim;
  }
  
  /**
   * Mascarar objeto recursivamente
   * Identifica e mascara campos sensíveis em objetos JSON
   * @param {Object} objeto - Objeto a ser mascarado
   * @returns {Object} Objeto mascarado
   */
  static mascararObjeto(objeto) {
    if (!objeto || typeof objeto !== 'object') {
      return objeto;
    }
    
    const camposSensiveis = [
      'numero_cartao', 'cardNumber', 'card_number', 'pan',
      'cvv', 'cvc', 'security_code',
      'senha', 'password', 'pass',
      'cpf', 'cnpj', 'documento',
      'email', 'telefone', 'phone',
      'autorizacao', 'nsu'
    ];
    
    const resultado = Array.isArray(objeto) ? [] : {};
    
    for (const chave in objeto) {
      const valor = objeto[chave];
      const chaveNormalizada = String(chave).toLowerCase().replace(/_/g, '');
      
      if (typeof valor === 'object' && valor !== null) {
        resultado[chave] = this.mascararObjeto(valor);
      } else if (typeof valor === 'string') {
        // Verificar se é um campo sensível
        const ehCampoSensivel = camposSensiveis.some(campo => 
          chaveNormalizada.includes(campo.replace(/_/g, ''))
        );
        
        if (ehCampoSensivel) {
          if (chaveNormalizada.includes('cartao') || chaveNormalizada.includes('card') || chaveNormalizada.includes('pan')) {
            resultado[chave] = this.mascararCartao(valor);
          } else if (chaveNormalizada.includes('autorizacao')) {
            resultado[chave] = this.mascararAutorizacao(valor);
          } else if (chaveNormalizada.includes('nsu')) {
            resultado[chave] = this.mascararNsu(valor);
          } else if (chaveNormalizada.includes('cpf') || chaveNormalizada.includes('cnpj') || chaveNormalizada.includes('documento')) {
            resultado[chave] = this.mascararDocumento(valor);
          } else if (chaveNormalizada.includes('email')) {
            resultado[chave] = this.mascararEmail(valor);
          } else if (chaveNormalizada.includes('telefone') || chaveNormalizada.includes('phone')) {
            resultado[chave] = this.mascararTelefone(valor);
          } else if (chaveNormalizada.includes('senha') || chaveNormalizada.includes('password') || chaveNormalizada.includes('cvv') || chaveNormalizada.includes('cvc')) {
            resultado[chave] = '***';
          } else {
            resultado[chave] = valor;
          }
        } else {
          resultado[chave] = valor;
        }
      } else {
        resultado[chave] = valor;
      }
    }
    
    return resultado;
  }
  
  /**
   * Mascarar payload JSON para logs
   * @param {Object|string} payload - Payload a ser mascarado
   * @returns {string} Payload mascarado em formato JSON
   */
  static mascararPayload(payload) {
    if (!payload) return null;
    
    let objeto;
    if (typeof payload === 'string') {
      try {
        objeto = JSON.parse(payload);
      } catch (e) {
        // Se não for JSON válido, retorna como está
        return payload;
      }
    } else {
      objeto = payload;
    }
    
    const mascarado = this.mascararObjeto(objeto);
    return JSON.stringify(mascarado);
  }
}

module.exports = DataMaskingService;
