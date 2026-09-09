#!/usr/bin/env python3
"""
WIB · Tablón de Ofertas — actualizador de datos.

Lo ejecuta la GitHub Action cada media hora. Hace tres cosas:

  1. Pide el JSON al Apps Script del sheet.
  2. Le pega la fecha en que vimos cada oferta por primera vez
     (el sheet no la guarda, así que la memorizamos nosotras aquí).
     De ahí salen las etiquetas "NUEVO" de la web.
  3. Escribe data/ofertas.json solo si algo ha cambiado.

Se niega a escribir un fichero vacío encima de uno con ofertas:
si el Apps Script falla, la web se queda con los últimos datos buenos.

Uso:
    APPS_SCRIPT_URL="https://script.google.com/.../exec" python3 scripts/fetch_datos.py
"""

import json
import os
import sys
import urllib.error
import urllib.request
from datetime import date, datetime, timezone
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
DESTINO = RAIZ / "data" / "ofertas.json"

INTENTOS = 3
TIMEOUT = 45


def log(mensaje):
    print(f"[wib] {mensaje}", flush=True)


def descargar(url):
    """Pide el JSON al Apps Script, reintentando ante fallos de red."""
    ultimo_error = None
    for intento in range(1, INTENTOS + 1):
        try:
            peticion = urllib.request.Request(
                url,
                headers={"User-Agent": "wib-ofertas/1.0 (+github actions)"},
            )
            with urllib.request.urlopen(peticion, timeout=TIMEOUT) as respuesta:
                crudo = respuesta.read().decode("utf-8")
            return json.loads(crudo)
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as error:
            ultimo_error = error
            log(f"intento {intento}/{INTENTOS} falló: {error}")
    raise SystemExit(f"No se pudo leer el Apps Script: {ultimo_error}")


def cargar_previo():
    """Lee el fichero anterior para recuperar las fechas de alta."""
    if not DESTINO.exists():
        return {"ofertas": []}
    try:
        return json.loads(DESTINO.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        log("el fichero anterior estaba corrupto, lo regenero entero")
        return {"ofertas": []}


def main():
    url = os.environ.get("APPS_SCRIPT_URL", "").strip()
    if not url or "PEGA_AQUI" in url:
        raise SystemExit(
            "Falta APPS_SCRIPT_URL. Configúralo como variable del repositorio "
            "(Settings -> Secrets and variables -> Actions -> Variables)."
        )

    remoto = descargar(url)
    if remoto.get("error"):
        raise SystemExit(f"El Apps Script devolvió un error: {remoto['error']}")

    ofertas = remoto.get("ofertas")
    if not isinstance(ofertas, list):
        raise SystemExit("La respuesta no trae una lista de ofertas.")

    previo = cargar_previo()
    anteriores = previo.get("ofertas") or []

    # Salvaguarda: nunca publicar un tablón vacío encima de uno lleno.
    if not ofertas and anteriores:
        raise SystemExit(
            f"El Apps Script devolvió 0 ofertas y ya teníamos {len(anteriores)}. "
            "No sobrescribo: revisa el sheet antes de que la web se quede en blanco."
        )

    # Ojo: se conserva la clave aunque venga vacía. Una oferta sembrada
    # sin fecha ("ya estaba aquí antes de la web") debe seguir sin fecha,
    # no estrenar una hoy y aparecer como recién llegada.
    alta_previa = {
        oferta["id"]: oferta.get("alta", "")
        for oferta in anteriores
        if oferta.get("id") and "alta" in oferta
    }

    hoy = date.today().isoformat()
    nuevas = 0
    for oferta in ofertas:
        identificador = oferta.get("id")
        if identificador in alta_previa:
            oferta["alta"] = alta_previa[identificador]
        else:
            oferta["alta"] = hoy
            nuevas += 1

    salida = {
        "generado": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "origen": remoto.get("hoja", ""),
        "total": len(ofertas),
        "ofertas": ofertas,
    }

    # Comparamos ignorando la marca de tiempo: si no, cada ejecución
    # produciría un commit aunque no haya cambiado ninguna oferta.
    def comparable(datos):
        return json.dumps(datos.get("ofertas", []), sort_keys=True, ensure_ascii=False)

    if DESTINO.exists() and comparable(previo) == comparable(salida):
        log(f"sin cambios ({len(ofertas)} ofertas)")
        return 0

    DESTINO.parent.mkdir(parents=True, exist_ok=True)
    DESTINO.write_text(
        json.dumps(salida, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    log(f"actualizado: {len(ofertas)} ofertas, {nuevas} nuevas")
    return 0


if __name__ == "__main__":
    sys.exit(main())
