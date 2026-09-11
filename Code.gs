/**
 * Cronograma y Designaciones ABT — backend en Google Apps Script
 *
 * 1) Creá una Google Sheet nueva > Extensiones > Apps Script > pegá todo este archivo.
 * 2) Elegí la función setup y tocá Ejecutar (autorizá los permisos). Crea las hojas y los datos de ejemplo.
 * 3) Implementar > Nueva implementación > Aplicación web. Ejecutar como: Yo. Acceso: Cualquier usuario.
 * 4) Copiá la URL que termina en /exec y pegala en API_URL dentro de index.html.
 *
 * Para actualizar el código después: Guardar > Implementar > Administrar implementaciones >
 * lápiz > Versión: Nueva versión > Implementar. (NO usar "Nueva implementación": cambia la URL.)
 *
 * Todo va por GET con JSONP, así funciona en Safari/iPhone sin problemas de CORS.
 */
var TZ = 'America/Argentina/Buenos_Aires';

/* ===== NÚCLEO COMPARTIDO — es idéntico en index.html y en Code.gs ===== */
var DEF_PARAMS = {arbitrosPorPartido:2, cierreDia:4, cierreHora:'20:00', minEntrePartidos:75, extraCambioSede:30, claveColegio:'colegio2026', claveABT:'abt2026'};
var CFG_EJEMPLO = {
  clubes:[
    {id:'ind', nombre:'Independiente', pin:'1111', sede:'Gimnasio Independiente'},
    {id:'san', nombre:'Santamarina', pin:'2222', sede:'Gimnasio Santamarina'},
    {id:'fer', nombre:'Ferro Carril Sud', pin:'3333', sede:'Gimnasio Ferro'},
    {id:'uyp', nombre:'Unión y Progreso', pin:'4444', sede:'Gimnasio Unión y Progreso'},
    {id:'exc', nombre:'Excursionistas', pin:'5555', sede:'Gimnasio Excursionistas'}
  ],
  categorias:[
    {id:'u11', nombre:'U11', arancel:8000}, {id:'u13', nombre:'U13', arancel:9000},
    {id:'u15', nombre:'U15', arancel:10000}, {id:'u17', nombre:'U17', arancel:11000},
    {id:'u19', nombre:'U19', arancel:12000}, {id:'pri', nombre:'Primera', arancel:15000}
  ],
  arbitros:[
    {id:'a1', nombre:'Martín Pérez', tel:''}, {id:'a2', nombre:'Lucas Gómez', tel:''},
    {id:'a3', nombre:'Diego Suárez', tel:''}, {id:'a4', nombre:'Pablo Ríos', tel:''},
    {id:'a5', nombre:'Sofía Méndez', tel:''}, {id:'a6', nombre:'Nahuel Torres', tel:''}
  ],
  params:{}
};

function pad(n){ return (n < 10 ? '0' : '') + n; }
function s2d(s){ var a = String(s).split('-'); return new Date(Date.UTC(+a[0], +a[1]-1, +a[2])); }
function d2s(d){ return d.getUTCFullYear() + '-' + pad(d.getUTCMonth()+1) + '-' + pad(d.getUTCDate()); }
function addDias(s, n){ var d = s2d(s); d.setUTCDate(d.getUTCDate()+n); return d2s(d); }
function dow(s){ return s2d(s).getUTCDay(); }
/* Un fin de semana se identifica por su sábado (viernes, sábado y domingo). */
function findeDe(s){ var w = dow(s); if (w === 5) return addDias(s, 1); if (w === 6) return s; if (w === 0) return addDias(s, -1); return null; }
function findeActual(hoy){ var w = dow(hoy); if (w === 5 || w === 6 || w === 0) return findeDe(hoy); return addDias(hoy, 6 - w); }
function cierreDe(sab, P){ var dia = Number(P.cierreDia); if (!(dia >= 0 && dia <= 6)) dia = 4; return addDias(sab, -((6 - dia + 7) % 7)) + 'T' + (P.cierreHora || '20:00'); }
function mins(h){ var a = String(h).split(':'); return (+a[0])*60 + (+a[1]); }
function uid(){ return Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4); }
function paramsDe(cfg){ var P = {}, k, c = cfg.params || {}; for (k in DEF_PARAMS) P[k] = DEF_PARAMS[k]; for (k in c) if (c[k] !== '' && c[k] != null) P[k] = c[k]; return P; }
function totalTira(t, cfg, P){
  var n = Number(P.arbitrosPorPartido) || 2, s = 0;
  (t.partidos || []).forEach(function(x){
    var c = (cfg.categorias || []).filter(function(k){ return k.id === x.cat; })[0];
    s += (c ? Number(c.arancel) || 0 : 0) * n;
  });
  return s;
}
function publicCfg(cfg, P){
  return {
    clubes: (cfg.clubes || []).map(function(c){ return {id:c.id, nombre:c.nombre, sede:c.sede}; }),
    categorias: cfg.categorias || [],
    arbitros: (cfg.arbitros || []).map(function(a){ return {id:a.id, nombre:a.nombre}; }),
    params: {arbitrosPorPartido:P.arbitrosPorPartido, cierreDia:P.cierreDia, cierreHora:P.cierreHora, minEntrePartidos:P.minEntrePartidos, extraCambioSede:P.extraCambioSede}
  };
}
/* Superposiciones: mismo árbitro, mismo día, sin tiempo suficiente entre partidos. */
function conflictos(tiras, P, nom){
  var L = [], out = {};
  tiras.forEach(function(t){ (t.partidos || []).forEach(function(x){ [x.a1, x.a2].forEach(function(a){
    if (a) L.push({a:a, f:t.fecha, m:mins(x.hora), h:x.hora, s:String(t.sede||'').trim().toLowerCase(), sede:t.sede, p:x.id});
  }); }); });
  for (var i = 0; i < L.length; i++) for (var j = i+1; j < L.length; j++){
    var A = L[i], B = L[j];
    if (A.a !== B.a || A.f !== B.f || A.p === B.p) continue;
    var otra = A.s !== B.s;
    var need = (Number(P.minEntrePartidos) || 0) + (otra ? (Number(P.extraCambioSede) || 0) : 0);
    if (Math.abs(A.m - B.m) < need){
      (out[A.p] = out[A.p] || []).push(nom(A.a) + ' también está a las ' + B.h + (otra ? ' en ' + B.sede : ' en la misma sede'));
      (out[B.p] = out[B.p] || []).push(nom(B.a) + ' también está a las ' + A.h + (otra ? ' en ' + A.sede : ' en la misma sede'));
    }
  }
  return out;
}

/* S = almacenamiento: getConfig, setConfig, getTiras, getTira, putTira, delTira. ahora = 'AAAA-MM-DDTHH:MM' */
function core_handle(action, p, S, ahora){
  p = p || {};
  var cfg = S.getConfig(), P = paramsDe(cfg);
  function err(m){ throw new Error(m); }
  function club(id){ return (cfg.clubes || []).filter(function(c){ return c.id === id; })[0]; }
  function esColegio(k){ return !!k && (String(k) === String(P.claveColegio) || String(k) === String(P.claveABT)); }
  function esABT(k){ return !!k && String(k) === String(P.claveABT); }
  function clubOk(){ var c = club(p.club); if (!c || String(c.pin) !== String(p.pin)) err('El PIN no coincide con ese club.'); return c; }
  switch (action){
    case 'estado':
      return {ok:true, config:publicCfg(cfg, P), tiras:S.getTiras(p.finde || ''), ahora:ahora};
    case 'loginClub':
      clubOk(); return {ok:true};
    case 'loginColegio':
      if (!esColegio(p.clave)) err('Clave incorrecta.');
      return {ok:true, arbitros:cfg.arbitros || []};
    case 'loginABT':
      if (!esABT(p.clave)) err('Clave incorrecta.');
      return {ok:true, config:{clubes:cfg.clubes || [], categorias:cfg.categorias || [], arbitros:cfg.arbitros || [], params:P}};
    case 'guardarTira':
      return guardarTira_(p, S, cfg, P, ahora, clubOk());
    case 'borrarTira': {
      var cb = clubOk(), tb = S.getTira(p.id);
      if (!tb) err('Esa tira ya no existe.');
      if (tb.local !== cb.id) err('Esa tira no es de tu club.');
      if (ahora >= cierreDe(tb.finde, P)) err('La carga de ese fin de semana ya cerró.');
      if (tb.pagada) err('La tira figura como pagada; no se puede borrar.');
      S.delTira(tb.id); return {ok:true};
    }
    case 'designar': {
      if (!esColegio(p.clave)) err('Clave del Colegio incorrecta.');
      var td = S.getTira(p.tiraId); if (!td) err('Esa tira ya no existe. Actualizá el cronograma.');
      var x = td.partidos.filter(function(k){ return k.id === p.partidoId; })[0];
      if (!x) err('Ese partido ya no existe. Actualizá el cronograma.');
      var ids = {}; (cfg.arbitros || []).forEach(function(a){ ids[a.id] = 1; });
      var a1 = p.a1 || '', a2 = p.a2 || '';
      if ((a1 && !ids[a1]) || (a2 && !ids[a2])) err('Ese árbitro no está en la lista.');
      if (a1 && a1 === a2) err('No puede ser el mismo árbitro en las dos funciones.');
      x.a1 = a1; x.a2 = a2; S.putTira(td); return {ok:true};
    }
    case 'pago': {
      if (!esColegio(p.clave)) err('Clave del Colegio incorrecta.');
      var tp = S.getTira(p.tiraId); if (!tp) err('Esa tira ya no existe.');
      tp.pagada = !!p.pagada; tp.monto = tp.pagada ? totalTira(tp, cfg, P) : 0;
      S.putTira(tp); return {ok:true, tira:tp};
    }
    case 'guardarConfig':
      return guardarConfig_(p, S, cfg, esABT);
  }
  err('Acción desconocida: ' + action);
}

function guardarTira_(p, S, cfg, P, ahora, c){
  function err(m){ throw new Error(m); }
  var t = p.tira || {};
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t.fecha || '') || !findeDe(t.fecha)) err('Elegí viernes, sábado o domingo.');
  var fin = findeDe(t.fecha);
  if (ahora >= cierreDe(fin, P)) err('La carga de ese fin de semana ya cerró.');
  var prev = t.id ? S.getTira(t.id) : null;
  if (prev && prev.local !== c.id) err('Esa tira no es de tu club.');
  if (prev && prev.pagada) err('La tira figura como pagada. Pedile al Colegio que la pase a pendiente para editarla.');
  var rivalId = (t.rivalId && t.rivalId !== c.id && (cfg.clubes || []).some(function(k){ return k.id === t.rivalId; })) ? t.rivalId : '';
  var rivalTxt = rivalId ? '' : String(t.rivalTxt || '').trim();
  if (!rivalId && !rivalTxt) err('Indicá contra quién juegan.');
  var sede = String(t.sede || '').trim(); if (!sede) err('Indicá la sede o cancha.');
  var ps = t.partidos || []; if (!ps.length) err('Cargá al menos una categoría.');
  var old = {}; (prev ? prev.partidos : []).forEach(function(x){ old[x.id] = x; });
  var cats = {}; (cfg.categorias || []).forEach(function(k){ cats[k.id] = k.nombre; });
  var partidos = ps.map(function(x){
    if (!cats[x.cat]) err('Hay un partido sin categoría.');
    if (!/^\d{2}:\d{2}$/.test(x.hora || '')) err('Falta la hora de ' + cats[x.cat] + '.');
    var o = x.id && old[x.id];
    return {id: o ? o.id : uid(), cat:x.cat, hora:x.hora, a1: o ? o.a1 : '', a2: o ? o.a2 : ''};
  });
  var n = {id: prev ? prev.id : uid(), local:c.id, rivalId:rivalId, rivalTxt:rivalTxt, fecha:t.fecha, finde:fin, sede:sede, partidos:partidos, pagada:false, monto:0, act:ahora};
  S.putTira(n);
  return {ok:true, tira:n};
}

function guardarConfig_(p, S, cfg, esABT){
  function err(m){ throw new Error(m); }
  if (!esABT(p.clave)) err('Clave de la ABT incorrecta.');
  var v = p.valor, parte = p.parte, P = paramsDe(cfg);
  if (parte === 'params'){
    var np = {};
    for (var k in DEF_PARAMS) np[k] = (v && v[k] !== undefined && v[k] !== '') ? v[k] : P[k];
    ['arbitrosPorPartido','cierreDia','minEntrePartidos','extraCambioSede'].forEach(function(k){
      np[k] = Number(np[k]); if (isNaN(np[k]) || np[k] < 0) err('Revisá los números de las reglas.');
    });
    if (!/^\d{2}:\d{2}$/.test(np.cierreHora)) err('La hora de cierre tiene que ser HH:MM.');
    np.claveColegio = String(np.claveColegio).trim(); np.claveABT = String(np.claveABT).trim();
    if (!np.claveColegio || !np.claveABT) err('Las claves no pueden quedar vacías.');
    v = np;
  } else if (parte === 'clubes' || parte === 'categorias' || parte === 'arbitros'){
    if (!Array.isArray(v)) err('Datos inválidos.');
    var vistos = {};
    v = v.map(function(r){
      var o = {id: (r.id && !vistos[r.id]) ? String(r.id) : uid(), nombre: String(r.nombre || '').trim()};
      vistos[o.id] = 1;
      if (!o.nombre) err('Hay una fila sin nombre.');
      if (parte === 'clubes'){ o.pin = String(r.pin || '').trim(); o.sede = String(r.sede || '').trim(); if (!o.pin) err('Falta el PIN de ' + o.nombre + '.'); }
      if (parte === 'categorias'){ o.arancel = Number(r.arancel); if (r.arancel === '' || isNaN(o.arancel) || o.arancel < 0) err('Revisá el arancel de ' + o.nombre + '.'); }
      if (parte === 'arbitros'){ o.tel = String(r.tel || '').trim(); }
      return o;
    });
  } else err('Sección desconocida.');
  S.setConfig(parte, v); cfg[parte] = v;
  return {ok:true, config:{clubes:cfg.clubes || [], categorias:cfg.categorias || [], arbitros:cfg.arbitros || [], params:paramsDe(cfg)}};
}
/* ===== FIN NÚCLEO ===== */


var ESCRITURAS = ['guardarTira', 'borrarTira', 'designar', 'pago', 'guardarConfig'];

function doGet(e){
  var q = (e && e.parameter) || {};
  var cb = String(q.cb || '').replace(/[^\w$]/g, '');
  var lock = ESCRITURAS.indexOf(q.action) >= 0 ? LockService.getScriptLock() : null;
  var res;
  try {
    if (lock) lock.waitLock(20000);
    var p = q.p ? JSON.parse(q.p) : {};
    res = core_handle(q.action || 'estado', p, SheetStore, Utilities.formatDate(new Date(), TZ, "yyyy-MM-dd'T'HH:mm"));
  } catch (err) {
    res = {ok:false, error:String((err && err.message) || err)};
  } finally {
    if (lock) try { lock.releaseLock(); } catch (x) {}
  }
  var body = JSON.stringify(res);
  return ContentService.createTextOutput(cb ? cb + '(' + body + ');' : body)
    .setMimeType(cb ? ContentService.MimeType.JAVASCRIPT : ContentService.MimeType.JSON);
}

function hoja_(n){ var ss = SpreadsheetApp.getActiveSpreadsheet(); return ss.getSheetByName(n) || ss.insertSheet(n); }
var FILA_CFG = {clubes:1, categorias:2, arbitros:3, params:4};

var SheetStore = {
  getConfig: function(){
    var v = hoja_('Config').getRange(1, 2, 4, 1).getValues();
    function j(x, d){ try { return x[0] ? JSON.parse(x[0]) : d; } catch (e) { return d; } }
    return {clubes:j(v[0], []), categorias:j(v[1], []), arbitros:j(v[2], []), params:j(v[3], {})};
  },
  setConfig: function(parte, valor){
    hoja_('Config').getRange(FILA_CFG[parte], 1, 1, 2).setValues([[parte, JSON.stringify(valor)]]);
  },
  _filas: function(){
    var s = hoja_('Tiras'), n = s.getLastRow();
    return n < 2 ? [] : s.getRange(2, 1, n - 1, 4).getValues();
  },
  getTiras: function(finde){
    return this._filas().map(function(r){ try { return JSON.parse(r[3]); } catch (e) { return null; } })
      .filter(function(t){ return t && (!finde || t.finde === finde); });
  },
  getTira: function(id){
    var f = this._filas();
    for (var i = 0; i < f.length; i++) if (String(f[i][0]) === id) { try { return JSON.parse(f[i][3]); } catch (e) { return null; } }
    return null;
  },
  putTira: function(t){
    var s = hoja_('Tiras'), f = this._filas(), fila = [t.id, t.finde, resumen_(t), JSON.stringify(t)], n = s.getLastRow() + 1;
    for (var i = 0; i < f.length; i++) if (String(f[i][0]) === t.id) { n = i + 2; break; }
    var r = s.getRange(n, 1, 1, 4); r.setNumberFormat('@'); r.setValues([fila]);
  },
  delTira: function(id){
    var f = this._filas();
    for (var i = 0; i < f.length; i++) if (String(f[i][0]) === id) { hoja_('Tiras').deleteRow(i + 2); return; }
  }
};

/* Columna legible para quien abra la planilla. */
function resumen_(t){
  var cfg = SheetStore.getConfig();
  function nom(id){ var c = (cfg.clubes || []).filter(function(k){ return k.id === id; })[0]; return c ? c.nombre : id; }
  return t.fecha + ' · ' + nom(t.local) + ' vs ' + (t.rivalId ? nom(t.rivalId) : t.rivalTxt) + ' · ' + t.sede + ' · ' + t.partidos.length + ' partidos' + (t.pagada ? ' · PAGADA' : '');
}

function setup(){
  if (!hoja_('Config').getRange(1, 2).getValue()){
    SheetStore.setConfig('clubes', CFG_EJEMPLO.clubes);
    SheetStore.setConfig('categorias', CFG_EJEMPLO.categorias);
    SheetStore.setConfig('arbitros', CFG_EJEMPLO.arbitros);
    SheetStore.setConfig('params', DEF_PARAMS);
  }
  var t = hoja_('Tiras');
  if (t.getLastRow() === 0){
    t.getRange(1, 1, 1, 4).setValues([['id', 'fin de semana', 'tira', 'datos']]).setFontWeight('bold');
    t.setFrozenRows(1);
  }
  t.getRange('A:B').setNumberFormat('@');
  var hoja1 = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Hoja 1');
  if (hoja1 && hoja1.getLastRow() === 0) SpreadsheetApp.getActiveSpreadsheet().deleteSheet(hoja1);
  Logger.log('Listo. Clave ABT: ' + DEF_PARAMS.claveABT + ' | Clave Colegio: ' + DEF_PARAMS.claveColegio + '. Cambialas desde la pestaña ABT.');
}
