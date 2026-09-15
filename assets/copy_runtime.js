(() => {
  'use strict';
  const model = JSON.parse(document.getElementById('copy-data').textContent);
  const template = JSON.parse(document.getElementById('copy-template').textContent);
  let storage = null;
  try { storage = window.localStorage; } catch (_) { /* Export remains available. */ }
  const store = window.XingshanCopyStore.create(model, storage);
  const byId = new Map(model.fields.map(field => [field.id, field]));
  const elements = new Map([...document.querySelectorAll('[data-copy-target]')].map(node => [node.dataset.copyTarget, node]));
  const targets = model.bindings.map(binding => {
    const element = elements.get(binding.target);
    const text = binding.kind === 'text' ? (binding.slot === 'tail' ? element.nextSibling : element.firstChild) : null;
    if (!element || (binding.kind === 'text' && (!text || text.nodeType !== Node.TEXT_NODE))) throw Error('Invalid text binding: ' + binding.target);
    return {...binding, element, text};
  });
  const $ = id => document.getElementById(id);
  const dialog = $('copy-editor'), search = $('copy-search'), section = $('copy-section'), list = $('copy-list');
  const inputs = Object.fromEntries(['zh','en','fr'].map(lang => [lang, $('copy-' + lang)]));
  let selected = null, draft = null, dirty = false, statusKey = 'ready', statusError = false;
  let unbacked = false, highlighted = null, resultFields = [], openingScroll = 0;
  const label = key => model.labels[key][store.language];
  const groupName = key => (model.groups[key] || {})[store.language] || key;
  const t = key => store.get(model.runtime[key]);
  const getGallery = () => model.gallery.map(item => ({id:item.id, src:item.src, kind:item.kind,
    title:store.get(item.titleKey), meta:store.get(item.metaKey)}));
  window.XingshanCopy = Object.freeze({t, getGallery});

  function status(key, error = false) {
    statusKey = key; statusError = error;
    $('copy-status').textContent = label(key);
    $('copy-status').dataset.error = String(error);
  }
  function reportSave(ok, key = 'saved') {
    unbacked = !ok;
    status(ok ? key : 'storageError', !ok);
  }
  function markDirty() {
    if (!selected) return;
    draft = Object.fromEntries(Object.entries(inputs).map(([lang, node]) => [lang, node.value]));
    const saved = store.getVoices(selected);
    dirty = Object.keys(inputs).some(lang => draft[lang] !== saved[lang]);
    status(dirty ? 'pending' : store.persistenceFailed ? 'storageError' : 'ready', !dirty && store.persistenceFailed);
  }
  function canDiscard() { return !dirty || window.confirm(label('unsavedLeave')); }
  function fillDraft() {
    for (const lang of Object.keys(inputs)) inputs[lang].value = draft ? draft[lang] : '';
    for (const node of Object.values(inputs)) node.disabled = !selected;
    $('copy-save').disabled = $('copy-restore').disabled = !selected;
  }
  function textTarget(id) {
    return targets.find(binding => binding.key === id && binding.kind === 'text' &&
      binding.element.closest('main,footer,.site-header'));
  }
  function renderSelection() {
    $('copy-selected').textContent = selected ? groupName(byId.get(selected).group) : label('choose');
    $('copy-preview').disabled = !selected || !textTarget(selected);
    const original = $('copy-original-text'); original.replaceChildren();
    if (selected) {
      const values = store.getOriginal(selected);
      for (const [lang, name] of [['zh','中文'],['en','English'],['fr','Français']]) {
        const paragraph = document.createElement('p'), title = document.createElement('strong');
        paragraph.lang = lang; title.textContent = name;
        paragraph.append(title, document.createElement('br'), document.createTextNode(values[lang]));
        original.append(paragraph);
      }
    }
    for (const button of list.querySelectorAll('[data-field]')) button.setAttribute('aria-pressed', String(button.dataset.field === selected));
  }
  function selectField(id, force = false) {
    if (!byId.has(id) || (!force && !canDiscard())) return false;
    selected = id; draft = store.getVoices(id); dirty = false;
    fillDraft(); renderSelection(); status(store.persistenceFailed ? 'storageError' : 'ready', store.persistenceFailed);
    return true;
  }
  function renderList() {
    const query = search.value.trim().toLocaleLowerCase();
    resultFields = model.fields.filter(field => {
      if (section.value && field.group !== section.value) return false;
      if (!query) return true;
      return [field.group, groupName(field.group), ...Object.values(store.getVoices(field.id))].join(' ').toLocaleLowerCase().includes(query);
    });
    const fragment = document.createDocumentFragment();
    for (const field of resultFields) {
      const button = document.createElement('button'), group = document.createElement('small'), text = document.createElement('span');
      button.type = 'button'; button.dataset.field = field.id;
      button.setAttribute('aria-pressed', String(field.id === selected));
      group.textContent = groupName(field.group);
      const value = store.get(field.id) || store.get(field.id, 'zh') || store.get(field.id, 'en') || store.get(field.id, 'fr');
      text.textContent = value || '—';
      button.append(group, text); fragment.append(button);
    }
    list.replaceChildren(fragment);
    $('copy-results').textContent = resultFields.length ? `${resultFields.length} / ${model.fields.length}` : label('empty');
  }
  function renderLabels() {
    document.querySelectorAll('[data-editor-label]').forEach(node => node.textContent = label(node.dataset.editorLabel));
    $('copy-open').textContent = label('edit');
    list.setAttribute('aria-label', label('selected'));
    const currentSection = section.value;
    const fragment = document.createDocumentFragment(), all = document.createElement('option');
    all.value = ''; all.textContent = label('all'); fragment.append(all);
    for (const key of Object.keys(model.groups)) {
      const option = document.createElement('option'); option.value = key; option.textContent = groupName(key); fragment.append(option);
    }
    section.replaceChildren(fragment); section.value = currentSection;
    status(statusKey, statusError); renderList(); renderSelection();
  }
  function readingAnchor() {
    const candidates = [...document.querySelectorAll('main [data-copy-target]')].filter(node => {
      if (!node.getClientRects().length || node.closest('[hidden],.leaf-sheet[inert]')) return false;
      const rect = node.getBoundingClientRect();
      return rect.bottom > 130 && rect.top < innerHeight;
    });
    const node = candidates.find(node => node.getBoundingClientRect().top >= 130) || candidates[0];
    return node ? {node, top:node.getBoundingClientRect().top} : null;
  }
  function apply(preserveReading = false) {
    const anchor = preserveReading && !dialog.open ? readingAnchor() : null;
    document.documentElement.lang = store.language === 'zh' ? 'zh-CN' : store.language;
    $('copy-latin-style').media = store.language === 'zh' ? 'not all' : 'all';
    for (const binding of targets) {
      let value = store.get(binding.key);
      if (binding.prefix) value = binding.prefix[store.language] + value;
      if (binding.space) value = binding.space[store.language][0] + value + binding.space[store.language][1];
      if (binding.kind === 'text') binding.text.nodeValue = value;
      else binding.element.setAttribute(binding.attribute, value);
    }
    document.querySelectorAll('[data-language]').forEach(button => {
      const active = button.dataset.language === store.language;
      button.setAttribute('aria-pressed', String(active));
      if (active) button.setAttribute('aria-current', 'true'); else button.removeAttribute('aria-current');
    });
    $('gallery-data').textContent = window.XingshanCopyStore.safeJSON(getGallery());
    renderLabels();
    window.dispatchEvent(new CustomEvent('xingshan:contentchange', {detail:{language:store.language}}));
    if (anchor) requestAnimationFrame(() => window.scrollBy({top:anchor.node.getBoundingClientRect().top-anchor.top, behavior:'instant'}));
  }
  function save() {
    if (!selected) return true;
    const ok = store.set(selected, draft);
    dirty = false; apply(false); reportSave(ok); return ok;
  }
  function saveDraft() { if (dirty) save(); }
  function openEditor(id) {
    if (highlighted) { highlighted.classList.remove('copy-found'); highlighted = null; }
    if (id && !byId.has(id)) throw Error('Unknown field');
    if (!dialog.open) {
      openingScroll = window.scrollY;
      document.body.classList.add('copy-editing'); dialog.showModal();
    }
    if (id) {
      search.value = ''; section.value = byId.get(id).group;
      renderList(); selectField(id);
    } else if (!selected) {
      const current = [...document.querySelectorAll('main article[id], main section[id]')].filter(node => node.getClientRects().length && node.getBoundingClientRect().top <= 200).at(-1);
      const field = model.fields.find(field => current && field.group === current.id && textTarget(field.id)) || model.fields.find(field => textTarget(field.id));
      if (field) { section.value = field.group; renderList(); selectField(field.id); }
    }
    search.focus({preventScroll:true});
  }
  function closeEditor() {
    if (!canDiscard()) return;
    if (selected) { draft = store.getVoices(selected); dirty = false; fillDraft(); }
    dialog.close();
  }
  function download(content, type, filename) {
    const url = URL.createObjectURL(new Blob([content], {type})), anchor = document.createElement('a');
    anchor.href = url; anchor.download = filename; document.body.append(anchor); anchor.click(); anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function exportContent() {
    saveDraft();
    download(JSON.stringify(store.snapshot(), null, 2), 'application/json;charset=utf-8', 'xingshan-texts.json');
    unbacked = false; status('exported');
  }
  function downloadPage() {
    saveDraft();
    const id = 'xingshan-edited-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 9);
    download(store.exportHTML(template, id), 'text/html;charset=utf-8', 'index.html');
    unbacked = false; status('downloaded');
  }
  function importContent(data) {
    store.validate(data);
    const ok = store.import(data);
    if (selected) { draft = store.getVoices(selected); dirty = false; fillDraft(); }
    apply(true); reportSave(ok, 'imported'); return ok;
  }
  function setLanguage(lang) {
    const ok = store.setLanguage(lang);
    apply(true);
    updateCaseLinks();
    if (!ok) status('storageError', true);
  }
  function updateCaseLinks() {
    document.querySelectorAll('[data-case-link]').forEach(link => {
      link.href = '#case-' + encodeURIComponent(link.dataset.caseLink);
    });
    document.querySelectorAll('[data-fragment-home]').forEach(link => {
      link.href = '#fragment-lab';
    });
  }
  $('copy-open').setAttribute('aria-haspopup','dialog');
  $('copy-open').setAttribute('aria-controls','copy-editor');
  $('copy-open').addEventListener('click', () => openEditor());
  $('copy-close').addEventListener('click', closeEditor);
  dialog.addEventListener('cancel', event => { event.preventDefault(); closeEditor(); });
  dialog.addEventListener('close', () => {
    document.body.classList.remove('copy-editing');
    window.scrollTo({top:openingScroll, behavior:'instant'});
    $('copy-open').focus({preventScroll:true});
  });
  for (const input of Object.values(inputs)) input.addEventListener('input', markDirty);
  list.addEventListener('click', event => {
    const button = event.target.closest('[data-field]'); if (button) selectField(button.dataset.field);
  });
  search.addEventListener('input', renderList); section.addEventListener('change', renderList);
  $('copy-save').addEventListener('click', save);
  dialog.addEventListener('keydown', event => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') { event.preventDefault(); save(); }
  });
  $('copy-restore').addEventListener('click', () => { if (selected) { draft = store.getOriginal(selected); fillDraft(); markDirty(); } });
  $('copy-preview').addEventListener('click', () => {
    if (!selected) return;
    saveDraft();
    const binding = textTarget(selected); if (!binding) return;
    let node = binding.element;
    for (let parent = node; parent; parent = parent.parentElement) if (parent.tagName === 'DETAILS') parent.open = true;
    const sheet = node.closest('.leaf-sheet');
    if (sheet) node.dispatchEvent(new Event('leaf:show', {bubbles:true}));
    dialog.close();
    requestAnimationFrame(() => {
      node.scrollIntoView({block:'center', behavior:'instant'});
      node.classList.add('copy-found'); highlighted = node;
      const id = node.closest('article[id],section[id]')?.id;
      if (id) history.replaceState(null, '', '#' + id);
    });
  });
  $('copy-export').addEventListener('click', exportContent);
  $('copy-download').addEventListener('click', downloadPage);
  $('copy-import').addEventListener('click', () => $('copy-file').click());
  $('copy-file').addEventListener('change', async event => {
    const file = event.target.files[0]; event.target.value = ''; if (!file) return;
    try {
      if (file.size > 10 * 1024 * 1024) throw Error('File too large');
      const data = JSON.parse(await file.text()); store.validate(data);
      if (!window.confirm(label('confirmImport'))) return;
      importContent(data);
    } catch (_) { status('invalidImport', true); }
  });
  $('copy-reset').addEventListener('click', () => {
    if (!window.confirm(label('confirmRestore'))) return;
    const ok = store.reset();
    if (selected) { draft = store.getVoices(selected); dirty = false; fillDraft(); }
    apply(false); reportSave(ok, 'resetDone');
  });
  document.querySelectorAll('[data-language]').forEach(button => button.addEventListener('click', () => setLanguage(button.dataset.language)));
  window.addEventListener('beforeunload', event => { if (dirty || unbacked) { event.preventDefault(); event.returnValue = ''; } });
  window.XingshanCopyAPI = Object.freeze({
    getFields: () => model.fields.map(field => ({id:field.id, group:field.group, values:store.getVoices(field.id)})),
    getField: id => store.getVoices(id),
    setField: (id, values) => {
      const ok = store.set(id, values);
      if (selected === id) { draft = store.getVoices(id); dirty = false; fillDraft(); }
      apply(true); reportSave(ok); return ok;
    },
    exportContent: () => store.snapshot(), importContent,
    getLanguage: () => store.language, setLanguage, openEditor, downloadPage
  });
  document.body.classList.toggle('author-mode', new URLSearchParams(location.search).get('edit') === '1');
  const requestedLanguage = new URLSearchParams(location.search).get('lang');
  if (['zh', 'fr', 'en'].includes(requestedLanguage)) store.setLanguage(requestedLanguage);
  apply(false); updateCaseLinks(); fillDraft();
})();
