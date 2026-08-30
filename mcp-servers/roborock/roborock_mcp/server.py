"""Roborock MCP server: status, start clean, stop clean.

Kept deliberately thin. It owns no state beyond the live connection: every
call logs in, reads from the robot and answers. Nothing about the home, the
schedule or the user's decisions lives here.
"""

from __future__ import annotations

import asyncio
import datetime as dt
import logging
import os
from typing import Any

from mcp.server.mcpserver import MCPServer
from roborock.devices.device import RoborockDevice
from roborock.devices.device_manager import DeviceManager, UserParams, create_device_manager
from roborock.exceptions import RoborockException
from roborock.roborock_typing import RoborockCommand
from roborock.web_api import RoborockApiClient

_LOGGER = logging.getLogger("roborock_mcp")

server = MCPServer(
    name="roborock",
    instructions=(
        "Read the vacuum's state and start or stop a clean. "
        "Every tool answers with an object carrying `ok`; when `ok` is false, "
        "read `error` and treat the robot as unavailable rather than retrying."
    ),
)

_connect_lock = asyncio.Lock()
_manager: DeviceManager | None = None
_device: RoborockDevice | None = None


def _pick(devices: list[RoborockDevice]) -> RoborockDevice | None:
    """Choose the robot named in ROBOROCK_DEVICE_NAME, else the only one."""
    if not devices:
        return None
    wanted = (os.environ.get("ROBOROCK_DEVICE_NAME") or "").strip().lower()
    if wanted:
        for device in devices:
            if wanted in device.name.lower():
                return device
        return None
    return devices[0]


async def _get_device() -> RoborockDevice:
    global _manager, _device

    async with _connect_lock:
        if _device is not None and _device.is_connected:
            return _device

        username = os.environ.get("ROBOROCK_USERNAME")
        password = os.environ.get("ROBOROCK_PASSWORD")
        if not username or not password:
            raise RuntimeError("ROBOROCK_USERNAME and ROBOROCK_PASSWORD must be set")

        api = RoborockApiClient(username)
        user_data = await api.pass_login(password)
        _manager = await create_device_manager(
            UserParams(username=username, user_data=user_data, base_url=api.base_url)
        )

        device = _pick(await _manager.get_devices())
        if device is None:
            wanted = os.environ.get("ROBOROCK_DEVICE_NAME")
            raise RuntimeError(
                f"no Roborock device matching {wanted!r} on this account"
                if wanted
                else "no Roborock devices on this account"
            )

        if not device.is_connected:
            await device.connect()
        _device = device
        return device


async def _v1(device: RoborockDevice) -> Any:
    props = device.v1_properties
    if props is None:
        raise RuntimeError(f"{device.name} is not a V1 vacuum; this server only speaks V1")
    return props


def _failure(error: Exception) -> dict[str, Any]:
    _LOGGER.warning("roborock call failed: %s", error)
    return {"ok": False, "error": f"{type(error).__name__}: {error}"}


def _last_clean(record: Any) -> dict[str, Any] | None:
    if record is None:
        return None
    finished = getattr(record, "end_datetime", None)
    days_ago = None
    if finished is not None:
        days_ago = round((dt.datetime.now(dt.UTC) - finished).total_seconds() / 86400, 2)
    duration = getattr(record, "duration", None)
    return {
        "finished_at": finished.isoformat() if finished else None,
        "days_ago": days_ago,
        "area_sqm": getattr(record, "square_meter_area", None),
        "duration_minutes": round(duration / 60) if duration else None,
        "completed": bool(getattr(record, "complete", 0)),
    }


def _name(value: Any) -> str | None:
    if value is None:
        return None
    return getattr(value, "name", None) or str(value)


@server.tool(
    name="get_status",
    description=(
        "Current state of the vacuum: battery percent, what it is doing, any error, "
        "and when it last finished a clean (with days_ago)."
    ),
)
async def get_status() -> dict[str, Any]:
    try:
        device = await _get_device()
        props = await _v1(device)
        await props.status.refresh()
        status = props.status

        last_clean: dict[str, Any] | None = None
        try:
            await props.clean_summary.refresh()
            last_clean = _last_clean(props.clean_summary.last_clean_record)
        except RoborockException as error:  # the robot answers status but not history
            _LOGGER.warning("clean summary unavailable: %s", error)

        error_code = getattr(status, "error_code", None)
        return {
            "ok": True,
            "device": {
                "name": device.name,
                "model": getattr(device.product, "model", None),
                "duid": device.duid,
            },
            "battery": getattr(status, "battery", None),
            "state": _name(getattr(status, "state", None)),
            "in_cleaning": bool(getattr(status, "in_cleaning", 0)),
            "charging": _name(getattr(status, "charge_status", None)),
            "error": _name(getattr(status, "error_code_name", None)) if error_code else None,
            "last_clean": last_clean,
        }
    except (RoborockException, RuntimeError, OSError, asyncio.TimeoutError) as error:
        return _failure(error)


@server.tool(
    name="start_clean",
    description="Start a full clean of the home. Returns ok:true once the robot accepted the command.",
)
async def start_clean() -> dict[str, Any]:
    try:
        device = await _get_device()
        props = await _v1(device)
        await props.command.send(RoborockCommand.APP_START)
        return {"ok": True, "action": "start_clean", "device": device.name}
    except (RoborockException, RuntimeError, OSError, asyncio.TimeoutError) as error:
        return _failure(error)


@server.tool(
    name="stop_clean",
    description="Stop the current clean. By default the robot is also sent back to its dock.",
)
async def stop_clean(return_to_dock: bool = True) -> dict[str, Any]:
    try:
        device = await _get_device()
        props = await _v1(device)
        await props.command.send(RoborockCommand.APP_STOP)
        if return_to_dock:
            await props.command.send(RoborockCommand.APP_CHARGE)
        return {
            "ok": True,
            "action": "stop_clean",
            "returned_to_dock": return_to_dock,
            "device": device.name,
        }
    except (RoborockException, RuntimeError, OSError, asyncio.TimeoutError) as error:
        return _failure(error)


def main() -> None:
    logging.basicConfig(level=os.environ.get("ROBOROCK_MCP_LOG", "WARNING"))
    server.run(transport="stdio")


if __name__ == "__main__":
    main()
