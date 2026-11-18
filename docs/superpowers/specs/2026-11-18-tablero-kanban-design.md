# Diseño — SaaS de gestión de proyectos (tablero Kanban en tiempo real)

Fecha: 18/11/2026 · Autor: Jesús (con Claude) · Estado: borrador para aprobar

## 1. Para qué y por qué

Es una **actividad de un curso** que además irá al **portafolio** de Jesús. Para la entrega basta con subir el repositorio. El curso no pone condiciones de tecnología ni de formato: solo pide cumplir esta lista:

1. Arquitectura multi-tenant correcta.
2. Tablero Kanban con drag & drop y CRUD completo de tareas.
3. Columnas configurables por el usuario.
4. Sincronización en tiempo real vía WebSockets.
5. Sistema de comentarios y menciones funcionando.
6. Notificaciones in-app y por email correctamente implementadas.
7. Aplicación desplegada con demo funcional.

**Saldrá bien si** quien corrija (o mire el portafolio) puede entrar en la demo publicada, hacer unas cuantas pruebas en pocos minutos y comprobar cada punto de la lista, y si el repositorio muestra código limpio, explicable y probado.

**No es un producto real:** no habrá clientes, no se pondrá en producción y **no se pagará nada** (0 €: solo planes gratuitos).

## 2. Objetivos, lo que queda fuera y lo que sería un fracaso

**Objetivos**
- Cada punto de la lista se puede **ver y comprobar** en la demo (sección 9 «Guion de prueba») y está respaldado por pruebas automáticas.
- El repositorio se entiende sin ayuda: README con enlace a la demo, usuarios de prueba, diagrama de arquitectura e instrucciones para arrancarlo en local.

**Fuera del alcance**
- Pagos, suscripciones y facturación.
- Iniciar sesión con Google u otros proveedores, recuperar contraseña y verificar el correo.
- Aplicación móvil nativa (la web debe poder usarse en móvil, pero sin optimizarla a fondo).
- Adjuntar archivos a las tarjetas, subtareas, informes e historial de actividad.
- Funcionar con varias instancias del servidor a la vez o con mucha carga (se explica cómo se haría, pero no se hace).
- Varios idiomas: la interfaz va solo en español.
- Dominio propio y garantizar que los correos no lleguen a spam.

**Sería un fracaso aunque «funcione»**
- Que el tiempo real sea en realidad una consulta periódica al servidor (*polling*) y no WebSockets.
- Que se pueda leer o modificar algo de otra organización, por cualquier camino: API, WebSocket o menciones.
- Que quien corrija no sepa cómo probarlo, o que la demo esté rota o vacía.
- Que alguna pieza exija pagar, o que haya claves o secretos dentro del repositorio.
- Que un correo se pierda en silencio: el envío no se hace dentro de la petición, sino en una cola con reintentos.

## 3. Restricciones

- **Tecnología** (decisión de Jesús): TypeScript en todo el proyecto, con React en el navegador y Node en el servidor.
- **Coste 0 €:** el servidor va en el plan gratuito de Render, que se duerme tras ~15 min sin visitas y tarda ~1 min en despertar (hay que avisarlo en el README). La base de datos va en el plan gratuito de Neon (PostgreSQL, ~512 MB, permanente). Antes de publicar hay que comprobar los límites en las páginas oficiales.
- **Plazo: 1 mes** (entrega hacia el 18/12/2026). El orden de trabajo y lo que se puede recortar está en la sección 10.
- **Correo (decisión de Jesús, opción «b»):** todos los correos van siempre a un **buzón dentro de la app** y, además, a quien se registre con su email real le llegan **correos de verdad** por el plan gratuito de Brevo (300 al día, remitente verificado, sin dominio propio). Hay límites para que la demo no sirva para enviar spam (sección 6.6). Jesús creará la cuenta gratuita de Brevo.
- **Duración:** la demo tiene que seguir funcionando después de la corrección, porque va al portafolio.
- **Datos de quien corrija:** las cuentas que se registren deben poder borrarse al reiniciar la demo. No se guarda nada más que el email, el nombre y la contraseña cifrada.

## 4. Enfoques considerados

| | Enfoque | Ventajas | Inconvenientes |
|---|---|---|---|
| **A (elegido)** | React + API propia en Node (Fastify + Socket.IO) + PostgreSQL con *Row-Level Security*, en un solo repositorio y publicado como un único servicio | Todo el código es propio y explicable; cada punto de la lista se ve en el código; un solo servicio que publicar | Es el que más trabajo lleva |
| B | Next.js para todo + servidor de WebSockets aparte | Next.js es muy demandado | Los hostings habituales de Next.js no mantienen WebSockets abiertos: obliga a tener dos servidores y a compartir la sesión entre ellos, más complejo sin ganar nada para esta lista |
| C | Supabase (base de datos, usuarios y tiempo real ya hechos) | Es el más rápido | El tiempo real, el aislamiento y los usuarios los pone Supabase: parece que se saltan justo los puntos que se evalúan |

También se descartó **una base de datos o un esquema por organización**: complica las migraciones y la publicación y, para una demo, no aporta nada frente a una base compartida con RLS.

**Jesús eligió la A.**

## 5. Qué puede hacer cada persona (aprobado por Jesús)

- **Organizaciones y usuarios:** registrarse (email, nombre, contraseña) crea la cuenta y una organización nueva de la que eres *administrador*. Una persona puede pertenecer a varias organizaciones y cambiar de una a otra desde la cabecera. Hay dos papeles:
  - *Administrador*: invita y quita miembros, cambia papeles, crea, renombra y borra proyectos, y además puede hacer todo lo de un miembro.
  - *Miembro*: trabaja en todos los tableros de su organización (tarjetas, columnas, comentarios).
- **Invitaciones:** el administrador escribe un email y se genera un enlace (caduca a los 7 días) que se envía por correo (sección 6.6) y también se muestra para copiarlo. Al abrirlo, si no tienes cuenta te registras y entras directamente en esa organización. *(Decisión de Claude)* Para aceptarla, la cuenta tiene que tener **el mismo email** al que se envió la invitación.
- **Proyectos y tableros:** cada organización tiene varios proyectos y cada proyecto, un tablero. Un proyecto nuevo empieza con las columnas «Por hacer», «En curso» y «Hecho».
- **Columnas configurables:** crear, renombrar, reordenar arrastrando y borrar. Si la columna tiene tarjetas, se pregunta a qué columna moverlas. Siempre queda al menos una columna.
- **Tarjetas (CRUD completo):** título (obligatorio), descripción (texto plano con saltos de línea), persona asignada (un miembro de la organización), fecha límite y etiquetas de color (por proyecto, con nombre y color). Se crean desde «+ tarjeta» de cada columna, se editan en una ventana de detalle, se mueven arrastrando entre columnas y dentro de una misma columna, y se borran pidiendo confirmación.
- **Tiempo real:** quien tenga abierto el mismo tablero ve al instante todo lo que se crea, edita, mueve o borra (tarjetas, columnas, etiquetas) y los comentarios nuevos de la tarjeta que tenga abierta. La campana de notificaciones también se actualiza al momento.
- **Comentarios y menciones:** en el detalle de la tarjeta. Al escribir `@` aparece la lista de miembros de la organización y se puede filtrar. Cada uno puede editar y borrar sus propios comentarios.
- **Notificaciones:** campana con contador de no leídas y lista de avisos de tres tipos: *te han mencionado*, *te han asignado una tarjeta* y *han comentado en una tarjeta tuya* (creada por ti o asignada a ti). Al pulsar un aviso se abre la tarjeta y queda leído; también hay «marcar todas como leídas». Nadie recibe avisos de lo que hace él mismo. Los mismos avisos llegan por correo, y en el perfil hay un ajuste para desactivar el correo.
- **Demo:** botones «Entrar como Ana» o «Entrar como Luis» (y más) sin contraseña, con datos de ejemplo y una segunda organización para comprobar el aislamiento. Todos los visitantes comparten los mismos datos de demo. *(Decisión de Claude)* Para que nadie la deje vacía, los usuarios de demo **no pueden borrar proyectos, quitar miembros ni cambiar papeles**; tarjetas, columnas, etiquetas y comentarios sí, porque es lo que hay que probar. Se reinicia cada día (sección 8).

```
[Proyecto Web ▾]                         🔔 3   Ana ▾
┌ Por hacer ─┐ ┌ En curso ──┐ ┌ Hecho ────┐ [+ columna]
│ Diseñar logo│ │ API login  │ │ Maquetar  │
│ 🏷 diseño 👤L│ │ 📅 20 nov  │ │           │
│ + tarjeta   │ │ + tarjeta  │ │ + tarjeta │
```

## 6. Cómo se construye

En esta sección, todo lo que no viene de Jesús es **decisión de Claude**, y quien construya puede cambiarlo si lo justifica.

### 6.1 Estructura del repositorio

Monorepo con *pnpm workspaces*:

- `apps/web`: React + Vite + TypeScript, Tailwind CSS para los estilos, TanStack Query para los datos del servidor, dnd-kit para arrastrar y soltar, React Router para la navegación y el cliente de Socket.IO.
- `apps/api`: Node + Fastify + Socket.IO, Drizzle ORM con migraciones, `pg-boss` como cola sobre PostgreSQL y `argon2` para las contraseñas.
- `packages/shared`: esquemas Zod (validación en el navegador y en el servidor), tipos de los eventos de tiempo real y constantes.

En producción, **la API sirve también la web ya compilada** (mismo origen): así hay un solo servicio en Render, sin CORS, y la cookie de sesión vale tanto para la API como para el WebSocket.

En local, `docker compose` levanta PostgreSQL (y opcionalmente Mailpit), y `pnpm dev` arranca la web y la API.

Los nombres en el código y la base de datos van en inglés; la interfaz y el README, en español.

### 6.2 Multi-tenant

- Hay **una base de datos compartida**. Todas las tablas con datos de una organización llevan `organization_id` (también las que ya cuelgan de otra con organización, como `cards` y `comments`), así cada política es simple y no necesita *joins*.
- **Primera barrera, la aplicación:** cada petición lleva la organización activa en la ruta (`/api/orgs/:orgId/...`). Un *middleware* comprueba que el usuario es miembro de esa organización y con qué papel. Todo identificador que llegue en el cuerpo (columna, persona asignada, persona mencionada, etiqueta) se comprueba contra esa organización.
- **Segunda barrera, la base de datos:** con *Row-Level Security* activada y forzada (`FORCE ROW LEVEL SECURITY`), la API se conecta con un rol que **no es dueño de las tablas**. Cada petición abre una transacción y hace `SET LOCAL app.org_id = …`, y las políticas filtran por `organization_id = current_setting('app.org_id')::uuid`. Si el código olvidara filtrar, la base de datos tampoco devolvería datos de otra organización.
- Lo que no pertenece a una organización (`users`, `sessions`, la búsqueda de membresías al iniciar sesión, las invitaciones al aceptarlas) va por consultas concretas con su propia política o un rol de sistema documentado. Quien construya decide el mecanismo exacto, pero tiene que quedar explicado en el README.
- **Hay que demostrarlo con pruebas automáticas** (sección 7): un usuario de la organización A intenta leer, crear, editar, mover, borrar, mencionar, asignar y unirse a la sala de tiempo real de recursos de B, y en todos los casos recibe 403 o 404 y no ve ningún dato. Además hay una prueba directa a la base de datos con `app.org_id` de A que no ve filas de B.

### 6.3 Modelo de datos (orientativo)

`users`, `sessions`, `organizations`, `memberships(role)`, `invitations(token_hash, expires_at)`, `projects`, `columns(position)`, `cards(column_id, position, title, description, assignee_id, due_date, created_by)`, `labels`, `card_labels`, `comments(body, author_id)`, `mentions(comment_id, user_id)`, `notifications(user_id, type, card_id, comment_id, read_at)`, `user_settings(email_notifications)`, `mailbox(to_email, subject, html, text, sent_at, real_delivery_status)` (por **dirección de email**, no por usuario, para que una invitación a alguien sin cuenta aparezca en su buzón cuando se registre con esa dirección), `email_quota` (contadores diarios), más las tablas de `pg-boss`.

**Orden de tarjetas y columnas:** se usa índice fraccionario (`position` de tipo texto, librería `fractional-indexing`). Mover una tarjeta cambia solo esa fila. Si dos movimientos dejan la misma posición, se desempata por `id`.

### 6.4 Tiempo real

- Socket.IO comparte el servidor HTTP de Fastify. Al conectarse, el *handshake* lee la cookie de sesión y, si no hay sesión válida, rechaza la conexión.
- **Salas:** `board:<projectId>` (para unirse se comprueba la membresía en la organización del proyecto) y `user:<userId>` (para las notificaciones personales).
- **Flujo de un cambio:** el navegador llama a la API REST (no se escribe a través del socket). La API guarda en una transacción y, **después del commit**, emite el evento a la sala con la entidad completa ya actualizada (`card.created`, `card.updated`, `card.moved`, `card.deleted`, `column.*`, `label.*`, `comment.*`). Cada petición lleva un `clientMutationId` para que el navegador que hizo el cambio no lo aplique dos veces.
- **En el navegador:** el cambio se aplica al momento (actualización optimista) y, si la API falla, se deshace y se muestra un aviso. Los eventos que llegan actualizan la caché de TanStack Query.
- **Conflictos:** gana el último que escribe. Como el servidor siempre emite el estado final, todos terminan viendo lo mismo.
- **Reconexión:** al volver a conectar, el navegador recarga el tablero entero, para que nadie se quede con una versión vieja tras un corte o tras despertar el servidor.
- Funciona con **una sola instancia**. En el README se explica que, para varias, bastaría el adaptador de Socket.IO para PostgreSQL o Redis (no se implementa).

### 6.5 Comentarios y menciones

- El comentario se guarda como texto con las menciones codificadas, por ejemplo `@[Ana López](user:<uuid>)`, y se muestra con la mención resaltada.
- El servidor extrae las menciones, **descarta las de personas que no son de la organización**, guarda las filas `mentions` y crea las notificaciones en la misma transacción que el comentario.
- Al editar un comentario, solo se avisa a las menciones nuevas.
- El texto se muestra siempre escapado: no se interpreta como HTML ni como Markdown, para evitar XSS.

### 6.6 Notificaciones y correo

- **Dentro de la app:** al crear una notificación, en la misma transacción se encola un trabajo de correo si ese usuario lo tiene activado. Después del commit se emite `notification.created` a la sala `user:<id>`. La API ofrece listar (paginado), contar las no leídas, marcar una como leída y marcarlas todas.
- **Correo:** un *worker* de `pg-boss`, que corre en el mismo proceso que la API (para no tener un segundo servicio), toma los trabajos y genera la plantilla (HTML y texto). Cada correo:
  1. **siempre** se guarda en `mailbox`. Cada usuario ve **solo los dirigidos a su email** en «Mi buzón», en el menú de usuario. Así se comprueba incluso con los usuarios de demo, que no tienen buzón real;
  2. **además**, si el destinatario no es un usuario de demo, se envía de verdad mediante un **adaptador con interfaz común**:
     - `brevo` (demo publicada): SMTP de Brevo con Nodemailer y el remitente verificado de Jesús;
     - `smtp` (desarrollo local): Mailpit;
     - `none`: solo el buzón (pruebas automáticas, y la demo si faltan las claves de Brevo).
- **Límites del envío real** *(decisión de Claude)*: como el email no se verifica, cualquiera podría registrarse con la dirección de otra persona. Por eso hay como máximo **10 correos reales al día por dirección de destino**, **10 invitaciones al día por usuario** y **250 al día en total** (por debajo de los 300 de Brevo). Si se supera algún límite, el correo queda solo en el buzón, con estado «no enviado: límite diario». Todo correo real lleva al pie «Recibes esto porque te registraste o te invitaron en la demo de …» y un enlace para no recibir más (desactiva el ajuste de correo, o bloquea esa dirección si no tiene cuenta).
- Reintentos con espera creciente (3 intentos). Si al final falla, el trabajo queda como fallido, se registra en el log y el estado se ve en el buzón.
- Los correos de invitación usan el mismo mecanismo.

### 6.7 Sesión y seguridad

- Email y contraseña cifrada con argon2id. La sesión se guarda en la base de datos y viaja en una cookie `httpOnly`, `Secure` (en producción) y `SameSite=Lax`. En las peticiones que cambian datos se comprueba que la cabecera `Origin` sea la propia.
- Límite de intentos en el inicio de sesión y el registro (`@fastify/rate-limit`) y cabeceras de seguridad (`@fastify/helmet`).
- Todo lo que entra se valida con los esquemas Zod de `shared`.
- Los secretos solo van en variables de entorno, y hay un `.env.example` en el repositorio.

## 7. Pruebas

- **Unitarias (Vitest):** extracción de menciones, cálculo de posiciones, a quién va cada notificación y permisos por papel.
- **Integración de la API (Vitest + PostgreSQL real):** el servicio de PostgreSQL de GitHub Actions, o Testcontainers en local. Cubren el CRUD de tarjetas y columnas, los comentarios y menciones, las notificaciones y la cola de correo (que acaba en el buzón), y la **batería de aislamiento entre organizaciones** de la sección 6.2.
- **De extremo a extremo (Playwright)** con dos navegadores a la vez:
  1. Ana mueve una tarjeta y Luis la ve moverse sin recargar.
  2. Ana menciona a Luis en un comentario: a Luis le sube el contador de la campana y en su buzón aparece el correo.
  3. Ana crea, renombra, reordena y borra una columna, y Luis lo ve.
- **GitHub Actions:** tipos, lint, pruebas unitarias, de integración y de extremo a extremo en cada *push*. El estado se muestra con una insignia en el README.

## 8. Publicación y demo

- **Render (plan gratuito):** un servicio web definido en `render.yaml`. Al compilar se ejecutan la build y las migraciones. Las variables de entorno (`DATABASE_URL`, `SESSION_SECRET`, `MAIL_TRANSPORT`, `DEMO_MODE=true`, `DEMO_RESET_TOKEN`) van en el panel de Render.
- **Neon (plan gratuito):** PostgreSQL. Se usan **dos roles**: el dueño, para las migraciones, y el de la aplicación, sin ser dueño, para que la RLS se aplique.
- **Datos de demo** (*seed*):
  - «Estudio Acme»: Ana (administradora), Luis y Marta (miembros), dos proyectos con columnas, etiquetas, tarjetas, comentarios con menciones y algunas notificaciones.
  - «Otra Empresa»: Pablo, con su propio proyecto.
  - Con `DEMO_MODE` activo, la pantalla de entrada muestra los botones «Entrar como …» (sin contraseña, solo para los usuarios de demo).
- **Reinicio diario** *(decisión de Claude)*: lo hace el propio servidor, no un programador externo, porque GitHub desactiva los *workflows* programados tras 60 días sin actividad y la demo tiene que durar para el portafolio. Al arrancar (por ejemplo, al despertar) y cada hora mientras está despierto, si el último reinicio fue hace más de 24 h, borra **todo** (también las cuentas registradas por visitantes y su buzón) y vuelve a cargar el *seed*. Además, `POST /internal/demo/reset` con `DEMO_RESET_TOKEN` permite reiniciar a mano. Un aviso en la pantalla de entrada lo explica. Los navegadores conectados reciben un evento y recargan.
- **Claves de Brevo:** `BREVO_SMTP_USER`, `BREVO_SMTP_KEY` y `MAIL_FROM` en Render, con `MAIL_TRANSPORT=brevo`.
- **README:** enlace a la demo con el aviso del arranque lento (~1 min), usuarios de demo, el «guion de prueba» (abajo), diagrama de arquitectura en Mermaid, cómo funciona el aislamiento, cómo arrancarlo en local, decisiones tomadas y qué se haría para pasarlo a producción.

## 9. Guion de prueba (va en el README; cada paso cubre un punto de la lista)

1. Abre la demo en dos ventanas: en una «Entrar como Ana» y en la otra (incógnito) «Entrar como Luis». Mueve una tarjeta en la de Ana y mira cómo se mueve en la de Luis. → 2 y 4
2. Crea, edita y borra una tarjeta. Añade una columna, renómbrala y reordénala. → 2 y 3
3. Como Ana, comenta en una tarjeta mencionando a `@Luis`. Luis ve subir la campana, abre el aviso y ve el correo en «Mi buzón». → 5 y 6
4. Entra como Pablo («Otra Empresa»): no ves nada de Estudio Acme. Si pruebas a abrir la dirección de un tablero de Acme, recibes un error. → 1
5. (Opcional) Regístrate con tu email real, crea tu organización e invita a otra dirección tuya. El enlace aparece en pantalla y te llega por correo de verdad. Regístrate con esa segunda dirección, acepta y menciónala: también recibe el aviso por correo. → 1 y 6

## 10. Orden de trabajo y qué recortar si falta tiempo (plazo: 1 mes)

1. Base: monorepo, base de datos con RLS, sesión, organizaciones y la batería de aislamiento.
2. Tablero: proyectos, columnas configurables, tarjetas con CRUD y arrastrar y soltar.
3. Tiempo real.
4. Comentarios, menciones y notificaciones en la app.
5. Correo: cola, buzón, Brevo y límites.
6. Publicación en Render y Neon, *seed*, botones de demo y reinicio diario. Conviene publicar pronto (tras el paso 3) para descubrir los problemas del hosting a tiempo.
7. README, diagrama, guion de prueba y pruebas de extremo a extremo.

Si falta tiempo, se recorta en este orden (lo primero es lo que antes se quita): cambiar entre varias organizaciones (una por usuario), editar y borrar comentarios, gestión de etiquetas, fecha límite. Nunca se recorta nada de los siete puntos de la lista ni la batería de aislamiento.

## 11. Lo que se deja a quien construya

- El aspecto visual concreto (sobrio, al estilo de Trello o Linear, con Tailwind), los textos de la interfaz y el diseño de los correos.
- Las versiones exactas de las librerías (estables a fecha de construcción), la configuración de lint y formato y la estructura interna de carpetas.
- El mecanismo exacto para las consultas fuera de una organización con RLS (sección 6.2), siempre que quede documentado.
- La paginación, los tamaños máximos de los textos y otros detalles menores de validación.
- Si las etiquetas se gestionan desde el tablero o desde los ajustes del proyecto.
