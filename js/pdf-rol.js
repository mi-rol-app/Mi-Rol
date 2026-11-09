/*
 * Lector de "Rol Mensual" de GIRE (PDF).
 * Extrae la tabla de trabajadores y claves sin dependencias externas.
 * Funciona en el navegador (DecompressionStream) y en Node (zlib).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.RolPDF = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var nodeZlib = null;
  if (typeof require === 'function') {
    try { nodeZlib = require('zlib'); } catch (e) { /* navegador */ }
  }

  var tinyInflate = (typeof globalThis !== 'undefined' && globalThis.tinyInflate) || null;

  var WS = { 0: 1, 9: 1, 10: 1, 12: 1, 13: 1, 32: 1 };
  var DELIM = { 40: 1, 41: 1, 60: 1, 62: 1, 91: 1, 93: 1, 123: 1, 125: 1, 47: 1, 37: 1 };

  function PdfError(message, code) {
    this.name = 'PdfError';
    this.message = message;
    this.code = code || 'PDF_ERROR';
    if (Error.captureStackTrace) Error.captureStackTrace(this, PdfError);
  }
  PdfError.prototype = Object.create(Error.prototype);
  PdfError.prototype.constructor = PdfError;

  function isWS(c) { return WS[c] === 1; }
  function isDelim(c) { return DELIM[c] === 1; }
  function isNumStart(c) {
    return (c >= 48 && c <= 57) || c === 43 || c === 45 || c === 46;
  }

  function bytesToBinary(bytes) {
    var out = '';
    var chunk = 0x8000;
    for (var i = 0; i < bytes.length; i += chunk) {
      out += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    }
    return out;
  }

  function binaryToBytes(str) {
    var out = new Uint8Array(str.length);
    for (var i = 0; i < str.length; i++) out[i] = str.charCodeAt(i) & 0xff;
    return out;
  }

  var winDecoder = null;
  var utf16Decoder = null;

  function decodeText(bytes) {
    if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
      if (!utf16Decoder) utf16Decoder = new TextDecoder('utf-16be');
      return utf16Decoder.decode(bytes.subarray(2));
    }
    if (!winDecoder) winDecoder = new TextDecoder('windows-1252');
    return winDecoder.decode(bytes);
  }

  async function inflate(bytes) {
    if (nodeZlib) {
      try { return new Uint8Array(nodeZlib.inflateSync(Buffer.from(bytes))); }
      catch (e) {
        try { return new Uint8Array(nodeZlib.inflateRawSync(Buffer.from(bytes))); }
        catch (e2) { throw new PdfError('No se ha podido descomprimir el PDF.', 'INFLATE'); }
      }
    }
    if (typeof DecompressionStream === 'function') {
      var formats = ['deflate', 'deflate-raw'];
      for (var i = 0; i < formats.length; i++) {
        try {
          var stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream(formats[i]));
          return new Uint8Array(await new Response(stream).arrayBuffer());
        } catch (e) { /* prueba el siguiente */ }
      }
    }
    if (tinyInflate) {
      try {
        var out = new Uint8Array(4 * 1024 * 1024);
        var raw = bytes;
        if (bytes.length > 6 && (bytes[0] & 0x0f) === 8 && ((bytes[0] << 8) + bytes[1]) % 31 === 0) {
          raw = bytes.subarray(2, bytes.length - 4);
        }
        return tinyInflate(raw, out);
      } catch (e2) { /* sigue abajo */ }
    }
    throw new PdfError('Este dispositivo no puede descomprimir el PDF. Actualiza el navegador.', 'NO_INFLATE');
  }

  function readLiteral(bin, i) {
    var bytes = [];
    var depth = 1;
    i += 1;
    while (i < bin.length && depth > 0) {
      var c = bin.charCodeAt(i);
      if (c === 92) { // barra invertida
        var n = bin.charCodeAt(i + 1);
        if (n === 110) { bytes.push(10); i += 2; continue; }
        if (n === 114) { bytes.push(13); i += 2; continue; }
        if (n === 116) { bytes.push(9); i += 2; continue; }
        if (n === 98) { bytes.push(8); i += 2; continue; }
        if (n === 102) { bytes.push(12); i += 2; continue; }
        if (n === 40 || n === 41 || n === 92) { bytes.push(n); i += 2; continue; }
        if (n >= 48 && n <= 55) {
          var oct = '';
          var k = i + 1;
          while (k < bin.length && oct.length < 3 && bin.charCodeAt(k) >= 48 && bin.charCodeAt(k) <= 55) {
            oct += bin[k]; k += 1;
          }
          bytes.push(parseInt(oct, 8) & 0xff);
          i = k; continue;
        }
        if (n === 13) { i += 2; if (bin[i] === '\n') i += 1; continue; }
        if (n === 10) { i += 2; continue; }
        bytes.push(n & 0xff); i += 2; continue;
      }
      if (c === 40) depth += 1;
      else if (c === 41) {
        depth -= 1;
        if (depth === 0) { i += 1; break; }
      }
      bytes.push(c & 0xff);
      i += 1;
    }
    return [new Uint8Array(bytes), i];
  }

  function readHex(bin, i) {
    var end = bin.indexOf('>', i + 1);
    if (end < 0) end = bin.length;
    var hex = bin.slice(i + 1, end).replace(/\s+/g, '');
    if (hex.length % 2) hex += '0';
    var bytes = new Uint8Array(hex.length / 2);
    for (var k = 0; k < bytes.length; k++) {
      bytes[k] = parseInt(hex.substr(k * 2, 2), 16) || 0;
    }
    return [bytes, end + 1];
  }

  function readName(bin, i) {
    var j = i + 1;
    while (j < bin.length && !isWS(bin.charCodeAt(j)) && !isDelim(bin.charCodeAt(j))) j += 1;
    return [bin.slice(i + 1, j), j];
  }

  function readArrayTokens(bin, i) {
    var items = [];
    i += 1;
    while (i < bin.length && bin[i] !== ']') {
      var c = bin.charCodeAt(i);
      if (isWS(c)) { i += 1; continue; }
      if (c === 40) {
        var lit = readLiteral(bin, i);
        items.push({ type: 'str', value: lit[0] });
        i = lit[1]; continue;
      }
      if (c === 60 && bin[i + 1] !== '<') {
        var hx = readHex(bin, i);
        items.push({ type: 'str', value: hx[0] });
        i = hx[1]; continue;
      }
      if (c === 47) {
        var nm = readName(bin, i);
        items.push({ type: 'name', value: nm[0] });
        i = nm[1]; continue;
      }
      if (c === 40) { i += 1; continue; }
      if (isNumStart(c)) {
        var j = i + 1;
        while (j < bin.length && /[0-9.+\-]/.test(bin[j])) j += 1;
        var num = parseFloat(bin.slice(i, j));
        if (!isNaN(num)) items.push(num);
        i = j; continue;
      }
      i += 1;
    }
    return [items, i + 1];
  }

  function skipDictionary(bin, i) {
    var depth = 0;
    while (i < bin.length) {
      if (bin[i] === '<' && bin[i + 1] === '<') { depth += 1; i += 2; continue; }
      if (bin[i] === '>' && bin[i + 1] === '>') {
        depth -= 1; i += 2;
        if (depth <= 0) return i;
        continue;
      }
      i += 1;
    }
    return i;
  }

  function clamp(v) { return Math.max(0, Math.min(255, Math.round(v * 255))); }

  function rgbHex(color) {
    return '#' + color.map(function (v) {
      return clamp(v).toString(16).padStart(2, '0');
    }).join('');
  }

  function normalizeInk(hex) {
    var h = hex.toLowerCase();
    // Texto blanco (por ejemplo DCOM sobre fondo rojo): en la app se pinta sobre claro.
    if (h === '#ffffff' || h === '#fefefe' || h === '#fffffe') return '#b42318';
    return hex;
  }

  function parseContent(bin, runs) {
    var i = 0;
    var n = bin.length;
    var stack = [];
    var tm = [1, 0, 0, 1, 0, 0];
    var fill = [0, 0, 0];
    var fillStack = [];
    var leading = 0;
    var text = '';
    var textX = 0;
    var textY = 0;
    var textColor = [0, 0, 0];
    var inText = false;

    function flush() {
      if (!text) return;
      var value = text.replace(/\u0000/g, '');
      if (value.trim()) {
        runs.push({
          x: textX,
          y: textY,
          text: value,
          color: normalizeInk(rgbHex(textColor))
        });
      }
      text = '';
    }

    function handle(op, args) {
      switch (op) {
        case 'BT':
          inText = true;
          tm = [1, 0, 0, 1, 0, 0];
          text = '';
          break;
        case 'ET':
          flush();
          inText = false;
          break;
        case 'q':
          fillStack.push(fill.slice());
          break;
        case 'Q':
          if (fillStack.length) fill = fillStack.pop();
          break;
        case 'Tm':
          if (inText) flush();
          if (args.length >= 6) tm = args.slice(-6).map(Number);
          break;
        case 'Td':
          if (inText) flush();
          if (args.length >= 2) {
            tm[4] += Number(args[args.length - 2]) || 0;
            tm[5] += Number(args[args.length - 1]) || 0;
          }
          break;
        case 'TD':
          if (inText) flush();
          if (args.length >= 2) {
            tm[4] += Number(args[args.length - 2]) || 0;
            tm[5] += Number(args[args.length - 1]) || 0;
            leading = -(Number(args[args.length - 1]) || 0);
          }
          break;
        case 'T*':
          if (inText) flush();
          tm[5] -= leading;
          break;
        case 'TL':
          leading = Number(args[0]) || 0;
          break;
        case 'rg':
          if (args.length >= 3) fill = args.slice(-3).map(Number);
          break;
        case 'g':
          if (args.length >= 1) {
            var g = Number(args[args.length - 1]) || 0;
            fill = [g, g, g];
          }
          break;
        case 'k':
          if (args.length >= 4) {
            var c = Number(args[args.length - 4]) || 0;
            var m = Number(args[args.length - 3]) || 0;
            var y = Number(args[args.length - 2]) || 0;
            var kk = Number(args[args.length - 1]) || 0;
            fill = [
              (1 - c) * (1 - kk),
              (1 - m) * (1 - kk),
              (1 - y) * (1 - kk)
            ];
          }
          break;
        case 'TJ':
          if (args.length && args[args.length - 1] && args[args.length - 1].type === 'arr') {
            var arr = args[args.length - 1].value;
            var s = '';
            for (var a = 0; a < arr.length; a++) {
              if (arr[a] && arr[a].type === 'str') s += decodeText(arr[a].value);
            }
            if (s) {
              text += s;
              textX = tm[4];
              textY = tm[5];
              textColor = fill.slice();
            }
          }
          break;
        case 'Tj':
          if (args.length && args[args.length - 1] && args[args.length - 1].type === 'str') {
            text += decodeText(args[args.length - 1].value);
            textX = tm[4];
            textY = tm[5];
            textColor = fill.slice();
          }
          break;
        case "'":
          if (inText) flush();
          tm[5] -= leading;
          if (args.length && args[args.length - 1] && args[args.length - 1].type === 'str') {
            text += decodeText(args[args.length - 1].value);
            textX = tm[4];
            textY = tm[5];
            textColor = fill.slice();
          }
          break;
        case '"':
          if (inText) flush();
          if (args.length >= 3) leading = -Number(args[args.length - 2]) || leading;
          tm[5] -= leading;
          if (args.length && args[args.length - 1] && args[args.length - 1].type === 'str') {
            text += decodeText(args[args.length - 1].value);
            textX = tm[4];
            textY = tm[5];
            textColor = fill.slice();
          }
          break;
        default:
          break;
      }
    }

    while (i < n) {
      var c = bin.charCodeAt(i);
      if (isWS(c)) { i += 1; continue; }
      if (c === 37) { // %
        while (i < n && bin[i] !== '\n' && bin[i] !== '\r') i += 1;
        continue;
      }
      if (c === 40) {
        var lit = readLiteral(bin, i);
        stack.push({ type: 'str', value: lit[0] });
        i = lit[1];
        continue;
      }
      if (c === 60) {
        if (bin[i + 1] === '<') { i = skipDictionary(bin, i); continue; }
        var hx = readHex(bin, i);
        stack.push({ type: 'str', value: hx[0] });
        i = hx[1];
        continue;
      }
      if (c === 91) {
        var arr = readArrayTokens(bin, i);
        stack.push({ type: 'arr', value: arr[0] });
        i = arr[1];
        continue;
      }
      if (c === 93 || c === 62) { i += 1; continue; }
      if (c === 47) {
        var nm = readName(bin, i);
        stack.push({ type: 'name', value: nm[0] });
        i = nm[1];
        continue;
      }
      if (isNumStart(c)) {
        var j = i + 1;
        while (j < n && /[0-9.+\-]/.test(bin[j])) j += 1;
        var num = parseFloat(bin.slice(i, j));
        if (!isNaN(num)) stack.push(num);
        i = j;
        continue;
      }
      if (isDelim(c)) { i += 1; continue; }
      var opStart = i;
      while (i < n && !isWS(bin.charCodeAt(i)) && !isDelim(bin.charCodeAt(i))) i += 1;
      if (i === opStart) { i += 1; continue; }
      var op = bin.slice(opStart, i);
      handle(op, stack);
      stack = [];
    }
    flush();
  }

  function getObjects(bin) {
    var re = /(\d+)\s+(\d+)\s+obj\b/g;
    var objects = new Map();
    var m;
    while ((m = re.exec(bin))) {
      var start = re.lastIndex;
      var end = bin.indexOf('endobj', start);
      if (end < 0) break;
      if (!objects.has(Number(m[1]))) objects.set(Number(m[1]), bin.slice(start, end));
      re.lastIndex = end + 6;
    }
    return objects;
  }

  async function streamData(body) {
    var streamAt = body.indexOf('stream');
    if (streamAt < 0) return null;
    var header = body.slice(0, streamAt);
    var start = streamAt + 6;
    if (body[start] === '\r' && body[start + 1] === '\n') start += 2;
    else if (body[start] === '\n' || body[start] === '\r') start += 1;
    var end = body.lastIndexOf('endstream');
    if (end < 0) end = body.length;
    var raw = body.slice(start, end);
    if (/\/FlateDecode/.test(header)) {
      return await inflate(binaryToBytes(raw));
    }
    return binaryToBytes(raw);
  }

  function clean(s) {
    return String(s).replace(/\s+/g, ' ').trim();
  }

  function extractTable(runs) {
    var byY = new Map();
    runs.forEach(function (r) {
      var key = Math.round(r.y * 100) / 100;
      if (!byY.has(key)) byY.set(key, []);
      byY.get(key).push(r);
    });

    var header = null;
    byY.forEach(function (list, y) {
      var matches = list.filter(function (r) {
        return /^\d{1,2}\s+[DLMXJVSS]$/.test(clean(r.text));
      });
      if (matches.length >= 15 && (!header || matches.length > header.length)) {
        header = matches.map(function (r) {
          var m = clean(r.text).match(/^(\d{1,2})\s+([DLMXJVSS])$/);
          return { day: Number(m[1]), weekday: m[2], x: r.x, y: r.y };
        }).sort(function (a, b) { return a.x - b.x; });
      }
    });

    if (!header || header.length < 10) {
      throw new PdfError('No se han encontrado los días del Rol en el PDF.', 'NO_DAYS');
    }

    // Elimina columnas duplicadas por si el PDF dibuja el encabezado dos veces.
    var seenDays = {};
    header = header.filter(function (h) {
      if (seenDays[h.day]) return false;
      seenDays[h.day] = true;
      return true;
    });

    var firstX = header[0].x;
    var gaps = [];
    for (var i = 1; i < header.length; i++) gaps.push(header[i].x - header[i - 1].x);
    var minGap = gaps.length ? Math.min.apply(null, gaps) : 18;
    var tolerance = Math.min(9, minGap * 0.48);

    var idRuns = runs.filter(function (r) {
      return /^\d{6,8}$/.test(clean(r.text)) && r.x < firstX - 60;
    }).sort(function (a, b) { return b.y - a.y; });

    if (!idRuns.length) {
      throw new PdfError('No se han encontrado matrículas en el PDF. ¿Es el Rol Mensual?', 'NO_WORKERS');
    }

    var rowYs = [];
    idRuns.forEach(function (r) {
      var y = Math.round(r.y * 100) / 100;
      if (!rowYs.some(function (v) { return Math.abs(v - y) < 1.5; })) rowYs.push(y);
    });
    rowYs.sort(function (a, b) { return b - a; });

    var metaText = runs.filter(function (r) { return r.y > header[0].y + 2; })
      .map(function (r) { return r.text; }).join(' ');

    var range = metaText.match(/(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2})\/(\d{2})\/(\d{4})/);
    var startDate;
    if (range) {
      startDate = new Date(Number(range[3]), Number(range[2]) - 1, Number(range[1]), 12);
    } else {
      throw new PdfError('No se ha podido leer el mes del Rol (faltan las fechas).', 'NO_RANGE');
    }

    var residenceRun = runs.filter(function (r) {
      return /Residencia\s*:/i.test(r.text) && r.y > header[0].y;
    })[0];
    var residence = residenceRun ? residenceRun.text.replace(/^.*?Residencia\s*:\s*/i, '').trim() : '';

    var generated = null;
    var genMatch = metaText.match(/(\d{2}\/\d{2}\/\d{4}\s+\d{2}:\d{2})/);
    if (genMatch) generated = genMatch[1];

    var month = startDate.getMonth() + 1;
    var year = startDate.getFullYear();

    function keyForOffset(offset) {
      var d = new Date(year, month - 1, startDate.getDate() + offset, 12);
      var mm = String(d.getMonth() + 1).padStart(2, '0');
      var dd = String(d.getDate()).padStart(2, '0');
      return d.getFullYear() + '-' + mm + '-' + dd;
    }

    var workers = [];
    rowYs.forEach(function (y) {
      var rowRuns = runs.filter(function (r) { return Math.abs(r.y - y) < 1.2; });
      var idRun = rowRuns.filter(function (r) {
        return /^\d{6,8}$/.test(clean(r.text)) && r.x < firstX - 60;
      }).sort(function (a, b) { return a.x - b.x; })[0];
      if (!idRun) return;

      var nameParts = rowRuns.filter(function (r) {
        var t = clean(r.text);
        return r.x > idRun.x + 5 && r.x < firstX - 10 && t && !/^\d{6,8}$/.test(t);
      }).sort(function (a, b) { return a.x - b.x; });
      var name = nameParts.map(function (r) { return clean(r.text); }).join(' ').trim();

      var cells = rowRuns.filter(function (r) { return r.x >= firstX - 12; });
      var perDay = {};
      cells.forEach(function (r) {
        var best = null;
        var bestDist = Infinity;
        for (var k = 0; k < header.length; k++) {
          var dist = Math.abs(header[k].x - r.x);
          if (dist < bestDist) { bestDist = dist; best = header[k]; }
        }
        if (!best || bestDist > tolerance) return;
        if (!perDay[best.day]) perDay[best.day] = [];
        perDay[best.day].push(r);
      });

      var days = {};
      header.forEach(function (h, idx) {
        var list = perDay[h.day];
        if (!list || !list.length) return;
        list.sort(function (a, b) { return a.x - b.x; });
        var code = list.map(function (r) { return clean(r.text); }).join('').replace(/\s+/g, ' ').trim();
        if (!code) return;
        days[keyForOffset(idx)] = {
          code: code,
          color: normalizeInk(list[0].color || '#2b2430')
        };
      });

      if (Object.keys(days).length) {
        workers.push({
          id: clean(idRun.text),
          name: name || 'Trabajador ' + clean(idRun.text),
          days: days
        });
      }
    });

    if (!workers.length) {
      throw new PdfError('El PDF no contiene una tabla de turnos reconocible.', 'NO_ROWS');
    }

    var lengths = {};
    workers.forEach(function (w) { lengths[w.id.length] = (lengths[w.id.length] || 0) + 1; });
    var idLength = Number(Object.keys(lengths).sort(function (a, b) { return lengths[b] - lengths[a]; })[0]) || 7;

    var endDate = keyForOffset(header.length - 1);

    return {
      version: 1,
      source: 'rol-pdf',
      startDate: keyForOffset(0),
      endDate: endDate,
      year: year,
      month: month,
      residence: residence,
      generatedAt: generated,
      dayCount: header.length,
      idLength: idLength,
      workers: workers,
      totalCells: workers.reduce(function (acc, w) { return acc + Object.keys(w.days).length; }, 0)
    };
  }

  async function parseRolPDF(input) {
    var bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
    var bin = bytesToBinary(bytes);

    if (/\/Encrypt\b/.test(bin)) {
      throw new PdfError('El PDF está protegido con contraseña. Guárdalo sin protección e inténtalo de nuevo.', 'ENCRYPTED');
    }
    if (bin.indexOf('%PDF') !== 0 && bin.indexOf('%PDF') < 0) {
      throw new PdfError('El archivo no parece un PDF válido.', 'NOT_PDF');
    }

    var objects = getObjects(bin);
    if (!objects.size) {
      throw new PdfError('No se ha podido leer la estructura del PDF.', 'BAD_PDF');
    }

    var pageBody = null;
    objects.forEach(function (body) {
      if (!pageBody && /\/Type\s*\/Page(?!s)\b/.test(body)) pageBody = body;
    });

    var runs = [];

    async function parseObjectNumber(num) {
      var body = objects.get(num);
      if (!body) return false;
      var data;
      try { data = await streamData(body); } catch (e) { return false; }
      if (!data) return false;
      var contentBin = bytesToBinary(data);
      if (contentBin.indexOf('BT') < 0) return false;
      parseContent(contentBin, runs);
      return runs.length > 0;
    }

    if (pageBody) {
      var refs = [];
      var arrMatch = /\/Contents\s*\[([^\]]+)\]/.exec(pageBody);
      if (arrMatch) {
        var re = /(\d+)\s+0\s+R/g;
        var mm;
        while ((mm = re.exec(arrMatch[1]))) refs.push(Number(mm[1]));
      } else {
        var one = /\/Contents\s+(\d+)\s+0\s+R/.exec(pageBody);
        if (one) refs = [Number(one[1])];
      }
      for (var i = 0; i < refs.length; i++) {
        await parseObjectNumber(refs[i]);
      }
    }

    if (!runs.length) {
      // Respaldo: busca cualquier stream con contenido de texto.
      var nums = Array.from(objects.keys());
      for (var k = 0; k < nums.length; k++) {
        var body = objects.get(nums[k]);
        if (!body || body.indexOf('/FlateDecode') < 0) continue;
        var data;
        try { data = await streamData(body); } catch (e) { continue; }
        if (!data) continue;
        var cb = bytesToBinary(data);
        if (cb.indexOf('BT') >= 0 && (cb.indexOf('TJ') >= 0 || cb.indexOf('Tj') >= 0)) {
          parseContent(cb, runs);
          if (runs.length) break;
        }
      }
    }

    if (!runs.length) {
      throw new PdfError('No se ha encontrado texto en el PDF. Puede ser un PDF escaneado.', 'NO_TEXT');
    }

    return extractTable(runs);
  }

  return {
    parseRolPDF: parseRolPDF,
    PdfError: PdfError,
    _internals: {
      extractTable: extractTable,
      parseContent: parseContent,
      bytesToBinary: bytesToBinary
    }
  };
});
