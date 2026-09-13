/**
 * Serviço de certificação de adapters TEF
 * Gerencia informações sobre certificação e conformidade dos adapters
 */
class TefCertificationService {
  
  constructor() {
    // Informações de certificação dos adapters
    this.certificacoes = {
      sitef: {
        nome: 'SiTef (Software Express)',
        versao: '1.0.0',
        certificado: false,
        data_certificacao: null,
        numero_certificacao: null,
        bandeiras_suportadas: ['Visa', 'Mastercard', 'Elo', 'Hipercard', 'American Express', 'Discover', 'JCB', 'Diners Club', 'Aura'],
        requisitos: [
          'SDK CliSiTef instalado',
          'Configuração de terminal válida',
          'Certificação PCI-DSS',
          'Homologação em ambiente de teste',
          'Testes de integração com todas as bandeiras'
        ],
        status: 'em_desenvolvimento'
      },
      paygo: {
        nome: 'PayGo',
        versao: '1.0.0',
        certificado: false,
        data_certificacao: null,
        numero_certificacao: null,
        bandeiras_suportadas: ['Visa', 'Mastercard', 'Elo', 'Hipercard', 'American Express', 'Discover', 'JCB', 'Diners Club', 'Aura'],
        requisitos: [
          'SDK PayGo instalado',
          'Configuração de terminal válida',
          'Certificação PCI-DSS',
          'Homologação em ambiente de teste',
          'Testes de integração com todas as bandeiras'
        ],
        status: 'em_desenvolvimento'
      }
    };
  }
  
  /**
   * Obtém informações de certificação de um adapter
   */
  obterCertificacao(adapter) {
    const adapterNormalizado = adapter.toLowerCase();
    
    if (adapterNormalizado.includes('sitef')) {
      return this.certificacoes.sitef;
    }
    
    if (adapterNormalizado.includes('paygo')) {
      return this.certificacoes.paygo;
    }
    
    return null;
  }
  
  /**
   * Obtém todas as certificações
   */
  obterTodasCertificacoes() {
    return this.certificacoes;
  }
  
  /**
   * Atualiza status de certificação
   */
  atualizarCertificacao(adapter, dados) {
    const adapterNormalizado = adapter.toLowerCase();
    let certificacao;
    
    if (adapterNormalizado.includes('sitef')) {
      certificacao = this.certificacoes.sitef;
    } else if (adapterNormalizado.includes('paygo')) {
      certificacao = this.certificacoes.paygo;
    } else {
      throw new Error('Adapter não encontrado');
    }
    
    if (dados.certificado !== undefined) {
      certificacao.certificado = dados.certificado;
    }
    
    if (dados.data_certificacao) {
      certificacao.data_certificacao = dados.data_certificacao;
    }
    
    if (dados.numero_certificacao) {
      certificacao.numero_certificacao = dados.numero_certificacao;
    }
    
    if (dados.status) {
      certificacao.status = dados.status;
    }
    
    if (dados.versao) {
      certificacao.versao = dados.versao;
    }
    
    return certificacao;
  }
  
  /**
   * Verifica se um adapter está certificado
   */
  estaCertificado(adapter) {
    const certificacao = this.obterCertificacao(adapter);
    return certificacao ? certificacao.certificado : false;
  }
  
  /**
   * Obtém requisitos de certificação para um adapter
   */
  obterRequisitosCertificacao(adapter) {
    const certificacao = this.obterCertificacao(adapter);
    return certificacao ? certificacao.requisitos : [];
  }
  
  /**
   * Obtém bandeiras suportadas por um adapter
   */
  obterBandeirasSuportadas(adapter) {
    const certificacao = this.obterCertificacao(adapter);
    return certificacao ? certificacao.bandeiras_suportadas : [];
  }
  
  /**
   * Registra resultado de teste de homologação
   */
  registrarTesteHomologacao(adapter, resultado) {
    const certificacao = this.obterCertificacao(adapter);
    
    if (!certificacao) {
      throw new Error('Adapter não encontrado');
    }
    
    if (!certificacao.testes_homologacao) {
      certificacao.testes_homologacao = [];
    }
    
    certificacao.testes_homologacao.push({
      data: new Date().toISOString(),
      resultado: resultado.sucesso ? 'aprovado' : 'reprovado',
      testes: resultado.testes,
      observacoes: resultado.observacoes
    });
    
    // Se todos os testes passaram, atualizar status
    const todosAprovados = certificacao.testes_homologacao.every(t => t.resultado === 'aprovado');
    if (todosAprovados && certificacao.testes_homologacao.length > 0) {
      certificacao.status = 'homologado';
    }
    
    return certificacao;
  }
  
  /**
   * Obtém histórico de testes de homologação
   */
  obterHistoricoHomologacao(adapter) {
    const certificacao = this.obterCertificacao(adapter);
    return certificacao ? certificacao.testes_homologacao || [] : [];
  }
  
  /**
   * Gera relatório de certificação
   */
  gerarRelatorioCertificacao(adapter) {
    const certificacao = this.obterCertificacao(adapter);
    
    if (!certificacao) {
      throw new Error('Adapter não encontrado');
    }
    
    return {
      adapter: certificacao.nome,
      versao: certificacao.versao,
      status_atual: certificacao.status,
      certificado: certificacao.certificado,
      data_certificacao: certificacao.data_certificacao,
      numero_certificacao: certificacao.numero_certificacao,
      bandeiras_suportadas: certificacao.bandeiras_suportadas,
      requisitos_pendentes: certificacao.requisitos,
      testes_homologacao: certificacao.testes_homologacao || [],
      recomendacao: this._gerarRecomendacao(certificacao)
    };
  }
  
  /**
   * Gera recomendação baseada no status
   */
  _gerarRecomendacao(certificacao) {
    if (certificacao.certificado) {
      return 'Adapter certificado e pronto para uso em produção';
    }
    
    if (certificacao.status === 'homologado') {
      return 'Adapter homologado, aguardando certificação oficial do adquirente';
    }
    
    if (certificacao.status === 'em_desenvolvimento') {
      return 'Adapter em desenvolvimento, necessário completar homologação';
    }
    
    return 'Status desconhecido, verificar requisitos de certificação';
  }
}

module.exports = new TefCertificationService();
