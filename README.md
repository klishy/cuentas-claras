# 💸 Cuentas Claras

App web para dividir gastos compartidos entre grupos (arriendo, salidas, viajes, proyectos).
Piensa "Splitwise" pero simple, en español y pensada para venderla directo a estudiantes.

Stack: **FastAPI + SQLite** en el backend, **HTML/CSS/JS puro** en el frontend (sin frameworks,
sin build step — se sirve directo desde el mismo servidor).

---

## 1. Requisitos

- Python 3.10+ (tú tienes 3.13, funciona perfecto)
- Windows, con tu carpeta de proyectos en `OneDrive/Documentos`

---

## 2. Instalación (copiar y pegar en la terminal, PowerShell o CMD)

> ⚠️ **Si ya tenías una versión anterior de esta app corriendo**, borra el archivo
> `cuentas_claras.db` antes de levantar el servidor de nuevo. El modelo de datos cambió
> (se agregaron categorías, división manual e historial de pagos) y la base de datos
> vieja no es compatible. En Windows, dentro de la carpeta del proyecto, ejecuta
> `Remove-Item cuentas_claras.db` (si existe).

Copia la carpeta `cuentas-claras` completa a tu carpeta de proyectos, por ejemplo:
`C:\Users\TU_USUARIO\OneDrive\Documentos\cuentas-claras`

Luego, abre una terminal **dentro de esa carpeta** y ejecuta:

```powershell
# 1. Crear entorno virtual
python -m venv venv

# 2. Activar el entorno virtual
venv\Scripts\activate

# 3. Instalar dependencias
pip install -r requirements.txt

# 4. Levantar el servidor
uvicorn app.main:app --reload
```

Si todo salió bien, verás algo como:
```
INFO:     Uvicorn running on http://127.0.0.1:8000
```

Abre tu navegador en **http://127.0.0.1:8000** y ya puedes usar la app: crear tu cuenta,
crear un grupo, agregar gastos y ver los balances.

> La próxima vez que quieras levantar el servidor, solo necesitas repetir los pasos 2 y 4
> (no hace falta reinstalar nada).

---

## 3. Qué hace la app (MVP actual)

- **Autenticación**: registro/login con contraseña (hasheada con bcrypt) y sesión con JWT
- **Grupos**: crear grupos y agregar integrantes por correo
- **Gastos**: registrar un gasto, con tres formas de dividirlo:
  - **Partes iguales**: se reparte por igual entre los miembros del grupo (con ajuste de
    centavos, para que la suma siempre cuadre exacto)
  - **Proporcional al sueldo**: cada integrante declara su sueldo en el grupo, y el gasto
    se reparte según cuánto gana cada uno. Todos los participantes deben declarar su
    sueldo antes de usar este modo, o la app avisa quién falta.
  - **Montos manuales**: eliges tú mismo cuánto le corresponde pagar a cada persona (útil
    para gastos que no se reparten proporcionalmente, ej. alguien pidió más comida). La
    app valida que los montos sumen exactamente el total del gasto.
- **Categorías de gasto**: cada gasto se clasifica con un ícono (🏠 arriendo, 🛒 supermercado,
  🍔 comida, 🚌 transporte, 💡 servicios, 🎉 salidas, 💊 salud, 📦 otros)
- **Historial de pagos**: cada persona puede marcar su parte de un gasto como pagada; queda
  registrada la fecha exacta en que se saldó
- **Aviso de deudas pendientes**: al entrar a la app, un banner resume cuánto debes o te
  deben en total, sumando todos tus grupos (no son notificaciones push reales — el plan
  gratuito de hosting no soporta eso — pero es un resumen inmediato al abrir la app)
- **Balances**: ve cuánto le debe o le deben a cada persona
- **Simplificación de deudas**: un algoritmo calcula el **número mínimo de transferencias**
  necesarias para saldar todas las cuentas del grupo (en vez de que cada quien le transfiera
  a cada quien, agrupa las deudas de forma óptima)
- **Límites freemium ya incorporados** (para monetizar desde el día 1):
  - Plan gratuito: máximo 2 grupos creados por cuenta, máximo 4 integrantes por grupo
  - Cuentas con `is_premium = true` no tienen límites (por ahora se activa manualmente en
    la base de datos; el paso de pagos real se detalla en la sección 5)

---

## 4. Estructura del proyecto

```
cuentas-claras/
├── requirements.txt
└── app/
    ├── main.py              # arranque de FastAPI, monta rutas y estáticos
    ├── database.py          # conexión a SQLite
    ├── models.py            # tablas: User, Group, Expense, ExpenseSplit
    ├── schemas.py           # validación de datos (Pydantic)
    ├── auth.py              # hashing de contraseñas + JWT
    ├── routers/
    │   ├── auth_router.py       # /auth/register, /auth/login, /auth/me
    │   ├── groups_router.py     # /groups/*
    │   └── expenses_router.py   # /groups/{id}/expenses/*, /groups/{id}/balances/*
    └── static/
        ├── index.html       # toda la interfaz (una sola página)
        ├── css/style.css
        └── js/app.js         # llama a la API y actualiza la pantalla
```

La base de datos (`cuentas_claras.db`) se crea sola la primera vez que corres el servidor,
en la misma carpeta.

---

## 5. Cómo pasar esto a un negocio real (siguientes pasos, en orden)

1. **Validar con gente real primero.** Antes de invertir tiempo en pagos, súbela a un
   hosting gratuito (Render.com tiene plan free para FastAPI) y compártela con 10-15
   compañeros de tu curso o de tu depto. Pide feedback: ¿la usarían de verdad?, ¿qué le
   falta? Esto te ahorra construir cosas que nadie quiere.
2. **Agregar cobro real.** Cuando tengas gente interesada en pagar, integra un botón de
   pago simple: Mercado Pago o Flow (ambos tienen APIs bien documentadas y son estándar
   en Chile). El flujo sería: usuario paga → tu backend marca `is_premium = true` en su
   cuenta vía webhook.
3. **Deploy real:**
   - Backend: Render.com o Railway (planes gratuitos alcanzan para partir)
   - Base de datos: pasar de SQLite a PostgreSQL cuando tengas más de ~50 usuarios activos
     (SQLite no aguanta bien muchos usuarios escribiendo a la vez)
4. **Distribución:** grupos de WhatsApp/Instagram de tu generación en la UNAB, marketplace
   de Facebook de arriendos compartidos, quizás un flyer físico en la universidad.
5. **Precio sugerido para partir:** algo simbólico como $1.990-$2.990 CLP/mes o un pago
   único de $4.990 por cuenta premium — bajo, porque tu público (estudiantes) es sensible
   al precio, y el objetivo inicial es validar que la gente sí paga, no maximizar ingreso.

Cuando quieras, seguimos con cualquiera de estos pasos: te ayudo a montar el deploy en
Render, a integrar Mercado Pago, o a mejorar el frontend con algo más pulido.
