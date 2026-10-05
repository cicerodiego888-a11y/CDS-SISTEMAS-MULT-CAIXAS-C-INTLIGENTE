// Módulo de subcategorias - CRUD e integração
if (!window.subcategoriasAPI) {
const subcategoriasAPI = {
  listar: function() {
    return $.ajax({
      url: API_URL + '/subcategorias',
      method: 'GET',
      headers: { Authorization: 'Bearer ' + localStorage.getItem('token') }
    });
  },
  listarPorCategoria: function(categoria_id) {
    return $.ajax({
      url: API_URL + '/subcategorias/categoria/' + categoria_id,
      method: 'GET',
      headers: { Authorization: 'Bearer ' + localStorage.getItem('token') }
    });
  },
  criar: function(dados) {
    return $.ajax({
      url: API_URL + '/subcategorias',
      method: 'POST',
      contentType: 'application/json',
      data: JSON.stringify(dados),
      headers: { Authorization: 'Bearer ' + localStorage.getItem('token') }
    });
  },
  atualizar: function(id, dados) {
    return $.ajax({
      url: API_URL + '/subcategorias/' + id,
      method: 'PUT',
      contentType: 'application/json',
      data: JSON.stringify(dados),
      headers: { Authorization: 'Bearer ' + localStorage.getItem('token') }
    });
  },
  excluir: function(id) {
    return $.ajax({
      url: API_URL + '/subcategorias/' + id,
      method: 'DELETE',
      headers: { Authorization: 'Bearer ' + localStorage.getItem('token') }
    });
  }
};

// Exportar globalmente
window.subcategoriasAPI = subcategoriasAPI;
}

function atualizarSelectCategoriasSubcategoria() {
  categoriasAPI.listar('produto').done(function(categorias) {
    let options = '';
    categorias.forEach(cat => {
      options += `<option value="${cat.id}">${cat.nome}</option>`;
    });
    $('#subcategoria-categoria-id').html(options);
  });
}

function loadCategoriasAndSubcategorias() {
  const shellHost = document.getElementById('categorias-page-shell');
  if (!shellHost) return;

  $('#modal-subcategoria').off('show.bs.modal.categorias').on('show.bs.modal.categorias', function() {
    if (typeof atualizarSelectCategoriasSubcategoria === 'function') {
      atualizarSelectCategoriasSubcategoria();
    }
  });

  $('#filtro-tipo-categoria').off('change.categorias').on('change.categorias', function() {
    const tipoSelecionado = $(this).val();
    if (tipoSelecionado === 'despesa') {
      $('#subcategorias-section').hide();
      $('button[data-bs-target="#modal-subcategoria"]').prop('disabled', true);
    } else {
      $('#subcategorias-section').show();
      $('button[data-bs-target="#modal-subcategoria"]').prop('disabled', false);
    }
    loadCategorias();
  });

  if ($('#filtro-tipo-categoria').val() === 'despesa') {
    $('#subcategorias-section').hide();
    $('button[data-bs-target="#modal-subcategoria"]').prop('disabled', true);
  }

  if ($('#subcategoria-id').length === 0) {
    $('<input type="hidden" id="subcategoria-id">').prependTo($('#modal-subcategoria .modal-body'));
  }

  $('#btn-salvar-categoria').off('click').on('click', function() {
    if ($('#categoria-id').val()) salvarCategoria();
    else criarCategoria();
  });
  $('#btn-salvar-subcategoria').off('click').on('click', criarOuSalvarSubcategoria);

  if (window.CdsPageShell && typeof CdsPageShell.renderHeader === 'function') {
    shellHost.innerHTML = CdsPageShell.renderHeader({ page: 'categorias' });
  }

  loadCategorias();
  loadSubcategorias();
  atualizarSelectCategoriasSubcategoria();
}

function loadSubcategorias() {
  categoriasAPI.listar('produto').done(function(categorias) {
    const mapCat = {};
    categorias.forEach(cat => { mapCat[cat.id] = cat.nome; });
    subcategoriasAPI.listar().done(function(subcats) {
      let html = '';
      subcats.forEach(sub => {
        html += `<tr>
          <td>${sub.id}</td>
          <td>${sub.nome}</td>
          <td>${mapCat[sub.categoria_id] || '-'}</td>
          <td>
            <button class="btn btn-sm btn-primary" onclick="editarSubcategoria(${sub.id})">Editar</button>
            <button class="btn btn-sm btn-danger" onclick="excluirSubcategoria(${sub.id})">Excluir</button>
          </td>
        </tr>`;
      });
      $('#subcategorias-tbody').html(html);
    });
  });
}

function criarOuSalvarSubcategoria() {
  const id = $('#subcategoria-id').val();
  const nome = $('#subcategoria-nome').val().trim();
  const categoria_id = $('#subcategoria-categoria-id').val();
  if (!nome || !categoria_id) {
    alert('Nome e categoria são obrigatórios!');
    return;
  }
  if (id) {
    subcategoriasAPI.atualizar(id, { nome, categoria_id }).done(() => {
      $('#modal-subcategoria').modal('hide');
      $('#subcategoria-nome').val('');
      $('#subcategoria-id').val('');
      loadSubcategorias();
    }).fail(err => {
      alert('Erro ao atualizar subcategoria: ' + (err.responseJSON?.erro || err.statusText));
    });
  } else {
    subcategoriasAPI.criar({ nome, categoria_id }).done(() => {
      $('#modal-subcategoria').modal('hide');
      $('#subcategoria-nome').val('');
      $('#subcategoria-id').val('');
      loadSubcategorias();
    }).fail(err => {
      alert('Erro ao criar subcategoria: ' + (err.responseJSON?.erro || err.statusText));
    });
  }
}

function editarSubcategoria(id) {
  subcategoriasAPI.listar().done(function(subcats) {
    const sub = subcats.find(s => s.id == id);
    if (!sub) return;
    $('#subcategoria-nome').val(sub.nome);
    $('#subcategoria-categoria-id').val(sub.categoria_id);
    $('#subcategoria-id').val(sub.id);
    $('#modal-subcategoria').modal('show');
  });
}

function excluirSubcategoria(id) {
  if (!confirm('Deseja realmente excluir esta subcategoria?')) return;
  subcategoriasAPI.excluir(id).done(() => {
    loadSubcategorias();
  }).fail(err => {
    alert('Erro ao excluir subcategoria: ' + (err.responseJSON?.erro || err.statusText));
  });
}
