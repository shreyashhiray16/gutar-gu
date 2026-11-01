import pytest
from fastapi.testclient import TestClient
from main import app, hub, RoomState

def test_metrics_endpoint():
    client = TestClient(app)
    res = client.get("/metrics")
    assert res.status_code == 200
    data = res.json()
    assert data["status"] == "healthy"
    assert "active_rooms" in data
    assert "active_connections" in data
    assert "total_rooms_created" in data
    assert "peak_connections" in data

def test_csp_and_security_headers():
    client = TestClient(app)
    res = client.get("/")
    assert res.status_code == 200
    assert res.headers.get("X-Content-Type-Options") == "nosniff"
    assert res.headers.get("X-Frame-Options") == "DENY"
    assert res.headers.get("Referrer-Policy") == "no-referrer"
    assert "Content-Security-Policy" in res.headers

def test_ping_pong_heartbeat():
    client = TestClient(app)
    with client.websocket_connect("/ws/test-secret-token") as ws:
        ws.receive_json() # status
        ws.send_json({"type": "ping", "client_time": 123456})
        pong = ws.receive_json()
        assert pong["type"] == "pong"
        assert pong["client_time"] == 123456
        assert "server_time" in pong

def test_ephemeral_media_relay():
    client = TestClient(app)
    with client.websocket_connect("/ws/test-secret-token") as ws1:
        ws1.receive_json()
        with client.websocket_connect("/ws/test-secret-token") as ws2:
            ws1.receive_json() # join
            ws2.receive_json() # join

            # Send ephemeral image
            dummy_image_data = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="
            ws1.send_json({
                "type": "ephemeral_media",
                "media_data": dummy_image_data,
                "mime_type": "image/png",
                "view_once": True,
                "timer": 10
            })
            # ws1 gets ack
            ack = ws1.receive_json()
            assert ack["type"] == "ack"

            # ws2 receives ephemeral media
            media_msg = ws2.receive_json()
            assert media_msg["type"] == "ephemeral_media"
            assert media_msg["media_data"] == dummy_image_data
            assert media_msg["view_once"] is True
            assert media_msg["timer"] == 10

def test_read_receipt_relay():
    client = TestClient(app)
    with client.websocket_connect("/ws/test-secret-token") as ws1:
        ws1.receive_json()
        with client.websocket_connect("/ws/test-secret-token") as ws2:
            ws1.receive_json()
            ws2.receive_json()

            ws1.send_json({"type": "read_receipt", "message_id": "msg-xyz"})
            receipt = ws2.receive_json()
            assert receipt["type"] == "read_receipt"
            assert receipt["message_id"] == "msg-xyz"

