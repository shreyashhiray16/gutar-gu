# 1-on-1 Link-Based Chat Site

A lightweight, private 1-on-1 link-based chat application built with **FastAPI**, **WebSockets**, and a modern **vanilla HTML/CSS/JS** front end.

## Features & Ground Rules
- **One Fixed Room & Fixed Link**: Access the chat exclusively via `/room/{ROOM_TOKEN}`. No landing page, no account registration, and no database.
- **In-Memory Ephemeral Storage**: All chat state lives strictly in server memory.
- **Auto-Deletion of Old Chat**: Whenever a second user joins, any prior messages in the room are wiped immediately before starting the session. Messages are also cleared when the room empties.
- **Two Users Maximum**: The room permits at most 2 simultaneous connections. A third connection receives a "room full" notice and is disconnected.
- **Privacy & Security**: Zero message text is logged to server outputs. Safe DOM rendering using `textContent` (never `innerHTML`). Message length cap (1,000 chars) and per-connection rate limiting.
- **Responsive Layout**: Designed for seamless mobile and desktop usage.

---

## Shared Link Format

```
https://<your-domain>/room/<ROOM_TOKEN>
```
Example locally:
```
http://localhost:8000/room/change-me-long-random
```

---

## Local Development & Setup

### 1. Requirements
- Python 3.11+
- Virtual environment tool (`venv`)

### 2. Installation
```bash
# Clone or navigate to the chat-app directory
cd chat-app

# Create virtual environment
python -m venv venv

# Activate virtual environment
# Windows:
venv\Scripts\activate
# Linux/macOS:
source venv/bin/activate

# Install dependencies
pip install -r requirements.txt
```

### 3. Setting the Token
Copy `.env.example` to `.env` and set a strong, random token:
```bash
cp .env.example .env
```
Inside `.env`:
```ini
ROOM_TOKEN=change-me-long-random
```
*Note: The server will refuse to start if `ROOM_TOKEN` is missing or empty.*

### 4. Running the Server Locally
```bash
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```
Open your browser to:
`http://localhost:8000/room/change-me-long-random`

---

## Testing & Verification

Comprehensive automated test suite using `pytest` and FastAPI's `TestClient` with WebSocket support.

### Running Automated Tests
```bash
pytest -v
```

### Automated Tests Cover:
1. `GET /health` returns `200 OK` with `ok`.
2. `GET /` returns `404 Not Found`.
3. `GET /room/{ROOM_TOKEN}` renders the chat application, while an invalid token returns `404`.
4. WebSocket connection with invalid token is rejected with policy violation (1008).
5. Message relaying between two connected users.
6. Rejection of a 3rd socket with "room full" message and disconnection.
7. Deletion of previous messages when a second user joins.
8. Message cleanup when all sockets disconnect.
9. Message length capping (enforcing max 1000 characters).
10. Privacy verification: confirming server logs never output chat message contents.

### Manual Checks Summary:
- **Refresh Mid-Chat**:
  When user A refreshes mid-chat, socket A disconnects, user B receives "Partner left", and when user A reconnects, user A rejoins as the 2nd user, clearing stale history cleanly and notifying "Partner connected".
- **Phone-width Screen**:
  Tested with CSS fluid responsive container (`100dvh`, flexible message bubbles, mobile keyboard safe paddings).
- **Zero Logging Verification**:
  Server stdout/stderr inspected during active conversations; no message payloads or text are logged.

---

## Deployment (Step 7)

### Start Command
```bash
uvicorn main:app --host 0.0.0.0 --port ${PORT:-8000}
```

### Dockerfile
A lightweight `Dockerfile` is included for container deployments (Render, Railway, Fly.io, Google Cloud Run).

### Multi-Instance Note
The current implementation runs with an efficient in-memory state manager suitable for single instances. Redis pub/sub can be integrated if multi-instance clustering is needed in the future.

