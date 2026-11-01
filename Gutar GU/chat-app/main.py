import os
import sys
import time
import secrets
import asyncio
from typing import Dict, List, Optional
from pathlib import Path
from contextlib import asynccontextmanager
from dotenv import load_dotenv
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException, status, Request, Response
from fastapi.responses import FileResponse, PlainTextResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from starlette.middleware.base import BaseHTTPMiddleware

load_dotenv()

# Fixed default token from env (backward-compatible)
DEFAULT_ROOM_TOKEN = os.getenv("ROOM_TOKEN", "change-me-long-random")

BASE_DIR = Path(__file__).resolve().parent
STATIC_DIR = BASE_DIR / "static"

# Global rate limiter state for room creation (e.g. max 10 rooms per minute per IP)
room_creation_limits: Dict[str, List[float]] = {}
room_creation_lock = asyncio.Lock()

async def check_room_creation_rate_limit(client_ip: str, max_requests: int = 15, window_seconds: float = 60.0) -> bool:
    async with room_creation_lock:
        now = time.time()
        timestamps = room_creation_limits.setdefault(client_ip, [])
        room_creation_limits[client_ip] = [t for t in timestamps if now - t < window_seconds]
        if len(room_creation_limits[client_ip]) >= max_requests:
            return False
        room_creation_limits[client_ip].append(now)
        return True

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Background task for room cleanup and peak connections sampling
    async def cleanup_loop():
        while True:
            try:
                await asyncio.sleep(30)
                await hub.cleanup_inactive_rooms()
                await hub.update_peak_connections()
            except asyncio.CancelledError:
                break
            except Exception:
                pass
    task = asyncio.create_task(cleanup_loop())
    yield
    task.cancel()
    try:
        await task
    except asyncio.CancelledError:
        pass

app = FastAPI(title="Gutar GU - Zero-Trace Ephemeral Chat", lifespan=lifespan)

# Security and Privacy Headers Middleware (Strict CSP, no-referrer, etc.)
class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        response: Response = await call_next(request)
        # Enforce strict headers for privacy & security
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Referrer-Policy"] = "no-referrer"
        response.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()"
        response.headers["Content-Security-Policy"] = (
            "default-src 'self'; "
            "img-src 'self' data: blob: https://api.qrserver.com; "
            "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; "
            "font-src 'self' https://fonts.gstatic.com; "
            "script-src 'self' 'unsafe-inline'; "
            "connect-src 'self' ws: wss:; "
            "media-src 'self' blob: data:;"
        )
        return response

app.add_middleware(SecurityHeadersMiddleware)

# Individual Room Manager
class RoomState:
    def __init__(self, token: str):
        self.token = token
        self.sockets: Dict[WebSocket, str] = {}
        self.messages: List[dict] = []
        self.message_rate_limits: Dict[WebSocket, List[float]] = {}
        self.lock = asyncio.Lock()
        self.last_activity = time.time()
        self.created_at = time.time()

    def get_socket_count(self) -> int:
        return len(self.sockets)

    def is_full(self) -> bool:
        return len(self.sockets) >= 2

    async def join(self, websocket: WebSocket, nickname: str) -> bool:
        async with self.lock:
            self.last_activity = time.time()
            if len(self.sockets) >= 2:
                return False
            
            # When the second user joins, wipe old messages before anything else
            if len(self.sockets) == 1:
                self.messages.clear()

            self.sockets[websocket] = nickname
            self.message_rate_limits[websocket] = []
            return True

    async def leave(self, websocket: WebSocket) -> Optional[WebSocket]:
        async with self.lock:
            self.last_activity = time.time()
            partner = None
            if websocket in self.sockets:
                del self.sockets[websocket]
            if websocket in self.message_rate_limits:
                del self.message_rate_limits[websocket]

            # In zero-trace chat, if either user leaves, the entire conversation in memory is immediately cleared!
            self.messages.clear()

            if len(self.sockets) == 1:
                partner = list(self.sockets.keys())[0]

            return partner

    def clear(self):
        self.messages.clear()

    def purge_message(self, message_id: str) -> bool:
        """Zero-remains: explicitly purge a specific message from memory"""
        for i, m in enumerate(self.messages):
            if m.get("id") == message_id:
                self.messages.pop(i)
                return True
        return False

    async def send_to_other(self, sender_ws: WebSocket, message: dict):
        self.last_activity = time.time()
        for ws in list(self.sockets.keys()):
            if ws != sender_ws:
                try:
                    await ws.send_json(message)
                except Exception:
                    pass

    async def broadcast(self, message: dict):
        self.last_activity = time.time()
        for ws in list(self.sockets.keys()):
            try:
                await ws.send_json(message)
            except Exception:
                pass

    def check_rate_limit(self, websocket: WebSocket, max_per_second: int = 5) -> bool:
        now = time.time()
        timestamps = self.message_rate_limits.setdefault(websocket, [])
        self.message_rate_limits[websocket] = [t for t in timestamps if now - t < 1.0]
        if len(self.message_rate_limits[websocket]) >= max_per_second:
            return False
        self.message_rate_limits[websocket].append(now)
        return True


# Multi-Room Hub
class MultiRoomHub:
    def __init__(self):
        self.rooms: Dict[str, RoomState] = {}
        self.lock = asyncio.Lock()
        self.total_rooms_created = 0
        self.peak_connections = 0
        # Seed default token
        if DEFAULT_ROOM_TOKEN:
            self.rooms[DEFAULT_ROOM_TOKEN] = RoomState(DEFAULT_ROOM_TOKEN)

    def is_valid_token(self, token: str) -> bool:
        return token in self.rooms

    async def create_room(self, custom_token: Optional[str] = None) -> str:
        async with self.lock:
            if custom_token:
                token = custom_token.strip()
            else:
                token = secrets.token_urlsafe(24)
            
            if token not in self.rooms:
                self.rooms[token] = RoomState(token)
                self.total_rooms_created += 1
            return token

    def get_room(self, token: str) -> Optional[RoomState]:
        return self.rooms.get(token)

    def get_total_connections(self) -> int:
        return sum(len(r.sockets) for r in self.rooms.values())

    async def update_peak_connections(self):
        current = self.get_total_connections()
        if current > self.peak_connections:
            self.peak_connections = current

    async def cleanup_inactive_rooms(self, max_inactive_seconds: int = 1800):
        """Purge rooms inactive for > 30 minutes, or empty rooms > 5 minutes (except default)"""
        async with self.lock:
            now = time.time()
            to_remove = []
            for token, r in self.rooms.items():
                if token == DEFAULT_ROOM_TOKEN:
                    continue
                # If room is empty for > 5 min, or inactive for > 30 min
                is_empty = (r.get_socket_count() == 0)
                inactive_time = now - r.last_activity
                if (is_empty and inactive_time > 300) or (inactive_time > max_inactive_seconds):
                    to_remove.append(token)
            for token in to_remove:
                r = self.rooms.pop(token, None)
                if r:
                    r.clear()

    # Backward compatibility helper for single room tests
    @property
    def default_room(self) -> RoomState:
        if DEFAULT_ROOM_TOKEN not in self.rooms:
            self.rooms[DEFAULT_ROOM_TOKEN] = RoomState(DEFAULT_ROOM_TOKEN)
        return self.rooms[DEFAULT_ROOM_TOKEN]


hub = MultiRoomHub()
room = hub.default_room  # Expose 'room' for existing tests

# Static files mount
app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")

@app.get("/health")
def health():
    return PlainTextResponse("ok")

# Privacy-preserving anonymous metrics (Zero user data: aggregate counts only)
@app.get("/metrics")
def get_metrics():
    return JSONResponse({
        "status": "healthy",
        "active_rooms": len(hub.rooms),
        "active_connections": hub.get_total_connections(),
        "total_rooms_created": hub.total_rooms_created,
        "peak_connections": hub.peak_connections,
        "timestamp": int(time.time())
    })

# Landing page frontend for creating rooms and sharing links
@app.get("/")
def get_landing():
    landing_file = STATIC_DIR / "landing.html"
    if landing_file.is_file():
        return FileResponse(str(landing_file))
    return HTTPException(status_code=404, detail="Landing page not found")

# API endpoint to generate a room token & shareable link with rate limiting
@app.post("/api/create-room")
async def api_create_room(request: Request):
    client_ip = request.client.host if request.client else "unknown"
    allowed = await check_room_creation_rate_limit(client_ip)
    if not allowed:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many room creation requests. Please wait a moment."
        )
    token = await hub.create_room()
    return JSONResponse({
        "token": token,
        "room_path": f"/room/{token}"
    })

@app.get("/room/{token}")
def get_room(token: str):
    if not hub.is_valid_token(token):
        raise HTTPException(status_code=404, detail="Room Not Found")
    index_file = STATIC_DIR / "index.html"
    if not index_file.is_file():
        raise HTTPException(status_code=404, detail="File not found")
    return FileResponse(str(index_file))

MAX_MESSAGE_LENGTH = 1000

@app.websocket("/ws/{token}")
async def websocket_endpoint(websocket: WebSocket, token: str):
    target_room = hub.get_room(token)
    if not target_room:
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        return

    # Check capacity
    if target_room.is_full():
        await websocket.accept()
        await websocket.send_json({"type": "status", "text": "room full"})
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        return

    await websocket.accept()

    default_nick = f"User-{id(websocket) % 1000:03d}"
    nickname = default_nick

    try:
        joined = await target_room.join(websocket, nickname)
        if not joined:
            await websocket.send_json({"type": "status", "text": "room full"})
            await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
            return

        # If 2nd user connects, broadcast partner connected
        if target_room.get_socket_count() == 2:
            partner_connected_event = {
                "type": "join",
                "sender": "system",
                "text": "Partner connected",
                "timestamp": int(time.time() * 1000)
            }
            await target_room.broadcast(partner_connected_event)
        else:
            await websocket.send_json({
                "type": "status",
                "text": "Waiting for someone to join...",
                "timestamp": int(time.time() * 1000)
            })

        while True:
            data = await websocket.receive_json()
            msg_type = data.get("type", "message")

            if msg_type == "set_nickname":
                new_nick = str(data.get("nickname", "")).strip()[:30]
                if new_nick:
                    target_room.sockets[websocket] = new_nick
                continue

            if msg_type == "typing":
                is_typing = bool(data.get("typing", False))
                sender_nick = target_room.sockets.get(websocket, "Anonymous")
                await target_room.send_to_other(websocket, {
                    "type": "typing",
                    "sender": sender_nick,
                    "typing": is_typing,
                    "timestamp": int(time.time() * 1000)
                })
                continue

            if msg_type == "reaction":
                message_id = str(data.get("message_id", ""))[:50]
                emoji = str(data.get("emoji", ""))[:10]
                if message_id and emoji:
                    await target_room.send_to_other(websocket, {
                        "type": "reaction",
                        "sender": target_room.sockets.get(websocket, "Anonymous"),
                        "message_id": message_id,
                        "emoji": emoji,
                        "timestamp": int(time.time() * 1000)
                    })
                continue

            if msg_type == "ping":
                # Heartbeat round-trip measurement
                await websocket.send_json({
                    "type": "pong",
                    "client_time": data.get("client_time", int(time.time() * 1000)),
                    "server_time": int(time.time() * 1000)
                })
                continue

            if msg_type == "read_receipt" or msg_type == "message_seen":
                msg_id = str(data.get("message_id", ""))[:50]
                if msg_id:
                    await target_room.send_to_other(websocket, {
                        "type": "read_receipt",
                        "message_id": msg_id,
                        "timestamp": int(time.time() * 1000)
                    })
                continue

            if msg_type == "purge_message":
                msg_id = str(data.get("message_id", ""))[:50]
                if msg_id:
                    target_room.purge_message(msg_id)
                    await target_room.broadcast({
                        "type": "purge_message",
                        "message_id": msg_id,
                        "timestamp": int(time.time() * 1000)
                    })
                continue

            if msg_type == "key_exchange":
                # Relaying public keys for client-side E2EE
                await target_room.send_to_other(websocket, {
                    "type": "key_exchange",
                    "sender": target_room.sockets.get(websocket, "Anonymous"),
                    "key": data.get("key"),
                    "timestamp": int(time.time() * 1000)
                })
                continue

            if msg_type == "ephemeral_media":
                # Ephemeral peer media transfer (Cap at 5MB payload, never saved to disk)
                media_data = data.get("media_data", "")
                if not isinstance(media_data, str) or len(media_data) > 7 * 1024 * 1024:
                    await websocket.send_json({
                        "type": "error",
                        "text": "Media file exceeds 5MB limit or invalid format.",
                        "timestamp": int(time.time() * 1000)
                    })
                    continue

                msg_id = str(data.get("id") or f"media-{int(time.time()*1000)}-{id(websocket)%1000}")[:50]
                view_once = bool(data.get("view_once", False))
                timer_val = data.get("timer", 0)

                payload = {
                    "id": msg_id,
                    "type": "ephemeral_media",
                    "sender": target_room.sockets.get(websocket, "Anonymous"),
                    "media_data": media_data,
                    "mime_type": str(data.get("mime_type", "image/png"))[:50],
                    "view_once": view_once,
                    "timer": timer_val if isinstance(timer_val, (int, float)) and timer_val > 0 else 0,
                    "timestamp": int(time.time() * 1000)
                }
                # Media is strictly ephemeral: NEVER appended to room.messages list in server memory!
                await target_room.send_to_other(websocket, payload)
                # Send ack to sender
                await websocket.send_json({"type": "ack", "id": msg_id, "timestamp": int(time.time() * 1000)})
                continue

            if msg_type == "message":
                if not target_room.check_rate_limit(websocket):
                    await websocket.send_json({
                        "type": "error",
                        "text": "Slow down! Rate limit exceeded.",
                        "timestamp": int(time.time() * 1000)
                    })
                    continue

                text = data.get("text", "")
                if not isinstance(text, str):
                    continue

                # Encrypted ciphertext may be structured/longer, but cap string size
                max_allowed = MAX_MESSAGE_LENGTH * 8 if data.get("encrypted") else MAX_MESSAGE_LENGTH
                if len(text) > max_allowed:
                    text = text[:max_allowed]

                msg_id = str(data.get("id") or f"msg-{int(time.time()*1000)}-{id(websocket)%1000}")[:50]
                sender_nick = target_room.sockets.get(websocket, "Anonymous")
                
                # Check for auto-destruct timer & burn-after-read
                timer_val = data.get("timer", 0)
                burn_after_read = bool(data.get("burn_after_read", False))
                is_encrypted = bool(data.get("encrypted", False))
                cipher_bytes = data.get("cipher_bytes")
                iv = data.get("iv")

                payload = {
                    "id": msg_id,
                    "type": "message",
                    "sender": sender_nick,
                    "text": text,
                    "timer": timer_val if isinstance(timer_val, (int, float)) and timer_val > 0 else 0,
                    "burn_after_read": burn_after_read,
                    "encrypted": is_encrypted,
                    "cipher_bytes": cipher_bytes if is_encrypted else None,
                    "iv": iv if is_encrypted else None,
                    "timestamp": int(time.time() * 1000)
                }

                # Ephemeral guarantee: if burn_after_read, do NOT keep in memory long-term
                if not burn_after_read:
                    target_room.messages.append(payload)
                await target_room.send_to_other(websocket, payload)
                # Send ack to sender
                await websocket.send_json({"type": "ack", "id": msg_id, "timestamp": int(time.time() * 1000)})

    except WebSocketDisconnect:
        partner = await target_room.leave(websocket)
        if partner:
            try:
                await partner.send_json({
                    "type": "leave",
                    "sender": "system",
                    "text": "Partner left",
                    "timestamp": int(time.time() * 1000)
                })
            except Exception:
                pass
    except Exception:
        partner = await target_room.leave(websocket)
        if partner:
            try:
                await partner.send_json({
                    "type": "leave",
                    "sender": "system",
                    "text": "Partner left",
                    "timestamp": int(time.time() * 1000)
                })
            except Exception:
                pass
