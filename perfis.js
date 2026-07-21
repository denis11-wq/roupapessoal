// ================== PERFIS ==================
// Cada pessoa tem a SUA base de dados IndexedDB, não uma "coluna utilizador"
// numa base partilhada. Isolamento a sério: um perfil não consegue ler o outro
// nem por engano, e apagar um perfil apaga mesmo tudo o que é dele.
//
// O registo de perfis (nomes, sais, verificadores) vive numa base separada.
// Não contém dados do roupeiro nem palavras-passe.

const Perfis = {
  sistema: null,      // IDBDatabase do registo
  lista: [],
  atual: null,        // objeto perfil ativo
  chave: null,        // CryptoKey em memória — null se o perfil não for cifrado

  nomeBD(id) { return id === 'principal' ? 'roupeiro' : 'roupeiro-' + id; },

  abrirSistema() {
    return new Promise((res, rej) => {
      const req = indexedDB.open('roupeiro-sistema', 1);
      req.onupgradeneeded = () => {
        const d = req.result;
        if (!d.objectStoreNames.contains('perfis')) d.createObjectStore('perfis', { keyPath: 'id' });
        if (!d.objectStoreNames.contains('config')) d.createObjectStore('config');
      };
      req.onsuccess = () => { Perfis.sistema = req.result; res(); };
      req.onerror = () => rej(req.error);
    });
  },

  _op(store, modo, fn) {
    return new Promise((res, rej) => {
      const tx = Perfis.sistema.transaction(store, modo);
      const r = fn(tx.objectStore(store));
      tx.oncomplete = () => res(r && r.result !== undefined ? r.result : undefined);
      tx.onerror = () => rej(tx.error);
    });
  },
  gravar(p) { return Perfis._op('perfis', 'readwrite', s => s.put(p)); },
  configGet(k) { return Perfis._op('config', 'readonly', s => s.get(k)); },
  configPor(v, k) { return Perfis._op('config', 'readwrite', s => s.put(v, k)); },

  async carregar() {
    await Perfis.abrirSistema();
    Perfis.lista = (await Perfis._op('perfis', 'readonly', s => s.getAll())) || [];

    // Primeira vez: cria o perfil "principal" apontado à base de dados que já existe,
    // para quem já tem peças não perder nada.
    if (!Perfis.lista.length) {
      const inicial = {
        id: 'principal', nome: 'Eu', emoji: '👤',
        cifrado: false, salt: null, verificador: null,
        criado: new Date().toISOString().slice(0, 10),
      };
      await Perfis.gravar(inicial);
      Perfis.lista = [inicial];
    }
    return Perfis.lista;
  },

  // A palavra-passe é OBRIGATÓRIA: não existem contas sem proteção.
  async criar({ nome, emoji, senha, email }) {
    if (!senha) throw new Error('Toda a conta tem de ter palavra-passe');
    if (!email) throw new Error('Toda a conta tem de ter email');
    const id = 'u' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const p = {
      id, nome: nome.trim() || 'Sem nome', emoji: emoji || '👤',
      email: Cripto.normalizarEmail(email),
      // salt derivado do email: é o que permite entrar noutro dispositivo só
      // com email + palavra-passe, sem transportar nada entre eles
      cifrado: true, salt: Cripto.saltDeEmail(email), iteracoes: Cripto.ITERACOES,
      verificador: null,
      criado: new Date().toISOString().slice(0, 10),
    };
    const chave = await Cripto.derivarChave(senha, p.salt, p.iteracoes);
    p.verificador = await Cripto.criarVerificador(chave);
    await Perfis.gravar(p);
    Perfis.lista.push(p);
    return p;
  },

  // Contas antigas (criadas antes da proteção ser obrigatória) que ainda estão em claro.
  porProteger() { return Perfis.lista.filter(p => !p.cifrado); },

  // Confirma a palavra-passe e guarda a chave em memória para a sessão.
  async desbloquear(perfil, senha) {
    if (!perfil.cifrado) { Perfis.chave = null; return true; }
    const chave = await Cripto.derivarChave(senha, perfil.salt, perfil.iteracoes || Cripto.ITERACOES_LEGADO);
    if (!await Cripto.validarChave(chave, perfil.verificador)) return false;
    Perfis.chave = chave;
    return true;
  },

  trancar() { Perfis.chave = null; Perfis.atual = null; },

  async apagar(id) {
    await Perfis._op('perfis', 'readwrite', s => s.delete(id));
    Perfis.lista = Perfis.lista.filter(p => p.id !== id);
    await new Promise(res => {
      const req = indexedDB.deleteDatabase(Perfis.nomeBD(id));
      req.onsuccess = req.onerror = req.onblocked = () => res();
    });
  },

  // Mudar palavra-passe obriga a reescrever tudo: os dados no disco estão
  // cifrados com a chave antiga. Serve também para proteger uma conta antiga
  // que ainda esteja em claro (nesse caso a chave antiga é simplesmente null).
  async mudarSenha(perfil, senhaNova) {
    if (!senhaNova) throw new Error('Não é possível remover a palavra-passe de uma conta');
    const chaveAntiga = Perfis.chave;
    const tudo = await DB.exportarBruto();          // lê com a chave antiga (ou em claro)

    perfil.salt = Cripto.novoSalt();
    perfil.iteracoes = Cripto.ITERACOES;
    const chaveNova = await Cripto.derivarChave(senhaNova, perfil.salt, perfil.iteracoes);
    perfil.verificador = await Cripto.criarVerificador(chaveNova);
    perfil.cifrado = true;
    Perfis.chave = chaveNova;

    try {
      await DB.importarBruto(tudo);                 // regrava com a chave nova
      await Perfis.gravar(perfil);
    } catch (e) {
      Perfis.chave = chaveAntiga;                   // deixa tudo como estava
      throw e;
    }
  },
};
