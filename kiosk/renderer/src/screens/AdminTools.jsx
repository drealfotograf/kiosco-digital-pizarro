import React, { useState } from 'react';
import { api } from '../api.js';
import { Icon } from '../components/ui.jsx';

/** Ayuda de cada página de Ajustes. */
export const HELP = {
  orders: ['Pedidos guardados por estado: pendientes de pago (con su PIN), sin terminar, enviados, impresos, con error y anulados.',
    'Abre uno para verlo, eliminarlo, repetirlo (todo o parte), reprocesarlo con otros ajustes o, si está pendiente de pago, liberarlo cuando lo hayas cobrado.',
    'Exportar copia todas las carpetas de pedidos a otra carpeta. Importar añade los pedidos de una carpeta exportada que no existan ya (no borra nada).'],
  stats: ['Estadísticas anónimas del kiosco: sesiones, pedidos, copias por tamaño y por impresora, importes, consumos y horas de más afluencia.',
    'Cambia entre vista diaria y mensual y usa las flechas para ir a otro día o mes. «Exportar CSV» abre el periodo en Excel.',
    'Exportar e importar copian o añaden el registro completo de estadísticas (por ejemplo, para juntar los de dos kioscos).'],
  general: ['Datos de la tienda y del aviso legal, cuántos días se guardan pedidos y fotos, y si las fotos se guardan por defecto.',
    'Seguridad de los PIN: tras 5 errores se bloquea 5 minutos; se desbloquea antes con el móvil de la empresa (app de autenticación) o con un código al correo.'],
  fonts: ['Letras del programa (texto general y títulos) y, aparte, las de los mensajes de la pantalla de espera, con cursiva, mayúsculas o fina.'],
  print: ['Qué se hace al confirmar un pedido: imprimir en el kiosco y/o enviar al servidor, carpeta de destino por defecto y ruta local si el servidor no responde.',
    'Ticket de caja (impresora de tickets, IVA, cabecera y pie), PIN de caja (para todo o solo para algunas cosas) e impresora simulada DNP DS620 para pruebas.'],
  sizes: ['Medidas, color en la zona de selección, código de artículo de Gestión y qué se hace con cada tamaño al confirmar el pedido.',
    'Las impresoras se asignan en «Impresoras» o en el editor de «Tarifas».'],
  printers: ['Impresoras que encuentra Windows y qué tamaños imprime cada una. Si un tamaño tiene varias, los trabajos se reparten entre ellas.',
    '«Papel del driver» usa el tamaño configurado en la impresora en lugar del de la copia. «Prueba» imprime una hoja de prueba.'],
  tariffs: ['Lista de tamaños con su precio. Pulsa «Editar» para cambiar el tamaño, el precio por unidad, los precios por cantidad (tramos), la impresora y si se imprime o se envía al servidor.',
    'Si se envía al servidor, se usa la carpeta por defecto (Impresión y envío) hasta que elijas otra para ese tamaño.',
    'Las tarifas también se pueden exportar e importar en CSV para editarlas en Excel.'],
  lots: ['Lotes de fotos de carnet agrupados por papel (10x15 y 15x20): activa los que se ofrecen, cambia nombre, precio y código de Gestión, y decide qué opciones puede tocar el cliente (guías de corte, marco, guías de cara).',
    'Impresora: puedes elegir una para todos los lotes de un papel y, si quieres, otra distinta para un lote concreto. Si no eliges ninguna, se usa la del tamaño de copia (10x15 o 15x20) de «Impresoras».',
    'Las plantillas se pueden exportar y cargar para copiarlas a otro kiosco.'],
  sources: ['Entradas de fotos del cliente: WiFi del kiosco (QR), carpetas compartidas de red, correo y Bluetooth.',
    '«Mi galería» es solo para el personal: se abre con el icono del inicio y el PIN, y solo deja usar las entradas de red que marques.'],
  lab: ['Conexión con el servidor de la tienda (dirección y clave del kiosco) o con una carpeta compartida del laboratorio. También se usa para las galerías privadas.'],
  masks: ['Marcos y máscaras PNG para eventos. Exportar copia los PNG a una carpeta; importar añade los PNG de una carpeta.'],
  backup: ['Copia de seguridad automática del kiosco: días y horas, qué partes (ajustes, pedidos, estadísticas, máscaras), completa o incremental (solo lo que ha cambiado), carpeta del servidor y 15 días de conservación.',
    'Desde aquí también se exporta e importa toda la configuración del programa para restaurarlo tal como estaba.']
};

/** Barra de cada página de Ajustes: Ayuda, Exportar e Importar. */
export default function AdminTools({ tab, pin, toast, dirty, onImported }) {
  const [open, setOpen] = useState(false);
  const folderKind = ['orders', 'stats', 'masks'].includes(tab);
  const exp = async () => {
    try {
      const r = await api('admin:sectionExport', pin, tab);
      if (r) toast({ type: 'ok', text: folderKind ? `Exportado: ${r.files} archivo(s) en ${r.path}` : `Ajustes exportados a ${r.path}` });
    } catch (e) { toast({ type: 'error', text: e.message }); }
  };
  const imp = async () => {
    try {
      const r = await api('admin:sectionImport', pin, tab);
      if (!r) return;
      await onImported();
      toast({ type: 'ok', text: folderKind ? `Importado: ${r.imported} elemento(s)` : 'Ajustes importados y guardados' });
    } catch (e) { toast({ type: 'error', text: e.message }); }
  };
  return (
    <div className="adm-tools">
      <button className={`btn sm ${open ? 'primary' : ''}`} onClick={() => setOpen(!open)}><span className="help-q">?</span> Ayuda</button>
      <div className="spacer" />
      <button className="btn sm" disabled={dirty} title={dirty ? 'Guarda primero los cambios' : ''} onClick={exp}><Icon name="download" size={16} /> Exportar</button>
      <button className="btn sm" disabled={dirty} title={dirty ? 'Guarda primero los cambios' : ''} onClick={imp}><Icon name="plus" size={16} /> Importar</button>
      {open && (
        <div className="adm-help card">
          {(HELP[tab] || ['Sin ayuda para esta página.']).map((p, i) => <p key={i}>{p}</p>)}
          <p className="muted small">{folderKind ? 'Importar no borra nada: solo añade lo que no existe.' : 'Exportar guarda los ajustes de esta página en un archivo (sin contraseñas). Importar los aplica y los guarda; las contraseñas de este kiosco se conservan.'}</p>
        </div>
      )}
    </div>
  );
}
