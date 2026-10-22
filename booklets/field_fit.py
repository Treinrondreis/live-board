"""Optional bounded font shrinking, shared by checks and PDF drawing."""
import math
from reportlab.pdfbase import pdfmetrics


def validate(field):
    original=float(field.get('size',11))
    if not math.isfinite(original) or not 6<=original<=72:raise ValueError('Lettergrootte moet tussen 6 en 72 pt liggen.')
    enabled=field.get('autoFit',False)
    if type(enabled) is not bool:raise ValueError('Kies wel of niet automatisch verkleinen voor dit veld.')
    if enabled and field.get('type','field') not in ('field','text','prefilled'):
        raise ValueError('Automatisch verkleinen is alleen beschikbaar voor tekst en invulvelden.')
    if 'minSize' in field:
        minimum=field['minSize']
        if isinstance(minimum,bool) or not isinstance(minimum,(int,float)) or not math.isfinite(minimum) or not 6<=minimum<=72:
            raise ValueError('De minimale lettergrootte moet tussen 6 en 72 pt liggen.')
        if enabled and minimum>float(field.get('size',11)):
            raise ValueError('De minimale lettergrootte mag niet groter zijn dan de ingestelde lettergrootte.')


def fit(field,measure):
    """Choose the largest fitting size on a 0.25 pt grid, including the exact minimum."""
    validate(field)
    original=float(field.get('size',11));minimum=float(field.get('minSize',min(8,original)))
    def result(size,measured):
        return {**measured,'size':size,'originalSize':original,'minimumSize':minimum,'shrunk':size<original,'autoFit':field.get('autoFit',False)}
    normal=measure(original)
    if normal['fits'] or not field.get('autoFit',False) or minimum==original:return result(original,normal)
    smallest=measure(minimum)
    if not smallest['fits']:return result(minimum,smallest)
    best=result(minimum,smallest);low=1;high=math.ceil((original-minimum)/.25)-1
    while low<=high:
        middle=(low+high)//2;size=original-middle*.25;measured=measure(size)
        if measured['fits']:
            best=result(size,measured);high=middle-1
        else:low=middle+1
    return best


def plain(field,value,width,height,font):
    lines=value.splitlines()
    def measure(size):
        needed=len(lines)*size*1.5
        width_ok=all(pdfmetrics.stringWidth(line,font,size)<=width for line in lines)
        return {'lines':lines,'needed':needed,'widthFits':width_ok,'fits':needed<=height and width_ok}
    return fit(field,measure)