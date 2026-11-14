#!/usr/bin/env python3
"""Static server for the game that forbids browser caching (so edited game files are always the ones that run)."""
import http.server, socketserver, sys, os
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8733
os.chdir(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
class H(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0'); self.send_header('Pragma', 'no-cache'); self.send_header('Expires', '0')
        super().end_headers()
    def send_response(self, code, message=None):
        super().send_response(code, message)
    def do_GET(self):
        # never answer 304: drop the conditional headers
        for h in ('If-Modified-Since', 'If-None-Match'):
            if h in self.headers: del self.headers[h]
        super().do_GET()
    def log_message(self, *a): pass
socketserver.ThreadingTCPServer.allow_reuse_address = True
with socketserver.ThreadingTCPServer(('127.0.0.1', PORT), H) as s:
    print(f'Pył i Rdza: http://localhost:{PORT}/index.html  (Ctrl+C = stop)'); s.serve_forever()
