// Local demonstration only: no service calls, writes or persisted preferences.
const root = document.querySelector('.tr-ui');
const menu = document.querySelector('.tr-menu-button');
const smallScreen = matchMedia('(max-width: 850px)');
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
document.querySelectorAll('.tr-nav a').forEach(link => link.addEventListener('click', () => {
  // Move focus to the target before hiding the mobile navigation.
  const target = document.querySelector(link.getAttribute('href'));
  if (smallScreen.matches && target) {
    target.setAttribute('tabindex', '-1'); target.focus({preventScroll: true}); closeMenu();
  }
}));
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
