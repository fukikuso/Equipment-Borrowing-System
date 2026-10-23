document.addEventListener('DOMContentLoaded', () => {
  // Lucide icons
  if (window.lucide) window.lucide.createIcons();

  // Live global search suggestions
  const searchForm = document.querySelector('.topbar-search');
  const searchInput = searchForm && searchForm.querySelector('input[name="q"]');
  const searchSuggestions = searchForm && searchForm.querySelector('.search-suggestions');
  if (searchInput && searchSuggestions) {
    let searchTimer;
    let activeSearch;

    const closeSuggestions = () => {
      searchSuggestions.hidden = true;
      searchInput.setAttribute('aria-expanded', 'false');
    };

    const showMessage = (message) => {
      searchSuggestions.replaceChildren();
      const item = document.createElement('div');
      item.className = 'search-suggestion-message';
      item.textContent = message;
      searchSuggestions.appendChild(item);
      searchSuggestions.hidden = false;
      searchInput.setAttribute('aria-expanded', 'true');
    };

    searchInput.addEventListener('input', () => {
      window.clearTimeout(searchTimer);
      if (activeSearch) activeSearch.abort();

      const query = searchInput.value.trim();
      if (!query) {
        closeSuggestions();
        return;
      }

      searchTimer = window.setTimeout(async () => {
        activeSearch = new AbortController();
        showMessage('Searching...');

        try {
          const response = await fetch(`/search/suggestions?q=${encodeURIComponent(query)}`, {
            headers: { Accept: 'application/json' },
            signal: activeSearch.signal
          });
          if (!response.ok) throw new Error(`Search failed (${response.status}).`);

          const data = await response.json();
          if (searchInput.value.trim() !== query) return;

          searchSuggestions.replaceChildren();
          if (!data.results.length) {
            showMessage('No matching results.');
            return;
          }

          data.results.forEach((result) => {
            const link = document.createElement('a');
            link.className = 'search-suggestion';
            link.href = result.href;
            link.role = 'option';

            const text = document.createElement('span');
            text.className = 'search-suggestion-text';
            const title = document.createElement('span');
            title.className = 'search-suggestion-title';
            title.textContent = result.title;
            const detail = document.createElement('span');
            detail.className = 'search-suggestion-detail';
            detail.textContent = result.detail;
            text.append(title, detail);

            const type = document.createElement('span');
            type.className = 'search-suggestion-type';
            type.textContent = result.type;
            link.append(text, type);
            searchSuggestions.appendChild(link);
          });

          searchSuggestions.hidden = false;
          searchInput.setAttribute('aria-expanded', 'true');
        } catch (err) {
          if (err.name === 'AbortError') return;
          console.error('[Live Search Error]', err);
          if (searchInput.value.trim() === query) showMessage('Search is temporarily unavailable.');
        }
      }, 180);
    });

    searchInput.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') closeSuggestions();
      if (event.key === 'ArrowDown' && !searchSuggestions.hidden) {
        const firstResult = searchSuggestions.querySelector('a');
        if (firstResult) {
          event.preventDefault();
          firstResult.focus();
        }
      }
    });

    document.addEventListener('click', (event) => {
      if (!searchForm.contains(event.target)) closeSuggestions();
    });
  }

  // Mobile sidebar toggle
  const menuBtn = document.querySelector('.mobile-menu-btn');
  const sidebar = document.querySelector('.sidebar');
  if (menuBtn && sidebar) {
    menuBtn.addEventListener('click', () => sidebar.classList.toggle('open'));
    document.addEventListener('click', (e) => {
      if (sidebar.classList.contains('open') && !sidebar.contains(e.target) && !menuBtn.contains(e.target)) {
        sidebar.classList.remove('open');
      }
    });
  }

  // User dropdown menu
  const userTrigger = document.querySelector('.topbar-user');
  const userMenu = document.querySelector('.user-menu');
  if (userTrigger && userMenu) {
    userTrigger.addEventListener('click', (e) => {
      e.stopPropagation();
      userMenu.classList.toggle('open');
    });
    document.addEventListener('click', () => userMenu.classList.remove('open'));
  }

  // Generic modal open/close via data attributes
  document.querySelectorAll('[data-modal-open]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const modal = document.getElementById(btn.getAttribute('data-modal-open'));
      if (modal) modal.classList.add('open');
    });
  });
  document.querySelectorAll('[data-modal-close]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const modal = btn.closest('.modal-backdrop');
      if (modal) modal.classList.remove('open');
    });
  });
  document.querySelectorAll('.modal-backdrop').forEach((backdrop) => {
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) backdrop.classList.remove('open');
    });
  });

  // Password show/hide toggle
  document.querySelectorAll('.toggle-pass').forEach((btn) => {
    btn.addEventListener('click', () => {
      const input = btn.parentElement.querySelector('input');
      if (!input) return;
      const isPass = input.type === 'password';
      input.type = isPass ? 'text' : 'password';
      btn.innerHTML = isPass
        ? '<i data-lucide="eye" style="width:18px;height:18px"></i>'
        : '<i data-lucide="eye-off" style="width:18px;height:18px"></i>';
      if (window.lucide) window.lucide.createIcons();
    });
  });

  // Auto-dismiss flash alerts
  document.querySelectorAll('.alert[data-autodismiss]').forEach((el) => {
    setTimeout(() => { el.style.transition = 'opacity 0.4s ease'; el.style.opacity = '0'; setTimeout(() => el.remove(), 400); }, 4500);
  });
});
