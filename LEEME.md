# Zeroria Launcher

Launcher oficial de Zeroria para Windows: cuenta de Microsoft, modo **Vanilla** y modo **Zeroria+** (NeoForge con
mods), noticias, fondos, estado del servidor, ajustes y actualizaciones automáticas.

- **No tienes que instalar nada.** El instalador `.exe` lo compila GitHub en sus ordenadores (GitHub Actions).
- **No tienes que registrar nada en Microsoft.** Se entra con la cuenta de Microsoft como en casi todos los
  launchers.
- **Los jugadores tampoco instalan nada:** el launcher descarga solo Java, Minecraft y NeoForge.

---

## 1. Ponerlo en marcha (una vez)

1. Crea un repositorio **público** en GitHub llamado `zeroria-launcher`.
2. Sube **todo** el contenido de esta carpeta: en el repositorio, *Add file → Upload files* y arrastra las
   carpetas y archivos.
   - Comprueba que se ha subido `.github/workflows/publicar.yml`. Si no está (a veces la web no sube las carpetas
     que empiezan por punto), créalo a mano: *Add file → Create new file*, escribe esa ruta como nombre y pega su
     contenido.
3. Edita `launcher.config.json` en GitHub (el lápiz) y pon tu usuario en `datos.usuario`. Pon también la dirección
   del servidor en `porDefecto.servidor`.
4. GitHub empieza a compilar solo (pestaña **Actions**, tarda unos 5 minutos). Cuando termina, el instalador está en
   **Releases** (`Zeroria-Launcher-Setup-0.1.0.exe`). Ese es el enlace que das a los jugadores.

## 2. Publicar una versión nueva del launcher

1. En GitHub, edita `package.json` y sube el número de `"version"` (por ejemplo `0.1.0` → `0.1.1`). Guarda.
2. GitHub compila y publica solo. A quien tenga el launcher abierto le sale arriba un botón dorado: «Actualizar y
   reiniciar». A los demás, la próxima vez que lo abran.

Si cambias algo del código sin cambiar la versión, no se publica nada nuevo. Para forzarlo: *Actions → Publicar
launcher → Run workflow*.

## 3. Cambiar lo que ven los jugadores (carpeta `datos/`)

Todo desde la web de GitHub, sin publicar versión: el launcher lo mira cada vez que se abre y cada vez que se le da
a Jugar.

```
datos/launcher.json      versión de Minecraft y NeoForge, servidor, lema, aviso, cuenta atrás, mantenimiento
datos/noticias.json      las noticias
datos/noticias/          sus imágenes
datos/fondos/            fondos de la portada (se van alternando)
datos/plus/mods/         mods de Zeroria+ (el launcher deja la carpeta mods EXACTAMENTE así)
datos/plus/config/       configuración de los mods
datos/plus/shaderpacks/  shaders
datos/plus/resourcepacks/ packs de texturas
datos/plus/options.txt   ajustes iniciales del juego (solo la primera vez)
datos/vanilla/           lo mismo para el modo Vanilla (sin mods)
```

- **Noticia nueva.** Sube la imagen a `datos/noticias/` y añade un bloque a `noticias.json`:
  ```json
  { "titulo": "…", "fecha": "2026-11-20", "etiqueta": "Evento", "imagen": "noticias/foto.jpg",
    "resumen": "una línea", "texto": "Párrafos separados por una línea en blanco. **negrita**, *cursiva*, [enlace](https://…)",
    "fijada": false, "publicar": "2026-11-20T18:00:00+01:00" }
  ```
  `publicar` es opcional: hasta esa hora no sale.
- **Fondos.** Sube o borra capturas (mejor de 1920×1080) en `datos/fondos/`.
- **Mods.** Arrastra el `.jar` a `datos/plus/mods/` para añadirlo y bórralo para quitarlo. Para actualizar uno,
  borra el viejo y sube el nuevo. La web de GitHub admite archivos de hasta 25 MB.
- **`launcher.json`:**
  - `"aviso": { "texto": "…", "enlace": "https://…" }`: la franja de arriba. Ponlo a `null` para quitarla.
  - `"evento": { "titulo": "Gran apertura en", "fecha": "2026-12-01T20:00:00+01:00" }`: la cuenta atrás.
  - `"mantenimiento": { "mensaje": "Volvemos a las 18:00" }`: bloquea el botón de jugar. Ponlo a `null` para quitarlo.
  - `"modos": { "plus": false }`: apaga un modo.
  - `minecraft` y `neoforge`: las versiones.

## 4. Dónde guarda las cosas en el PC del jugador

- `%APPDATA%\.zeroria\`: Minecraft, Java, las instancias (`instancias\vanilla` e `instancias\plus`, con mundos,
  capturas y opciones) y los registros. No toca la `.minecraft` normal.
- `%APPDATA%\Zeroria Launcher\`: ajustes y cuentas (las cuentas, cifradas por Windows).

## 5. Cosas a saber

- **Inicio de sesión.** El launcher usa el mismo acceso que el launcher oficial de Minecraft, como casi todos los
  launchers no oficiales. Por eso la ventana de Microsoft dice «Minecraft». Funciona sin pedir permiso a nadie, pero
  si Microsoft algún día lo cortara, la alternativa es registrar una app propia en Azure, pedir que Mojang la
  apruebe (https://aka.ms/mce-reviewappid) y poner su ID en `microsoftClientId`.
- **Aviso de Windows.** Sin firma digital, Windows muestra «Windows protegió tu PC» al instalar (*Más información →
  Ejecutar de todas formas*). Para quitarlo hace falta un certificado de firma (por ejemplo Azure Trusted Signing).
- **Licencias de los mods.** Algunos mods no permiten que los vuelvas a subir a otro sitio. Revisa la licencia de
  cada uno antes de ponerlo en `datos/plus/mods/`.
- **El repositorio tiene que ser público** para que el launcher pueda leer `datos/` y actualizarse.

## Para quien programe

Si algún día quieres probar cambios en tu PC sin publicarlos: instala Node.js LTS y en esta carpeta ejecuta
`npm install` y luego `npm start`. `tools/genarte.py` vuelve a hacer el fondo por defecto, el hipogrifo y el icono
(usa `hipogrifo.py` y `genastro.py` de ZeroriaStats).
