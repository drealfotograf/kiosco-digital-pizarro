# Instrucciones del proyecto · Kiosco Digital Pizarro

1. **Al iniciar la sesión, lee `PROYECTO.md` antes de cualquier otra cosa.** Es el archivo de creación y avance del proyecto.
   El hook SessionStart lo inyecta automáticamente. Si no aparece en el contexto, léelo con la herramienta Read.
2. **Mantén `PROYECTO.md` al día.** Al terminar cada tarea, actualiza «Estado actual», «Decisiones tomadas» y «Próximos pasos»,
   y añade un resumen de lo hecho en la entrada de hoy de «Registro de sesiones».
3. Al cerrar la sesión, el hook SessionEnd añade automáticamente al registro la fecha, la duración y los archivos modificados.
4. Idioma: español. La interfaz es táctil y no depende del teclado físico. Botones de 60 px como norma general; en la zona de selección
   (`Studio`), a petición del cliente, las opciones son compactas (mínimo 36–46 px) para que todo quepa a la vista.
   **Pantalla de referencia: monitor de 22" a 1920x1080.** Comprobar ahí que el panel de opciones no necesita desplazamiento.
5. Después de cambiar la interfaz, ejecuta `npx vite build` en `kiosk/` para comprobar que compila.
