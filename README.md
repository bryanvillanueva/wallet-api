# wallet-api

API base en TypeScript con Express y MySQL.

## Requisitos
- Node.js 18+
- MySQL 8+ (o compatible)

## Configuración
1. Copia el ejemplo de variables de entorno y edítalo según tu entorno:
   
   ```bash
   cp .env.example .env
   ```

2. Instala dependencias:
   
   ```bash
   npm install
   ```

## Ejecución (desarrollo)
Usando `ts-node-dev` sin compilar:

```bash
npx ts-node-dev --respawn --transpile-only src/server.ts
```

El servidor arranca en `http://localhost:3000` (o el puerto en `PORT`).

## Endpoints
- `GET /` → Ping básico del servicio.
- `GET /health` → Estado del servicio con verificación simple de DB (`SELECT 1`).

## Estructura
- `src/server.ts` → Arranque del servidor Express y middlewares.
- `src/db.ts` → Pool de conexión MySQL (mysql2/promise).
- `src/routes/health.ts` → Ruta de salud del servicio.

## Variables de entorno
Ver `.env.example`:
- `PORT` → Puerto del servidor.
- `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME` → Conexión MySQL.

## Notas
- Asegúrate de que la base de datos exista y las credenciales sean correctas.
- En producción, compila con `tsc` y ejecuta el JavaScript compilado.
