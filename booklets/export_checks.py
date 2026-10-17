"""Cooperative cancellation of a read-only export preflight, never a saved PDF."""
import re, threading, time
from contextlib import contextmanager

LOCK=threading.Lock()
ACTIVE={}
CANCELLED={}
LOCAL=threading.local()


def prune():
    now=time.monotonic()
    for value,deadline in list(CANCELLED.items()):
        if deadline<now:CANCELLED.pop(value,None)
    while len(CANCELLED)>128:CANCELLED.pop(next(iter(CANCELLED)))


def identifier(value):
    if not isinstance(value,str) or not re.fullmatch('[a-f0-9]{32}',value):raise ValueError('Ongeldige PDF-controle.')
    return value


@contextmanager
def begin(value=None):
    if value is None:
        yield
        return
    value=identifier(value);event=threading.Event()
    with LOCK:
        prune()
        if value in ACTIVE:raise ValueError('Deze PDF-controle loopt al.')
        if value in CANCELLED:event.set()
        ACTIVE[value]=event
    previous=getattr(LOCAL,'event',None);LOCAL.event=event
    try:
        check();yield
    finally:
        LOCAL.event=previous
        with LOCK:ACTIVE.pop(value,None)


def cancel(value):
    value=identifier(value)
    with LOCK:
        CANCELLED[value]=time.monotonic()+300
        prune()
        if value in ACTIVE:ACTIVE[value].set()
    return {'ok':True}


def check():
    event=getattr(LOCAL,'event',None)
    if event and event.is_set():raise ValueError('PDF-controle gestopt. U kunt opnieuw controleren en genereren.')
