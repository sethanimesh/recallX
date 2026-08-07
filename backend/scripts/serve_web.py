"""Static Expo preview with extensionless route refresh support and local assets."""
import argparse
from functools import partial
from http.server import SimpleHTTPRequestHandler,ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit,unquote

class Handler(SimpleHTTPRequestHandler):
    def do_GET(self):
        route=unquote(urlsplit(self.path).path)
        resolved=Path(self.translate_path(route))
        if not resolved.exists() and not Path(route).suffix:
            candidate=Path(str(resolved)+'.html')
            self.path=route+'.html' if candidate.is_file() else '/index.html'
        return super().do_GET()

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--port',type=int,default=8082);parser.add_argument('--host',default='127.0.0.1');parser.add_argument('--directory',default=str(Path(__file__).resolve().parents[2]/'dist'));args=parser.parse_args()
    ThreadingHTTPServer((args.host,args.port),partial(Handler,directory=args.directory)).serve_forever()
