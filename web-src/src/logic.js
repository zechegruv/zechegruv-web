class Component extends DCLogic {
  constructor(props) {
    super(props);
    this.state = { intro: 'on', introSun: '', heroSel: 4, heroPicked: false, here: '', floatOff: false, errName: false, errWa: false, crFrom: null, heroQ: '', heroOn: false, heroFocus: false, crQ: '', crSel: 0, crTag: 'todos', crPlay: false, demo: 'off', demoCh: 0, demoPlay: true, demoN: 0, mode: 'demo', pos: 0, playing: false, q: 0, qTick: 0, step: 0, plan: 'mes', labMM: false, ev: null, cat: null, sending: false, from: 'web', pack: -1, faq: -1, table: false, pTick: 0, sent: false, origin: -1, now: Date.now() };
    this.hero = null;
    this.stack = null;
  }
  componentDidMount() {
    var self = this;
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
  componentWillUnmount() { clearInterval(this.demoT); clearInterval(this.posT); if (this.aDemo) this.aDemo.pause(); if (this.aMaster) this.aMaster.pause(); clearTimeout(this.introT); clearInterval(this.timer); clearTimeout(this.hsTimer); if (this.io) this.io.disconnect(); if (this.io2) this.io2.disconnect(); document.removeEventListener('click', this.onAnyClick, true); }
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
      [T('¿Y si necesito grabar más?'), T('Sumás horas extra a $40.000 la hora, en cualquier pack.')],
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
    var packNames = ['Zeche Lab', 'Zeche Release', 'Full Gruv', T('Todavía no sé')];
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
    var packEs = ['Zeche Lab', 'Zeche Release', 'Full Gruv', 'Todavía no sé'];
    var packValue = st.pack >= 0 ? packEs[st.pack] + (st.pack === 0 && st.labMM ? ' + mezcla y master' : '') + (st.pack < 3 && plan.months > 1 ? ' (plan de ' + plan.months + ' meses)' : '') : '';
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
    function go(k) { if (k >= 0 && k < list.length && k !== sel) self.setState({ crSel: k, crFrom: sel, crPlay: false }); }
    var from = Math.min(st.crFrom == null ? sel : st.crFrom, Math.max(0, list.length - 1));
    var crate = list.map(function (r, i) {
      var d = i - sel, tf, op = 1, z = 100 - Math.abs(d);
      if (d === 0) tf = 'translate3d(0, -6%, 40px)';
      else if (d < 0) { tf = 'translate3d(0, 12%, 160px) rotateX(-92deg)'; op = 0; z = 120 + d; }
      else { tf = 'translate3d(0, ' + (-d * 10) + '%, ' + (-d * 64) + 'px) rotateX(5deg)'; op = d > 5 ? 0 : 1; }
      // Cascada: al pasar varios discos de golpe, caen uno detrás del otro.
      var lo = Math.min(from, sel), hi = Math.max(from, sel), delay = 0;
      if (i >= lo && i <= hi) delay = (sel > from ? i - from : hi - i) * 70;
      var hues = ['#4B2509', '#F07800', '#2E1607', '#C98A2B', '#5E300F'];
      var hue = hues[(r.title.length + i) % hues.length];
      return {
        img: r.img, hasImg: !!r.img, noImg: !r.img, artist: r.artist,
        plainStyle: 'background: ' + hue + '; color: ' + (hue === '#F07800' || hue === '#C98A2B' ? '#241105' : '#FFF4DC'),
        title: r.title,
        cls: 'cr-item' + (d === 0 ? ' is-sel' + (st.crPlay ? ' is-play' : '') : d > 0 ? ' is-back' : ' is-front'),
        style: 'transform: ' + tf + '; opacity: ' + op + '; z-index: ' + z + '; transition-delay: ' + delay + 'ms' + (d > 0 ? '; filter: brightness(' + Math.max(.45, 1 - d * .12).toFixed(2) + ')' : ''),
        labelStyle: r.img ? 'background-image: url(' + r.img + ')' : 'background: ' + hue,
        selected: d === 0 ? 'true' : 'false',
        label: r.title + ', ' + r.artist,
        pick: function (e) { if (self.crMoved) return; if (i === sel) self.setState({ crPlay: !st.crPlay }); else go(i); }
      };
    });
    var cur = list[sel];

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
      hsel0: st.heroSel === 0 ? 'is-sel' : '', pp0: st.heroSel === 0 ? 'true' : 'false', pick0: function () { self.setState({ heroSel: 0, heroPicked: true }); },
      hsel1: st.heroSel === 1 ? 'is-sel' : '', pp1: st.heroSel === 1 ? 'true' : 'false', pick1: function () { self.setState({ heroSel: 1, heroPicked: true }); },
      hsel2: st.heroSel === 2 ? 'is-sel' : '', pp2: st.heroSel === 2 ? 'true' : 'false', pick2: function () { self.setState({ heroSel: 2, heroPicked: true }); },
      hsel3: st.heroSel === 3 ? 'is-sel' : '', pp3: st.heroSel === 3 ? 'true' : 'false', pick3: function () { self.setState({ heroSel: 3, heroPicked: true }); },
      hsel4: st.heroSel === 4 ? 'is-sel' : '', pp4: st.heroSel === 4 ? 'true' : 'false', pick4: function () { self.setState({ heroSel: 4, heroPicked: true }); },
      introOn: st.intro !== 'off',
      introCls: 'zg-intro' + (st.intro === 'leaving' ? ' is-leaving' : ''),
      introSunStyle: st.introSun,
      introSunRef: function (el) { self.introSunEl = el; },
      introBtnRef: function (el) { self.introBtn = el; },
      introGo: function () { self.leaveIntro(); },
      stackRef: function (el) { self.stack = el; },
      stackCls: 'zg-stack' + (st.intro === 'on' ? ' is-veiled' : st.intro === 'leaving' ? ' is-revealed' : '') + (hq ? ' is-q' : '') + (st.heroPicked ? ' has-pick' : ''),
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
      hsTap: function (e) { if (e.target && e.target.closest && (e.target.closest('.zg-hs') || e.target.closest('.zg-cv-pick'))) return; self.setState({ heroOn: !st.heroOn }); },
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
      crSearch: function (e) { self.setState({ crQ: e.target.value, crSel: 0, crPlay: false }); },
      crChips: chipDefs.map(function (c) { return { label: c[1], pressed: st.crTag === c[0] ? 'true' : 'false', pick: function () { self.setState({ crTag: c[0], crSel: 0, crPlay: false }); } }; }),
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
      crPlayLabel: st.crPlay ? T('Pausar el vinilo') : T('Sacar el vinilo y escuchar'),
      crToggle: function () { self.setState({ crPlay: !st.crPlay }); },
      crKey: function (e) {
        if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); go(sel + 1); }
        if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); go(sel - 1); }
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); self.setState({ crPlay: !st.crPlay }); }
      },
      crDown: function (e) { self.crStart = { x: e.clientX, y: e.clientY }; self.crMoved = false; },
      crUp: function (e) {
        var s0 = self.crStart; self.crStart = null;
        if (!s0) return;
        var dx = e.clientX - s0.x, dy = e.clientY - s0.y;
        self.crMoved = Math.abs(dx) > 12 || Math.abs(dy) > 12;
        setTimeout(function () { self.crMoved = false; }, 0);
        if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy)) go(dx < 0 ? sel + 1 : sel - 1);
        else if (dy > 40) go(sel + 1);
        else if (dy < -40) go(sel - 1);
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
      tableLabel: st.table ? T('Ocultar la comparación') : T('Ver todo, pack por pack'),
      tableAcc: st.table ? 'zg-acc zg-open' : 'zg-acc',
      tableIcon: 'font-size: 20px; color: #F5A623; transition: transform 350ms cubic-bezier(.23,1,.32,1); transform: rotate(' + (st.table ? '45deg' : '0deg') + ')',
      packChips: packChips,
      sentText: st.pack >= 0 && st.pack < 3 ? T('Te escribimos por WhatsApp para elegir el día de tu visita y charlar del {pack}.').replace('{pack}', packNames[st.pack]) : T('Te escribimos por WhatsApp para elegir el día de tu visita.'),
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
