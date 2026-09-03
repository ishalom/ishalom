"""MCP server that wraps python-roborock.

Roborock has no official MCP server, so this is the thin wrapper the
architecture rules call for: the assistant never talks to the robot's API, it
talks to this server.
"""

from .server import server

__all__ = ["server"]
