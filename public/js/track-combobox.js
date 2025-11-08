// public/js/track-combobox.js - Type-ahead combobox for track selection

export function mountTrackCombobox(inputEl, { onChange } = {}) {
  // Wrap input in a container to position the list
  const wrapper = document.createElement('div');
  wrapper.className = 'fl-combobox';
  inputEl.parentNode.insertBefore(wrapper, inputEl);
  wrapper.appendChild(inputEl);

  // Dropdown element
  const list = document.createElement('div');
  list.className = 'fl-combobox-list fl-combobox-hidden';
  wrapper.appendChild(list);

  // Load tracks and recent
  let tracks = [];
  let recent = loadRecent();

  fetch('/data/tracks.json')
    .then(r => r.json())
    .then(json => { tracks = json || []; })
    .catch(() => { tracks = []; });

  // Helpers
  const debounced = (fn, ms = 150) => {
    let t;
    return (...args) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...args), ms);
    };
  };

  const norm = s => (s || '').toString().trim();
  const fuse = (q, arr) => {
    const needle = q.toLowerCase();
    // Simple contains scorer: startsWith gets a slight boost
    const scored = arr.map(t => {
      const name = t.name.toLowerCase();
      const idx = name.indexOf(needle);
      let score = -1;
      if (idx === 0) score = 2;
      else if (idx > -1) score = 1;
      return { t, score, idx };
    }).filter(x => x.score >= 0)
      .sort((a, b) => (b.score - a.score) || (a.idx - b.idx) || a.t.name.localeCompare(b.t.name))
      .map(x => x.t);

    return scored.slice(0, 8);
  };

  function loadRecent() {
    try {
      return JSON.parse(localStorage.getItem('fl_recent_tracks') || '[]');
    } catch {
      return [];
    }
  }

  function saveRecent(name) {
    if (!name) return;
    const set = [name, ...recent.filter(r => r !== name)].slice(0, 5);
    recent = set;
    localStorage.setItem('fl_recent_tracks', JSON.stringify(set));
  }

  let activeIndex = -1;
  let currentItems = [];

  function renderList(q = '') {
    const query = norm(q);
    list.innerHTML = '';

    const group = document.createDocumentFragment();

    // Recent section (only when empty query and we have recent)
    if (!query && recent.length) {
      const header = document.createElement('div');
      header.className = 'fl-combobox-section';
      header.textContent = 'Recent';
      group.appendChild(header);
      recent.forEach(name => {
        const el = document.createElement('div');
        el.className = 'fl-combobox-item';
        el.textContent = name;
        el.dataset.value = name;
        group.appendChild(el);
      });
    }

    // Matches section
    const matches = query ? fuse(query, tracks) : tracks.slice(0, 8);
    currentItems = matches.map(t => t.name);

    if (matches.length) {
      if (recent.length && !query) {
        const header = document.createElement('div');
        header.className = 'fl-combobox-section';
        header.textContent = 'Popular';
        group.appendChild(header);
      } else if (query) {
        const header = document.createElement('div');
        header.className = 'fl-combobox-section';
        header.textContent = 'Matches';
        group.appendChild(header);
      }

      matches.forEach(t => {
        const el = document.createElement('div');
        el.className = 'fl-combobox-item';
        el.textContent = t.name + (t.state ? ` (${t.state})` : '');
        el.dataset.value = t.name;
        group.appendChild(el);
      });
    }

    list.appendChild(group);
    list.classList.toggle('fl-combobox-hidden', list.children.length === 0);
    activeIndex = -1;
  }

  function commit(value) {
    const val = norm(value);
    inputEl.value = val;
    list.classList.add('fl-combobox-hidden');
    if (val) saveRecent(val);
    if (onChange) onChange(val);
    if (window.FLPersistence && typeof window.FLPersistence.notifyTrackCommit === 'function') {
      window.FLPersistence.notifyTrackCommit(val);
    }
  }

  // Events
  const onInput = debounced(() => renderList(inputEl.value), 150);
  inputEl.addEventListener('input', onInput);
  inputEl.addEventListener('focus', () => renderList(inputEl.value));
  inputEl.addEventListener('blur', () => setTimeout(() => list.classList.add('fl-combobox-hidden'), 150));

  list.addEventListener('mousedown', (e) => {
    const target = e.target.closest('.fl-combobox-item');
    if (target) {
      e.preventDefault();
      commit(target.dataset.value);
    }
  });

  inputEl.addEventListener('keydown', (e) => {
    const items = Array.from(list.querySelectorAll('.fl-combobox-item'));
    if (!items.length) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      activeIndex = Math.min(items.length - 1, activeIndex + 1);
      items.forEach((el, i) => el.setAttribute('aria-selected', i === activeIndex));
      items[activeIndex].scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      activeIndex = Math.max(0, activeIndex - 1);
      items.forEach((el, i) => el.setAttribute('aria-selected', i === activeIndex));
      items[activeIndex].scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (activeIndex >= 0) {
        commit(items[activeIndex].dataset.value);
      } else {
        commit(inputEl.value); // freeform
      }
    } else if (e.key === 'Escape') {
      list.classList.add('fl-combobox-hidden');
    }
  });

  // Initial paint
  renderList('');
}

