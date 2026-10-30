#!/usr/bin/env bash
set -euo pipefail
region="${1:-global}"
api_url="${WORKBUDDY_API_URL:-https://api.workbuddy999.top/v1}"
api_key="${WORKBUDDY_API_KEY:-}"
if [[ -z "$api_key" ]]; then read -r -s -p 'API Key: ' api_key; echo; fi
api_url="${api_url%/}"
if [[ -z "$api_url" || -z "$api_key" ]]; then echo '接口地址和 API Key 不能为空。' >&2; exit 1; fi
if [[ "$(basename "$0")" == codebuddy-* ]]; then
  if [[ "$region" == cn ]]; then config_dir="$HOME/.codebuddycn"; else config_dir="$HOME/.codebuddy"; fi
else config_dir="$HOME/.workbuddy"; fi
config_path="${WORKBUDDY_CONFIG_PATH:-$config_dir/models.json}"
umask 077
mkdir -p "$(dirname "$config_path")"
python3 - "$api_url" "$api_key" "$config_path" "${WORKBUDDY_CATALOG_URL:-https://www.workbuddy999.top/api/portal/setup/catalog}" <<'PY'
import json, os, shutil, sys, tempfile, urllib.request
from urllib.parse import urlsplit
api_url, api_key, config_path, catalog_url = sys.argv[1:]
try:
    req=urllib.request.Request(api_url+'/models', headers={'Authorization':'Bearer '+api_key, 'Accept':'application/json'})
    with urllib.request.urlopen(req, timeout=30) as r: payload=json.load(r)
except Exception as exc:
    raise SystemExit(f'读取模型失败，未修改配置：{exc}')
items=payload.get('data') or payload.get('models') or []
ids=[]
for item in items:
    value=item if isinstance(item,str) else item.get('id')
    if value and value not in ids: ids.append(str(value))
if not ids: raise SystemExit('接口没有返回可用模型 ID，未修改配置。')
try:
    with urllib.request.urlopen(catalog_url, timeout=30) as response: catalog=json.load(response)
except Exception as exc:
    raise SystemExit(f'模型能力清单不可用，未修改配置：{exc}')
if not catalog.get('success') or not isinstance(catalog.get('data',{}).get('models'),list):
    raise SystemExit('模型能力清单不可用，未修改配置。')
available=set(ids)
selected=[model for model in catalog['data']['models'] if model.get('id') in available]
if not selected: raise SystemExit('渠道模型与能力清单不一致，未修改配置。')
root={'models':[]}
if os.path.exists(config_path):
    try:
        with open(config_path,encoding='utf-8-sig') as f: root=json.load(f)
    except Exception: raise SystemExit('现有配置不是有效 JSON，已停止且未覆盖。')
    if not isinstance(root,(dict,list)): raise SystemExit('现有配置必须是 JSON 对象或数组，已停止。')
    stamp=__import__('datetime').datetime.now().strftime('%Y%m%d-%H%M%S')
    backup=config_path+'.'+stamp+'.backup'; shutil.copy2(config_path,backup)
else: backup=''
managed={model['id'] for model in selected}
previous=root if isinstance(root,list) else root.get('models',[])
def service_identity(raw):
    value=str(raw or '').rstrip('/')
    if value.endswith('/chat/completions'): value=value[:-len('/chat/completions')]
    parsed=urlsplit(value)
    if parsed.hostname in ('www.workbuddy999.top','api.workbuddy999.top') and parsed.path=='/v1':
        return 'https://api.workbuddy999.top/v1'
    return value
for model in previous:
    if isinstance(model,dict) and model.get('id') in managed and service_identity(model.get('url'))!=service_identity(api_url):
        raise SystemExit(f"模型 {model['id']} 已用于其他供应商；客户端不支持不同供应商使用相同 ID。已停止安装并保留原配置，请改选模型或使用 ZCode/DSH/Hermes。")
configured=[]
for model in selected:
    entry=next((dict(old) for old in previous if isinstance(old,dict) and old.get('id')==model['id']),{})
    entry.update({'id':model['id'],'name':model['name'],'vendor':'Custom','url':api_url+'/chat/completions','apiKey':api_key,'useCustomProtocol':False})
    for field in ('supportsToolCall','supportsImages','supportsReasoning','onlyReasoning','reasoning','maxInputTokens','maxOutputTokens'):
        if model.get(field) is not None: entry[field]=model[field]
    configured.append(entry)
configured.extend(model for model in previous if not isinstance(model,dict) or model.get('id') not in managed)
if isinstance(root,list): root=configured
else: root['models']=configured
fd,tmp=tempfile.mkstemp(prefix='.models.',dir=os.path.dirname(config_path)); os.close(fd)
try:
    with open(tmp,'w',encoding='utf-8') as f: json.dump(root,f,ensure_ascii=False,indent=2); f.write('\n')
    os.chmod(tmp,0o600)
    os.replace(tmp,config_path)
finally:
    if os.path.exists(tmp): os.unlink(tmp)
print(f'已写入 {len(selected)} 个模型：{config_path}')
if backup: print(f'原配置备份：{backup}')
print('请重启客户端，并在模型菜单选择自定义模型。')
PY
