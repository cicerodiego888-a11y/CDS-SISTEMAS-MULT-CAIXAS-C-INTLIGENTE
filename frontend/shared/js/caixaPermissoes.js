/**
 * Permissões granulares de caixa — frontend (ERP + PDV).
 * Sem permissão: solicita senha de administrador antes da operação.
 */

const PERMISSOES_CAIXA = {
  ABRIR: 'abrir_caixa',
  SANGRIA: 'sangria_caixa',
  SUPRIMENTO: 'suprimento_caixa',
  FECHAR: 'fechar_caixa'
};

function temPermissaoOperacaoCaixa(permissao, user) {
  const u = user || (typeof obterUsuarioLogado === 'function' ? obterUsuarioLogado() : {});
  const role = u.role || 'operador';
  const perfil = String(u.perfil || 'USUARIO').toUpperCase();
  const permissoes = typeof normalizarPermissoes === 'function'
    ? normalizarPermissoes(u.permissoes)
    : (Array.isArray(u.permissoes)
      ? u.permissoes
      : String(u.permissoes || '').split(',').map((p) => p.trim()).filter(Boolean));

  if (role === 'admin' || ['SUPER_ADMIN', 'ADMIN'].includes(perfil)) {
    return true;
  }

  return permissoes.includes(permissao);
}

function solicitarSenhaAdministrador(opcoes = {}) {
  const titulo = opcoes.titulo || 'Senha de Administrador';
  const mensagem = opcoes.mensagem || 'Digite a senha do administrador para continuar.';

  return new Promise((resolve, reject) => {
    const modalId = 'modalSenhaAdminCaixa';
    const backdropId = 'modal-backdrop-senha-caixa';

    $(`#${modalId}, #${backdropId}`).remove();

    const modalHtml = `
      <div class="modal fade" id="${modalId}" tabindex="-1" style="display: none;">
        <div class="modal-dialog">
          <div class="modal-content">
            <div class="modal-header">
              <h5 class="modal-title">${titulo}</h5>
              <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
            </div>
            <div class="modal-body">
              <p>${mensagem}</p>
              <label for="senha-admin-caixa-input" class="form-label">Senha do administrador</label>
              <input type="password" id="senha-admin-caixa-input" class="form-control" autocomplete="off" placeholder="Senha">
            </div>
            <div class="modal-footer">
              <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Cancelar</button>
              <button type="button" class="btn btn-primary" id="btn-confirmar-senha-admin-caixa">Confirmar</button>
            </div>
          </div>
        </div>
      </div>
    `;

    $('body').append(modalHtml);
    const $modal = $(`#${modalId}`);

    function fechar(cancelado) {
      $modal.modal('hide');
      $modal.on('hidden.bs.modal', function onHidden() {
        $modal.remove();
        if (cancelado) reject(new Error('Operação cancelada.'));
      });
    }

    $modal.modal('show');

    setTimeout(() => {
      $('#senha-admin-caixa-input').trigger('focus');
    }, 250);

    $('#senha-admin-caixa-input').on('keydown', function onKey(e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        $('#btn-confirmar-senha-admin-caixa').trigger('click');
      }
    });

    $('#btn-confirmar-senha-admin-caixa').on('click', function onConfirm() {
      const senha = String($('#senha-admin-caixa-input').val() || '').trim();
      if (!senha) {
        if (typeof showNotification === 'function') {
          showNotification('Digite a senha do administrador.', 'warning');
        }
        return;
      }
      $modal.off('hidden.bs.modal');
      $modal.modal('hide');
      $modal.on('hidden.bs.modal', function onHidden() {
        $modal.remove();
        resolve(senha);
      });
    });

    $modal.on('hidden.bs.modal', function onCancel() {
      if ($(`#${modalId}`).length) {
        $modal.remove();
        reject(new Error('Operação cancelada.'));
      }
    });
  });
}

async function executarAcaoCaixaComPermissao(permissao, executar, opcoesSenha = {}) {
  let senhaAdmin = null;

  if (!temPermissaoOperacaoCaixa(permissao)) {
    senhaAdmin = await solicitarSenhaAdministrador(opcoesSenha);
  }

  return executar(senhaAdmin);
}

async function enviarOperacaoCaixa(permissao, url, body, opcoes = {}) {
  const mensagemErro = opcoes.mensagemErro || 'Erro ao executar operação de caixa.';

  try {
    const resposta = await executarAcaoCaixaComPermissao(permissao, (senhaAdmin) => {
      const payload = { ...body };
      if (senhaAdmin) {
        payload.senha_admin = senhaAdmin;
      }

      const data = typeof getTerminalRequestData === 'function'
        ? getTerminalRequestData(payload)
        : payload;

      return $.ajax({
        url: `${API_URL}${url}`,
        method: 'POST',
        contentType: 'application/json',
        data: JSON.stringify(data),
        global: opcoes.global !== false
      });
    }, opcoes.senha || {});

    if (typeof opcoes.onSuccess === 'function') {
      opcoes.onSuccess(resposta);
    }
  } catch (erro) {
    if (erro && erro.message === 'Operação cancelada.') {
      if (typeof opcoes.onCancel === 'function') {
        opcoes.onCancel();
      }
      return;
    }

    const xhr = erro;
    const mensagem = xhr?.responseJSON?.error || erro?.message || mensagemErro;
    if (typeof opcoes.onError === 'function') {
      opcoes.onError(mensagem, xhr);
    } else if (typeof showNotification === 'function') {
      showNotification(mensagem, 'danger');
    }
  }
}

window.PERMISSOES_CAIXA = PERMISSOES_CAIXA;
window.temPermissaoOperacaoCaixa = temPermissaoOperacaoCaixa;
window.solicitarSenhaAdministrador = solicitarSenhaAdministrador;
window.executarAcaoCaixaComPermissao = executarAcaoCaixaComPermissao;
window.enviarOperacaoCaixa = enviarOperacaoCaixa;
