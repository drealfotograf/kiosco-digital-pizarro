# Conexión con Gestión Pizarro: tickets de caja

El kiosco crea un **ticket** por cada pedido confirmado. El cliente lo lleva a caja y lo paga allí.
El servidor de la tienda guarda el ticket como **pendiente**, y un ticket pendiente **no cuenta en contabilidad**.

Gestión Pizarro confirma una de dos cosas:

- **Venta realizada** → el ticket pasa a `pagado`. Si el pedido necesitaba el PIN de caja, el kiosco lo imprime solo.
- **Venta anulada** → el ticket pasa a `anulado` y el pedido no se imprime.

Mientras Gestión no esté conectado, el personal puede hacer lo mismo desde la web del servidor, en la pestaña **Caja**.

> **Pendiente:** unificar el formato de las líneas y los códigos de artículo con las tarifas de Gestión Pizarro.
> El cliente indicará dónde están. Cada tamaño y cada lote de carnet tiene ya un campo **«Código»** en la Administración del kiosco.

## Autenticación

En cada petición se envía la cabecera:

```
x-gestion-key: <clave>
```

La clave aparece en la web del servidor, en **Ajustes → Clave para Gestión Pizarro**, y desde allí se puede regenerar.

## Ticket

```json
{
  "numero": "K261117-0001",
  "corto": "0001",
  "fecha": "2026-11-17T19:30:00.000Z",
  "tienda": "Pizarro",
  "kiosco": "Kiosco",
  "cliente": { "name": "Ana", "phone": "600000000" },
  "lineas": [
    { "codigo": "FOTO-10x15", "descripcion": "10 x 15 cm", "cantidad": 12, "precio": 0.35, "importe": 4.2 }
  ],
  "total": 4.2,
  "moneda": "EUR",
  "iva": { "porcentaje": 21, "base": 3.47, "cuota": 0.73 },
  "requierePin": true,
  "pin": "482",
  "estado": "pendiente",
  "recibido": "2026-11-17T19:30:01.000Z",
  "confirmadoEn": null,
  "confirmadoPor": null,
  "referencia": null
}
```

- Los precios llevan el **IVA incluido**: `base + cuota = total`.
- El **código de barras** del ticket impreso (Code 128) contiene el `numero`.
- `pin` solo existe si el pedido necesita el PIN de caja para imprimirse.
- `estado` puede ser `pendiente`, `pagado` o `anulado`.

## Peticiones

| Método | Ruta | Para qué |
|---|---|---|
| `GET` | `/api/gestion/tickets?estado=pendiente` | Lista de tickets. El filtro `estado` es opcional. |
| `GET` | `/api/gestion/tickets/<numero>` | Un ticket (por ejemplo, al leer el código de barras). |
| `POST` | `/api/gestion/tickets/<numero>` | Confirmar o anular la venta. |

Cuerpo de `POST /api/gestion/tickets/<numero>`:

```json
{ "venta": true, "referencia": "FS-2026-000123" }
```

- `"venta": true` → `pagado`.
- `"venta": false` → `anulado`.
- `referencia` es opcional: por ejemplo, el número de factura simplificada en Gestión.

Si el ticket ya no está pendiente, la respuesta es `409`.

## Contabilidad

Solo entran los tickets con `estado = pagado`. Para el cierre del día, por ejemplo:

```
GET /api/gestion/tickets?estado=pagado
```

Después se filtra por `confirmadoEn`.
