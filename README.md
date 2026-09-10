# Tablón de ofertas · Women in Business Spain

Web pública de oportunidades para la comunidad, alimentada desde un Google Sheet.
Prácticas, summers, programas, becas y primeros empleos, filtrables por tipo,
sector y ciudad.

**URL (una vez desplegada):** `https://carolina-balance.github.io/WIB-ofertas/`

---

## Cómo funciona

```
Google Sheet  ──►  Apps Script (/exec)  ──►  GitHub Action (cada 30 min)
   privado          JSON normalizado           escribe data/ofertas.json
                          │                              │
                          └──────────►  index.html  ◄─────┘
                            refresco en vivo    carga instantánea
```

La web lee **dos** fuentes, en este orden:

1. `data/ofertas.json`, que commitea la Action. Carga al instante y funciona
   aunque el Apps Script esté caído o haya agotado su cuota.
2. El Apps Script, en segundo plano, para recoger lo editado en el sheet desde
   el último commit.

Si la segunda falla, la web ni se entera: ya está pintada con la primera.

### Lo que se normaliza por el camino

El sheet lo rellenan varias personas y el vocabulario se va soltando. El Apps
Script lo unifica antes de que llegue a la web:

| En el sheet                              | En la web                       |
| ---------------------------------------- | ------------------------------- |
| `Summers`, `Internship`, `Practicas`     | `Summer`, `Prácticas`           |
| `Banca + Finanzas`                       | `Finanzas`                      |
| `Consultoría/Derecho`                    | `Consultoría` + `Derecho & Política` |
| `Oferta/Prácticas`                       | `Empleo` + `Prácticas`          |
| `Madrid & Barcelona`                     | `Madrid`, `Barcelona`           |

Los sectores se mapean a los 10 de la propuesta de valor de WIB. Si una celda no
encaja en ninguno, se conserva tal cual: mejor un filtro de más que perder una
oferta.

---

## Puesta en marcha

### 1. Apps Script

1. Abre el Google Sheet → **Extensiones → Apps Script**.
2. Borra lo que haya y pega el contenido de [`apps-script/Codigo.gs`](apps-script/Codigo.gs).
3. Si tu pestaña de ofertas **no** se llama `Ofertas`, cambia la constante `HOJA`
   de la línea 24. (Si la dejas, el script usa la primera pestaña del libro.)
4. Pulsa **Guardar**, elige la función `probar` y dale a **Ejecutar**. Autoriza el
   acceso cuando lo pida. En el registro debe salir el número de ofertas leídas.
5. **Implementar → Nueva implementación → Aplicación web**:
   - *Ejecutar como*: **Yo**
   - *Quién tiene acceso*: **Cualquier usuario**
6. Copia la URL que termina en `/exec`.

> Cada vez que edites el código hay que hacer **Implementar → Gestionar
> implementaciones → editar → Versión: nueva**. Si no, la URL sigue sirviendo el
> código viejo.

### 2. Configurar la web

Abre [`assets/config.js`](assets/config.js) y rellena:

```js
APPS_SCRIPT_URL: 'https://script.google.com/macros/s/.../exec',
URL_SUGERIR:     'https://forms.gle/...',   // formulario para enviar ofertas
URL_COMUNIDAD:   'https://...',             // dónde se apunta la gente a WIB
```

### 3. Subirlo a GitHub

```bash
cd ~/wib-ofertas
git remote add origin https://github.com/carolina-balance/WIB-ofertas.git
git push -u origin main
```

### 4. Activar GitHub Pages

**Settings → Pages → Source: Deploy from a branch → `main` / `/ (root)`**.
En un minuto la web está en `https://carolina-balance.github.io/WIB-ofertas/`.

### 5. Activar la actualización automática

1. **Settings → Secrets and variables → Actions → pestaña Variables → New
   repository variable**
   - Nombre: `APPS_SCRIPT_URL`
   - Valor: la misma URL `/exec` del paso 1
2. **Settings → Actions → General → Workflow permissions** → marca
   **Read and write permissions** (si no, la Action no puede commitear).
3. Ve a la pestaña **Actions → Actualizar ofertas → Run workflow** para lanzarla
   una vez a mano y comprobar que va.

A partir de ahí se ejecuta sola cada 30 minutos.

---

## Qué tiene la web

- **Destacadas de hoy**: 3 ofertas que rotan cada día. Estables mientras navegas
  (una lista que baila sola marea), distintas mañana. Botón *Barajar* para
  forzar otra combinación.
- **Orden "Recomendado"**: lo nuevo y lo que cierra pronto arriba; el resto rota
  a diario, para que la visibilidad no se la queden siempre las mismas ofertas.
- **Etiqueta NUEVO** real: la Action recuerda cuándo apareció cada oferta por
  primera vez, así que no depende de que nadie rellene una columna de fecha.
- **Filtros** por tipo, sector y ciudad, con el número de ofertas de cada uno.
- **Enlaces compartibles**: los filtros van en la URL. `#sector=Finanzas` es un
  enlace que puedes pegar en el grupo de WhatsApp de Finanzas.
- **Copiar para compartir**: el botón de cada tarjeta deja el texto listo para
  pegar en WhatsApp, con puesto, empresa, ciudad y enlace.
- **Favoritas y seguimiento** de candidatura (Aplicada / Entrevista / Oferta /
  Rechazada), guardados en el navegador de cada persona. Sin cuentas ni login.
- Modo claro y oscuro, móvil primero, y navegable con teclado (`/` enfoca el
  buscador).

---

## Columnas del sheet

El script busca la fila de cabeceras automáticamente (ignora el banner de arriba)
y reconoce estos nombres, con o sin acentos:

| Columna         | Sinónimos que también valen        | ¿Obligatoria?          |
| --------------- | ---------------------------------- | ---------------------- |
| `Contenido`     | Tipo, Categoría                    | recomendada            |
| `Sector`        | Área, Ámbito                       | recomendada            |
| `Empresa`       | Compañía, Organización             | **sí** (o `Puesto`)    |
| `Puesto`        | Posición, Rol, Cargo               | **sí** (o `Empresa`)   |
| `Descripción`   | Detalle, Notas                     | no                     |
| `Ubicación`     | Ciudad, Localización               | no                     |
| `Día de cierre` | Cierre, Deadline, Fecha límite     | no, pero **ver abajo** |
| `Link directo`  | Link, Enlace, URL                  | recomendada            |

Puedes añadir, quitar o reordenar columnas sin tocar el código.

### Dos cosas que suben mucho los clics

1. **Rellenar `Día de cierre`.** Ahora mismo está vacío en todas las filas, así
   que las etiquetas de urgencia y el orden "Cierra antes" no tienen nada con lo
   que trabajar. Es el campo con mejor relación esfuerzo/impacto del sheet.
2. **Poner siempre `Link directo`.** Una oferta sin enlace no entra en
   "Destacadas" y en la tarjeta sale un botón apagado.

---

## Desarrollo local

```bash
cd ~/wib-ofertas
python3 -m http.server 8000
# abre http://localhost:8000
```

Para probar el actualizador sin esperar a la Action:

```bash
APPS_SCRIPT_URL="https://script.google.com/macros/s/.../exec" python3 scripts/fetch_datos.py
```

---

## Estructura

```
index.html                        una sola página, sin build ni dependencias
assets/config.js                  ← lo único que hay que tocar para configurar
assets/style.css                  sistema visual (azul marino + rosa)
assets/app.js                     filtros, rotación, favoritas, seguimiento
data/ofertas.json                 datos publicados (lo escribe la Action)
apps-script/Codigo.gs             va pegado dentro del Google Sheet
scripts/fetch_datos.py            descarga y sella las fechas de alta
.github/workflows/actualizar-datos.yml
```

Sin framework, sin `npm install`, sin paso de compilación. Se despliega copiando
ficheros.
