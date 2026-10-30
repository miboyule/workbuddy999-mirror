from PIL import Image,ImageDraw,ImageFont
from pathlib import Path
import json
logo=Image.open('public/brand/workbuddy.png')
logo.crop((0,0,560,560)).resize((256,256)).save('public/brand/workbuddy-icon.png')
# Replace example credentials in the reference image with a non-secret placeholder.
p=Path('public/tutorials/workbuddy-manual-3-fill.png');im=Image.open(p).convert('RGB'); d=ImageDraw.Draw(im);w,h=im.size
font=ImageFont.truetype('C:/Windows/Fonts/arial.ttf',25)
for box,text in [((.265,.415,.535,.445),'sk-YOUR-API-KEY'),((.265,.324,.44,.35),'https://www.workbuddy999.top/v1')]:
 x1,y1,x2,y2=box;d.rectangle((int(x1*w),int(y1*h),int(x2*w),int(y2*h)),fill='white');d.text((int(x1*w),int(y1*h)),text,fill='#222222',font=font)
im.save(p)
legal={}
for name in ['terms','privacy']:
 data=json.loads(Path('docs/reference/'+name+'.json').read_text(encoding='utf8'))
 legal[name]=[s for s in data['sections'] if s['tag'] in ['P','H2','UL'] and not s['text'].startswith('另见')]
 for s in legal[name]:
  s['text']=s['text'].replace('WorkBuddy 积分服务','WorkBuddy积分官方充值兑换服务')
Path('src/legal.json').write_text(json.dumps(legal,ensure_ascii=False,indent=2),encoding='utf8')
