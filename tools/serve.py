# Serve Work/ for Dev Mode and the tunnel: like `python -m http.server`, but every response says
# Cache-Control: no-cache, so browsers check for a newer file each load (a 304 when unchanged)
# instead of mixing a cached old main.js with new files after an update.
#   python tools\serve.py [port]        (default 8783, bound to 127.0.0.1)
import functools
import http.server
import os
import sys


class Handler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-cache")
        super().end_headers()

    def log_message(self, fmt, *args):
        pass


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8783
    root = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "Work")
    handler = functools.partial(Handler, directory=os.path.normpath(root))
    # the stock listen backlog is 5; the game asks for ~20 files at once, and the extra connections
    # were refused (ERR_CONNECTION_REFUSED, then "RR.Items is not a constructor" on 2026-10-12)
    http.server.ThreadingHTTPServer.request_queue_size = 64
    http.server.ThreadingHTTPServer(("127.0.0.1", port), handler).serve_forever()
