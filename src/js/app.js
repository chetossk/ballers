/* ==== Toggle del menú (hamburguesa) en móvil ==== */
// Ajustado para que use el ID "main-nav" que pusimos en el HTML
const btnToggle = document.querySelector('.nav__toggle');
const nav = document.querySelector('#main-nav');

if (btnToggle && nav) {
  btnToggle.addEventListener('click', () => {
    const open = nav.classList.toggle('open');
    btnToggle.setAttribute('aria-expanded', String(open));
  });

  // Cerrar el panel cuando se hace clic en un enlace (en móvil)
  nav.addEventListener('click', (e) => {
    if (e.target.matches('a') && nav.classList.contains('open')) {
      nav.classList.remove('open');
      btnToggle.setAttribute('aria-expanded', 'false');
    }
  });
}

/* ==== Submenú "Panel/Documentación" ==== */
const subToggle = document.querySelector('.submenu__toggle');
const subMenu   = document.querySelector('.submenu');

if (subToggle && subMenu) {
  const closeSubmenu = () => {
    subMenu.classList.remove('open');
    subToggle.setAttribute('aria-expanded', 'false');
  };

  subToggle.addEventListener('click', (e) => {
    e.stopPropagation();
    const isOpen = subMenu.classList.toggle('open');
    subToggle.setAttribute('aria-expanded', String(isOpen));
  });

  // Cerrar al hacer clic fuera
  document.addEventListener('click', (e) => {
    if (!subMenu.contains(e.target) && !subToggle.contains(e.target)) {
      closeSubmenu();
    }
  });

  // Cerrar con Escape
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeSubmenu();
  });
}

/* ==== Chips de filtros (Visual y Lógica) ==== */
document.querySelectorAll('.chip').forEach(chip => {
  chip.addEventListener('click', () => {
    // Quita la clase activa de todos los chips
    document.querySelectorAll('.chip').forEach(c => c.classList.remove('is-active'));
    // La pone en el clickeado
    chip.classList.add('is-active');
    
    // Aquí puedes añadir la lógica de filtrado más adelante:
    const categoria = chip.textContent.toLowerCase();
    console.log(`Filtrando por: ${categoria}`);
  });
});

/* ==== Lógica de Roles y Sesión (Integrada) ==== */
function checkAuth() {
    const role = localStorage.getItem('ballers_role');
    const navUser = document.getElementById('nav-user');
    const navAdmin = document.getElementById('nav-admin');
    const userView = document.getElementById('user-view');
    const adminView = document.getElementById('admin-view');
    const btnLogin = document.getElementById('btn-login');
    const btnLogout = document.getElementById('btn-logout');

    // Resetear vistas
    [navUser, navAdmin, userView, adminView, btnLogin, btnLogout].forEach(el => {
        if(el) el.classList.add('hidden');
    });

    if (role === 'admin' || role === 'empleado') {
        if(adminView) adminView.classList.remove('hidden');
        if(navAdmin) navAdmin.classList.remove('hidden');
        if(btnLogout) btnLogout.classList.remove('hidden');
        
        const label = document.getElementById('admin-label');
        if(label) label.innerText = role === 'admin' ? "Panel Admin" : "Panel Empleado";
    } else {
        if(userView) userView.classList.remove('hidden');
        if(navUser) navUser.classList.remove('hidden');
        
        if (role === 'cliente') {
            if(btnLogout) btnLogout.classList.remove('hidden');
        } else {
            if(btnLogin) btnLogin.classList.remove('hidden');
        }
    }
}

// Función global para Logout
window.logout = function() {
    localStorage.removeItem('ballers_role');
    window.location.reload();
};

// Ejecutar al cargar
document.addEventListener('DOMContentLoaded', checkAuth);