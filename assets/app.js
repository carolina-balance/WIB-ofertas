/* ============================================================
   WIB · Tablón de Ofertas
   ------------------------------------------------------------
   Los datos llegan por dos vías:
     1. data/ofertas.json  — lo escribe la GitHub Action. Instantáneo
        y siempre disponible, aunque el Apps Script esté caído.
     2. El Apps Script      — se pide en segundo plano para recoger
        lo que se haya editado en el sheet desde el último commit.
   Favoritas y seguimiento viven solo en el navegador de cada una.
   ============================================================ */

(function () {
  'use strict';

  var CFG = window.WIB_CONFIG || {};
  var DIAS_NUEVA    = CFG.DIAS_NUEVA    || 10;
  var DIAS_URGENTE  = CFG.DIAS_URGENTE  || 7;
  var NUM_DESTACADAS = CFG.NUM_DESTACADAS || 3;

  var CAMPOS = ['tipo', 'sector', 'ciudad'];

  /**
   * Un color por sector. No es decoración: con 60+ ofertas en pantalla,
   * el color es lo que te deja localizar "lo de tech" sin leer una palabra.
   *
   * Todos viven en la misma familia de marca y recorren el arco azul
   * marino → azul → violeta → lila → magenta → rosa. Nada de verdes ni
   * naranjas: se distinguen igual y el tablón entero se lee como un solo
   * degradado en vez de como un muestrario.
   */
  var COLORES_SECTOR = {
    'Consultoría':               '#31408c',
    'Finanzas':                  '#3f5fc0',
    'Derecho & Política':        '#5681d8',
    'Ciencia & Salud':           '#6f9ae0',
    'Tech & IA':                 '#6d4fd0',
    'Emprendimiento & Business': '#8a5ad8',
    'Arte & Cultura':            '#a86ede',
    'Moda & Retail':             '#c25bc0',
    'Marketing & Comunicación':  '#d94f8f',
    'RRHH':                      '#e0577a'
  };

  var PALETA = ['#31408c', '#3f5fc0', '#5681d8', '#6f9ae0', '#6d4fd0',
                '#8a5ad8', '#a86ede', '#c25bc0', '#d94f8f', '#e0577a'];

  /** Sectores que aún no son canónicos también reciben color, por hash. */
  function colorSector(nombre) {
    if (!nombre) return '#5a6480';
    return COLORES_SECTOR[nombre] || PALETA[hashTexto(plano(nombre)) % PALETA.length];
  }

  function colorDe(oferta) {
    return colorSector((oferta.sector || [])[0]);
  }

  var ETIQUETAS_ESTADO = [
    ['',           'Sin seguimiento'],
    ['aplicada',   'Aplicada'],
    ['entrevista', 'Entrevista'],
    ['oferta',     '¡Oferta!'],
    ['rechazada',  'Rechazada']
  ];

  /* ---------- Referencias al DOM ---------- */

  var $ = function (sel) { return document.querySelector(sel); };

  var elLista       = $('#lista');
  var elEsqueleto   = $('#esqueleto');
  var elVacia       = $('#zonaVacia');
  var elRecuento    = $('#recuento');
  var elPildoras    = $('#pildorasActivas');
  var elLimpiar     = $('#btnLimpiar');
  var elBusqueda    = $('#busqueda');
  var elOrden       = $('#orden');
  var elSoloFav     = $('#soloFavoritas');
  var elConmFav     = $('#conmFavoritas');
  var elDestacadas  = $('#destacadas');
  var elRejillaDest = $('#rejillaDestacadas');
  var elBarajar     = $('#btnBarajar');
  var elCifras      = $('#cifras');
  var elFrescura    = $('#frescura');
  var elBrindis     = $('#brindis');
  var elTema        = $('#btnTema');
  var elIconoTema   = $('#iconoTema');

  /* ---------- Estado ---------- */

  var estado = {
    ofertas: [],
    generado: '',
    q: '',
    filtros: { tipo: [], sector: [], ciudad: [] },
    soloFavoritas: false,
    orden: 'recomendado',
    barajadas: 0,
    destacada: null
  };

  var favoritas = new Set(leerAlmacen('wib:favoritas', []));
  var seguimiento = leerAlmacen('wib:seguimiento', {});

  /* ============================================================
     Utilidades
     ============================================================ */

  function leerAlmacen(clave, porDefecto) {
    try {
      var crudo = localStorage.getItem(clave);
      return crudo ? JSON.parse(crudo) : porDefecto;
    } catch (e) {
      return porDefecto;
    }
  }

  function guardarAlmacen(clave, valor) {
    try {
      localStorage.setItem(clave, JSON.stringify(valor));
    } catch (e) {
      /* Modo privado o almacenamiento lleno: se pierde al recargar y ya. */
    }
  }

  function esc(texto) {
    return String(texto == null ? '' : texto)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function plano(texto) {
    return String(texto == null ? '' : texto)
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');
  }

  function hoy() {
    var d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), d.getDate());
  }

  /** Días desde una fecha "AAAA-MM-DD". Negativo = en el futuro. */
  function diasDesde(iso) {
    if (!iso) return null;
    var partes = String(iso).split('-');
    if (partes.length !== 3) return null;
    var fecha = new Date(+partes[0], +partes[1] - 1, +partes[2]);
    if (isNaN(fecha)) return null;
    return Math.round((hoy() - fecha) / 86400000);
  }

  function esNueva(oferta) {
    var d = diasDesde(oferta.alta);
    return d !== null && d >= 0 && d <= DIAS_NUEVA;
  }

  /** Días que faltan para el cierre, o null si no hay fecha. */
  function diasParaCierre(oferta) {
    var d = diasDesde(oferta.cierre);
    return d === null ? null : -d;
  }

  function esUrgente(oferta) {
    var d = diasParaCierre(oferta);
    return d !== null && d >= 0 && d <= DIAS_URGENTE;
  }

  function estaCerrada(oferta) {
    var d = diasParaCierre(oferta);
    return d !== null && d < 0;
  }

  /** Generador pseudoaleatorio reproducible (mulberry32). */
  function prng(semilla) {
    var a = semilla >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /**
   * Semilla del día: la selección rota cada 24 h, pero se mantiene
   * estable mientras navegas (nada peor que una lista que baila sola).
   * El botón Barajar suma vueltas para forzar una mezcla nueva.
   */
  function semillaActual() {
    var d = hoy();
    var base = d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
    return base + estado.barajadas * 7919;
  }

  function barajar(lista, semilla) {
    var copia = lista.slice();
    var azar = prng(semilla);
    for (var i = copia.length - 1; i > 0; i--) {
      var j = Math.floor(azar() * (i + 1));
      var tmp = copia[i]; copia[i] = copia[j]; copia[j] = tmp;
    }
    return copia;
  }

  function iniciales(empresa) {
    var palabras = String(empresa || '?')
      .split(/\s+/)
      .filter(function (p) { return p && p !== '&' && p !== '+'; });
    if (!palabras.length) return '?';
    if (palabras.length === 1) return palabras[0].slice(0, 3).toUpperCase();
    return (palabras[0][0] + palabras[1][0]).toUpperCase();
  }

  function hashTexto(texto) {
    var h = 0;
    for (var i = 0; i < texto.length; i++) {
      h = (h * 31 + texto.charCodeAt(i)) >>> 0;
    }
    return h;
  }

  function brindis(mensaje) {
    elBrindis.textContent = mensaje;
    elBrindis.classList.add('visible');
    clearTimeout(brindis._t);
    brindis._t = setTimeout(function () {
      elBrindis.classList.remove('visible');
    }, 2400);
  }

  function fechaRelativa(iso) {
    if (!iso) return '';
    var cuando = new Date(iso);
    if (isNaN(cuando)) return '';
    var minutos = Math.round((Date.now() - cuando) / 60000);
    if (minutos < 2) return 'hace un momento';
    if (minutos < 60) return 'hace ' + minutos + ' min';
    var horas = Math.round(minutos / 60);
    if (horas < 24) return 'hace ' + horas + (horas === 1 ? ' hora' : ' horas');
    var dias = Math.round(horas / 24);
    return 'hace ' + dias + (dias === 1 ? ' día' : ' días');
  }

  /* ============================================================
     Carga de datos
     ============================================================ */

  function aplicarDatos(datos, origen) {
    var ofertas = (datos && datos.ofertas) || [];

    // El refresco en vivo no conoce las fechas de alta (las memoriza la
    // Action en el fichero). Se recuperan por id para no perder los NUEVO.
    if (origen === 'vivo') {
      var altas = {};
      estado.ofertas.forEach(function (o) {
        if (o.id) altas[o.id] = o.alta || '';
      });
      ofertas.forEach(function (o) {
        if (o.alta === undefined) o.alta = altas[o.id] || '';
      });
    }

    estado.ofertas = ofertas;
    estado.generado = (datos && (datos.generado || datos.actualizado)) || '';
    pintarTodo();
  }

  function cargarFichero() {
    return fetch('data/ofertas.json?t=' + Date.now(), { cache: 'no-store' })
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      });
  }

  function cargarEnVivo() {
    var url = CFG.APPS_SCRIPT_URL || '';
    if (!url || url.indexOf('PEGA_AQUI') === 0) return Promise.reject(new Error('sin configurar'));

    var ctrl = new AbortController();
    var corte = setTimeout(function () { ctrl.abort(); }, 12000);
    return fetch(url, { signal: ctrl.signal })
      .then(function (r) {
        clearTimeout(corte);
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      });
  }

  function arrancarDatos() {
    cargarFichero()
      .then(function (datos) {
        aplicarDatos(datos, 'fichero');
      })
      .catch(function () {
        // Sin fichero (primer despliegue) esperamos al Apps Script.
        estado.ofertas = [];
      })
      .then(function () {
        return cargarEnVivo()
          .then(function (datos) {
            if (datos && Array.isArray(datos.ofertas) && datos.ofertas.length) {
              aplicarDatos(datos, 'vivo');
            }
          })
          .catch(function () {
            // El Apps Script puede fallar o no estar configurado todavía:
            // el fichero del repositorio ya nos ha dejado la web usable.
            if (!estado.ofertas.length) mostrarErrorCarga();
          });
      });
  }

  function mostrarErrorCarga() {
    elEsqueleto.hidden = true;
    elLista.hidden = true;
    elRecuento.textContent = '';
    elVacia.innerHTML =
      '<div class="vacio"><h3>No hemos podido cargar las ofertas</h3>' +
      '<p>Puede ser un problema puntual de conexión. Prueba a recargar la página en unos segundos.</p>' +
      '<button class="btn-barajar" onclick="location.reload()">Recargar</button></div>';
  }

  /* ============================================================
     Filtrado y orden
     ============================================================ */

  function coincideBusqueda(oferta, consulta) {
    if (!consulta) return true;
    var heno = plano([
      oferta.empresa, oferta.puesto, oferta.descripcion,
      (oferta.ciudad || []).join(' '),
      (oferta.sector || []).join(' '),
      (oferta.tipo || []).join(' ')
    ].join(' '));
    return consulta.split(/\s+/).every(function (palabra) {
      return heno.indexOf(palabra) >= 0;
    });
  }

  function coincideCampo(oferta, campo, seleccion) {
    if (!seleccion.length) return true;
    var valores = oferta[campo] || [];
    return seleccion.some(function (v) { return valores.indexOf(v) >= 0; });
  }

  /** Filtra, opcionalmente ignorando un campo (para contar facetas). */
  function filtrar(ignorar) {
    var consulta = plano(estado.q).trim();
    return estado.ofertas.filter(function (o) {
      if (estado.soloFavoritas && !favoritas.has(o.id)) return false;
      if (!coincideBusqueda(o, consulta)) return false;
      for (var i = 0; i < CAMPOS.length; i++) {
        var campo = CAMPOS[i];
        if (campo === ignorar) continue;
        if (!coincideCampo(o, campo, estado.filtros[campo])) return false;
      }
      return true;
    });
  }

  function ordenar(lista) {
    var semilla = semillaActual();

    if (estado.orden === 'empresa') {
      return lista.slice().sort(function (a, b) {
        return (a.empresa || '').localeCompare(b.empresa || '', 'es');
      });
    }

    if (estado.orden === 'nuevas') {
      return lista.slice().sort(function (a, b) {
        return String(b.alta || '').localeCompare(String(a.alta || ''));
      });
    }

    if (estado.orden === 'cierre') {
      return lista.slice().sort(function (a, b) {
        var da = diasParaCierre(a), db = diasParaCierre(b);
        // Las que no tienen fecha van al final, no delante.
        if (da === null && db === null) return 0;
        if (da === null) return 1;
        if (db === null) return -1;
        return da - db;
      });
    }

    /* "Recomendado": lo urgente y lo nuevo arriba; el resto rota cada día
       para que la visibilidad no se quede siempre en las mismas ofertas. */
    var nuevas = [], urgentes = [], resto = [], cerradas = [];
    lista.forEach(function (o) {
      if (estaCerrada(o)) cerradas.push(o);
      else if (esNueva(o)) nuevas.push(o);
      else if (esUrgente(o)) urgentes.push(o);
      else resto.push(o);
    });

    return barajar(nuevas, semilla)
      .concat(barajar(urgentes, semilla + 1))
      .concat(barajar(resto, semilla + 2))
      .concat(cerradas);
  }

  function elegirDestacadas(lista) {
    var azar = prng(semillaActual() + 31);
    var puntuadas = lista
      .filter(function (o) { return o.link && !estaCerrada(o); })
      .map(function (o) {
        var puntos = azar() * 30;
        if (esNueva(o)) puntos += 34;
        if (esUrgente(o)) puntos += 22;
        if (o.puesto) puntos += 6;
        return { oferta: o, puntos: puntos };
      })
      .sort(function (a, b) { return b.puntos - a.puntos; });

    // Evitamos repetir empresa en el podio salvo que no quede otra.
    var elegidas = [], empresas = {};
    puntuadas.forEach(function (p) {
      if (elegidas.length >= NUM_DESTACADAS) return;
      var clave = plano(p.oferta.empresa);
      if (empresas[clave]) return;
      empresas[clave] = true;
      elegidas.push(p.oferta);
    });
    for (var i = 0; elegidas.length < NUM_DESTACADAS && i < puntuadas.length; i++) {
      if (elegidas.indexOf(puntuadas[i].oferta) < 0) elegidas.push(puntuadas[i].oferta);
    }
    return elegidas;
  }

  /* ============================================================
     Pintado
     ============================================================ */

  function pintarTodo() {
    var visibles = ordenar(filtrar());
    pintarCifras();
    pintarFiltros();
    pintarDestacadas();
    pintarPildoras();
    pintarLista(visibles);
    pintarFrescura();
    escribirHash();
  }

  function pintarCifras() {
    var todas = estado.ofertas;
    var nuevas = todas.filter(esNueva).length;
    var unicos = function (campo) {
      var set = {};
      todas.forEach(function (o) {
        (o[campo] || []).forEach(function (v) { set[v] = true; });
      });
      return Object.keys(set).length;
    };
    var empresas = {};
    todas.forEach(function (o) { if (o.empresa) empresas[plano(o.empresa)] = true; });

    var cifras = [];
    if (nuevas) cifras.push([nuevas, nuevas === 1 ? 'nueva esta semana' : 'nuevas estos días']);
    cifras.push([todas.length, 'oportunidades abiertas']);
    cifras.push([Object.keys(empresas).length, 'empresas']);
    cifras.push([unicos('sector'), 'sectores']);
    cifras.push([unicos('ciudad'), 'ciudades']);

    elCifras.innerHTML = cifras.map(function (c) {
      return '<div class="cifra"><b>' + c[0] + '</b><span>' + esc(c[1]) + '</span></div>';
    }).join('');
  }

  function pintarFiltros() {
    CAMPOS.forEach(function (campo) {
      var detalle = document.querySelector('.filtro[data-campo="' + campo + '"]');
      if (!detalle) return;
      var panel = detalle.querySelector('.panel');
      var contador = detalle.querySelector('.cuenta');

      // Los recuentos se calculan ignorando este mismo campo: así ves
      // cuántas ofertas sumarías al marcar una opción, no cero.
      var base = filtrar(campo);
      var cuentas = {};
      base.forEach(function (o) {
        (o[campo] || []).forEach(function (v) { cuentas[v] = (cuentas[v] || 0) + 1; });
      });

      var todos = {};
      estado.ofertas.forEach(function (o) {
        (o[campo] || []).forEach(function (v) { todos[v] = true; });
      });

      var opciones = Object.keys(todos).sort(function (a, b) {
        var d = (cuentas[b] || 0) - (cuentas[a] || 0);
        return d !== 0 ? d : a.localeCompare(b, 'es');
      });

      panel.innerHTML = opciones.length
        ? opciones.map(function (v) {
            var marcado = estado.filtros[campo].indexOf(v) >= 0;
            return '<label><input type="checkbox" value="' + esc(v) + '"' +
              (marcado ? ' checked' : '') + '>' + esc(v) +
              '<span class="n">' + (cuentas[v] || 0) + '</span></label>';
          }).join('')
        : '<label style="color:var(--ink-3)">Sin opciones</label>';

      var n = estado.filtros[campo].length;
      contador.textContent = n;
      contador.hidden = n === 0;
    });
  }

  function pintarDestacadas() {
    // El carrusel destaca sobre el catálogo entero, no sobre lo filtrado:
    // si no, al filtrar mostraría lo mismo que la lista de abajo.
    var elegidas = elegirDestacadas(estado.ofertas);
    if (elegidas.length < 2) { elDestacadas.hidden = true; return; }
    elDestacadas.hidden = false;

    elRejillaDest.innerHTML = elegidas.map(function (o) {
      var marcas = [];
      if (esNueva(o)) marcas.push('<span class="etq etq-nueva">NUEVO</span>');
      if (esUrgente(o)) marcas.push('<span class="etq etq-urgente">Cierra en ' + diasParaCierre(o) + ' d</span>');
      var lugar = (o.ciudad || []).join(' · ') || 'Sin ubicación fija';
      return '<a class="destacada" href="' + esc(o.link) + '" target="_blank" rel="noopener"' +
        ' data-destacada="' + esc(o.id) + '" style="--acento:' + colorDe(o) + '">' +
        '<span class="d-empresa">' +
          ((o.tipo || []).length ? '<b>' + esc((o.tipo || []).join(' / ')) + '</b> ' : '') +
          esc(o.empresa) + '</span>' +
        '<span class="d-puesto">' + esc(titulo(o)) + '</span>' +
        '<span class="d-meta">' + marcas.join('') + '<span>' + esc(lugar) + '</span></span>' +
        '</a>';
    }).join('');
  }

  /**
   * Titular de la tarjeta. Si el Sheet no trae Puesto, tiramos de la
   * descripción: "Martes 29 de Septiembre de 15:00 a 19:00 en Madrid"
   * informa mucho más que un "Evento de la empresa" genérico.
   */
  function titulo(oferta) {
    if (oferta.puesto) return oferta.puesto;
    if (oferta.descripcion) {
      var texto = oferta.descripcion.trim();
      if (texto.length <= 78) return texto;
      var corte = texto.slice(0, 78);
      var espacio = corte.lastIndexOf(' ');
      return (espacio > 40 ? corte.slice(0, espacio) : corte).replace(/[.,;:]$/, '') + '…';
    }
    return 'Varias posiciones abiertas';
  }

  /** Si la descripción ya se usó de titular, no la repetimos debajo. */
  function descripcionAparte(oferta) {
    return oferta.puesto ? oferta.descripcion : '';
  }

  function pintarPildoras() {
    var trozos = [];
    CAMPOS.forEach(function (campo) {
      estado.filtros[campo].forEach(function (v) {
        trozos.push('<span class="pildora-activa">' + esc(v) +
          '<button type="button" data-quitar-campo="' + campo + '" data-quitar-valor="' + esc(v) +
          '" aria-label="Quitar filtro ' + esc(v) + '">&times;</button></span>');
      });
    });
    if (estado.soloFavoritas) {
      trozos.push('<span class="pildora-activa">Solo favoritas' +
        '<button type="button" data-quitar-fav="1" aria-label="Quitar filtro de favoritas">&times;</button></span>');
    }
    if (estado.q) {
      trozos.push('<span class="pildora-activa">“' + esc(estado.q) + '”' +
        '<button type="button" data-quitar-q="1" aria-label="Borrar búsqueda">&times;</button></span>');
    }
    elPildoras.innerHTML = trozos.join('');
    elLimpiar.hidden = trozos.length === 0;
  }

  function pintarLista(visibles) {
    elEsqueleto.hidden = true;

    var total = estado.ofertas.length;
    elRecuento.innerHTML = visibles.length === total
      ? '<b>' + total + '</b> ' + (total === 1 ? 'oportunidad' : 'oportunidades')
      : '<b>' + visibles.length + '</b> de ' + total;

    if (!visibles.length) {
      elLista.hidden = true;
      elVacia.innerHTML =
        '<div class="vacio"><h3>' +
        (estado.soloFavoritas && !favoritas.size
          ? 'Todavía no has guardado ninguna favorita'
          : 'Nada encaja con esta combinación') +
        '</h3><p>' +
        (estado.soloFavoritas && !favoritas.size
          ? 'Pulsa la estrella de cualquier oferta y volverá a aparecer aquí.'
          : 'Prueba a quitar algún filtro o a buscar con otra palabra.') +
        '</p><button class="btn-barajar" type="button" id="btnVaciarFiltros">Quitar los filtros</button></div>';
      var b = document.getElementById('btnVaciarFiltros');
      if (b) b.addEventListener('click', limpiarFiltros);
      return;
    }

    elVacia.innerHTML = '';
    elLista.hidden = false;
    elLista.innerHTML = visibles.map(tarjeta).join('');
  }

  /**
   * Línea superior de la tarjeta: "PRÁCTICAS / SANTANDER".
   * El tipo va primero y en color: es lo que se escanea de un vistazo
   * cuando bajas por el tablón buscando un evento o unas prácticas.
   */
  function kicker(o) {
    var tipos = (o.tipo || []).join(' / ');
    return '<p class="tarjeta-kicker">' +
      (tipos ? '<span class="k-tipo">' + esc(tipos) + '</span>' : '') +
      '<span class="k-empresa">' + esc(o.empresa || 'Sin empresa') + '</span>' +
      '</p>';
  }

  function tarjeta(o) {
    var esFav = favoritas.has(o.id);
    var estadoSeg = seguimiento[o.id] || '';
    var dias = diasParaCierre(o);

    var marcas = [];
    if (esNueva(o)) marcas.push('<span class="etq etq-nueva">NUEVO</span>');
    if (esUrgente(o)) {
      marcas.push('<span class="etq etq-urgente">' +
        (dias === 0 ? 'Cierra hoy' : 'Cierra en ' + dias + (dias === 1 ? ' día' : ' días')) +
        '</span>');
    } else if (estaCerrada(o)) {
      marcas.push('<span class="etq etq-tipo">Cerrada</span>');
    }
    (o.sector || []).forEach(function (s) {
      marcas.push('<span class="etq etq-sector" style="--c:' + colorSector(s) + '">' + esc(s) + '</span>');
    });
    (o.ciudad || []).forEach(function (c) {
      marcas.push('<span class="etq etq-ciudad">' + esc(c) + '</span>');
    });

    var mono = iniciales(o.empresa);

    var botonVer = o.link
      ? '<a class="btn-ver" href="' + esc(o.link) + '" target="_blank" rel="noopener">Ver oferta' +
        '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M7 17 17 7M9 7h8v8"/></svg></a>'
      : '<span class="btn-ver mudo" title="Esta oferta no trae enlace en el sheet">Sin enlace</span>';

    return '<li class="tarjeta" id="of-' + esc(o.id) + '" data-id="' + esc(o.id) + '"' +
      ' style="--acento:' + colorDe(o) + '">' +
      '<div class="tarjeta-cabeza">' +
        '<span class="sello"' + (mono.length > 2 ? ' style="font-size:11px"' : '') +
          ' aria-hidden="true">' + esc(mono) + '</span>' +
        kicker(o) +
      '</div>' +

      '<div class="tarjeta-cuerpo">' +
        '<h3 class="tarjeta-puesto">' + esc(titulo(o)) + '</h3>' +
        (descripcionAparte(o) ? '<p class="tarjeta-desc">' + esc(descripcionAparte(o)) + '</p>' : '') +
        '<div class="etiquetas">' + marcas.join('') + '</div>' +
      '</div>' +

      '<div class="tarjeta-lado">' +
        '<div class="tarjeta-botones">' +
          botonVer +
          '<button class="btn-icono" type="button" data-fav="' + esc(o.id) + '" aria-pressed="' + esFav + '" ' +
            'aria-label="' + (esFav ? 'Quitar de favoritas' : 'Guardar en favoritas') + '" title="Favorita">' +
            '<svg width="16" height="16" viewBox="0 0 24 24" fill="' + (esFav ? 'currentColor' : 'none') +
            '" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="m12 3 2.6 5.6 6 .8-4.4 4.2 1.1 6L12 16.8 6.7 19.6l1.1-6L3.4 9.4l6-.8Z"/></svg>' +
          '</button>' +
          '<button class="btn-icono" type="button" data-copiar="' + esc(o.id) + '" aria-label="Copiar para compartir" title="Copiar para compartir">' +
            '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><rect x="9" y="9" width="12" height="12" rx="2.5"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>' +
          '</button>' +
        '</div>' +
        '<select class="selector-estado" data-estado-de="' + esc(o.id) + '" data-estado="' + esc(estadoSeg) + '" ' +
          'aria-label="Estado de tu candidatura">' +
          ETIQUETAS_ESTADO.map(function (par) {
            return '<option value="' + par[0] + '"' + (estadoSeg === par[0] ? ' selected' : '') + '>' + par[1] + '</option>';
          }).join('') +
        '</select>' +
      '</div>' +
    '</li>';
  }

  function pintarFrescura() {
    if (!estado.generado) { elFrescura.textContent = ''; return; }
    var rel = fechaRelativa(estado.generado);
    elFrescura.textContent = rel ? 'Ofertas actualizadas ' + rel + '.' : '';
  }

  /* ============================================================
     Interacción
     ============================================================ */

  function limpiarFiltros() {
    CAMPOS.forEach(function (c) { estado.filtros[c] = []; });
    estado.q = '';
    estado.soloFavoritas = false;
    elBusqueda.value = '';
    elSoloFav.checked = false;
    elConmFav.dataset.activo = 'no';
    pintarTodo();
  }

  function alternarFiltro(campo, valor, activar) {
    var lista = estado.filtros[campo];
    var pos = lista.indexOf(valor);
    if (activar && pos < 0) lista.push(valor);
    if (!activar && pos >= 0) lista.splice(pos, 1);
    pintarTodo();
  }

  function textoParaCompartir(o) {
    var lineas = [];
    lineas.push('💼 ' + titulo(o) + (o.empresa ? ' — ' + o.empresa : ''));
    var detalle = [];
    if ((o.ciudad || []).length) detalle.push((o.ciudad || []).join(', '));
    if ((o.tipo || []).length) detalle.push((o.tipo || []).join(', '));
    if (detalle.length) lineas.push(detalle.join(' · '));
    if (o.link) lineas.push(o.link);
    lineas.push('Vía el tablón de Women in Business: ' + urlBase() + '#oferta=' + o.id);
    return lineas.join('\n');
  }

  function urlBase() {
    return location.origin + location.pathname;
  }

  function copiar(texto) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(texto);
    }
    return new Promise(function (resolver, rechazar) {
      var area = document.createElement('textarea');
      area.value = texto;
      area.setAttribute('readonly', '');
      area.style.position = 'fixed';
      area.style.opacity = '0';
      document.body.appendChild(area);
      area.select();
      try {
        document.execCommand('copy') ? resolver() : rechazar();
      } catch (e) {
        rechazar(e);
      } finally {
        document.body.removeChild(area);
      }
    });
  }

  /* ---------- Tema ---------- */

  var ICONO_SOL = '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>';
  var ICONO_LUNA = '<path d="M20 14.5A8.5 8.5 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5Z"/>';

  function aplicarTema(tema) {
    document.documentElement.dataset.tema = tema;
    elIconoTema.innerHTML = tema === 'oscuro' ? ICONO_SOL : ICONO_LUNA;
    elTema.setAttribute('aria-label', tema === 'oscuro' ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro');
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', tema === 'oscuro' ? '#080e24' : '#0f1a3c');
    guardarAlmacen('wib:tema', tema);
  }

  function temaInicial() {
    var guardado = leerAlmacen('wib:tema', null);
    if (guardado === 'claro' || guardado === 'oscuro') return guardado;
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches
      ? 'oscuro' : 'claro';
  }

  /* ---------- Redes y llamadas a la acción ---------- */

  var ICONOS = {
    whatsapp: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" width="17" height="17">' +
      '<path d="M12 2a9.9 9.9 0 0 0-8.4 15.2L2 22.3l5.3-1.5A9.9 9.9 0 1 0 12 2zm0 18.1c-1.6 0-3.2-.5-4.6-1.3l-.3-.2-3.1.9.9-3-.2-.3A8.1 8.1 0 1 1 12 20.1z"/>' +
      '<path d="M16.9 14.3c-.3-.1-1.6-.8-1.9-.9-.2-.1-.4-.1-.6.1l-.8 1c-.2.2-.3.2-.5.1a6.6 6.6 0 0 1-3.6-3.2c-.1-.3 0-.4.1-.6l.4-.5.3-.5v-.5l-.9-2.1c-.2-.5-.4-.5-.6-.5h-.6c-.2 0-.5.1-.8.4a3 3 0 0 0-.9 2.3c0 1.4 1 2.7 1.2 2.9.1.2 2 3.1 4.9 4.3 2.4 1 2.9.8 3.4.7.5 0 1.6-.6 1.8-1.3.2-.6.2-1.2.2-1.3l-.6-.4z"/></svg>',
    linkedin: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" width="17" height="17">' +
      '<path d="M4.98 3.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5zM3.2 9h3.6v12H3.2zM9.2 9h3.4v1.6h.05c.5-.9 1.7-1.9 3.6-1.9 3.8 0 4.5 2.4 4.5 5.5V21h-3.6v-5.4c0-1.3 0-3-1.9-3s-2.1 1.4-2.1 2.9V21H9.2z"/></svg>',
    instagram: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true" width="17" height="17">' +
      '<rect x="3" y="3" width="18" height="18" rx="5.2"/><circle cx="12" cy="12" r="3.8"/>' +
      '<circle cx="17.3" cy="6.7" r="1.3" fill="currentColor" stroke="none"/></svg>'
  };

  /* ---------- Enlaces compartibles ---------- */

  function leerHash() {
    var bruto = location.hash.replace(/^#/, '');
    if (!bruto) return;
    var params = new URLSearchParams(bruto);

    CAMPOS.forEach(function (campo) {
      var v = params.get(campo);
      if (v) estado.filtros[campo] = v.split(',').map(decodeURIComponent).filter(Boolean);
    });
    var q = params.get('q');
    if (q) { estado.q = q; elBusqueda.value = q; }
    if (params.get('fav') === '1') {
      estado.soloFavoritas = true;
      elSoloFav.checked = true;
      elConmFav.dataset.activo = 'si';
    }
    var orden = params.get('orden');
    if (orden) { estado.orden = orden; elOrden.value = orden; }
    estado.destacada = params.get('oferta');
  }

  function escribirHash() {
    var params = new URLSearchParams();
    CAMPOS.forEach(function (campo) {
      if (estado.filtros[campo].length) {
        params.set(campo, estado.filtros[campo].map(encodeURIComponent).join(','));
      }
    });
    if (estado.q) params.set('q', estado.q);
    if (estado.soloFavoritas) params.set('fav', '1');
    if (estado.orden !== 'recomendado') params.set('orden', estado.orden);

    var cadena = params.toString();
    var destino = cadena ? '#' + cadena : location.pathname;
    history.replaceState(null, '', destino);
  }

  function irADestacada() {
    if (!estado.destacada) return;
    var nodo = document.getElementById('of-' + estado.destacada);
    estado.destacada = null;
    if (!nodo) return;
    nodo.scrollIntoView({ behavior: 'smooth', block: 'center' });
    nodo.classList.add('resaltada');
    setTimeout(function () { nodo.classList.remove('resaltada'); }, 3200);
  }

  /* ---------- Escuchadores ---------- */

  function conectarEventos() {
    var temporizador;
    elBusqueda.addEventListener('input', function () {
      clearTimeout(temporizador);
      temporizador = setTimeout(function () {
        estado.q = elBusqueda.value.trim();
        pintarTodo();
      }, 160);
    });

    elOrden.addEventListener('change', function () {
      estado.orden = elOrden.value;
      pintarTodo();
    });

    elSoloFav.addEventListener('change', function () {
      estado.soloFavoritas = elSoloFav.checked;
      elConmFav.dataset.activo = elSoloFav.checked ? 'si' : 'no';
      pintarTodo();
    });

    elLimpiar.addEventListener('click', limpiarFiltros);

    elBarajar.addEventListener('click', function () {
      estado.barajadas++;
      elBarajar.classList.add('girando');
      setTimeout(function () { elBarajar.classList.remove('girando'); }, 450);
      pintarTodo();
    });

    // Cambios en los desplegables de filtro.
    document.addEventListener('change', function (ev) {
      var caja = ev.target.closest('.panel input[type="checkbox"]');
      if (!caja) return;
      var campo = caja.closest('.filtro').dataset.campo;
      alternarFiltro(campo, caja.value, caja.checked);
    });

    // Selector de seguimiento de candidatura.
    document.addEventListener('change', function (ev) {
      var sel = ev.target.closest('[data-estado-de]');
      if (!sel) return;
      var id = sel.dataset.estadoDe;
      if (sel.value) seguimiento[id] = sel.value;
      else delete seguimiento[id];
      sel.dataset.estado = sel.value;
      guardarAlmacen('wib:seguimiento', seguimiento);
    });

    document.addEventListener('click', function (ev) {
      var fav = ev.target.closest('[data-fav]');
      if (fav) {
        var id = fav.dataset.fav;
        if (favoritas.has(id)) { favoritas.delete(id); brindis('Quitada de favoritas'); }
        else { favoritas.add(id); brindis('Guardada en favoritas ★'); }
        guardarAlmacen('wib:favoritas', Array.from(favoritas));
        if (estado.soloFavoritas) pintarTodo();
        else {
          var tarj = fav.closest('.tarjeta');
          var oferta = estado.ofertas.filter(function (o) { return o.id === id; })[0];
          if (tarj && oferta) tarj.outerHTML = tarjeta(oferta);
        }
        return;
      }

      var cop = ev.target.closest('[data-copiar]');
      if (cop) {
        var oferta2 = estado.ofertas.filter(function (o) { return o.id === cop.dataset.copiar; })[0];
        if (!oferta2) return;
        copiar(textoParaCompartir(oferta2))
          .then(function () { brindis('Copiado, ya lo puedes pegar en WhatsApp'); })
          .catch(function () { brindis('No se ha podido copiar'); });
        return;
      }

      var quitar = ev.target.closest('[data-quitar-campo]');
      if (quitar) {
        alternarFiltro(quitar.dataset.quitarCampo, quitar.dataset.quitarValor, false);
        return;
      }
      if (ev.target.closest('[data-quitar-fav]')) {
        elSoloFav.checked = false;
        estado.soloFavoritas = false;
        elConmFav.dataset.activo = 'no';
        pintarTodo();
        return;
      }
      if (ev.target.closest('[data-quitar-q]')) {
        estado.q = '';
        elBusqueda.value = '';
        pintarTodo();
        return;
      }

      // Cerrar desplegables al pulsar fuera.
      if (!ev.target.closest('.filtro')) {
        document.querySelectorAll('.filtro[open]').forEach(function (d) { d.open = false; });
      }
    });

    document.addEventListener('keydown', function (ev) {
      if (ev.key === 'Escape') {
        document.querySelectorAll('.filtro[open]').forEach(function (d) { d.open = false; });
      }
      // "/" enfoca el buscador, como en GitHub.
      if (ev.key === '/' && document.activeElement !== elBusqueda &&
          !/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName)) {
        ev.preventDefault();
        elBusqueda.focus();
      }
    });

    elTema.addEventListener('click', function () {
      aplicarTema(document.documentElement.dataset.tema === 'oscuro' ? 'claro' : 'oscuro');
    });
  }

  /* Un enlace sin URL en config.js se retira de la página. Preferimos que
     falte un botón antes que dejar uno que no lleva a ninguna parte. */
  function conectarEnlacesConfig() {
    var sugerir = $('#enlaceSugerir');
    if (sugerir) {
      if (CFG.URL_SUGERIR) {
        sugerir.href = CFG.URL_SUGERIR;
        if (CFG.URL_SUGERIR.indexOf('mailto:') === 0) sugerir.removeAttribute('target');
      } else {
        sugerir.hidden = true;
      }
    }

    var comunidad = $('#enlaceComunidad');
    if (comunidad) {
      if (CFG.URL_COMUNIDAD) comunidad.href = CFG.URL_COMUNIDAD;
      else comunidad.hidden = true;
    }

    // Las dos llamadas a la comunidad: la de la portada y la del final.
    // Si no hay enlace configurado, los bloques enteros no se muestran.
    var etiqueta = ICONOS.whatsapp + '<span>Únete ya a la comunidad</span>';
    [['#ctaPortada', '#portadaCta'], ['#ctaFinal', '#llamada']].forEach(function (par) {
      var boton = $(par[0]);
      var bloque = $(par[1]);
      if (!boton || !bloque) return;
      if (CFG.URL_COMUNIDAD) {
        boton.href = CFG.URL_COMUNIDAD;
        boton.innerHTML = etiqueta;
        bloque.hidden = false;
      } else {
        bloque.hidden = true;
      }
    });

    var pie = $('#pieEnlaces');
    if (pie) {
      pie.innerHTML = [
        ['WhatsApp', CFG.URL_COMUNIDAD, ICONOS.whatsapp],
        ['LinkedIn', CFG.URL_LINKEDIN, ICONOS.linkedin],
        ['Instagram', CFG.URL_INSTAGRAM, ICONOS.instagram]
      ].filter(function (r) {
        return r[1];
      }).map(function (r) {
        return '<a class="red" href="' + esc(r[1]) + '" target="_blank" rel="noopener" ' +
          'aria-label="' + esc(r[0]) + '" title="' + esc(r[0]) + '">' + r[2] + '</a>';
      }).join('');

      if (CFG.URL_SUGERIR) {
        var fuera = CFG.URL_SUGERIR.indexOf('mailto:') === 0 ? '' : ' target="_blank" rel="noopener"';
        pie.innerHTML += '<a class="red-texto" href="' + esc(CFG.URL_SUGERIR) + '"' + fuera +
          '>Enviar una oferta</a>';
      }
    }
  }

  /* ---------- Arranque ---------- */

  aplicarTema(temaInicial());
  conectarEnlacesConfig();
  leerHash();
  conectarEventos();
  arrancarDatos();

  // Cuando ya hay tarjetas pintadas, saltamos a la oferta compartida.
  var observador = new MutationObserver(function () {
    if (estado.destacada) irADestacada();
  });
  observador.observe(elLista, { childList: true });

})();
