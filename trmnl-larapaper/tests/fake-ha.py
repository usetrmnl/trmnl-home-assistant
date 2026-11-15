#!/usr/bin/env python3
"""A stand-in for Home Assistant's REST API for smoke.test.sh: answers every request
with what it received (method, path, Authorization header, body) as JSON.

Usage: fake-ha.py [port]   (default 8123)
"""
import json
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


class Echo(BaseHTTPRequestHandler):
    def answer(self):
        length = int(self.headers.get("Content-Length") or 0)
        body = self.rfile.read(length).decode() if length else ""
        out = json.dumps({
            "method": self.command,
            "path": self.path,
            "auth": self.headers.get("Authorization", ""),
            "body": body,
        }).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(out)))
        self.end_headers()
        self.wfile.write(out)

    do_GET = do_POST = answer

    def log_message(self, *args):
        pass


ThreadingHTTPServer(("0.0.0.0", int(sys.argv[1]) if len(sys.argv) > 1 else 8123), Echo).serve_forever()
