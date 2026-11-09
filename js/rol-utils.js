(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.RolUtils = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function pad2(n) { return String(n).padStart(2, '0'); }

  function toKey(date) {
    return date.getFullYear() + '-' + pad2(date.getMonth() + 1) + '-' + pad2(date.getDate());
  }

  function parseKey(key) {
    var parts = key.split('-').map(Number);
    return new Date(parts[0], parts[1] - 1, parts[2], 12);
  }

  function addDays(key, days) {
    var d = parseKey(key);
    d.setDate(d.getDate() + days);
    return toKey(d);
  }

  function daysInMonth(year, month) {
    return new Date(year, month, 0).getDate();
  }

  function monthGrid(year, month) {
    var first = new Date(year, month - 1, 1, 12);
    var offset = (first.getDay() + 6) % 7; // lunes = 0
    var total = daysInMonth(year, month);
    var cells = [];
    for (var i = 0; i < offset; i++) cells.push(null);
    for (var d = 1; d <= total; d++) {
      var date = new Date(year, month - 1, d, 12);
      cells.push({
        key: toKey(date),
        day: d,
        weekday: date.getDay()
      });
    }
    while (cells.length % 7 !== 0) cells.push(null);
    return cells;
  }

  function formatMonth(year, month) {
    var s = new Intl.DateTimeFormat('es-ES', { month: 'long', year: 'numeric' })
      .format(new Date(year, month - 1, 1, 12));
    return s.charAt(0).toUpperCase() + s.slice(1);
  }

  function formatMonthShort(year, month) {
    var s = new Intl.DateTimeFormat('es-ES', { month: 'short', year: 'numeric' })
      .format(new Date(year, month - 1, 1, 12));
    return s.charAt(0).toUpperCase() + s.slice(1).replace('.', '');
  }

  function formatLongDate(key) {
    var s = new Intl.DateTimeFormat('es-ES', {
      weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
    }).format(parseKey(key));
    return s.charAt(0).toUpperCase() + s.slice(1);
  }

  function formatShortDate(key) {
    return new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'short' })
      .format(parseKey(key)).replace('.', '');
  }

  function weekdayShort(date) {
    return ['D', 'L', 'M', 'X', 'J', 'V', 'S'][date.getDay()];
  }

  function findWorker(rol, id) {
    if (!rol || !rol.workers) return null;
    var needle = String(id).replace(/\D/g, '');
    return rol.workers.find(function (w) { return w.id === needle; }) || null;
  }

  function initials(name) {
    var parts = String(name || '').replace(/,/g, ' ').split(/\s+/).filter(Boolean);
    if (!parts.length) return '?';
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }

  function hexToRgba(hex, alpha) {
    var h = String(hex || '#2b2430').replace('#', '');
    if (h.length === 3) h = h.split('').map(function (c) { return c + c; }).join('');
    var n = parseInt(h, 16);
    if (isNaN(n)) n = 0x2b2430;
    return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + alpha + ')';
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function codeStats(worker) {
    var counts = {};
    var total = 0;
    Object.keys(worker.days || {}).forEach(function (key) {
      var code = worker.days[key].code;
      counts[code] = (counts[code] || 0) + 1;
      total += 1;
    });
    return {
      total: total,
      counts: Object.keys(counts).map(function (code) {
        return { code: code, count: counts[code] };
      }).sort(function (a, b) { return b.count - a.count || a.code.localeCompare(b.code); })
    };
  }

  return {
    toKey: toKey,
    parseKey: parseKey,
    addDays: addDays,
    daysInMonth: daysInMonth,
    monthGrid: monthGrid,
    formatMonth: formatMonth,
    formatMonthShort: formatMonthShort,
    formatLongDate: formatLongDate,
    formatShortDate: formatShortDate,
    weekdayShort: weekdayShort,
    findWorker: findWorker,
    initials: initials,
    hexToRgba: hexToRgba,
    escapeHtml: escapeHtml,
    codeStats: codeStats
  };
});
