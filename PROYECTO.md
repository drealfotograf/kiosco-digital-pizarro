# Kiosco Digital Pizarro · Creación y avance del proyecto

> **Lectura obligatoria al iniciar cada sesión.** Este archivo se carga solo al empezar (hook SessionStart),
> y al cerrar la sesión se añade solo una entrada al registro (hook SessionEnd).
> Durante la sesión, Claude actualiza «Estado actual», «Decisiones», «Próximos pasos» y el registro del día.

---

## 1. Objetivo
Aplicación para que los clientes de la tienda pasen sus fotos desde cualquier dispositivo y las impriman o las pidan al laboratorio.

- **Fuentes de fotos:**
  - Memoria USB y tarjeta de memoria.
  - Móvil por WiFi (código QR), por cable y por Bluetooth.
  - Correo electrónico y carpeta compartida en red.
  - Galería privada.
- **Impresión:** varios tamaños elegidos por el cliente y varias impresoras.
- **Laboratorio:** envío al servidor de la tienda para que el laboratorio haga las copias.
- **Fotos carnet:** formatos de Europa y EEUU, más uno personalizado. Guías de corte activables y lotes de varias personas.
- **Máscaras y marcos** para eventos.
- **Galerías de trabajo** con contraseña.
- **Añadido el 17/11/2026 (segunda tanda):**
  - Carpeta compartida del servidor de libre acceso desde el kiosco.
  - Validación de formatos con aviso emergente.
  - Ampliar con márgenes de color.
  - Nueva zona de selección con filtros y corrección de color.
  - Aviso de calidad con tamaño recomendado.
  - Añadir más fotos sin perder las ya elegidas.
  - Retener, repetir y reprocesar pedidos, que se guardan 30 días.
  - Perfil sRGB.
  - Tarifas con importación y exportación.
  - Gestión de pedidos por estado.
  - Tipos de lotes.

**Plataforma:** Windows. Kiosco con pantalla táctil para el cliente y servidor local en la tienda (sin nube).

---

## 2. Arquitectura

| Parte | Tecnología | Carpeta |
|---|---|---|
| Kiosco táctil | Electron 37, React 19, Vite 6 y sharp 0.34 | `kiosk/` |
| Servidor de tienda | Node 24, Express 4, sharp, bcryptjs, archiver y multer; base de datos en JSON | `server/` |

### Kiosco: proceso principal (`kiosk/main/`)
| Archivo | Función |
|---|---|
| `main.js` | Ventana (modo kiosco opcional), todas las llamadas IPC y el protocolo `kimg://` para mostrar imágenes locales con lista blanca de rutas |
| `preload.cjs` | Puente seguro hacia la interfaz (`window.kiosk.call / on`) |
| `config.js` | Ajustes en `%APPDATA%/kiosco-pizarro/settings.json`, fusionados con los valores por defecto |
| `session.js` | Una sesión por cliente con código de 5 caracteres. Importa las fotos (convierte HEIC, corrige la orientación EXIF, genera miniaturas y vistas previas, descarta duplicados) y lo **borra todo al terminar** |
| `images.js` | Miniaturas bajo demanda con caché, conversión de HEIC y recorrido de carpetas |
| `render.js` | Render final con sharp a 300 ppp: recorte o encaje, máscara (girada si hace falta), hojas de carnet con guías de corte en SVG y máscaras de ejemplo |
| `print.js` | Impresión silenciosa con Electron, una cola por impresora y reparto rotativo entre las impresoras de un mismo tamaño. Opción «papel del driver» |
| `orders.js` | Presupuesto (calculado en el proceso principal, no en la interfaz), render, impresión o envío y registro `orders.log.jsonl`. Números de pedido `KAAMMDD-0001` |
| `lab.js` | Envío al laboratorio por HTTP (multipart con clave de kiosco) o a una carpeta compartida (con `pedido.json` y `pedido.txt`) |
| `gallery.js` | Entrada a las galerías del servidor e importación de originales para imprimir |
| `sources/drives.js` | Detección de USB y tarjetas por WMI, consultada cada 3 s |
| `sources/mtp.js` y `scripts/mtp.ps1` | Móvil por cable (Android e iPhone, protocolos MTP/PTP) mediante Shell.Application; copia las 300 fotos más recientes de DCIM y Pictures |
| `sources/upload-server.js` | Servidor web en el puerto 8787. El cliente escanea el QR y sube las fotos desde el navegador. Incluye un QR para conectarse a la WiFi |
| `sources/email.js` | Lectura del buzón por IMAP (imapflow). Toma los correos no leídos cuyo asunto lleva el código de sesión y guarda sus adjuntos |
| `sources/bluetooth.js` | Abre el asistente de Windows `fsquirt` y vigila la carpeta donde se reciben los archivos |

### Kiosco: módulos añadidos en la segunda tanda
| Archivo | Función |
|---|---|
| `main/store.js` | Almacén de pedidos en `%APPDATA%/kiosco-pizarro/pedidos/<n.º>/`, con `originales/` y `pedido.json` (todos los ajustes). Estados: held (sin terminar), sent (enviado), printed (impreso), error y processing. Lista, borra y purga los pedidos con más días de los indicados (30 por defecto; se revisa al arrancar y cada 6 h) |
| `main/orders.js` | `quote` (tramos de precio y lotes), `submitOrder` (guarda y después entrega; si falla, el pedido queda en «Con error»), `holdOrder` (código de 6 caracteres), `repeatOrder` (todo o parte), `retryOrder` |
| `main/tariffs.js` | Exportación e importación de tarifas en CSV con «;» (copias con tramos, carnet y lotes) |
| `main/sources/srvshare.js` | Carpeta compartida del servidor: lista, miniaturas y descarga con la clave del kiosco |
| `shared/color.js` | Doce filtros y la corrección de color (brillo, contraste, saturación y temperatura) como **una sola matriz**. Se aplica igual en la vista previa (feColorMatrix SVG en sRGB) y en el render (sharp recomb + linear) |
| `shared/quality.js` | Resolución efectiva (ppp) según el recorte; niveles excelente ≥250, buena ≥180, justa ≥120 y baja; tamaño recomendado (el mayor con ≥180 ppp) |
| `renderer/screens/Studio.jsx` | **Zona de selección:** foto ampliada al máximo arriba, todas las miniaturas abajo y panel con las pestañas Tamaño, Filtros, Color y Marco |
| `renderer/screens/AdminOrders.jsx` | Pedidos por estado. El detalle muestra fotos, tamaños y copias, con Eliminar, Repetir (todo o lo seleccionado, a impresión o al laboratorio), Reprocesar o Continuar, y Reintentar |
| `renderer/components/Filmstrip.jsx`, `ColorTools.jsx` | Tira de miniaturas con insignias de copias y de calidad baja; rejilla de filtros y deslizadores de color |

**Flujo nuevo del cliente:**
1. Elige el origen y se cargan **todos** sus archivos al «carrete», con vistas previas de baja calidad bajo demanda (`kimg://f/thumb?p=…&s=360|1600`).
2. Si un archivo no es compatible, aparece un aviso y se continúa con los siguientes.
3. Al tocar una miniatura, la foto se importa (copia del original y vista previa) y entra en el pedido.
4. Se edita y se pasa a Continuar. Desde la edición puede pulsar «Añadir más fotos» o «Guardar para después».

**Validación de archivos** (en dos pasos):
1. Extensión: se admiten JPEG/JPG/JPE/JFIF, PNG, WEBP, HEIC y HEIF; los vídeos y los demás formatos se rechazan con su motivo.
2. Firma real del archivo: detecta archivos dañados y vídeos renombrados.

El aviso emergente pide confirmación e incluye la opción «No avisar más en esta carga».

### Kiosco: código compartido (`kiosk/shared/`)
- `presets.js`: tamaños de copia, formatos de carnet, hojas y ajustes por defecto, y formato de moneda.
- `layout.js`: recorte por defecto, zoom, orientación del marco, maquetación de la hoja (prueba la hoja en vertical y en horizontal y elige la que admite más fotos), reparto en hojas de los lotes y guías de corte.

### Kiosco: interfaz (`kiosk/renderer/src/`)
- **Pantallas** (`screens/`):
  - `Home`: inicio con el icono ⚙️ protegido por PIN.
  - `Sources`: siete fuentes de fotos y la bandeja de la sesión.
  - `PrintOrder`: tamaño, copias, rellenar o encajar, marco, duplicar y encuadre.
  - `IdPhoto`: formatos, editor con guías de cara, lotes y vista previa de la hoja.
  - `Checkout` y `Done`: resumen, datos del cliente y elección entre imprimir o laboratorio.
  - `Admin`: seis pestañas de ajustes.
- **Componentes** (`components/`):
  - `CropEditor`: arrastrar, pellizcar, rueda del ratón y deslizador.
  - `Framed`: vista previa del marco con la máscara.
  - `Picker`: selector de fotos y explorador de carpetas.
  - `ui`: iconos, contador, ventana modal, indicador de espera y teclado en pantalla (`TouchField`).
- **Estilos:** `styles.css` con la tipografía Plus Jakarta Sans incluida (`@fontsource-variable`).

### Servidor (`server/`)
- **`server.js`:**
  - **Configuración** en `data/config.json`. La primera vez genera la contraseña de administración y la clave del kiosco, y las guarda en `data/CREDENCIALES-INICIALES.txt`.
  - **Base de datos** `data/db.json`, con escritura atómica.
  - **Pedidos:** `POST /api/orders` con clave de kiosco. Estados nuevo / en proceso / listo / entregado, miniaturas, descarga en ZIP y borrado. Copia opcional a una **carpeta caliente** agrupada por tamaño, para el minilab.
  - **Galerías:**
    - Se crean con un código de 6 caracteres y la contraseña cifrada con bcrypt.
    - Al subir las fotos se generan la miniatura y la vista previa.
    - El cliente puede marcar favoritas y descargar en ZIP si la galería lo permite.
    - El original solo se entrega si la descarga está permitida o lo pide un kiosco con su clave.
  - **Seguridad:** sesiones con token que caducan, límite de 8 intentos fallidos de acceso (bloqueo de 15 min) y comparación de claves en tiempo constante.
  - **Comandos:** `npm run set-password -- NUEVA`. La variable `PIZARRO_DATA` cambia la carpeta de datos (se usa en las pruebas).
- **`public/`:**
  - `admin.html/js`: panel de pedidos, galerías y ajustes.
  - `gallery.html/js`: acceso del cliente, visor y favoritas.
  - `style.css`: estilos, con modo oscuro.

### Configuración del espacio de trabajo
- `CLAUDE.md`: instrucciones de trabajo (leer y actualizar este archivo).
- `.claude/settings.json`: hooks SessionStart y SessionEnd, que ejecutan `.claude/hooks/session-start.ps1` y `session-end.ps1`. Los scripts deben guardarse en UTF-8 con BOM para que PowerShell 5.1 lea bien los acentos.
- `README.md`: guía de puesta en marcha para el usuario.

---

## 3. Decisiones tomadas
- Kiosco **a pantalla completa y táctil** con teclado en pantalla propio. El modo kiosco bloqueado se activa en los ajustes.
- **Servidor local** en la tienda: sin coste mensual, y las galerías solo se ven dentro de la red de la tienda.
- Recortes en **coordenadas normalizadas (0..1)**. La interfaz muestra una vista previa de 1600 px y el render final usa el original a 300 ppp.
- Los archivos para la impresora se entregan **siempre en vertical**: las fotos y hojas horizontales se giran 90°.
- **Fotos carnet:**
  - Formatos: DNI 26x32, UE 35x45, Reino Unido, EEUU 2x2", Canadá 50x70, México, China 33x48, India y medida personalizada.
  - Las marcas de corte van en el margen exterior.
  - **Precio por hoja.**
  - Por defecto, cada persona llena una hoja completa.
- **Máscaras:** archivos PNG con transparencia que se estiran al tamaño de la copia y se giran 90° si no coinciden con la orientación de la foto. Hay una «máscara de evento activo» que se aplica a todas las copias.
- **Privacidad:** al terminar, cancelar o pasar el tiempo de inactividad (180 s + 20 s de aviso), se borran las fotos del cliente. Al arrancar se limpian las sesiones que hayan quedado de un cierre inesperado.
- La contraseña del correo IMAP se guarda **sin cifrar** en los ajustes del kiosco. Se recomienda un buzón exclusivo para el kiosco.
- **Diseño (17/11/2026):** claro y moderno.
  - Degradado violeta → rosa (`#6d4aff → #a64dff → #ff5c9d`) y paneles translúcidos con desenfoque de fondo.
  - Botones en forma de píldora, sin bordes duros, y sombras suaves de color.
  - Tipografía Plus Jakarta Sans y animaciones suaves.
- **Acceso del personal:** icono ⚙️ visible en el inicio, protegido por PIN (por defecto `1234`, se cambia en Administración → General).
- **Ampliar con márgenes:** la foto entera se encaja en el tamaño pedido y lo que falta se rellena con el color elegido (blanco por defecto, cinco colores más o uno libre). El filtro no se aplica a los márgenes.
- **Perfil de color:** todas las salidas se convierten a sRGB y llevan el perfil sRGB incrustado.
- **Tarifas por tramos:** el precio unitario depende de la cantidad **total** de ese tamaño en el pedido.
- **Lotes de carnet:** cada persona puede ir «por hojas» (precio de hoja) o con un lote (n.º de fotos fijo y precio cerrado).
- **Pedidos retenidos:** se guardan con el código `R-XXXXXX` y se continúan desde «Continuar un pedido guardado» en el inicio. Al completarse, el pedido retenido se borra.
- **Repetir o reprocesar:** las repeticiones crean un pedido nuevo (`repeatOf`) a partir de los originales guardados. Reprocesar abre el pedido en la zona de selección con todos sus ajustes (`reprocessOf`).
- **Carpeta del servidor:** `server/data/compartida`, configurable en el panel web. Solo los kioscos acceden, con su clave (cabecera o `?k=`), y no se permiten rutas fuera de la carpeta.
- **La configuración del servidor admite BOM**, por si se edita `config.json` con el Bloc de notas.
- **Identidad Pizarro (tercera tanda):**
  - Paleta: Azul Profundo #0F2740 (principal), Arena #C9B29A, Crema #F6F2EA (fondo), Oliva #6B7055, Topo #8D7B6B y Grafito #333333.
  - Tipografía Montserrat (incluida en el proyecto).
  - Logo vectorial (`Logo` en `ui.jsx`): esquinas de encuadre y PIZARRO, **sin «FOTOGRAF»**, más una versión icono con la P.
  - Diseño minimalista: sin degradados ni cristal, líneas finas y radios de 12–22 px.
  - Inicio con panel azul de marca a la izquierda y opciones a la derecha.
- **Selección de fotos:**
  - Tocar una miniatura solo la muestra; ya no se añade sola al pedido.
  - **Pulsación larga** (450 ms, como en Android) activa la multiselección. Allí se elige tamaño (o «Mantener sus tamaños») y copias, y se aplica a todas las marcadas. El botón «Seleccionar todas» las marca todas.
- **Copias por tamaño:** cada tamaño de la cuadrícula lleva su contador; al tocar un tamaño se pide 1 copia.
- **Más tamaños:**
  - La lista rápida se configura en `quickSizes` (columna «Lista rápida» en Tamaños). El resto aparece en el desplegable «Más tamaños».
  - Al elegir uno, ocupa el hueco de un tamaño sin copias de esa foto; si todos tienen copias, se añade al final.
  - `otherSizeMode` decide si el cambio es **puntual** (solo ese cliente) o **siempre** (queda en la lista rápida).
- **Modelo de pedido en la interfaz:**
  - `items` = {foto, tamaño, copias}.
  - `edits[foto]` = {filtro, color, giro, marco, modo, fondo, recortes por tamaño, orientación por tamaño}.
  - `printSpec` los combina en el mismo formato de siempre, así que el proceso principal y `pedido.json` no cambian; solo se añade `angle`.
- **Enderezar:**
  - Dos dedos giran y hacen zoom; también hay un deslizador de ±45° y un botón «Quitar giro».
  - En «Recortar y llenar», `clampCropRot` reduce y desplaza el recorte para que el marco girado **nunca salga de la foto**: si la caja envolvente del rectángulo girado cabe en la imagen, cabe el rectángulo.
  - En «Ampliar con márgenes», la foto girada entera cabe en el marco y los márgenes son del color elegido.
  - Render: sharp gira la imagen completa y luego recorta (`rotatedCenter`).
- **Formatos nuevos:**
  - **AVIF** y **GIF** (se imprime el primer fotograma), leídos con sharp.
  - **PDF**: cada página es una foto, convertida a 300 ppp con **pdf.js + @napi-rs/canvas** (`main/pdf.js`). `@napi-rs` se desempaqueta del asar en el instalador.
  - Las firmas reales se comprueban: `GIF8`, `%PDF-` y la marca `avif`.
- **Pantalla de referencia: 22" a 1920x1080.**
- **Acceso del personal discreto:** el engranaje del inicio es pequeño (22 px), sin fondo y al 40 % de opacidad (`.staff-btn`).
- **Parte que no se imprime en transparencia:**
  - En «Recortar y llenar», la foto completa se dibuja al 30 % de opacidad alrededor del marco (`.crop-ghost`) y el marco lleva un filo crema. Así se ve lo que la proporción del tamaño deja fuera.
  - La foto también se puede arrastrar desde la zona transparente.
  - Se deja un margen alrededor del marco para que esa zona se vea.
- **Zona de selección compacta (cuarta tanda):** sin pestañas; tamaño, copias, calidad, encuadre, filtro (rejilla de 6×2), color (deslizadores 2×2) y marco, todo a la vista sin desplazamiento a 1920x1080. Barra superior reducida, imagen más grande.
- **Elegir un tamaño no añade copia:** solo lo muestra en el encuadre. La copia se añade con «Añadir … al pedido» (o con «+»).
- **Miniaturas:** pequeñas (64 px), medianas (92 px) o grandes (150 px), o ocultas. Se recuerda en el kiosco (`localStorage`). Al ocultarlas, la barra inferior queda en una línea y la imagen crece.
- **TIFF y RAW de cámara:**
  - TIFF se lee directamente.
  - RAW (DNG, CR2, CR3, CRW, NEF, NRW, ARW, SRF, SR2, ORF, RW2, RAF, PEF, SRW, 3FR, ERF, KDC, MRW, MEF, IIQ, RWL, X3F): se usa la **mayor imagen JPEG incrustada** (la vista previa a tamaño completo de la cámara) y se aplica la orientación del RAW. No es un revelado: el color es el que decidió la cámara.
  - Si el RAW no trae una vista previa de al menos 640x480, se avisa con ese motivo.
  - El servidor genera también las miniaturas de los RAW de su carpeta compartida.
- **Quinta tanda (17/11/2026):**
  - **Inicio:** el logotipo va centrado en vertical. Debajo hay una línea breve sobre privacidad y el enlace «Protección de datos (RGPD) y aviso legal», que abre una ventana con dos pestañas (primera capa del RGPD, art. 11 LOPDGDD). Los datos del titular (razón social, NIF, dirección, correo, teléfono, DPD, registro mercantil) se rellenan en Administración → General. Mientras falten, se ven entre corchetes.
  - **Zona de selección v3:**
    - La foto va al centro y las miniaturas a la derecha, en una cuadrícula de 1 a 4 columnas. El deslizador de arriba tiene un icono de foto pequeña a la izquierda y de foto grande a la derecha.
    - Todas las opciones pasan a la barra inferior: tamaño, encuadre, filtro, color, texto y escritura, y «Más».
    - **Código de colores por tamaño:** cada tamaño tiene un color (editable en Tamaños e impresoras). Las miniaturas llevan un punto de color con el número de copias de cada tamaño, y la leyenda del pie explica los colores.
  - **Importar:** «Solo esta carpeta» o «Todo (con subcarpetas)», en carpetas locales y en la del servidor. Salir a buscar más fotos no cierra el pedido: las nuevas se añaden.
  - **Polaroid** dentro de 10x15 (papel 102x152 mm, con línea de corte discontinua):
    - **8,5x8,5:** imagen de 85x85 mm con 8,5 mm de margen arriba y a los lados y 2 cm abajo. La tarjeta mide 102x113,5 mm. **Corregido a petición del cliente; antes era de 10x10.**
    - **8x10:** imagen de 80x100 mm y 2 cm de margen inferior.
    - Admiten texto (5 letras de Windows, 8 colores y tamaño) y escritura a mano con el dedo, que se imprimen igual que se ven.
  - **Ajustar con fondo:** la foto se escala y se mueve libremente (pinza y arrastre) dentro del formato. El hueco se rellena de blanco, negro u otro color. «Restaurar» devuelve la foto a su estado original.
  - **Borde blanco:** es un margen proporcional en los cuatro lados (5 mm por defecto, de 1 a 20 mm), independiente del encuadre.
  - **Copia virtual:** es una entrada nueva con el mismo original y ajustes independientes (encuadre, color, tamaños, texto). Se marca «CV» y se conserva al guardar o reprocesar el pedido (campo `vc`).
  - **Impresión y envío** (Administración, pestaña nueva):
    - Se puede imprimir en el kiosco, enviar al servidor o las dos cosas.
    - **Carpeta de destino:** se elige entre las subcarpetas de la «carpeta raíz de exportación» del servidor, o se escribe una nueva.
    - **Si el servidor no responde,** la copia se guarda en la ruta local alternativa con un `pendiente.json` y se reintenta sola cada N minutos. También hay un botón «Reintentar pendientes ahora».
    - **Confirmación:** el servidor tiene que confirmar el número de archivos guardados. La pantalla final dice si la copia está confirmada en el servidor o guardada en la ruta local.
    - **Nombres:** `AAAA_MM_DD_Nº/<tamaño>/AAAA_MM_DD_Nº_<foto>.jpeg`, con `_(n)` si hay varias copias y `-2` si se repite el nombre. Siempre en JPEG sRGB.
  - **Resumen:** antes de imprimir o enviar se pregunta «¿Confirmas la impresión?», y después se da el número de pedido.
  - **Lotes de carnet (pantalla nueva):**
    - Sin nombres de países. Medida española de 35x45 en papel horizontal, con separaciones iguales entre fotos y márgenes.
    - **Lote 1:** 8 fotos iguales. **Lote 2:** 4 fotos de 35x45 y una de 7x10, que tiene su propio encuadre.
    - Vista previa en vivo. Guías de corte y/o marco de foto, y guías de cara.
    - Copias por lote. «Añadir otro lote» memoriza el actual con su miniatura y permite elegir otro sin salir. Al continuar se pasa al resumen con su confirmación.
    - En Administración → Lotes de carnet se activa o desactiva cada lote (hay otros dos de serie, desactivados), se cambian nombre y precio, y se ven las vistas previas. También se decide qué opciones puede tocar el cliente.
    - Los pedidos antiguos de carnet por formato se siguen abriendo en la pantalla anterior.
  - **Zoom continuo (petición posterior):**
    - Al reducir la foto por debajo de «llena el formato» (con dos dedos, el deslizador «Más pequeña / Más grande» o la rueda), pasa sola a márgenes con el color de fondo elegido (blanco por defecto). Al ampliar, vuelve sola a recorte.
    - El botón «Ajustar con fondo» se llama ahora «Foto entera».
    - Los colores de fondo se ven siempre, así la imagen no cambia de tamaño al pasar de un modo a otro.
    - La parte de la foto que queda fuera del corte se ve más (opacidad del 55 %) y el borde del corte está más marcado.
  - **Lotes de 5,1x5,1 (2x2") en 10x15:**
    - «4 fotos 5,1x5,1»: es el máximo que cabe. Las dos filas de 51 mm ocupan los 102 mm del papel, así que no hay separación vertical.
    - «4 fotos 5,1x5,1 + 1 de 5x7»: la 5x7 sigue el encuadre de las pequeñas (`bigFollows`, `followCrop`). Mantiene el mismo ancho en la foto y el mismo borde superior, y se alarga por abajo.
    - El antiguo «c4u» (que eran 2 fotos 51x51) desaparece de las instalaciones nuevas.
  - **Plantillas de carnet:** en Administración → Lotes de carnet se pueden exportar y cargar en JSON (`pizarro-plantillas-carnet`) con sus opciones.
    - Al cargar, cada plantilla se valida (`lotProblem`: medidas, tipo y que quepa en 10x15).
    - Se actualiza la que tiene el mismo id y se añaden las nuevas. Las dañadas se omiten indicando el motivo.
    - Cada plantilla se puede quitar.
  - **Miniaturas con copias:** llevan un marco del color de su tamaño. Si tienen varios tamaños, el contorno se reparte entre sus colores.
  - **Filtros en la barra inferior:** forman una cuadrícula de 4x3 con cuadros iguales de 56 px y el nombre sobre la imagen. Antes eran de 6 columnas, con tamaños desiguales y cortados.
  - **Impresora simulada DNP DS620** (Administración → Impresión y envío, activada para las pruebas):
    - Los tamaños sin impresora que admite la DS620 (9x13, 10x15, 13x18, 15x20, 15x23 y 5x15, incluidas Polaroid y lotes de carnet) se «imprimen» como JPEG en `DocumentosKioscoPizarroImpresora simulada DNP DS620AAAA-MM-DD`, con `registro.txt`.
    - También aparece en la lista de impresoras para asignarla a mano.
    - **Hay que desactivarla al conectar la DS620 real.**
  - **Miniaturas v4:**
    - El nombre va debajo de la imagen, y a su lado un punto de color por cada tamaño con copias (con el número si caben). Sustituye al marco de color.
    - La foto en vista previa se ve como una tarjeta azul profundo con un anillo arena y el nombre en crema.
  - **Barra inferior más baja (unos 180 px, antes unos 290):**
    - La calidad pasa a la cabecera de «Tamaño».
    - Filtros en 6x2.
    - Encuadre en 4 filas.
    - «Texto», «A mano», marco y copia virtual juntos en «Más».
  - **Salida por tamaño:** en Administración → Tamaños cada tamaño tiene un menú «Al confirmar el pedido», que hace que en un mismo pedido unos tamaños se impriman y otros vayan al servidor:
    - Opciones: «Según ajustes generales», «Imprimir», «Enviar al servidor» o «Imprimir y enviar».
    - `sizeOutput` decide la salida en el proceso principal y en el resumen.
  - **Tamaños e Impresoras en dos menús:**
    - **Tamaños:** color, nombre, medidas, precio, salida, lista rápida, y «Exportar / Importar tamaños» en JSON (`pizarro-tamanos`), que incluye precios y tramos, colores, salida y Polaroid.
      - Las impresoras no viajan en el archivo.
      - Al importar se validan (`sizeProblem`), se conservan las impresoras de este kiosco y se fusionan por id.
    - **Impresoras:** impresoras detectadas, impresoras por tamaño, papel del driver y prueba. Indica si un tamaño usa la DS620 simulada o si no puede imprimirse aquí.
    - Las tarifas siguen teniendo su CSV en «Tarifas».
  - **Fotos guardadas 30 días salvo que el cliente diga lo contrario:**
    - El resumen del pedido lleva «Guardar mis fotos 30 días», marcado por defecto (`keepPhotosDefault` en General).
    - Si el cliente lo desmarca, los originales se borran al entregar el pedido (`dropOriginals`) y queda solo el registro.
    - El aviso RGPD y el texto de inicio lo explican.
  - **Selección múltiple:** se pueden aplicar 0 copias, lo que quita ese tamaño (o la foto) del pedido.
  - **Resumen del pedido:** al tocar un tamaño se abre a la izquierda un lateral con las miniaturas de ese tamaño y sus copias.
  - **PIN de caja:** cada pedido recibe un PIN de 3 cifras al azar (`crypto.randomInt`).
    - Modos: «Para todo» (por defecto), «Solo para algunas cosas» (copias, carnet o tamaños concretos) o desactivado. Se configura en Impresión y envío.
    - El pedido queda «Pendiente de pago» (estado `awaiting`) y no se imprime nada.
    - El cliente paga en caja con su ticket y escribe el PIN en la pantalla de espera o, más tarde, desde el inicio en «Tengo un PIN de caja» (nº de ticket + PIN). Hay 5 intentos.
    - El personal ve el PIN en Pedidos → «Pendientes de pago» (con el botón «Cobrado: liberar e imprimir») y en la web del servidor → Caja.
    - Si Gestión confirma la venta, el kiosco lo imprime solo; si la anula, el pedido queda «Anulado». El kiosco lo consulta cada 20 s.
  - **Ticket de caja (`kiosk/main/ticket.js`):**
    - Ticket de 80 mm con el nº corto grande, líneas con el código de artículo (campo «Código» en Tamaños y en Lotes de carnet), total, base, IVA (21 % incluido, configurable) y código de barras Code 128.
    - Se imprime en la impresora de tickets elegida; sin ella, se guarda en PDF en la carpeta de la impresora simulada.
    - Se envía al servidor como «pendiente». Si no llega, se reintenta cada 20 s.
  - **Servidor:**
    - Tickets en `data/tickets`.
    - API para Gestión Pizarro (`x-gestion-key`, documentada en `server/GESTION-API.md`): listar y confirmar o anular ventas.
    - Pestaña «Caja» en la web, con pendientes, PIN, «Cobrado» y «Anular», y la suma del día solo con los pagados.
    - Clave de Gestión en Ajustes.
    - Los tickets pendientes no entran en contabilidad.
  - **PIN impreso en el ticket**, en grande (recuadro «PIN PARA IMPRIMIR»), a petición de la tienda.
  - **Recoger más tarde:** el nombre y el teléfono (9 cifras o más) son obligatorios, y el ticket indica «Pedido para recoger más tarde».
  - **Pantalla de espera del PIN:** las frases cambian cada 15 s con letras elegantes y modernas (Montserrat ultraligera en mayúsculas, Sitka en cursiva, Plus Jakarta Sans ligera, Corbel Light y Sitka Heading; todas funcionan sin internet), distinto tamaño y efecto de ampliación y paneo (`components/Quotes.jsx`):
    - «Tus fotos son tu memoria del pasado.»
    - «Imprime tus recuerdos, nunca los perderás.»
    - «La memoria es frágil…»
  - **Mi galería, solo para el personal:**
    - Ya no es una opción del inicio, sino un icono discreto junto al de ajustes que pide el PIN de seguridad.
    - Solo deja cargar de las entradas de red que el administrador marca en Fuentes de fotos (`galleryNet`): galerías del servidor, carpeta del servidor y cada carpeta de red; se pueden marcar varias.
    - Los clientes ya no ven «Mi galería» entre las fuentes.
  - **Letras a elegir (Administración → Letras):**
    - El programa tiene dos letras: el texto general y los títulos.
    - Los mensajes de la pantalla de espera van aparte: una o varias letras, que rotan, cada una con opción de cursiva, mayúsculas o fina.
    - Solo se ofrecen las letras instaladas en el equipo (`shared/fonts.js`).
  - **Mensajes solo en la pantalla de espera:** se quita del inicio el lema «Tus recuerdos, impresos hoy» y «Impresión fotográfica». Se mantiene la indicación «Toca una opción para empezar».
  - **Seguridad de los PIN (`kiosk/main/security.js`):**
    - Afecta a los PIN de ajustes, Mi galería y caja.
    - Un PIN erróneo borra lo escrito y avisa de los intentos que quedan.
    - Con 5 fallos se bloquea 5 minutos; el bloqueo se guarda en `bloqueos.json`, así que reiniciar no lo salta.
    - Se puede desbloquear antes con:
      - el móvil de la empresa: app de autenticación (TOTP, RFC 6238), vinculada en General → «Vincular el móvil de la empresa» con un QR;
      - un código de 6 cifras enviado por SMTP al correo de la empresa, válido 10 minutos.
    - Los secretos no llegan a la interfaz del cliente.
  - **Ajustes → Estadísticas (`kiosk/main/stats.js`, `screens/AdminStats.jsx`):**
    - **Registro:** anónimo y aparte de los pedidos (estos se borran a los 30 días), en `estadisticas/AAAA-MM.jsonl`. Recoge:
      - sesiones: inicio, duración, fotos, fuentes, si pidió y por qué acabó;
      - pedidos con su estado;
      - cada impresión (impresora, formato, copias);
      - ventas confirmadas;
      - PIN erróneos y bloqueos.
      No guarda nombres, teléfonos ni fotos.
    - **Vista diaria** (por hora) o **mensual** (por día), con flechas para cambiar de periodo y «Exportar CSV».
    - **Indicadores:**
      - sesiones y % con pedido;
      - duración media y mediana;
      - fotos por sesión;
      - pedidos, copias y ticket medio;
      - importe y lo confirmado en caja;
      - copias impresas;
      - pendientes de pago, anulados y errores;
      - PIN erróneos y bloqueos.
    - **Gráficos:**
      - barras de una sola medida a elegir (sesiones, pedidos, copias o importe);
      - horas de más afluencia y mapa día × hora;
      - fuentes usadas;
      - copias frente a carnet;
      - motivos de las sesiones sin pedido;
      - tamaños más pedidos;
      - últimas sesiones.
    - **Consumos por impresora:** copias, trabajos, m² de papel y rollos estimados de la DNP DS620 por formato (6x4" 400, 5x7" 230, 6x8" 200, 6x9" 180).
  - **Tarifas:**
    - Lista de tamaños con precio/ud, precios por cantidad, impresora, salida y carpeta.
    - «Editar» abre un editor (`screens/AdminTariffs.jsx`) con: tamaño, precio por unidad, tramos (añadir o quitar, con ejemplo), impresoras, «Al confirmar el pedido» y la carpeta del servidor.
    - La carpeta es la de por defecto (Impresión y envío) hasta que el administrador elija otra (`size.serverFolder`).
    - Al enviar, cada tamaño va a su carpeta: se agrupa por destino y `sendOrDefer` recibe `dest`, que también se guarda en `pendiente.json` para los reintentos.
  - **Ayuda, Exportar e Importar en las 14 páginas de Ajustes (`AdminTools.jsx`, `main/sections.js`):**
    - Los ajustes de cada página se guardan en JSON (`pizarro-ajustes`, por sección, sin contraseñas).
    - Al importar se rechaza el archivo de otra página y se conservan el PIN y las contraseñas.
    - Pedidos, estadísticas y máscaras se exportan como carpetas; al importarlas solo se añade lo que no existe.
  - **Ajustes → Copia de seguridad (`main/backup.js`, `AdminBackup.jsx`):**
    - **Programación:** días y franja horaria a elegir; por defecto, todos los días de 14:00 a 16:00. Se hace una vez al día y, si falla, se reintenta cada 15 min dentro de la franja.
    - **Contenido:** todo el kiosco o partes (ajustes, pedidos y fotos, estadísticas, máscaras).
    - **Tipo:** completa o incremental. La incremental copia solo lo que cambió y su `manifest.json` dice dónde está cada archivo. Cada 7 días se hace una completa.
    - **Destino:** una carpeta del servidor elegida por el administrador (`<carpeta>/KioscoPizarro_<kiosco>/AAAA-MM-DD_HHMMSS_<tipo>`).
    - **Conservación:** 15 días; se borran las más antiguas que ya no necesita ninguna copia posterior.
    - **Restauración** de una copia por partes.
    - **Configuración completa:** exportar e importar, con contraseñas opcionales, y «Volver a los ajustes de fábrica» (conserva el PIN, las claves y las copias).
  - **Estadísticas ampliadas:**
    - Tabla «Copias por tamaño y por impresora»: pedidos, copias, % del total, importe, copias en cada impresora, enviadas al servidor y fila de totales.
    - Copias por pedido, m² de papel y copias enviadas al servidor.
    - Día de la semana con más afluencia e importe por tipo (copias o carnet).
    - El registro de cada pedido guarda ahora el importe y las copias al servidor por tamaño.
  - **Texto del inicio:** «Tus fotos solo se usan para tu pedido. Por seguridad, tu pedido se almacena durante 30 días por si necesitas más copias, salvo que solicites su borrado.»
  - **Lotes de carnet por papel (schema 6):**
    - Cada lote indica su papel, `paper` ('10x15' o '15x20', `LOT_PAPERS`), y sus guías de cara, `face`.
    - Llevan una nota de «uso habitual» que solo ve el personal; el cliente no ve países.
    - **Lotes nuevos de 10x15:** 9 fotos 3x4, 6 fotos 4x4, 8 fotos 33x48 y 2 fotos 5x7. El lote de 26x32 pasa a 3x4 columnas, porque antes no cabía.
    - **Lotes nuevos de 15x20:** 15 fotos 35x45, 6 de 5,1x5,1, 18 de 3x4, 12 de 4x4, 15 de 33x48, 6 de 5x7 y 28 de 26x32 (este último desactivado).
    - La pantalla del cliente agrupa los lotes por papel; cada hoja se imprime en su papel.
  - **Impresora de los lotes:**
    - Se elige una para todos los lotes de un papel (`lotPrinters`) y, si se quiere, otra para un lote concreto (`lot.printers`).
    - Si no se elige ninguna, se usa la del tamaño de copia de ese papel.
  - **Pestaña «Formatos carnet» eliminada:** las guías de cara van ahora en cada lote.
  - **Pendiente:** unificar el formato del ticket y los códigos con las tarifas de Gestión Pizarro (el cliente dirá dónde están).
  - **Migración de ajustes (schema 5):** añade los lotes nuevos que falten.
  - **Migración de ajustes (schema 4):** las instalaciones existentes reciben las Polaroid y los lotes nuevos, y la Polaroid 10x10 antigua pasa a 8,5x8,5.

---

## 4. Estado actual
### Hecho
- [x] Estructura del proyecto (kiosco y servidor) e instalación de dependencias. Los scripts de instalación de electron, sharp y esbuild quedaron aprobados en el `allowScripts` de npm 11.
- [x] Las siete fuentes de fotos (USB/SD, WiFi QR, cable, Bluetooth, correo, carpeta de red y galería).
- [x] Pedido de copias: tamaño, copias, rellenar o encajar, marco, duplicar y encuadre táctil.
- [x] Impresión en varias impresoras por tamaño, impresión de prueba y opción «papel del driver».
- [x] Envío al laboratorio (HTTP o carpeta) y carpeta caliente en el servidor.
- [x] Fotos carnet: ocho formatos y uno personalizado, guías de cara, lotes, «cada persona en su propia hoja», hojas de 10x15, 13x18 y A4, guías de corte (sin guías, marcas o líneas) y separación ajustable.
- [x] Máscaras de ejemplo («Marco blanco» y «Evento - Nuestro gran día») y gestión de máscaras en Administración.
- [x] Galerías con contraseña (servidor, web del cliente e importación desde el kiosco).
- [x] Administración del kiosco en seis pestañas: General, Tamaños e impresoras, Fotos carnet, Fuentes, Laboratorio y galerías, y Máscaras.
- [x] Pruebas automáticas de principio a fin (todas superadas):
  - Importación, orientación EXIF y duplicados.
  - Copias de 10x15 a 1205x1795 px y 300 ppp.
  - Hoja UE con 8 fotos en 10x15.
  - Hoja EEUU con líneas de corte.
  - Envío al laboratorio por HTTP.
  - Rechazo de una clave de kiosco incorrecta.
  - Galería: contraseña incorrecta rechazada, original bloqueado para el cliente e importación desde el kiosco.
  - Borrado de la sesión al terminar.
- [x] Recorrido de la interfaz con capturas. Corregido: el botón «Listo» quedaba cortado en la ventana de encuadre y el editor de carnet se salía en pantallas bajas; ahora ambos se ajustan a la altura.
- [x] Rediseño moderno e icono de ajustes ⚙️ con PIN.
- [x] Sistema de seguimiento: PROYECTO.md, CLAUDE.md y los hooks de inicio y cierre (probados).
- [x] **Segunda tanda (todas las pruebas superadas):**
  - **Formatos:** vídeo, PDF, falso JPG y vídeo renombrado rechazados con su motivo.
  - **Calidad:** 300x200 px a 10x15 son 33 ppp, «insuficiente»; para 3000x2000 px se recomienda A4.
  - **Márgenes de color:** la esquina sale roja y la foto queda dentro.
  - **Filtro y color:** el B/N sale gris en el render y el brillo +60 aclara.
  - **Perfil sRGB** incrustado y 300 ppp.
  - **Tramos de precio:** 60 copias 10x15 = 15 €.
  - **Tarifas en CSV:** exportación e importación (actualiza y añade).
  - **Lote de carnet:** 6 € + una hoja de 8 € = 14 €.
  - **Pedidos guardados:**
    - `pedido.json` conserva filtro, márgenes y color.
    - Retener → continuar → al completarlo desaparece de «Sin terminar».
    - Repetición parcial.
    - Pedido con error → reintento → «Enviado».
    - Los de más de 30 días se borran.
  - **Carpeta del servidor:** lista (también el vídeo, para poder avisar), miniaturas y descarga. Sin clave no hay acceso y no se puede salir de la carpeta.
  - **Recorrido con capturas:** aviso emergente, zona de selección, filtros, color, márgenes, calidad baja, guardar para después, pedidos, detalle y tarifas.
- [x] **Tercera tanda (todas las pruebas superadas):**
  - **Formatos:** PDF, GIF y AVIF admitidos por extensión y por firma; un PDF falso se rechaza.
  - **PDF:** uno de 2 páginas da 2 fotos; la página horizontal sale a 1751x1238 a 300 ppp.
  - **Enderezar:** en 2000 recortes y giros aleatorios, ninguna esquina sale de la foto.
  - **Render con giro** de 12°, −30° y 45°: sin blanco en las esquinas; un recorte forzado fuera del borde se corrige solo.
  - **Márgenes con giro:** color arena exacto y la foto dentro.
  - **GIF, AVIF y página de PDF:** copia 10x15 a 300 ppp.
  - **Recorrido táctil simulado:**
    - Tocar solo muestra la foto.
    - Tocar un tamaño pide 1 copia, y «+» la sube a 2.
    - Desde «Más tamaños», 30x40 sustituye a A4 (que no tenía copias).
    - La pulsación larga activa la selección; «Seleccionar todas» con 10x15 ×2 se aplica a 5 fotos (total 12,50 €).
    - El inicio se ve con la identidad Pizarro.

- [x] **Quinta tanda (todas las pruebas superadas):**
  - **Render:**
    - Polaroid 8,5x8,5: papel 1205x1795, márgenes, texto a mano impreso en el margen y línea de corte a 113,5 mm.
    - Polaroid 8x10.
    - Borde de 5 mm.
    - «Ajustar» con fondo negro, reducida y desplazada.
    - Lote de 8 (8 fotos con separación blanca) y lote 4+7x10.
  - **Envío:**
    - Con el servidor apagado, copia local con `pendiente.json`.
    - Al encender el servidor (puerto 4100, datos aislados), el reintento envía y borra la copia local.
    - Estructura `Laboratorio/2026_11_17_0042/10 x 15 cm/…_(3).jpeg`.
    - Lista de carpetas del servidor y carpeta de destino nueva creada al enviar.
  - **Interfaz a 1920x1080 (capturas):**
    - Sin desplazamiento en la selección ni en los lotes.
    - Miniaturas de 1 a 4 columnas.
    - Polaroid con papel y escritura.
    - Fondo negro, borde, copia virtual, selección múltiple, colores y leyenda.
    - El pedido se conserva al volver de «Añadir más fotos».
    - Carnet sin países, con dos lotes memorizados.
    - Administración: envío y lotes.
    - Migración desde ajustes antiguos.

### Pendiente
- [ ] **Elegir la carpeta del servidor para las copias de seguridad** (Ajustes → Copia de seguridad). Sin ella no se hacen copias.
- [ ] **Unificar el ticket con Gestión Pizarro** cuando el cliente indique dónde están sus tarifas (códigos de artículo y formato de líneas), y conectar Gestión a la API de tickets.
- [ ] **Reiniciar el servidor de la tienda** para tener la Caja y la API de tickets. Hasta entonces, el kiosco guarda los tickets en local y los reenvía solo.
- [ ] **Datos legales del titular** en Administración → General (razón social, NIF, dirección, correo). Hasta entonces el aviso legal muestra marcadores entre corchetes.
- [ ] **Reiniciar el servidor de la tienda** para que tenga los nuevos puntos de exportación (`/api/export/folders` y el guardado por carpetas) y fijar su «carpeta raíz de exportación».
- [ ] Probar con **impresoras reales** (tamaños de papel del driver, por ejemplo DNP o Mitsubishi) y ajustar los precios reales.
- [ ] Probar **móvil por cable** (Android e iPhone), **Bluetooth** y **correo IMAP** con dispositivos y buzón reales.
- [ ] Revisar el diseño del **panel de administración del servidor** web (`server/public`) para igualarlo al nuevo estilo del kiosco.
- [ ] Generar el **instalador** (`npm run dist`) y probarlo en el PC del kiosco. Valorar que la app arranque sola con Windows.
- [ ] Hacer que el servidor arranque como servicio de Windows (por ejemplo con NSSM o el Programador de tareas).
- [ ] Opcional: publicar las galerías para verlas desde casa (abrir puertos, usar un túnel o pasar a la nube).

---

## 5. Próximos pasos
- **Seguridad y normativa (revisión del 17/11/2026):** ver el informe de la sesión. Lo urgente: rellenar los datos legales, cambiar el PIN 1234 y la contraseña del servidor, restringir el puerto 4000 a la red de la tienda en el firewall, y firmar el contrato de encargado del tratamiento si el laboratorio es de otra empresa.
0. Valorar, para orígenes con miles de fotos, una vista de cuadrícula a pantalla completa además de la tira inferior.
1. Configurar las impresoras reales en Administración → Tamaños e impresoras y hacer impresiones de prueba.
2. Prueba en la tienda con móviles reales (WiFi QR, cable y Bluetooth) y con el correo.
3. Igualar el estilo del panel web del servidor.
4. Generar el instalador y dejar kiosco y servidor arrancando solos.

---

## Repositorio
Público en **https://github.com/drealfotograf/kiosco-digital-pizarro** (sin licencia: todos los derechos reservados). Commits con el correo privado `noreply` de GitHub. Fuera del repositorio (`.gitignore`): `server/data/`, `node_modules/`, compilados, `.claude/` y archivos de Photoshop. Git y GitHub CLI están instalados en `C:\Program Files\Git` y `C:\Program Files\GitHub CLI`.

## 6. Cómo arrancar
Primero el servidor:

```bash
cd server && npm install && npm start
```

Después, en otra ventana, el kiosco:

```bash
cd kiosk && npm install && npm start
```

- Al arrancar por primera vez, el servidor crea `server/data/CREDENCIALES-INICIALES.txt` con la contraseña de administración y la clave del kiosco.
- En el kiosco: ⚙️ → PIN → Laboratorio y galerías. Ahí se ponen la dirección del servidor (`http://IP:4000`) y la clave del kiosco.
- Puertos: 8787 (subida por WiFi) y 4000 (servidor). Windows pedirá permiso en el firewall: acepta «Redes privadas».
- Pruebas: los scripts `e2e.mjs` y `ui.mjs` se ejecutan con `kiosk/node_modules/electron/dist/electron.exe <script>` y una carpeta de datos aislada. Se crearon en la carpeta temporal de la sesión; si se necesitan, se pueden volver a crear en `kiosk/tests/`.

---

## 7. Registro de sesiones
### 17/11/2026 · Sesión inicial
- **Requisitos acordados:** pantalla táctil, servidor local y las siete fuentes de fotos (se añaden correo y carpeta de red a petición del cliente). La primera fase es la base completa.
- **Kiosco:** proceso principal completo, interfaz React y panel de administración.
- **Servidor:** pedidos, galerías y paneles web.
- **Pruebas:**
  - Pruebas de principio a fin superadas.
  - Capturas de todas las pantallas.
  - Corregido el ajuste de altura de los editores de encuadre.
  - Corregidos dos fallos detectados al revisar el código: la ruta de unidades como `E:\` no se permitía y las marcas de corte se solapaban con las fotos.
- **Cambios pedidos por el cliente:**
  - Diseño más moderno y menos industrial (rediseño completo).
  - Icono de ajustes protegido por contraseña.
  - Archivo de proyecto de lectura obligatoria con guardado automático al cerrar.
- Se actualiza este archivo con todo lo realizado.
- **Segunda tanda, pedida por el cliente:**
  - Carpeta compartida del servidor y validación de formatos con aviso.
  - Ampliar con márgenes de color y nueva zona de selección con filtros, color y aviso de calidad.
  - Añadir más fotos, retener, repetir y reprocesar pedidos (guardados 30 días).
  - Perfil sRGB, tarifas con importar y exportar, pedidos por estado y tipos de lotes.
  - Se eliminan `PrintOrder.jsx` y `Picker.jsx`, que quedan sustituidos por `Studio.jsx` y por la carga por origen.
  - Nota: en el puerto 4000 de este equipo hay un servidor de la tienda en marcha (el real, con `server/data`). Las pruebas se hicieron en el puerto 4100 con datos aislados y sin tocarlo. Se reinició el mismo día con la versión nueva (proceso independiente en una ventana minimizada; la carpeta compartida `server/data/compartida` se creó y responde).

### 17/11/2026 · Tercera tanda
- **Pedidos por el cliente:**
  - La selección ya no marca sola: toque = ver, y pulsación larga = multiselección; botón «Seleccionar todas» con tamaño y/o copias.
  - Enderezar con dos dedos sin que la foto salga del encuadre (salvo con márgenes).
  - «Más tamaños» en un desplegable, con sustitución puntual o permanente.
  - Al dar copias a un tamaño, queda pedido.
  - PDF, GIF y AVIF imprimibles.
  - Identidad Pizarro (logo sin «FOTOGRAF», paleta y Montserrat) con diseño minimalista.
- **Cuarta tanda:**
  - Panel de opciones compacto, todo a la vista en 1920x1080, e imagen más grande.
  - Miniaturas ocultables y con tres tamaños.
  - Al elegir un tamaño ya no se añade una copia.
  - TIFF y RAW de cámara.
  - Pruebas: TIFF; DNG, NEF, CR3 y RAF simulados (con miniatura y vista previa, eligen la grande, 3000x2000); RAW sin vista previa avisa con su motivo; panel sin desplazamiento (871 ≤ 871 px); ocultar miniaturas amplía la imagen.
- **Pendiente de decidir con el cliente:** BMP y JPEG XL, revelado RAW real y el resto de mejoras propuestas.

### 17/11/2026 14:54 – 15:54 · Sesión cerrada (guardado automático, 60 min)
- Archivos modificados:
  - `iMGENES MENUS MUESTRA/Sin título-1.psb`
  - `kiosk/main/gallery.js`
  - `kiosk/main/images.js`
  - `kiosk/main/main.js`
  - `kiosk/main/orders.js`
  - `kiosk/main/preload.cjs`
  - `kiosk/main/render.js`
  - `kiosk/main/session.js`
  - `kiosk/main/sources/bluetooth.js`
  - `kiosk/main/sources/email.js`
  - `kiosk/main/sources/srvshare.js`
  - `kiosk/main/sources/upload-server.js`
  - `kiosk/main/store.js`
  - `kiosk/main/tariffs.js`
  - `kiosk/renderer/src/api.js`
  - `kiosk/renderer/src/App.jsx`
  - `kiosk/renderer/src/components/ColorTools.jsx`
  - `kiosk/renderer/src/components/CropEditor.jsx`
  - `kiosk/renderer/src/components/Filmstrip.jsx`
  - `kiosk/renderer/src/components/ui.jsx`
  - `kiosk/renderer/src/screens/Admin.jsx`
  - `kiosk/renderer/src/screens/AdminOrders.jsx`
  - `kiosk/renderer/src/screens/Checkout.jsx`
  - `kiosk/renderer/src/screens/Home.jsx`
  - `kiosk/renderer/src/screens/IdPhoto.jsx`
  - `kiosk/renderer/src/screens/Sources.jsx`
  - `kiosk/renderer/src/screens/Studio.jsx`
  - `kiosk/renderer/src/styles.css`
  - `kiosk/shared/color.js`
  - `kiosk/shared/presets.js`
  - `kiosk/shared/quality.js`
  - `README.md`
  - `server/package.json`
  - `server/package-lock.json`
  - `server/public/admin.html`
  - `server/public/admin.js`
  - `server/server.js`

### 17/11/2026 15:59 – 17:51 · Sesión cerrada (guardado automático, 112 min)
- Archivos modificados:
  - `.gitignore`
  - `CLAUDE.md`
  - `iMGENES MENUS MUESTRA/Sin título-1.psb`
  - `kiosk/main/images.js`
  - `kiosk/main/main.js`
  - `kiosk/main/orders.js`
  - `kiosk/main/pdf.js`
  - `kiosk/main/render.js`
  - `kiosk/main/session.js`
  - `kiosk/main/sources/upload-server.js`
  - `kiosk/package.json`
  - `kiosk/package-lock.json`
  - `kiosk/renderer/src/api.js`
  - `kiosk/renderer/src/App.jsx`
  - `kiosk/renderer/src/components/ColorTools.jsx`
  - `kiosk/renderer/src/components/CropEditor.jsx`
  - `kiosk/renderer/src/components/Filmstrip.jsx`
  - `kiosk/renderer/src/components/ui.jsx`
  - `kiosk/renderer/src/main.jsx`
  - `kiosk/renderer/src/screens/Admin.jsx`
  - `kiosk/renderer/src/screens/Home.jsx`
  - `kiosk/renderer/src/screens/IdPhoto.jsx`
  - `kiosk/renderer/src/screens/Sources.jsx`
  - `kiosk/renderer/src/screens/Studio.jsx`
  - `kiosk/renderer/src/styles.css`
  - `kiosk/shared/layout.js`
  - `kiosk/shared/presets.js`
  - `server/server.js`

### 17/11/2026 17:58 – 18:26 · Sesión cerrada (guardado automático, 28 min)
- Sin cambios en archivos del proyecto.

### 17/11/2026 · Quinta tanda
- **Inicio:** enlace RGPD con aviso legal desplegable y logotipo centrado.
- **Zona de selección:** miniaturas a la derecha (1–4 columnas con deslizador), opciones en la barra inferior, colores por tamaño y leyenda.
- **Importar:** «Solo esta carpeta» o «Todo (con subcarpetas)».
- **Nuevo en las copias:** Polaroid 8,5x8,5 (el cliente corrigió la medida, que era 10x10) y 8x10, con texto y escritura a mano. «Ajustar con fondo» con escala y posición libres, borde blanco proporcional, «Restaurar» y copia virtual.
- **Impresión y envío:** imprimir y/o enviar al servidor, con carpeta de destino, ruta local de respaldo, reintento automático, confirmación y nombres AAAA_MM_DD_Nº.
- **Carnet:** pantalla de lotes nueva (8 de 35x45, y 4 de 35x45 + 1 de 7x10) con vista previa, guías y marco, copias, «Añadir otro lote» y confirmación.
- **Pruebas:** motor, envío con fallo y reintento, y recorrido de la interfaz a 1920x1080: todo correcto.
- **Revisión de seguridad y normativa:** entregada al cliente.

### 17/11/2026 19:17 – 19:55 · Sesión cerrada (guardado automático, 39 min)
- Archivos modificados:
  - `kiosk/main/config.js`
  - `kiosk/renderer/src/App.jsx`
  - `kiosk/renderer/src/components/LotPreview.jsx`
  - `kiosk/renderer/src/screens/Admin.jsx`
  - `kiosk/renderer/src/screens/Checkout.jsx`
  - `kiosk/renderer/src/screens/Home.jsx`
  - `kiosk/renderer/src/screens/IdLots.jsx`
  - `kiosk/renderer/src/screens/Studio.jsx`
  - `kiosk/renderer/src/styles.css`
  - `kiosk/shared/presets.js`
- **Petición posterior:**
  - La foto se puede reducir sin activar nada: pasa sola a márgenes blancos y vuelve a recorte al ampliar.
  - La zona recortada se ve mejor.
  - Probado a 1920x1080 con el deslizador y la rueda: correcto.
- **Peticiones posteriores:**
  - Lotes 5,1x5,1: 4 fotos, y 4 + 1 de 5x7 con el mismo encuadre.
  - Exportar y cargar plantillas de carnet.
  - Marco de color en las miniaturas con copias.
  - Filtros más grandes y aprovechando el espacio.
  - Probado: render, validación y recorrido a 1920x1080, todo correcto.
- **Peticiones posteriores:**
  - DNP DS620 simulada: probada con un pedido de 4 copias (10x15, 13x18 y Polaroid). Salen los 4 JPEG y el registro.
  - Miniaturas con el nombre y los puntos de color debajo, y marco claro en la foto en vista previa.
  - Barra inferior de 180 px.
- **Peticiones posteriores:**
  - Salida por tamaño (imprimir, servidor o ambos), probada con un pedido de 10x15 (impreso en la DS620 simulada) y 13x18 (enviado al servidor de pruebas y confirmado).
  - Exportar e importar tamaños.
  - Menús Tamaños e Impresoras separados.
- **Peticiones posteriores:**
  - Fotos guardadas 30 días salvo petición del cliente.
  - 0 copias en la selección múltiple.
  - Lateral de miniaturas por tamaño en el resumen.
  - PIN de caja de 3 cifras.
  - Ticket de caja enviado al servidor para Gestión Pizarro.
  - **Probado de principio a fin, todo correcto:**
    - 7 fotos ×2: el PIN incorrecto se rechaza y el correcto imprime.
    - Las fotos se borran si el cliente lo pide.
    - Venta confirmada por la API de Gestión: se imprime solo.
    - «Tengo un PIN de caja» desde el inicio.
    - Ticket en PDF con IVA y código de barras.
- **Peticiones posteriores:**
  - PIN grande en el ticket.
  - Nombre y teléfono obligatorios para recoger más tarde.
  - Frases animadas en la pantalla de espera.
  - Mi galería como icono con PIN y solo entradas de red.
  - Probado a 1920x1080, todo correcto.

### 18/11/2026 · Letras y seguridad de los PIN
- **Letras:** se eligen por separado (programa, títulos y mensajes de espera).
- **Inicio:** sin mensajes.
- **PIN:** se borra si es erróneo; con 5 fallos se bloquea 5 minutos o hasta verificar con el móvil (TOTP) o el correo de la empresa.
- **Probado, todo correcto:**
  - Vector TOTP del RFC.
  - Bloqueo y desbloqueo con el móvil y con el correo (servidor SMTP de prueba).
  - PIN de caja.
  - Letras guardadas y aplicadas.
- **Ajustes → Estadísticas:**
  - Sesiones, vista diaria y mensual, consumos de impresora (rollos estimados DS620), horas de más afluencia con mapa día × hora, y exportación CSV.
  - Probado con sesiones reales del kiosco y un mes de datos de ejemplo, a 1920x1080: todo correcto.

### 18/11/2026 · Tarifas, ayuda, copia de seguridad y estadísticas
- **Tarifas:** lista y editor (precio, tramos, impresora, salida y carpeta del servidor por tamaño).
- **Ajustes:** Ayuda, Exportar e Importar en todas las páginas.
- **Copia de seguridad:** programada, completa o incremental, 15 días, restauración, configuración completa y ajustes de fábrica.
- **Estadísticas:** copias por tamaño y por impresora, y más datos.
- **Inicio:** texto de privacidad nuevo.
- **Probado, todo correcto:**
  - Completa e incremental, restauración por partes y conservación de 15 días.
  - Secciones con y sin secretos.
  - Carpeta del servidor por tamaño (servidor de pruebas).
  - Las 14 páginas con ayuda, exportar e importar.
  - Editor de tarifas guardado.
  - Tabla de estadísticas.
- **Subido a GitHub.**
- **Lotes de carnet:**
  - Separados por papel (10x15 y 15x20), con tamaños de otros países (3x4, 4x4, 33x48, 5x7 y 26x32).
  - Impresora por papel o por lote.
  - Fuera la pestaña «Formatos carnet».
  - Probado: lote 15x20 impreso en la impresora de su papel; sin países en la pantalla del cliente.
