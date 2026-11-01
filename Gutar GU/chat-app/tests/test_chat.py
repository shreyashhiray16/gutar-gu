import os
import sys
from pathlib import Path

# Add project root to sys.path so tests can import main seamlessly
BASE_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BASE_DIR))

import pytest
from starlette.websockets import WebSocketDisconnect
from fastapi.testclient import TestClient

# Set ROOM_TOKEN before importing main
os.environ["ROOM_TOKEN"] = "test-secret-token"

from main import app, room, MAX_MESSAGE_LENGTH

@pytest.fixture(autouse=True)
def clean_room():
    room.sockets.clear()
    room.messages.clear()
    room.message_rate_limits.clear()
    yield
    room.sockets.clear()
    room.messages.clear()
    room.message_rate_limits.clear()

def test_health_check():
    client = TestClient(app)
    res = client.get("/health")
    assert res.status_code == 200
    assert res.text == "ok"

def test_room_page_and_404():
    client = TestClient(app)
    # Root now returns the landing page for room creation
    res_root = client.get("/")
    assert res_root.status_code == 200
    assert "Private 1-on-1 Chat" in res_root.text

    # Valid room token returns 200 HTML
    res = client.get("/room/test-secret-token")
    assert res.status_code == 200
    assert "<!DOCTYPE html>" in res.text
    # Wrong room token returns 404
    assert client.get("/room/wrong-token").status_code == 404

def test_api_create_room():
    client = TestClient(app)
    res = client.post("/api/create-room")
    assert res.status_code == 200
    data = res.json()
    assert "token" in data
    assert data["room_path"] == f"/room/{data['token']}"
    # Verify created room is accessible
    res_room = client.get(data["room_path"])
    assert res_room.status_code == 200

def test_ws_rejects_wrong_token():
    client = TestClient(app)
    with pytest.raises(WebSocketDisconnect) as exc_info:
        with client.websocket_connect("/ws/wrong-token") as ws:
            ws.receive_json()
    assert exc_info.value.code == 1008

def test_exchange_messages_between_two_clients():
    client = TestClient(app)
    with client.websocket_connect("/ws/test-secret-token") as ws1:
        status1 = ws1.receive_json()
        assert status1["type"] == "status"

        with client.websocket_connect("/ws/test-secret-token") as ws2:
            join_msg1 = ws1.receive_json()
            join_msg2 = ws2.receive_json()
            assert join_msg1["type"] == "join"
            assert join_msg2["type"] == "join"

            ws1.send_json({"type": "set_nickname", "nickname": "Alice"})
            ws2.send_json({"type": "set_nickname", "nickname": "Bob"})

            ws1.send_json({"type": "message", "text": "Hello Bob!"})
            received_by_ws2 = ws2.receive_json()
            assert received_by_ws2["type"] == "message"
            assert received_by_ws2["text"] == "Hello Bob!"
            assert received_by_ws2["sender"] == "Alice"

def test_typing_indicator_relay():
    """Verify typing indicator is relayed to partner"""
    client = TestClient(app)
    with client.websocket_connect("/ws/test-secret-token") as ws1:
        ws1.receive_json()
        with client.websocket_connect("/ws/test-secret-token") as ws2:
            ws1.receive_json()
            ws2.receive_json()

            ws1.send_json({"type": "set_nickname", "nickname": "Alice"})
            ws1.send_json({"type": "typing", "typing": True})

            typing_msg = ws2.receive_json()
            assert typing_msg["type"] == "typing"
            assert typing_msg["sender"] == "Alice"
            assert typing_msg["typing"] is True

def test_message_reaction_relay():
    """Verify emoji reactions are relayed to partner"""
    client = TestClient(app)
    with client.websocket_connect("/ws/test-secret-token") as ws1:
        ws1.receive_json()
        with client.websocket_connect("/ws/test-secret-token") as ws2:
            ws1.receive_json()
            ws2.receive_json()

            ws1.send_json({"type": "reaction", "message_id": "msg-123", "emoji": "👍"})
            reaction_msg = ws2.receive_json()
            assert reaction_msg["type"] == "reaction"
            assert reaction_msg["message_id"] == "msg-123"
            assert reaction_msg["emoji"] == "👍"

def test_reject_third_client_room_full():
    client = TestClient(app)
    with client.websocket_connect("/ws/test-secret-token") as ws1:
        ws1.receive_json()
        with client.websocket_connect("/ws/test-secret-token") as ws2:
            ws1.receive_json()
            ws2.receive_json()

            with client.websocket_connect("/ws/test-secret-token") as ws3:
                full_msg = ws3.receive_json()
                assert full_msg["type"] == "status"
                assert full_msg["text"] == "room full"
                with pytest.raises(WebSocketDisconnect) as exc_info:
                    ws3.receive_json()
                assert exc_info.value.code == 1008

def test_delete_old_messages_when_second_user_joins():
    client = TestClient(app)
    room.messages.append({"type": "message", "sender": "Ghost", "text": "Old message 1", "timestamp": 100})
    assert len(room.messages) == 1

    with client.websocket_connect("/ws/test-secret-token") as ws1:
        ws1.receive_json()
        with client.websocket_connect("/ws/test-secret-token") as ws2:
            ws1.receive_json()
            ws2.receive_json()
            assert len(room.messages) == 0

def test_clear_messages_when_room_empties():
    client = TestClient(app)
    with client.websocket_connect("/ws/test-secret-token") as ws1:
        ws1.receive_json()
        with client.websocket_connect("/ws/test-secret-token") as ws2:
            ws1.receive_json()
            ws2.receive_json()
            ws1.send_json({"type": "message", "text": "Ephemeral message"})
            # ws1 gets ack
            ack = ws1.receive_json()
            assert ack["type"] == "ack"
            # ws2 gets message
            ws2.receive_json()
            assert len(room.messages) == 1
        
        # When ws2 disconnects, zero-trace clears room messages immediately
        leave_msg = ws1.receive_json()
        assert leave_msg["type"] == "leave"
        assert len(room.messages) == 0

    assert len(room.sockets) == 0
    assert len(room.messages) == 0

def test_message_length_capping():
    client = TestClient(app)
    with client.websocket_connect("/ws/test-secret-token") as ws1:
        ws1.receive_json()
        with client.websocket_connect("/ws/test-secret-token") as ws2:
            ws1.receive_json()
            ws2.receive_json()

            long_text = "A" * (MAX_MESSAGE_LENGTH + 500)
            ws1.send_json({"type": "message", "text": long_text})
            msg = ws2.receive_json()
            assert len(msg["text"]) == MAX_MESSAGE_LENGTH

def test_confirm_server_never_logs_message_text(capsys):
    client = TestClient(app)
    secret_text = "SUPER_SECRET_PAYLOAD_12345"
    with client.websocket_connect("/ws/test-secret-token") as ws1:
        ws1.receive_json()
        with client.websocket_connect("/ws/test-secret-token") as ws2:
            ws1.receive_json()
            ws2.receive_json()
            ws1.send_json({"type": "message", "text": secret_text})
            ws2.receive_json()

    captured = capsys.readouterr()
    assert secret_text not in captured.out
    assert secret_text not in captured.err
