# Mi Rol · versión web

App **estática** para consultar el Rol Mensual de GIRE desde iPhone, Android o cualquier navegador moderno. No hay servidor: el PDF se procesa en el dispositivo y los datos se guardan en el navegador.

## Probar en local

No abras `index.html` con `file://`: el service worker necesita HTTP.

```powershell
cd web
python -m http.server 8080
```

Abre `http://localhost:8080`.

## Publicar en GitHub Pages

1. Crea un repositorio y sube **el contenido de esta carpeta `web/`** (no la carpeta `android/`).
2. En GitHub: `Settings` → `Pages` → `Deploy from a branch` → `main` → `/ (root)`.
3. Espera unos minutos. La URL será `https://TUUSUARIO.github.io/TUREPO/`.

El archivo `.nojekyll` ya está incluido. Todas las rutas son relativas, así que funciona igual en la raíz del dominio o en una subcarpeta.

## iPhone

Abre la URL en **Safari** y usa la app directamente. No hay que instalar nada ni pasar por la App Store.

La web queda disponible sin conexión después de la primera carga mediante el service worker.

## Qué incluye

- Importar uno o varios roles mensuales en PDF.
- Recordar matrícula y trabajador.
- Calendario con claves, horas de inicio/fin y día actual resaltado.
- Detalle del Gráfico con imagen, deslizamiento horizontal y guías de horas.
- Gestión de roles: usar, editar PDF o eliminar.
- Editar claves con validación de día de la semana.
- Restablecer claves originales.
- Funcionamiento sin conexión mediante service worker.

## Notificaciones en iPhone

Una web estática **no puede programar notificaciones locales en segundo plano** en iPhone: iOS exige un servidor de push para eso. Por eso, en la versión web el botón de notificaciones se sustituye por **Añadir al calendario**:

- elige la hora del aviso;
- se descarga un archivo `.ics` con todos los turnos;
- al abrirlo, el Calendario del iPhone añade los eventos y sus alarmas.

Así los avisos los gestiona el propio teléfono, sin servidor y sin coste.

## Datos

- Todo se guarda en `localStorage` del navegador, bajo el dominio donde publiques la app.
- No se sube ningún PDF ni dato a GitHub.
- Si cambias de dominio o borras los datos del sitio, se pierden los roles guardados.
- En iPhone, añadir la app a la pantalla de inicio reduce la probabilidad de que Safari borre el almacenamiento.

## Actualizar

Si cambias archivos, sube también la versión de `CACHE` en `sw.js` para que los usuarios reciban la actualización.

## Variante con imágenes incrustadas

Esta carpeta no incluye `assets/shifts`: las imágenes del Gráfico van dentro de `js/shift-images.js`. Así se puede subir a GitHub Pages con la carga web normal, que limita a 100 archivos por vez.
