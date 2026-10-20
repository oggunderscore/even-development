import json, subprocess, sys, time, os, urllib.request, signal
HERE = os.path.dirname(os.path.abspath(__file__))
APP = os.path.abspath(os.path.join(HERE, '..', '..'))
OUT = os.environ.get('SHOT_DIR', os.path.join(APP, 'store-assets', 'screenshots'))
os.makedirs(OUT, exist_ok=True)
SIM = 'http://127.0.0.1:9898'

def get(path, base=SIM):
    return urllib.request.urlopen(base + path, timeout=15).read()

def post(path, obj, base=SIM):
    req = urllib.request.Request(base + path, data=json.dumps(obj).encode(), headers={'Content-Type': 'application/json'}, method='POST')
    return urllib.request.urlopen(req, timeout=15).read()

def shot(name):
    png = get('/api/screenshot/glasses')
    path = f'{OUT}/{name}.png'
    open(path, 'wb').write(png)
    return path

def say(lang, text):
    post('/__cmd', {'t': 'say', 'lang': lang, 'text': text}, base='http://127.0.0.1:5173')

def key(action):
    post('/api/input', {'action': action})

class Session:
    def __init__(self, preset):
        open(HERE + '/harness.log', 'w').close()  # git-ignored
        self.server = subprocess.Popen(['node', HERE + '/server.mjs', APP + '/dist', preset], stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
        time.sleep(1)
        env = dict(os.environ, DISPLAY=':0')
        self.sim = subprocess.Popen(['npm', 'run', 'simulator', '--', '--automation-port', '9898'], cwd=APP, env=env, stdout=open(HERE + '/sim.log', 'w'), stderr=subprocess.STDOUT, preexec_fn=os.setsid)
        for _ in range(60):
            try:
                if get('/api/ping') in (b'pong', b'"pong"') or True:
                    break
            except Exception:
                time.sleep(0.5)
        time.sleep(5)
    def stop(self):
        for p in (self.sim,):
            try: os.killpg(os.getpgid(p.pid), signal.SIGTERM)
            except Exception: pass
        self.server.terminate()
        time.sleep(1)
