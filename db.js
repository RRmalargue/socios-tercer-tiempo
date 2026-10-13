const Database = require('better-sqlite3');
const path = require('path');

const dbPath = process.env.DB_PATH || path.join(__dirname, 'club.db');
const db = new Database(dbPath);

// Habilitar claves foráneas y modo WAL para mejor rendimiento
db.pragma('foreign_keys = ON');
db.pragma('journal_mode = WAL');

function initDatabase() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS categorias (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nombre TEXT NOT NULL UNIQUE,
      cuota_base REAL NOT NULL,
      descripcion TEXT
    );

    CREATE TABLE IF NOT EXISTS disciplinas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nombre TEXT NOT NULL UNIQUE,
      arancel_mensual REAL NOT NULL,
      profesor TEXT,
      dias_horarios TEXT
    );

    CREATE TABLE IF NOT EXISTS socios (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      numero_socio TEXT UNIQUE NOT NULL,
      nombre TEXT NOT NULL,
      apellido TEXT NOT NULL,
      dni TEXT UNIQUE NOT NULL,
      email TEXT,
      telefono TEXT,
      categoria_id INTEGER NOT NULL REFERENCES categorias(id),
      fecha_alta TEXT NOT NULL,
      estado TEXT NOT NULL DEFAULT 'Activo',
      grupo_familiar_id TEXT
    );

    CREATE TABLE IF NOT EXISTS socio_disciplinas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      socio_id INTEGER NOT NULL REFERENCES socios(id) ON DELETE CASCADE,
      disciplina_id INTEGER NOT NULL REFERENCES disciplinas(id) ON DELETE CASCADE,
      UNIQUE(socio_id, disciplina_id)
    );

    CREATE TABLE IF NOT EXISTS cuotas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      socio_id INTEGER NOT NULL REFERENCES socios(id) ON DELETE CASCADE,
      periodo TEXT NOT NULL,
      mes INTEGER NOT NULL,
      anio INTEGER NOT NULL,
      concepto TEXT NOT NULL,
      monto_original REAL NOT NULL,
      descuento REAL DEFAULT 0,
      recargo REAL DEFAULT 0,
      monto_total REAL NOT NULL,
      fecha_vencimiento TEXT NOT NULL,
      estado TEXT NOT NULL DEFAULT 'Pendiente',
      fecha_creacion TEXT NOT NULL,
      UNIQUE(socio_id, periodo)
    );

    CREATE TABLE IF NOT EXISTS pagos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      cuota_id INTEGER NOT NULL REFERENCES cuotas(id),
      socio_id INTEGER NOT NULL REFERENCES socios(id),
      monto_pagado REAL NOT NULL,
      medio_pago TEXT NOT NULL,
      nro_comprobante TEXT UNIQUE NOT NULL,
      fecha_pago TEXT NOT NULL,
      observaciones TEXT,
      cajero TEXT DEFAULT 'Admin Recepción'
    );

    CREATE TABLE IF NOT EXISTS comprobantes_transferencia (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      socio_id INTEGER NOT NULL REFERENCES socios(id) ON DELETE CASCADE,
      cuota_id INTEGER NOT NULL REFERENCES cuotas(id) ON DELETE CASCADE,
      banco_origen TEXT,
      nro_transaccion TEXT,
      monto_declarado REAL NOT NULL,
      archivo_url TEXT,
      fecha_subida TEXT NOT NULL,
      estado TEXT NOT NULL DEFAULT 'Pendiente',
      motivo_rechazo TEXT,
      revisado_por TEXT,
      fecha_revision TEXT
    );

    CREATE TABLE IF NOT EXISTS auditoria_acciones (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tipo TEXT NOT NULL,
      descripcion TEXT NOT NULL,
      datos_anteriores TEXT,
      datos_nuevos TEXT,
      fecha TEXT NOT NULL,
      deshecho INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS configuracion_club (
      clave TEXT PRIMARY KEY,
      valor TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_socios_dni ON socios(dni);
    CREATE INDEX IF NOT EXISTS idx_socios_estado ON socios(estado);
    CREATE INDEX IF NOT EXISTS idx_cuotas_periodo ON cuotas(periodo);
    CREATE INDEX IF NOT EXISTS idx_cuotas_estado ON cuotas(estado);
    CREATE INDEX IF NOT EXISTS idx_pagos_fecha ON pagos(fecha_pago);
    CREATE INDEX IF NOT EXISTS idx_comprobantes_estado ON comprobantes_transferencia(estado);
    CREATE INDEX IF NOT EXISTS idx_auditoria_fecha ON auditoria_acciones(fecha);
  `);

  seedInitialData();
}

function seedInitialData() {
  // Asegurar las 4 categorías oficiales
  const countCategorias = db.prepare('SELECT COUNT(*) as count FROM categorias').get().count;
  if (countCategorias === 0) {
    const insertCategoria = db.prepare('INSERT INTO categorias (nombre, cuota_base, descripcion) VALUES (?, ?, ?)');
    insertCategoria.run('Socio Activo', 12000, 'Socio con derecho social pleno y uso de instalaciones');
    insertCategoria.run('Socio Deportivo', 14000, 'Socio federado que participa en disciplinas deportivas del club');
    insertCategoria.run('Socio Cadete', 8500, 'Jóvenes menores de 16 años / divisiones formativas');
    insertCategoria.run('Socio Vitalicio', 0, 'Socio con antigüedad estatutaria (Exento de cuota social)');
  }

  // Asegurar disciplinas
  const countDiscs = db.prepare('SELECT COUNT(*) as count FROM disciplinas').get().count;
  if (countDiscs === 0) {
    const insertDisciplina = db.prepare('INSERT INTO disciplinas (nombre, arancel_mensual, profesor, dias_horarios) VALUES (?, ?, ?, ?)');
    insertDisciplina.run('Fútbol (Plantel Oficial y Formativo)', 10000, 'Cuerpo Técnico Fútbol', 'Mar a Vie 19:30 a 21:30');
    insertDisciplina.run('Atletismo', 10000, 'Prof. de Atletismo & Trail', 'Lun, Mié y Vie 18:00 a 20:00');
    insertDisciplina.run('Handball Femenino', 10000, 'Prof. Handball Femenino', 'Mar y Jue 19:00 a 21:00');
    insertDisciplina.run('Handball Masculino', 10000, 'Prof. Handball Masculino', 'Mar y Jue 21:00 a 23:00');
    insertDisciplina.run('Voley Femenino', 10000, 'Prof. Voley Femenino', 'Lun, Mié y Vie 20:00 a 22:00');
    insertDisciplina.run('Escuela de Voley Femenino', 10000, 'Prof. Formativa Voley', 'Lun y Mié 17:30 a 19:00');
    insertDisciplina.run('Voley Masculino', 10000, 'Prof. Voley Masculino', 'Mar, Jue y Sáb 20:30 a 22:30');
    insertDisciplina.run('Institucional', 10000, 'Secretaría Club', 'Lun a Sáb');
  }

  // Asegurar configuración bancaria inicial para transferencias y portal de socios
  const insertConfig = db.prepare('INSERT OR IGNORE INTO configuracion_club (clave, valor) VALUES (?, ?)');
  insertConfig.run('banco', 'Banco Galicia');
  insertConfig.run('titular', 'Asociación Club Tercer Tiempo Malargüe');
  insertConfig.run('cuit', '30-71234567-9');
  insertConfig.run('cbu', '0070123420000012345678');
  insertConfig.run('alias', 'ACTTM2026');
  insertConfig.run('tipo_cuenta', 'Cuenta Corriente Especial');

  // Verificar si ya tenemos el padrón real cargado (174 socios)
  const countSocios = db.prepare('SELECT COUNT(*) as count FROM socios').get().count;
  if (countSocios >= 50) {
    return; // Ya contiene el padrón real
  }

  console.log('🔄 Inicializando base de datos con los 174 socios reales del Club Tercer Tiempo...');
  
  const fs = require('fs');
  const jsonPath = path.join(__dirname, 'padron_oficial_2026.json');
  if (!fs.existsSync(jsonPath)) return;

  const sociosData = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));

  const catActivo = db.prepare("SELECT id FROM categorias WHERE nombre LIKE '%Activo%'").get()?.id || 1;
  const catDeportivo = db.prepare("SELECT id FROM categorias WHERE nombre LIKE '%Deportivo%'").get()?.id || 2;
  const catCadete = db.prepare("SELECT id FROM categorias WHERE nombre LIKE '%Cadete%'").get()?.id || 3;
  const catVitalicio = db.prepare("SELECT id FROM categorias WHERE nombre LIKE '%Vitalicio%'").get()?.id || 4;

  const discMap = {};
  db.prepare('SELECT id, nombre FROM disciplinas').all().forEach(d => { discMap[d.nombre] = d.id; });
  const defaultDiscId = db.prepare('SELECT id FROM disciplinas LIMIT 1').get()?.id || 1;

  const monthCodes = ['01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '12'];
  const monthNames = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

  const tx = db.transaction(() => {
    db.exec('DELETE FROM pagos;');
    db.exec('DELETE FROM cuotas;');
    db.exec('DELETE FROM socio_disciplinas;');
    db.exec('DELETE FROM comprobantes_transferencia;');
    db.exec('DELETE FROM socios;');
    db.exec("DELETE FROM sqlite_sequence WHERE name IN ('pagos', 'cuotas', 'socio_disciplinas', 'comprobantes_transferencia', 'socios');");

    const insertSocio = db.prepare(`
      INSERT INTO socios (numero_socio, nombre, apellido, dni, email, telefono, categoria_id, fecha_alta, estado, grupo_familiar_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const insertSocioDisc = db.prepare('INSERT INTO socio_disciplinas (socio_id, disciplina_id) VALUES (?, ?)');

    const insertCuota = db.prepare(`
      INSERT INTO cuotas (socio_id, periodo, mes, anio, concepto, monto_original, descuento, recargo, monto_total, fecha_vencimiento, estado, fecha_creacion)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const insertPago = db.prepare(`
      INSERT INTO pagos (cuota_id, socio_id, monto_pagado, medio_pago, nro_comprobante, fecha_pago, observaciones, cajero)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    let socioCounter = 1;
    let pagoCounter = 1;

    for (let s of sociosData) {
      let catId = catDeportivo;
      if (s.catNombre === 'Socio Vitalicio') catId = catVitalicio;
      else if (s.catNombre === 'Socio Activo') catId = catActivo;
      else if (s.catNombre === 'Socio Cadete') catId = catCadete;

      const discId = discMap[s.discNombre] || defaultDiscId;
      const nroSocio = `${s.prefix}-${String(s.num).padStart(3, '0')}`;
      const dni = `2026${String(socioCounter).padStart(4, '0')}`;
      const email = `${s.nombre.toLowerCase().replace(/[^a-z0-9]/g, '')}.${s.apellido.toLowerCase().replace(/[^a-z0-9]/g, '')}@clubtercertiempo.ar`;
      const telefono = '+54 9 260 4' + Math.floor(100000 + Math.random() * 900000);
      const grupoFamiliar = s.tutor ? `Tutor: ${s.tutor}` : null;

      const socioRes = insertSocio.run(
        nroSocio, s.nombre, s.apellido, dni, email, telefono, catId, '2026-01-01', 'Activo', grupoFamiliar
      );
      const socioId = socioRes.lastInsertRowid;
      insertSocioDisc.run(socioId, discId);

      for (let m = 0; m < 12; m++) {
        const val = s.cuotas[m] ? s.cuotas[m].trim() : '';
        const mesNum = m + 1;
        const periodo = `2026-${monthCodes[m]}`;
        const mesNombre = monthNames[m];
        const concepto = `Cuota Social ${mesNombre} 2026`;
        const fechaVto = `2026-${monthCodes[m]}-10`;

        if (val === 'XXX') continue;

        const montoNum = parseFloat(val);
        if (!isNaN(montoNum) && montoNum > 0) {
          const cuotaRes = insertCuota.run(
            socioId, periodo, mesNum, 2026, concepto,
            montoNum, 0, 0, montoNum,
            fechaVto, 'Pagada', `2026-${monthCodes[m]}-01`
          );
          const cuotaId = cuotaRes.lastInsertRowid;
          const nroComp = `REC-2026-${String(pagoCounter++).padStart(5, '0')}`;
          insertPago.run(
            cuotaId, socioId, montoNum, 'Efectivo', nroComp,
            `2026-${monthCodes[m]}-08 11:00:00`,
            `Pago asentado en planilla oficial 2026 (${s.section})`,
            'Tesorero Club'
          );
        } else {
          insertCuota.run(
            socioId, periodo, mesNum, 2026, concepto,
            10000, 0, 0, 10000,
            fechaVto, 'Pendiente', `2026-${monthCodes[m]}-01`
          );
        }
      }
      socioCounter++;
    }
  });

  tx();
  console.log('✅ Padrón oficial de 174 socios cargado exitosamente.');
}

initDatabase();

module.exports = db;
