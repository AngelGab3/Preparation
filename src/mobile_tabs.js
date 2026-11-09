/* Pestañas de móvil: en pantallas ≤760 px los paneles orbitales se ocultan y se abren
   uno a la vez como hoja inferior. En escritorio las pestañas no se muestran y el
   layout de paneles no cambia. */

const CLASSES = { route: 'm-route', layers: 'm-layers' };

export function initMobileTabs() {
  const tabs = document.querySelectorAll('.mobile-tab');
  if (!tabs.length) return;

  const open = (name) => {
    Object.entries(CLASSES).forEach(([key, cls]) => {
      document.body.classList.toggle(cls, key === name);
    });
    tabs.forEach((t) => t.setAttribute('aria-expanded', String(t.dataset.panel === name)));
  };

  tabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      const isOpen = document.body.classList.contains(CLASSES[tab.dataset.panel]);
      open(isOpen ? null : tab.dataset.panel);
    });
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') open(null);
  });
}
