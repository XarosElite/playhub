# Playhub 2.0

Playhub 2.0 is a self-hosted game server manager built on Docker. It provides a web interface to deploy, monitor, and manage dedicated game servers such as Minecraft and Palworld.

## Features

- **Multi-Game Support**: Deploy dedicated servers for supported games (Minecraft, Palworld) with custom configuration options.
- **Server Lifecycle Controls**: Start, stop, restart, and delete containers directly from the Web UI.
- **In-Browser Interactive Terminal**: Attach directly to running game server containers with an interactive terminal session over WebSockets.
- **Real-Time System Monitoring**: Live CPU and RAM usage charts, IP detection, and server status updates.
- **Task Queue Architecture**: Uses Redis Queue (RQ) and Docker Socket Proxy to run container operations asynchronously in the background.
- **Port Auto-Assignment**: Automatic available port detection via `get_next_available_port` to prevent port conflicts.

## System Architecture

Playhub consists of six containerized services managed via Docker Compose:

- **Frontend**: React, TypeScript, Vite, Mantine UI, and xterm.js terminal.
- **API**: FastAPI backend handling server configuration, job enqueuing, system stats, and WebSocket terminal streaming.
- **Docker Executer**: Python RQ worker processing container lifecycle tasks.
- **Redis**: Queue and state storage for asynchronous background jobs.
- **Database**: PostgreSQL storing server metadata with `config` (JSON) and `owner_id` fields.
- **Docker Proxy**: `tecnativa/docker-socket-proxy` providing restricted access to the Docker daemon.

## Prerequisites

- Docker and Docker Compose
- User permissions to interact with Docker (`docker` group or elevated access)

## Configuration

Create a `.env` file in the project root based on `default.env`:

```bash
cp default.env .env
```

Key environment variables in `.env`:

| Variable | Description | Default |
| --- | --- | --- |
| `BUILD_TARGET` | Deployment target (`development` or `production`) | `development` |
| `FRONTEND_PORT` | Port exposed for the Web UI | `4201` (dev) / `80` (prod) |
| `API_PORT` | Port exposed for the FastAPI backend | `8001` |
| `POSTGRES_DB` | PostgreSQL database name | `playhub` |
| `POSTGRES_USER` | PostgreSQL user | `playhuber` |
| `POSTGRES_PASSWORD` | PostgreSQL password | `Blayhub` |
| `POSTGRES_PORT` | Internal PostgreSQL port | `5432` |
| `GET_NEXT_AVAILABLE_PORT` | Use automated port allocation (true/false) | `true` |

---

## Running the Application

### Running in Development

In development mode, Vite provides hot module replacement (HMR) for the frontend, and FastAPI runs with live code reloading.

1. Ensure `BUILD_TARGET=development` in your `.env` file:
   ```bash
   BUILD_TARGET=development
   ```

2. Build and start the services:
   ```bash
   docker compose up -d --build
   ```

3. Access the services:
   - **Frontend UI**: [http://localhost:4201](http://localhost:4201)
   - **API Docs (Swagger)**: [http://localhost:8001/docs](http://localhost:8001/docs)

---

### Running in Production

In production mode, the frontend is compiled and served through a light Nginx image, and FastAPI runs in production mode.

1. Set `BUILD_TARGET=production` in your `.env` file:
   ```bash
   BUILD_TARGET=production
   ```

2. Build and start the production stack:
   ```bash
   docker compose up -d --build
   ```

3. Access the services:
   - **Frontend UI**: [http://localhost:80](http://localhost:80) (or your configured `FRONTEND_PORT`)
   - **API**: [http://localhost:8001](http://localhost:8001)

---

## Useful Commands

```bash
# View live logs for all services
docker compose logs -f

# View logs for a specific service
docker compose logs -f api
docker compose logs -f docker-executer

# Stop all running services
docker compose down

# Restart a single service
docker compose restart api
```

## Server Management

- **Create Server**: Via the Web UI, select game type and configuration. Ports are automatically assigned from available range.
- **Server Configuration**: Server parameters and environment settings are stored in the `config` JSON field in the database.
- **Unique Ports**: Each server is assigned a unique port to prevent conflicts.

## Backend Design Architecture

<img width="954" height="868" alt="Playhub Backend Design" src="https://github.com/user-attachments/assets/39439f77-8070-4948-a696-72690cbdc65d" />

### Component Overview

- **Frontend** (React + Vite + Mantine UI): Provides the web interface for server management, monitoring, and terminal access. Uses xterm.js for WebSocket-based interactive terminals.
- **API** (FastAPI): Handles HTTP requests for server lifecycle (create/start/stop/delete), job enqueuing, system stats, and WebSocket terminal streaming. Connects to PostgreSQL for persistent data and Redis for job queue management.
- **Docker Executer** (Python RQ worker): Background worker that processes container lifecycle tasks from the Redis queue. Interacts with the Docker daemon via `docker-socket-proxy` to create, start, stop, and remove containers.
- **Redis**: Message queue and state storage. Holds pending jobs, server status, and facilitates communication between API and workers.
- **PostgreSQL**: Persistent storage for server metadata including name, game type, state, port assignment, configuration (JSON), and creation timestamps.
- **Docker Proxy** (`tecnativa/docker-socket-proxy`): Provides restricted, namespace-limited access to the Docker daemon for the API and worker services.
