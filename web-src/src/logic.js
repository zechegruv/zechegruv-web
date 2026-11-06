class Component extends DCLogic {
  constructor(props) {
    super(props);
    this.state = { intro: 'on', introSun: '', heroSel: 4, heroPicked: false, here: '', floatOff: false, errName: false, errWa: false, crFrom: null, heroQ: '', heroOn: false, heroFocus: false, crQ: '', crSel: 0, crTag: 'todos', crPlay: false, crOut: null, snd: null, tt: null, ttWait: false, sndPlaying: false, sndLoad: false, sndErr: false, sndPos: 0, demo: 'off', demoCh: 0, demoPlay: true, demoN: 0, mode: 'demo', pos: 0, playing: false, q: 0, qTick: 0, step: 0, plan: 'mes', labMM: false, custom: false, cxMode: 0, cxMenu: false, cxSel: [], cxReady: false, cxHours: 2, cxDetail: {}, ev: null, cat: null, sending: false, from: 'web', pack: -1, faq: -1, table: false, pTick: 0, sent: false, origin: -1, now: Date.now() };
    this.hero = null;
    this.stack = null;
  }
  componentDidMount() {
    var self = this;
    this.setupSound();
    // Próxima fecha a la venta (ZG PASS): la franja de arriba solo aparece si hay una.
    fetch('/.netlify/functions/pass-events')
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (data) {
        var ev = data && (data.events || []).find(function (e) { return e.on_sale; });
        if (ev) { self.setState({ ev: ev }); if (window.ZGPass && window.ZGPass.eventSchema) window.ZGPass.eventSchema(ev); }
      })
      .catch(function () {});
    // Catálogo de Spotify: se muestra al toque lo último guardado y se pide el nuevo.
    var KEY = 'zg_catalogo_v1';
    try {
      var saved = JSON.parse(localStorage.getItem(KEY) || 'null');
      if (saved && saved.items && saved.items.length) this.setState({ cat: saved.items });
    } catch (e) {}
    fetch('/.netlify/functions/spotify-catalog')
      .then(function (r) { if (!r.ok) throw new Error('catalogo'); return r.json(); })
      .then(function (d) {
        if (!d || !d.items || !d.items.length) return;
        self.setState({ cat: d.items });
        try { localStorage.setItem(KEY, JSON.stringify({ at: Date.now(), items: d.items })); } catch (e) {}
      })
      .catch(function () {});
    // De qué botón llega la persona al formulario (portada, packs, flotante…).
    this.onAnyClick = function (e) {
      var a = e.target && e.target.closest ? e.target.closest('a[href="#visita"]') : null;
      if (!a) return;
      var sec = a.closest('section');
      var from = a.classList.contains('zg-float') ? 'flotante' : (a.closest('header') ? 'menu' : (sec && sec.id) || 'web');
      self.setState({ from: from });
      if (window.zgTrack) window.zgTrack('abrir_visita', { boton: from });
    };
    document.addEventListener('click', this.onAnyClick, true);
    this.timer = setInterval(function () {
      var n = (self.state.q + 1) % 6;
      self.setState({ q: n, qTick: self.state.qTick + 1, now: Date.now() });
    }, 6000);
    // El logo se queda sobre los discos hasta que la persona toca "Entrá a escuchar"
    // o los discos: el scroll (o mover el lienzo) no lo saca.
    // Menú: marca la sección que se está viendo.
    if (window.IntersectionObserver) {
      var ids = ['estudio', 'proceso', 'lanzamientos', 'comunidad', 'planes', 'visita'];
      this.io = new IntersectionObserver(function (entries) {
        entries.forEach(function (en) { if (en.isIntersecting) self.setState({ here: en.target.id }); });
      }, { rootMargin: '-45% 0px -50% 0px' });
      ids.forEach(function (id) { var el = document.getElementById(id); if (el) self.io.observe(el); });
      var top = document.getElementById('inicio');
      if (top) this.io.observe(top);
      // El botón flotante se va cuando el formulario o el pie ya están a la vista.
      var seen = {};
      this.io2 = new IntersectionObserver(function (entries) {
        entries.forEach(function (en) { seen[en.target.id || 'pie'] = en.isIntersecting; });
        var off = !!(seen.visita || seen.pie);
        if (off !== self.state.floatOff) self.setState({ floatOff: off });
      }, { rootMargin: '0px 0px -20% 0px' });
      var v = document.getElementById('visita'); if (v) this.io2.observe(v);
      var f = document.querySelector('footer'); if (f) this.io2.observe(f);
    }
  }
  // ---- Reproductor de los discos (inicio y bandeja de lanzamientos) ----
  // Un solo <audio> para toda la página: suena el adelanto de 30 s de Spotify
  // (spotify-preview). Al terminar pasa solo al disco siguiente, y si la
  // persona se va de la sección que está sonando, se pausa: nunca queda
  // música sonando sin un botón a la vista para frenarla.
  setupSound() {
    var self = this;
    var au = this.au = new Audio();
    au.preload = 'none';
    au.addEventListener('playing', function () { self.setState({ sndPlaying: true, sndLoad: false, sndErr: false, crPlay: !!(self.snd && self.snd.src === 'crate') }); });
    au.addEventListener('pause', function () {
      var tt = self.state.tt;
      self.setState({ sndPlaying: false, crPlay: false, tt: tt && (tt.phase === 'down' || tt.phase === 'land') && !self.state.ttWait ? Object.assign({}, tt, { phase: 'up' }) : tt });
    });
    au.addEventListener('waiting', function () { self.setState({ sndLoad: true }); });
    au.addEventListener('timeupdate', function () {
      if (!au.duration) return;
      var p = au.currentTime / au.duration;
      if (Math.abs(p - (self.state.sndPos || 0)) > 0.008) self.setState({ sndPos: p });
    });
    au.addEventListener('ended', function () { self.sndNext(true); });
    au.addEventListener('error', function () {
      if (!au.getAttribute('src')) return;
      var tt = self.state.tt;
      clearTimeout(self.ttT); clearTimeout(self.ttT2); au.muted = false;
      self.setState({ sndErr: true, sndLoad: false, sndPlaying: false, crPlay: false, ttWait: false, tt: tt && tt.img ? Object.assign({}, tt, { phase: 'up' }) : tt });
    });
    // Caja de discos: la ruedita pasa los discos solo si el gesto EMPIEZA con
    // el mouse arriba de la caja. Si venías scrolleando la página y el cursor
    // pasa por la caja, la página sigue de largo. Un gesto tiene un solo
    // dueño: el que empezó en la caja no mueve la página hasta que se suelta.
    // En el primer o el último disco, un gesto nuevo hacia afuera mueve la
    // página. Mientras se pasan discos, la animación va más rápido.
    var stage = document.querySelector('.cr-stage');
    if (stage) {
      var G = { owner: null, last: 0, acc: 0, stepAt: 0, endT: 0 };
      var GAP = 180, STEP_PX = 70, MIN_MS = 95;
      var finish = function () { G.owner = null; G.acc = 0; self.crFast = false; stage.classList.remove('is-browsing'); };
      window.addEventListener('wheel', function (e) {
        var now = performance.now();
        var fresh = now - G.last > GAP;
        G.last = now;
        clearTimeout(G.endT);
        G.endT = setTimeout(finish, GAP + 20);
        if (Math.abs(e.deltaX) > Math.abs(e.deltaY) * 1.2) return;
        var dy = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaMode === 2 ? e.deltaY * 400 : e.deltaY;
        if (!dy) return;
        // Invertido a propósito: dos dedos hacia abajo en el trackpad (scroll
        // natural del Mac) muestra los discos de atrás, los que asoman arriba;
        // hacia arriba vuelve a los de adelante. Como pasar vinilos con la mano.
        dy = -dy;
        var over = stage.contains(e.target);
        var list = self.crList || [];
        var sel = Math.min(self.state.crSel, Math.max(0, list.length - 1));
        var dir = dy > 0 ? 1 : -1;
        if (fresh || !G.owner) {
          var atEnd = list.length && dir > 0 && sel >= list.length - 1;
          var atEdge = !list.length || atEnd || (dir < 0 && sel <= 0);
          // En el último disco, seguir "para adelante" sigue de largo: la
          // página baja (como si terminaras de pasar los vinilos y siguieras).
          G.owner = over && atEnd ? 'onward' : over && !atEdge ? 'crate' : 'page';
          G.acc = 0;
          if (G.owner === 'crate') stage.classList.add('is-browsing');
        }
        if (G.owner === 'onward') { e.preventDefault(); try { window.scrollBy({ top: Math.abs(dy), behavior: 'instant' }); } catch (err) { document.documentElement.scrollTop += Math.abs(dy); } return; }
        if (G.owner !== 'crate') return;
        e.preventDefault();
        self.crFast = true;
        G.acc += dy;
        // Mouse con clics: un disco por clic, al instante. Trackpad: un disco cada ~70 px.
        var notch = Math.abs(dy) >= 50 && Number.isInteger(dy);
        if ((notch || Math.abs(G.acc) >= STEP_PX) && now - G.stepAt >= (notch ? 0 : MIN_MS)) {
          var k = sel + (G.acc > 0 ? 1 : -1);
          G.acc = notch ? 0 : G.acc - (G.acc > 0 ? STEP_PX : -STEP_PX);
          if (Math.abs(G.acc) > STEP_PX) G.acc = (G.acc > 0 ? 1 : -1) * STEP_PX * 0.5;
          if (k >= 0 && k < list.length && self.crGo) { G.stepAt = now; self.crGo(k); }
        }
      }, { passive: false });
    }
    if ('mediaSession' in navigator) {
      try {
        navigator.mediaSession.setActionHandler('play', function () { var p = au.play(); if (p && p.catch) p.catch(function () {}); });
        navigator.mediaSession.setActionHandler('pause', function () { au.pause(); });
        navigator.mediaSession.setActionHandler('nexttrack', function () { self.sndNext(false); });
      } catch (e) {}
    }
    if (window.IntersectionObserver) {
      this.io3 = new IntersectionObserver(function (entries) {
        entries.forEach(function (en) {
          if (en.intersectionRatio < 0.2) self.sndStop(en.target.id === 'lanzamientos' ? 'crate' : 'hero');
        });
      }, { threshold: [0, 0.2] });
      var lz = document.getElementById('lanzamientos'); if (lz) this.io3.observe(lz);
      if (this.stack) this.io3.observe(this.stack);
    }
  }
  spId(url) {
    var m = /open\.spotify\.com\/(album|track)\/([A-Za-z0-9]{22})/.exec(url || '');
    if (!m) return null;
    // Discos con varios temas en los que el adelanto tiene que ser uno en
    // particular (el que se produjo en ZECHE GRUV).
    var PICK = { 'album:6YmySpzsNXMuxekqcmdlGJ': { t: 'track', id: '35ePtcWYOduwLuefy2fK8R' } }; // TACÚ → Admítelo
    return PICK[m[1] + ':' + m[2]] || { t: m[1], id: m[2] };
  }
  // Toca (o pausa, si ya es ese) un disco. src: 'hero' o 'crate'.
  sndPlay(src, idx, item, hold) {
    var au = this.au;
    if (!au || !item) return;
    au.muted = !!hold;
    // Si suena otra cosa, el brazo del tocadiscos se levanta.
    if (src !== 'crate' && this.state.tt && this.state.tt.phase !== 'up' && this.state.tt.phase !== 'idle') { clearTimeout(this.ttT); clearTimeout(this.ttT2); this.setState({ ttWait: false, tt: Object.assign({}, this.state.tt, { phase: 'up' }) }); }
    // Nunca dos cosas a la vez: frena el antes/después.
    if (this.state.playing) { if (this.aDemo) this.aDemo.pause(); if (this.aMaster) this.aMaster.pause(); clearInterval(this.posT); }
    var s = this.snd;
    if (s && s.src === src && s.idx === idx && s.title === item.title && !this.state.sndErr) {
      if (au.paused) { var p0 = au.play(); if (p0 && p0.catch) p0.catch(function () {}); } else if (!hold) au.pause();
      return;
    }
    var sp = this.spId(item.url);
    this.snd = { src: src, idx: idx, title: item.title, artist: item.artist, url: item.url, img: item.img };
    this.setState({ snd: this.snd, sndLoad: !!sp, sndErr: !sp, sndPos: 0, playing: false });
    if (!sp) { au.pause(); return; }
    au.src = '/.netlify/functions/spotify-preview?t=' + sp.t + '&id=' + sp.id;
    var p = au.play(); if (p && p.catch) p.catch(function () {});
    if ('mediaSession' in navigator && window.MediaMetadata) {
      try { navigator.mediaSession.metadata = new MediaMetadata({ title: item.title, artist: item.artist, album: 'ZECHE GRUV', artwork: item.img ? [{ src: new URL(item.img, location.href).href, sizes: '512x512' }] : [] }); } catch (e) {}
    }
    if (window.zgTrack) window.zgTrack('escuchar_disco', { lugar: src === 'hero' ? 'inicio' : 'bandeja', disco: item.title });
  }
  sndStop(src) {
    if (this.au && !this.au.paused && this.snd && (!src || this.snd.src === src)) this.au.pause();
  }
  sndNext(auto) {
    var s = this.snd;
    if (!s) return;
    if (s.src === 'hero') {
      var items = this.heroItems || [];
      if (!items.length) return;
      var k = (s.idx + 1) % items.length;
      this.setState({ heroSel: k, heroPicked: true });
      this.sndPlay('hero', k, items[k]);
    } else {
      var list = this.crList || [];
      var n = s.idx + 1;
      if (n >= list.length) { if (auto) return; n = 0; }
      var self = this;
      this.setState({ crSel: n, crFrom: s.idx });
      this.ttSwap();
      clearTimeout(this.ttNext);
      this.ttNext = setTimeout(function () { self.crListen(n, list[n]); }, 760);
    }
  }
  // ---- Tocadiscos de la bandeja ----
  // "Sacar el vinilo y escuchar": el vinilo sale volando del sobre, pasa por
  // detrás del texto, se apoya en el plato, baja la aguja y recién ahí suena.
  // El audio arranca en silencio en el mismo toque (así el celular lo deja
  // sonar) y se escucha desde el principio cuando la aguja toca el disco.
  crListen(k, item) {
    if (!item) return;
    var st = this.state, au = this.au, tt = st.tt;
    if (st.ttWait) return; // el disco ya está en camino
    var same = this.snd && this.snd.src === 'crate' && this.snd.title === item.title && !st.sndErr;
    if (same && au && !au.paused && !au.muted) { au.pause(); return; } // la aguja se levanta (evento pause)
    var onDeck = tt && tt.img && tt.key === item.title && tt.phase !== 'out';
    this.sndPlay('crate', k, item, true);
    this.setState({ ttWait: true });
    if (same && onDeck) { this.ttDrop(); return; }
    this.ttFly(item);
  }
  ttSwap() {
    // El disco que sonaba se calla en el momento en que sale del plato.
    if (this.au && !this.au.paused && this.snd && this.snd.src === 'crate') this.au.pause();
    var tt = this.state.tt;
    if (tt && tt.img) this.setState({ tt: Object.assign({}, tt, { phase: 'out' }) });
  }
  ttFly(item) {
    var self = this;
    clearTimeout(this.ttT); clearTimeout(this.ttT2);
    var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    var sec = this.crSec, deck = this.ttEl;
    var from = document.querySelector('.cr-item.is-sel .cr-vin .zg-vinyl');
    var rec = deck && deck.querySelector('.tt-rec');
    var title = document.querySelector('.cr-title');
    var prev = this.state.tt;
    this.setState({ tt: { img: prev && prev.img, key: prev && prev.key, phase: prev && prev.img ? 'out' : 'idle' }, crOut: item.title });
    function land() {
      self.setState({ tt: { img: item.img, key: item.title, phase: 'land' } });
      self.ttT = setTimeout(function () { self.ttDrop(); }, reduce ? 0 : 260);
    }
    if (reduce || !sec || !from || !rec || !from.getBoundingClientRect().width || !rec.getBoundingClientRect().width || !Element.prototype.animate) { land(); return; }
    var a = from.getBoundingClientRect(), b = rec.getBoundingClientRect(), c = sec.getBoundingClientRect();
    var fly = document.createElement('div');
    fly.className = 'cr-fly';
    fly.innerHTML = '<div class="zg-vinyl"><span class="zg-vlabel"></span></div>';
    if (item.img) fly.querySelector('.zg-vlabel').style.backgroundImage = 'url(' + item.img + ')';
    fly.style.cssText = 'left:' + (b.left - c.left) + 'px;top:' + (b.top - c.top) + 'px;width:' + b.width + 'px;height:' + b.height + 'px';
    sec.appendChild(fly);
    var bx = b.left + b.width / 2, by = b.top + b.height / 2;
    var dx = a.left + a.width / 2 - bx, dy = a.top + a.height / 2 - by, s0 = a.width / b.width;
    // Pasa por detrás del título del disco (o del medio del camino si no está).
    var m = title ? title.getBoundingClientRect() : null;
    var mx = m && m.width ? m.left + m.width * 0.45 - bx : dx * 0.45, my = m && m.width ? m.top + m.height * 0.5 - by : dy * 0.5 - 80;
    var anim = fly.animate([
      { transform: 'translate(' + dx + 'px,' + dy + 'px) scale(' + s0 + ') rotate(0deg)', offset: 0 },
      { transform: 'translate(' + (dx + 40) + 'px,' + (dy - 50) + 'px) scale(' + (s0 * 1.02) + ') rotate(80deg)', offset: 0.14 },
      { transform: 'translate(' + mx + 'px,' + my + 'px) scale(' + ((s0 + 1) / 2) + ') rotate(380deg)', offset: 0.55 },
      { transform: 'translate(0px,-14px) scale(1.06) rotate(660deg)', offset: 0.88 },
      { transform: 'translate(0px,0px) scale(1) rotate(720deg)', offset: 1 }
    ], { duration: 1350, easing: 'cubic-bezier(.45,.05,.25,1)', fill: 'forwards' });
    anim.onfinish = function () { land(); requestAnimationFrame(function () { fly.remove(); }); };
  }
  ttDrop() {
    var self = this;
    var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    var tt = this.state.tt;
    if (!tt) return;
    this.setState({ tt: Object.assign({}, tt, { phase: 'down' }) });
    clearTimeout(this.ttT2);
    this.ttT2 = setTimeout(function () {
      var au = self.au;
      self.setState({ ttWait: false, sndPos: 0 });
      if (!au) return;
      try { au.currentTime = 0; } catch (e) {}
      au.muted = false;
      if (au.paused) { var p = au.play(); if (p && p.catch) p.catch(function () {}); }
    }, reduce ? 0 : 760);
  }
  leaveIntro() {
    var self = this;
    if (this.state.intro !== 'on') return;
    // El sol viaja hasta el vinilo de la pila y se achica ahí.
    var sun = this.introSunEl, target = document.querySelector('.zg-hv');
    var style = '';
    if (sun && target) {
      var a = sun.getBoundingClientRect(), b = target.getBoundingClientRect();
      var tx = (b.left + b.width / 2) - (a.left + a.width / 2);
      var ty = (b.top + b.height / 2) - (a.top + a.height / 2);
      var ts = Math.max(.08, Math.min(1, (b.width * .34) / a.width));
      style = '--tx: ' + tx.toFixed(0) + 'px; --ty: ' + ty.toFixed(0) + 'px; --ts: ' + ts.toFixed(3);
    }
    this.setState({ intro: 'leaving', introSun: style });
    this.introT = setTimeout(function () { self.setState({ intro: 'off' }); }, 1300);
  }
  openDemo() {
    var self = this;
    var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.demoBack = document.activeElement;
    this.setState({ demo: 'on', demoCh: 0, demoPlay: !reduce, demoN: this.state.demoN + 1 });
    this.demoRun(!reduce);
    setTimeout(function () { if (self.demoX) self.demoX.focus(); }, 60);
  }
  demoRun(on) {
    var self = this;
    clearInterval(this.demoT);
    if (!on) return;
    this.demoT = setInterval(function () {
      self.setState({ demoCh: (self.state.demoCh + 1) % 4, demoN: self.state.demoN + 1 });
    }, 6200);
  }
  closeDemo() {
    var self = this;
    if (this.state.demo !== 'on') return;
    clearInterval(this.demoT);
    this.setState({ demo: 'out' });
    setTimeout(function () { self.setState({ demo: 'off' }); if (self.demoBack && self.demoBack.focus) self.demoBack.focus(); }, 260);
  }
  swapTo(m) {
    if (this.state.mode === m) return;
    var from = m === 'demo' ? this.aMaster : this.aDemo, to = m === 'demo' ? this.aDemo : this.aMaster;
    if (from && to) {
      try { to.currentTime = from.currentTime; } catch (e) {}
      if (this.state.playing) { var p = to.play(); if (p && p.catch) p.catch(function () {}); from.pause(); }
    }
    this.setState({ mode: m });
  }
  componentWillUnmount() { clearTimeout(this.ttT); clearTimeout(this.ttT2); clearTimeout(this.ttNext); if (this.au) this.au.pause(); if (this.io3) this.io3.disconnect(); clearInterval(this.demoT); clearInterval(this.posT); if (this.aDemo) this.aDemo.pause(); if (this.aMaster) this.aMaster.pause(); clearTimeout(this.introT); clearInterval(this.timer); clearTimeout(this.hsTimer); if (this.io) this.io.disconnect(); if (this.io2) this.io2.disconnect(); document.removeEventListener('click', this.onAnyClick, true); }
  renderVals() {
    var self = this;
    var st = this.state;
    function fmt(n) { return '$' + Math.round(n).toLocaleString('es-AR'); }

    var LANG = (typeof window !== 'undefined' && window.ZG_LANG) || 'es';
    var LOCALE = { es: 'es-AR', en: 'en-US', pt: 'pt-BR' }[LANG] || 'es-AR';
    var ev = st.ev, tk = null;
    if (ev) {
      var start = new Date(ev.starts_at);
      var dayOf = function (d) { return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }).format(d); };
      var days = Math.round((Date.parse(dayOf(start) + 'T12:00:00Z') - Date.parse(dayOf(new Date(st.now)) + 'T12:00:00Z')) / 86400000);
      var date = new Intl.DateTimeFormat(LOCALE, { timeZone: 'America/Argentina/Buenos_Aires', weekday: 'long', day: 'numeric', month: 'long' }).format(start);
      date = date.replace(',', '');
      date = date.charAt(0).toUpperCase() + date.slice(1);
      var left = days <= 0 ? T('Es hoy') : (days === 1 ? T('Falta 1 día') : T('Faltan {n} días').replace('{n}', days));
      if (ev.few_left) left += ' · ' + T('Quedan {n} entradas').replace('{n}', ev.few_left);
      var name = ev.name + (ev.venue_name ? ' · ' + ev.venue_name : '');
      tk = { date: date, name: name, left: left, url: '/pass/?e=' + encodeURIComponent(ev.slug) };
    }

    var mode = st.mode;
    // Forma de onda real de los 18 s de OKEY (antes y después), 56 barras.
    var WF = {
      demo: [0.058, 0.149, 0.142, 0.123, 0.136, 0.06, 0.076, 0.21, 0.516, 0.529, 0.535, 0.396, 0.358, 0.376, 0.363, 0.522, 0.47, 0.505, 0.462, 0.491, 0.531, 0.548, 0.387, 0.37, 0.373, 0.5, 0.51, 0.43, 0.517, 0.594, 0.54, 0.531, 0.467, 0.378, 0.358, 0.36, 0.509, 0.46, 0.473, 0.505, 0.504, 0.544, 0.513, 0.399, 0.384, 0.38, 0.326, 0.355, 0.545, 0.559, 0.357, 0.192, 0.124, 0.085, 0.061, 0.021],
      master: [0.084, 0.212, 0.208, 0.168, 0.144, 0.116, 0.147, 0.287, 0.493, 0.418, 0.435, 0.395, 0.365, 0.332, 0.323, 0.442, 0.42, 0.511, 0.454, 0.42, 0.482, 0.419, 0.383, 0.371, 0.353, 0.489, 0.498, 0.459, 0.499, 0.506, 0.48, 0.384, 0.434, 0.359, 0.334, 0.32, 0.405, 0.4, 0.5, 0.504, 0.426, 0.457, 0.441, 0.385, 0.383, 0.364, 0.302, 0.309, 0.555, 0.574, 0.396, 0.276, 0.21, 0.133, 0.097, 0.025]
    };
    var pos = st.pos || 0;
    var color = mode === 'demo' ? '#B08A62' : '#F07800';
    var bars = WF[mode].map(function (v, idx) {
      var h = 8 + Math.round(Math.min(1, v / 0.6) * 138);
      var played = (idx + 0.5) / 56 <= pos;
      return { style: 'flex: 1 1 0; min-width: 2px; height: ' + h + 'px; background: ' + color + '; opacity: ' + (played || !pos ? '1' : '0.38') + '; border-radius: 999px; transition: height 420ms cubic-bezier(.77,0,.175,1), background-color 300ms ease, opacity 200ms ease' };
    });
    var on = 'position: relative; z-index: 1; border: 0; font: inherit; font-weight: 600; font-size: 15px; padding: 10px 20px; border-radius: 999px; cursor: pointer; background: transparent; color: #241105; transition: color 250ms ease';
    var off = 'position: relative; z-index: 1; border: 0; font: inherit; font-weight: 500; font-size: 15px; padding: 10px 20px; border-radius: 999px; cursor: pointer; background: transparent; color: #F0E0C0; transition: color 250ms ease';
    var knobX = mode === 'demo' ? '0' : '100%';

    var stepData = [
      { t: T('Estructura'), d: T('Partimos de lo que traigas, aunque sea una frase. Encontramos el gancho y definimos la forma del tema: salís de la primera sesión con un mapa claro.') },
      { t: T('Producción'), d: T('Construimos el beat y el sonido que te representa, con tus referencias sobre la mesa.') },
      { t: T('Grabación'), d: T('Las tomas, con el tiempo que hagan falta. Trabajamos técnica y emoción a la par.') },
      { t: T('Mezcla y master'), d: T('Lo dejamos listo para salir a todas las plataformas, con tus pistas para el vivo incluidas.') }
    ];
    var steps = stepData.map(function (s, i) {
      var open = st.step === i;
      return {
        num: '0' + (i + 1), title: s.t, text: s.d,
        expanded: open ? 'true' : 'false',
        accClass: open ? 'zg-acc zg-open' : 'zg-acc',
        pick: function () { self.setState({ step: open ? -1 : i }); },
        btnStyle: 'width: 100%; display: flex; align-items: center; gap: 20px; padding: 20px 0; background: transparent; border: 0; font: inherit; font-size: 18px; text-align: left; cursor: pointer; transition: color 200ms ease; color: ' + (open ? '#FFF4DC' : '#C9A980'),
        iconStyle: 'font-size: 24px; color: #F5A623; transition: transform 350ms cubic-bezier(.23,1,.32,1); transform: rotate(' + (open ? '45deg' : '0deg') + ')'
      };
    });

    var data = [
      { name: 'Ailo Aicardi', text: 'Si querés encontrar tu sonido, es por acá.' },
      { name: 'Juan Gonzalez', text: 'Alto espacio, hermoso ambiente de laburo y laboratorio de arte.' },
      { name: 'Mora Saleh', text: 'Yaco es lo más y el estudio es perfecto para hacer lo que quieras con tu música.' },
      { name: 'Nahe', text: 'Altísimo estudio, la rompen toda, literal.' },
      { name: 'Ana Sofía Waldo del Castillo', text: 'Increíble el espacio. Mucha buena onda y talento.' },
      { name: 'Charo Cassaro', text: 'Muy profesionales, excelentes equipos. Recomiendo mucho para grabar tus primeras canciones.' }
    ];
    var qi = st.q;
    var par = st.qTick % 2;
    var quotes = data.map(function (d, i) {
      var sel = i === qi;
      return {
        name: d.name,
        pressed: sel ? 'true' : 'false',
        pick: function () { self.setState({ q: i, qTick: st.qTick + 1 }); },
        style: 'position: relative; overflow: hidden; font: inherit; font-size: 14px; font-weight: 500; padding: 9px 16px; border-radius: 999px; cursor: pointer; ' + (sel ? 'background: #4B2509; color: #FFF4DC; border: 1px solid #F07800' : 'background: transparent; color: #C9A980; border: 1px solid rgba(240, 224, 192, 0.3)'),
        fill: sel ? 'position: absolute; inset: 0; background: rgba(240, 120, 0, 0.35); transform-origin: 0 50%; animation: zgfill 6000ms linear both' : 'display: none'
      };
    });
    var quoteStyle = 'margin: 0; min-height: 3.3em; font-family: \'Bricolage Grotesque\', sans-serif; font-weight: 600; font-size: 46px; line-height: 1.1; letter-spacing: -0.02em; text-wrap: balance; animation: zgq' + par + ' 700ms cubic-bezier(.16,1,.3,1) both';

    // Packs: precio por mes. Mes a mes, o con el plan de 3 o 6 meses (se resta
    // un monto fijo por mes en los tres packs).
    var PLANS = [
      { id: 'mes', label: T('Mes a mes'), months: 1, w: 120 },
      { id: 'tri', label: T('3 meses'), months: 3, w: 104 },
      { id: 'sem', label: T('6 meses'), months: 6, w: 104 }
    ];
    // Precio por mes de cada pack: mes a mes, plan de 3 meses y plan de 6 meses.
    var PRICE = {
      lab: [260000, 230000, 200000],
      labMM: [350000, 325000, 300000], // Lab con mezcla y master
      release: [400000, 350000, 300000],
      full: [500000, 450000, 400000]
    };
    var pIdx = Math.max(0, PLANS.findIndex(function (x) { return x.id === st.plan; }));
    var plan = PLANS[pIdx];
    var knobLeft = 0; for (var fi = 0; fi < pIdx; fi++) knobLeft += PLANS[fi].w;
    var formats = PLANS.map(function (f, i) {
      var sel = i === pIdx;
      return {
        label: f.label, pressed: sel ? 'true' : 'false',
        pick: function () { if (!sel) self.setState({ plan: f.id, pTick: st.pTick + 1 }); },
        style: 'position: relative; z-index: 1; width: ' + f.w + 'px; border: 0; font: inherit; font-weight: 600; font-size: 15px; padding: 11px 0; border-radius: 999px; cursor: pointer; background: transparent; transition: color 250ms ease; color: ' + (sel ? '#241105' : '#F0E0C0')
      };
    });
    var fmtKnob = 'position: absolute; top: 5px; bottom: 5px; left: 5px; width: ' + PLANS[pIdx].w + 'px; border-radius: 999px; background: #F07800; transition: transform 450ms cubic-bezier(.23,1,.32,1), width 450ms cubic-bezier(.23,1,.32,1); transform: translateX(' + knobLeft + 'px)';
    var disc = pIdx > 0;
    var dealText = !disc ? T('Mes a mes, sin compromiso: cambiás de pack cuando quieras.')
      : T('Con el plan de {n} meses pagás menos cada mes, en cualquier pack.').replace('{n}', plan.months);
    var priceKey = ['lab', 'release', 'full'];
    var labKey = st.labMM ? 'labMM' : 'lab';
    var mmExtra = PRICE.labMM[pIdx] - PRICE.lab[pIdx];
    var tick = function (dark) { return dark ? '#241105' : '#F5A623'; };
    var PK = [
      { id: 'lab', step: '', kicker: T('01 · Nace'), name: 'Zeche Lab', base: 260000, text: T('Creamos, producimos y grabamos tu canción con un productor al lado.'),
        items: [T('4 sesiones de 2 h por mes'), T('Producción y grabación de tu canción'), st.labMM ? T('Mezcla y master de tu canción incluidos') : T('Mezcla y master aparte: +{price} por mes').replace('{price}', fmt(mmExtra)), T('Portal de artistas')],
        takeaway: st.labMM ? T('Tu canción grabada, mezclada y masterizada') : T('Tu canción grabada'), mm: true },
      { id: 'release', step: '+' + fmt(PRICE.release[pIdx] - PRICE[labKey][pIdx]), kicker: T('02 · Sale'), name: 'Zeche Release', base: 420000, badge: T('El más elegido'), text: T('Una canción terminada por mes, lista para salir a todas las plataformas.'),
        items: [T('Todo lo del Lab'), T('Mezcla y master en hasta 15 días'), T('Distribución a todas las plataformas'), T('Pitch a playlists editoriales'), T('Pistas para tus shows y kit de lanzamiento'), T('Tu canción en la playlist del sello')], takeaway: T('Tu canción terminada y en Spotify') },
      { id: 'full', step: '+' + fmt(PRICE.full[pIdx] - PRICE.release[pIdx]), kicker: T('03 · Despega'), name: 'Full Gruv', base: 550000, text: T('Todo lo del Release, más rápido y más lejos.'),
        items: [T('Sesiones de 3 h: 12 h de estudio por mes'), T('Mezcla y master en 7 días'), T('Pitch a editoriales y curadores'), T('Una charla de estrategia por mes')], takeaway: T('Tu canción terminada en 7 días y el plan para lanzarla') }
    ];
    var packs = PK.map(function (p, i) {
      var dark = i === 2, mid = i === 1, picked = st.pack === i;
      var key = i === 0 ? labKey : priceKey[i];
      var price = PRICE[key][pIdx], monthly = PRICE[key][0], save = monthly - price;
      return {
        step: p.step, stepStyle: 'color: ' + (i === 2 ? '#F07800' : '#F5A623') + (p.step ? '' : '; visibility: hidden'),
        cls: 'pk-card pk-' + (i + 1) + (picked ? ' is-pick' : ''),
        box: dark ? 'background: #F07800; color: #241105' : (mid ? 'background: #4B2509; color: #FFF4DC' : 'border: 1.5px solid rgba(240, 224, 192, 0.3); color: #FFF4DC'),
        sun: dark,
        kicker: p.kicker, kickerStyle: "font-family: 'Geist Mono', monospace; font-size: 12px; letter-spacing: 0.18em; text-transform: uppercase; color: " + (dark ? '#3A1A06' : (mid ? '#F5A623' : '#C9A980')),
        hasBadge: !!p.badge, badge: p.badge || '',
        badgeStyle: 'font-size: 13px; font-weight: 600; padding: 7px 12px; border-radius: 999px; white-space: nowrap; ' + (dark ? 'background: #241105; color: #F5A623' : 'background: #F07800; color: #241105'),
        name: p.name, price: fmt(price),
        unitStyle: 'font-weight: 600; font-size: 15px; color: ' + (dark ? '#3A1A06' : '#C9A980'),
        was: disc ? fmt(monthly) : ' ',
        wasStyle: 'font-size: 14px; text-decoration: line-through; min-height: 1.3em; color: ' + (dark ? '#3A1A06' : '#C9A980') + '; opacity: ' + (disc ? '1' : '0') + '; transition: opacity 300ms ease',
        text: p.text,
        items: p.items.map(function (t) { return { t: t, tick: tick(dark) }; }),
        hasNote: !!p.note, note: p.note || '',
        takeaway: p.takeaway,
        total: disc ? T('Ahorrás {save} por mes: {total} en {n} meses.').replace('{save}', fmt(save)).replace('{total}', fmt(save * plan.months)).replace('{n}', plan.months) : T('Una canción por mes'),
        hasMM: !!p.mm, mmPressed: st.labMM ? 'true' : 'false',
        mmLabel: st.labMM ? T('Con mezcla y master') : T('Sumar mezcla y master: +{price}').replace('{price}', fmt(mmExtra)),
        mmToggle: function () { self.setState({ labMM: !st.labMM, pTick: st.pTick + 1 }); },
        mmStyle: 'position: relative; align-self: flex-start; display: inline-flex; align-items: center; gap: 10px; font: inherit; font-size: 14.5px; font-weight: 600; padding: 9px 15px; border-radius: 999px; cursor: pointer; transition: background-color 250ms ease, color 250ms ease, border-color 250ms ease; ' + (st.labMM ? 'background: #F5A623; color: #241105; border: 1px solid #F5A623' : 'background: transparent; color: #F0E0C0; border: 1px solid rgba(240, 224, 192, 0.35)'),
        mmDot: 'width: 16px; height: 16px; border-radius: 50%; box-sizing: border-box; transition: all 250ms ease; ' + (st.labMM ? 'background: #241105; border: 4px solid #FFF4DC' : 'border: 2px solid currentColor'),
        footStyle: 'position: relative; margin-top: auto; border-top: 1px solid ' + (dark ? 'rgba(36, 17, 5, 0.25)' : 'rgba(240, 224, 192, 0.18)') + '; padding-top: 16px; display: flex; flex-direction: column; gap: 6px',
        cta: T('Quiero el {pack}').replace('{pack}', p.name),
        ctaStyle: 'margin-top: 12px; align-self: stretch; border: 0; font: inherit; font-weight: 600; font-size: 16px; padding: 15px 22px; border-radius: 999px; cursor: pointer; ' + (dark ? 'background: #241105; color: #FFF4DC' : 'background: #F07800; color: #241105'),
        choose: function () {
          self.setState({ pack: i, from: 'packs' });
          if (window.zgTrack) window.zgTrack('elegir_pack', { pack: p.name, plan: plan.id });
          var el = document.getElementById('visita');
          if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
          setTimeout(function () { var f = document.getElementById('zg-nombre'); if (f) f.focus({ preventScroll: true }); }, 700);
        }
      };
    });
    var FAQ = [
      [T('¿Puedo cambiar de pack?'), T('Sí, cualquier mes. Subís cuando tenés más para hacer y bajás cuando necesitás un respiro.')],
      [T('¿Cuándo se paga?'), T('Entre el 1 y el 10 de cada mes. Con el plan de 3 o 6 meses pagás cada mes el precio con descuento.')],
      [T('¿Y si necesito grabar más?'), T('Sumás horas extra a $35.000 la hora, en cualquier pack.')],
      [T('¿Los precios cambian?'), T('Se actualizan cada 3 meses, siempre con 30 días de aviso.')]
    ];
    var faqs = FAQ.map(function (f, i) {
      var open = st.faq === i;
      return { q: f[0], a: f[1], expanded: open ? 'true' : 'false', accClass: open ? 'zg-acc zg-open' : 'zg-acc',
        pick: function () { self.setState({ faq: open ? -1 : i }); },
        btnStyle: 'width: 100%; display: flex; align-items: center; gap: 16px; padding: 16px 0; background: transparent; border: 0; font: inherit; font-size: 16.5px; font-weight: 600; text-align: left; cursor: pointer; transition: color 200ms ease; color: ' + (open ? '#FFF4DC' : '#F0E0C0'),
        iconStyle: 'font-size: 22px; color: #F5A623; transition: transform 350ms cubic-bezier(.23,1,.32,1); transform: rotate(' + (open ? '45deg' : '0deg') + ')' };
    });
    var Y = '✓', N = T('No');
    var TBL = [
      ['h', T('En el estudio')],
      [T('Sesiones por mes'), T('4 de 2 h'), T('4 de 2 h'), T('4 de 3 h')],
      [T('Portal de artistas'), Y, Y, Y],
      [T('Seguimiento por WhatsApp'), Y, Y, Y],
      [T('Backup en la nube'), Y, Y, Y],
      [T('Merienda en cada sesión'), Y, Y, Y],
      ['h', T('Tu canción')],
      [T('Mezcla y master'), T('Aparte: +{price} por mes').replace('{price}', fmt(mmExtra)), T('1 por mes'), T('1 por mes')],
      [T('Entrega de mezcla y master'), N, T('Hasta 15 días'), T('7 días')],
      [T('Pistas para tus shows en vivo'), N, Y, Y],
      ['h', T('Lanzamiento')],
      [T('Distribución a todas las plataformas'), N, Y, Y],
      [T('Pitch'), N, T('A editoriales'), T('Editoriales y curadores')],
      [T('Kit de lanzamiento'), N, Y, Y],
      [T('Tu canción en la playlist del sello'), N, Y, Y],
      [T('Charla mensual de estrategia'), N, N, Y]
    ];
    var tableCells = [];
    TBL.forEach(function (r) {
      if (r[0] === 'h') { tableCells.push({ t: r[1], cls: 'pk-h', style: '' }, { t: '', cls: 'pk-h', style: '' }, { t: '', cls: 'pk-h', style: '' }, { t: '', cls: 'pk-h pk-f', style: '' }); return; }
      tableCells.push({ t: r[0], cls: '', style: 'color: #F0E0C0' });
      [r[1], r[2], r[3]].forEach(function (v, k) {
        tableCells.push({ t: v, cls: k === 2 ? 'pk-f' : '', style: 'font-weight: 600; color: ' + (v === N ? '#7E6247' : (v === Y ? (k === 2 ? '#F07800' : '#F5A623') : '#FFF4DC')) + (v === Y ? '; font-size: 18px' : '') });
      });
    });
    // Armá tu pack: modalidad y servicios sueltos (mínimo 2 para consultar).
    // Lo que llega a Netlify y a WhatsApp queda en español.
    // [nombre en español (va a Netlify y WhatsApp), nombre en pantalla,
    //  'horas' = se elige la duración, o el ejemplo para contar el proyecto]
    var CX_SERVICES = [
      ['Sesión de grabación', T('Sesión de grabación'), 'horas'],
      ['Instrumental a medida', T('Instrumental a medida')],
      ['Grabación de instrumentos y coros', T('Grabación de instrumentos y coros')],
      ['Mezcla', T('Mezcla'), T('Contanos el proyecto: cuántas canciones, género, cuántas pistas')],
      ['Mastering', 'Mastering', T('Contanos el proyecto: cuántas canciones y para qué salida')],
      ['Mezcla por stems', T('Mezcla por stems'), T('Contanos el proyecto: cuántas canciones y cuántos stems')],
      ['Pistas y Tune en tu show en vivo', T('Pistas y Tune en tu show en vivo'), T('Contanos el show: fecha, lugar, duración y cuántos temas')],
      ['Distribución', T('Distribución')],
      ['Portada', T('Portada')]
    ];
    var CX_HOURS = [2, 3, 4];
    var CX_MODES = [['Presencial', T('Presencial')], ['Virtual', 'Virtual']];
    var cxSel = st.cxSel || [];
    var cxDetail = st.cxDetail || {};
    var needs = function (i) { var x = CX_SERVICES[i][2]; return x && x !== 'horas'; };
    var cxOk = cxSel.length >= 2 && cxSel.every(function (i) { return !needs(i) || String(cxDetail[i] || '').trim().length >= 3; });
    var cxModes = CX_MODES.map(function (m, i) {
      var on = st.cxMode === i;
      return { label: m[1], checked: on ? 'true' : 'false', pick: function () { if (!on) self.setState({ cxMode: i }); },
        style: 'position: relative; z-index: 1; width: 104px; border: 0; font: inherit; font-weight: 600; font-size: 14px; padding: 9px 0; border-radius: 999px; cursor: pointer; background: transparent; transition: color 250ms ease; color: ' + (on ? '#241105' : '#F0E0C0') };
    });
    var cxKnob = 'position: absolute; top: 4px; bottom: 4px; left: 4px; width: 104px; border-radius: 999px; background: #F07800; transition: transform 400ms cubic-bezier(.23,1,.32,1); transform: translateX(' + (st.cxMode * 104) + 'px)';
    var cxServices = CX_SERVICES.map(function (sv, i) {
      var on = cxSel.indexOf(i) >= 0;
      var isHours = sv[2] === 'horas', hasDetail = needs(i);
      return { label: sv[1], checked: on ? 'true' : 'false',
        cell: 'cx-cell' + (on && (isHours || hasDetail) ? ' cx-wide' : ''),
        pick: function () { var next = on ? cxSel.filter(function (x) { return x !== i; }) : cxSel.concat([i]).sort(function (a, b) { return a - b; }); self.setState({ cxSel: next }); },
        style: 'color: ' + (on ? '#FFF4DC' : '#E2C9A2') + '; font-weight: ' + (on ? '600' : '400'),
        box: 'flex: none; width: 18px; height: 18px; box-sizing: border-box; border-radius: 6px; display: inline-flex; align-items: center; justify-content: center; transition: background-color 200ms ease, border-color 200ms ease; ' + (on ? 'background: #F07800; border: 1.5px solid #F07800' : 'border: 1.5px solid rgba(240, 224, 192, 0.45)'),
        tick: 'transition: opacity 200ms ease, transform 250ms cubic-bezier(.23,1,.32,1); opacity: ' + (on ? '1' : '0') + '; transform: scale(' + (on ? '1' : '0.6') + ')',
        showHours: on && isHours, hoursLabel: T('Duración de la sesión'),
        hours: CX_HOURS.map(function (h) {
          var hs = st.cxHours === h;
          return { label: h + ' h', checked: hs ? 'true' : 'false', pick: function () { self.setState({ cxHours: h }); },
            style: 'font: inherit; font-size: 13.5px; font-weight: 600; padding: 7px 14px; border-radius: 999px; cursor: pointer; transition: background-color 200ms ease, color 200ms ease; ' + (hs ? 'background: #F07800; color: #241105; border: 1px solid #F07800' : 'background: transparent; color: #F0E0C0; border: 1px solid rgba(240, 224, 192, 0.3)') };
        }),
        showDetail: on && hasDetail, detailLabel: hasDetail ? sv[2] : '', detailHint: hasDetail ? sv[2] : '', detail: cxDetail[i] || '',
        onDetail: function (e) { var d = {}; for (var k in self.state.cxDetail) d[k] = self.state.cxDetail[k]; d[i] = e.target.value; self.setState({ cxDetail: d }); }
      };
    });
    var cxNames = cxSel.map(function (i) { return CX_SERVICES[i][1] + (CX_SERVICES[i][2] === 'horas' ? ' ' + st.cxHours + ' h' : ''); });
    var cxTrigger = !cxSel.length ? T('Elegí los servicios')
      : (cxSel.length <= 2 ? cxNames.join(' + ') : T('{n} servicios').replace('{n}', cxSel.length));
    // Lo que llega a Netlify: "Sesión de grabación (3 h), Mezcla (2 canciones de trap)".
    var cxList = cxSel.map(function (i) {
      var sv = CX_SERVICES[i];
      var extra = sv[2] === 'horas' ? st.cxHours + ' h' : (needs(i) ? String(cxDetail[i] || '').trim() : '');
      return sv[0] + (extra ? ' (' + extra + ')' : '');
    }).join(', ');
    var cxValue = st.pack === 4 && cxOk ? cxList : '';
    var cxModeValue = st.pack === 4 && cxOk ? CX_MODES[st.cxMode][0] : '';

    var packNames = ['Zeche Lab', 'Zeche Release', 'Full Gruv', T('Todavía no sé')].concat(st.cxReady ? [T('Pack a medida')] : []);
    var packChips = packNames.map(function (o, i) {
      var sel = st.pack === i;
      return { label: o, pressed: sel ? 'true' : 'false', pick: function () { self.setState({ pack: sel ? -1 : i }); },
        style: 'font: inherit; font-size: 14px; font-weight: 500; padding: 9px 15px; border-radius: 999px; cursor: pointer; ' + (sel ? 'background: #F07800; color: #241105; border: 1px solid #F07800' : 'background: transparent; color: #F0E0C0; border: 1px solid rgba(240, 224, 192, 0.3)') };
    });

    // Cómo nos conoció: lo que llega a Netlify y al mensaje queda en español.
    var originsList = [['Instagram', 'Instagram'], [T('Me recomendaron'), 'Me recomendaron'], ['Open mic', 'Open mic'], ['Google', 'Google'], [T('Otro'), 'Otro']];
    var origins = originsList.map(function (o, i) {
      var sel = st.origin === i;
      return { label: o[0], pressed: sel ? 'true' : 'false', pick: function () { self.setState({ origin: sel ? -1 : i }); },
        style: 'font: inherit; font-size: 14px; font-weight: 500; padding: 9px 15px; border-radius: 999px; cursor: pointer; ' + (sel ? 'background: #F07800; color: #241105; border: 1px solid #F07800' : 'background: transparent; color: #F0E0C0; border: 1px solid rgba(240, 224, 192, 0.3)') };
    });
    var packEs = ['Zeche Lab', 'Zeche Release', 'Full Gruv', 'Todavía no sé', 'Pack a medida'];
    var packValue = st.pack === 4 ? 'Pack a medida (' + CX_MODES[st.cxMode][0].toLowerCase() + '): ' + cxList : st.pack >= 0 ? packEs[st.pack] + (st.pack === 0 && st.labMM ? ' + mezcla y master' : '') + (st.pack < 3 && plan.months > 1 ? ' (plan de ' + plan.months + ' meses)' : '') : '';
    var originValue = st.origin >= 0 ? originsList[st.origin][1] : '';
    // Bandeja de discos
    // Todo el catálogo, del más nuevo al más viejo (el mismo que la web trae de Spotify).
    var CAT = [
      { title: 'Bajo Cero', artist: 'ENY B', year: '2026', kind: 'Single', tag: 'single', url: 'https://open.spotify.com/album/4apeckesjlerL4LitVdh9Z', img: '/assets/web/portada-bajo-cero.webp' },
      { title: 'Adicción', artist: 'Kires', year: '2026', kind: 'Single', tag: 'single', url: 'https://open.spotify.com/album/5WsjhEykJHop88lELb98xI', img: '/assets/web/portada-adiccion.webp' },
      { title: 'OKEY', artist: 'Rouse bby, YEIKO', year: '2026', kind: 'Colaboración', tag: 'colab', url: 'https://open.spotify.com/album/7bc1Ig8bncv4p3vZjjZqjE', img: '/assets/web/portada-okey.webp' },
      { title: 'Predicarle al mundo', artist: 'Tobi Matarasso', year: '2026', kind: 'Single', tag: 'single', url: 'https://open.spotify.com/album/0AvnOP0LQMNdxsWxXZDkfD', img: '' },
      { title: 'TACÚ', artist: 'ZG Camp · 15 artistas', year: '2026', kind: 'Hecho en el camp', tag: 'camp', url: 'https://open.spotify.com/album/6YmySpzsNXMuxekqcmdlGJ', img: '/assets/web/portada-tacu.webp' },
      { title: 'TODO TERRENO', artist: 'Rouse bby, YEIKO, Maida', year: '2026', kind: 'Colaboración', tag: 'colab', url: 'https://open.spotify.com/album/6eU3XioAFeGQsepCbhuDwN', img: '/assets/web/portada-todo-terreno.webp' },
      { title: 'Ríos', artist: 'Tobi Matarasso', year: '2026', kind: 'Single', tag: 'single', url: 'https://open.spotify.com/album/7uRhAMphL3IcYheiu5U9kW', img: '' },
      { title: 'CONTACTO', artist: 'MAKI', year: '2026', kind: 'Single', tag: 'single', url: 'https://open.spotify.com/album/5y4yUX992FbZmHatgYou6h', img: '' },
      { title: 'A.M.03', artist: 'Rouse bby', year: '2026', kind: 'Single', tag: 'single', url: 'https://open.spotify.com/album/0tclMzv83XAOpRtTZduBKy', img: '' },
      { title: 'Ilumina', artist: 'Yaco Santana, Lowkey Santo, Jugo Solar', year: '2025', kind: 'Colaboración', tag: 'colab', url: 'https://open.spotify.com/album/1qOv2qa7iijELxr553DVZS', img: '' },
      { title: 'YANINA', artist: 'Axia Bebe', year: '2025', kind: 'Single', tag: 'single', url: 'https://open.spotify.com/album/5xOkbd52ga0j10hs4ZUdqk', img: '/assets/web/portada-yanina.webp' },
      { title: 'Plutão', artist: 'Vic Maravilla', year: '2025', kind: 'Single', tag: 'single', url: 'https://open.spotify.com/album/2G5d3XEXsb0Nnk7N9LRa77', img: '' },
      { title: 'Me Fui', artist: 'Bianca Biondi', year: '2025', kind: 'Single', tag: 'single', url: 'https://open.spotify.com/album/6LFR12Hh1GNx3hoHwIhZKv', img: '' },
      { title: 'El Mundo Está Jodido', artist: 'Layla Mar', year: '2025', kind: 'Single', tag: 'single', url: 'https://open.spotify.com/track/2PC3Oz8EyFLAlCl3FGWJfw', img: '' },
      { title: 'Ternura y Calentura', artist: 'Vic Maravilla', year: '2025', kind: 'Single', tag: 'single', url: 'https://open.spotify.com/album/3YycPfFdvzoZAdijGlKWgd', img: '' },
      { title: 'Cristalina e Esponjosa', artist: 'Vic Maravilla', year: '2024', kind: 'Single', tag: 'single', url: 'https://open.spotify.com/album/75MN7srmi2n6HN5YtTxnwD', img: '' },
      { title: 'Vic Maravilha', artist: 'Vic Maravilla', year: '2024', kind: 'Single', tag: 'single', url: 'https://open.spotify.com/album/5Ak15VjlhzyCCj0ypYRtBL', img: '' },
      { title: 'A veces', artist: 'Yaco Santana', year: '2024', kind: 'Single', tag: 'single', url: 'https://open.spotify.com/track/0iB6esiqMK4QmDRhheQPQK', img: '' },
      { title: 'ALL STZ Live Session #6', artist: 'Midel, Yaco Santana, Borja Trece, Lowkey Santo y más', year: '2024', kind: 'Colaboración', tag: 'colab', url: 'https://open.spotify.com/track/63mKI1UeGMKru5x0i5haz5', img: '' },
      { title: 'Vum Bora', artist: 'Yaco Santana', year: '2023', kind: 'Single', tag: 'single', url: 'https://open.spotify.com/track/4cWNQP2GEDsivcFyqsqtCf', img: '' },
      { title: 'ALL IN (versión acústica)', artist: 'Borja Trece, Yaco Santana', year: '2022', kind: 'Colaboración', tag: 'colab', url: 'https://open.spotify.com/track/0zmLTTEbr4gtDFxJkgcuYc', img: '' }
    ];
    // Solo los lanzamientos con portada. En la web real las portadas llegan solas
    // desde Spotify (spotify-catalog), así que nunca hay que subirlas a mano.
    // Con el catálogo de Spotify cargado se usa ese: trae todos los
    // lanzamientos con su portada y suma solos los nuevos.
    if (st.cat && st.cat.length) {
      CAT = st.cat.filter(function (it) { return it && it.name && it.cover; }).map(function (it) {
        var artists = String(it.artists || '');
        var multi = artists.indexOf(',') >= 0;
        var camp = /^tac[uú]$/i.test(String(it.name).trim());
        return { title: it.name, artist: artists, year: String(it.releaseDate || '').slice(0, 4), appears: !!it.appearsOn,
          kind: camp ? 'Hecho en el camp' : (it.appearsOn ? 'Aparece en' : (multi ? 'Colaboración' : (it.type === 'album' ? 'Álbum' : (it.type === 'compilation' ? 'Compilado' : 'Single')))),
          tag: camp ? 'camp' : (multi ? 'colab' : 'single'), url: it.url, img: it.cover };
      });
    }
    CAT = CAT.filter(function (r) { return !!r.img; });
    function crNorm(t) { return String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase(); }
    var cq = crNorm(st.crQ).trim();
    var list = CAT.filter(function (r) {
      if (st.crTag === 'y2026' || st.crTag === 'y2025') { if (r.year !== st.crTag.slice(1)) return false; }
      else if (st.crTag === 'yold') { if (+r.year >= 2025) return false; }
      else if (st.crTag !== 'todos' && r.tag !== st.crTag) return false;
      return !cq || crNorm(r.title + ' ' + r.artist).indexOf(cq) >= 0;
    });
    var sel = Math.min(st.crSel, Math.max(0, list.length - 1));
    // Si estaba sonando, el disco nuevo sigue sonando.
    function go(k) {
      if (k < 0 || k >= list.length || k === sel) return;
      var was = self.snd && self.snd.src === 'crate' && self.state.sndPlaying && !self.au.muted;
      self.setState({ crSel: k, crFrom: sel, crPlay: false });
      if (was) {
        self.ttSwap();
        clearTimeout(self.ttNext);
        self.ttNext = setTimeout(function () { self.crListen(k, list[k]); }, 760);
      }
    }
    this.crList = list;
    this.crGo = go;
    var from = Math.min(st.crFrom == null ? sel : st.crFrom, Math.max(0, list.length - 1));
    var crate = list.map(function (r, i) {
      var d = i - sel, tf, op = 1, z = 100 - Math.abs(d);
      if (d === 0) tf = 'translate3d(0, -6%, 40px)';
      else if (d < 0) { tf = 'translate3d(0, 12%, 160px) rotateX(-92deg)'; op = 0; z = 120 + d; }
      else { tf = 'translate3d(0, ' + (-d * 10) + '%, ' + (-d * 64) + 'px) rotateX(5deg)'; op = d > 5 ? 0 : 1; }
      // Cascada: al pasar varios discos de golpe, caen uno detrás del otro.
      var lo = Math.min(from, sel), hi = Math.max(from, sel), delay = 0;
      if (i >= lo && i <= hi) delay = (sel > from ? i - from : hi - i) * (self.crFast ? 18 : 70);
      var hues = ['#4B2509', '#F07800', '#2E1607', '#C98A2B', '#5E300F'];
      var hue = hues[(r.title.length + i) % hues.length];
      return {
        img: r.img, hasImg: !!r.img, noImg: !r.img, artist: r.artist,
        plainStyle: 'background: ' + hue + '; color: ' + (hue === '#F07800' || hue === '#C98A2B' ? '#241105' : '#FFF4DC'),
        title: r.title,
        cls: 'cr-item' + (d === 0 ? ' is-sel' + (st.crPlay ? ' is-play' : '') : d > 0 ? ' is-back' : ' is-front') + (st.crOut && st.crOut === r.title ? ' is-out' : ''),
        style: 'transform: ' + tf + '; opacity: ' + op + '; z-index: ' + z + '; transition-delay: ' + delay + 'ms' + (d > 0 ? '; filter: brightness(' + Math.max(.45, 1 - d * .12).toFixed(2) + ')' : ''),
        labelStyle: r.img ? 'background-image: url(' + r.img + ')' : 'background: ' + hue,
        selected: d === 0 ? 'true' : 'false',
        label: r.title + ', ' + r.artist,
        pick: function (e) { if (self.crMoved) return; if (i === sel) self.crListen(i, r); else go(i); }
      };
    });
    var cur = list[sel];
    var crOn = !!(st.snd && st.snd.src === 'crate' && st.snd.idx === sel && cur && st.snd.title === cur.title);

    // Roster: los artistas con los que colaboró ZECHE GRUV, cada uno a su Spotify.
    var RS = [['Kires', '1Cm1WPdQpZWR1FGoaCQ9Hu'], ['Rouse bby', '5CNzLOwiQx5VhTv44SuCm9'], ['Pazz', '38QjfFQ2Qj5pYKEfP1UZXz'], ['Midel', '4EcIU574ksr6mC1GMEOe0p'], ['Mc Nito', '0EOOwVUWdPElrXOJyKOiBw'], ['Kamacho', '4w0n2oYb0ZEuvlHa1Mnxci'], ['Kizuato', '1CDBZ6ZYceJMFEj5lMn1yi'], ['BR1', '3sqbHtwHxDZQfqFkr03zwX'], ['Casteyano', '2sAeYCtKB9km4OnxZ79F2W'], ['Majo Chicar', '2t1ZWcvmcsJnj9yCRuzvOG'], ['Pastelita', '5sSiBj6y3adorU3bNcO0qi'], ['Sorriso', '4EIzdaX8jUM4b2zKCYh1yj'], ['Tobi Matarasso', '758gJCoI4xZWRgjdlww3iM'], ['Mc Anrry', '4ExMusmx318A1cgA2L2UAP'], ['Axia Bebe', '0ku2WIox3Gy8ZeRTra7khQ'], ['Lusan', '6cdFVBWLuWaXod5b0IqQvx'], ['Borja Trece', '6IsD7NahqpNXMZokr2sScx'], ['Bhae', '3rpv3PztUChhUTcNhHHRku'], ['Anita Pau', '1KMisYLHu9wM1dsT4gTwZz'], ['Layla Mar', '0FFp6MN2W3zcJdWAkCxcg6'], ['Ailo', ''], ['Maki', '4q0qAJSJMhF3n8nq9n2gJX'], ['Bianca Biondi', '4AhBUp7hKgyNz915uFsmCc'], ['Jugo Solar', '5x69KadluL7PwtwALZrTgm'], ['BallerFk', '2kENb15y49pTplwxt9ivd5'], ['Ekiss', '20mwpOinpbsbDIgnqUpFBe'], ['Lowkey Santo', '31xbC0RlsTJT1NOLviy6lD'], ['ENY B', '2TY5OSmjJjYkctYzqxhZe1'], ['Dosis', '3PhscZFnz4MlgNsRPqcs87']];
    var roster = RS.map(function (r, i) {
      var sp = !!r[1];
      return { name: r[0],
        url: sp ? 'https://open.spotify.com/artist/' + r[1] : '/artistas/ailo.html',
        label: sp ? T('{a} en Spotify').replace('{a}', r[0]) : T('Conocé a {a}').replace('{a}', r[0]),
        notLast: i < RS.length - 1 };
    });

    // Buscador de la pila del inicio
    var HERO = ['Adicción', 'TODO TERRENO', 'TACÚ', 'YANINA', 'Bajo Cero'];
    // Los 5 discos del inicio con su link de Spotify (del catálogo; si todavía
    // no cargó, los de acá).
    var HERO_FB = [
      { title: 'Adicción', artist: 'Kires', url: 'https://open.spotify.com/album/5WsjhEykJHop88lELb98xI', img: '/assets/web/portada-adiccion.webp' },
      { title: 'TODO TERRENO', artist: 'Rouse bby, YEIKO, Maida', url: 'https://open.spotify.com/album/6eU3XioAFeGQsepCbhuDwN', img: '/assets/web/portada-todo-terreno.webp' },
      { title: 'TACÚ', artist: 'Admítelo · ZG Camp', url: 'https://open.spotify.com/album/6YmySpzsNXMuxekqcmdlGJ', img: '/assets/web/portada-tacu.webp' },
      { title: 'YANINA', artist: 'Axia Bebe', url: 'https://open.spotify.com/album/5xOkbd52ga0j10hs4ZUdqk', img: '/assets/web/portada-yanina.webp' },
      { title: 'Bajo Cero', artist: 'ENY B', url: 'https://open.spotify.com/album/4apeckesjlerL4LitVdh9Z', img: '/assets/web/portada-bajo-cero.webp' }
    ];
    var heroItems = HERO.map(function (t, k) {
      var r = CAT.filter(function (c) { return crNorm(c.title) === crNorm(t); })[0];
      return r ? { title: r.title, artist: HERO_FB[k].artist, url: r.url, img: HERO_FB[k].img } : HERO_FB[k];
    });
    this.heroItems = heroItems;
    function heroPick(k) { self.setState({ heroSel: k, heroPicked: true }); self.sndPlay('hero', k, heroItems[k]); }
    var npOn = st.snd && st.snd.src === 'hero';
    var npItem = npOn ? st.snd : heroItems[st.heroSel];
    var hq = crNorm(st.heroQ).trim();
    var hHits = hq ? CAT.filter(function (r) { return crNorm(r.title + ' ' + r.artist).indexOf(hq) >= 0; }) : [];
    var hc = {};
    HERO.forEach(function (t, k) { hc['hc' + k] = hHits.some(function (r) { return r.title === t; }) ? 'is-hit' : ''; });
    function toCrate(r) {
      self.setState({ heroSel: Math.max(0, HERO.indexOf(r.title)), heroPicked: true, heroQ: '', heroFocus: false, heroOn: false, crQ: '', crTag: 'todos', crSel: CAT.indexOf(r), crPlay: true });
      var el = document.getElementById('lanzamientos');
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    var hsVisible = st.heroOn || st.heroFocus || !!hq;
    var chipDefs = [['todos', T('Todos')], ['single', T('Singles')], ['colab', T('Colaboraciones')], ['camp', T('Del camp')], ['y2026', '2026'], ['y2025', '2025'], ['yold', T('Antes')]];
    return {
      here_estudio: st.here === 'estudio' ? 'is-here' : '', cur_estudio: st.here === 'estudio' ? 'true' : 'false',
      here_proceso: st.here === 'proceso' ? 'is-here' : '', cur_proceso: st.here === 'proceso' ? 'true' : 'false',
      here_lanzamientos: st.here === 'lanzamientos' ? 'is-here' : '', cur_lanzamientos: st.here === 'lanzamientos' ? 'true' : 'false',
      here_comunidad: st.here === 'comunidad' ? 'is-here' : '', cur_comunidad: st.here === 'comunidad' ? 'true' : 'false',
      here_planes: st.here === 'planes' ? 'is-here' : '', cur_planes: st.here === 'planes' ? 'true' : 'false',
      floatCls: 'zg-float zg-press zg-btn' + (st.floatOff ? ' is-off' : ''),
      spot: function (e) {
        var card = e.target && e.target.closest ? e.target.closest('.zg-bento') : null;
        if (!card) return;
        var r = card.getBoundingClientRect();
        card.style.setProperty('--sx', (e.clientX - r.left) + 'px');
        card.style.setProperty('--sy', (e.clientY - r.top) + 'px');
      },
      errName: st.errName, errWa: st.errWa,
      okName: function () { if (self.state.errName) self.setState({ errName: false }); },
      okWa: function (e) { if (self.state.errWa && e.target.value.replace(/\D/g, '').length >= 8) self.setState({ errWa: false }); },
      badName: st.errName ? 'true' : 'false', badWa: st.errWa ? 'true' : 'false',
      hvLabel: 'background-image: url(' + ['/assets/web/portada-adiccion.webp', '/assets/web/portada-todo-terreno.webp', '/assets/web/portada-tacu.webp', '/assets/web/portada-yanina.webp', '/assets/web/portada-bajo-cero.webp'][st.heroSel] + ')',
      hsel0: st.heroSel === 0 ? 'is-sel' : '', pp0: st.heroSel === 0 ? 'true' : 'false', pick0: function () { heroPick(0); },
      hsel1: st.heroSel === 1 ? 'is-sel' : '', pp1: st.heroSel === 1 ? 'true' : 'false', pick1: function () { heroPick(1); },
      hsel2: st.heroSel === 2 ? 'is-sel' : '', pp2: st.heroSel === 2 ? 'true' : 'false', pick2: function () { heroPick(2); },
      hsel3: st.heroSel === 3 ? 'is-sel' : '', pp3: st.heroSel === 3 ? 'true' : 'false', pick3: function () { heroPick(3); },
      hsel4: st.heroSel === 4 ? 'is-sel' : '', pp4: st.heroSel === 4 ? 'true' : 'false', pick4: function () { heroPick(4); },
      introOn: st.intro !== 'off',
      introCls: 'zg-intro' + (st.intro === 'leaving' ? ' is-leaving' : ''),
      introSunStyle: st.introSun,
      introSunRef: function (el) { self.introSunEl = el; },
      introBtnRef: function (el) { self.introBtn = el; },
      // "Entrá a escuchar" (o tocar el intro): arranca el disco de arriba.
      // El botón está dentro del intro, así que el toque llega dos veces.
      introGo: function () {
        var first = !self.introPlayed;
        self.introPlayed = true;
        self.leaveIntro();
        if (first) self.sndPlay('hero', self.state.heroSel, heroItems[self.state.heroSel]);
      },
      npShow: st.intro !== 'on',
      npCls: 'zg-np' + (npOn && st.sndLoad ? ' is-load' : '') + (npOn && st.sndPlaying ? ' is-on' : ''),
      npPlaying: !!(npOn && st.sndPlaying), npPaused: !(npOn && st.sndPlaying),
      npPlayLabel: npOn && st.sndPlaying ? T('Pausar') : T('Reproducir'),
      npTitle: npItem.title,
      npSub: npOn && st.sndErr ? T('Sin adelanto en Spotify') : (npOn && st.sndLoad ? T('Cargando…') : npItem.artist),
      npUrl: npItem.url,
      npBarStyle: 'transform: scaleX(' + (npOn ? (st.sndPos || 0) : 0).toFixed(3) + ')',
      npToggle: function () { self.sndPlay('hero', st.heroSel, heroItems[st.heroSel]); },
      npNext: function () { heroPick((st.heroSel + 1) % heroItems.length); },
      stackRef: function (el) { self.stack = el; },
      stackCls: 'zg-stack' + (st.intro !== 'on' ? ' has-np' : '') + (st.snd && st.snd.src === 'hero' && st.sndPlaying ? ' is-sound' : '') + (st.intro === 'on' ? ' is-veiled' : st.intro === 'leaving' ? ' is-revealed' : '') + (hq ? ' is-q' : '') + (st.heroPicked ? ' has-pick' : ''),
      hsCls: 'zg-hs' + (hsVisible ? ' is-on' : ''),
      hc0: hc.hc0, hc1: hc.hc1, hc2: hc.hc2, hc3: hc.hc3, hc4: hc.hc4,
      heroQ: st.heroQ,
      hsShowList: !!hq,
      hsHasHits: hHits.length > 0, hsNoHits: !!hq && !hHits.length,
      hsHits: hHits.slice(0, 4).map(function (r) { return { title: r.title, artist: r.artist, img: r.img, go: function (e) { if (e && e.preventDefault) e.preventDefault(); toCrate(r); } }; }),
      hsEnter: function (e) { clearTimeout(self.hsTimer); if (e.pointerType !== 'touch' && !self.state.heroOn) self.setState({ heroOn: true }); },
      // Al sacar el mouse, el buscador espera un momento antes de irse: da tiempo a llegar y escribir.
      hsLeave: function (e) {
        if (e.pointerType === 'touch') return;
        clearTimeout(self.hsTimer);
        self.hsTimer = setTimeout(function () { self.setState({ heroOn: false }); }, 1800);
      },
      hsTap: function (e) { if (e.target && e.target.closest && (e.target.closest('.zg-hs') || e.target.closest('.zg-cv-pick') || e.target.closest('.zg-np'))) return; self.setState({ heroOn: !st.heroOn }); },
      hsType: function (e) { self.setState({ heroQ: e.target.value }); },
      hsFocus: function () { self.setState({ heroFocus: true }); },
      hsBlur: function () { self.setState({ heroFocus: false }); },
      hsKey: function (e) {
        if (e.key === 'Enter' && hHits[0]) { e.preventDefault(); toCrate(hHits[0]); }
        if (e.key === 'Escape') { self.setState({ heroQ: '', heroOn: false }); e.target.blur(); }
      },
      crate: crate,
      roster: roster, rosterCount: T('{n} artistas').replace('{n}', roster.length),
      showRoster: false,
      crNone: !list.length,
      crHas: !!cur,
      crQ: st.crQ,
      crSearch: function (e) { self.sndStop('crate'); self.setState({ crQ: e.target.value, crSel: 0, crPlay: false }); },
      crChips: chipDefs.map(function (c) { return { label: c[1], pressed: st.crTag === c[0] ? 'true' : 'false', pick: function () { self.sndStop('crate'); self.setState({ crTag: c[0], crSel: 0, crPlay: false }); } }; }),
      crKind: cur ? T(cur.kind) + (cur.year ? ' · ' + cur.year : '') : '',
      crUrl: cur ? cur.url : 'https://open.spotify.com',
      crTotal: list.length === CAT.length ? T('{n} lanzamientos').replace('{n}', CAT.length) : T('{a} de {n} lanzamientos').replace('{a}', list.length).replace('{n}', CAT.length),
      crTitle: cur ? cur.title : '',
      crArtist: cur ? cur.artist + (cur.appears ? '' : '. ' + T('Producido en ZECHE GRUV.')) : '',
      crKey2: 't' + sel + (cur ? cur.title : ''), crKey3: 'a' + sel + (cur ? cur.title : ''),
      crCount: list.length ? (sel + 1) + ' / ' + list.length : '0 / 0',
      crAtStart: sel <= 0, crAtEnd: sel >= list.length - 1,
      crPrev: function () { go(sel - 1); },
      crNext: function () { go(sel + 1); },
      crPlayLabel: crOn && st.ttWait ? T('Poniendo el disco…') : crOn && st.sndPlaying ? T('Pausar el vinilo') : (crOn && st.sndErr ? T('Sin adelanto: abrilo en Spotify') : (crOn && st.sndLoad ? T('Cargando…') : T('Sacar el vinilo y escuchar'))),
      crToggle: function () { if (cur) self.crListen(sel, cur); },
      crBarOn: crOn, crBarStyle: 'transform: scaleX(' + (crOn && !st.ttWait ? (st.sndPos || 0) : 0).toFixed(3) + ')',
      crSecRef: function (el) { self.crSec = el; },
      ttRef: function (el) { self.ttEl = el; },
      ttCls: 'tt' + (st.tt && st.tt.img && st.tt.phase !== 'idle' ? ' is-loaded' : '') + (st.tt && (st.tt.phase === 'land' || st.tt.phase === 'down') ? ' is-spin' : '') + (st.tt && st.tt.phase === 'down' ? ' is-down' : '') + (st.tt && st.tt.phase === 'out' ? ' is-out' : '') + (st.tt && st.tt.phase === 'down' && !st.ttWait && st.sndPlaying ? ' is-live' : ''),
      ttLabel: st.tt && st.tt.img ? 'background-image: url(' + st.tt.img + ')' : '',
      crKey: function (e) {
        if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); go(sel + 1); }
        if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); go(sel - 1); }
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (cur) self.crListen(sel, cur); }
      },
      crDown: function (e) { self.crStart = { x: e.clientX, y: e.clientY }; self.crMoved = false; },
      crUp: function (e) {
        var s0 = self.crStart; self.crStart = null;
        if (!s0) return;
        var dx = e.clientX - s0.x, dy = e.clientY - s0.y;
        self.crMoved = Math.abs(dx) > 12 || Math.abs(dy) > 12;
        setTimeout(function () { self.crMoved = false; }, 0);
        if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy)) go(dx < 0 ? sel + 1 : sel - 1);
        else if (e.pointerType !== 'touch' && dy > 40) go(sel + 1);
        else if (e.pointerType !== 'touch' && dy < -40) go(sel - 1);
      },
      heroRef: function (el) { self.hero = el; },
      glow: function (e) {
        if (!self.hero) return;
        var r = self.hero.getBoundingClientRect();
        self.hero.style.setProperty('--mx', (e.clientX - r.left) + 'px');
        self.hero.style.setProperty('--my', (e.clientY - r.top) + 'px');
        // Los discos se separan a medida que el mouse se acerca a la pila.
        if (!self.stack || e.pointerType === 'touch') return;
        var b = self.stack.getBoundingClientRect();
        var cx = b.left + b.width / 2, cy = b.top + b.height / 2;
        var dist = Math.sqrt(Math.pow(e.clientX - cx, 2) + Math.pow(e.clientY - cy, 2));
        var near = Math.max(0, Math.min(1, 1.25 - dist / b.width));
        var px = Math.max(-1, Math.min(1, (e.clientX - cx) / (b.width / 2)));
        var py = Math.max(-1, Math.min(1, (e.clientY - cy) / (b.height / 2)));
        self.stack.style.setProperty('--near', near.toFixed(3));
        self.stack.style.setProperty('--px', px.toFixed(3));
        self.stack.style.setProperty('--py', py.toFixed(3));
      },
      unglow: function () {
        if (!self.stack) return;
        self.stack.style.setProperty('--near', '0');
        self.stack.style.setProperty('--px', '0');
        self.stack.style.setProperty('--py', '0');
      },
      demoOn: st.demo !== 'off',
      demoCls: 'pd' + (st.demo === 'out' ? ' is-out' : ''),
      demoOpen: function () { self.openDemo(); },
      demoClose: function () { self.closeDemo(); },
      demoKey: function (e) { if (e.key === 'Escape') { e.stopPropagation(); self.closeDemo(); } },
      demoXRef: function (el) { self.demoX = el; },
      demoGo: function () { self.closeDemo(); setTimeout(function () { var el = document.getElementById('visita'); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, 280); },
      demoToggle: function () { var on = !st.demoPlay; self.setState({ demoPlay: on, demoN: st.demoN + 1 }); self.demoRun(on); },
      demoPlayLabel: st.demoPlay ? T('Pausar') : T('Reproducir'),
      demoK: 'k' + st.demoN,
      demoC0: st.demoCh === 0, demoC1: st.demoCh === 1, demoC2: st.demoCh === 2, demoC3: st.demoCh === 3,
      demoTab0: st.demoCh < 3 ? 'on' : '', demoTab1: st.demoCh === 3 ? 'on' : '',
      demoChs: [
        [T('Seguís cada canción'), T('Ves en qué etapa está cada tema y te avisamos cuando hay algo para escuchar.')],
        [T('Marcás modificaciones al segundo'), T('Frenás la mezcla donde querés un cambio y lo dejás anotado en ese momento.')],
        [T('Aprobás desde el celular'), T('Cuando suena como querés, un toque y tu canción pasa al master.')],
        [T('Tus letras, con acordes'), T('Escribís los acordes arriba de cada verso y transponés de a medio tono.')]
      ].map(function (c, i) {
        var on = st.demoCh === i;
        return { n: i + 1, t: c[0], d: c[1], cur: on ? 'step' : 'false',
          cls: 'pd-ch' + (on ? ' is-on' : '') + (on && st.demoPlay ? ' is-play' : ''),
          pick: function () { self.setState({ demoCh: i, demoN: st.demoN + 1 }); if (st.demoPlay) self.demoRun(true); } };
      }),
      tkOn: !!tk, tkUrl: tk ? tk.url : '/pass/', tkItems: tk ? [tk, tk, tk, tk] : [],
      tkLabel: tk ? T('Entradas a la venta') + ': ' + tk.date + ', ' + tk.name + '. ' + tk.left + '. ' + T('Comprá tu entrada.') : '',
      campWa: 'https://wa.me/5491133287422?text=' + encodeURIComponent(T('¡Hola! Quiero que me avisen cuando haya un nuevo ZG Camp.')),
      langEs: LANG === 'es' ? 'true' : 'false', langEn: LANG === 'en' ? 'true' : 'false', langPt: LANG === 'pt' ? 'true' : 'false',
      langEsStyle: 'text-decoration: none; padding: 0 4px; color: ' + (LANG === 'es' ? '#FFF4DC' : '#C9A980'),
      langEnStyle: 'text-decoration: none; padding: 0 4px; color: ' + (LANG === 'en' ? '#FFF4DC' : '#C9A980'),
      langPtStyle: 'text-decoration: none; padding: 0 4px; color: ' + (LANG === 'pt' ? '#FFF4DC' : '#C9A980'),
      bars: bars,
      playing: st.playing, notPlaying: !st.playing,
      playLabel: st.playing ? T('Pausar') : T('Reproducir'),
      aDemoRef: function (el) { self.aDemo = el; },
      aMasterRef: function (el) { self.aMaster = el; },
      togglePlay: function () {
        var cur = st.mode === 'demo' ? self.aDemo : self.aMaster;
        if (!cur) return;
        if (st.playing) { cur.pause(); clearInterval(self.posT); self.setState({ playing: false }); return; }
        self.sndStop();
        var p = cur.play(); if (p && p.catch) p.catch(function () {});
        clearInterval(self.posT);
        self.posT = setInterval(function () {
          var a = self.state.mode === 'demo' ? self.aDemo : self.aMaster;
          if (a && a.duration) self.setState({ pos: a.currentTime / a.duration });
        }, 120);
        self.setState({ playing: true });
      },
      progressStyle: 'height: 100%; background: ' + color + '; transform-origin: 0 50%; transform: scaleX(' + pos.toFixed(3) + '); transition: transform 120ms linear, background-color 300ms ease',
      switchKnob: 'position: absolute; top: 4px; bottom: 4px; left: 4px; width: calc(50% - 4px); border-radius: 999px; background: #F07800; transition: transform 400ms cubic-bezier(.23,1,.32,1); transform: translateX(' + knobX + ')',
      demoBtnStyle: mode === 'demo' ? on : off,
      masterBtnStyle: mode === 'master' ? on : off,
      demoPressed: mode === 'demo' ? 'true' : 'false',
      masterPressed: mode === 'master' ? 'true' : 'false',
      // Al cambiar de versión sigue en el mismo segundo, sin cortar.
      pickDemo: function () { self.swapTo('demo'); },
      pickMaster: function () { self.swapTo('master'); },
      caption: mode === 'demo' ? T('Antes: la canción grabada, sin mezcla ni master.') : T('Después: mezclada y masterizada en ZECHE GRUV.'),
      steps: steps,
      quote: data[qi], quotes: quotes, quoteStyle: quoteStyle,
      formats: formats, fmtKnob: fmtKnob,
      dealText: dealText, dealKey: 'd' + st.pTick,
      dealStyle: 'font-weight: 600; font-size: 15px; padding: 9px 16px; border-radius: 999px; animation: zgfade 400ms cubic-bezier(.16,1,.3,1) both; ' + (disc ? 'background: #241105; color: #F5A623' : 'color: #F0E0C0; padding-left: 0'),
      packs: packs,
      priceStyle: 'display: inline-block; font-family: \'Bricolage Grotesque\', sans-serif; font-weight: 800; font-size: 54px; line-height: 1; letter-spacing: -0.03em; animation: zgflip' + (st.pTick % 2) + ' 450ms cubic-bezier(.16,1,.3,1) both',
      faqs: faqs,
      tableCells: tableCells,
      toggleTable: function () { self.setState({ table: !st.table }); },
      tableExpanded: st.table ? 'true' : 'false',
      toggleCustom: function () { self.setState({ custom: !st.custom }); },
      customExpanded: st.custom ? 'true' : 'false',
      customAcc: st.custom ? 'zg-acc zg-open' : 'zg-acc',
      customIcon: 'font-size: 20px; color: #F5A623; transition: transform 350ms cubic-bezier(.23,1,.32,1); transform: rotate(' + (st.custom ? '45deg' : '0deg') + ')',
      cxModes: cxModes, cxKnob: cxKnob, cxServices: cxServices, cxTrigger: cxTrigger,
      cxToggleMenu: function () { self.setState({ cxMenu: !st.cxMenu }); },
      cxMenuExpanded: st.cxMenu ? 'true' : 'false',
      cxMenuAcc: st.cxMenu ? 'zg-acc zg-open' : 'zg-acc',
      cxChevron: 'display: inline-flex; color: #F5A623; transition: transform 350ms cubic-bezier(.23,1,.32,1); transform: rotate(' + (st.cxMenu ? '180deg' : '0deg') + ')',
      cxDisabled: cxOk ? 'false' : 'true',
      cxSendStyle: 'border: 0; font: inherit; font-weight: 600; font-size: 15px; padding: 12px 20px; border-radius: 999px; white-space: nowrap; background: #F07800; color: #241105; transition: opacity 250ms ease, transform 250ms ease; ' + (cxOk ? 'opacity: 1; cursor: pointer' : 'opacity: 0.38; cursor: default; pointer-events: none'),
      cxSend: function () {
        if (!cxOk) return;
        self.setState({ cxReady: true, pack: 4, cxMenu: false, from: 'pack a medida' });
        if (window.zgTrack) window.zgTrack('elegir_pack', { pack: 'Pack a medida', servicios: cxSel.length, modalidad: CX_MODES[st.cxMode][0] });
        var el = document.getElementById('visita');
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
        setTimeout(function () { var f = document.getElementById('zg-nombre'); if (f) f.focus({ preventScroll: true }); }, 700);
      },
      cxValue: cxValue, cxModeValue: cxModeValue,
      tableLabel: st.table ? T('Ocultar la comparación') : T('Ver todo, pack por pack'),
      tableAcc: st.table ? 'zg-acc zg-open' : 'zg-acc',
      tableIcon: 'font-size: 20px; color: #F5A623; transition: transform 350ms cubic-bezier(.23,1,.32,1); transform: rotate(' + (st.table ? '45deg' : '0deg') + ')',
      packChips: packChips,
      sentText: st.pack === 4 ? T('Te escribimos por WhatsApp con el presupuesto de tu pack y para elegir el día de tu visita.') : st.pack >= 0 && st.pack < 3 ? T('Te escribimos por WhatsApp para elegir el día de tu visita y charlar del {pack}.').replace('{pack}', packNames[st.pack]) : T('Te escribimos por WhatsApp para elegir el día de tu visita.'),
      origins: origins,
      notSent: !st.sent, sent: st.sent,
      packValue: packValue, originValue: originValue, fromValue: st.from || 'web', langValue: LANG,
      sending: st.sending, sendLabel: st.sending ? T('Enviando…') : T('Reservá tu visita'),
      waNow: 'https://wa.me/5491133287422?text=' + encodeURIComponent('Hola ZECHE GRUV! Quiero ir a conocer el estudio 🙌\n'
        + 'Nombre artístico: ' + (st.sentName || '') + '\n'
        + (packValue ? 'Pack: ' + packValue + '\n' : '')
        + '(Vengo de la web · ' + (st.from || 'web') + ')'),
      send: function (e) {
        if (e && e.preventDefault) e.preventDefault();
        if (st.sending) return;
        var form = e && e.target && e.target.tagName === 'FORM' ? e.target : document.querySelector('form[name="visita-estudio"]');
        var n = document.getElementById('zg-nombre'), w = document.getElementById('zg-wa');
        var badN = !n || !n.value.trim();
        var badW = !w || w.value.replace(/\D/g, '').length < 8;
        if (badN || badW) { self.setState({ errName: badN, errWa: badW }); (badN ? n : w).focus(); return; }
        var body = new URLSearchParams(new FormData(form)).toString();
        var name = n.value.trim();
        self.setState({ sending: true, errName: false, errWa: false });
        // Se guarda en Netlify Forms (te llega el aviso). Si tarda o falla la
        // red, igual se muestra la confirmación con el botón de WhatsApp.
        var done = function () { self.setState({ sending: false, sent: true, sentName: name }); };
        Promise.race([
          fetch('/', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: body }),
          new Promise(function (r) { setTimeout(r, 6000); })
        ]).then(done, done);
        if (window.zgTrack) window.zgTrack('reserva_visita', { boton: st.from || 'web', pack: packValue || 'sin elegir' });
      },
      reset: function () { self.setState({ sent: false, origin: -1, pack: -1, errName: false, errWa: false }); }
    };
  }
}
