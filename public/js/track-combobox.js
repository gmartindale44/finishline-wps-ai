// public/js/track-combobox.js - Type-ahead combobox for track selection

const MIN_CHARS = 1;
const DEBOUNCE_MS = 120;
const API_CACHE_TTL = 30 * 1000; // mirror server-side query cache

const normText = (s) =>
  (s ?? '')
    .toString()
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^a-z0-9\s]/g, '')
    .trim();

export function mountTrackCombobox(inputEl, { onChange } = {}) {
  const wrapper = document.createElement('div');
  wrapper.className = 'fl-combobox';
  inputEl.parentNode.insertBefore(wrapper, inputEl);
  wrapper.appendChild(inputEl);

  const helper = document.createElement('div');
  helper.className = 'fl-combobox-helper';
  helper.textContent = 'Type to search tracks…';
  helper.setAttribute('aria-live', 'polite');
  wrapper.appendChild(helper);

  const list = document.createElement('div');
  list.className = 'fl-combobox-list fl-combobox-hidden';
  wrapper.appendChild(list);

  let recent = loadRecent();
  let activeIndex = -1;
  let currentItems = [];
  let inflightToken = 0;

  const apiCache = new Map();

  function loadRecent() {
    try {
      return JSON.parse(localStorage.getItem('fl_recent_tracks') || '[]');
    } catch {
      return [];
    }
  }

  function saveRecent(name) {
    if (!name) return;
    const set = [name, ...recent.filter((r) => r !== name)].slice(0, 5);
    recent = set;
    localStorage.setItem('fl_recent_tracks', JSON.stringify(set));
  }

  const debounce = (fn, wait) => {
    let timer;
    return (...args) => {
      clearTimeout(timer);
      timer = setTimeout(() => fn(...args), wait);
    };
  };

  const fetchSuggestions = async (query) => {
    const normalized = normText(query);
    if (!normalized || normalized.length < MIN_CHARS) return [];

    const now = Date.now();
    const hit = apiCache.get(normalized);
    if (hit && hit.expires > now) {
      return hit.data;
    }

    try {
      const res = await fetch(`/api/tracks?q=${encodeURIComponent(query)}`, {
        headers: { Accept: 'application/json' },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      const data = Array.isArray(json) ? json : [];
      apiCache.set(normalized, { data, expires: now + API_CACHE_TTL });
      return data;
    } catch (err) {
      console.error('[track-combobox] fetch failed', err);
      apiCache.set(normalized, { data: [], expires: now + API_CACHE_TTL });
      return [];
    }
  };

  function renderList({ query = '', matches = [], showRecent = false }) {
    list.innerHTML = '';
    const fragment = document.createDocumentFragment();
    currentItems = [];

    if (showRecent && recent.length) {
      const header = document.createElement('div');
      header.className = 'fl-combobox-section';
      header.textContent = 'Recent';
      fragment.appendChild(header);
      recent.forEach((name) => {
        const item = document.createElement('div');
        item.className = 'fl-combobox-item';
        item.textContent = name;
        item.dataset.value = name;
        fragment.appendChild(item);
      });
      currentItems.push(...recent);
    }

    if (matches.length) {
      const header = document.createElement('div');
      header.className = 'fl-combobox-section';
      header.textContent = showRecent && recent.length ? 'Matches' : 'Tracks';
      fragment.appendChild(header);

      matches.forEach((name) => {
        const item = document.createElement('div');
        item.className = 'fl-combobox-item';
        item.textContent = name;
        item.dataset.value = name;
        fragment.appendChild(item);
      });
      currentItems.push(...matches);
    }

    list.appendChild(fragment);
    list.classList.toggle('fl-combobox-hidden', list.children.length === 0);
    activeIndex = -1;
  }

  function commit(value) {
    const trimmed = (value || '').toString().trim();
    inputEl.value = trimmed;
    list.classList.add('fl-combobox-hidden');
    if (trimmed) saveRecent(trimmed);
    if (onChange) onChange(trimmed);
  }

  const performLookup = async () => {
    const raw = inputEl.value || '';
    const trimmed = raw.trim();

    if (!trimmed || normText(trimmed).length < MIN_CHARS) {
      renderList({ showRecent: true });
      return;
    }

    const token = ++inflightToken;
    const matches = await fetchSuggestions(trimmed);
    if (token !== inflightToken) return;

    if (!matches.length) {
      renderList({ query: trimmed, matches: [] });
      list.classList.add('fl-combobox-hidden');
      return;
    }

    renderList({ query: trimmed, matches });
  };

  const debouncedLookup = debounce(performLookup, DEBOUNCE_MS);

  inputEl.addEventListener('input', debouncedLookup);
  inputEl.addEventListener('focus', () => {
    const currentVal = inputEl.value || '';
    if (normText(currentVal).length >= MIN_CHARS) {
      performLookup();
    } else {
      renderList({ showRecent: true });
    }
  });

  inputEl.addEventListener('blur', () => {
    setTimeout(() => list.classList.add('fl-combobox-hidden'), 150);
  });

  list.addEventListener('mousedown', (event) => {
    const target = event.target.closest('.fl-combobox-item');
    if (!target) return;
    event.preventDefault();
    commit(target.dataset.value);
  });

  inputEl.addEventListener('keydown', (event) => {
    const items = Array.from(list.querySelectorAll('.fl-combobox-item'));
    if (!items.length) return;

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      activeIndex = Math.min(items.length - 1, activeIndex + 1);
      items.forEach((el, idx) => el.setAttribute('aria-selected', idx === activeIndex));
      items[activeIndex].scrollIntoView({ block: 'nearest' });
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      activeIndex = Math.max(0, activeIndex - 1);
      items.forEach((el, idx) => el.setAttribute('aria-selected', idx === activeIndex));
      items[activeIndex].scrollIntoView({ block: 'nearest' });
    } else if (event.key === 'Enter') {
      event.preventDefault();
      if (activeIndex >= 0) {
        commit(items[activeIndex].dataset.value);
      } else {
        commit(inputEl.value);
      }
    } else if (event.key === 'Escape') {
      list.classList.add('fl-combobox-hidden');
    }
  });

  renderList({ showRecent: true });
}

