(function (global) {
  'use strict';

    function render(opts) {
      const o = opts || {};
      const esc = (global.CDSUIHelpers || {}).esc || ((v) => String(v ?? ''));
      return '<div class="cds-ui cds-ui-field">' +
        (o.label ? '<label class="cds-ui-field__label">' + esc(o.label) + '</label>' : '') +
        '<input class="cds-ui-input form-control" type="' + esc(o.type || 'text') + '"' +
        (o.id ? ' id="' + esc(o.id) + '"' : '') +
        (o.placeholder ? ' placeholder="' + esc(o.placeholder) + '"' : '') +
        (o.value != null ? ' value="' + esc(o.value) + '"' : '') +
        (o.disabled ? ' disabled' : '') + '/>' +
        '</div>';
    }
    const CDSInput = { name: 'CDSInput', render };
    global.CDSInput = CDSInput;
    (global.CDSUIComponents = global.CDSUIComponents || {}).CDSInput = CDSInput;
  
  if (typeof module !== 'undefined' && module.exports) module.exports = CDSInput;
})(typeof window !== 'undefined' ? window : global);
