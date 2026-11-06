// Datos de prueba para ver la interfaz en un navegador (en el launcher de verdad no se usa).
const ok = (data) => Promise.resolve({ ok: true, data });
const params = new URLSearchParams(location.search);
let cuentas = params.has('sincuenta') ? { activa: null, cuentas: [] }
  : { activa: 'a1', cuentas: [{ uuid: 'a1', nombre: 'OwariES' }, { uuid: 'b2', nombre: 'Zuneth' }] };
let ajustes = { modo: params.get('modo') || 'plus', ramMb: 4096, ramTotalMb: 16384, anchura: 1280, altura: 720, pantallaCompleta: false, jvmArgs: '', alJugar: 'ocultar', shaders: true, entrarAlServidor: true };
const img = (n) => `img/fondo.jpg#${n}`;
window.zeroria = {
  inicio: () => ok({ version: '0.1.0', ajustes, cuentas, enlaces: {}, datosConfigurados: true }),
  launcher: () => ok({ minecraft: '1.21.11', neoforge: '21.11.45', servidor: { nombre: 'Zeroria' }, modos: { vanilla: true, plus: true },
    aviso: { texto: '✦ Temporada de otoño: dobles recompensas en las profesiones' },
    evento: { titulo: 'Gran apertura en', fecha: new Date(Date.now() + 3 * 864e5 + 5 * 36e5).toISOString() } }),
  contenido: () => ok({ fondos: [], noticias: [
    { titulo: 'Llega el menú de Zeroria: el astrolabio', fecha: '2026-11-04', etiqueta: 'Novedad', fijada: true, resumen: 'Mayús + F y todo a mano.', texto: 'Ya está aquí el **astrolabio**.\n\nPulsa Mayús + F en cualquier momento.' },
    { titulo: 'Las tiendas abren sus puertas en Brisalia', fecha: '2026-11-02', etiqueta: 'Economía', resumen: 'Compra, vende e intercambia con los mercaderes.' },
    { titulo: 'Diario de desarrollo #3: profesiones y gremios', fecha: '2026-10-29', etiqueta: 'Desarrollo', resumen: 'Recolección, cocina y parcelas.' },
    { titulo: 'Evento de Samhain', fecha: '2026-10-25', etiqueta: 'Evento' },
  ] }),
  servidor: () => ok({ online: true, ms: 34, jugadores: 18, maximo: 120, motd: 'Temporada de otoño · 1.21.11', nombre: 'Zeroria' }),
  cuentas: { anadir: () => ok(cuentas), elegir: (u) => { cuentas = { ...cuentas, activa: u }; return ok(cuentas); }, quitar: () => ok(cuentas) },
  guardarAjustes: (p) => { ajustes = { ...ajustes, ...p }; return ok(ajustes); },
  jugar: () => new Promise(() => {}),
  reparar: () => ok(null), carpeta: () => ok(null), abrirArchivo: () => ok(null), enlace: () => ok(null),
  instalarActualizacion: () => ok(null), ventana: () => {},
  onProgreso: (fn) => { window.__progreso = fn; }, onJuego: () => {}, onActualizacion: (fn) => { window.__upd = fn; },
};
