(function () {
  'use strict';

  var LS_KEY = 'mirol.state.v2';
  var LEGACY_KEY = 'mirol.state.v1';
  var MAX_PDF = 20 * 1024 * 1024;

  var state = { version: 2, rols: [], activeId: null, workerId: null, notifications: { enabled: false, time: '20:00' } };
  var currentWorker = null;
  var currentScreen = 'import';
  var idBuffer = '';
  var idLength = 7;
  var editRolId = null;
  var editKeyMode = false;
  var editKeyDate = null;
  var searchTimer = null;
  var searchSeq = 0;
  var toastTimer = null;

  var $ = function (id) { return document.getElementById(id); };
  var U = window.RolUtils;
  var SHIFT_IMAGES = new Set(Array.isArray(window.SHIFT_IMAGES) ? window.SHIFT_IMAGES : []);
  var SHIFT_IMAGE_DATA = window.SHIFT_IMAGE_DATA || {};
  var SHIFT_TIMES = window.SHIFT_TIMES || {};
  var SHIFT_DAYS = window.SHIFT_DAYS || {};
  var DAY_LETTERS = ['D', 'L', 'M', 'X', 'J', 'V', 'S'];
  var IS_WEB = !!window.MIROL_WEB;

  var els = {};

  function cacheElements() {
    [
      'screenImport', 'screenIdentify', 'screenCalendar',
      'pickPdf', 'fileInput', 'uploadCard', 'loadedCard',
      'loadedMonth', 'loadedTitle', 'loadedMeta', 'continueBtn', 'addAnotherRol',
      'manageRolsBtn', 'importRolSelect', 'savedCount', 'importError', 'notifyBtn',
      'notifyOverlay', 'notifyTime', 'notifySave', 'notifyDisable', 'notifyLabel', 'notifySwitch',
      'homeWorker', 'homeWorkerAvatar', 'homeWorkerName', 'homeWorkerId', 'changeWorkerHome',
      'identifyBack', 'identifyMonth', 'idLengthLabel', 'idBoxes', 'idError', 'keypad',
      'searchBtn', 'replaceRolBtn',
      'prevRol', 'openRolPicker', 'nextRol', 'addRol', 'backToIdentify', 'menuBtn',
      'workerAvatar', 'workerName', 'workerSub', 'calendarRolMonth', 'daysGrid', 'resetEditsBtn',
      'editKeyBtn', 'keyEditBanner', 'cancelKeyEdit', 'editKeyOverlay', 'editKeyTitle',
      'editKeyForm', 'newKeyInput', 'editKeyCurrent', 'editKeyError', 'cancelEditKey', 'saveEditKey',
      'dayOverlay', 'daySheetWeekday', 'daySheetTitle', 'dayCodeCaption',
      'dayMeta', 'shiftDetail',
      'menuOverlay', 'menuChangeWorker', 'menuChangeRol',
      'rolPickerOverlay', 'rolPickerList', 'pickerAddRol',
      'manageRolesOverlay', 'manageRolesList', 'manageAddRol',
      'toast', 'loader', 'loaderText'
    ].forEach(function (id) { els[id] = $(id); });
  }

  function pad2(n) { return String(n).padStart(2, '0'); }
  function makeRolId(year, month) { return String(year) + '-' + pad2(month); }
  function compareRols(a, b) { return (a.year - b.year) || (a.month - b.month); }

  function entryById(id) {
    for (var i = 0; i < state.rols.length; i++) {
      if (state.rols[i].id === id) return state.rols[i];
    }
    return null;
  }

  function activeEntry() {
    return entryById(state.activeId) || state.rols[0] || null;
  }

  function activeRol() {
    var entry = activeEntry();
    return entry ? entry.rol : null;
  }

  function ensureActive() {
    if (state.rols.length && !entryById(state.activeId)) {
      state.activeId = state.rols[0].id;
    }
  }

  /* ============================================================
     Estado persistente: varios roles mensuales
     ============================================================ */

  function normalizeState(parsed) {
    var out = { version: 2, rols: [], activeId: null, workerId: null };
    var list = [];

    if (parsed && Array.isArray(parsed.rols)) {
      list = parsed.rols;
    } else if (parsed && parsed.rol && Array.isArray(parsed.rol.workers)) {
      // Migración del formato antiguo de un solo rol.
      list = [{ rol: parsed.rol, fileName: parsed.fileName, importedAt: parsed.importedAt }];
      if (typeof parsed.workerId === 'string') out.workerId = parsed.workerId;
    }

    var byId = {};
    list.forEach(function (item) {
      var rol = item && item.rol;
      if (!rol || !Array.isArray(rol.workers) || !rol.workers.length) return;
      var year = Number(rol.year) || (rol.startDate ? Number(String(rol.startDate).slice(0, 4)) : 0);
      var month = Number(rol.month) || (rol.startDate ? Number(String(rol.startDate).slice(5, 7)) : 0);
      if (!year || !month) return;
      var id = makeRolId(year, month);
      rol.year = year;
      rol.month = month;
      byId[id] = {
        id: id,
        year: year,
        month: month,
        rol: rol,
        fileName: item.fileName || null,
        importedAt: item.importedAt || null,
        edits: item.edits && typeof item.edits === 'object' ? item.edits : {}
      };
    });

    out.rols = Object.keys(byId).map(function (id) { return byId[id]; }).sort(compareRols);
    if (parsed && parsed.activeId && byId[parsed.activeId]) out.activeId = parsed.activeId;
    else if (out.rols.length) out.activeId = out.rols[0].id;

    if (parsed && typeof parsed.workerId === 'string') out.workerId = parsed.workerId;

    var notify = (parsed && parsed.notifications) || {};
    out.notifications = {
      enabled: !!notify.enabled,
      time: /^\d{2}:\d{2}$/.test(notify.time || '') ? notify.time : '20:00'
    };
    return out;
  }

  function loadState() {
    try {
      var raw = localStorage.getItem(LS_KEY);
      if (raw) {
        var parsed = JSON.parse(raw);
        var normalized = normalizeState(parsed);
        if (normalized.rols.length || !localStorage.getItem(LEGACY_KEY)) {
          state = normalized;
          return;
        }
      }
    } catch (e) { /* probamos el formato antiguo */ }

    try {
      var legacy = localStorage.getItem(LEGACY_KEY);
      if (legacy) {
        state = normalizeState(JSON.parse(legacy));
        saveState();
        try { localStorage.removeItem(LEGACY_KEY); } catch (e) { /* ignore */ }
      }
    } catch (e) { /* estado corrupto: empezamos de cero */ }
  }

  function saveState() {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(state));
      try { localStorage.removeItem(LEGACY_KEY); } catch (e) { /* ignore */ }
      return true;
    } catch (e) {
      showToast('No se ha podido guardar. El rol sigue disponible mientras no cierres la app.');
      return false;
    }
  }

  /* ============================================================
     Utilidades de presentación
     ============================================================ */

  function prettyName(name) {
    return String(name || '').toLocaleLowerCase('es')
      .replace(/(^|[\s,;])([a-záéíóúñü])/g, function (m, sep, ch) {
        return sep + ch.toLocaleUpperCase('es');
      });
  }

  function firstName(name) {
    var pretty = prettyName(name);
    var afterComma = pretty.split(',')[1];
    var source = afterComma || pretty;
    return source.trim().split(/\s+/)[0] || '';
  }

  function isDark() {
    return !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
  }

  function hexToRgb(hex) {
    var h = String(hex || '#241c28').replace('#', '');
    if (h.length === 3) h = h.split('').map(function (c) { return c + c; }).join('');
    var n = parseInt(h, 16);
    if (isNaN(n)) n = 0x241c28;
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
  }

  function mixHex(hex, target, amount) {
    var a = hexToRgb(hex);
    var b = hexToRgb(target);
    var r = Math.round(a.r + (b.r - a.r) * amount);
    var g = Math.round(a.g + (b.g - a.g) * amount);
    var bl = Math.round(a.b + (b.b - a.b) * amount);
    return '#' + [r, g, bl].map(function (v) {
      return Math.max(0, Math.min(255, v)).toString(16).padStart(2, '0');
    }).join('');
  }

  function luminance(hex) {
    var c = hexToRgb(hex);
    return (0.299 * c.r + 0.587 * c.g + 0.114 * c.b) / 255;
  }

  function codeInk(hex) {
    if (isDark()) return mixHex(hex, '#ffffff', 0.58);
    if (luminance(hex) < 0.10) return '#241c28';
    return hex;
  }

  function showToast(message, ms) {
    clearTimeout(toastTimer);
    els.toast.textContent = message;
    els.toast.hidden = false;
    requestAnimationFrame(function () { els.toast.classList.add('is-visible'); });
    toastTimer = setTimeout(function () {
      els.toast.classList.remove('is-visible');
      setTimeout(function () { els.toast.hidden = true; }, 220);
    }, ms || 2800);
  }

  function showLoader(text) {
    els.loaderText.textContent = text || 'Leyendo el rol…';
    els.loader.hidden = false;
  }

  function hideLoader() {
    els.loader.hidden = true;
  }

  function showImportError(title, detail) {
    els.importError.innerHTML = '<strong>' + U.escapeHtml(title) + '</strong>' +
      (detail ? U.escapeHtml(detail) : '');
    els.importError.hidden = false;
  }

  function clearImportError() {
    els.importError.hidden = true;
    els.importError.textContent = '';
  }

  function openOverlay(el) {
    clearTimeout(el._closeTimer);
    el.hidden = false;
    requestAnimationFrame(function () { el.classList.add('open'); });
    document.body.classList.add('no-scroll');
    var focusable = el.querySelector('button');
    if (focusable) {
      setTimeout(function () {
        try { focusable.focus({ preventScroll: true }); } catch (e) { focusable.focus(); }
      }, 60);
    }
  }

  function closeOverlay(el) {
    el.classList.remove('open');
    document.body.classList.remove('no-scroll');
    clearTimeout(el._closeTimer);
    el._closeTimer = setTimeout(function () { el.hidden = true; }, 240);
  }

  function showScreen(name) {
    ['screenImport', 'screenIdentify', 'screenCalendar'].forEach(function (id) {
      els[id].hidden = els[id].getAttribute('data-screen') !== name;
    });
    currentScreen = name;
    if (name === 'import') renderImport();
    if (name === 'identify') renderIdentify();
    if (name === 'calendar') {
      editKeyMode = false;
      renderCalendar();
      updateKeyEditUI();
    }
    window.scrollTo(0, 0);
  }

  /* ============================================================
     Roles guardados
     ============================================================ */

  function renderRolList(container) {
    if (!container) return;
    container.innerHTML = state.rols.map(function (entry) {
      var active = entry.id === state.activeId;
      return '<button type="button" class="rol-row' + (active ? ' is-active' : '') +
        '" data-rol-id="' + entry.id + '" aria-current="' + (active ? 'true' : 'false') + '">' +
        '<span class="rol-main">' +
        '<span class="rol-month">' + U.escapeHtml(U.formatMonth(entry.year, entry.month)) + '</span>' +
        '<span class="rol-meta">' + entry.rol.workers.length + ' trabajadores</span>' +
        (active ? '<span class="rol-check">✓</span>' : '') +
        '</span></button>';
    }).join('');
  }

  function renderRolSelect(select) {
    if (!select) return;
    var sorted = state.rols.slice().sort(function (a, b) {
      return (b.year - a.year) || (b.month - a.month);
    });
    var years = [];
    sorted.forEach(function (entry) {
      if (years.indexOf(entry.year) < 0) years.push(entry.year);
    });
    var html = '';
    years.forEach(function (year) {
      html += '<optgroup label="' + year + '">';
      sorted.forEach(function (entry) {
        if (entry.year !== year) return;
        var monthName = U.formatMonth(entry.year, entry.month).replace(/\s+de\s+\d{4}$/i, '');
        html += '<option value="' + U.escapeHtml(entry.id) + '">' +
          U.escapeHtml(monthName) + '</option>';
      });
      html += '</optgroup>';
    });
    select.innerHTML = html;
    select.value = state.activeId || (state.rols[0] ? state.rols[0].id : '');
  }

  function renderImport() {
    ensureActive();
    var hasRol = state.rols.length > 0;
    els.uploadCard.hidden = hasRol;
    els.loadedCard.hidden = !hasRol;

    if (!hasRol) return;

    var entry = activeEntry();
    if (!entry) return;

    els.loadedMonth.textContent = U.formatMonth(entry.year, entry.month);
    els.loadedTitle.textContent = 'Tu rol está listo';
    var meta = entry.rol.workers.length + ' trabajadores · ' + entry.rol.dayCount + ' días';
    if (entry.rol.residence) meta += ' · ' + entry.rol.residence;
    els.loadedMeta.textContent = meta;
    els.savedCount.textContent = state.rols.length + (state.rols.length === 1 ? ' rol' : ' roles');
    renderRolSelect(els.importRolSelect);

    var worker = state.workerId ? U.findWorker(entry.rol, state.workerId) : null;
    els.continueBtn.textContent = worker ? 'Ver mi calendario' : 'Entrar en mi rol';
    if (IS_WEB) {
      els.notifyLabel.textContent = 'Añadir al calendario';
      els.notifySwitch.hidden = true;
    } else if (els.notifyLabel) {
      els.notifyLabel.textContent = state.notifications.enabled
        ? 'Notificaciones · ' + state.notifications.time
        : 'Activar notificaciones';
      if (state.notifications.enabled) els.notifySwitch.classList.add('is-on');
      else els.notifySwitch.classList.remove('is-on');
      els.notifySwitch.setAttribute('aria-checked', state.notifications.enabled ? 'true' : 'false');
    }

    if (worker) {
      els.homeWorker.hidden = false;
      els.homeWorkerAvatar.textContent = U.initials(prettyName(worker.name));
      els.homeWorkerName.textContent = prettyName(worker.name);
      els.homeWorkerId.textContent = 'Matrícula ' + worker.id;
    } else {
      els.homeWorker.hidden = true;
    }
  }

  function addDaysKey(key, days) {
    var date = U.parseKey(key);
    date.setDate(date.getDate() + days);
    return U.toKey(date);
  }

  function roleForDate(dateKey) {
    var year = Number(dateKey.slice(0, 4));
    var month = Number(dateKey.slice(5, 7));
    for (var i = 0; i < state.rols.length; i++) {
      if (state.rols[i].year === year && state.rols[i].month === month) return state.rols[i];
    }
    return null;
  }

  function buildNotificationPayload() {
    var payload = {};
    if (!state.workerId) return payload;
    var today = U.toKey(new Date());
    for (var i = 0; i < 120; i++) {
      var notifyDate = addDaysKey(today, i);
      var target = addDaysKey(notifyDate, 1);
      var entry = roleForDate(target);
      if (!entry) continue;
      var worker = U.findWorker(entry.rol, state.workerId);
      if (!worker || !worker.days) continue;
      var day = worker.days[target];
      if (!day) continue;
      var times = timesForCode(day.code, day);
      if (!times) continue;
      payload[notifyDate] = { code: day.code, start: times.start };
    }
    return payload;
  }

  function refreshNotifications() {
    if (IS_WEB) return;
    var bridge = window.AndroidNotifications;
    if (!state.notifications.enabled) {
      if (bridge && bridge.cancel) {
        try { bridge.cancel(); } catch (e) { /* ignore */ }
      }
      return;
    }
    if (!bridge || !bridge.schedule) return;
    try {
      bridge.schedule(state.notifications.time, JSON.stringify(buildNotificationPayload()));
    } catch (e) {
      showToast('No se han podido programar las notificaciones.', 4000);
    }
  }

  function openNotifications() {
    els.notifyTime.value = state.notifications.time || '20:00';
    els.notifyDisable.hidden = !state.notifications.enabled;
    openOverlay(els.notifyOverlay);
  }

  function icsEscape(value) {
    return String(value).replace(/\\/g, '\\\\').replace(/;/g, '\\;')
      .replace(/,/g, '\\,').replace(/\n/g, '\\n');
  }

  function icsDateTime(dateKey, minutes, dayOffset) {
    var date = U.parseKey(dateKey);
    date.setDate(date.getDate() + (dayOffset || 0));
    var y = date.getFullYear();
    var m = pad2(date.getMonth() + 1);
    var d = pad2(date.getDate());
    var h = pad2(Math.floor(minutes / 60) % 24);
    var min = pad2(minutes % 60);
    return '' + y + m + d + 'T' + h + min + '00';
  }

  function downloadCalendarICS(time) {
    if (!state.workerId) {
      showToast('Primero elige tu matrícula.');
      return;
    }
    var reminderMin = Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
    var events = [];
    var seen = {};
    var todayKey = U.toKey(new Date());

    state.rols.forEach(function (entry) {
      var worker = U.findWorker(entry.rol, state.workerId);
      if (!worker || !worker.days) return;
      Object.keys(worker.days).forEach(function (dateKey) {
        if (dateKey < todayKey) return;
        var day = worker.days[dateKey];
        var times = day ? timesForCode(day.code, day) : null;
        if (!times || seen[dateKey]) return;
        seen[dateKey] = true;

        var startMin = Number(times.start.slice(0, 2)) * 60 + Number(times.start.slice(3, 5));
        var endMin = Number(times.end.slice(0, 2)) * 60 + Number(times.end.slice(3, 5));
        var overnight = endMin <= startMin;
        var reminderOffset = (24 * 60 - reminderMin) + startMin;
        if (reminderOffset <= 0) return;

        events.push([
          'BEGIN:VEVENT',
          'UID:' + dateKey + '-' + day.code + '@mirol.local',
          'DTSTAMP:' + new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z'),
          'DTSTART:' + icsDateTime(dateKey, startMin, 0),
          'DTEND:' + icsDateTime(dateKey, endMin, overnight ? 1 : 0),
          'SUMMARY:' + icsEscape('Turno ' + day.code),
          'DESCRIPTION:' + icsEscape('Clave ' + day.code + ' · ' + times.start + '–' + times.end),
          'BEGIN:VALARM',
          'ACTION:DISPLAY',
          'DESCRIPTION:' + icsEscape('Mañana: clave ' + day.code + ' a las ' + times.start),
          'TRIGGER:-PT' + reminderOffset + 'M',
          'END:VALARM',
          'END:VEVENT'
        ].join('\r\n'));
      });
    });

    if (!events.length) {
      showToast('No hay turnos con horario para añadir.');
      return;
    }

    var ics = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//Mi Rol//Turnos//ES',
      'CALSCALE:GREGORIAN',
      'X-WR-CALNAME:Mi Rol',
      'X-WR-TIMEZONE:' + (Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Madrid')
    ].concat(events).concat(['END:VCALENDAR']).join('\r\n');

    var blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var link = document.createElement('a');
    link.href = url;
    link.download = 'MiRol-turnos.ics';
    document.body.appendChild(link);
    link.click();
    setTimeout(function () {
      URL.revokeObjectURL(url);
      if (link.parentNode) link.parentNode.removeChild(link);
    }, 1500);
    showToast('Calendario descargado. Ábrelo para añadir los turnos.', 4200);
  }

  function saveNotifications() {
    var time = els.notifyTime.value;
    if (!/^\d{2}:\d{2}$/.test(time)) {
      showToast('Elige una hora válida.');
      return;
    }
    if (IS_WEB) {
      downloadCalendarICS(time);
      closeOverlay(els.notifyOverlay);
      return;
    }
    state.notifications = { enabled: true, time: time };
    saveState();
    refreshNotifications();
    closeOverlay(els.notifyOverlay);
    renderImport();
    showToast('Notificaciones activadas a las ' + time);
  }

  function disableNotifications() {
    state.notifications.enabled = false;
    saveState();
    refreshNotifications();
    closeOverlay(els.notifyOverlay);
    renderImport();
    showToast('Notificaciones desactivadas');
  }

  function openRolPicker() {
    if (!state.rols.length) {
      showScreen('import');
      return;
    }
    renderRolList(els.rolPickerList);
    openOverlay(els.rolPickerOverlay);
  }

  function renderManageRoles() {
    var sorted = state.rols.slice().sort(function (a, b) {
      return (b.year - a.year) || (b.month - a.month);
    });
    var years = [];
    sorted.forEach(function (entry) {
      if (years.indexOf(entry.year) < 0) years.push(entry.year);
    });
    var html = '';
    years.forEach(function (year) {
      html += '<p class="manage-year">' + year + '</p>';
      sorted.forEach(function (entry) {
        if (entry.year !== year) return;
        var active = entry.id === state.activeId;
        var monthName = U.formatMonth(entry.year, entry.month).replace(/\s+de\s+\d{4}$/i, '');
        html += '<div class="manage-role' + (active ? ' is-active' : '') + '">' +
          '<button type="button" class="manage-main" data-use-role="' + U.escapeHtml(entry.id) + '">' +
          '<strong>' + U.escapeHtml(monthName) + '</strong>' +
          '<small>' + entry.rol.workers.length + ' trabajadores · ' + entry.rol.dayCount + ' días</small>' +
          '</button>' +
          '<button type="button" class="manage-edit" data-edit-role="' + U.escapeHtml(entry.id) + '">' +
          'Editar</button>' +
          '<button type="button" class="manage-del" data-delete-role="' + U.escapeHtml(entry.id) + '">' +
          'Eliminar</button>' +
          '</div>';
      });
    });
    els.manageRolesList.innerHTML = html;
  }

  function openManageRoles() {
    if (!state.rols.length) { showScreen('import'); return; }
    renderManageRoles();
    openOverlay(els.manageRolesOverlay);
  }

  function editManagedRole(id) {
    if (!entryById(id)) return;
    editRolId = id;
    closeOverlay(els.manageRolesOverlay);
    els.fileInput.click();
  }

  function useManagedRole(id) {
    var entry = entryById(id);
    if (!entry) return;
    state.activeId = id;
    currentWorker = null;
    saveState();
    refreshNotifications();
    closeOverlay(els.manageRolesOverlay);
    showScreen('import');
  }

  function deleteManagedRole(id) {
    var entry = entryById(id);
    if (!entry) return;
    var monthName = U.formatMonth(entry.year, entry.month);
    if (window.confirm && !window.confirm('¿Eliminar el rol de ' + monthName + '? Esta acción no se puede deshacer.')) {
      return;
    }
    var wasActive = state.activeId === id;
    var index = state.rols.indexOf(entry);
    state.rols.splice(index, 1);
    if (wasActive) {
      state.activeId = state.rols.length ? state.rols[Math.min(index, state.rols.length - 1)].id : null;
    }
    currentWorker = null;
    saveState();
    refreshNotifications();
    if (!state.rols.length) {
      closeOverlay(els.manageRolesOverlay);
      showScreen('import');
      showToast('Rol eliminado');
      return;
    }
    renderManageRoles();
    renderImport();
    showToast('Rol eliminado');
  }

  function selectRol(id) {
    var entry = entryById(id);
    if (!entry) return;
    state.activeId = entry.id;
    var worker = state.workerId ? U.findWorker(entry.rol, state.workerId) : null;
    currentWorker = worker;
    saveState();
    refreshNotifications();
    closeOverlay(els.rolPickerOverlay);
    if (worker) showScreen('calendar');
    else showScreen('identify');
  }

  function switchRelative(delta) {
    var index = -1;
    for (var i = 0; i < state.rols.length; i++) {
      if (state.rols[i].id === state.activeId) { index = i; break; }
    }
    var next = index + delta;
    if (next < 0 || next >= state.rols.length) return;
    selectRol(state.rols[next].id);
  }

  /* ============================================================
     Importación del PDF
     ============================================================ */

  function readFileBuffer(file) {
    if (file.arrayBuffer) return file.arrayBuffer();
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () { resolve(reader.result); };
      reader.onerror = function () { reject(reader.error || new Error('No se pudo leer el PDF.')); };
      reader.readAsArrayBuffer(file);
    });
  }

  function validateFile(file) {
    if (!file) return 'No se ha seleccionado ningún archivo.';
    if (file.size > MAX_PDF) return 'El PDF es demasiado grande (máximo 20 MB).';
    var isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name || '');
    if (!isPdf) return 'Selecciona el PDF del Rol Mensual.';
    return null;
  }

  async function importFile(file) {
    var validation = validateFile(file);
    if (validation) {
      editRolId = null;
      showImportError('No se puede usar ese archivo', validation);
      return;
    }

    var editTarget = editRolId;
    editRolId = null;
    clearImportError();
    if (!els.rolPickerOverlay.hidden) closeOverlay(els.rolPickerOverlay);
    if (!els.manageRolesOverlay.hidden) closeOverlay(els.manageRolesOverlay);
    showLoader('Leyendo el rol…');

    try {
      var buffer = await readFileBuffer(file);
      var rol = await window.RolPDF.parseRolPDF(buffer);
      if (!rol.workers.length) throw new Error('El rol no contiene trabajadores.');

      var id = makeRolId(rol.year, rol.month);
      var existing = entryById(id);
      var entry = {
        id: id,
        year: rol.year,
        month: rol.month,
        rol: rol,
        fileName: file.name || 'Rol Mensual.pdf',
        importedAt: Date.now(),
        edits: {}
      };

      var edited = editTarget ? entryById(editTarget) : null;
      if (edited) {
        var editIndex = state.rols.indexOf(edited);
        state.rols = state.rols.filter(function (item) {
          return item !== edited && item.id !== id;
        });
        state.rols.splice(Math.min(editIndex, state.rols.length), 0, entry);
      } else if (existing) {
        var index = state.rols.indexOf(existing);
        state.rols[index] = entry;
      } else {
        state.rols.push(entry);
      }
      state.rols.sort(compareRols);
      state.activeId = id;
      currentWorker = state.workerId ? U.findWorker(rol, state.workerId) : null;
      idBuffer = '';
      saveState();
      refreshNotifications();
      renderImport();
      closeOverlay(els.rolPickerOverlay);
      closeOverlay(els.manageRolesOverlay);

      if (currentWorker) showScreen('calendar');
      else showScreen('identify');

      var month = U.formatMonth(rol.year, rol.month);
      showToast(edited ? 'Rol de ' + month + ' actualizado' : (existing ? 'Rol de ' + month + ' actualizado' : 'Rol de ' + month + ' añadido'), 3400);
    } catch (e) {
      var messages = {
        ENCRYPTED: 'El PDF está protegido con contraseña. Guárdalo sin protección y vuelve a intentarlo.',
        NO_INFLATE: 'Este dispositivo no puede procesar el PDF. Actualiza el navegador o la app.',
        NOT_PDF: 'El archivo no parece un PDF válido.',
        BAD_PDF: 'El PDF está dañado o no se puede leer.',
        NO_TEXT: 'El PDF no contiene texto seleccionable. Si es un escaneo, no se puede leer.',
        NO_DAYS: 'No se han encontrado los días del mes en el PDF.',
        NO_WORKERS: 'No se han encontrado matrículas. Asegúrate de que es el Rol Mensual de GIRE.',
        NO_ROWS: 'No se ha podido leer la tabla de turnos del PDF.',
        NO_RANGE: 'No se han encontrado las fechas del mes en el PDF.'
      };
      if (currentScreen !== 'import') showScreen('import');
      showImportError(
        'No se ha podido leer el Rol',
        messages[e.code] || 'Comprueba que has seleccionado el PDF mensual correcto e inténtalo de nuevo.'
      );
      console.error(e);
    } finally {
      hideLoader();
    }
  }

  /* ============================================================
     Identificación por matrícula
     ============================================================ */

  function renderKeypad() {
    var keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', null, '0', 'back'];
    els.keypad.innerHTML = keys.map(function (key) {
      if (key === null) return '<span class="key key--ghost" aria-hidden="true"></span>';
      if (key === 'back') {
        return '<button type="button" class="key" data-key="back" aria-label="Borrar">' +
          '<svg viewBox="0 0 24 24" class="icon"><path d="M20 6H9l-5 6 5 6h11a1 1 0 001-1V7a1 1 0 00-1-1Z"/><path d="M13 10l4 4M17 10l-4 4"/></svg>' +
          '</button>';
      }
      return '<button type="button" class="key" data-key="' + key + '">' + key + '</button>';
    }).join('');
  }

  function renderIdentify() {
    ensureActive();
    var entry = activeEntry();
    if (!entry) { showScreen('import'); return; }
    els.identifyMonth.textContent = U.formatMonth(entry.year, entry.month);
    idLength = entry.rol.idLength || 7;
    els.idLengthLabel.textContent = String(idLength);
    idBuffer = '';
    els.idError.textContent = '';
    renderIdBoxes();
  }

  function renderIdBoxes() {
    var html = '';
    for (var i = 0; i < idLength; i++) {
      var filled = i < idBuffer.length;
      var next = i === idBuffer.length;
      var cls = 'id-box' + (filled ? ' is-filled' : '') + (next ? ' is-next' : '');
      html += '<span class="' + cls + '">' + (filled ? U.escapeHtml(idBuffer[i]) : '') + '</span>';
    }
    els.idBoxes.innerHTML = html;
    els.idBoxes.setAttribute('aria-label', 'Matrícula: ' + (idBuffer || 'vacía'));
  }

  function addDigit(digit) {
    if (idBuffer.length >= idLength) return;
    clearTimeout(searchTimer);
    searchSeq += 1;
    idBuffer += digit;
    els.idError.textContent = '';
    renderIdBoxes();
    if (idBuffer.length === idLength) scheduleSearch();
  }

  function removeDigit() {
    clearTimeout(searchTimer);
    searchSeq += 1;
    if (idBuffer.length) {
      idBuffer = idBuffer.slice(0, -1);
      els.idError.textContent = '';
      renderIdBoxes();
    }
  }

  function scheduleSearch() {
    clearTimeout(searchTimer);
    var seq = ++searchSeq;
    searchTimer = setTimeout(function () {
      if (seq === searchSeq && idBuffer.length === idLength) searchWorker();
    }, 240);
  }

  function searchWorker() {
    clearTimeout(searchTimer);
    var entry = activeEntry();
    if (!entry) return;
    if (idBuffer.length !== idLength) {
      els.idError.textContent = 'Escribe los ' + idLength + ' dígitos de tu matrícula.';
      return;
    }
    var worker = U.findWorker(entry.rol, idBuffer);
    if (!worker) {
      els.idError.textContent = 'No encontramos la matrícula ' + idBuffer + ' en este rol. Revísala.';
      els.idBoxes.classList.remove('is-shaking');
      void els.idBoxes.offsetWidth;
      els.idBoxes.classList.add('is-shaking');
      setTimeout(function () { els.idBoxes.classList.remove('is-shaking'); }, 420);
      if (navigator.vibrate) navigator.vibrate(45);
      return;
    }

    state.workerId = worker.id;
    saveState();
    refreshNotifications();
    currentWorker = worker;
    idBuffer = '';
    els.idError.textContent = '';
    showScreen('calendar');
    var name = firstName(worker.name);
    if (name) showToast('Hola, ' + name);
  }

  /* ============================================================
     Calendario
     ============================================================ */

  function renderCalendar() {
    ensureActive();
    var entry = activeEntry();
    if (!entry) { showScreen('import'); return; }

    var worker = currentWorker || (state.workerId ? U.findWorker(entry.rol, state.workerId) : null);
    if (!worker) { showScreen('identify'); return; }
    currentWorker = worker;

    var rol = entry.rol;
    var days = worker.days || {};
    var grid = U.monthGrid(rol.year, rol.month);
    var today = U.toKey(new Date());
    var workerEdits = (entry.edits && entry.edits[worker.id]) || {};
    els.resetEditsBtn.hidden = !Object.keys(workerEdits).length;

    els.workerAvatar.textContent = U.initials(prettyName(worker.name));
    els.workerName.textContent = prettyName(worker.name);
    els.workerSub.textContent = worker.id + ' · ' + (rol.residence || 'Rol mensual');
    els.calendarRolMonth.textContent = U.formatMonth(rol.year, rol.month);

    var index = -1;
    for (var i = 0; i < state.rols.length; i++) {
      if (state.rols[i].id === state.activeId) { index = i; break; }
    }
    els.prevRol.disabled = index <= 0;
    els.nextRol.disabled = index < 0 || index >= state.rols.length - 1;

    els.daysGrid.innerHTML = grid.map(function (cell) {
      if (!cell) return '<div class="day day--blank"></div>';
      var code = days[cell.key];
      var weekend = cell.weekday === 0 || cell.weekday === 6;
      var cls = ['day'];
      if (weekend) cls.push('is-weekend');
      if (cell.weekday === 0) cls.push('is-sunday');
      if (code) cls.push('has-code');
      if (cell.key === today) cls.push('is-today');
      var edited = Object.prototype.hasOwnProperty.call(workerEdits, cell.key);
      if (edited) cls.push('is-edited');

      var chip = '';
      var times = code ? timesForCode(code.code, code) : null;
      var timesHtml = '<span class="day-times">';
      if (times) {
        timesHtml += '<span>' + U.escapeHtml(times.start) + '</span>' +
          '<span>' + U.escapeHtml(times.end) + '</span>';
      }
      timesHtml += '</span>';
      if (code) {
        chip = '<span class="code" style="color:' + codeInk(code.color) +
          ';background:' + U.hexToRgba(code.color, 0.13) +
          ';border-color:' + U.hexToRgba(code.color, 0.30) + '">' +
          U.escapeHtml(code.code) + '</span>';
      }

      var label = U.formatLongDate(cell.key) + ': ' + (code ? code.code : 'sin turno');
      if (times) label += ' (' + times.start + ' a ' + times.end + ')';
      if (edited) label += ' · clave editada';
      return '<button type="button" class="' + cls.join(' ') + '" data-date="' + cell.key +
        '" aria-label="' + U.escapeHtml(label) + '">' +
        '<span class="day-num">' + cell.day + '</span>' + timesHtml + chip + '</button>';
    }).join('');
  }

  /* ============================================================
     Detalle del día
     ============================================================ */

  function reservaInfo(color) {
    var rgb = hexToRgb(color);
    if (rgb.b > 110 && rgb.r > 70 && rgb.r < 200 && rgb.g < 90) {
      return {
        tone: 'purple',
        kind: 'Reserva de tarde',
        start: '14:15',
        end: '21:28',
        note: 'reserva de tarde (R morada)'
      };
    }
    if (rgb.b > 140 && rgb.r < 90 && rgb.g < 90) {
      return {
        tone: 'blue',
        kind: 'Reserva de mañana',
        start: '05:40',
        end: '12:53',
        note: 'reserva de mañana (R azul)'
      };
    }
    return null;
  }

  function timesForCode(code, entry) {
    if (!code) return null;
    if (String(code).toUpperCase() === 'R') {
      var info = reservaInfo(entry.color);
      return info ? { start: info.start, end: info.end } : null;
    }
    if (/^\d{3,4}$/.test(code)) return SHIFT_TIMES[code] || null;
    return null;
  }

  function renderReserve(entry) {
    var info = reservaInfo(entry.color);
    if (!info) {
      return '<div class="reserve-card">' +
        '<div class="reserve-head"><span class="reserve-badge">Reserva</span></div>' +
        '</div>';
    }
    return '<div class="reserve-card' + (info.tone === 'blue' ? ' reserve-card--blue' : '') + '">' +
      '<div class="reserve-head"><span class="reserve-badge">Reserva</span>' +
      '<span class="reserve-kind">' + info.kind + '</span></div>' +
      '<div class="reserve-times"><b>' + info.start + '</b><span>→</span><b>' + info.end + '</b></div>' +
      '<div class="reserve-track">' +
      '<span class="reserve-dot reserve-dot--start"></span>' +
      '<span class="reserve-dot reserve-dot--end"></span>' +
      '</div>' +
      '</div>';
  }

  function renderGraph(code) {
    // Las imágenes van incrustadas en shift-images.js: no dependen de file://.
    var src = SHIFT_IMAGE_DATA[code] || ('assets/shifts/' + encodeURIComponent(code) + '.webp');
    return '<div class="graph-card">' +
      '<div class="graph-scroll"><img src="' + src + '" alt="Horario del turno ' +
      U.escapeHtml(code) + '" loading="eager" ' +
      'onerror="this.closest(\'.graph-card\').classList.add(\'is-missing\')"></div>' +
      '<div class="graph-fallback">No se ha encontrado la imagen del Gráfico para esta clave.</div>' +
      '<p class="graph-hint">Desliza para ver todo el turno. Los minutos bajo la línea indican la hora de cada parada.</p>' +
      '</div>';
  }

  function updateKeyEditUI() {
    if (!els.editKeyBtn) return;
    els.editKeyBtn.textContent = editKeyMode ? 'Cancelar edición' : 'Editar clave';
    if (editKeyMode) {
      els.editKeyBtn.classList.add('is-active');
      els.daysGrid.classList.add('is-editing');
    } else {
      els.editKeyBtn.classList.remove('is-active');
      els.daysGrid.classList.remove('is-editing');
    }
    els.keyEditBanner.hidden = !editKeyMode;
  }

  function setKeyEditMode(on) {
    editKeyMode = on;
    updateKeyEditUI();
  }

  function keyColorFor(code) {
    var upper = code.toUpperCase();
    for (var r = 0; r < state.rols.length; r++) {
      var workers = state.rols[r].rol.workers || [];
      for (var w = 0; w < workers.length; w++) {
        var days = workers[w].days || {};
        for (var day in days) {
          if (days[day].code && days[day].code.toUpperCase() === upper) return days[day].color;
        }
      }
    }
    if (upper === 'R') return '#800080';
    if (/^(LIBR|DCOM|VB|FA|E|JT|LY|LZ|FS)$/.test(upper)) return '#004400';
    return '#000000';
  }

  function openEditKey(dateKey) {
    if (!currentWorker) return;
    editKeyDate = dateKey;
    var entry = currentWorker.days ? currentWorker.days[dateKey] : null;
    var current = entry ? entry.code : '';
    els.editKeyTitle.textContent = 'Cambiar clave · ' + U.formatLongDate(dateKey);
    els.editKeyCurrent.textContent = current ? 'Ahora: ' + current : 'Este día no tiene clave.';
    els.newKeyInput.value = current;
    els.editKeyError.textContent = '';
    openOverlay(els.editKeyOverlay);
    setTimeout(function () {
      els.newKeyInput.focus();
      if (els.newKeyInput.select) els.newKeyInput.select();
    }, 80);
  }

  function saveEditedKey(e) {
    if (e) e.preventDefault();
    if (!editKeyDate || !currentWorker) return;
    var code = (els.newKeyInput.value || '').trim().toUpperCase().replace(/\s+/g, '');
    if (!/^[A-Z0-9]{1,8}$/.test(code)) {
      els.editKeyError.textContent = 'Escribe una clave de 1 a 8 letras o números.';
      return;
    }
    var expectedLetter = SHIFT_DAYS[code];
    if (expectedLetter && expectedLetter !== 'D') {
      var actualLetter = DAY_LETTERS[U.parseKey(editKeyDate).getDay()];
      if (actualLetter !== expectedLetter) {
        els.editKeyError.textContent = 'El día y la clave no concuerdan';
        return;
      }
    }
    if (!currentWorker.days) currentWorker.days = {};
    var entry = activeEntry();
    if (entry) {
      entry.edits = entry.edits || {};
      var edits = entry.edits[currentWorker.id] || (entry.edits[currentWorker.id] = {});
      var hadOriginal = Object.prototype.hasOwnProperty.call(edits, editKeyDate);
      if (!hadOriginal) {
        var previous = currentWorker.days[editKeyDate];
        edits[editKeyDate] = previous ? { code: previous.code, color: previous.color } : null;
      }
      var original = edits[editKeyDate];
      if (original && original.code === code) {
        currentWorker.days[editKeyDate] = { code: original.code, color: original.color };
        delete edits[editKeyDate];
        if (!Object.keys(edits).length) delete entry.edits[currentWorker.id];
      } else {
        currentWorker.days[editKeyDate] = { code: code, color: keyColorFor(code) };
      }
    } else {
      currentWorker.days[editKeyDate] = { code: code, color: keyColorFor(code) };
    }
    saveState();
    refreshNotifications();
    setKeyEditMode(false);
    closeOverlay(els.editKeyOverlay);
    renderCalendar();
    showToast('Clave actualizada: ' + code);
  }

  function resetEditedKeys() {
    var entry = activeEntry();
    if (!entry || !entry.edits || !currentWorker) return;
    var edits = entry.edits[currentWorker.id];
    if (!edits || !Object.keys(edits).length) return;
    if (window.confirm && !window.confirm('¿Restablecer las claves originales de este calendario? Se perderán las claves editadas.')) {
      return;
    }
    Object.keys(edits).forEach(function (dateKey) {
      var original = edits[dateKey];
      if (!currentWorker.days) currentWorker.days = {};
      if (original) currentWorker.days[dateKey] = { code: original.code, color: original.color };
      else delete currentWorker.days[dateKey];
    });
    delete entry.edits[currentWorker.id];
    saveState();
    refreshNotifications();
    renderCalendar();
    showToast('Claves originales restablecidas');
  }

  function openDay(key) {
    if (!currentWorker) return;
    var entry = currentWorker.days ? currentWorker.days[key] : null;
    var long = U.formatLongDate(key);
    var comma = long.indexOf(', ');
    var weekday = comma >= 0 ? long.slice(0, comma) : '';
    var rest = comma >= 0 ? long.slice(comma + 2) : long;
    var dayNumber = U.parseKey(key).getDate();
    var total = activeRol() ? activeRol().dayCount : 0;
    var code = entry ? entry.code : null;
    var upper = code ? code.toUpperCase() : '';
    var dayTimes = entry ? timesForCode(entry.code, entry) : null;
    var span = dayTimes ? ' · ' + dayTimes.start + '–' + dayTimes.end : '';

    els.daySheetWeekday.textContent = weekday;
    els.daySheetTitle.textContent = rest;

    if (!entry) {
      els.dayCodeCaption.textContent = 'Sin turno asignado';
      els.shiftDetail.innerHTML = '<div class="no-graph">Este día no tiene ninguna clave en el Rol.</div>';
    } else if (upper === 'R') {
      els.dayCodeCaption.textContent = 'Reserva' + span;
      els.shiftDetail.innerHTML = renderReserve(entry);
    } else if (/^\d{3,4}$/.test(entry.code) && SHIFT_IMAGES.has(entry.code)) {
      els.dayCodeCaption.textContent = 'Turno' + (span || ' · clave del Rol');
      els.shiftDetail.innerHTML = renderGraph(entry.code);
      var graphImg = els.shiftDetail.querySelector('img');
      if (graphImg) {
        graphImg.addEventListener('error', function () {
          this.closest('.graph-card').classList.add('is-missing');
        });
      }
    } else {
      els.dayCodeCaption.textContent = 'Código del Rol';
      els.shiftDetail.innerHTML = '<div class="no-graph">Este código no tiene línea horaria en el Gráfico de turnos.</div>';
    }

    els.dayMeta.innerHTML =
      '<div><small>Día</small><strong>' + dayNumber + ' de ' + total + '</strong></div>' +
      '<div><small>Clave</small><strong>' + U.escapeHtml(entry ? entry.code : 'Sin turno') + '</strong></div>';

    openOverlay(els.dayOverlay);
  }

  /* ============================================================
     Eventos
     ============================================================ */

  function bindEvents() {
    els.pickPdf.addEventListener('click', function () { editRolId = null; els.fileInput.click(); });
    els.manageRolsBtn.addEventListener('click', openManageRoles);
    els.notifyBtn.addEventListener('click', function (e) {
      if (e.target && e.target.closest && e.target.closest('.notify-switch')) {
        if (state.notifications.enabled) disableNotifications();
        else openNotifications();
        return;
      }
      openNotifications();
    });
    els.notifySave.addEventListener('click', saveNotifications);
    els.notifyDisable.addEventListener('click', disableNotifications);
    els.addAnotherRol.addEventListener('click', function () { editRolId = null; els.fileInput.click(); });
    els.addRol.addEventListener('click', function () { editRolId = null; els.fileInput.click(); });
    els.pickerAddRol.addEventListener('click', function () {
      editRolId = null;
      closeOverlay(els.rolPickerOverlay);
      els.fileInput.click();
    });

    els.fileInput.addEventListener('change', function () {
      var file = els.fileInput.files && els.fileInput.files[0];
      els.fileInput.value = '';
      if (file) importFile(file);
    });

    ['dragenter', 'dragover'].forEach(function (ev) {
      els.uploadCard.addEventListener(ev, function (e) {
        e.preventDefault();
        els.uploadCard.classList.add('is-drag');
      });
    });
    ['dragleave', 'drop'].forEach(function (ev) {
      els.uploadCard.addEventListener(ev, function (e) {
        e.preventDefault();
        els.uploadCard.classList.remove('is-drag');
      });
    });
    els.uploadCard.addEventListener('drop', function (e) {
      var file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (file) { editRolId = null; importFile(file); }
    });

    els.continueBtn.addEventListener('click', function () {
      var entry = activeEntry();
      if (!entry) { showScreen('import'); return; }
      var worker = state.workerId ? U.findWorker(entry.rol, state.workerId) : null;
      if (worker) {
        currentWorker = worker;
        showScreen('calendar');
      } else {
        showScreen('identify');
      }
    });

    els.identifyBack.addEventListener('click', function () { showScreen('import'); });
    els.replaceRolBtn.addEventListener('click', function () { showScreen('import'); });
    els.backToIdentify.addEventListener('click', function () { showScreen('import'); });
    els.changeWorkerHome.addEventListener('click', function () { showScreen('identify'); });
    els.menuBtn.addEventListener('click', function () { openOverlay(els.menuOverlay); });

    els.identifyMonth.addEventListener('click', openRolPicker);
    els.openRolPicker.addEventListener('click', openRolPicker);
    els.prevRol.addEventListener('click', function () { switchRelative(-1); });
    els.nextRol.addEventListener('click', function () { switchRelative(1); });

    els.importRolSelect.addEventListener('change', function () {
      if (els.importRolSelect.value) selectRol(els.importRolSelect.value);
    });
    els.rolPickerList.addEventListener('click', function (e) {
      var row = e.target.closest('[data-rol-id]');
      if (row) selectRol(row.getAttribute('data-rol-id'));
    });
    els.manageRolesList.addEventListener('click', function (e) {
      var del = e.target.closest('[data-delete-role]');
      if (del) { deleteManagedRole(del.getAttribute('data-delete-role')); return; }
      var edit = e.target.closest('[data-edit-role]');
      if (edit) { editManagedRole(edit.getAttribute('data-edit-role')); return; }
      var use = e.target.closest('[data-use-role]');
      if (use) useManagedRole(use.getAttribute('data-use-role'));
    });
    els.manageAddRol.addEventListener('click', function () {
      editRolId = null;
      closeOverlay(els.manageRolesOverlay);
      els.fileInput.click();
    });

    els.keypad.addEventListener('click', function (e) {
      var button = e.target.closest('[data-key]');
      if (!button) return;
      var key = button.getAttribute('data-key');
      if (key === 'back') removeDigit();
      else addDigit(key);
    });

    els.searchBtn.addEventListener('click', searchWorker);

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        if (!els.dayOverlay.hidden) closeOverlay(els.dayOverlay);
        else if (!els.editKeyOverlay.hidden) closeOverlay(els.editKeyOverlay);
        else if (!els.menuOverlay.hidden) closeOverlay(els.menuOverlay);
        else if (!els.rolPickerOverlay.hidden) closeOverlay(els.rolPickerOverlay);
        else if (!els.manageRolesOverlay.hidden) closeOverlay(els.manageRolesOverlay);
        else if (!els.notifyOverlay.hidden) closeOverlay(els.notifyOverlay);
        return;
      }
      if (currentScreen !== 'identify') return;
      if (!els.dayOverlay.hidden || !els.editKeyOverlay.hidden || !els.menuOverlay.hidden || !els.rolPickerOverlay.hidden || !els.manageRolesOverlay.hidden || !els.notifyOverlay.hidden) return;
      if (e.target && /^(INPUT|TEXTAREA)$/.test(e.target.tagName)) return;

      if (/^[0-9]$/.test(e.key)) {
        e.preventDefault();
        addDigit(e.key);
      } else if (e.key === 'Backspace') {
        e.preventDefault();
        removeDigit();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        searchWorker();
      }
    });

    document.querySelectorAll('[data-close]').forEach(function (button) {
      button.addEventListener('click', function () {
        var overlay = $(button.getAttribute('data-close'));
        if (overlay) closeOverlay(overlay);
      });
    });

    [els.dayOverlay, els.editKeyOverlay, els.menuOverlay, els.rolPickerOverlay, els.manageRolesOverlay, els.notifyOverlay].forEach(function (overlay) {
      overlay.addEventListener('click', function (e) {
        if (e.target === overlay) closeOverlay(overlay);
      });
    });

    els.daysGrid.addEventListener('click', function (e) {
      var button = e.target.closest('[data-date]');
      if (!button) return;
      if (editKeyMode) openEditKey(button.getAttribute('data-date'));
      else openDay(button.getAttribute('data-date'));
    });

    els.editKeyBtn.addEventListener('click', function () {
      setKeyEditMode(!editKeyMode);
    });
    els.resetEditsBtn.addEventListener('click', resetEditedKeys);
    els.cancelKeyEdit.addEventListener('click', function () {
      setKeyEditMode(false);
    });
    els.cancelEditKey.addEventListener('click', function () {
      setKeyEditMode(false);
      closeOverlay(els.editKeyOverlay);
    });
    els.editKeyForm.addEventListener('submit', saveEditedKey);
    els.newKeyInput.addEventListener('input', function () {
      var pos = els.newKeyInput.selectionStart;
      els.newKeyInput.value = els.newKeyInput.value.toUpperCase();
      if (typeof pos === 'number') els.newKeyInput.setSelectionRange(pos, pos);
    });

    els.menuChangeWorker.addEventListener('click', function () {
      closeOverlay(els.menuOverlay);
      setTimeout(function () { showScreen('identify'); }, 180);
    });
    els.menuChangeRol.addEventListener('click', function () {
      editRolId = null;
      closeOverlay(els.menuOverlay);
      els.fileInput.click();
    });
    if (window.matchMedia) {
      var media = window.matchMedia('(prefers-color-scheme: dark)');
      var onChange = function () {
        if (currentScreen === 'calendar') renderCalendar();
      };
      if (media.addEventListener) media.addEventListener('change', onChange);
      else if (media.addListener) media.addListener(onChange);
    }
  }

  /* ============================================================
     Integración con Android (botón atrás)
     ============================================================ */

  window.__miRolBack = function () {
    if (!els.dayOverlay.hidden) { closeOverlay(els.dayOverlay); return true; }
    if (!els.editKeyOverlay.hidden) { closeOverlay(els.editKeyOverlay); return true; }
    if (!els.menuOverlay.hidden) { closeOverlay(els.menuOverlay); return true; }
    if (!els.rolPickerOverlay.hidden) { closeOverlay(els.rolPickerOverlay); return true; }
    if (!els.manageRolesOverlay.hidden) { closeOverlay(els.manageRolesOverlay); return true; }
    if (!els.notifyOverlay.hidden) { closeOverlay(els.notifyOverlay); return true; }
    if (currentScreen === 'calendar' && editKeyMode) { setKeyEditMode(false); return true; }
    if (currentScreen === 'calendar') { showScreen('import'); return true; }
    if (currentScreen === 'identify') { showScreen('import'); return true; }
    return false;
  };

  /* ============================================================
     Arranque
     ============================================================ */

  function registerSW() {
    if (!('serviceWorker' in navigator)) return;
    if (!/^https?:$/.test(location.protocol)) return;
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('sw.js').catch(function () { /* sin conexión, no pasa nada */ });
    });
  }

  function init() {
    cacheElements();
    loadState();
    bindEvents();
    renderKeypad();
    registerSW();

    if (state.rols.length) {
      renderImport();
      var entry = activeEntry();
      var worker = entry && state.workerId ? U.findWorker(entry.rol, state.workerId) : null;
      if (worker) {
        currentWorker = worker;
        showScreen('calendar');
      } else {
        currentWorker = null;
        showScreen('identify');
      }
    } else {
      showScreen('import');
    }
    if (state.notifications.enabled) refreshNotifications();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
