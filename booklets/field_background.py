"""Optional text backing; alpha applies to the backing, never to the text."""
import math, re

def validate(field):
    color=field.get('backgroundColor')
    if color is None or color=='':return
    if not isinstance(color,str) or not re.fullmatch(r'#[0-9a-fA-F]{6}',color):raise ValueError('Ongeldige achtergrondkleur.')
    opacity=field.get('backgroundOpacity',.5)
    if isinstance(opacity,bool) or not isinstance(opacity,(int,float)) or not math.isfinite(opacity) or not 0<=opacity<=1:raise ValueError('Achtergronddekking moet tussen 0 en 100% liggen.')
    if type(field.get('backgroundFullWidth',False)) is not bool:raise ValueError('Ongeldige instelling voor achtergrondbreedte.')

def draw(cv,field,page_width,page_height):
    validate(field)
    if not field.get('backgroundColor'):return
    full=field.get('backgroundFullWidth',False)
    x=0 if full else page_width*float(field['x'])/100
    width=page_width if full else page_width*float(field['w'])/100
    height=page_height*float(field['h'])/100
    y=page_height*(1-float(field['y'])/100)-height
    cv.saveState()
    cv.setFillColor(field['backgroundColor'])
    cv.setFillAlpha(field.get('backgroundOpacity',.5))
    cv.rect(x,y,width,height,fill=1,stroke=0)
    cv.restoreState()
