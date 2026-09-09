/**
 * WIB · Tablón de Ofertas — API de datos
 * ---------------------------------------------------------------
 * Este script vive DENTRO del Google Sheet de ofertas y lo expone
 * como JSON limpio para la web. El sheet sigue siendo privado.
 *
 * Cómo instalarlo: ver README.md, sección "1. Apps Script".
 *
 * Lo que hace, en orden:
 *   1. Encuentra la fila de cabeceras (el sheet tiene un banner
 *      con celdas combinadas encima, así que no es la fila 1).
 *   2. Mapea las columnas por nombre, tolerando acentos y sinónimos.
 *   3. Normaliza el vocabulario suelto ("Summers", "Internship",
 *      "Oferta/Prácticas"...) a un juego fijo de tipos y sectores.
 *   4. Devuelve JSON con un id estable por oferta.
 */

// Nombre de la pestaña a leer. Si no existe, usa la primera del sheet.
var HOJA = 'Ofertas';

// Segundos que se cachea la respuesta (evita releer el sheet en cada visita).
var CACHE_SEGUNDOS = 120;

/* ---------------------------------------------------------------
   VOCABULARIO CANÓNICO
   Los 10 sectores son los de la propuesta de valor de WIB.
   Cada uno se activa si alguna de sus palabras aparece en la celda.
   --------------------------------------------------------------- */

var SECTORES = [
  ['Consultoría',             ['consultoria', 'consulting', 'estrategia', 'strategy']],
  ['Finanzas',                ['finanzas', 'banca', 'finance', 'banking', 'investment', 'private equity', 'm&a', 'audit']],
  ['Tech & IA',               ['tech', 'tecnologia', 'tecnologica', 'ia', 'ai', 'data', 'software', 'informatica', 'ingenieria']],
  ['Emprendimiento & Business', ['emprendimiento', 'business', 'startup', 'negocio']],
  ['Marketing & Comunicación',  ['marketing', 'comunicacion', 'comms', 'brand', 'publicidad']],
  ['Derecho & Política',      ['derecho', 'legal', 'politica', 'abogac', 'law']],
  ['Ciencia & Salud',         ['ciencia', 'salud', 'health', 'pharma', 'farma', 'biotech', 'medicina', 'science']],
  ['Moda & Retail',           ['moda', 'retail', 'fashion', 'consumo', 'fmcg']],
  ['RRHH',                    ['rrhh', 'recursos humanos', 'people', 'talent', 'hr']],
  ['Arte & Cultura',          ['arte', 'cultura', 'diseño', 'diseno', 'design', 'creativ']]
];

var TIPOS = [
  ['Summer',    ['summer', 'verano']],
  ['Prácticas', ['practica', 'internship', 'intern', 'trainee', 'becari']],
  ['Beca',      ['beca', 'scholarship']],
  ['Programa',  ['programa', 'program', 'programme']],
  ['Evento',    ['evento', 'event', 'networking', 'charla', 'webinar']],
  ['Empleo',    ['oferta', 'empleo', 'job', 'full time', 'fulltime', 'graduate', 'junior', 'contrato', 'vacante']]
];

// Sinónimos de cabecera -> clave interna.
var COLUMNAS = [
  ['tipo',        ['contenido', 'tipo', 'categoria']],
  ['sector',      ['sector', 'area', 'ambito']],
  ['empresa',     ['empresa', 'compania', 'company', 'organizacion']],
  ['puesto',      ['puesto', 'posicion', 'position', 'rol', 'cargo']],
  ['descripcion', ['descripcion', 'detalle', 'notas', 'observaciones']],
  ['ciudad',      ['ubicacion', 'ciudad', 'localizacion', 'location', 'lugar']],
  ['cierre',      ['dia de cierre', 'cierre', 'deadline', 'fecha limite', 'fecha de cierre']],
  ['link',        ['link directo', 'link', 'enlace', 'url', 'aplicar']]
];

/* --------------------------------------------------------------- */

function doGet(e) {
  var callback = e && e.parameter ? e.parameter.callback : null;
  var payload;

  try {
    payload = obtenerDatos(e && e.parameter && e.parameter.nocache === '1');
  } catch (err) {
    payload = { error: String(err), actualizado: new Date().toISOString(), ofertas: [] };
  }

  var texto = JSON.stringify(payload);

  // JSONP solo si lo piden explícitamente; por defecto JSON normal.
  if (callback) {
    return ContentService
      .createTextOutput(callback + '(' + texto + ');')
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return ContentService
    .createTextOutput(texto)
    .setMimeType(ContentService.MimeType.JSON);
}

function obtenerDatos(saltarCache) {
  var cache = CacheService.getScriptCache();
  if (!saltarCache) {
    var guardado = cache.get('datos');
    if (guardado) return JSON.parse(guardado);
  }

  var resultado = leerHoja();
  try {
    cache.put('datos', JSON.stringify(resultado), CACHE_SEGUNDOS);
  } catch (err) {
    // Payload > 100KB: seguimos sin cachear, no es fatal.
  }
  return resultado;
}

function leerHoja() {
  var libro = SpreadsheetApp.getActiveSpreadsheet();
  var hoja = libro.getSheetByName(HOJA) || libro.getSheets()[0];
  var valores = hoja.getDataRange().getValues();

  var filaCabecera = localizarCabecera(valores);
  if (filaCabecera < 0) {
    throw new Error('No encuentro la fila de cabeceras. Debe contener al menos "Empresa" y "Puesto".');
  }

  var indices = mapearColumnas(valores[filaCabecera]);
  var ofertas = [];

  for (var f = filaCabecera + 1; f < valores.length; f++) {
    var oferta = construirOferta(valores[f], indices);
    if (oferta) ofertas.push(oferta);
  }

  return {
    actualizado: new Date().toISOString(),
    hoja: hoja.getName(),
    total: ofertas.length,
    ofertas: ofertas
  };
}

/** Busca en las primeras 40 filas una que parezca la cabecera. */
function localizarCabecera(valores) {
  var limite = Math.min(valores.length, 40);
  for (var f = 0; f < limite; f++) {
    var celdas = valores[f].map(function (c) { return normalizar(c); });
    var tieneEmpresa = celdas.indexOf('empresa') >= 0;
    var tieneOtra = celdas.indexOf('puesto') >= 0 || celdas.indexOf('sector') >= 0;
    if (tieneEmpresa && tieneOtra) return f;
  }
  return -1;
}

/** Devuelve { tipo: 0, sector: 1, ... } con el índice de cada columna. */
function mapearColumnas(cabecera) {
  var indices = {};
  for (var c = 0; c < cabecera.length; c++) {
    var nombre = normalizar(cabecera[c]);
    if (!nombre) continue;
    for (var k = 0; k < COLUMNAS.length; k++) {
      var clave = COLUMNAS[k][0];
      if (indices[clave] !== undefined) continue;
      var sinonimos = COLUMNAS[k][1];
      for (var s = 0; s < sinonimos.length; s++) {
        if (nombre === sinonimos[s] || nombre.indexOf(sinonimos[s]) === 0) {
          indices[clave] = c;
          break;
        }
      }
    }
  }
  return indices;
}

function construirOferta(fila, indices) {
  var empresa = limpiar(celda(fila, indices.empresa));
  var puesto = limpiar(celda(fila, indices.puesto));
  var descripcion = limpiar(celda(fila, indices.descripcion));
  var link = limpiar(celda(fila, indices.link));

  // Una fila sin empresa y sin puesto es una fila vacía o de relleno.
  if (!empresa && !puesto) return null;

  var tipos = clasificar(celda(fila, indices.tipo), TIPOS);
  var sectores = clasificar(celda(fila, indices.sector), SECTORES);

  // Si el sector no encaja en el vocabulario, conservamos el original
  // en vez de tirarlo: mejor un filtro de más que perder una oferta.
  if (!sectores.length) {
    var crudo = limpiar(celda(fila, indices.sector));
    if (crudo) sectores = [crudo];
  }
  if (!tipos.length) {
    var tipoCrudo = limpiar(celda(fila, indices.tipo));
    if (tipoCrudo) tipos = [tipoCrudo];
  }

  return {
    id: hash([empresa, puesto, link].join('|').toLowerCase()),
    empresa: empresa,
    puesto: puesto,
    descripcion: descripcion,
    tipo: tipos,
    sector: sectores,
    ciudad: separarCiudades(celda(fila, indices.ciudad)),
    cierre: fechaISO(celda(fila, indices.cierre)),
    link: /^https?:\/\//i.test(link) ? link : ''
  };
}

/**
 * Devuelve todas las etiquetas canónicas que dispara una celda.
 * "Oferta/Prácticas" -> ["Prácticas", "Empleo"]
 * "Banca + Finanzas" -> ["Finanzas"]
 *
 * Las claves de 4+ letras se buscan como subcadena ("summers" -> "summer").
 * Las cortas ("ia", "ai", "hr") exigen palabra completa: si no, "ciencia"
 * y "consultoria" acabarían clasificadas como Tech & IA.
 */
function clasificar(valor, tabla) {
  var texto = normalizar(valor);
  if (!texto) return [];
  var palabras = texto.split(/[^a-z0-9&]+/).filter(function (p) { return p; });

  var encontrados = [];
  for (var i = 0; i < tabla.length; i++) {
    var etiqueta = tabla[i][0];
    var claves = tabla[i][1];
    for (var k = 0; k < claves.length; k++) {
      var clave = claves[k];
      var acierto = clave.length >= 4
        ? texto.indexOf(clave) >= 0
        : palabras.indexOf(clave) >= 0;
      if (acierto) {
        encontrados.push(etiqueta);
        break;
      }
    }
  }
  return encontrados;
}

/** "Madrid & Barcelona" -> ["Madrid", "Barcelona"] */
function separarCiudades(valor) {
  var crudo = limpiar(valor);
  if (!crudo) return [];
  return crudo
    .split(/\s*(?:[,/&]|\+|\by\b)\s*/i)
    .map(function (p) { return limpiar(p); })
    .filter(function (p) { return p.length > 1; })
    .map(function (p) { return p.charAt(0).toUpperCase() + p.slice(1); });
}

/** Acepta un Date de Sheets o texto dd/mm/aaaa. Devuelve "AAAA-MM-DD" o "". */
function fechaISO(valor) {
  if (!valor) return '';
  if (Object.prototype.toString.call(valor) === '[object Date]' && !isNaN(valor)) {
    return Utilities.formatDate(valor, 'Europe/Madrid', 'yyyy-MM-dd');
  }
  var texto = String(valor).trim();
  var m = texto.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/);
  if (m) {
    var anio = m[3].length === 2 ? '20' + m[3] : m[3];
    return anio + '-' + pad(m[2]) + '-' + pad(m[1]);
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(texto)) return texto;
  return '';
}

function pad(n) { return String(n).length < 2 ? '0' + n : String(n); }

function celda(fila, indice) {
  return indice === undefined ? '' : fila[indice];
}

/** Colapsa saltos de línea y espacios dobles que trae el sheet. */
function limpiar(valor) {
  if (valor === null || valor === undefined) return '';
  return String(valor).replace(/\s+/g, ' ').trim();
}

/** minúsculas, sin acentos, sin puntuación de adorno. */
function normalizar(valor) {
  return limpiar(valor)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[!¡?¿.:;*]/g, '');
}

/** Hash corto y estable: identifica la oferta entre actualizaciones. */
function hash(texto) {
  var h = 5381;
  for (var i = 0; i < texto.length; i++) {
    h = ((h << 5) + h + texto.charCodeAt(i)) & 0xffffffff;
  }
  return (h >>> 0).toString(36);
}

/** Ejecuta esto una vez desde el editor para comprobar que lee bien. */
function probar() {
  var datos = leerHoja();
  Logger.log('Ofertas leídas: ' + datos.total);
  Logger.log(JSON.stringify(datos.ofertas.slice(0, 3), null, 2));
}
