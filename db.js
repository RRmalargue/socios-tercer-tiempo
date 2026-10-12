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

    CREATE INDEX IF NOT EXISTS idx_socios_dni ON socios(dni);
    CREATE INDEX IF NOT EXISTS idx_socios_estado ON socios(estado);
    CREATE INDEX IF NOT EXISTS idx_cuotas_periodo ON cuotas(periodo);
    CREATE INDEX IF NOT EXISTS idx_cuotas_estado ON cuotas(estado);
    CREATE INDEX IF NOT EXISTS idx_pagos_fecha ON pagos(fecha_pago);
    CREATE INDEX IF NOT EXISTS idx_comprobantes_estado ON comprobantes_transferencia(estado);
  `);

  seedInitialData();
}

function seedInitialData() {
  const countCategorias = db.prepare('SELECT COUNT(*) as count FROM categorias').get().count;
  if (countCategorias > 0) return; // Ya contiene datos

  const insertCategoria = db.prepare('INSERT INTO categorias (nombre, cuota_base, descripcion) VALUES (?, ?, ?)');
  insertCategoria.run('Socio Activo', 12000, 'Socio con derecho social pleno y uso de instalaciones');
  insertCategoria.run('Socio Deportivo', 14000, 'Socio federado que participa en disciplinas deportivas del club');
  insertCategoria.run('Socio Cadete', 8500, 'Jóvenes menores de 16 años / divisiones formativas');
  insertCategoria.run('Socio Vitalicio', 0, 'Socio con antigüedad estatutaria (Exento de cuota social)');

  const insertDisciplina = db.prepare('INSERT INTO disciplinas (nombre, arancel_mensual, profesor, dias_horarios) VALUES (?, ?, ?, ?)');
  insertDisciplina.run('Fútbol (Plantel Oficial y Formativo)', 5000, 'Cuerpo Técnico Fútbol', 'Mar a Vie 19:30 a 21:30 - Fines de semana partidos');
  insertDisciplina.run('Atletismo', 4500, 'Prof. de Atletismo & Trail', 'Lun, Mié y Vie 18:00 a 20:00');
  insertDisciplina.run('Handball Femenino', 5000, 'Prof. Handball Femenino', 'Mar y Jue 19:00 a 21:00');
  insertDisciplina.run('Handball Masculino', 5000, 'Prof. Handball Masculino', 'Mar y Jue 21:00 a 23:00');
  insertDisciplina.run('Voley Femenino', 5500, 'Prof. Voley Femenino', 'Lun, Mié y Vie 20:00 a 22:00');
  insertDisciplina.run('Escuela de Voley Femenino', 4500, 'Prof. Formativa Voley', 'Lun y Mié 17:30 a 19:00');
  insertDisciplina.run('Voley Masculino', 5500, 'Prof. Voley Masculino', 'Mar, Jue y Sáb 20:30 a 22:30');
  insertDisciplina.run('Newcom', 4000, 'Prof. Newcom / Deporte Adaptado', 'Mar y Jue 16:00 a 18:00');

  // Socios de ejemplo
  const insertSocio = db.prepare(`
    INSERT INTO socios (numero_socio, nombre, apellido, dni, email, telefono, categoria_id, fecha_alta, estado, grupo_familiar_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const s1 = insertSocio.run('SOC-1001', 'Lucas', 'Fernández', '38492011', 'lucas.fernandez@email.com', '+54 11 4455-8899', 1, '2024-03-15', 'Activo', null);
  const s2 = insertSocio.run('SOC-1002', 'Sofía', 'Martínez', '42110293', 'sofia.martinez@email.com', '+54 11 5566-7788', 1, '2024-05-10', 'Activo', 'FAM-01');
  const s3 = insertSocio.run('SOC-1003', 'Joaquín', 'Martínez', '50239102', 'padres.martinez@email.com', '+54 11 5566-7788', 3, '2024-05-10', 'Activo', 'FAM-01');
  const s4 = insertSocio.run('SOC-1004', 'Gonzalo', 'Ríos', '35901244', 'gonzalo.rios@email.com', '+54 11 3322-1100', 1, '2023-01-20', 'Activo', null);
  const s5 = insertSocio.run('SOC-1005', 'Valentina', 'Pérez', '44019283', 'valen.perez@email.com', '+54 11 9988-2233', 2, '2024-08-01', 'Activo', null);
  const s6 = insertSocio.run('SOC-1006', 'Roberto', 'Navarro', '14209384', 'roberto.navarro@email.com', '+54 11 1234-5678', 4, '1992-04-10', 'Activo', null);

  // Inscribir a disciplinas
  const insertSocioDisc = db.prepare('INSERT INTO socio_disciplinas (socio_id, disciplina_id) VALUES (?, ?)');
  insertSocioDisc.run(s1.lastInsertRowid, 2); // Lucas -> Natación
  insertSocioDisc.run(s1.lastInsertRowid, 4); // Lucas -> Gimnasio
  insertSocioDisc.run(s2.lastInsertRowid, 5); // Sofia -> Tenis
  insertSocioDisc.run(s3.lastInsertRowid, 1); // Joaquín -> Fútbol
  insertSocioDisc.run(s4.lastInsertRowid, 4); // Gonzalo -> Gimnasio
  insertSocioDisc.run(s5.lastInsertRowid, 3); // Valentina -> Básquet

  // Generar cuotas para el mes actual (2026-10) y el mes anterior (2026-09)
  const insertCuota = db.prepare(`
    INSERT INTO cuotas (socio_id, periodo, mes, anio, concepto, monto_original, descuento, recargo, monto_total, fecha_vencimiento, estado, fecha_creacion)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  // Cuotas de Septiembre 2026 (Pagadas en su mayoría)
  const c1_sep = insertCuota.run(s1.lastInsertRowid, '2026-09', 9, 2026, 'Cuota Social + Natación + Gimnasio', 29500, 0, 0, 29500, '2026-09-10', 'Pagada', '2026-09-01');
  const c2_sep = insertCuota.run(s2.lastInsertRowid, '2026-09', 9, 2026, 'Cuota Social + Tenis', 23000, 0, 0, 23000, '2026-09-10', 'Pagada', '2026-09-01');
  const c3_sep = insertCuota.run(s3.lastInsertRowid, '2026-09', 9, 2026, 'Cuota Social Infantil + Fútbol', 13000, 0, 0, 13000, '2026-09-10', 'Pagada', '2026-09-01');
  const c4_sep = insertCuota.run(s4.lastInsertRowid, '2026-09', 9, 2026, 'Cuota Social + Gimnasio', 20000, 0, 2000, 22000, '2026-09-10', 'Vencida', '2026-09-01');

  // Cuotas de Octubre 2026 (Mes corriente)
  const c1_oct = insertCuota.run(s1.lastInsertRowid, '2026-10', 10, 2026, 'Cuota Social + Natación + Gimnasio', 29500, 0, 0, 29500, '2026-10-10', 'Pagada', '2026-10-01');
  const c2_oct = insertCuota.run(s2.lastInsertRowid, '2026-10', 10, 2026, 'Cuota Social + Tenis', 23000, 0, 0, 23000, '2026-10-10', 'Pendiente', '2026-10-10');
  const c3_oct = insertCuota.run(s3.lastInsertRowid, '2026-10', 10, 2026, 'Cuota Social Infantil + Fútbol', 13000, 0, 0, 13000, '2026-10-10', 'Pendiente', '2026-10-10');
  const c4_oct = insertCuota.run(s4.lastInsertRowid, '2026-10', 10, 2026, 'Cuota Social + Gimnasio', 20000, 0, 0, 2000, '2026-10-10', 'Pendiente', '2026-10-01');
  const c5_oct = insertCuota.run(s5.lastInsertRowid, '2026-10', 10, 2026, 'Cuota Social Cadete + Básquet', 15000, 0, 0, 15000, '2026-10-10', 'Pendiente', '2026-10-01');

  // Pagos registrados
  const insertPago = db.prepare(`
    INSERT INTO pagos (cuota_id, socio_id, monto_pagado, medio_pago, nro_comprobante, fecha_pago, observaciones, cajero)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  insertPago.run(c1_sep.lastInsertRowid, s1.lastInsertRowid, 29500, 'Transferencia', 'REC-2026-0001', '2026-09-08 11:25:00', 'Transferencia bancaria Banco Galicia', 'Admin Recepción');
  insertPago.run(c2_sep.lastInsertRowid, s2.lastInsertRowid, 23000, 'Mercado Pago', 'REC-2026-0002', '2026-09-09 19:40:00', 'Pago con tarjeta débito por link', 'Sistema Automático');
  insertPago.run(c3_sep.lastInsertRowid, s3.lastInsertRowid, 13000, 'Efectivo', 'REC-2026-0003', '2026-09-10 17:15:00', 'Cobro presencial en ventanilla', 'Admin Recepción');
  insertPago.run(c1_oct.lastInsertRowid, s1.lastInsertRowid, 29500, 'Transferencia', 'REC-2026-0004', '2026-10-04 14:02:00', 'Comprobante verificado', 'Admin Recepción');

  // Comprobante de transferencia pendiente de validación de Sofía Martínez
  const insertComp = db.prepare(`
    INSERT INTO comprobantes_transferencia (socio_id, cuota_id, banco_origen, nro_transaccion, monto_declarado, archivo_url, fecha_subida, estado)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'Pendiente')
  `);
  insertComp.run(s2.lastInsertRowid, c2_oct.lastInsertRowid, 'Banco Santander', 'TX-88991204', 23000, '', '2026-10-06 18:20:00');
}

initDatabase();

module.exports = db;
