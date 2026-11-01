"""
Minimal Minecraft Server List Ping (the protocol the multiplayer menu uses) to
read player counts. https://wiki.vg/Server_List_Ping
"""
import json
import socket
import struct


def _varint(value: int) -> bytes:
    out = b""
    while True:
        byte = value & 0x7F
        value >>= 7
        out += struct.pack("B", byte | (0x80 if value else 0))
        if not value:
            return out


def _read_varint(sock: socket.socket) -> int:
    result = 0
    for i in range(5):
        byte = sock.recv(1)
        if not byte:
            raise ConnectionError("Connection closed while reading")
        b = byte[0]
        result |= (b & 0x7F) << (7 * i)
        if not b & 0x80:
            return result
    raise ValueError("VarInt too long")


def _recv_exact(sock: socket.socket, length: int) -> bytes:
    data = b""
    while len(data) < length:
        chunk = sock.recv(length - len(data))
        if not chunk:
            raise ConnectionError("Connection closed while reading")
        data += chunk
    return data


def ping(host: str, port: int, timeout: float = 1.5) -> dict:
    """Returns {'online': int, 'max': int, 'version': str}. Raises on failure."""
    with socket.create_connection((host, port), timeout=timeout) as sock:
        sock.settimeout(timeout)
        host_bytes = host.encode()
        # Handshake: packet 0x00, protocol version (servers answer status
        # pings for any version), address, port, next state 1 = status.
        handshake = (_varint(0x00) + _varint(767) +
                     _varint(len(host_bytes)) + host_bytes + struct.pack(">H", port) + _varint(1))
        sock.sendall(_varint(len(handshake)) + handshake)
        sock.sendall(_varint(1) + _varint(0x00))  # status request

        _read_varint(sock)  # packet length
        if _read_varint(sock) != 0x00:
            raise ValueError("Unexpected packet")
        payload = _recv_exact(sock, _read_varint(sock))
        status = json.loads(payload.decode("utf-8"))

    players = status.get("players") or {}
    return {
        "online": int(players.get("online", 0)),
        "max": int(players.get("max", 0)),
        "version": (status.get("version") or {}).get("name"),
    }
