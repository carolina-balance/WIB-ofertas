/* ============================================================
   WIB · Tablón de Ofertas — configuración
   Este es el ÚNICO fichero que necesitas tocar para poner la
   web en marcha. Cambia las URLs y guarda.

   Lo que dejes vacío ('') no se inventa: el botón o el enlace
   correspondiente simplemente no aparece en la web.
   ============================================================ */

window.WIB_CONFIG = {

  /* 1. URL del Apps Script desplegado sobre vuestro Google Sheet.
        Se obtiene en Apps Script -> Implementar -> Nueva implementación
        -> Aplicación web -> "Cualquier usuario". Termina en /exec
        Mientras esté vacío, la web funciona igual pero solo con los
        datos del último commit (data/ofertas.json). */
  APPS_SCRIPT_URL: 'https://script.google.com/macros/s/AKfycbzHPN1uSO_QVVXKFvzbC9_kx01_9mvn0thntN4Sf_-_lpwJCqqUg01jXygahvyfS87ZKQ/exec',

  /* 2. Dónde manda la gente una oferta nueva.
        Un Google Form es lo más cómodo; también vale 'mailto:...'.
        Vacío = no se muestra el botón "Enviar oferta". */
  URL_SUGERIR: '',

  /* 3. Enlace para unirse a la comunidad.
        Vacío = no se muestra el botón "Únete a WIB". */
  URL_COMUNIDAD: '',

  /* 4. Redes que aparecen en el pie. Vacío = no aparece. */
  URL_LINKEDIN: '',
  URL_INSTAGRAM: 'https://www.instagram.com/womaninbusiness_spain/',

  /* 5. Días que una oferta luce la etiqueta NUEVO desde que entra. */
  DIAS_NUEVA: 10,

  /* 6. Días de antelación con los que se avisa de "cierra pronto". */
  DIAS_URGENTE: 7,

  /* 7. Cuántas ofertas rotan en "Destacadas de hoy". */
  NUM_DESTACADAS: 3
};
