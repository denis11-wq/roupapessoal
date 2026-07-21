// ================== ROUPEIRO DIGITAL ==================
// Tudo guardado localmente no browser (IndexedDB). Zero pedidos à internet.

// ---------- Constantes ----------
// camada: 0 = colada ao corpo, 1 = por cima (sweat, camisa aberta). Só conta em slot 'top'.
// manga: define o desenho no boneco.
const CATEGORIAS = [
  { id: 'tshirt',    nome: 'T-shirts & Tops',   slot: 'top',       emoji: '👕', camada: 0, manga: 'curta' },
  { id: 'camisa',    nome: 'Camisas',           slot: 'top',       emoji: '👔', camada: 1, manga: 'longa' },
  { id: 'camisola',  nome: 'Camisolas & Sweats',slot: 'top',       emoji: '🧶', camada: 1, manga: 'longa' },
  { id: 'casaco',    nome: 'Casacos',           slot: 'casaco',    emoji: '🧥', camada: 2, manga: 'longa' },
  { id: 'calcas',    nome: 'Calças',            slot: 'bottom',    emoji: '👖' },
  { id: 'calcoes',   nome: 'Calções',           slot: 'bottom',    emoji: '🩳' },
  { id: 'saia',      nome: 'Saias',             slot: 'bottom',    emoji: '👗' },
  { id: 'vestido',   nome: 'Vestidos',          slot: 'vestido',   emoji: '👗' },
  { id: 'calcado',   nome: 'Calçado',           slot: 'calcado',   emoji: '👟' },
  { id: 'acessorio', nome: 'Acessórios',        slot: 'acessorio', emoji: '🧢' },
];
const CAMADAS = [
  { id: 0, nome: 'Base',    emoji: '👕', desc: 'Colada ao corpo' },
  { id: 1, nome: 'Por cima', emoji: '🧶', desc: 'Sweat, camisa aberta, colete' },
];
const camadaDe = i => i.camada ?? cat(i.categoria).camada ?? 0;

const CORES = ['branco','preto','cinzento','bege','castanho','azul','azul-marinho','verde','vermelho','rosa','roxo','amarelo','laranja','padrão'];
const CORES_NEUTRAS = new Set(['branco','preto','cinzento','bege','castanho','azul-marinho']);
const COR_HEX = {
  'branco': '#f2f2ee', 'preto': '#1c1c1e', 'cinzento': '#8e8e97', 'bege': '#d9c7a3',
  'castanho': '#7a4f2c', 'azul': '#3b82f6', 'azul-marinho': '#1e3556', 'verde': '#3f9d5a',
  'vermelho': '#d1352c', 'rosa': '#ea86b6', 'roxo': '#8b5cf6', 'amarelo': '#f2c530',
  'laranja': '#f07020', 'padrão': 'url(#padraoTecido)',
};
const SLOT_NOMES = { top: 'Parte de cima', bottom: 'Parte de baixo', vestido: 'Vestido', casaco: 'Casaco', calcado: 'Calçado', acessorio: 'Acessório' };
const ESTACAO_EMOJI = { primavera: '🌸', verao: '☀️', outono: '🍂', inverno: '❄️' };
const FORMALIDADES = [
  { id: 0, nome: 'Casa',     emoji: '🏠' },
  { id: 1, nome: 'Casual',   emoji: '👟' },
  { id: 2, nome: 'Trabalho', emoji: '💼' },
  { id: 3, nome: 'Evento',   emoji: '🎩' },
];
const DIAS_SEMANA = ['Domingo','Segunda','Terça','Quarta','Quinta','Sexta','Sábado'];
const LIMIAR_NUCLEO = 0.5; // acima disto, uma combinação cima+baixo conta como "outfit válido"

const cat = id => CATEGORIAS.find(c => c.id === id) || CATEGORIAS[0];
const form = n => FORMALIDADES[Math.max(0, Math.min(3, n ?? 1))];
const hojeStr = () => dataStr(new Date());
const dataStr = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const hexDe = c => COR_HEX[c] || '#888';
const hexPlano = c => (COR_HEX[c] || '#888').startsWith('url') ? '#9a8f7a' : COR_HEX[c];

// ---------- Base de dados (IndexedDB) ----------
const CHAVES_STORE = { itens: 'id', outfits: 'id', historico: 'data', meta: null };

const DB = {
  db: null,
  abrir(nomeBD) {
    return new Promise((res, rej) => {
      const req = indexedDB.open(nomeBD || 'roupeiro', 2);
      req.onupgradeneeded = () => {
        const d = req.result;
        if (!d.objectStoreNames.contains('itens')) d.createObjectStore('itens', { keyPath: 'id' });
        if (!d.objectStoreNames.contains('outfits')) d.createObjectStore('outfits', { keyPath: 'id' });
        if (!d.objectStoreNames.contains('meta')) d.createObjectStore('meta');
        if (!d.objectStoreNames.contains('historico')) d.createObjectStore('historico', { keyPath: 'data' });
      };
      req.onsuccess = () => { DB.db = req.result; res(); };
      req.onerror = () => rej(req.error);
    });
  },
  fechar() { if (DB.db) { DB.db.close(); DB.db = null; } },

  op(store, modo, fn) {
    return new Promise((res, rej) => {
      const tx = DB.db.transaction(store, modo);
      const r = fn(tx.objectStore(store));
      tx.oncomplete = () => res(r && r.result !== undefined ? r.result : undefined);
      tx.onerror = () => rej(tx.error);
      tx.onabort = () => rej(tx.error);
    });
  },

  // ---------- cifra transparente ----------
  // Se o perfil tiver palavra-passe, o registo guardado no disco é
  // { id, _cif: {iv, ct} } — a chave primária fica em claro (o IndexedDB
  // precisa dela para indexar), tudo o resto vai cifrado.
  async embrulhar(store, valor) {
    if (!Perfis.chave) return valor;
    const pacote = await Cripto.cifrar(Perfis.chave, valor);
    const kp = CHAVES_STORE[store];
    if (!kp) return pacote;                       // 'meta': chave é externa
    return { [kp]: valor && valor[kp], _cif: pacote };
  },
  async desembrulhar(registo) {
    if (!registo || !registo._cif && !(registo.iv && registo.ct)) return registo;
    if (!Perfis.chave) throw new Error('BLOQUEADO');
    return Cripto.decifrar(Perfis.chave, registo._cif || registo);
  },

  async todos(s) {
    const brutos = await DB.op(s, 'readonly', st => st.getAll());
    // sempre pelo desembrulhar: se houver registos cifrados e não houver chave,
    // tem de ESTOIRAR. Devolver o cifrado em bruto faria a app regravá-lo por
    // cima do original e destruir os dados em silêncio.
    return Promise.all(brutos.map(r => DB.desembrulhar(r)));
  },
  async por(s, v, k) {
    const guardar = await DB.embrulhar(s, v);
    const r = await DB.op(s, 'readwrite', st => k !== undefined ? st.put(guardar, k) : st.put(guardar));
    if (k !== 'nuvemVersao') Nuvem.agendar();   // a própria marca de sync não conta como alteração
    return r;
  },
  async apagar(s, k) {
    const r = await DB.op(s, 'readwrite', st => st.delete(k));
    Nuvem.agendar();
    return r;
  },
  limpar: s => DB.op(s, 'readwrite', st => st.clear()),
  async metaGet(k) {
    const bruto = await DB.op('meta', 'readonly', st => st.get(k));
    return bruto === undefined ? undefined : DB.desembrulhar(bruto);
  },

  // ---------- usado ao mudar de palavra-passe e ao sincronizar ----------
  async exportarBruto() {
    return {
      itens: await DB.todos('itens'),
      outfits: await DB.todos('outfits'),
      historico: await DB.todos('historico'),
      meta: {
        gostos: await DB.metaGet('gostos'),
        hoje: await DB.metaGet('hoje'),
        semana: await DB.metaGet('semana'),
      },
    };
  },
  async importarBruto(d) {
    await DB.limpar('itens'); await DB.limpar('outfits'); await DB.limpar('historico');
    for (const i of (d.itens || [])) await DB.por('itens', i);
    for (const o of (d.outfits || [])) await DB.por('outfits', o);
    for (const h of (d.historico || [])) await DB.por('historico', h);
    const m = d.meta || {};
    await DB.por('meta', m.gostos || { scores: {}, pares: {} }, 'gostos');
    await DB.por('meta', m.hoje || null, 'hoje');
    await DB.por('meta', m.semana || null, 'semana');
  },
};

// ---------- Estado em memória ----------
let itens = [];
let outfits = [];
let historico = [];                    // [{ data, pecas:[ids], nome }]
let hoje = null;                       // { data, pecas: [ids] }
let semana = null;                     // { criado, dias:[{data, pecas:[ids]}] }
let gostos = { scores: {}, pares: {} };// aprendizagem do gerador
let outfitGerado = null;               // ids da última proposta do gerador
let razoesGeradas = [];                // explicação da última proposta
let editId = null;                     // peça em edição
let fotoAtual = null;                  // dataURL no modal de peça
let fotoOriginal = null;               // dataURL antes de recortar (só em memória)
let fotoRecortada = false;
let pickerSelecao = new Set();
let loteItens = [];                    // rascunhos do modal de lote
let calMes = new Date();               // mês visível no calendário

const $ = id => document.getElementById(id);
// ids opacos e sem colisões mesmo quando se guardam 20 peças no mesmo milissegundo
const novoId = prefixo => prefixo + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

// ---------- Arranque ----------
init();
async function init() {
  aplicarTema(localStorage.getItem('tema') || 'auto');
  preencherSelects();
  ligarEventos();
  ligarEventosConta();
  registarServiceWorker();
  vigiarMudancaDeDia();

  await Perfis.carregar();
  Nuvem.carregarCfg();
  const ultimo = await Perfis.configGet('ultimoPerfil');
  const candidato = Perfis.lista.find(p => p.id === ultimo) || Perfis.lista[0];

  // Entrar com conta é obrigatório — nunca se chega aos dados sem palavra-passe.
  mostrarEcraPerfis(candidato);
}

// Carrega os dados do perfil e liberta o ecrã.
async function entrarNoPerfil(perfil) {
  Perfis.atual = perfil;
  await Perfis.configPor(perfil.id, 'ultimoPerfil');
  DB.fechar();
  await DB.abrir(Perfis.nomeBD(perfil.id));
  await recarregarDados();

  $('ecraBloqueio').classList.remove('aberto');
  document.body.classList.remove('trancado');
  atualizarChipPerfil();
  renderTudo();

  // se outro dispositivo guardou algo mais recente, traz para cá (não bloqueia a entrada)
  Nuvem.puxarSeMaisRecente();
}

async function recarregarDados() {
  itens = (await DB.todos('itens')).map(normalizarItem);
  outfits = await DB.todos('outfits');
  historico = (await DB.todos('historico')).sort((a, b) => a.data.localeCompare(b.data));
  hoje = (await DB.metaGet('hoje')) || null;
  semana = (await DB.metaGet('semana')) || null;
  gostos = (await DB.metaGet('gostos')) || { scores: {}, pares: {} };
  if (hoje && hoje.data !== hojeStr()) { hoje = null; await DB.por('meta', null, 'hoje'); }
}

function trancarApp() {
  Perfis.trancar();
  DB.fechar();
  itens = []; outfits = []; historico = []; hoje = null; semana = null;
  gostos = { scores: {}, pares: {} };
  // trancar tem de apagar mesmo o que está no ecrã: a proposta do gerador e o
  // dia aberto no histórico ficavam visíveis por baixo do ecrã de bloqueio
  outfitGerado = null; razoesGeradas = [];
  $('geradorResultado').style.display = 'none';
  $('geradorErro').style.display = 'none';
  $('geradorManequim').innerHTML = '';
  $('hojeManequim').innerHTML = '';
  delete $('calDetalhe').dataset.escolhido;
  $('calDetalhe').innerHTML = '';
  ['lacunasResultado', 'capsulaResultado', 'malaResultado', 'lacunasOrfas'].forEach(id => $(id).innerHTML = '');
  document.querySelectorAll('.modal-overlay.aberto').forEach(esconderOverlay);
  renderTudo();
  mostrarEcraPerfis(null);
  toast('🔒 Trancado');
}

// garante que peças antigas ganham os campos novos sem rebentar
function normalizarItem(i) {
  const base = {
    formalidade: 1, usos: 0, ultimoUso: null, estacoes: [], recortada: false,
    preco: null, dataCompra: null, ...i,
  };
  // um backup à mão ou um campo em falta não pode rebentar o render inteiro
  base.nome = String(base.nome ?? 'Sem nome');
  base.categoria = CATEGORIAS.some(c => c.id === base.categoria) ? base.categoria : 'tshirt';
  base.cor = CORES.includes(base.cor) ? base.cor : 'branco';
  base.estado = base.estado === 'lavar' ? 'lavar' : 'disponivel';
  base.estacoes = Array.isArray(base.estacoes) ? base.estacoes.filter(e => e in ESTACAO_EMOJI) : [];
  base.formalidade = Math.max(0, Math.min(3, Number(base.formalidade) || 0));
  base.usos = Math.max(0, Number(base.usos) || 0);
  base.preco = base.preco == null || isNaN(Number(base.preco)) ? null : Number(base.preco);
  base.criado = base.criado || hojeStr();
  // peças antigas herdam a camada da categoria
  if (base.camada == null) base.camada = cat(base.categoria).camada ?? 0;
  return base;
}

function preencherSelects() {
  $('fCategoria').innerHTML = CATEGORIAS.map(c => `<option value="${c.id}">${c.emoji} ${c.nome}</option>`).join('');
  $('fCor').innerHTML = CORES.map(c => `<option value="${c}">${c}</option>`).join('');
  $('filtroCategoria').innerHTML = '<option value="">Todas as categorias</option>'
    + CATEGORIAS.map(c => `<option value="${c.id}">${c.emoji} ${c.nome}</option>`).join('');
  $('filtroFormalidade').innerHTML = '<option value="">Qualquer formalidade</option>'
    + FORMALIDADES.map(f => `<option value="${f.id}">${f.emoji} ${f.nome}</option>`).join('');

  const botoesForm = (extraQualquer) => (extraQualquer ? `<button class="btn-toggle active" data-f="">Qualquer</button>` : '')
    + FORMALIDADES.map(f => `<button type="button" class="btn-toggle" data-f="${f.id}">${f.emoji} ${f.nome}</button>`).join('');
  $('fFormalidade').innerHTML = botoesForm(false);
  $('fCamada').innerHTML = CAMADAS.map(c =>
    `<button type="button" class="btn-toggle" data-f="${c.id}" title="${c.desc}">${c.emoji} ${c.nome}</button>`).join('');
  $('geradorFormalidade').innerHTML = botoesForm(true);
  $('semanaFormalidade').innerHTML = botoesForm(true);
  $('malaFormalidade').innerHTML = botoesForm(true);
}

function renderTudo() {
  renderHoje();
  renderBiblioteca();
  renderOutfits();
  renderLavandaria();
  renderSemana();
  renderStats();
  renderCalendario();
}

// ---------- Tema ----------
function aplicarTema(t) {
  document.documentElement.dataset.tema = t;
  localStorage.setItem('tema', t);
  const escuro = t === 'escuro' || (t === 'auto' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  $('btnTema').textContent = escuro ? '☀️' : '🌙';
  const meta = document.querySelector('meta[name=theme-color]');
  if (meta) meta.content = escuro ? '#0b0b11' : '#f5f5fa';
  document.querySelectorAll('#temaOpcoes .btn-toggle').forEach(b => b.classList.toggle('active', b.dataset.tema === t));
}

// ---------- Navegação e eventos ----------
function ligarEventos() {
  document.querySelectorAll('.tab').forEach(t => t.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(x => x.classList.remove('active'));
    document.querySelectorAll('.view').forEach(x => x.classList.remove('active'));
    // a mesma vista existe nas tabs de topo e na barra inferior: marca as duas
    document.querySelectorAll(`.tab[data-view="${t.dataset.view}"]`).forEach(x => x.classList.add('active'));
    $('view-' + t.dataset.view).classList.add('active');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }));
  document.querySelectorAll('.subtab').forEach(t => t.addEventListener('click', () => {
    document.querySelectorAll('.subtab').forEach(x => x.classList.remove('active'));
    document.querySelectorAll('.subview').forEach(x => x.classList.remove('active'));
    t.classList.add('active');
    $('sub-' + t.dataset.sub).classList.add('active');
  }));

  // Tema
  $('btnTema').addEventListener('click', () => {
    const atual = document.documentElement.dataset.tema;
    const escuro = atual === 'escuro' || (atual === 'auto' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    aplicarTema(escuro ? 'claro' : 'escuro');
  });
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (document.documentElement.dataset.tema === 'auto') aplicarTema('auto');
  });

  // Definições
  $('btnDefinicoes').addEventListener('click', abrirDefinicoes);
  // o indicador da nuvem era um botão que não fazia nada
  $('estadoNuvem').addEventListener('click', abrirNuvem);
  $('btnDefFechar').addEventListener('click', () => fecharModal('modalDefinicoes'));
  $('btnExportar').addEventListener('click', exportarTudo);
  $('btnImportar').addEventListener('click', () => $('importInput').click());
  $('importInput').addEventListener('change', e => e.target.files[0] && importarBackup(e.target.files[0]));
  $('btnPersistir').addEventListener('click', pedirPersistencia);
  $('btnApagarTudo').addEventListener('click', apagarTudo);
  document.querySelectorAll('#temaOpcoes .btn-toggle').forEach(b =>
    b.addEventListener('click', () => aplicarTema(b.dataset.tema)));

  // Biblioteca
  $('btnAdicionar').addEventListener('click', () => abrirModalPeca(null));
  $('btnVazioAdicionar').addEventListener('click', () => abrirModalPeca(null));
  $('btnLote').addEventListener('click', abrirModalLote);
  $('btnVazioLote').addEventListener('click', abrirModalLote);
  $('pesquisa').addEventListener('input', renderBiblioteca);
  $('filtroCategoria').addEventListener('change', renderBiblioteca);
  $('filtroEstado').addEventListener('change', renderBiblioteca);
  $('filtroFormalidade').addEventListener('change', renderBiblioteca);
  $('btnLimparFiltros').addEventListener('click', limparFiltrosBiblioteca);

  // Modal peça
  $('btnPecaCancelar').addEventListener('click', () => fecharModal('modalPeca'));
  $('btnPecaGuardar').addEventListener('click', guardarPeca);
  $('fNome').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); guardarPeca(); } });
  $('oNome').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); guardarOutfitManual(); } });
  const zone = $('fotoZone');
  zone.addEventListener('click', e => { if (e.target.closest('input,button')) return; $('fotoInput').click(); });
  // os inputs vivem dentro da zona: sem isto, o clique programático na câmara
  // sobe até à zona e esta abre logo a seguir a galeria por cima
  $('fotoInput').addEventListener('click', e => e.stopPropagation());
  $('fotoCamara').addEventListener('click', e => e.stopPropagation());
  $('fotoInput').addEventListener('change', e => e.target.files[0] && carregarFoto(e.target.files[0]));
  // câmara: input separado com capture, usado só se o getUserMedia não existir
  $('fotoCamara').addEventListener('change', e => e.target.files[0] && carregarFoto(e.target.files[0]));
  $('btnTirarFoto').addEventListener('click', abrirCamara);
  $('btnCamaraDisparar').addEventListener('click', dispararCamara);
  $('btnCamaraTrocar').addEventListener('click', trocarLenteCamara);
  $('btnCamaraCancelar').addEventListener('click', fecharCamara);
  $('btnEscolherFoto').addEventListener('click', () => $('fotoInput').click());
  $('btnTrocarFoto').addEventListener('click', e => { e.stopPropagation(); $('fotoInput').click(); });
  zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('dragover'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('dragover'));
  zone.addEventListener('drop', e => {
    e.preventDefault(); zone.classList.remove('dragover');
    e.dataTransfer.files[0] && carregarFoto(e.dataTransfer.files[0]);
  });
  // colar (Ctrl+V) uma foto com o modal aberto
  document.addEventListener('paste', e => {
    if (!$('modalPeca').classList.contains('aberto')) return;
    const f = [...(e.clipboardData?.files || [])][0];
    if (f && f.type.startsWith('image/')) { e.preventDefault(); carregarFoto(f); }
  });
  $('btnRemoverFundo').addEventListener('click', aplicarRemocaoFundo);
  $('btnDetetarCor').addEventListener('click', () => detetarCorNoModal(true));
  $('btnReporFoto').addEventListener('click', reporFotoOriginal);
  $('fEstacoes').querySelectorAll('.btn-toggle').forEach(b =>
    b.addEventListener('click', () => b.classList.toggle('active')));
  ligarGrupoExclusivo('fFormalidade');
  ligarGrupoExclusivo('fCamada');
  $('fCor').addEventListener('change', () => $('fCorAmostra').style.background = hexPlano($('fCor').value));
  $('fCategoria').addEventListener('change', () => sincronizarCamada(true));

  // Lote
  const lz = $('loteZone');
  lz.addEventListener('click', e => { if (e.target.closest('input,button')) return; $('loteInput').click(); });
  $('loteInput').addEventListener('click', e => e.stopPropagation());
  $('loteInput').addEventListener('change', e => adicionarAoLote([...e.target.files]));
  lz.addEventListener('dragover', e => { e.preventDefault(); lz.classList.add('dragover'); });
  lz.addEventListener('dragleave', () => lz.classList.remove('dragover'));
  lz.addEventListener('drop', e => { e.preventDefault(); lz.classList.remove('dragover'); adicionarAoLote([...e.dataTransfer.files]); });
  $('btnLoteCancelar').addEventListener('click', () => fecharModal('modalLote'));
  $('btnLoteGuardar').addEventListener('click', guardarLote);

  // Detalhe
  $('btnDetalheFechar').addEventListener('click', () => fecharModal('modalDetalhe'));

  // Outfits
  $('btnNovoOutfit').addEventListener('click', abrirModalOutfit);
  $('btnOutfitCancelar').addEventListener('click', () => fecharModal('modalOutfit'));
  $('btnOutfitGuardar').addEventListener('click', guardarOutfitManual);

  // Gerador
  ligarGrupoExclusivo('geradorEstacao');
  ligarGrupoExclusivo('geradorFormalidade');
  $('btnGerar').addEventListener('click', () => gerarOutfit());
  $('btnGostei').addEventListener('click', () => aplicarFeedback('positivo'));
  $('btnNaoGostei').addEventListener('click', abrirFeedback);
  $('btnFeedbackCancelar').addEventListener('click', () => fecharModal('modalFeedback'));
  $('btnGuardarOutfit').addEventListener('click', guardarOutfitGerado);
  $('btnUsarHoje').addEventListener('click', usarGeradoHoje);

  // Hoje
  $('btnHojeGerar').addEventListener('click', () => { mudarTab('gerador'); gerarOutfit(); });
  $('btnHojeEscolher').addEventListener('click', abrirEscolherOutfit);
  $('btnEscolherCancelar').addEventListener('click', () => fecharModal('modalEscolherOutfit'));
  $('btnHojeUsado').addEventListener('click', marcarUsado);
  $('btnHojeTrocar').addEventListener('click', async () => {
    hoje = null; await DB.por('meta', null, 'hoje'); renderHoje();
  });

  // Semana
  ligarGrupoExclusivo('semanaFormalidade');
  $('btnGerarSemana').addEventListener('click', gerarSemana);
  $('btnLimparSemana').addEventListener('click', async () => {
    semana = null; await DB.por('meta', null, 'semana'); renderSemana(); toast('🗑️ Plano limpo');
  });

  // Análise
  $('calAnterior').addEventListener('click', () => { calMes.setMonth(calMes.getMonth() - 1); renderCalendario(); });
  $('calSeguinte').addEventListener('click', () => { calMes.setMonth(calMes.getMonth() + 1); renderCalendario(); });
  $('btnCalcularLacunas').addEventListener('click', renderLacunas);
  ligarGrupoExclusivo('capsulaAlvo');
  $('btnCalcularCapsula').addEventListener('click', renderCapsula);
  ligarGrupoExclusivo('malaEstacao');
  ligarGrupoExclusivo('malaFormalidade');
  $('btnCalcularMala').addEventListener('click', renderMala);

  // Lavandaria
  $('btnLavarTudo').addEventListener('click', lavarTudo);

  // fechar modais ao clicar fora / Esc
  document.querySelectorAll('.modal-overlay').forEach(m =>
    // "sem-fechar": passos obrigatórios (definir palavra-passe) não se fecham por engano
    m.addEventListener('click', e => {
      if (e.target === m && !m.classList.contains('sem-fechar')) esconderOverlay(m);
    }));
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') document.querySelectorAll('.modal-overlay.aberto:not(.sem-fechar)')
      .forEach(esconderOverlay);
  });
}

function ligarGrupoExclusivo(id) {
  const g = $(id);
  g.querySelectorAll('.btn-toggle').forEach(b => b.addEventListener('click', () => {
    g.querySelectorAll('.btn-toggle').forEach(x => x.classList.remove('active'));
    b.classList.add('active');
  }));
}
function valorGrupo(id) {
  const a = $(id).querySelector('.btn-toggle.active');
  return a ? (a.dataset.f ?? a.dataset.estacao ?? a.dataset.alvo ?? '') : '';
}

function mudarTab(nome) { document.querySelector(`.tab[data-view="${nome}"]`).click(); }
function abrirModal(id) { $(id).classList.add('aberto'); }
function fecharModal(id) { esconderOverlay($(id)); }

// fechar por Esc ou clique fora não pode deixar a câmara ligada
function esconderOverlay(m) {
  m.classList.remove('aberto');
  if (m.id === 'modalCamara') pararStream();
}

function toast(msg, aoAnular) {
  const t = $('toast');
  $('toastMsg').textContent = msg;
  t.classList.toggle('com-undo', !!aoAnular);
  $('toastUndo').onclick = aoAnular ? () => { t.classList.remove('visivel'); aoAnular(); } : null;
  t.classList.add('visivel');
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.remove('visivel'), aoAnular ? 6000 : 2600);
}

// ---------- PWA ----------
function registarServiceWorker() {
  if (!('serviceWorker' in navigator) || location.protocol === 'file:') return;
  navigator.serviceWorker.register('sw.js').catch(() => { /* offline não disponível, sem drama */ });
}

// ================================================================
//  FOTOS: compressão, cor dominante, remoção de fundo
// ================================================================
const FOTO_MAX = 800;

function tipoImagemSuportado() {
  const cv = document.createElement('canvas');
  return cv.toDataURL('image/webp').startsWith('data:image/webp') ? 'image/webp' : 'image/jpeg';
}
const TIPO_FOTO = tipoImagemSuportado();

function carregarImagem(src) {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = rej;
    img.src = src;
  });
}

// Redimensiona para no máximo 800px e comprime. Uma foto de telemóvel de 4 MB
// fica tipicamente com 40-90 KB — é a diferença entre caber 50 peças ou 2000.
async function comprimirFicheiro(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = await carregarImagem(url);
    const esc = Math.min(1, FOTO_MAX / Math.max(img.width, img.height));
    const cv = document.createElement('canvas');
    cv.width = Math.max(1, Math.round(img.width * esc));
    cv.height = Math.max(1, Math.round(img.height * esc));
    cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
    return cv.toDataURL(TIPO_FOTO, 0.82);
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function carregarFoto(file) {
  try {
    fotoAtual = await comprimirFicheiro(file);
    fotoOriginal = fotoAtual;
    fotoRecortada = false;
    mostrarFotoNoModal();
    await detetarCorNoModal(false);
  } catch {
    toast('⚠️ Não consegui ler essa imagem');
  }
}

// ---------- câmara ao vivo ----------
// O input com capture="environment" é ignorado no desktop (abre o seletor de
// ficheiros = "a galeria") e falha em várias WebViews. Quando há getUserMedia
// abrimos a câmara dentro da app; o input fica como plano B.
let camaraStream = null;
let camaraLente = 'environment';

function temGetUserMedia() {
  return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
}

async function abrirCamara() {
  if (!temGetUserMedia()) { $('fotoCamara').click(); return; }
  abrirModal('modalCamara');
  const ok = await ligarStream(camaraLente);
  if (!ok) { fecharCamara(); $('fotoCamara').click(); }
}

async function ligarStream(lente) {
  pararStream();
  const v = $('camaraVideo');
  try {
    camaraStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: lente }, width: { ideal: 1280 }, height: { ideal: 1280 } },
      audio: false,
    });
  } catch (err) {
    // permissão negada é do utilizador; o resto é falta de câmara/contexto inseguro
    toast(err && err.name === 'NotAllowedError'
      ? '🚫 Permissão da câmara negada'
      : '📷 Sem câmara disponível — escolhe uma foto');
    return false;
  }
  camaraLente = lente;
  v.srcObject = camaraStream;
  v.classList.toggle('espelhado', lente === 'user');
  try { await v.play(); } catch { /* alguns browsers já arrancaram sozinhos */ }
  return true;
}

function pararStream() {
  if (camaraStream) camaraStream.getTracks().forEach(t => t.stop());
  camaraStream = null;
  $('camaraVideo').srcObject = null;
}

function fecharCamara() {
  pararStream();
  fecharModal('modalCamara');
}

function trocarLenteCamara() {
  ligarStream(camaraLente === 'environment' ? 'user' : 'environment');
}

async function dispararCamara() {
  const v = $('camaraVideo');
  const w = v.videoWidth, h = v.videoHeight;
  if (!w || !h) { toast('⏳ A câmara ainda está a arrancar'); return; }
  const esc = Math.min(1, FOTO_MAX / Math.max(w, h));
  const cv = document.createElement('canvas');
  cv.width = Math.round(w * esc);
  cv.height = Math.round(h * esc);
  const ctx = cv.getContext('2d');
  if (camaraLente === 'user') { ctx.translate(cv.width, 0); ctx.scale(-1, 1); }  // desespelhar
  ctx.drawImage(v, 0, 0, cv.width, cv.height);
  fecharCamara();
  fotoAtual = cv.toDataURL(TIPO_FOTO, 0.82);
  fotoOriginal = fotoAtual;
  fotoRecortada = false;
  mostrarFotoNoModal();
  await detetarCorNoModal(false);
}

function mostrarFotoNoModal() {
  const tem = !!fotoAtual;
  $('fotoPreview').src = fotoAtual || '';
  $('fotoPreview').style.display = tem ? 'block' : 'none';
  $('fotoPlaceholder').style.display = tem ? 'none' : 'block';
  $('fotoFerramentas').style.display = tem ? 'flex' : 'none';
  $('btnTrocarFoto').style.display = tem ? 'grid' : 'none';
  $('btnTirarFoto').textContent = tem ? '📸 Repetir foto' : '📸 Tirar foto';
  $('btnEscolherFoto').textContent = tem ? '🖼️ Trocar imagem' : '🖼️ Escolher da galeria';
}

function reporFotoOriginal() {
  if (!fotoOriginal) return;
  fotoAtual = fotoOriginal;
  fotoRecortada = false;
  mostrarFotoNoModal();
  toast('↩️ Foto original reposta');
}

// --- Cor dominante ---
async function corDominanteDe(dataUrl, jaRecortada) {
  const img = await carregarImagem(dataUrl);
  const N = 72;
  const cv = document.createElement('canvas');
  cv.width = N; cv.height = N;
  const ctx = cv.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, N, N);
  const d = ctx.getImageData(0, 0, N, N).data;

  // agrupa em cubos de cor e conta; ignora margem (fundo) se a foto não foi recortada
  const margem = jaRecortada ? 0 : Math.round(N * 0.18);
  const baldes = new Map();
  for (let y = margem; y < N - margem; y++) {
    for (let x = margem; x < N - margem; x++) {
      const p = (y * N + x) * 4;
      if (d[p + 3] < 128) continue;                       // transparente = fundo removido
      const k = (d[p] >> 4) * 256 + (d[p + 1] >> 4) * 16 + (d[p + 2] >> 4);
      let b = baldes.get(k);
      if (!b) baldes.set(k, b = { n: 0, r: 0, g: 0, bl: 0 });
      b.n++; b.r += d[p]; b.g += d[p + 1]; b.bl += d[p + 2];
    }
  }
  if (!baldes.size) return null;
  let melhor = null;
  for (const b of baldes.values()) if (!melhor || b.n > melhor.n) melhor = b;
  const rgb = [Math.round(melhor.r / melhor.n), Math.round(melhor.g / melhor.n), Math.round(melhor.bl / melhor.n)];
  return { rgb, nome: nomeDaCor(rgb) };
}

function nomeDaCor([r, g, b]) {
  const max = Math.max(r, g, b) / 255, min = Math.min(r, g, b) / 255;
  const l = (max + min) / 2;
  const s = max === min ? 0 : (l > 0.5 ? (max - min) / (2 - max - min) : (max - min) / (max + min));

  // pouca saturação: é um neutro, decidido pela luminosidade
  if (s < 0.13) {
    if (l > 0.78) return 'branco';
    if (l > 0.32) return 'cinzento';
    return 'preto';
  }
  // castanho/bege: laranja escuro / laranja claro dessaturado
  const h = matiz(r, g, b);
  if (h >= 20 && h <= 50 && s < 0.55) return l > 0.62 ? 'bege' : 'castanho';
  if (h >= 15 && h <= 40 && l < 0.42) return 'castanho';
  if (h >= 200 && h <= 250 && l < 0.32) return 'azul-marinho';

  // resto: vizinho mais próximo entre as cores nomeadas
  let melhor = 'azul', dist = Infinity;
  for (const nome of CORES) {
    if (nome === 'padrão') continue;
    const hex = COR_HEX[nome];
    const rr = parseInt(hex.slice(1, 3), 16), gg = parseInt(hex.slice(3, 5), 16), bb = parseInt(hex.slice(5, 7), 16);
    const dm = (r + rr) / 2;
    const dr = r - rr, dg = g - gg, db = b - bb;
    const d2 = (2 + dm / 256) * dr * dr + 4 * dg * dg + (2 + (255 - dm) / 256) * db * db;
    if (d2 < dist) { dist = d2; melhor = nome; }
  }
  return melhor;
}
function matiz(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  if (!d) return 0;
  let h;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return (h * 60 + 360) % 360;
}

async function detetarCorNoModal(avisar) {
  if (!fotoAtual) { if (avisar) toast('⚠️ Adiciona uma foto primeiro'); return; }
  const c = await corDominanteDe(fotoAtual, fotoRecortada);
  if (!c) { if (avisar) toast('⚠️ Não consegui detetar a cor'); return; }
  $('fCor').value = c.nome;
  $('fCorAmostra').style.background = `rgb(${c.rgb.join(',')})`;
  if (avisar) toast(`🎨 Cor detetada: ${c.nome}`);
}

// --- Remoção de fundo (algoritmo local, sem rede nem bibliotecas) ---
// Preenchimento a partir das bordas: assume que o que toca no rebordo é fundo.
// Funciona muito bem com peças fotografadas em cima da cama, chão ou parede lisa.
async function removerFundo(dataUrl, tolerancia = 34) {
  const img = await carregarImagem(dataUrl);
  const w = img.width, h = img.height;
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const ctx = cv.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0);
  const imgData = ctx.getImageData(0, 0, w, h);
  const d = imgData.data;

  // cor de referência = média dos pixels do rebordo
  let sr = 0, sg = 0, sb = 0, n = 0;
  const amostraBorda = (x, y) => { const p = (y * w + x) * 4; sr += d[p]; sg += d[p + 1]; sb += d[p + 2]; n++; };
  for (let x = 0; x < w; x++) { amostraBorda(x, 0); amostraBorda(x, h - 1); }
  for (let y = 0; y < h; y++) { amostraBorda(0, y); amostraBorda(w - 1, y); }
  const ref = [sr / n, sg / n, sb / n];

  const tol2 = tolerancia * tolerancia * 3;
  const fundo = new Uint8Array(w * h);
  const fila = new Int32Array(w * h);
  let ini = 0, fim = 0;

  const perto = (i, alvo) => {
    const p = i * 4;
    const dr = d[p] - alvo[0], dg = d[p + 1] - alvo[1], db = d[p + 2] - alvo[2];
    return dr * dr + dg * dg + db * db < tol2;
  };
  const empurrar = i => { if (!fundo[i] && perto(i, ref)) { fundo[i] = 1; fila[fim++] = i; } };

  for (let x = 0; x < w; x++) { empurrar(x); empurrar((h - 1) * w + x); }
  for (let y = 0; y < h; y++) { empurrar(y * w); empurrar(y * w + w - 1); }

  // propaga comparando com o vizinho de onde veio (aguenta fundos com gradiente)
  while (ini < fim) {
    const i = fila[ini++];
    const x = i % w, y = (i / w) | 0;
    const p = i * 4;
    const local = [d[p], d[p + 1], d[p + 2]];
    const vizinhos = [];
    if (x > 0) vizinhos.push(i - 1);
    if (x < w - 1) vizinhos.push(i + 1);
    if (y > 0) vizinhos.push(i - w);
    if (y < h - 1) vizinhos.push(i + w);
    for (const v of vizinhos) {
      if (fundo[v]) continue;
      if (perto(v, ref) || perto(v, local)) { fundo[v] = 1; fila[fim++] = v; }
    }
  }

  // se "comeu" quase tudo, a foto não tem fundo liso — não vale a pena
  let removidos = 0;
  for (let i = 0; i < fundo.length; i++) if (fundo[i]) removidos++;
  if (removidos > fundo.length * 0.94 || removidos < fundo.length * 0.04) return null;

  // aplica com uma borda suave para não ficar recortado a tesoura
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const p = i * 4;
      if (fundo[i]) { d[p + 3] = 0; continue; }
      let vizinhosFundo = 0;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          if (fundo[ny * w + nx]) vizinhosFundo++;
        }
      if (vizinhosFundo) d[p + 3] = Math.max(60, 255 - vizinhosFundo * 34);
    }
  }
  ctx.putImageData(imgData, 0, 0);
  // WebP mantém transparência; PNG seria 5x maior
  return cv.toDataURL(TIPO_FOTO === 'image/webp' ? 'image/webp' : 'image/png', 0.85);
}

async function aplicarRemocaoFundo() {
  if (!fotoAtual) return;
  const btn = $('btnRemoverFundo');
  btn.disabled = true; btn.textContent = '⏳ A recortar...';
  try {
    const nova = await removerFundo(fotoOriginal || fotoAtual);
    if (!nova) { toast('😕 Fundo demasiado complexo. Tenta uma foto sobre uma superfície lisa.'); return; }
    fotoAtual = nova;
    fotoRecortada = true;
    mostrarFotoNoModal();
    await detetarCorNoModal(false);
    toast('✂️ Fundo removido — 100% local, nada foi enviado');
  } catch {
    toast('⚠️ Falhou a remoção de fundo');
  } finally {
    btn.disabled = false; btn.textContent = '✂️ Remover fundo';
  }
}

function fotoHtml(item, cls = 'peca-foto') {
  return item.foto
    ? `<div class="${cls}"><img src="${item.foto}" class="${item.recortada ? 'recortada' : ''}" alt="${esc(item.nome)}"></div>`
    : `<div class="${cls}">${cat(item.categoria).emoji}</div>`;
}

// ================================================================
//  MODAL ADICIONAR / EDITAR PEÇA
// ================================================================
function abrirModalPeca(id) {
  editId = id;
  fotoAtual = null; fotoOriginal = null; fotoRecortada = false;
  const it = id ? itens.find(x => x.id === id) : null;
  $('modalPecaTitulo').textContent = it ? 'Editar peça' : 'Adicionar peça';
  $('fNome').value = it ? it.nome : '';
  $('fCategoria').value = it ? it.categoria : 'tshirt';
  $('fCor').value = it ? it.cor : 'branco';
  $('fCorAmostra').style.background = hexPlano(it ? it.cor : 'branco');
  $('fDescricao').value = it ? (it.descricao || '') : '';
  $('fFavorito').checked = it ? !!it.favorito : false;
  $('fPreco').value = it && it.preco != null ? it.preco : '';
  $('fDataCompra').value = it && it.dataCompra ? it.dataCompra : '';
  $('fEstacoes').querySelectorAll('.btn-toggle').forEach(b =>
    b.classList.toggle('active', !!it && it.estacoes.includes(b.dataset.estacao)));
  const fSel = it ? it.formalidade : 1;
  $('fFormalidade').querySelectorAll('.btn-toggle').forEach(b =>
    b.classList.toggle('active', Number(b.dataset.f) === fSel));
  marcarCamada(it ? camadaDe(it) : cat($('fCategoria').value).camada ?? 0);
  sincronizarCamada(false);
  if (it && it.foto) { fotoAtual = it.foto; fotoOriginal = it.foto; fotoRecortada = !!it.recortada; }
  mostrarFotoNoModal();
  $('fotoInput').value = '';
  $('fotoCamara').value = '';
  abrirModal('modalPeca');
}

function marcarCamada(v) {
  $('fCamada').querySelectorAll('.btn-toggle').forEach(b =>
    b.classList.toggle('active', Number(b.dataset.f) === v));
}
// a camada só faz sentido nas peças de cima; ao trocar de categoria sugere o valor típico
function sincronizarCamada(reposicionar) {
  const c = cat($('fCategoria').value);
  $('linhaCamada').style.display = c.slot === 'top' ? 'flex' : 'none';
  if (reposicionar && c.slot === 'top') marcarCamada(c.camada ?? 0);
}

async function guardarPeca() {
  const nome = $('fNome').value.trim();
  if (!nome) { toast('⚠️ Dá um nome à peça'); return; }
  const estacoes = [...$('fEstacoes').querySelectorAll('.btn-toggle.active')].map(b => b.dataset.estacao);
  const original = editId ? itens.find(x => x.id === editId) : null;
  // a peça pode ter sido apagada noutro separador enquanto o modal estava aberto
  if (editId && !original) { toast('⚠️ Essa peça já não existe'); fecharModal('modalPeca'); editId = null; renderTudo(); return; }
  const base = original || {
    id: novoId('p'),
    estado: 'disponivel', usos: 0, ultimoUso: null, criado: hojeStr(),
  };
  const preco = parseFloat($('fPreco').value);
  const item = normalizarItem({
    ...base,
    nome,
    categoria: $('fCategoria').value,
    cor: $('fCor').value,
    formalidade: Number(valorGrupo('fFormalidade') || 1),
    camada: cat($('fCategoria').value).slot === 'top' ? Number(valorGrupo('fCamada') || 0) : (cat($('fCategoria').value).camada ?? 0),
    estacoes,
    descricao: $('fDescricao').value.trim(),
    favorito: $('fFavorito').checked,
    preco: isNaN(preco) ? null : preco,
    dataCompra: $('fDataCompra').value || null,
    foto: fotoAtual,
    recortada: fotoRecortada,
  });
  if (!await guardarSeguro('itens', item)) return;
  if (editId) itens = itens.map(x => x.id === editId ? item : x);
  else itens.push(item);
  fecharModal('modalPeca');
  toast(editId ? '✔ Peça atualizada' : '✔ Peça adicionada ao roupeiro');
  renderTudo();
}

// grava avisando em condições se o disco encher
async function guardarSeguro(store, valor, chave) {
  try {
    await DB.por(store, valor, chave);
    return true;
  } catch (e) {
    if (e && (e.name === 'QuotaExceededError' || String(e).includes('quota')))
      toast('⚠️ Sem espaço! Exporta um backup e apaga peças antigas.');
    else toast('⚠️ Não consegui guardar: ' + (e && e.name ? e.name : 'erro'));
    return false;
  }
}

// ================================================================
//  ADICIONAR EM LOTE
// ================================================================
function abrirModalLote() {
  loteItens = [];
  $('loteLista').innerHTML = '';
  $('loteInput').value = '';
  atualizarContagemLote();
  abrirModal('modalLote');
}

async function adicionarAoLote(ficheiros) {
  const imagens = ficheiros.filter(f => f.type.startsWith('image/'));
  if (!imagens.length) return;
  toast(`⏳ A processar ${imagens.length} foto(s)...`);
  for (const f of imagens) {
    try {
      const foto = await comprimirFicheiro(f);
      const c = await corDominanteDe(foto, false);
      loteItens.push({
        uid: 'l' + Math.random().toString(36).slice(2),
        foto,
        nome: f.name.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ').slice(0, 40),
        categoria: 'tshirt',
        cor: c ? c.nome : 'branco',
      });
    } catch { /* ignora ficheiros ilegíveis */ }
  }
  renderLote();
  toast(`✔ ${imagens.length} foto(s) prontas — confirma os dados`);
}

function renderLote() {
  $('loteLista').innerHTML = loteItens.map(l => `
    <div class="lote-item" data-uid="${l.uid}">
      <div class="lote-thumb"><img src="${l.foto}"></div>
      <div class="lote-campos">
        <input type="text" data-campo="nome" value="${esc(l.nome)}" placeholder="Nome">
        <select data-campo="categoria">${CATEGORIAS.map(c => `<option value="${c.id}" ${c.id === l.categoria ? 'selected' : ''}>${c.emoji} ${c.nome}</option>`).join('')}</select>
        <select data-campo="cor">${CORES.map(c => `<option value="${c}" ${c === l.cor ? 'selected' : ''}>${c}</option>`).join('')}</select>
      </div>
      <button class="lote-remover" data-uid="${l.uid}" title="Remover">✕</button>
    </div>`).join('');

  $('loteLista').querySelectorAll('.lote-item').forEach(el => {
    const l = loteItens.find(x => x.uid === el.dataset.uid);
    el.querySelectorAll('[data-campo]').forEach(inp =>
      inp.addEventListener('input', () => { l[inp.dataset.campo] = inp.value; }));
  });
  $('loteLista').querySelectorAll('.lote-remover').forEach(b =>
    b.addEventListener('click', () => {
      loteItens = loteItens.filter(x => x.uid !== b.dataset.uid);
      renderLote();
    }));
  atualizarContagemLote();
}
function atualizarContagemLote() {
  $('loteContagem').textContent = loteItens.length ? `${loteItens.length} peça(s) a guardar` : '';
}

async function guardarLote() {
  if (!loteItens.length) { toast('⚠️ Escolhe pelo menos uma foto'); return; }
  let n = 0;
  for (const l of loteItens) {
    const nome = (l.nome || '').trim() || `${cat(l.categoria).nome} ${l.cor}`;
    const item = normalizarItem({
      id: novoId('p'),
      nome, categoria: l.categoria, cor: l.cor,
      formalidade: 1, estacoes: [], descricao: '', favorito: false,
      foto: l.foto, recortada: false,
      estado: 'disponivel', usos: 0, ultimoUso: null, criado: hojeStr(),
    });
    if (!await guardarSeguro('itens', item)) break;
    itens.push(item);
    n++;
  }
  fecharModal('modalLote');
  toast(`✔ ${n} peça(s) adicionadas ao roupeiro`);
  renderTudo();
}

// ================================================================
//  BIBLIOTECA E DETALHE
// ================================================================
function renderBiblioteca() {
  const q = $('pesquisa').value.toLowerCase();
  const fc = $('filtroCategoria').value;
  const fe = $('filtroEstado').value;
  const ff = $('filtroFormalidade').value;
  const lista = itens.filter(i =>
    (!q || i.nome.toLowerCase().includes(q) || (i.descricao || '').toLowerCase().includes(q) || i.cor.includes(q)) &&
    (!fc || i.categoria === fc) &&
    (!fe || i.estado === fe) &&
    (ff === '' || i.formalidade === Number(ff))
  );
  $('bibliotecaVazia').style.display = itens.length ? 'none' : 'block';
  // roupeiro cheio mas filtros a não devolver nada: sem isto a grelha ficava
  // simplesmente em branco e parecia que as peças tinham desaparecido
  const semResultados = itens.length > 0 && lista.length === 0;
  $('bibliotecaSemResultados').style.display = semResultados ? 'block' : 'none';
  $('bibliotecaContagem').textContent = itens.length
    ? (lista.length === itens.length ? `${itens.length} peça(s)` : `${lista.length} de ${itens.length} peça(s)`)
    : '';
  $('gridBiblioteca').innerHTML = lista.map(cardPeca).join('');
  ligarCards('gridBiblioteca');
}

function limparFiltrosBiblioteca() {
  $('pesquisa').value = '';
  $('filtroCategoria').value = '';
  $('filtroEstado').value = '';
  $('filtroFormalidade').value = '';
  renderBiblioteca();
}

function cardPeca(i) {
  return `<div class="peca-card" data-id="${i.id}">
    ${i.favorito ? '<span class="peca-fav">⭐</span>' : ''}
    ${i.estado === 'lavar' ? '<span class="peca-estado">🧺 a lavar</span>' : ''}
    ${fotoHtml(i)}
    <div class="peca-info">
      <div class="peca-nome">${esc(i.nome)}</div>
      <div class="peca-cat">${cat(i.categoria).nome} · ${esc(i.cor)} · ${form(i.formalidade).emoji}</div>
    </div>
  </div>`;
}
function ligarCards(containerId) {
  $(containerId).querySelectorAll('.peca-card').forEach(c =>
    c.addEventListener('click', () => abrirDetalhe(c.dataset.id)));
}

function abrirDetalhe(id) {
  const i = itens.find(x => x.id === id);
  if (!i) return;
  const foto = $('dFoto');
  if (i.foto) { foto.src = i.foto; foto.style.display = 'block'; }
  else { foto.style.display = 'none'; }
  $('dNome').textContent = (i.favorito ? '⭐ ' : '') + i.nome;
  $('dChips').innerHTML = [
    `<span class="chip">${cat(i.categoria).emoji} ${cat(i.categoria).nome}</span>`,
    `<span class="chip"><span class="swatch" style="background:${hexPlano(i.cor)}"></span> ${esc(i.cor)}</span>`,
    `<span class="chip">${form(i.formalidade).emoji} ${form(i.formalidade).nome}</span>`,
    ...i.estacoes.map(e => `<span class="chip">${ESTACAO_EMOJI[e]} ${e}</span>`),
    `<span class="chip">${i.estado === 'lavar' ? '🧺 A lavar' : '✅ Disponível'}</span>`,
  ].join('');
  $('dDescricao').textContent = i.descricao || 'Sem descrição.';

  const linhas = [`Usada ${i.usos || 0}× · ${i.ultimoUso ? 'Último uso: ' + i.ultimoUso : 'Nunca usada'} · Adicionada em ${i.criado}`];
  if (i.preco != null) {
    const cpu = i.usos > 0 ? (i.preco / i.usos) : null;
    linhas.push(`Custo: ${i.preco.toFixed(2)} € · ${cpu != null ? `${cpu.toFixed(2)} € por uso` : 'ainda sem custo por uso (0 usos)'}`);
  }
  $('dStats').innerHTML = linhas.map(esc).join('<br>');

  const btnEstado = $('btnDetalheEstado');
  btnEstado.textContent = i.estado === 'lavar' ? '✅ Marcar como lavada' : '🧺 Enviar para lavar';
  // se a gravação falhar (disco cheio), desfaz a alteração em memória —
  // senão o ecrã mostrava um estado que a base de dados não tem
  btnEstado.onclick = async () => {
    const antes = i.estado;
    i.estado = antes === 'lavar' ? 'disponivel' : 'lavar';
    if (!await guardarSeguro('itens', i)) { i.estado = antes; return; }
    fecharModal('modalDetalhe');
    toast(i.estado === 'lavar' ? '🧺 Enviada para a lavandaria' : '✨ Peça limpa e disponível');
    renderTudo();
  };
  const btnFav = $('btnDetalheFavorito');
  btnFav.textContent = i.favorito ? '☆ Tirar favorito' : '⭐ Favorito';
  btnFav.onclick = async () => {
    i.favorito = !i.favorito;
    if (!await guardarSeguro('itens', i)) { i.favorito = !i.favorito; return; }
    abrirDetalhe(id);
    renderBiblioteca();
  };
  $('btnDetalheEditar').onclick = () => { fecharModal('modalDetalhe'); abrirModalPeca(id); };
  $('btnDetalheEliminar').onclick = () => eliminarPeca(i);
  abrirModal('modalDetalhe');
}

async function eliminarPeca(i) {
  const copia = { ...i };
  const outfitsAfetados = outfits.filter(o => o.pecas.includes(i.id)).map(o => ({ id: o.id, pecas: [...o.pecas] }));
  await DB.apagar('itens', i.id);
  itens = itens.filter(x => x.id !== i.id);
  for (const o of outfits) {
    if (o.pecas.includes(i.id)) {
      o.pecas = o.pecas.filter(p => p !== i.id);
      await DB.por('outfits', o);
    }
  }
  fecharModal('modalDetalhe');
  renderTudo();
  toast(`🗑️ "${i.nome}" eliminada`, async () => {
    await DB.por('itens', copia);
    itens.push(copia);
    for (const a of outfitsAfetados) {
      const o = outfits.find(x => x.id === a.id);
      if (o) { o.pecas = a.pecas; await DB.por('outfits', o); }
    }
    renderTudo();
    toast('↩️ Peça reposta');
  });
}

// ================================================================
//  OUTFITS GUARDADOS
// ================================================================
function renderOutfits() {
  $('outfitsVazio').style.display = outfits.length ? 'none' : 'block';
  $('listaOutfits').innerHTML = outfits.map(o => `
    <div class="outfit-card">
      <div class="outfit-card-header">
        <h4>${esc(o.nome)}</h4>
        <button class="btn btn-primary btn-sm" data-acao="hoje" data-id="${o.id}">📅 Usar hoje</button>
        <button class="btn btn-danger btn-sm" data-acao="apagar" data-id="${o.id}">🗑️</button>
      </div>
      <div class="outfit-thumbs">${thumbsHtml(o.pecas)}</div>
    </div>`).join('');
  $('listaOutfits').querySelectorAll('button').forEach(b => b.addEventListener('click', async () => {
    const o = outfits.find(x => x.id === b.dataset.id);
    if (!o) return;
    if (b.dataset.acao === 'apagar') {
      const copia = { ...o, pecas: [...o.pecas] };
      await DB.apagar('outfits', o.id);
      outfits = outfits.filter(x => x.id !== o.id);
      renderOutfits();
      toast(`🗑️ Outfit "${o.nome}" apagado`, async () => {
        await DB.por('outfits', copia); outfits.push(copia); renderOutfits(); toast('↩️ Outfit reposto');
      });
    } else {
      definirHoje(o.pecas.filter(pid => itens.some(x => x.id === pid)), o.nome);
    }
  }));
}

function thumbsHtml(ids) {
  return ids.map(pid => {
    const i = itens.find(x => x.id === pid);
    if (!i) return '';
    const aLavar = i.estado === 'lavar';
    return `<div class="outfit-thumb" title="${esc(i.nome)}${aLavar ? ' (a lavar!)' : ''}" style="${aLavar ? 'opacity:.4' : ''}">${
      i.foto ? `<img src="${i.foto}" class="${i.recortada ? 'recortada' : ''}">` : cat(i.categoria).emoji}</div>`;
  }).join('');
}

function abrirModalOutfit(preSelecao) {
  if (!itens.length) { toast('⚠️ Adiciona peças à biblioteca primeiro'); return; }
  pickerSelecao = new Set((preSelecao || []).filter(id => itens.some(i => i.id === id)));
  $('modalOutfitTitulo').textContent = preSelecao ? 'Guardar este outfit' : 'Criar outfit';
  $('oNome').value = '';
  $('oNome').placeholder = 'Ex: Casual sexta-feira';
  // as peças já escolhidas aparecem primeiro: com 200 peças no roupeiro,
  // ninguém quer procurar as 4 que o gerador acabou de sugerir
  const ordenados = preSelecao
    ? [...itens].sort((a, b) => pickerSelecao.has(b.id) - pickerSelecao.has(a.id))
    : itens;
  $('gridPicker').innerHTML = ordenados.map(cardPeca).join('');
  $('gridPicker').querySelectorAll('.peca-card').forEach(c => {
    c.classList.toggle('selecionada', pickerSelecao.has(c.dataset.id));
    c.addEventListener('click', () => {
      const id = c.dataset.id;
      if (pickerSelecao.has(id)) { pickerSelecao.delete(id); c.classList.remove('selecionada'); }
      else { pickerSelecao.add(id); c.classList.add('selecionada'); }
    });
  });
  abrirModal('modalOutfit');
}

async function guardarOutfitManual() {
  if (pickerSelecao.size < 2) { toast('⚠️ Escolhe pelo menos 2 peças'); return; }
  const o = {
    id: novoId('o'),
    nome: $('oNome').value.trim() || 'Outfit ' + (outfits.length + 1),
    pecas: [...pickerSelecao],
    criado: hojeStr(),
  };
  await DB.por('outfits', o);
  outfits.push(o);
  fecharModal('modalOutfit');
  toast('💾 Outfit guardado');
  renderOutfits();
}

// ================================================================
//  O BONECO (manequim com setas)
// ================================================================
// Em vez de pintar partes do corpo, desenha peças de roupa por cima de uma
// silhueta neutra — camadas incluídas, na ordem certa. As cores são as reais.

const mistura = (hex, alvo, f) => {
  if (!hex || hex[0] !== '#') return hex;
  const n = p => parseInt(hex.slice(p, p + 2), 16);
  const m = (c, a) => Math.round(c + (a - c) * f).toString(16).padStart(2, '0');
  return '#' + m(n(1), alvo[0]) + m(n(3), alvo[1]) + m(n(5), alvo[2]);
};
const clarear = (hex, f = 0.22) => mistura(hex, [255, 255, 255], f);
const escurecer = (hex, f = 0.2) => mistura(hex, [0, 0, 0], f);

// cada peça ganha um gradiente próprio para não ficar um chapado sem volume
function gradientePeca(id, cor) {
  const hex = COR_HEX[cor];
  if (!hex || hex.startsWith('url')) return { def: '', fill: 'url(#padraoTecido)' };
  return {
    def: `<linearGradient id="g-${id}" x1="0" y1="0" x2="0.75" y2="1">
      <stop offset="0" stop-color="${clarear(hex, 0.26)}"/>
      <stop offset="0.55" stop-color="${hex}"/>
      <stop offset="1" stop-color="${escurecer(hex, 0.24)}"/>
    </linearGradient>`,
    fill: `url(#g-${id})`,
  };
}

// mangas desenhadas como traços grossos e arredondados: fica croqui, não boneco de palitos
const MANGA = {
  curta: { esq: 'M74,104 C64,110 58,122 55,136', dir: 'M126,104 C136,110 142,122 145,136', w: 17 },
  longa: { esq: 'M74,104 C60,112 52,132 48,158 L44,196', dir: 'M126,104 C140,112 148,132 152,158 L156,196', w: 16 },
};

function svgManequim(porSlot) {
  const defs = [];
  const fillDe = (slot, id) => {
    const p = porSlot[slot];
    if (!p) return null;
    const g = gradientePeca(id, p.cor);
    if (g.def) defs.push(g.def);
    return g.fill;
  };

  const fTop = fillDe('top', 'top');
  const fTop2 = fillDe('top2', 'top2');
  const fBottom = fillDe('bottom', 'bottom');
  const fVestido = fillDe('vestido', 'vestido');
  const fCasaco = fillDe('casaco', 'casaco');
  const fCalcado = fillDe('calcado', 'calcado');
  const fAcessorio = fillDe('acessorio', 'acessorio');

  const mangaDe = slot => MANGA[cat(porSlot[slot].categoria).manga || 'longa'];
  const desenharMangas = (slot, fill, largura) => {
    const m = mangaDe(slot);
    const w = largura || m.w;
    return `<path d="${m.esq}" fill="none" stroke="${fill}" stroke-width="${w}" stroke-linecap="round"/>
            <path d="${m.dir}" fill="none" stroke="${fill}" stroke-width="${w}" stroke-linecap="round"/>`;
  };

  // ---- peça de baixo: muda de forma conforme calças / calções / saia ----
  let bottomSvg = '';
  if (fBottom) {
    const c = cat(porSlot.bottom.categoria).id;
    const anca = `<path d="M70,200 L130,200 L128,252 L72,252 Z" fill="${fBottom}"/>`;
    if (c === 'saia') {
      bottomSvg = `<path d="M70,202 L130,202 L146,318 L54,318 Z" fill="${fBottom}"/>`;
    } else {
      const fim = c === 'calcoes' ? 296 : 408;
      bottomSvg = anca
        + `<path d="M87,246 C85,300 83,${fim - 60} 82,${fim}" fill="none" stroke="${fBottom}" stroke-width="27" stroke-linecap="round"/>`
        + `<path d="M113,246 C115,300 117,${fim - 60} 118,${fim}" fill="none" stroke="${fBottom}" stroke-width="27" stroke-linecap="round"/>`;
    }
  }

  return `<svg viewBox="0 0 200 500" role="img" aria-label="boneco vestido com o outfit escolhido">
    <defs>
      <pattern id="padraoTecido" width="9" height="9" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
        <rect width="9" height="9" fill="#9a8f7a"/>
        <line x1="0" y1="0" x2="0" y2="9" stroke="#6f6858" stroke-width="3.5"/>
      </pattern>
      <linearGradient id="g-corpo" x1="0" y1="0" x2="0.8" y2="1">
        <stop offset="0" stop-color="var(--manequim-claro)"/>
        <stop offset="1" stop-color="var(--manequim)"/>
      </linearGradient>
      ${defs.join('')}
    </defs>

    <ellipse cx="100" cy="470" rx="54" ry="8" fill="rgba(0,0,0,.16)"/>

    <!-- ================= CORPO ================= -->
    <g class="mq-corpo" fill="url(#g-corpo)" stroke="none">
      <ellipse cx="100" cy="48" rx="25" ry="29"/>
      <path d="M92,72 h16 v22 h-16 z"/>
      <path d="M72,94 Q100,86 128,94 L132,150 Q134,186 126,214 L74,214 Q66,186 68,150 Z"/>
    </g>
    <path d="M74,100 C60,108 52,130 48,156 L44,196" fill="none" stroke="url(#g-corpo)" stroke-width="13" stroke-linecap="round"/>
    <path d="M126,100 C140,108 148,130 152,156 L156,196" fill="none" stroke="url(#g-corpo)" stroke-width="13" stroke-linecap="round"/>
    <path d="M88,212 C86,280 84,350 83,412" fill="none" stroke="url(#g-corpo)" stroke-width="21" stroke-linecap="round"/>
    <path d="M112,212 C114,280 116,350 117,412" fill="none" stroke="url(#g-corpo)" stroke-width="21" stroke-linecap="round"/>

    <!-- ================= ROUPA ================= -->
    <g class="mq-parte">${bottomSvg}</g>

    ${fTop ? `<g class="mq-parte">
      <path d="M71,95 Q100,86 129,95 L133,132 Q135,172 129,204 Q100,211 71,204 Q65,172 67,132 Z" fill="${fTop}"/>
      ${desenharMangas('top', fTop)}
      <path d="M88,90 Q100,102 112,90" fill="none" stroke="rgba(0,0,0,.18)" stroke-width="2.5"/>
    </g>` : ''}

    ${fTop2 ? `<g class="mq-parte">
      <path d="M70,94 Q82,88 93,93 L89,207 Q78,207 70,204 Q64,170 66,131 Z" fill="${fTop2}"/>
      <path d="M130,94 Q118,88 107,93 L111,207 Q122,207 130,204 Q136,170 134,131 Z" fill="${fTop2}"/>
      ${desenharMangas('top2', fTop2, 18)}
    </g>` : ''}

    ${fVestido ? `<g class="mq-parte">
      <path d="M71,95 Q100,86 129,95 L136,152 Q148,240 154,326 L46,326 Q52,240 64,152 Z" fill="${fVestido}"/>
      ${desenharMangas('vestido', fVestido, 14)}
    </g>` : ''}

    ${fCasaco ? `<g class="mq-parte">
      <path d="M67,92 Q81,84 94,90 L90,248 Q76,248 66,243 Q58,180 63,128 Z" fill="${fCasaco}"/>
      <path d="M133,92 Q119,84 106,90 L110,248 Q124,248 134,243 Q142,180 137,128 Z" fill="${fCasaco}"/>
      <path d="M67,92 Q84,96 92,116 L82,120 Z" fill="${escurecer(COR_HEX[porSlot.casaco.cor] || '#888', 0.3)}"/>
      <path d="M133,92 Q116,96 108,116 L118,120 Z" fill="${escurecer(COR_HEX[porSlot.casaco.cor] || '#888', 0.3)}"/>
      ${desenharMangas('casaco', fCasaco, 20)}
    </g>` : ''}

    ${fCalcado ? `<g class="mq-parte">
      <path d="M72,410 q12,0 13,14 l1,10 q-16,4 -26,0 l0,-12 q0,-12 12,-12 z" fill="${fCalcado}"/>
      <path d="M128,410 q-12,0 -13,14 l-1,10 q16,4 26,0 l0,-12 q0,-12 -12,-12 z" fill="${fCalcado}"/>
    </g>` : ''}

    ${fAcessorio ? `<g class="mq-parte">
      <path d="M77,32 Q100,2 123,32 Z" fill="${fAcessorio}"/>
      <rect x="68" y="30" width="64" height="9" rx="4.5" fill="${fAcessorio}"/>
      <path d="M123,30 q22,2 24,10 l-24,0 z" fill="${escurecer(COR_HEX[porSlot.acessorio.cor] || '#888', 0.25)}"/>
    </g>` : ''}
  </svg>`;
}

// alturas (px) a que cada seta encosta ao corpo, num contentor de 540px
const ANCORAS = {
  acessorio: { lado: 'esq', top: 26 },
  casaco:    { lado: 'esq', top: 170 },
  calcado:   { lado: 'esq', top: 380 },
  top:       { lado: 'dir', top: 116 },
  top2:      { lado: 'dir', top: 214 },
  vestido:   { lado: 'dir', top: 190 },
  bottom:    { lado: 'dir', top: 312 },
};
const NOME_SLOT_MQ = { ...SLOT_NOMES, top: 'Base', top2: 'Por cima' };

// distribui as peças pelos lugares do boneco; a de cima com camada mais alta vai para 'top2'
function distribuirSlots(pecas) {
  const porSlot = {};
  const extras = [];
  const tops = pecas.filter(p => cat(p.categoria).slot === 'top')
    .sort((a, b) => camadaDe(a) - camadaDe(b));
  if (tops[0]) porSlot.top = tops[0];
  if (tops[1]) porSlot.top2 = tops[1];
  extras.push(...tops.slice(2));

  for (const p of pecas) {
    const s = cat(p.categoria).slot;
    if (s === 'top') continue;
    if (porSlot[s]) extras.push(p); else porSlot[s] = p;
  }
  return { porSlot, extras };
}

function renderManequim(containerId, pecas) {
  const { porSlot, extras } = distribuirSlots(pecas);

  const cartao = (p, rotulo) => `
    <div class="mq-card ${p.estado === 'lavar' ? 'a-lavar' : ''}" data-id="${p.id}" title="${esc(p.nome)}">
      <div class="mq-slot-nome">${rotulo}</div>
      <div class="mq-img">${p.foto ? `<img src="${p.foto}" class="${p.recortada ? 'recortada' : ''}" alt="${esc(p.nome)}">` : cat(p.categoria).emoji}</div>
      <div class="mq-nome">${esc(p.nome)}</div>
    </div>`;

  const slots = Object.entries(ANCORAS)
    .filter(([slot]) => porSlot[slot])
    .map(([slot, a], n) =>
      `<div class="mq-slot ${a.lado}" style="top:${a.top}px;animation-delay:${n * 55}ms">
         ${cartao(porSlot[slot], NOME_SLOT_MQ[slot])}<div class="mq-linha"></div>
       </div>`).join('');

  $(containerId).innerHTML = `<div class="manequim">
    <div class="mq-figura">${svgManequim(porSlot)}</div>
    ${slots}
  </div>${extras.length ? `<div class="mq-extras">
    <span class="mq-extras-rot">+ também</span>
    ${extras.map(p => `<button class="mq-extra" data-id="${p.id}">${cat(p.categoria).emoji} ${esc(p.nome)}</button>`).join('')}
  </div>` : ''}`;

  $(containerId).querySelectorAll('[data-id]').forEach(c =>
    c.addEventListener('click', () => abrirDetalhe(c.dataset.id)));
}

// ================================================================
//  GERADOR
// ================================================================
function pesoItem(i) {
  const s = gostos.scores[i.id] || 0;
  let p = 1 + (i.favorito ? 1.2 : 0) + s * 0.6;
  // penaliza o que foi usado há pouco: evita a mesma t-shirt 3x por semana
  const dias = diasDesdeUso(i);
  if (dias !== null && dias < 7) p -= (7 - dias) * 0.22;
  return Math.max(0.15, p);
}
function diasDesdeUso(i) {
  if (!i.ultimoUso) return null;
  const d = Math.floor((Date.now() - new Date(i.ultimoUso + 'T12:00:00').getTime()) / 86400000);
  return isNaN(d) ? null : d;
}

// Média por par, não soma: senão um outfit de 5 peças (10 pares) ganhava sempre
// a um de 3 (3 pares) só por ter mais combinações a somar.
function harmoniaCores(pecas) {
  let pts = 0, pares = 0;
  for (let a = 0; a < pecas.length; a++)
    for (let b = a + 1; b < pecas.length; b++) {
      const c1 = pecas[a].cor, c2 = pecas[b].cor;
      if (c1 === c2 && !CORES_NEUTRAS.has(c1)) pts -= 0.5;              // duas peças fortes da mesma cor
      else if (CORES_NEUTRAS.has(c1) || CORES_NEUTRAS.has(c2)) pts += 1; // neutros combinam com tudo
      const par = [c1, c2].sort().join('|');
      pts += (gostos.pares[par] || 0) * 0.8;                            // gostos aprendidos
      pares++;
    }
  return pares ? pts / pares : 0;
}

// peças de registos muito diferentes não combinam (fato de treino + blazer)
function coerenciaFormal(pecas) {
  if (pecas.length < 2) return 0;
  const fs = pecas.map(p => p.formalidade);
  return -(Math.max(...fs) - Math.min(...fs)) * 0.6;
}

function pontuarConjunto(pecas) {
  return harmoniaCores(pecas) + coerenciaFormal(pecas);
}

// Quantas camadas fazem sentido para a estação. É isto que decide se levas
// só t-shirt ou t-shirt + sweat + casaco.
const CAMADAS_IDEAIS = { verao: 1, primavera: 1.5, outono: 2.2, inverno: 3, '': 1.8 };
function contarCamadas(pecas) {
  return pecas.filter(p => cat(p.categoria).slot === 'top').length
    + (pecas.some(p => cat(p.categoria).slot === 'casaco') ? 1 : 0);
}
function adequacaoTermica(pecas, estacao) {
  if (pecas.some(p => cat(p.categoria).slot === 'vestido')) return 0;
  return -Math.abs(contarCamadas(pecas) - (CAMADAS_IDEAIS[estacao] ?? 1.8)) * 0.9;
}

function escolherPonderado(lista) {
  const total = lista.reduce((a, i) => a + pesoItem(i), 0);
  let r = Math.random() * total;
  for (const i of lista) { r -= pesoItem(i); if (r <= 0) return i; }
  return lista[lista.length - 1];
}

function poolDisponivel({ estacao = '', formalidade = '', excluir = new Set(), incluirSujos = false } = {}) {
  return itens.filter(i =>
    (incluirSujos || i.estado === 'disponivel') &&
    !excluir.has(i.id) &&
    (!estacao || !i.estacoes.length || i.estacoes.includes(estacao)) &&
    (formalidade === '' || Math.abs(i.formalidade - Number(formalidade)) <= 1)
  );
}

function comporOutfit(pool, opts = {}) {
  const { estacao = '', tentativas = 14 } = opts;
  const porSlot = s => pool.filter(i => cat(i.categoria).slot === s);
  const tops = porSlot('top'), bottoms = porSlot('bottom'), vestidos = porSlot('vestido');
  const sapatos = porSlot('calcado'), casacos = porSlot('casaco'), acessorios = porSlot('acessorio');

  const podeVestido = vestidos.length > 0;
  const podeConjunto = tops.length > 0 && bottoms.length > 0;
  if (!podeVestido && !podeConjunto) return null;

  // quanto mais frio, mais camadas: uma sweat por cima da t-shirt
  const PROB_CAMADA = { verao: 0.05, primavera: 0.3, outono: 0.55, inverno: 0.8, '': 0.35 };

  let melhor = null, melhorPts = -Infinity;
  for (let n = 0; n < tentativas; n++) {
    const pecas = [];
    const usarVestido = podeVestido && (!podeConjunto || Math.random() < 0.3);
    if (usarVestido) pecas.push(escolherPonderado(vestidos));
    else {
      const base = escolherPonderado(tops);
      pecas.push(base);
      // segunda camada: só peças pensadas para ir por cima desta
      const porCima = tops.filter(t => t.id !== base.id && camadaDe(t) > camadaDe(base));
      if (porCima.length && Math.random() < (PROB_CAMADA[estacao] ?? 0.35))
        pecas.push(escolherPonderado(porCima));
      pecas.push(escolherPonderado(bottoms));
    }
    if (sapatos.length) pecas.push(escolherPonderado(sapatos));
    const friorento = !estacao || estacao === 'outono' || estacao === 'inverno';
    if (casacos.length && friorento && Math.random() < (estacao === 'inverno' ? 0.95 : 0.55))
      pecas.push(escolherPonderado(casacos));
    if (acessorios.length && Math.random() < 0.45) pecas.push(escolherPonderado(acessorios));

    // média e não soma: senão um outfit com mais peças ganhava sempre,
    // e o gerador vestia-te com tudo o que houvesse no armário
    const pts = pontuarConjunto(pecas)
      + pecas.reduce((a, i) => a + pesoItem(i), 0) / pecas.length
      + adequacaoTermica(pecas, estacao)
      + Math.random() * 0.4;
    if (pts > melhorPts) { melhorPts = pts; melhor = pecas; }
  }
  return { pecas: melhor, pontos: melhorPts };
}

function gerarOutfit() {
  const estacao = valorGrupo('geradorEstacao');
  const formalidade = valorGrupo('geradorFormalidade');
  const pool = poolDisponivel({ estacao, formalidade });
  const r = comporOutfit(pool, { estacao });

  if (!r) {
    $('geradorResultado').style.display = 'none';
    $('geradorErro').style.display = 'block';
    $('geradorErroMsg').textContent = 'Não há peças disponíveis suficientes (preciso de parte de cima + baixo, ou um vestido). Verifica a lavandaria e os filtros de estação/ocasião!';
    return;
  }

  outfitGerado = r.pecas.map(i => i.id);
  razoesGeradas = explicarEscolha(r.pecas, { estacao, formalidade, pool });
  $('geradorErro').style.display = 'none';
  $('geradorResultado').style.display = 'block';
  renderManequim('geradorManequim', r.pecas);
  $('geradorExplicacao').innerHTML = `<h4>Porque é que escolhi isto</h4><ul>${razoesGeradas.map(x => `<li>${x}</li>`).join('')}</ul>`;
}

// Um gerador que não explica é um dado de 6 faces com boas intenções.
function explicarEscolha(pecas, { estacao, formalidade, pool }) {
  const razoes = [];
  const cores = pecas.map(p => p.cor);
  const neutras = cores.filter(c => CORES_NEUTRAS.has(c));

  razoes.push(`Escolhi entre <b>${pool.length}</b> peças disponíveis${estacao ? ` de ${estacao}` : ''}${formalidade !== '' ? `, com registo <b>${form(Number(formalidade)).nome.toLowerCase()}</b>` : ''}.`);

  if (neutras.length >= 2)
    razoes.push(`<b>${neutras.length}</b> peças neutras (${neutras.join(', ')}) — dão base segura ao conjunto.`);
  else if (neutras.length === 0)
    razoes.push(`Nenhuma peça neutra: é um conjunto arrojado. Se não resultar, diz 👎 na cor.`);

  // pares aprendidos que pesaram
  const paresBons = [];
  for (let a = 0; a < pecas.length; a++)
    for (let b = a + 1; b < pecas.length; b++) {
      const k = [pecas[a].cor, pecas[b].cor].sort().join('|');
      const v = gostos.pares[k] || 0;
      if (v > 0.4) paresBons.push(k.replace('|', ' + '));
    }
  if (paresBons.length)
    razoes.push(`Já deste 👍 antes a <b>${[...new Set(paresBons)].join('</b>, <b>')}</b> — repeti a fórmula.`);

  const tops = pecas.filter(p => cat(p.categoria).slot === 'top').sort((a, b) => camadaDe(a) - camadaDe(b));
  if (tops.length > 1)
    razoes.push(`Sobrepus <b>${esc(tops[1].nome)}</b> por cima de <b>${esc(tops[0].nome)}</b> — ${
      estacao === 'inverno' || estacao === 'outono' ? 'está frio, pede camadas' : 'dá profundidade ao conjunto'}.`);
  const nCamadas = contarCamadas(pecas);
  if (nCamadas && !pecas.some(p => cat(p.categoria).slot === 'vestido'))
    razoes.push(`<b>${nCamadas} camada(s)</b> — o que faz sentido${estacao ? ` para ${estacao}` : ' para meia estação'}.`);

  const favs = pecas.filter(p => p.favorito);
  if (favs.length) razoes.push(`Inclui ${favs.length} favorita(s): <b>${favs.map(f => esc(f.nome)).join(', ')}</b>.`);

  const paradas = pecas.map(p => ({ p, d: diasDesdeUso(p) })).filter(x => x.d === null || x.d > 21);
  if (paradas.length)
    razoes.push(`Dei prioridade a <b>${esc(paradas[0].p.nome)}</b> — ${paradas[0].d === null ? 'nunca a usaste' : `parada há ${paradas[0].d} dias`}.`);

  const recentes = pecas.map(p => ({ p, d: diasDesdeUso(p) })).filter(x => x.d !== null && x.d < 7);
  if (recentes.length)
    razoes.push(`⚠️ <b>${esc(recentes[0].p.nome)}</b> foi usada há ${recentes[0].d} dia(s) — tentei evitar, mas não havia melhor alternativa.`);

  const fs = pecas.map(p => p.formalidade);
  const spread = Math.max(...fs) - Math.min(...fs);
  if (spread === 0) razoes.push(`Todas as peças são do mesmo registo (<b>${form(fs[0]).nome}</b>) — conjunto coerente.`);
  else if (spread >= 2) razoes.push(`⚠️ Mistura de registos (${form(Math.min(...fs)).nome} até ${form(Math.max(...fs)).nome}). Pode resultar, mas é arriscado.`);

  const sujas = pecas.filter(p => p.estado === 'lavar');
  if (sujas.length) razoes.push(`⚠️ ${sujas.length} peça(s) estão na lavandaria.`);

  return razoes;
}

// ---------- Feedback rico ----------
function abrirFeedback() {
  if (!outfitGerado) return;
  const pecas = outfitGerado.map(id => itens.find(x => x.id === id)).filter(Boolean);
  const cores = [...new Set(pecas.map(p => p.cor))];
  const opcoes = [
    { tipo: 'conjunto', txt: '🤷 O conjunto todo', sub: 'Penaliza levemente as peças e a combinação de cores.' },
    ...pecas.map(p => ({ tipo: 'peca', id: p.id, txt: `👕 A peça: ${p.nome}`, sub: 'Só esta peça leva com o castigo. As outras ficam intactas.' })),
  ];
  if (cores.length > 1)
    opcoes.push({ tipo: 'cor', txt: `🎨 A combinação de cores: ${cores.join(' + ')}`, sub: 'Marca este par de cores como incompatível, mas poupa as peças.' });

  $('feedbackOpcoes').innerHTML = opcoes.map((o, n) =>
    `<button class="feedback-opcao" data-n="${n}">${esc(o.txt)}<small>${esc(o.sub)}</small></button>`).join('');
  $('feedbackOpcoes').querySelectorAll('.feedback-opcao').forEach(b =>
    b.addEventListener('click', () => {
      fecharModal('modalFeedback');
      aplicarFeedback('negativo', opcoes[Number(b.dataset.n)]);
    }));
  abrirModal('modalFeedback');
}

async function aplicarFeedback(sinal, detalhe) {
  if (!outfitGerado) return;
  const pecas = outfitGerado.map(id => itens.find(x => x.id === id)).filter(Boolean);
  const marcarPar = (a, b, v) => {
    const k = [a.cor, b.cor].sort().join('|');
    gostos.pares[k] = (gostos.pares[k] || 0) + v;
  };

  if (sinal === 'positivo') {
    for (const i of pecas) gostos.scores[i.id] = (gostos.scores[i.id] || 0) + 1;
    for (let a = 0; a < pecas.length; a++)
      for (let b = a + 1; b < pecas.length; b++) marcarPar(pecas[a], pecas[b], 0.5);
    toast('👍 Boa! Vou sugerir mais combinações assim.');
  } else if (detalhe.tipo === 'peca') {
    gostos.scores[detalhe.id] = (gostos.scores[detalhe.id] || 0) - 1.5;
    const p = itens.find(x => x.id === detalhe.id);
    toast(`👎 Anotado: vou usar menos "${p ? p.nome : 'essa peça'}".`);
  } else if (detalhe.tipo === 'cor') {
    for (let a = 0; a < pecas.length; a++)
      for (let b = a + 1; b < pecas.length; b++)
        if (pecas[a].cor !== pecas[b].cor) marcarPar(pecas[a], pecas[b], -1);
    toast('👎 Anotado: essas cores não voltam a andar juntas.');
  } else {
    for (const i of pecas) gostos.scores[i.id] = (gostos.scores[i.id] || 0) - 0.6;
    for (let a = 0; a < pecas.length; a++)
      for (let b = a + 1; b < pecas.length; b++) marcarPar(pecas[a], pecas[b], -0.8);
    toast('👎 Anotado, vou evitar conjuntos assim.');
  }

  await DB.por('meta', gostos, 'gostos');
  if (sinal === 'negativo') gerarOutfit();
}

// Abre o mesmo modal de criação, já com as peças sugeridas marcadas: dá para
// trocar uma peça antes de guardar, em vez de aceitar a proposta às cegas.
// (o prompt() nativo não deixava editar nada e é bloqueado em várias WebViews)
function guardarOutfitGerado() {
  if (!outfitGerado) return;
  abrirModalOutfit(outfitGerado);
}

function usarGeradoHoje() {
  if (!outfitGerado) return;
  definirHoje([...outfitGerado]);
}

// ================================================================
//  HOJE + HISTÓRICO
// ================================================================
async function definirHoje(pecasIds, nome) {
  hoje = { data: hojeStr(), pecas: pecasIds, nome: nome || null };
  await DB.por('meta', hoje, 'hoje');
  fecharModal('modalEscolherOutfit');
  mudarTab('hoje');
  renderHoje();
  const aLavar = pecasIds.map(id => itens.find(x => x.id === id)).filter(i => i && i.estado === 'lavar');
  toast(aLavar.length ? `📅 Definido! ⚠️ Atenção: ${aLavar.length} peça(s) estão na lavandaria.` : '📅 Outfit de hoje definido!');
}

function renderHoje() {
  $('hojeData').textContent = new Date().toLocaleDateString('pt-PT', { weekday: 'long', day: 'numeric', month: 'long' });
  // se todas as peças do outfit foram apagadas entretanto, não há outfit nenhum
  // — mostrar um boneco nu com o botão "usei este" seria pior que não mostrar nada
  const pecas = (hoje && Array.isArray(hoje.pecas) ? hoje.pecas : [])
    .map(id => itens.find(x => x.id === id)).filter(Boolean);
  const tem = pecas.length > 0;
  $('hojeVazio').style.display = tem ? 'none' : 'block';
  $('hojeOutfit').style.display = tem ? 'block' : 'none';
  $('hojeNome').textContent = tem && hoje.nome ? hoje.nome : '';
  if (!tem) { $('hojeManequim').innerHTML = ''; return; }
  renderManequim('hojeManequim', pecas);
}

// A app fica aberta no telemóvel durante dias. Sem isto, às 3 da manhã
// continuava a mostrar o outfit de ontem como sendo o de hoje.
function vigiarMudancaDeDia() {
  let dia = hojeStr();
  setInterval(async () => {
    if (hojeStr() === dia) return;
    dia = hojeStr();
    if (hoje && hoje.data !== dia) {
      hoje = null;
      if (DB.db) await DB.por('meta', null, 'hoje');   // com a app trancada não há base aberta
    }
    renderHoje();
    renderSemana();
    renderCalendario();
  }, 60000);
}

function abrirEscolherOutfit() {
  if (!outfits.length) { toast('⚠️ Ainda não tens outfits guardados — usa o gerador!'); return; }
  $('listaEscolherOutfit').innerHTML = outfits.map(o => `
    <div class="outfit-card">
      <div class="outfit-card-header">
        <h4>${esc(o.nome)}</h4>
        <button class="btn btn-primary btn-sm" data-id="${o.id}">Escolher</button>
      </div>
      <div class="outfit-thumbs">${thumbsHtml(o.pecas)}</div>
    </div>`).join('');
  $('listaEscolherOutfit').querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
    const o = outfits.find(x => x.id === b.dataset.id);
    definirHoje(o.pecas.filter(pid => itens.some(x => x.id === pid)), o.nome);
  }));
  abrirModal('modalEscolherOutfit');
}

async function marcarUsado() {
  if (!hoje || !hoje.pecas || !hoje.pecas.length) return;
  // só as peças que ainda existem: registar ids fantasma sujava o histórico
  const usadas = hoje.pecas.filter(id => itens.some(x => x.id === id));
  if (!usadas.length) { toast('⚠️ As peças deste outfit já não existem'); return; }
  const registo = { data: hoje.data, pecas: usadas, nome: hoje.nome || null };
  if (!await guardarSeguro('historico', registo)) return;
  historico = historico.filter(h => h.data !== registo.data).concat(registo).sort((a, b) => a.data.localeCompare(b.data));

  for (const id of usadas) {
    const i = itens.find(x => x.id === id);
    if (!i) continue;
    i.usos = (i.usos || 0) + 1;
    i.ultimoUso = hoje.data;
    if (cat(i.categoria).slot !== 'calcado' && cat(i.categoria).slot !== 'acessorio')
      i.estado = 'lavar'; // sapatos e acessórios não vão para a máquina
    await guardarSeguro('itens', i);
  }
  hoje = null;
  await DB.por('meta', null, 'hoje');
  toast('🧺 Registado no histórico e enviado para a lavandaria!');
  renderTudo();
}

// ---------- Calendário ----------
function renderCalendario() {
  const ano = calMes.getFullYear(), mes = calMes.getMonth();
  $('calTitulo').textContent = calMes.toLocaleDateString('pt-PT', { month: 'long', year: 'numeric' });
  const primeiro = new Date(ano, mes, 1).getDay();
  const dias = new Date(ano, mes + 1, 0).getDate();
  const hj = hojeStr();

  let html = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'].map(d => `<div class="cal-cabecalho">${d}</div>`).join('');
  for (let i = 0; i < primeiro; i++) html += '<div class="cal-dia vazio"></div>';
  for (let d = 1; d <= dias; d++) {
    const data = `${ano}-${String(mes + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const reg = historico.find(h => h.data === data);
    const pontos = reg ? reg.pecas.slice(0, 4).map(pid => {
      const i = itens.find(x => x.id === pid);
      return i ? `<span class="cal-ponto" style="background:${hexPlano(i.cor)}"></span>` : '';
    }).join('') : '';
    html += `<div class="cal-dia ${reg ? 'usado' : ''} ${data === hj ? 'hoje' : ''}" data-data="${data}">
      <span>${d}</span>${pontos ? `<span class="cal-cores">${pontos}</span>` : ''}</div>`;
  }
  $('calendario').innerHTML = html;
  $('calendario').querySelectorAll('.cal-dia.usado').forEach(c =>
    c.addEventListener('click', () => mostrarDiaHistorico(c.dataset.data)));

  if (!historico.length) {
    $('calDetalhe').innerHTML = `<div class="empty-state"><div class="icon">🕘</div>
      <p>Ainda sem histórico. Sempre que carregares em "Usei este outfit", o dia fica registado aqui.</p></div>`;
  } else if (!$('calDetalhe').dataset.escolhido) {
    const ultimo = historico[historico.length - 1];
    mostrarDiaHistorico(ultimo.data);
  }
}

function mostrarDiaHistorico(data) {
  const reg = historico.find(h => h.data === data);
  if (!reg) return;
  const pecas = reg.pecas.map(id => itens.find(x => x.id === id)).filter(Boolean);
  const apagadas = reg.pecas.length - pecas.length;
  $('calDetalhe').dataset.escolhido = data;
  $('calDetalhe').innerHTML = `<div class="painel">
    <div class="outfit-card-header">
      <h4>${new Date(data + 'T12:00:00').toLocaleDateString('pt-PT', { weekday: 'long', day: 'numeric', month: 'long' })}${reg.nome ? ' · ' + esc(reg.nome) : ''}</h4>
      <button class="btn btn-secondary btn-sm" id="btnRepetirDia">🔁 Repetir hoje</button>
    </div>
    <div class="outfit-thumbs">${thumbsHtml(reg.pecas)}</div>
    ${apagadas ? `<p class="hint" style="margin-top:10px">${apagadas} peça(s) deste dia já não existem no roupeiro.</p>` : ''}
  </div>`;
  const btn = $('btnRepetirDia');
  if (btn) btn.addEventListener('click', () => definirHoje(pecas.map(p => p.id), reg.nome));
}

// ================================================================
//  PLANEADOR DA SEMANA
// ================================================================
async function gerarSemana() {
  const formalidade = valorGrupo('semanaFormalidade');
  const usadas = new Set();
  const dias = [];
  const base = new Date();

  for (let d = 0; d < 7; d++) {
    const data = new Date(base);
    data.setDate(base.getDate() + d);
    // tenta sem repetir; se o roupeiro for pequeno, liberta as peças já usadas
    let r = comporOutfit(poolDisponivel({ formalidade, excluir: usadas, incluirSujos: true }), { tentativas: 12 });
    let repetiu = false;
    if (!r) {
      r = comporOutfit(poolDisponivel({ formalidade, incluirSujos: true }), { tentativas: 12 });
      repetiu = true;
    }
    if (!r) {
      toast('⚠️ Peças insuficientes: preciso de pelo menos uma parte de cima e uma de baixo.');
      return;
    }
    // calçado e acessórios repetem-se sem problema; o resto é que não deve repetir
    for (const p of r.pecas) {
      const s = cat(p.categoria).slot;
      if (s !== 'calcado' && s !== 'acessorio') usadas.add(p.id);
    }
    dias.push({ data: dataStr(data), pecas: r.pecas.map(p => p.id), repetiu });
  }

  semana = { criado: hojeStr(), dias };
  await DB.por('meta', semana, 'semana');
  renderSemana();
  const repetidos = dias.filter(d => d.repetiu).length;
  toast(repetidos ? `📆 Semana planeada (${repetidos} dia(s) tiveram de repetir peças)` : '📆 Semana planeada sem repetir uma única peça!');
}

function renderSemana() {
  const tem = semana && semana.dias && semana.dias.length;
  $('semanaVazia').style.display = tem ? 'none' : 'block';
  if (!tem) { $('semanaGrid').innerHTML = ''; return; }
  const hj = hojeStr();
  $('semanaGrid').innerHTML = semana.dias.map(d => {
    const dt = new Date(d.data + 'T12:00:00');
    return `<div class="dia-card ${d.data === hj ? 'dia-hoje' : ''}">
      <h4>${DIAS_SEMANA[dt.getDay()]}</h4>
      <div class="dia-data">${dt.toLocaleDateString('pt-PT', { day: 'numeric', month: 'short' })}${d.repetiu ? ' · ♻️ repete peças' : ''}</div>
      <div class="outfit-thumbs">${thumbsHtml(d.pecas)}</div>
      <button class="btn btn-secondary btn-sm" data-data="${d.data}">📅 Usar este</button>
    </div>`;
  }).join('');
  $('semanaGrid').querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
    const d = semana.dias.find(x => x.data === b.dataset.data);
    definirHoje(d.pecas.filter(pid => itens.some(x => x.id === pid)));
  }));
}

// ================================================================
//  ESTATÍSTICAS
// ================================================================
function renderStats() {
  const total = itens.length;
  const disp = itens.filter(i => i.estado === 'disponivel').length;
  const nunca = itens.filter(i => !i.usos).length;
  const usosTotais = itens.reduce((a, i) => a + (i.usos || 0), 0);
  const comPreco = itens.filter(i => i.preco != null);
  const valor = comPreco.reduce((a, i) => a + i.preco, 0);
  const gastoMorto = comPreco.filter(i => !i.usos).reduce((a, i) => a + i.preco, 0);
  const nucleos = calcularNucleos(itens);

  const cards = [
    { v: total, r: 'peças no roupeiro', n: `${disp} disponíveis, ${total - disp} na lavandaria` },
    { v: nucleos.length, r: 'combinações válidas', n: 'pares cima+baixo que fazem sentido' },
    { v: usosTotais, r: 'usos registados', n: `${historico.length} dias no histórico` },
    { v: nunca, r: 'peças nunca usadas', n: total ? `${Math.round(nunca / total * 100)}% do roupeiro` : '' },
  ];
  if (comPreco.length) {
    const cpuMedio = usosTotais ? valor / usosTotais : null;
    cards.push({ v: `${valor.toFixed(0)} €`, r: 'valor declarado', n: `${comPreco.length} de ${total} peças com preço` });
    cards.push({ v: cpuMedio != null ? `${cpuMedio.toFixed(2)} €` : '—', r: 'custo médio por uso', n: 'quanto menor, melhor a compra' });
    if (gastoMorto > 0) cards.push({ v: `${gastoMorto.toFixed(0)} €`, r: 'parados sem uso', n: 'peças com preço que nunca vestiste' });
  }
  $('statsCards').innerHTML = cards.map(c =>
    `<div class="stat-card"><div class="valor">${c.v}</div><div class="rotulo">${c.r}</div>${c.n ? `<div class="nota">${c.n}</div>` : ''}</div>`).join('');

  // cores
  const porCor = {};
  for (const i of itens) porCor[i.cor] = (porCor[i.cor] || 0) + 1;
  $('statsCores').innerHTML = barras(Object.entries(porCor).sort((a, b) => b[1] - a[1]),
    total, ([c]) => `<span class="swatch" style="background:${hexPlano(c)}"></span> ${c}`, hexPlano);

  // categorias
  const porCat = {};
  for (const i of itens) porCat[i.categoria] = (porCat[i.categoria] || 0) + 1;
  $('statsCategorias').innerHTML = barras(Object.entries(porCat).sort((a, b) => b[1] - a[1]),
    total, ([c]) => `${cat(c).emoji} ${cat(c).nome}`);

  // custo por uso
  const cpu = comPreco.map(i => ({ i, v: i.usos ? i.preco / i.usos : null }))
    .sort((a, b) => (a.v === null ? 1e9 : a.v) - (b.v === null ? 1e9 : b.v));
  $('statsCusto').innerHTML = cpu.length ? cpu.map(({ i, v }) => {
    const cls = v === null ? 'mau' : v < 2 ? 'bom' : v < 10 ? 'medio' : 'mau';
    return `<div class="linha-stat" data-id="${i.id}">
      <span class="swatch" style="background:${hexPlano(i.cor)}"></span>
      <span class="ls-nome">${esc(i.nome)}</span>
      <span class="hint" style="margin:0">${i.usos || 0} usos · ${i.preco.toFixed(2)} €</span>
      <span class="ls-valor ${cls}">${v === null ? 'nunca usada' : v.toFixed(2) + ' €/uso'}</span>
    </div>`;
  }).join('') : '<p class="hint">Nenhuma peça tem preço preenchido ainda.</p>';
  $('statsCusto').querySelectorAll('.linha-stat').forEach(l =>
    l.addEventListener('click', () => abrirDetalhe(l.dataset.id)));

  // adormecidas
  const adormecidas = itens
    .map(i => ({ i, d: diasDesdeUso(i) }))
    .filter(x => x.d === null || x.d > 60)
    .sort((a, b) => (b.d ?? 9999) - (a.d ?? 9999))
    .slice(0, 12);
  $('statsAdormecidas').innerHTML = adormecidas.length
    ? adormecidas.map(x => cardPeca(x.i)).join('')
    : '<p class="hint">Nada adormecido — usas tudo o que tens. Raro e bom.</p>';
  ligarCards('statsAdormecidas');
}

function barras(pares, total, rotulo, corFn) {
  const max = Math.max(1, ...pares.map(p => p[1]));
  return pares.map(p => `<div class="barra-linha">
    <div class="barra-nome">${rotulo(p)}</div>
    <div class="barra-track"><div class="barra-fill" style="width:${p[1] / max * 100}%${corFn ? `;background:${corFn(p[0])}` : ''}"></div></div>
    <div class="barra-valor">${p[1]} · ${Math.round(p[1] / total * 100)}%</div>
  </div>`).join('');
}

// ================================================================
//  O ROUPEIRO CONTRAFACTUAL
// ================================================================
// Núcleo = a espinha de um outfit: (cima + baixo) ou (vestido).
// Tudo o resto (sapatos, casaco, acessórios) acompanha, não define.
function calcularNucleos(pool) {
  const tops = pool.filter(i => cat(i.categoria).slot === 'top');
  const bottoms = pool.filter(i => cat(i.categoria).slot === 'bottom');
  const nucleos = [];
  for (const t of tops)
    for (const b of bottoms) {
      const pts = pontuarConjunto([t, b]);
      if (pts > LIMIAR_NUCLEO) nucleos.push({ a: t, b, pts });
    }
  for (const v of pool.filter(i => cat(i.categoria).slot === 'vestido'))
    nucleos.push({ a: v, b: null, pts: 1.5 });
  return nucleos;
}

// A chave de "tipo" é o que impede o 10.º casaco preto de parecer uma boa ideia.
const chaveTipo = p => `${cat(p.categoria).slot}:${p.cor}:${p.formalidade}`;
const chaveNucleoTipo = (a, b) => [chaveTipo(a), b ? chaveTipo(b) : '-'].join('||');

function analisarLacunas() {
  const pool = itens;
  const tops = pool.filter(i => cat(i.categoria).slot === 'top');
  const bottoms = pool.filter(i => cat(i.categoria).slot === 'bottom');

  // tipos de núcleo que já consegues fazer
  const existentes = new Set();
  for (const n of calcularNucleos(pool)) existentes.add(chaveNucleoTipo(n.a, n.b));
  const baseTotal = existentes.size;

  // peças-fantasma: cada combinação plausível de categoria × cor × formalidade
  const candidatos = [];
  for (const c of CATEGORIAS) {
    if (!['top', 'bottom'].includes(c.slot)) continue;
    for (const cor of CORES) {
      if (cor === 'padrão') continue;
      for (const f of FORMALIDADES) {
        const fantasma = { id: '__fantasma', nome: `${c.nome} ${cor}`, categoria: c.id, cor, formalidade: f.id, favorito: false, estacoes: [], usos: 0, ultimoUso: null };
        // já tens uma peça exatamente deste tipo? então o ganho real é quase nulo
        const jaTens = pool.filter(p => chaveTipo(p) === chaveTipo(fantasma)).length;
        const parceiros = c.slot === 'top' ? bottoms : tops;

        const novos = new Set();
        for (const p of parceiros) {
          if (pontuarConjunto([fantasma, p]) <= LIMIAR_NUCLEO) continue;
          const k = c.slot === 'top' ? chaveNucleoTipo(fantasma, p) : chaveNucleoTipo(p, fantasma);
          if (!existentes.has(k)) novos.add(k);
        }
        if (novos.size) candidatos.push({ categoria: c, cor, formalidade: f.id, ganho: novos.size, jaTens });
      }
    }
  }

  candidatos.sort((a, b) => b.ganho - a.ganho || a.jaTens - b.jaTens);

  // peças órfãs: não entram em nenhum núcleo válido
  const emNucleo = new Set();
  for (const n of calcularNucleos(pool)) { emNucleo.add(n.a.id); if (n.b) emNucleo.add(n.b.id); }
  const orfas = pool.filter(p => ['top', 'bottom'].includes(cat(p.categoria).slot) && !emNucleo.has(p.id));

  return { candidatos, baseTotal, orfas, temSapatos: pool.some(p => cat(p.categoria).slot === 'calcado') };
}

function renderLacunas() {
  if (itens.length < 4) {
    $('lacunasResultado').innerHTML = '<p class="hint">Precisas de pelo menos 4 peças (algumas de cima e algumas de baixo) para isto dizer alguma coisa útil.</p>';
    return;
  }
  const { candidatos, baseTotal, orfas, temSapatos } = analisarLacunas();
  $('lacunasBase').textContent = `Base atual: ${baseTotal} tipos de combinação distintos.`;

  const top = candidatos.filter(c => c.jaTens === 0).slice(0, 8);
  const redundantes = candidatos.filter(c => c.jaTens > 0).slice(0, 3);

  let html = '';
  if (!top.length) {
    html += `<div class="painel painel-destaque">🎉 <b>Não te falta nada.</b> Nenhuma peça nova desbloquearia combinações
      que ainda não consegues fazer. O teu problema não é o que não tens — é usares o que já tens.</div>`;
  } else {
    html += `<div class="painel painel-destaque">A peça que mais te falta é
      <b>${top[0].categoria.nome.toLowerCase()} ${top[0].cor}</b> (${form(top[0].formalidade).nome.toLowerCase()}):
      desbloqueia <b>${top[0].ganho} combinações novas</b>, ou seja <b>+${baseTotal ? Math.round(top[0].ganho / baseTotal * 100) : 100}%</b>
      sobre o que já consegues fazer hoje.</div>`;
    html += top.map((c, n) => `
      <div class="lacuna-card ${n === 0 ? 'top1' : ''}">
        <div class="lacuna-rank">${n + 1}º</div>
        <div class="lacuna-info">
          <div class="lacuna-nome"><span class="swatch" style="background:${hexPlano(c.cor)}"></span>
            ${c.categoria.emoji} ${c.categoria.nome} ${esc(c.cor)}</div>
          <div class="lacuna-detalhe">${form(c.formalidade).emoji} registo ${form(c.formalidade).nome.toLowerCase()} · combina com ${c.ganho} das tuas peças</div>
        </div>
        <div class="lacuna-ganho"><div class="n">+${c.ganho}</div><div class="l">outfits novos</div></div>
      </div>`).join('');
  }

  if (redundantes.length) {
    html += `<h3 class="sec-titulo">🚫 Já tens que chegue</h3>
      <p class="hint">Estas parecem boas ideias, mas já possuis peças exatamente do mesmo tipo — o ganho real é quase zero.</p>`;
    html += redundantes.map(c => `
      <div class="lacuna-card" style="border-left-color:var(--muted);opacity:.75">
        <div class="lacuna-rank">—</div>
        <div class="lacuna-info">
          <div class="lacuna-nome"><span class="swatch" style="background:${hexPlano(c.cor)}"></span>
            ${c.categoria.emoji} ${c.categoria.nome} ${esc(c.cor)}</div>
          <div class="lacuna-detalhe">Já tens ${c.jaTens} peça(s) deste tipo. Comprar outra não desbloqueia nada.</div>
        </div>
        <div class="lacuna-ganho"><div class="n" style="color:var(--muted)">~0</div><div class="l">ganho real</div></div>
      </div>`).join('');
  }

  if (!temSapatos) html += `<div class="painel"><b>⚠️ Não tens calçado registado.</b> Adiciona pelo menos um par — sem isso os outfits ficam incompletos.</div>`;

  $('lacunasResultado').innerHTML = html;
  $('orfasTitulo').style.display = orfas.length ? 'block' : 'none';
  $('lacunasOrfas').innerHTML = orfas.length
    ? `<p class="hint" style="grid-column:1/-1">Estas peças não combinam bem com nada do que tens. Ou lhes arranjas par, ou são candidatas a sair.</p>`
      + orfas.map(cardPeca).join('')
    : '';
  ligarCards('lacunasOrfas');
}

// ---------- Cápsula (cobertura mínima) ----------
// Ordena TODAS as peças por rendimento marginal decrescente: a primeira é a que
// sozinha desbloqueia mais outfits, e assim sucessivamente. É desta curva que sai
// o número que interessa — "12 peças fazem metade do trabalho".
function curvaRendimento(nucleos) {
  if (!nucleos.length) return { ordem: [], total: 0 };
  const selecionadas = new Set();
  const cobertos = new Set();
  const ordem = [];

  // grau = em quantos núcleos cada peça participa. Peças muito ligadas
  // são as que puxam o guarda-roupa todo.
  const grau = new Map();
  const somarGrau = id => grau.set(id, (grau.get(id) || 0) + 1);
  for (const n of nucleos) { somarGrau(n.a.id); if (n.b) somarGrau(n.b.id); }

  const cobre = n => selecionadas.has(n.a.id) && (!n.b || selecionadas.has(n.b.id));
  const recalcular = () => nucleos.forEach((n, idx) => { if (cobre(n)) cobertos.add(idx); });
  const registar = peca => {
    const antes = cobertos.size;
    selecionadas.add(peca.id);
    recalcular();
    ordem.push({ peca, ganho: cobertos.size - antes, acumulado: cobertos.size });
  };

  let guarda = 0;
  while (cobertos.size < nucleos.length && guarda++ < 800) {
    // Opção A: uma peça só, que fecha núcleos já meio-feitos.
    const ganhos = new Map();
    nucleos.forEach((n, idx) => {
      if (cobertos.has(idx)) return;
      const faltaA = !selecionadas.has(n.a.id);
      const faltaB = !!n.b && !selecionadas.has(n.b.id);
      if (faltaA && !faltaB) ganhos.set(n.a.id, (ganhos.get(n.a.id) || 0) + 1);
      else if (!faltaA && faltaB) ganhos.set(n.b.id, (ganhos.get(n.b.id) || 0) + 1);
    });
    let melhorSolo = null, rendimentoSolo = -1;
    for (const [id, v] of ganhos) {
      const it = itens.find(x => x.id === id);
      const desempate = (grau.get(id) || 0) * 1e-3 + (it ? pesoItem(it) : 0) * 1e-4;
      if (v + desempate > rendimentoSolo) { rendimentoSolo = v + desempate; melhorSolo = id; }
    }

    // Opção B: um par novo de uma vez. Sem isto o algoritmo é míope — nunca veria
    // "junta esta camisa a estas calças e desbloqueias 8 outfits", porque cada peça
    // sozinha vale zero. Comparamos as duas opções por rendimento POR PEÇA.
    const porAvaliar = nucleos
      .map((n, idx) => ({ n, idx }))
      .filter(({ n, idx }) => !cobertos.has(idx) && n.b && !selecionadas.has(n.a.id) && !selecionadas.has(n.b.id))
      .sort((x, y) => (grau.get(y.n.a.id) + grau.get(y.n.b.id)) - (grau.get(x.n.a.id) + grau.get(x.n.b.id)))
      .slice(0, 30);
    let melhorPar = null, rendimentoPar = -1;
    for (const { n } of porAvaliar) {
      const hipotese = new Set(selecionadas).add(n.a.id).add(n.b.id);
      let ganho = 0;
      nucleos.forEach((m, idx) => {
        if (cobertos.has(idx)) return;
        if (hipotese.has(m.a.id) && (!m.b || hipotese.has(m.b.id))) ganho++;
      });
      const r = ganho / 2;
      if (r > rendimentoPar) { rendimentoPar = r; melhorPar = n; }
    }

    if (melhorSolo !== null && rendimentoSolo >= rendimentoPar) {
      const peca = nucleos.map(n => n.a.id === melhorSolo ? n.a : (n.b && n.b.id === melhorSolo ? n.b : null)).find(Boolean);
      registar(peca);
    } else if (melhorPar) {
      registar(melhorPar.a);
      registar(melhorPar.b);
    } else break;
  }
  return { ordem, total: nucleos.length, grau };
}

// A cápsula para um alvo de cobertura é simplesmente o prefixo dessa curva.
function resolverCapsula(nucleos, alvo) {
  const { ordem, total, grau } = curvaRendimento(nucleos);
  if (!total) return { escolhidas: [], cobertos: 0, total: 0, ordem: [], grau: new Map() };
  const meta = Math.ceil(total * alvo);
  const corte = ordem.findIndex(o => o.acumulado >= meta);
  const prefixo = ordem.slice(0, corte === -1 ? ordem.length : corte + 1);
  return {
    escolhidas: prefixo.map(o => o.peca),
    cobertos: prefixo.length ? prefixo[prefixo.length - 1].acumulado : 0,
    total, ordem, grau,
  };
}

function renderCapsula() {
  const alvo = Number(valorGrupo('capsulaAlvo') || 0.9);
  const pool = itens;
  const nucleos = calcularNucleos(pool);
  if (nucleos.length < 3) {
    $('capsulaResultado').innerHTML = '<p class="hint">Ainda não tens combinações suficientes para isto ser interessante. Adiciona mais peças de cima e de baixo.</p>';
    return;
  }
  const r = resolverCapsula(nucleos, alvo);
  const essenciaisIds = new Set(r.escolhidas.map(p => p.id));
  const relevantes = pool.filter(p => ['top', 'bottom', 'vestido'].includes(cat(p.categoria).slot));
  const dispensaveis = relevantes.filter(p => !essenciaisIds.has(p.id));
  const pct = Math.round(r.cobertos / r.total * 100);
  const sapatos = pool.filter(p => cat(p.categoria).slot === 'calcado').sort((a, b) => pesoItem(b) - pesoItem(a)).slice(0, 2);

  // a curva: quantas peças são precisas para cada fatia de cobertura
  const marcos = [0.25, 0.5, 0.75, 0.9, 1].map(f => {
    const meta = Math.ceil(r.total * f);
    const idx = r.ordem.findIndex(o => o.acumulado >= meta);
    return { f, n: idx === -1 ? r.ordem.length : idx + 1 };
  });
  const metade = marcos.find(m => m.f === 0.5);
  // versatilidade = em quantas combinações a peça entra (≠ rendimento marginal:
  // um vestido é um outfit inteiro sozinho, mas não combina com nada)
  const versateis = [...r.escolhidas]
    .map(p => ({ p, g: r.grau.get(p.id) || 0 }))
    .sort((a, b) => b.g - a.g)
    .slice(0, 10);
  const cauda = relevantes
    .map(p => ({ p, g: r.grau.get(p.id) || 0 }))
    .filter(x => x.g <= 1)
    .sort((a, b) => a.g - b.g);

  $('capsulaResultado').innerHTML = `
    <div class="painel painel-destaque">
      As tuas <b>${r.escolhidas.length} peças essenciais</b> geram <b>${pct}%</b> das ${r.total} combinações boas do teu roupeiro.<br>
      As outras <b>${dispensaveis.length} peças</b> contribuem com os restantes <b>${100 - pct}%</b>.
      ${metade && metade.n < relevantes.length * 0.5
        ? `<br><br>O número que interessa: <b>${metade.n} peças fazem metade do trabalho todo.</b>`
        : ''}
    </div>

    <h3 class="sec-titulo">📉 Rendimento decrescente</h3>
    <p class="hint">Quantas peças precisas de ter para chegar a cada fatia das ${r.total} combinações. Repara onde a curva achata — a partir daí, cada peça nova rende quase nada.</p>
    <div class="barras">${marcos.map(m => `
      <div class="barra-linha">
        <div class="barra-nome">${Math.round(m.f * 100)}% dos outfits</div>
        <div class="barra-track"><div class="barra-fill" style="width:${m.n / r.ordem.length * 100}%"></div></div>
        <div class="barra-valor">${m.n} peças</div>
      </div>`).join('')}</div>

    <h3 class="sec-titulo">🏆 As tuas peças mais versáteis</h3>
    <p class="hint">Em quantas das ${r.total} combinações cada peça entra. Estas são as que sustentam o roupeiro — se perdesses uma, davas por isso.</p>
    <div class="lista-stats" style="margin-bottom:14px">${versateis.map((v, n) => `
      <div class="linha-stat" data-id="${v.p.id}">
        <span class="lacuna-rank" style="width:22px">${n + 1}º</span>
        <span class="swatch" style="background:${hexPlano(v.p.cor)}"></span>
        <span class="ls-nome">${esc(v.p.nome)}</span>
        <span class="ls-valor ${v.g > 4 ? 'bom' : v.g > 1 ? 'medio' : 'mau'}">${v.g} combinações</span>
      </div>`).join('')}</div>

    <h3 class="sec-titulo">✅ A cápsula completa (${r.escolhidas.length} peças)</h3>
    <div class="grid" id="capsulaGrid">${r.escolhidas.map(cardPeca).join('')}</div>

    ${sapatos.length ? `<h3 class="sec-titulo">👟 Mais o calçado</h3><div class="grid" id="capsulaSapatos">${sapatos.map(cardPeca).join('')}</div>` : ''}

    ${cauda.length ? `<h3 class="sec-titulo">🪫 A cauda (${cauda.length} peças)</h3>
      <p class="hint">Cada uma destas entra em <b>uma combinação ou nenhuma</b>. Não é uma ordem para deitar fora — é onde deves procurar primeiro quando o armário não fechar.</p>
      <div class="grid" id="capsulaFora">${cauda.map(x => cardPeca(x.p)).join('')}</div>` : ''}`;
  ['capsulaGrid', 'capsulaSapatos', 'capsulaFora'].forEach(id => $(id) && ligarCards(id));
  $('capsulaResultado').querySelectorAll('.linha-stat').forEach(l =>
    l.addEventListener('click', () => abrirDetalhe(l.dataset.id)));
}

// ---------- Mala de viagem ----------
function renderMala() {
  const dias = Math.max(1, Math.min(30, Number($('malaDias').value) || 5));
  const estacao = valorGrupo('malaEstacao');
  const formalidade = valorGrupo('malaFormalidade');
  const pool = itens.filter(i =>
    (!estacao || !i.estacoes.length || i.estacoes.includes(estacao)) &&
    (formalidade === '' || Math.abs(i.formalidade - Number(formalidade)) <= 1)
  );
  const nucleos = calcularNucleos(pool);
  if (nucleos.length < 1) {
    $('malaResultado').innerHTML = '<p class="hint">Sem combinações possíveis com esses filtros. Alarga a estação ou a ocasião.</p>';
    return;
  }

  // cobre o suficiente para "dias" looks distintos, e nem uma peça a mais
  const alvo = Math.min(1, dias / nucleos.length);
  const r = resolverCapsula(nucleos, alvo);
  const sapatos = pool.filter(p => cat(p.categoria).slot === 'calcado').sort((a, b) => pesoItem(b) - pesoItem(a)).slice(0, dias > 4 ? 2 : 1);
  const casacos = (estacao === 'inverno' || estacao === 'outono' || !estacao)
    ? pool.filter(p => cat(p.categoria).slot === 'casaco').sort((a, b) => pesoItem(b) - pesoItem(a)).slice(0, 1) : [];
  const acessorios = pool.filter(p => cat(p.categoria).slot === 'acessorio').sort((a, b) => pesoItem(b) - pesoItem(a)).slice(0, 2);
  const totalPecas = r.escolhidas.length + sapatos.length + casacos.length + acessorios.length;

  $('malaResultado').innerHTML = `
    <div class="painel painel-destaque">
      Para <b>${dias} dias</b> levas <b>${totalPecas} peças</b> e sais com <b>${r.cobertos} looks diferentes</b>.
      ${r.cobertos >= dias
        ? `<br>Chega e sobra — dá para ${r.cobertos - dias} dia(s) extra sem repetir.`
        : `<br>⚠️ Só dá para ${r.cobertos} look(s) distintos. Vais ter de repetir ${dias - r.cobertos} dia(s), ou levar mais peças.`}
    </div>
    <h3 class="sec-titulo">🧳 Lista de mala</h3>
    <div class="grid" id="malaGrid">${[...r.escolhidas, ...casacos, ...sapatos, ...acessorios].map(cardPeca).join('')}</div>
    <p class="hint" style="margin-top:14px">
      Peso morto evitado: das ${pool.length} peças que encaixavam nos filtros, ${pool.length - totalPecas} ficam em casa sem te fazerem falta.
    </p>`;
  ligarCards('malaGrid');
}

// ================================================================
//  LAVANDARIA
// ================================================================
function renderLavandaria() {
  const sujos = itens.filter(i => i.estado === 'lavar');
  document.querySelectorAll('.badge-lav').forEach(b => {
    b.style.display = sujos.length ? 'inline-grid' : 'none';
    b.textContent = sujos.length;
  });
  $('lavandariaVazia').style.display = sujos.length ? 'none' : 'block';
  $('btnLavarTudo').style.display = sujos.length ? 'inline-block' : 'none';
  $('gridLavandaria').innerHTML = sujos.map(cardPeca).join('');
  ligarCards('gridLavandaria');
}

async function lavarTudo() {
  const sujos = itens.filter(i => i.estado === 'lavar');
  if (!sujos.length) return;
  if (!confirm(`Marcar ${sujos.length} peça(s) como lavadas e disponíveis?`)) return;
  for (const i of sujos) { i.estado = 'disponivel'; await guardarSeguro('itens', i); }
  toast('✨ Tudo lavado e arrumado!');
  renderTudo();
}

// ================================================================
//  DEFINIÇÕES: backup, quota, persistência
// ================================================================
async function abrirDefinicoes() {
  abrirModal('modalDefinicoes');
  atualizarQuota();
  if (navigator.storage && navigator.storage.persisted) {
    const p = await navigator.storage.persisted();
    $('persistEstado').textContent = p ? '✅ Dados protegidos contra limpeza automática' : 'Ainda não protegido';
    $('btnPersistir').disabled = p;
  } else {
    $('persistEstado').textContent = 'Não suportado neste browser';
    $('btnPersistir').disabled = true;
  }
}

async function atualizarQuota() {
  if (!navigator.storage || !navigator.storage.estimate) {
    $('quotaTexto').textContent = 'O browser não diz quanto espaço estás a usar.';
    return;
  }
  const { usage = 0, quota = 0 } = await navigator.storage.estimate();
  const mb = n => (n / 1048576).toFixed(1) + ' MB';
  const pct = quota ? (usage / quota * 100) : 0;
  $('quotaFill').style.width = Math.max(1, Math.min(100, pct)) + '%';
  $('quotaFill').style.background = pct > 85 ? 'var(--danger)' : 'var(--accent)';
  $('quotaTexto').textContent = `${mb(usage)} usados de ${mb(quota)} disponíveis (${pct.toFixed(1)}%) · ${itens.length} peças`;
}

async function pedirPersistencia() {
  if (!navigator.storage || !navigator.storage.persist) return;
  const ok = await navigator.storage.persist();
  toast(ok ? '🔐 Dados protegidos! O browser já não os apaga sozinho.' : '⚠️ O browser recusou. Instala a app (PWA) e tenta de novo.');
  abrirDefinicoes();
}

async function exportarTudo() {
  let dados = {
    formato: 'roupeiro-digital',
    versao: 2,
    exportado: new Date().toISOString(),
    itens, outfits, historico,
    meta: { gostos, hoje, semana },
  };

  // Um perfil cifrado não deve cuspir um backup em texto limpo por descuido.
  if (Perfis.chave) {
    const cifrar = confirm(
      'Cifrar o backup com a palavra-passe deste perfil?\n\n' +
      'SIM  → o ficheiro fica ilegível para quem não souber a palavra-passe (recomendado).\n' +
      'NÃO  → o ficheiro sai em texto limpo: qualquer pessoa que lhe deite a mão vê tudo.'
    );
    if (cifrar) {
      const p = Perfis.atual;
      dados = {
        formato: 'roupeiro-digital-cifrado',
        versao: 2,
        exportado: dados.exportado,
        salt: p.salt,
        iteracoes: p.iteracoes || Cripto.ITERACOES,
        verificador: p.verificador,
        pacote: await Cripto.cifrar(Perfis.chave, dados),
      };
    }
  }

  const blob = new Blob([JSON.stringify(dados)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `roupeiro-${hojeStr()}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  const mb = (blob.size / 1048576).toFixed(1);
  toast(`⬇️ Backup criado (${mb} MB) — guarda-o fora deste computador`);
}

async function importarBackup(file) {
  $('importInput').value = '';
  let dados;
  try {
    dados = JSON.parse(await file.text());
  } catch {
    toast('⚠️ Esse ficheiro não é um backup válido');
    return;
  }
  // backup cifrado: pede a palavra-passe com que foi exportado
  if (dados.formato === 'roupeiro-digital-cifrado') {
    const senha = prompt('Este backup está cifrado.\n\nPalavra-passe do perfil com que foi exportado:');
    if (senha === null) return;
    try {
      const chave = await Cripto.derivarChave(senha, dados.salt, dados.iteracoes || Cripto.ITERACOES_LEGADO);
      if (!await Cripto.validarChave(chave, dados.verificador)) { toast('⚠️ Palavra-passe errada'); return; }
      dados = await Cripto.decifrar(chave, dados.pacote);
    } catch {
      toast('⚠️ Não consegui decifrar o backup');
      return;
    }
  }

  if (dados.formato !== 'roupeiro-digital' || !Array.isArray(dados.itens)) {
    toast('⚠️ Formato desconhecido — esperava um backup do Roupeiro');
    return;
  }
  const msg = `Importar ${dados.itens.length} peças, ${(dados.outfits || []).length} outfits e ${(dados.historico || []).length} dias de histórico?\n\n`
    + `⚠️ Isto SUBSTITUI tudo o que tens agora (${itens.length} peças). Exporta um backup antes se tiveres dúvidas.`;
  if (!confirm(msg)) return;

  await DB.limpar('itens'); await DB.limpar('outfits'); await DB.limpar('historico');
  for (const i of dados.itens) await DB.por('itens', normalizarItem(i));
  for (const o of (dados.outfits || [])) await DB.por('outfits', o);
  for (const h of (dados.historico || [])) await DB.por('historico', h);
  const meta = dados.meta || {};
  await DB.por('meta', meta.gostos || { scores: {}, pares: {} }, 'gostos');
  await DB.por('meta', meta.hoje && meta.hoje.data === hojeStr() ? meta.hoje : null, 'hoje');
  await DB.por('meta', meta.semana || null, 'semana');

  itens = (await DB.todos('itens')).map(normalizarItem);
  outfits = await DB.todos('outfits');
  historico = (await DB.todos('historico')).sort((a, b) => a.data.localeCompare(b.data));
  gostos = (await DB.metaGet('gostos')) || { scores: {}, pares: {} };
  hoje = (await DB.metaGet('hoje')) || null;
  semana = (await DB.metaGet('semana')) || null;

  fecharModal('modalDefinicoes');
  renderTudo();
  toast(`⬆️ Backup restaurado: ${itens.length} peças`);
}

async function apagarTudo() {
  if (!confirm('Apagar TODAS as peças, outfits e histórico?\n\nIsto não pode ser desfeito. Exporta um backup primeiro!')) return;
  if (!confirm('A sério? Última confirmação.')) return;
  await DB.limpar('itens'); await DB.limpar('outfits'); await DB.limpar('historico');
  await DB.por('meta', null, 'hoje'); await DB.por('meta', null, 'semana');
  await DB.por('meta', { scores: {}, pares: {} }, 'gostos');
  itens = []; outfits = []; historico = []; hoje = null; semana = null;
  gostos = { scores: {}, pares: {} };
  fecharModal('modalDefinicoes');
  renderTudo();
  toast('🗑️ Roupeiro vazio. Começa de novo.');
}
