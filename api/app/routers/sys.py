import datetime
import socket
import psutil
import requests
from fastapi import APIRouter, Query

router = APIRouter(
    prefix="/sys",
    tags=["system"],
    responses={404: {"description": "Not found"}},
)

@router.get('/info')
def get_system_info():
    """
    Returns current system CPU usage and RAM usage statistics.
    """
    cpu_usage = psutil.cpu_percent(interval=0.1)
    mem = psutil.virtual_memory()

    total_ram_gb = round(mem.total / (1024 ** 3), 2)
    used_ram_gb = round(mem.used / (1024 ** 3), 2)
    used_ram_pct = round(mem.percent, 2)
    now_iso = datetime.datetime.now(datetime.timezone.utc).isoformat()

    return {
        "msg": {
            "sys_info": {
                "cpu_usage": cpu_usage,
                "total_ram_gb": total_ram_gb,
                "used_ram_gb": used_ram_gb,
                "used_ram_pct": used_ram_pct,
                "time": now_iso
            }
        }
    }

@router.get('/ip')
def get_system_ip():
    """
    Returns public router/WAN IP address.
    """
    public_ip_services = [
        "https://api.ipify.org",
        "https://ifconfig.me/ip",
        "https://icanhazip.com",
        "https://ipinfo.io/ip",
    ]
    for service in public_ip_services:
        try:
            resp = requests.get(service, timeout=3)
            if resp.status_code == 200 and resp.text.strip():
                return {"msg": {"ip": resp.text.strip()}}
        except Exception:
            continue

    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
    except Exception:
        ip = "127.0.0.1"

    return {"msg": {"ip": ip}}

@router.get('/')
def check_port_open(open_port: int = Query(default=None)):
    """
    Checks if a given port is open/available on the host.
    """
    if open_port is None:
        return {"msg": {"open_status": False}}

    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.settimeout(1)
        res = s.connect_ex(('127.0.0.1', open_port))
        # res == 0 means port is currently listening (open/in-use)
        return {"msg": {"open_status": res == 0}}
