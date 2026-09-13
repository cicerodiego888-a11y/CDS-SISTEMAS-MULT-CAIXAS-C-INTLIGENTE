(function (global) {
  'use strict';

    function render(opts) {
      const o = opts || {};
      const esc = (global.CDSUIHelpers || {}).esc || ((v) => String(v ?? ''));
      const options = (o.options || []).map((opt) =>
        '<option value="' + esc(opt.value) + '"' + (opt.selected ? ' selected' : '') + '>' + esc(opt.label) + '</option>'
      ).join('');
      return '<div class="cds-ui cds-ui-field">' +
        (o.label ? '<label class="cds-ui-field__label">' + esc(o.label) + '</label>' : '') +
        '<select class="cds-ui-select form-select"' + (o.id ? ' id="' + esc(o.id) + '"' : '') + '>' + options + '</select></div>';
    }
    const CDSSelect = { name: 'CDSSelect', render };
    global.CDSSelect = CDSSelect;
    (global.CDSUIComponents = global.CDSUIComponents || {}).CDSSelect = CDSSelect;
  
  if (typeof module !== 'undefined' && module.exports) module.exports = CDSSelect;
})(typeof window !== 'undefined' ? window : global);
