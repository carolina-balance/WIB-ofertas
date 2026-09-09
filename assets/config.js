/* ============================================================
   WIB · Tablón de Ofertas — configuración
   Este es el ÚNICO fichero que necesitas tocar para poner la
   web en marcha. Cambia las URLs y guarda.
   ============================================================ */

window.WIB_CONFIG = {

  /* 1. URL del Apps Script desplegado sobre vuestro Google Sheet.
        Se obtiene en Apps Script -> Implementar -> Nueva implementación
        -> Aplicación web -> "Cualquier usuario". Termina en /exec
        Mientras ponga PEGA_AQUI, la web funciona igual pero solo con
        los datos del último commit (data/ofertas.json). */
  APPS_SCRIPT_URL: 'PEGA_AQUI_LA_URL_DEL_APPS_SCRIPT',

  /* 2. Dónde manda la gente una oferta nueva.
        Un Google Form es lo más cómodo; también vale un mailto. */
  URL_SUGERIR: 'mailto:hola@womeninbusiness.es?subject=Nueva%20oferta%20para%20el%20tabl%C3%B3n',

  /* 3. Enlace para unirse a la comunidad (WhatsApp, LinkedIn, web...). */
  URL_COMUNIDAD: 'https://www.linkedin.com/company/women-in-business-spain/',

  /* 4. Días que una oferta luce la etiqueta NUEVO desde que entra. */
  DIAS_NUEVA: 10,

  /* 5. Días de antelación con los que se avisa de "cierra pronto". */
  DIAS_URGENTE: 7,

  /* 6. Cuántas ofertas rotan en "Destacadas de hoy". */
  NUM_DESTACADAS: 3
};
