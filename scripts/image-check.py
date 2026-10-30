from PIL import Image,ImageOps,ImageDraw
from pathlib import Path
logo=Image.open('public/brand/workbuddy.png'); print('Logo:',logo.size); logo.thumbnail((500,160));logo.save('docs/reference/logo-preview.png')
files=list(Path('public/tutorials').glob('*.png')); sheet=Image.new('RGB',(1200,((len(files)+2)//3)*270),'#eeeeee'); d=ImageDraw.Draw(sheet)
for i,p in enumerate(files):
 im=Image.open(p).convert('RGB'); im.thumbnail((380,235));x=(i%3)*400;y=(i//3)*270;sheet.paste(im,(x,y));d.text((x+3,y+238),p.name,fill='#111111')
sheet.save('docs/reference/tutorial-contact-sheet.jpg')
