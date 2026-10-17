const toggle=document.querySelector('.sc-toggle'),sidebar=document.querySelector('#sc-sidebar');
function closeMenu(){document.body.classList.remove('sc-menu-open');toggle.setAttribute('aria-expanded','false');}
toggle.addEventListener('click',()=>{const open=document.body.classList.toggle('sc-menu-open');toggle.setAttribute('aria-expanded',String(open));});
document.addEventListener('keydown',event=>{if(event.key==='Escape'&&document.body.classList.contains('sc-menu-open')){closeMenu();toggle.focus();}});
matchMedia('(max-width: 850px)').addEventListener('change',()=>{const inside=sidebar.contains(document.activeElement);closeMenu();if(inside&&matchMedia('(max-width: 850px)').matches)toggle.focus();});
