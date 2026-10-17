// Local demonstration only: no service calls, writes or persisted preferences.
const root = document.querySelector('.tr-ui');
const menu = document.querySelector('.tr-menu-button');
const smallScreen = matchMedia('(max-width: 850px)');
const moduleMenus = {
  seinhuis: {name:'Seinhuis', links:[['Overzicht','overzicht'],['Onderdelen','bediening'],['Recente activiteit','werkoverzicht'],['Toegang en beveiliging','formulieren']]},
  stationschef: {name:'Stationschef', links:[['Overzicht','overzicht'],['Vertrekborden','werkoverzicht'],['Aansluitingen','werkoverzicht'],['Stations','formulieren'],['Instellingen','formulieren']]},
  km: {name:'KM-trein', links:[['Overzicht','overzicht'],['Deelnemers','werkoverzicht'],['Inzendingen','werkoverzicht'],['Liveblog','bediening'],['Wedstrijdoverzicht','statussen']]},
  treinreiziger: {name:'Treinreiziger', links:[['Pagina’s','werkoverzicht'],['Navigatie','bediening'],['Feeds en bronnen','formulieren'],['Voorbeeld','overzicht']]},
  boekjesmaker: {name:'Boekjesmaker', links:[['Boekjes','werkoverzicht'],['Sjablonen','bediening'],['Bouwstenen','formulieren'],['Uitvoer','statussen']]},
  flora: {name:'FloRA', links:[['Meldingen','werkoverzicht'],['Boekingen','werkoverzicht'],['Treinen','werkoverzicht'],['Aansluitingen','werkoverzicht'],['Importeren','formulieren'],['Controleregels','bediening'],['Geschiedenis','statussen']]}
};
const localNavigation = document.querySelector('.tr-nav');
document.querySelectorAll('[data-module]').forEach(link => link.addEventListener('click', event => {
  event.preventDefault();
  const selected = moduleMenus[link.dataset.module];
  document.querySelectorAll('[data-module]').forEach(item => item.removeAttribute('aria-current'));
  link.setAttribute('aria-current','page');
  document.querySelector('#module-title').textContent = selected.name;
  document.querySelector('#module-label').textContent = selected.name + ' · Stijlbasis 1.0';
  localNavigation.setAttribute('aria-label','Menu ' + selected.name);
  localNavigation.replaceChildren(...selected.links.map(([label,id], index) => {
    const item = document.createElement('a'); item.textContent = label; item.href = '#' + id;
    if(index === 0) item.setAttribute('aria-current','page');
    return item;
  }));
  closeMenu();
}));
function closeMenu() {
  const focusWasInMenu = document.querySelector('#onderdelen').contains(document.activeElement);
  root.classList.remove('tr-menu-open');
  menu.setAttribute('aria-expanded', 'false');
  if (focusWasInMenu && smallScreen.matches) menu.focus();
}
menu.addEventListener('click', () => {
  const open = root.classList.toggle('tr-menu-open');
  menu.setAttribute('aria-expanded', String(open));
});
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && root.classList.contains('tr-menu-open')) { closeMenu(); menu.focus(); }
});
localNavigation.addEventListener('click', event => {
  const link = event.target.closest('a');
  if (!link || !localNavigation.contains(link)) return;
  localNavigation.querySelectorAll('a').forEach(item => item.removeAttribute('aria-current'));
  link.setAttribute('aria-current','page');
  // Move focus to the target before hiding the mobile navigation.
  const target = document.querySelector(link.getAttribute('href'));
  if (smallScreen.matches && target) {
    target.setAttribute('tabindex', '-1'); target.focus({preventScroll: true}); closeMenu();
  }
});
smallScreen.addEventListener('change', closeMenu);
const search = document.querySelector('#search');
const status = document.querySelector('#status');
const rows = [...document.querySelectorAll('#example-table tbody tr')];
function filterExamples() {
  const query = search.value.trim().toLocaleLowerCase('nl');
  for (const row of rows) row.hidden = !row.textContent.toLocaleLowerCase('nl').includes(query) || Boolean(status.value && row.dataset.state !== status.value);
  const count = rows.filter(row => !row.hidden).length;
  document.querySelector('#result-count').textContent = count + (count === 1 ? ' voorbeeld' : ' voorbeelden');
  document.querySelector('#empty').hidden = count > 0;
  document.querySelector('.tr-table-wrap').hidden = count === 0;
  document.querySelector('#example-detail').hidden = true;
}
search.addEventListener('input', filterExamples);
status.addEventListener('change', filterExamples);
document.querySelector('#reset-filters').addEventListener('click', () => { search.value = ''; status.value = ''; filterExamples(); search.focus(); });
document.querySelector('#density').addEventListener('click', event => {
  const compact = document.querySelector('#example-table').classList.toggle('tr-table--compact');
  event.currentTarget.setAttribute('aria-pressed', String(compact));
});
document.querySelectorAll('[data-example]').forEach(button => button.addEventListener('click', () => {
  const detail = document.querySelector('#example-detail');
  detail.textContent = button.dataset.example + ' is geopend als fictief voorbeeld. Er zijn geen externe gegevens opgehaald.';
  detail.hidden = false;
}));
document.querySelector('#example-save').addEventListener('click', () => { document.querySelector('#save-feedback').textContent = 'Voorbeeld afgerond. Er zijn geen gegevens opgeslagen.'; });
document.querySelector('#example-cancel').addEventListener('click', () => { document.querySelector('#save-feedback').textContent = 'Voorbeeld geannuleerd.'; });
