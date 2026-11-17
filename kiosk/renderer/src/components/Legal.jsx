import React, { useState } from 'react';
import { Modal, Icon } from './ui.jsx';

/**
 * Información de protección de datos (RGPD UE 2016/679 y LOPDGDD 3/2018) y aviso legal (LSSI-CE 34/2002).
 * Primera capa: una línea con el enlace. Segunda capa: el texto completo al pulsar.
 * Los datos del responsable se rellenan en Administración → General → Datos legales.
 */
export function LegalLink({ settings }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <p className="legal-line">
        Tus fotos solo se usan para tu pedido y se borran del kiosco al terminar.{' '}
        <button className="link" onClick={() => setOpen(true)}>Protección de datos (RGPD) y aviso legal</button>
      </p>
      {open && <LegalModal settings={settings} onClose={() => setOpen(false)} />}
    </>
  );
}

const or = (v, p) => (v && String(v).trim()) || `[${p}]`;

export function LegalModal({ settings, onClose }) {
  const L = settings.legal || {};
  const days = settings.ordersRetentionDays || 30;
  const [tab, setTab] = useState('privacy');
  return (
    <Modal onClose={onClose}>
      <div className="row"><h2 style={{ margin: 0, flex: 1, fontWeight: 400 }}>Información legal</h2><button className="btn sm" onClick={onClose}><Icon name="close" size={18} /> Cerrar</button></div>
      <div className="seg mini" style={{ maxWidth: 520 }}>
        <button className={tab === 'privacy' ? 'on' : ''} onClick={() => setTab('privacy')}>Protección de datos</button>
        <button className={tab === 'legal' ? 'on' : ''} onClick={() => setTab('legal')}>Aviso legal</button>
      </div>
      <div className="legal-text">
        {tab === 'privacy' ? (
          <>
            <h3>Responsable del tratamiento</h3>
            <p>{or(L.company, 'Nombre o razón social')} · NIF {or(L.nif, 'NIF')} · {or(L.address, 'Dirección')} · {or(L.email, 'Correo de contacto')}{L.phone ? ` · ${L.phone}` : ''}.{L.dpo ? ` Delegado de protección de datos: ${L.dpo}.` : ''}</p>
            <h3>Qué datos tratamos y para qué</h3>
            <ul>
              <li><b>Las fotos que nos traes</b>, para imprimirlas, prepararlas o enviarlas a nuestro laboratorio (ejecución del servicio que pides, art. 6.1.b RGPD).</li>
              <li><b>Tu nombre y teléfono</b>, solo si los indicas, para entregarte el pedido y avisarte de que está listo (art. 6.1.b RGPD).</li>
              <li><b>Las fotos de tu galería privada</b>, para que puedas verlas, elegirlas e imprimirlas con tu código y contraseña.</li>
              <li>No hacemos perfiles, no tomamos decisiones automatizadas ni usamos tus fotos con fines publicitarios.</li>
            </ul>
            <h3>Cuánto tiempo las conservamos</h3>
            <ul>
              <li>Mientras usas el kiosco, tus fotos están en una sesión temporal que <b>se borra al terminar</b>, al cancelar o tras unos minutos sin actividad.</li>
              <li>Las fotos de los pedidos realizados o guardados para después se conservan <b>{days} días</b> para poder repetirlos o corregirlos, y después se borran automáticamente.</li>
              <li>Las galerías privadas se conservan mientras dure el encargo contratado con el estudio.</li>
            </ul>
            <h3>Quién más puede verlas</h3>
            <p>Solo el personal de la tienda y, si pides copias de laboratorio, el laboratorio que las imprime, como encargado del tratamiento con contrato. No hay transferencias fuera del Espacio Económico Europeo.</p>
            <h3>Tus derechos</h3>
            <p>Puedes pedir acceso, rectificación, supresión, oposición, limitación del tratamiento y portabilidad escribiendo a {or(L.email, 'Correo de contacto')} o en la tienda. Si no estás conforme, puedes reclamar ante la Agencia Española de Protección de Datos (www.aepd.es).</p>
            <h3>Menores</h3>
            <p>Los menores de 14 años necesitan el consentimiento de su madre, padre o tutor para usar el kiosco con sus propias fotos (art. 7 LOPDGDD).</p>
            <h3>Tu responsabilidad</h3>
            <p>Solo debes imprimir fotos de las que tengas derechos o permiso de las personas que aparecen. No se admiten contenidos ilícitos.</p>
          </>
        ) : (
          <>
            <h3>Titular</h3>
            <p>{or(L.company, 'Nombre o razón social')}, NIF {or(L.nif, 'NIF')}, con domicilio en {or(L.address, 'Dirección')}. Contacto: {or(L.email, 'Correo de contacto')}{L.phone ? `, ${L.phone}` : ''}.{L.registry ? ` ${L.registry}.` : ''}</p>
            <h3>Objeto</h3>
            <p>Este kiosco permite a los clientes cargar sus fotografías para imprimirlas en la tienda, encargar copias al laboratorio, hacer fotos de carné y acceder a sus galerías privadas.</p>
            <h3>Condiciones de uso</h3>
            <p>Los precios se muestran con impuestos incluidos y se pagan en caja. El pedido se confirma al pulsar «Imprimir» o «Enviar». El cliente es responsable de tener los derechos sobre las imágenes que imprime.</p>
            <h3>Propiedad intelectual</h3>
            <p>El diseño, la marca y el software de este kiosco pertenecen a su titular. Las fotografías siguen siendo de sus autores.</p>
            <h3>Legislación</h3>
            <p>Reglamento (UE) 2016/679 (RGPD), Ley Orgánica 3/2018 (LOPDGDD) y Ley 34/2002 (LSSI-CE). Para cualquier controversia, los juzgados y tribunales que correspondan según la ley de consumidores.</p>
          </>
        )}
      </div>
    </Modal>
  );
}
