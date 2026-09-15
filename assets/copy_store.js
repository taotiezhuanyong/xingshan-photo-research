(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.XingshanCopyStore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const LANGS = ['zh', 'en', 'fr'];
  const PREVIOUS_EDITIONS = Object.freeze({
    '0b69d6407bcf7fcd8d7951396cecdee26611cece0589558473777894cd323a8d': 759,
    '8bb9bc37796113cf4b39507ab841b3b6a72e64dfb561557acc55fb71fe6c29f0': 784,
    '0e3a0e9ac9a9f7bd36ddcdd15ee5a260c2a12a5a7a0ac3e5679fc5da5308b2d1': 785,
    '5d0039c5278cece2998588317c2fdca737266719296359c16489a58becab97e7': 787
  });
  const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
  const safeJSON = value => JSON.stringify(value).replace(/</g, '\\u003c');
  function voices(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== 3) throw Error('Invalid languages');
    const result = {};
    for (const lang of LANGS) {
      if (!own(value, lang) || typeof value[lang] !== 'string' || value[lang].length > 30000) throw Error('Invalid text');
      result[lang] = value[lang];
    }
    return result;
  }
  function create(model, storage) {
    if (model.schema !== 1 || model.project !== 'xingshan-copy' || !Array.isArray(model.fields)) throw Error('Invalid model');
    const defaults = new Map(), fields = new Map();
    for (const field of model.fields) {
      if (!/^c_[a-f0-9]{16}$/.test(field.id) || defaults.has(field.id)) throw Error('Invalid field');
      defaults.set(field.id, voices(field.values)); fields.set(field.id, field);
    }
    let values = new Map([...defaults].map(([id, value]) => [id, {...value}]));
    let language = LANGS.includes(model.defaultLanguage) ? model.defaultLanguage : 'zh';
    let persistenceFailed = false;
    const storageKey = 'xingshan-copy.v1.' + model.documentId;
    function validate(data) {
      if (!data || data.schema !== 1 || data.project !== model.project) throw Error('Incompatible document');
      const previousCount = model.documentId === 'xingshan-natural-editor-v1' ? PREVIOUS_EDITIONS[data.baseHash] : null;
      if (previousCount) {
        if (!data.values || typeof data.values !== 'object' || Array.isArray(data.values) || Object.keys(data.values).length !== previousCount) throw Error('Incomplete previous document');
        const upgraded = new Map([...defaults].map(([id, value]) => [id, {...value}]));
        let retired = 0;
        for (const [id, value] of Object.entries(data.values)) {
          if (!/^c_[a-f0-9]{16}$/.test(id)) throw Error('Invalid previous field');
          const checked = voices(value);
          if (defaults.has(id)) upgraded.set(id, checked);
          else retired++;
        }
        if (retired > 20) throw Error('Too many retired fields');
        return upgraded;
      }
      if (data.baseHash !== model.baseHash) throw Error('Incompatible document');
      if (!data.values || typeof data.values !== 'object' || Array.isArray(data.values) || Object.keys(data.values).length !== defaults.size) throw Error('Incomplete document');
      const checked = new Map();
      for (const id of Object.keys(data.values)) {
        if (!defaults.has(id)) throw Error('Unknown field');
        checked.set(id, voices(data.values[id]));
      }
      return checked;
    }
    function snapshot() {
      return {schema:1, project:model.project, baseHash:model.baseHash, language,
        values:Object.fromEntries([...values].map(([id, value]) => [id, {...value}]))};
    }
    function persist() {
      try {
        if (!storage) throw Error('Unavailable storage');
        storage.setItem(storageKey, JSON.stringify(snapshot()));
        persistenceFailed = false; return true;
      } catch (_) { persistenceFailed = true; return false; }
    }
    try {
      const saved = storage && storage.getItem(storageKey);
      if (saved) {
        const data = JSON.parse(saved);
        values = validate(data);
        if (LANGS.includes(data.language)) language = data.language;
        if (model.documentId === 'xingshan-natural-editor-v1' && PREVIOUS_EDITIONS[data.baseHash]) persist();
      }
    } catch (_) { persistenceFailed = true; }
    return {
      get language() { return language; }, get persistenceFailed() { return persistenceFailed; }, storageKey,
      get(id, lang = language) {
        if (!values.has(id) || !LANGS.includes(lang)) throw Error('Unknown field or language');
        return values.get(id)[lang];
      },
      getVoices(id) { if (!values.has(id)) throw Error('Unknown field'); return {...values.get(id)}; },
      getOriginal(id) { if (!defaults.has(id)) throw Error('Unknown field'); return {...defaults.get(id)}; },
      set(id, text) {
        if (!values.has(id)) throw Error('Unknown field');
        const checked = voices(text); values.set(id, checked); return persist();
      },
      setLanguage(lang) { if (!LANGS.includes(lang)) throw Error('Unknown language'); language = lang; return persist(); },
      validate,
      import(data) { const checked = validate(data); values = checked; return persist(); },
      reset() { values = new Map([...defaults].map(([id, value]) => [id, {...value}])); return persist(); },
      snapshot,
      exportHTML(template, documentId) {
        if (typeof template !== 'string' || !template.includes('<!--COPY_DATA-->') || !template.includes('<!--COPY_TEMPLATE-->')) throw Error('Invalid template');
        const next = {...model, documentId, defaultLanguage:language,
          fields:model.fields.map(field => ({...field, values:{...values.get(field.id)}}))};
        // Function replacements keep dollar signs in edited prose literal.
        return template.replace('<!--COPY_DATA-->', () => safeJSON(next)).replace('<!--COPY_TEMPLATE-->', () => safeJSON(template));
      }
    };
  }
  return {create, voices, safeJSON, LANGS};
});
