"""Flow one personal text block through a fixed one- or two-column box."""
import math
import field_fit
from collections import deque
from book_layout import rich_layout,draw_rich

def validate(field):
    columns=field.get('columns',1)
    if type(columns) is not int or columns not in (1,2):raise ValueError('Kies één of twee kolommen voor het tekstblok.')
    if columns==2 and field.get('type') not in ('text','prefilled'):raise ValueError('Twee kolommen zijn alleen beschikbaar voor tekstblokken.')
    for key,default,minimum,maximum in [('columnGapMm',8,0,30),('lineSpacing',1.5,1,3)]:
        value=field.get(key,default)
        if isinstance(value,bool) or not isinstance(value,(int,float)) or not math.isfinite(value) or not minimum<=value<=maximum:raise ValueError('Ongeldige kolomafstand of regelafstand.')

def layout(field,template,values,width,height,token,font,align):
    return field_fit.fit(field,lambda size:_layout({**field,'size':size},template,values,width,height,token,font,align))


def _layout(field,template,values,width,height,token,font,align):
    validate(field)
    count=field.get('columns',1);gap=field.get('columnGapMm',8)*72/25.4 if count==2 else 0
    column_width=(width-gap)/count
    if column_width<12:raise ValueError('Het tekstblok is te smal voor de gekozen kolommen en tussenruimte.')
    size=float(field.get('size',11))
    items=rich_layout(template,values,column_width,size,field.get('color','#172d35'),token,font,align,field.get('lineSpacing',1.5))
    total=sum(h for _,h in items)
    if count==1:return {'columns':[items],'width':column_width,'gap':0,'fits':total<=height+1e-6,'needed':total}
    pending=deque(items);columns=[];used_heights=[]
    for _ in range(count):
        used=0;placed=[]
        while pending:
            paragraph,required=pending[0];remaining=max(0,height-used)
            if required<=remaining+1e-6:
                pending.popleft();placed.append((paragraph,required));used+=required;continue
            if paragraph is None:
                # A blank line at the boundary does not indent the next column.
                pending.popleft();break
            parts=paragraph.split(column_width,remaining)
            if not parts:break
            pending.popleft()
            head=parts[0];_,head_height=head.wrap(column_width,100000)
            if head_height>remaining+1e-6:raise ValueError('De tekst kan niet binnen deze kolom worden verdeeld.')
            placed.append((head,head_height));used+=head_height
            for part in reversed(parts[1:]):
                _,part_height=part.wrap(column_width,100000);pending.appendleft((part,part_height))
            break
        columns.append(placed);used_heights.append(used)
    return {'columns':columns,'width':column_width,'gap':gap,'fits':not pending,'needed':max([total/count,*used_heights])}

def draw(cv,result,x,top):
    if not result['fits']:raise ValueError('De tekst past niet in de twee kolommen. Verkort de tekst of vergroot het tekstvlak.')
    for index,items in enumerate(result['columns']):draw_rich(cv,items,x+index*(result['width']+result['gap']),top,result['width'])
