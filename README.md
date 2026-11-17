# Kiosco Digital Pizarro

Dos programas:

| Carpeta | Qué es | Dónde se instala |
|---|---|---|
| `kiosk/` | App táctil (Electron) para el cliente | El PC con pantalla táctil de la tienda |
| `server/` | Servidor de pedidos y galerías privadas | Un PC o NAS siempre encendido en la red de la tienda |

## Puesta en marcha

### 1. Servidor
```bash
cd server
npm install
npm start
```
La primera vez crea `server/data/CREDENCIALES-INICIALES.txt` con la contraseña de administración y la **clave del kiosco**. Guárdalas y borra el archivo.

- Administración: `http://IP-DEL-SERVIDOR:4000/admin` (pedidos, galerías y ajustes)
- Galerías de clientes: `http://IP-DEL-SERVIDOR:4000/g`
- Cambiar la contraseña: `npm run set-password -- NUEVA`

### 2. Kiosco
```bash
cd kiosk
npm install
npm start
```
Para entrar en la administración del kiosco, toca 5 veces el logotipo de la pantalla de inicio. El PIN inicial es `1234` y conviene cambiarlo enseguida. Allí se configura:

1. **Laboratorio y galerías**: la dirección del servidor y la clave del kiosco.
2. **Tamaños e impresoras**: precios y una o varias impresoras por tamaño (los trabajos se reparten entre ellas). Con «Prueba» se imprime una hoja de prueba.
3. **Fuentes**: la red WiFi (para el QR de conexión), las carpetas de red, la carpeta de Bluetooth y el correo IMAP.
4. **Máscaras**: PNG con transparencia y la máscara del evento activo.
5. **General**: el modo kiosco a pantalla completa.

Para generar el instalador de Windows: `npm run dist`.

## Funciones
- **Fuentes de fotos**: USB/SD (detección automática), móvil por WiFi con QR (sin app), móvil por cable (Android/iPhone), Bluetooth, correo con código de sesión, carpetas de red y galería privada. Los HEIC de iPhone se convierten solos.
- **Copias**: tamaño y copias por foto, rellenar o foto completa, encuadre táctil, girar el marco y duplicar en otro tamaño.
- **Fotos carnet**: España, UE, Reino Unido, EEUU, Canadá, México, China, India y medida personalizada. Guías de cara, lotes de varias personas, hojas de 10x15, 13x18 o A4, y guías de corte (marcas o líneas).
- **Destino**: impresión inmediata o envío al laboratorio (servidor o carpeta caliente del minilab).
- **Privacidad**: las fotos del cliente se borran del kiosco al terminar o tras un tiempo sin uso.

## Novedades
- **Carpeta del servidor:** todo lo que dejes en `server/data/compartida` (o en la carpeta que indiques en el panel web → Ajustes) se ve en los kioscos sin contraseña. Puedes compartirla en la red de Windows.
- **Formatos admitidos:** JPEG, PNG, WEBP, HEIC y HEIF. Los vídeos y otros archivos se avisan uno por uno y la carga continúa.
- **Zona de selección:** foto grande arriba y miniaturas abajo. En el panel lateral se elige el tamaño (con aviso de calidad y tamaño recomendado), las copias, el encuadre (recortar, o ampliar con márgenes del color elegido), los filtros, el color y el marco.
- **Pedidos:** se pueden guardar para después (con un código), repetir (todo o parte), reprocesar y reintentar. Se gestionan en ⚙️ → Pedidos y se conservan 30 días.
- **Tarifas:** tramos por cantidad e importación y exportación en CSV (se abre con Excel).
- **Tipos de lotes** de fotos carnet. Todas las fotos se entregan con perfil sRGB.

## Notas
- La primera vez Windows pedirá permiso en el firewall para el puerto 8787 (subida por WiFi) y el 4000 (servidor). Acepta «Redes privadas».
- Bluetooth: en el asistente «Recibir archivos» de Windows, guarda en la carpeta configurada.
- Para imprimir hojas de carnet en el kiosco, crea un tamaño de copia con las mismas medidas que la hoja y asígnale impresora.
- La contraseña del correo se guarda sin cifrar en la configuración del kiosco: usa un buzón exclusivo para él.
