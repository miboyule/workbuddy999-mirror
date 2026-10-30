"""Install the three WorkBuddy virtual hosts after backing up existing config."""
from pathlib import Path
import shutil
import subprocess
import sys
import time

target = Path('/www/server/panel/vhost/nginx/workbuddy999.top.conf')
tls = '--https' in sys.argv or '--bootstrap' in sys.argv
certificate = Path('/opt/workbuddy-prod/bootstrap-tls' if '--bootstrap' in sys.argv else '/etc/letsencrypt/live/workbuddy999.top')
if tls and not (certificate / 'fullchain.pem').is_file():
    raise SystemExit('TLS certificate is missing')
blocks = []
for domain, port in [('www.workbuddy999.top', 8088), ('api.workbuddy999.top', 8787), ('yeradminer.workbuddy999.top', 3002)]:
    challenge = '''location ^~ /.well-known/acme-challenge/ {
        root /www/server/nginx/html;
        default_type text/plain;
        try_files $uri =404;
    }'''
    proxy = f'''location / {{
        proxy_pass http://127.0.0.1:{port};
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Connection "";
        proxy_buffering off;
        proxy_read_timeout 300s;
        proxy_send_timeout 300s;
        client_max_body_size 50m;
    }}'''
    blocks.append(f'''server {{
    listen 80;
    server_name {domain};
    {challenge}
    {'location / { return 301 https://$host$request_uri; }' if tls else proxy}
}}
''')
    if tls:
        blocks.append(f'''server {{
    listen 443 ssl;
    http2 on;
    server_name {domain};
    ssl_certificate {certificate}/fullchain.pem;
    ssl_certificate_key {certificate}/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    add_header X-Content-Type-Options nosniff always;
    add_header X-WorkBuddy-Deployment credit-20261027 always;
    {challenge}
    {proxy}
}}
''')
original = target.read_bytes() if target.exists() else None
if original is not None:
    shutil.copy2(target, Path('/var/backups/workbuddy') / ('workbuddy-nginx-' + str(time.time_ns()) + '.conf'))
target.write_text('\n'.join(blocks))
check = subprocess.run(['nginx', '-t'], capture_output=True, text=True)
if check.returncode:
    if original is None:
        target.unlink()
    else:
        target.write_bytes(original)
    raise SystemExit(check.stderr)
subprocess.run(['systemctl', 'reload', 'chengyao-nginx'], check=True)
print('WorkBuddy virtual hosts installed; HTTPS=' + str(tls))
