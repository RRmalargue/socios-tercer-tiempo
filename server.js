const express = require('express');
const cors = require('cors');
const path = require('path');
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '15mb' }));
app.use(express.urlencoded({ extended: true, limit: '15mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// -------------------------------------------------------------
// SISTEMA DE AUDITORÍA Y DESHACER ACCIONES
// -------------------------------------------------------------
function registrarAuditoria(tipo, descripcion, datosAnteriores = null, datosNuevos = null) {
  try {
    const fecha = new Date().toISOString().replace('T', ' ').substring(0, 19);
    const info = db.prepare(`
      INSERT INTO auditoria_acciones (tipo, descripcion, datos_anteriores, datos_nuevos, fecha, deshecho)
      VALUES (?, ?, ?, ?, ?, 0)
    `).run(
      tipo,
      descripcion,
      datosAnteriores ? JSON.stringify(datosAnteriores) : null,
      datosNuevos ? JSON.stringify(datosNuevos) : null,
      fecha
    );
    return info.lastInsertRowid;
  } catch (e) {
    console.error('Error registrando auditoría:', e);
    return null;
  }
}

// -------------------------------------------------------------
// DASHBOARD
// -------------------------------------------------------------
app.get('/api/dashboard', (req, res) => {
  try {
    const currentPeriod = req.query.periodo || '2026-10';

    const totalSocios = db.prepare("SELECT COUNT(*) as count FROM socios WHERE estado = 'Activo'").get().count;

    const cuotasStats = db.prepare(`
      SELECT 
        COUNT(*) as total_cuotas,
        COALESCE(SUM(monto_total), 0) as total_facturado,
        COALESCE((SELECT SUM(monto_pagado) FROM pagos WHERE cuota_id IN (SELECT id FROM cuotas WHERE periodo = ?)), 0) as total_cobrado,
        COALESCE(SUM(monto_total - COALESCE((SELECT SUM(monto_pagado) FROM pagos WHERE cuota_id = cuotas.id), 0)), 0) as total_pendiente,
        COUNT(CASE WHEN estado = 'Pagada' THEN 1 END) as cant_pagadas,
        COUNT(CASE WHEN estado IN ('Pendiente', 'Vencida', 'Parcial') THEN 1 END) as cant_pendientes
      FROM cuotas
      WHERE periodo = ?
    `).get(currentPeriod, currentPeriod);

    const ultimosPagos = db.prepare(`
      SELECT p.*, s.nombre, s.apellido, s.numero_socio, c.periodo, c.concepto
      FROM pagos p
      JOIN socios s ON p.socio_id = s.id
      JOIN cuotas c ON p.cuota_id = c.id
      ORDER BY p.id DESC
      LIMIT 6
    `).all();

    const morosos = db.prepare(`
      SELECT s.id, s.numero_socio, s.nombre, s.apellido, s.telefono,
             COUNT(c.id) as cuotas_adeudadas,
             SUM(c.monto_total - COALESCE((SELECT SUM(p.monto_pagado) FROM pagos p WHERE p.cuota_id = c.id), 0)) as deuda_total
      FROM socios s
      JOIN cuotas c ON s.id = c.socio_id
      WHERE c.estado IN ('Pendiente', 'Vencida', 'Parcial') AND c.periodo <= ?
      GROUP BY s.id
      HAVING deuda_total > 0
      ORDER BY deuda_total DESC
      LIMIT 5
    `).all(currentPeriod);

    const comprobantesPendientesCount = db.prepare("SELECT COUNT(*) as count FROM comprobantes_transferencia WHERE estado = 'Pendiente'").get().count;

    // Desglose exacto por grupos deportivos del club
    const gruposDef = [
      { key: 'FUND', nombre: 'Socios Fundadores', icono: '🏛️', match: "s.numero_socio LIKE 'FUND%'" },
      { key: 'FUT', nombre: 'Fútbol +35', icono: '⚽', match: "((s.numero_socio LIKE 'FUT%') OR s.id IN (SELECT sd.socio_id FROM socio_disciplinas sd JOIN disciplinas d ON sd.disciplina_id = d.id WHERE d.nombre LIKE '%Fútbol%'))" },
      { key: 'VOL', nombre: 'Voley (Todas las cat)', icono: '🏐', match: "((s.numero_socio LIKE 'VOL%' OR s.numero_socio LIKE 'VFA%' OR s.numero_socio LIKE 'VMA%') OR s.id IN (SELECT sd.socio_id FROM socio_disciplinas sd JOIN disciplinas d ON sd.disciplina_id = d.id WHERE d.nombre LIKE '%Voley%'))" },
      { key: 'GEN', nombre: 'Socios Generales', icono: '👥', match: "((s.numero_socio LIKE 'GEN%') OR (s.numero_socio NOT LIKE 'FUND%' AND s.id NOT IN (SELECT sd.socio_id FROM socio_disciplinas sd)))" },
      { key: 'HB', nombre: 'Handball (Fem y Masc)', icono: '🤾', match: "((s.numero_socio LIKE 'HBF%' OR s.numero_socio LIKE 'HBM%' OR s.numero_socio LIKE 'HB%') OR s.id IN (SELECT sd.socio_id FROM socio_disciplinas sd JOIN disciplinas d ON sd.disciplina_id = d.id WHERE d.nombre LIKE '%Handball%'))" },
      { key: 'ATL', nombre: 'Atletismo', icono: '🏃', match: "((s.numero_socio LIKE 'ATL%') OR s.id IN (SELECT sd.socio_id FROM socio_disciplinas sd JOIN disciplinas d ON sd.disciplina_id = d.id WHERE d.nombre LIKE '%Atletismo%'))" }
    ];

    const porGrupos = gruposDef.map(g => {
      const r = db.prepare(`
        SELECT COUNT(DISTINCT s.id) as socios,
               COALESCE(SUM(c.monto_total), 0) as facturado,
               COALESCE(SUM(CASE WHEN c.estado = 'Pagada' THEN c.monto_total ELSE 0 END), 0) as cobrado,
               COUNT(CASE WHEN c.estado = 'Pagada' THEN 1 END) as pagadas,
               COUNT(CASE WHEN c.estado != 'Pagada' THEN 1 END) as pendientes
        FROM socios s
        LEFT JOIN cuotas c ON c.socio_id = s.id AND c.periodo = ?
        WHERE ${g.match}
      `).get(currentPeriod);
      const fact = r.facturado || 0;
      const cob = r.cobrado || 0;
      return {
        key: g.key,
        nombre: g.nombre,
        icono: g.icono,
        socios: r.socios,
        facturado: fact,
        cobrado: cob,
        adeudado: Math.max(0, fact - cob),
        pagadas: r.pagadas,
        pendientes: r.pendientes,
        porcentaje: fact > 0 ? Math.round((cob / fact) * 100) : 0
      };
    });

    // Socios al día vs con deuda
    const sociosDeudaStats = db.prepare(`
      SELECT 
        COUNT(DISTINCT CASE WHEN deudas.cuotas_deuda = 0 THEN s.id END) as socios_al_dia,
        COUNT(DISTINCT CASE WHEN deudas.cuotas_deuda > 0 THEN s.id END) as socios_con_deuda
      FROM socios s
      JOIN (
        SELECT s2.id,
               COUNT(CASE WHEN c.estado IN ('Pendiente', 'Vencida', 'Parcial') AND c.periodo <= ? AND (c.monto_total - COALESCE((SELECT SUM(p.monto_pagado) FROM pagos p WHERE p.cuota_id = c.id), 0)) > 0 THEN 1 END) as cuotas_deuda
        FROM socios s2
        LEFT JOIN cuotas c ON s2.id = c.socio_id
        WHERE s2.estado = 'Activo'
        GROUP BY s2.id
      ) deudas ON s.id = deudas.id
    `).get(currentPeriod);

    // Total histórico anual 2026
    const totalAnualPagos = db.prepare(`
      SELECT COUNT(*) as cant_pagos, COALESCE(SUM(monto_pagado), 0) as total_cobrado
      FROM pagos
      WHERE substr(fecha_pago, 1, 4) = '2026'
    `).get();

    res.json({
      periodo: currentPeriod,
      totalSocios,
      stats: cuotasStats,
      sociosAlDia: sociosDeudaStats ? sociosDeudaStats.socios_al_dia : 73,
      sociosConDeuda: sociosDeudaStats ? sociosDeudaStats.socios_con_deuda : 101,
      totalAnualCobrado: totalAnualPagos ? totalAnualPagos.total_cobrado : 0,
      totalAnualPagos: totalAnualPagos ? totalAnualPagos.cant_pagos : 0,
      porGrupos,
      ultimosPagos,
      morosos,
      comprobantesPendientesCount
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// -------------------------------------------------------------
// ESTADÍSTICAS Y RECAUDACIÓN (Mensual y Anual con Desgloses)
// -------------------------------------------------------------
app.get('/api/estadisticas/recaudacion', (req, res) => {
  try {
    const anioQuery = req.query.anio || new Date().getFullYear().toString();
    const anio = parseInt(anioQuery) || new Date().getFullYear();

    // Años disponibles en la base de datos
    const aniosRows = db.prepare(`
      SELECT DISTINCT substr(fecha_pago, 1, 4) as anio 
      FROM pagos 
      ORDER BY anio DESC
    `).all();
    const aniosDisponibles = aniosRows.map(r => parseInt(r.anio)).filter(Boolean);
    if (!aniosDisponibles.includes(anio)) {
      aniosDisponibles.unshift(anio);
    }

    // 1. Recaudación y Facturación Mensual del año seleccionado
    const mesesNombres = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
    const mesesNombresCompletos = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

    const cobradoPorMes = db.prepare(`
      SELECT 
        CAST(substr(fecha_pago, 6, 2) AS INTEGER) as mes,
        SUM(monto_pagado) as total,
        COUNT(*) as cantidad_pagos
      FROM pagos
      WHERE substr(fecha_pago, 1, 4) = ?
      GROUP BY mes
    `).all(anio.toString());
    const mapCobrado = {};
    cobradoPorMes.forEach(r => { mapCobrado[r.mes] = r; });

    const facturadoPorMes = db.prepare(`
      SELECT 
        mes,
        SUM(monto_total) as total,
        COUNT(*) as cantidad_cuotas
      FROM cuotas
      WHERE anio = ?
      GROUP BY mes
    `).all(anio);
    const mapFacturado = {};
    facturadoPorMes.forEach(r => { mapFacturado[r.mes] = r; });

    let totalCobradoAnio = 0;
    let totalFacturadoAnio = 0;
    let mesRecord = { mes: '-', monto: 0 };
    let mesesActivos = 0;

    const mensual = [];
    for (let m = 1; m <= 12; m++) {
      const cobrado = (mapCobrado[m] && mapCobrado[m].total) ? mapCobrado[m].total : 0;
      const facturado = (mapFacturado[m] && mapFacturado[m].total) ? mapFacturado[m].total : 0;
      const cantPagos = (mapCobrado[m] && mapCobrado[m].cantidad_pagos) ? mapCobrado[m].cantidad_pagos : 0;
      const porcentaje = facturado > 0 ? Math.min(100, Math.round((cobrado / facturado) * 100)) : (cobrado > 0 ? 100 : 0);

      totalCobradoAnio += cobrado;
      totalFacturadoAnio += facturado;
      if (cobrado > 0) mesesActivos++;
      if (cobrado > mesRecord.monto) {
        mesRecord = { mes: mesesNombresCompletos[m - 1], monto: cobrado };
      }

      mensual.push({
        mes: m,
        mesCorto: mesesNombres[m - 1],
        mesCompleto: mesesNombresCompletos[m - 1],
        cobrado,
        facturado,
        porcentaje,
        cantidadPagos: cantPagos
      });
    }

    // 2. Histórico Anual Comparativo
    const anualRows = db.prepare(`
      SELECT 
        substr(fecha_pago, 1, 4) as anio,
        SUM(monto_pagado) as total_cobrado,
        COUNT(*) as cantidad_pagos
      FROM pagos
      GROUP BY anio
      ORDER BY anio ASC
    `).all();

    // 3. Desglose por Medio de Pago en el año
    const porMedioPago = db.prepare(`
      SELECT 
        medio_pago,
        SUM(monto_pagado) as total,
        COUNT(*) as cantidad
      FROM pagos
      WHERE substr(fecha_pago, 1, 4) = ?
      GROUP BY medio_pago
      ORDER BY total DESC
    `).all(anio.toString());

    // 4. Desglose por Categoría Social
    const porCategoria = db.prepare(`
      SELECT 
        c.nombre as categoria,
        SUM(p.monto_pagado) as total,
        COUNT(p.id) as cantidad_pagos
      FROM pagos p
      JOIN socios s ON p.socio_id = s.id
      JOIN categorias c ON s.categoria_id = c.id
      WHERE substr(p.fecha_pago, 1, 4) = ?
      GROUP BY c.id
      ORDER BY total DESC
    `).all(anio.toString());

    // 5. Comparativa con Año Anterior
    const cobradoAnioAnteriorRow = db.prepare(`
      SELECT SUM(monto_pagado) as total 
      FROM pagos 
      WHERE substr(fecha_pago, 1, 4) = ?
    `).get((anio - 1).toString());
    const totalAnioAnterior = (cobradoAnioAnteriorRow && cobradoAnioAnteriorRow.total) || 0;
    let variacionInteranual = 0;
    if (totalAnioAnterior > 0) {
      variacionInteranual = Math.round(((totalCobradoAnio - totalAnioAnterior) / totalAnioAnterior) * 100);
    }

    res.json({
      anio,
      aniosDisponibles,
      kpis: {
        totalCobradoAnio,
        totalFacturadoAnio,
        promedioMensual: mesesActivos > 0 ? Math.round(totalCobradoAnio / mesesActivos) : 0,
        mesRecord,
        tasaCobranza: totalFacturadoAnio > 0 ? Math.round((totalCobradoAnio / totalFacturadoAnio) * 100) : 0,
        totalAnioAnterior,
        variacionInteranual
      },
      mensual,
      anual: anualRows,
      porMedioPago,
      porCategoria
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// -------------------------------------------------------------
// CONFIGURACIÓN DE ARANCELES (Categorías y Disciplinas)
// -------------------------------------------------------------
app.get('/api/categorias', (req, res) => {
  try {
    const rows = db.prepare('SELECT * FROM categorias ORDER BY id').all();
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/categorias', (req, res) => {
  try {
    const { nombre, cuota_base, descripcion = '' } = req.body;
    if (!nombre || cuota_base === undefined) {
      return res.status(400).json({ error: 'Nombre y cuota base son obligatorios' });
    }
    const result = db.prepare('INSERT INTO categorias (nombre, cuota_base, descripcion) VALUES (?, ?, ?)')
      .run(nombre.trim(), parseFloat(cuota_base), descripcion.trim());
    res.status(201).json({ id: result.lastInsertRowid, message: 'Categoría creada con éxito' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/categorias/:id', (req, res) => {
  try {
    const { nombre, cuota_base, descripcion = '' } = req.body;
    const catId = req.params.id;
    if (!nombre || cuota_base === undefined) {
      return res.status(400).json({ error: 'Nombre y cuota base son obligatorios' });
    }
    db.prepare('UPDATE categorias SET nombre = ?, cuota_base = ?, descripcion = ? WHERE id = ?')
      .run(nombre.trim(), parseFloat(cuota_base), descripcion.trim(), catId);
    res.json({ message: 'Valor de cuota y categoría actualizado con éxito' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/disciplinas', (req, res) => {
  try {
    const rows = db.prepare('SELECT * FROM disciplinas ORDER BY id').all();
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/disciplinas', (req, res) => {
  try {
    const { nombre, arancel_mensual, profesor = '', dias_horarios = '' } = req.body;
    if (!nombre || arancel_mensual === undefined) {
      return res.status(400).json({ error: 'Nombre y arancel mensual son obligatorios' });
    }
    const result = db.prepare('INSERT INTO disciplinas (nombre, arancel_mensual, profesor, dias_horarios) VALUES (?, ?, ?, ?)')
      .run(nombre.trim(), parseFloat(arancel_mensual), profesor.trim(), dias_horarios.trim());
    res.status(201).json({ id: result.lastInsertRowid, message: 'Disciplina agregada con éxito' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/disciplinas/:id', (req, res) => {
  try {
    const { nombre, arancel_mensual, profesor = '', dias_horarios = '' } = req.body;
    const discId = req.params.id;
    if (!nombre || arancel_mensual === undefined) {
      return res.status(400).json({ error: 'Nombre y arancel mensual son obligatorios' });
    }
    db.prepare('UPDATE disciplinas SET nombre = ?, arancel_mensual = ?, profesor = ?, dias_horarios = ? WHERE id = ?')
      .run(nombre.trim(), parseFloat(arancel_mensual), profesor.trim(), dias_horarios.trim(), discId);
    res.json({ message: 'Disciplina y arancel actualizados con éxito' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/disciplinas/:id', (req, res) => {
  try {
    const discId = req.params.id;
    db.prepare('DELETE FROM socio_disciplinas WHERE disciplina_id = ?').run(discId);
    db.prepare('DELETE FROM disciplinas WHERE id = ?').run(discId);
    res.json({ message: 'Disciplina eliminada' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// -------------------------------------------------------------
// CONFIGURACIÓN BANCARIA DEL CLUB (Para Cobros y Portal Socio)
// -------------------------------------------------------------
function getDatosBancarios() {
  try {
    const rows = db.prepare('SELECT clave, valor FROM configuracion_club').all();
    const config = {};
    rows.forEach(r => { config[r.clave] = r.valor; });
    return {
      banco: config.banco || 'Banco Galicia',
      titular: config.titular || 'Asociación Club Tercer Tiempo Malargüe',
      cuit: config.cuit || '30-71234567-9',
      cbu: config.cbu || '0070123420000012345678',
      alias: config.alias || 'ACTTM2026',
      tipo_cuenta: config.tipo_cuenta || 'Cuenta Corriente Especial'
    };
  } catch (e) {
    return {
      banco: 'Banco Galicia',
      titular: 'Asociación Club Tercer Tiempo Malargüe',
      cuit: '30-71234567-9',
      cbu: '0070123420000012345678',
      alias: 'ACTTM2026',
      tipo_cuenta: 'Cuenta Corriente Especial'
    };
  }
}

app.get('/api/config/bancarios', (req, res) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.json(getDatosBancarios());
});

app.put('/api/config/bancarios', (req, res) => {
  try {
    const { banco, titular, cuit, cbu, alias, tipo_cuenta } = req.body;
    if (!alias || !cbu) {
      return res.status(400).json({ error: 'El Alias y el CBU son obligatorios.' });
    }
    const upsert = db.prepare(`
      INSERT INTO configuracion_club (clave, valor) VALUES (?, ?)
      ON CONFLICT(clave) DO UPDATE SET valor = excluded.valor
    `);
    const transaction = db.transaction(() => {
      if (banco !== undefined) upsert.run('banco', banco.trim());
      if (titular !== undefined) upsert.run('titular', titular.trim());
      if (cuit !== undefined) upsert.run('cuit', cuit.trim());
      if (cbu !== undefined) upsert.run('cbu', cbu.trim());
      if (alias !== undefined) upsert.run('alias', alias.trim().toUpperCase());
      if (tipo_cuenta !== undefined) upsert.run('tipo_cuenta', tipo_cuenta.trim());
    });
    transaction();

    registrarAuditoria(
      'CONFIG_BANCARIA',
      `Datos bancarios actualizados: Alias ${alias.trim().toUpperCase()}, CBU ${cbu.trim()}`,
      null,
      { banco, titular, cuit, cbu, alias, tipo_cuenta }
    );

    res.json({ message: 'Datos bancarios actualizados correctamente', datos: getDatosBancarios() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// -------------------------------------------------------------
// PLANTILLA DE MENSAJE PERSONALIZADA PARA WHATSAPP
// -------------------------------------------------------------
const PLANTILLA_WHATSAPP_DEFAULT = 
`Hola *{nombre}* 👋 Te saludamos desde la administración del *Club Deportivo Tercer Tiempo Malargüe* 🦊⚽

Te escribimos para recordarte que registrás *{cuotas_pendientes} cuota(s) pendiente(s)* por un total de *{deuda_total}*:
{detalle_cuotas}

🏦 *Datos para transferir:*
• *Alias:* {alias}
• *CBU:* {cbu}
• *Banco:* {banco}
• *Titular:* {titular}

📱 *Portal del Socio:*
Podés consultar tu estado de cuenta, descargar tu carnet oficial o subir tu comprobante de pago ingresando a:
{portal_url}

Si ya realizaste la transferencia o tenés alguna duda, respondé a este mensaje. ¡Muchas gracias por apoyar al club! 🏆`;

app.get('/api/config/plantilla-whatsapp', (req, res) => {
  try {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    const row = db.prepare("SELECT valor FROM configuracion_club WHERE clave = 'plantilla_whatsapp'").get();
    res.json({
      plantilla: row && row.valor ? row.valor : PLANTILLA_WHATSAPP_DEFAULT,
      plantilla_default: PLANTILLA_WHATSAPP_DEFAULT
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/config/plantilla-whatsapp', (req, res) => {
  try {
    const { plantilla } = req.body;
    if (!plantilla || !plantilla.trim()) {
      return res.status(400).json({ error: 'El texto del mensaje no puede estar vacío.' });
    }
    db.prepare(`
      INSERT INTO configuracion_club (clave, valor) VALUES ('plantilla_whatsapp', ?)
      ON CONFLICT(clave) DO UPDATE SET valor = excluded.valor
    `).run(plantilla.trim());

    res.json({ 
      message: 'Plantilla de mensaje guardada exitosamente.', 
      plantilla: plantilla.trim(),
      plantilla_default: PLANTILLA_WHATSAPP_DEFAULT 
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// -------------------------------------------------------------
// RESUMEN FINANCIERO POR CATEGORÍA Y PERÍODO
// -------------------------------------------------------------
app.get('/api/socios/resumen-periodo', (req, res) => {
  try {
    const { periodo = '2026-10', categoria_id, search } = req.query;

    let baseWhere = "WHERE 1=1";
    const params = [];

    if (categoria_id) {
      baseWhere += " AND s.categoria_id = ?";
      params.push(categoria_id);
    }
    if (search) {
      const sUpper = search.trim().toUpperCase();
      if (sUpper === 'FUND') {
        baseWhere += " AND s.numero_socio LIKE 'FUND%'";
      } else if (sUpper === 'FUT') {
        baseWhere += " AND ((s.numero_socio LIKE 'FUT%') OR s.id IN (SELECT sd.socio_id FROM socio_disciplinas sd JOIN disciplinas d ON sd.disciplina_id = d.id WHERE d.nombre LIKE '%Fútbol%'))";
      } else if (sUpper === 'ATL') {
        baseWhere += " AND ((s.numero_socio LIKE 'ATL%') OR s.id IN (SELECT sd.socio_id FROM socio_disciplinas sd JOIN disciplinas d ON sd.disciplina_id = d.id WHERE d.nombre LIKE '%Atletismo%'))";
      } else if (sUpper === 'HB') {
        baseWhere += " AND ((s.numero_socio LIKE 'HBF%' OR s.numero_socio LIKE 'HBM%' OR s.numero_socio LIKE 'HB%') OR s.id IN (SELECT sd.socio_id FROM socio_disciplinas sd JOIN disciplinas d ON sd.disciplina_id = d.id WHERE d.nombre LIKE '%Handball%'))";
      } else if (sUpper === 'V' || sUpper === 'VOL' || sUpper === 'VOLEY') {
        baseWhere += " AND ((s.numero_socio LIKE 'VOL%' OR s.numero_socio LIKE 'VFA%' OR s.numero_socio LIKE 'VMA%') OR s.id IN (SELECT sd.socio_id FROM socio_disciplinas sd JOIN disciplinas d ON sd.disciplina_id = d.id WHERE d.nombre LIKE '%Voley%'))";
      } else if (sUpper === 'GEN') {
        baseWhere += " AND ((s.numero_socio LIKE 'GEN%') OR (s.numero_socio NOT LIKE 'FUND%' AND s.id NOT IN (SELECT sd.socio_id FROM socio_disciplinas sd)))";
      } else {
        baseWhere += " AND (s.nombre LIKE ? OR s.apellido LIKE ? OR s.dni LIKE ? OR s.numero_socio LIKE ?)";
        const term = `%${search}%`;
        params.push(term, term, term, term);
      }
    }

    // Socios totales en el filtro
    const sociosQuery = `SELECT COUNT(*) as total_socios FROM socios s ${baseWhere}`;
    const totalSocios = db.prepare(sociosQuery).get(...params).total_socios;

    // Cuotas del período seleccionado para los socios filtrados
    const cuotasQuery = `
      SELECT 
        COUNT(c.id) as total_cuotas,
        COALESCE(SUM(c.monto_total), 0) as total_facturado,
        COALESCE(SUM((SELECT SUM(p.monto_pagado) FROM pagos p WHERE p.cuota_id = c.id)), 0) as total_cobrado,
        COALESCE(SUM(CASE WHEN c.estado = 'Pagada' THEN 1 ELSE 0 END), 0) as cant_pagadas,
        COALESCE(SUM(CASE WHEN c.estado != 'Pagada' THEN 1 ELSE 0 END), 0) as cant_pendientes
      FROM cuotas c
      JOIN socios s ON c.socio_id = s.id
      ${baseWhere} AND c.periodo = ?
    `;
    const stats = db.prepare(cuotasQuery).get(...params, periodo);

    const totalFacturado = stats.total_facturado || 0;
    const totalCobrado = stats.total_cobrado || 0;
    const totalAdeudado = Math.max(0, totalFacturado - totalCobrado);
    const porcentajeCobranza = totalFacturado > 0 ? Math.round((totalCobrado / totalFacturado) * 100) : 0;

    res.json({
      periodo,
      totalSocios,
      totalFacturado,
      totalCobrado,
      totalAdeudado,
      cantPagadas: stats.cant_pagadas,
      cantPendientes: stats.cant_pendientes,
      porcentajeCobranza
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// -------------------------------------------------------------
// SOCIOS
// -------------------------------------------------------------
app.get('/api/socios', (req, res) => {
  try {
    const { search, estado, categoria_id, periodo } = req.query;
    const mesReferencia = periodo || '2026-10';
    let query = `
      SELECT s.*, c.nombre as categoria_nombre, c.cuota_base,
        (SELECT COUNT(*) FROM cuotas q 
         WHERE q.socio_id = s.id 
           AND q.periodo <= ?
           AND q.estado IN ('Pendiente', 'Vencida', 'Parcial') 
           AND (q.monto_total - COALESCE((SELECT SUM(p.monto_pagado) FROM pagos p WHERE p.cuota_id = q.id), 0)) > 0
        ) as cuotas_pendientes,
        (SELECT COALESCE(SUM(q.monto_total - COALESCE((SELECT SUM(p.monto_pagado) FROM pagos p WHERE p.cuota_id = q.id), 0)), 0) 
         FROM cuotas q 
         WHERE q.socio_id = s.id 
           AND q.periodo <= ?
           AND q.estado IN ('Pendiente', 'Vencida', 'Parcial')
        ) as deuda_total,
        (SELECT GROUP_CONCAT(d.nombre, ', ') 
         FROM socio_disciplinas sd 
         JOIN disciplinas d ON sd.disciplina_id = d.id 
         WHERE sd.socio_id = s.id) as disciplinas_str
      FROM socios s
      JOIN categorias c ON s.categoria_id = c.id
      WHERE 1=1
    `;
    const params = [mesReferencia, mesReferencia];

    if (search) {
      const sUpper = search.trim().toUpperCase();
      if (sUpper === 'FUND') {
        query += " AND s.numero_socio LIKE 'FUND%'";
      } else if (sUpper === 'FUT') {
        query += " AND ((s.numero_socio LIKE 'FUT%') OR s.id IN (SELECT sd.socio_id FROM socio_disciplinas sd JOIN disciplinas d ON sd.disciplina_id = d.id WHERE d.nombre LIKE '%Fútbol%'))";
      } else if (sUpper === 'ATL') {
        query += " AND ((s.numero_socio LIKE 'ATL%') OR s.id IN (SELECT sd.socio_id FROM socio_disciplinas sd JOIN disciplinas d ON sd.disciplina_id = d.id WHERE d.nombre LIKE '%Atletismo%'))";
      } else if (sUpper === 'HB') {
        query += " AND ((s.numero_socio LIKE 'HBF%' OR s.numero_socio LIKE 'HBM%' OR s.numero_socio LIKE 'HB%') OR s.id IN (SELECT sd.socio_id FROM socio_disciplinas sd JOIN disciplinas d ON sd.disciplina_id = d.id WHERE d.nombre LIKE '%Handball%'))";
      } else if (sUpper === 'V' || sUpper === 'VOL' || sUpper === 'VOLEY') {
        query += " AND ((s.numero_socio LIKE 'VOL%' OR s.numero_socio LIKE 'VFA%' OR s.numero_socio LIKE 'VMA%') OR s.id IN (SELECT sd.socio_id FROM socio_disciplinas sd JOIN disciplinas d ON sd.disciplina_id = d.id WHERE d.nombre LIKE '%Voley%'))";
      } else if (sUpper === 'GEN') {
        query += " AND ((s.numero_socio LIKE 'GEN%') OR (s.numero_socio NOT LIKE 'FUND%' AND s.id NOT IN (SELECT sd.socio_id FROM socio_disciplinas sd)))";
      } else {
        query += ` AND (s.nombre LIKE ? OR s.apellido LIKE ? OR s.dni LIKE ? OR s.numero_socio LIKE ?)`;
        const term = `%${search}%`;
        params.push(term, term, term, term);
      }
    }
    if (estado) {
      query += ` AND s.estado = ?`;
      params.push(estado);
    }
    if (categoria_id) {
      query += ` AND s.categoria_id = ?`;
      params.push(categoria_id);
    }

    query += ` ORDER BY s.id DESC`;
    const socios = db.prepare(query).all(...params);
    res.json(socios);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/socios/:id', (req, res) => {
  try {
    const socio = db.prepare(`
      SELECT s.*, c.nombre as categoria_nombre, c.cuota_base
      FROM socios s
      JOIN categorias c ON s.categoria_id = c.id
      WHERE s.id = ?
    `).get(req.params.id);

    if (!socio) return res.status(404).json({ error: 'Socio no encontrado' });

    const disciplinas = db.prepare(`
      SELECT d.* 
      FROM socio_disciplinas sd
      JOIN disciplinas d ON sd.disciplina_id = d.id
      WHERE sd.socio_id = ?
    `).all(req.params.id);

    const cuotas = db.prepare(`
      SELECT c.*, s.nombre, s.apellido, s.numero_socio, s.dni,
        COALESCE((SELECT SUM(monto_pagado) FROM pagos WHERE cuota_id = c.id), 0) as total_cobrado,
        (c.monto_total - COALESCE((SELECT SUM(monto_pagado) FROM pagos WHERE cuota_id = c.id), 0)) as saldo_pendiente
      FROM cuotas c
      JOIN socios s ON c.socio_id = s.id
      WHERE c.socio_id = ? 
      ORDER BY c.periodo DESC
    `).all(req.params.id);

    const pagos = db.prepare(`
      SELECT p.*, c.periodo, c.concepto 
      FROM pagos p
      JOIN cuotas c ON p.cuota_id = c.id
      WHERE p.socio_id = ?
      ORDER BY p.fecha_pago DESC
    `).all(req.params.id);

    res.json({
      ...socio,
      disciplinas,
      cuotas,
      pagos
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/socios', (req, res) => {
  try {
    const {
      nombre, apellido, dni, email, telefono, categoria_id, grupo_familiar_id, disciplinas = [],
      fecha_nacimiento = '', edad = null, direccion = '', ocupacion = '', estado_civil = '',
      grupo_sanguineo = '', posee_obra_social = 'NO', nombre_obra_social = '', alergias_condiciones = '',
      contacto_emergencia_nombre = '', contacto_emergencia_telefono = '', tutor_nombre = '', socio_proponente = ''
    } = req.body;

    if (!nombre || !apellido || !dni || !categoria_id) {
      return res.status(400).json({ error: 'Nombre, apellido, DNI y categoría son obligatorios.' });
    }

    // Comprobar DNI duplicado
    const existeDni = db.prepare('SELECT id FROM socios WHERE dni = ?').get(dni.trim());
    if (existeDni) {
      return res.status(400).json({ error: 'Ya existe un socio registrado con ese DNI.' });
    }

    // Generar nuevo número de socio según disciplina o categoría
    let prefix = 'GEN';
    if (Array.isArray(disciplinas) && disciplinas.length > 0) {
      const discPlaceholders = disciplinas.map(() => '?').join(',');
      const discRows = db.prepare(`SELECT nombre FROM disciplinas WHERE id IN (${discPlaceholders})`).all(...disciplinas);
      const nombresDisc = discRows.map(d => d.nombre.toLowerCase()).join(' ');
      if (nombresDisc.includes('atletismo')) prefix = 'ATL';
      else if (nombresDisc.includes('fútbol') || nombresDisc.includes('futbol')) prefix = 'FUT';
      else if (nombresDisc.includes('handball')) prefix = 'HB';
      else if (nombresDisc.includes('voley')) prefix = 'VOL';
    }

    // Buscar el último número con ese prefijo para incrementar correlativamente
    const sociosConPrefijo = db.prepare(`SELECT numero_socio FROM socios WHERE numero_socio LIKE ?`).all(`${prefix}-%`);
    let maxNum = 0;
    sociosConPrefijo.forEach(s => {
      const m = s.numero_socio.match(/\d+/);
      if (m) {
        const val = parseInt(m[0], 10);
        if (val > maxNum) maxNum = val;
      }
    });
    const nextNum = maxNum + 1;
    const numero_socio = `${prefix}-${String(nextNum).padStart(3, '0')}`;
    const fecha_alta = new Date().toISOString().split('T')[0];

    const transaction = db.transaction(() => {
      const insert = db.prepare(`
        INSERT INTO socios (
          numero_socio, nombre, apellido, dni, email, telefono, categoria_id, fecha_alta, estado, grupo_familiar_id,
          fecha_nacimiento, edad, direccion, ocupacion, estado_civil, grupo_sanguineo, posee_obra_social,
          nombre_obra_social, alergias_condiciones, contacto_emergencia_nombre, contacto_emergencia_telefono,
          tutor_nombre, socio_proponente
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'Activo', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      const result = insert.run(
        numero_socio, nombre.trim(), apellido.trim(), dni.trim(), email || '', telefono || '', categoria_id, fecha_alta, grupo_familiar_id || null,
        fecha_nacimiento || '', edad || null, direccion || '', ocupacion || '', estado_civil || '',
        grupo_sanguineo || '', posee_obra_social || 'NO', nombre_obra_social || '', alergias_condiciones || '',
        contacto_emergencia_nombre || '', contacto_emergencia_telefono || '', tutor_nombre || '', socio_proponente || ''
      );
      const socioId = result.lastInsertRowid;

      if (Array.isArray(disciplinas) && disciplinas.length > 0) {
        const insertDisc = db.prepare('INSERT INTO socio_disciplinas (socio_id, disciplina_id) VALUES (?, ?)');
        for (const discId of disciplinas) {
          insertDisc.run(socioId, discId);
        }
      }

      // Generar primera cuota del mes corriente
      const categoria = db.prepare('SELECT * FROM categorias WHERE id = ?').get(categoria_id);
      const discList = db.prepare(`
        SELECT d.nombre, d.arancel_mensual 
        FROM socio_disciplinas sd 
        JOIN disciplinas d ON sd.disciplina_id = d.id 
        WHERE sd.socio_id = ?
      `).all(socioId);

      const totalDisc = discList.reduce((sum, d) => sum + d.arancel_mensual, 0);
      const montoTotal = (categoria ? categoria.cuota_base : 0) + totalDisc;
      const currentPeriod = '2026-10';
      const [anioStr, mesStr] = currentPeriod.split('-');

      let concepto = `Cuota Social (${categoria ? categoria.nombre : ''})`;
      if (discList.length > 0) concepto += ` + ${discList.map(d => d.nombre).join(', ')}`;

      db.prepare(`
        INSERT OR IGNORE INTO cuotas (socio_id, periodo, mes, anio, concepto, monto_original, descuento, recargo, monto_total, fecha_vencimiento, estado, fecha_creacion)
        VALUES (?, ?, ?, ?, ?, ?, 0, 0, ?, ?, 'Pendiente', ?)
      `).run(socioId, currentPeriod, parseInt(mesStr), parseInt(anioStr), concepto, montoTotal, montoTotal, `${currentPeriod}-10`, fecha_alta);

      return { socioId, numero_socio, montoTotal };
    });

    const resData = transaction();

    const auditoriaId = registrarAuditoria(
      'CREAR_SOCIO',
      `Nuevo socio registrado: ${nombre.trim()} ${apellido.trim()} (${resData.numero_socio} - DNI: ${dni.trim()})`,
      null,
      { socioId: resData.socioId, numero_socio: resData.numero_socio }
    );

    res.status(201).json({
      id: resData.socioId,
      numero_socio: resData.numero_socio,
      montoTotal: resData.montoTotal,
      message: '¡Inscripción completada exitosamente! Ya eres socio del Club Tercer Tiempo.',
      auditoriaId
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Actualizar todos los campos de un socio
app.put('/api/socios/:id', (req, res) => {
  try {
    const socioId = req.params.id;
    const {
      numero_socio,
      nombre,
      apellido,
      dni,
      email = '',
      telefono = '',
      categoria_id,
      estado = 'Activo',
      fecha_alta,
      fecha_nacimiento = '',
      edad = null,
      direccion = '',
      ocupacion = '',
      estado_civil = '',
      grupo_sanguineo = '',
      posee_obra_social = 'NO',
      nombre_obra_social = '',
      alergias_condiciones = '',
      contacto_emergencia_nombre = '',
      contacto_emergencia_telefono = '',
      tutor_nombre = '',
      socio_proponente = '',
      disciplinas = []
    } = req.body;

    if (!nombre || !apellido || !dni || !categoria_id) {
      return res.status(400).json({ error: 'Nombre, apellido, DNI y categoría son obligatorios.' });
    }

    // Verificar si el DNI ya pertenece a otro socio
    const dniExistente = db.prepare('SELECT id FROM socios WHERE dni = ? AND id != ?').get(dni.trim(), socioId);
    if (dniExistente) {
      return res.status(400).json({ error: 'El DNI ingresado ya está asignado a otro socio.' });
    }

    // Verificar si el número de socio ya pertenece a otro socio
    if (numero_socio) {
      const nroExistente = db.prepare('SELECT id FROM socios WHERE numero_socio = ? AND id != ?').get(numero_socio.trim(), socioId);
      if (nroExistente) {
        return res.status(400).json({ error: 'El N° de socio ya está asignado a otro integrante.' });
      }
    }

    const transaction = db.transaction(() => {
      db.prepare(`
        UPDATE socios SET
          numero_socio = COALESCE(?, numero_socio),
          nombre = ?,
          apellido = ?,
          dni = ?,
          email = ?,
          telefono = ?,
          categoria_id = ?,
          estado = ?,
          fecha_alta = COALESCE(?, fecha_alta),
          fecha_nacimiento = ?,
          edad = ?,
          direccion = ?,
          ocupacion = ?,
          estado_civil = ?,
          grupo_sanguineo = ?,
          posee_obra_social = ?,
          nombre_obra_social = ?,
          alergias_condiciones = ?,
          contacto_emergencia_nombre = ?,
          contacto_emergencia_telefono = ?,
          tutor_nombre = ?,
          socio_proponente = ?
        WHERE id = ?
      `).run(
        numero_socio ? numero_socio.trim() : null,
        nombre.trim(),
        apellido.trim(),
        dni.trim(),
        email.trim(),
        telefono.trim(),
        parseInt(categoria_id),
        estado,
        fecha_alta || null,
        fecha_nacimiento || '',
        edad ? parseInt(edad) : null,
        direccion.trim(),
        ocupacion.trim(),
        estado_civil.trim(),
        grupo_sanguineo.trim(),
        posee_obra_social || 'NO',
        nombre_obra_social.trim(),
        alergias_condiciones.trim(),
        contacto_emergencia_nombre.trim(),
        contacto_emergencia_telefono.trim(),
        tutor_nombre.trim(),
        socio_proponente.trim(),
        socioId
      );

      // Actualizar disciplinas
      db.prepare('DELETE FROM socio_disciplinas WHERE socio_id = ?').run(socioId);
      if (Array.isArray(disciplinas) && disciplinas.length > 0) {
        const insertDisc = db.prepare('INSERT INTO socio_disciplinas (socio_id, disciplina_id) VALUES (?, ?)');
        for (const discId of disciplinas) {
          insertDisc.run(socioId, parseInt(discId));
        }
      }
    });

    transaction();
    res.json({ message: 'Socio actualizado correctamente' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/socios/:id/estado', (req, res) => {
  try {
    const { estado } = req.body;
    if (!['Activo', 'Inactivo', 'Suspendido'].includes(estado)) {
      return res.status(400).json({ error: 'Estado no válido' });
    }
    db.prepare('UPDATE socios SET estado = ? WHERE id = ?').run(estado, req.params.id);
    res.json({ message: 'Estado actualizado correctamente' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Eliminar socio definitivamente (con auditoría y capacidad de deshacer)
app.delete('/api/socios/:id', (req, res) => {
  try {
    const socioId = req.params.id;
    const socio = db.prepare('SELECT * FROM socios WHERE id = ?').get(socioId);
    if (!socio) return res.status(404).json({ error: 'Socio no encontrado' });

    // Respaldar datos completos para permitir Deshacer si fue un error
    const disciplinas = db.prepare('SELECT disciplina_id FROM socio_disciplinas WHERE socio_id = ?').all(socioId).map(d => d.disciplina_id);
    const cuotas = db.prepare('SELECT * FROM cuotas WHERE socio_id = ?').all(socioId);
    const pagos = db.prepare('SELECT * FROM pagos WHERE socio_id = ?').all(socioId);
    const comprobantes = db.prepare('SELECT * FROM comprobantes_transferencia WHERE socio_id = ?').all(socioId);

    const transaction = db.transaction(() => {
      db.prepare('DELETE FROM comprobantes_transferencia WHERE socio_id = ?').run(socioId);
      db.prepare('DELETE FROM pagos WHERE socio_id = ?').run(socioId);
      db.prepare('DELETE FROM cuotas WHERE socio_id = ?').run(socioId);
      db.prepare('DELETE FROM socio_disciplinas WHERE socio_id = ?').run(socioId);
      db.prepare('DELETE FROM socios WHERE id = ?').run(socioId);
    });

    transaction();

    const auditoriaId = registrarAuditoria(
      'ELIMINAR_SOCIO',
      `Socio eliminado: ${socio.nombre} ${socio.apellido} (${socio.numero_socio} - DNI: ${socio.dni})`,
      { socio, disciplinas, cuotas, pagos, comprobantes },
      null
    );

    res.json({
      message: `Socio ${socio.nombre} ${socio.apellido} (${socio.numero_socio}) eliminado correctamente.`,
      auditoriaId
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// -------------------------------------------------------------
// CUOTAS
// -------------------------------------------------------------
app.get('/api/cuotas', (req, res) => {
  try {
    const { periodo, estado, search } = req.query;
    let query = `
      SELECT c.*, s.nombre, s.apellido, s.numero_socio, s.dni,
        COALESCE((SELECT SUM(monto_pagado) FROM pagos WHERE cuota_id = c.id), 0) as total_cobrado,
        (c.monto_total - COALESCE((SELECT SUM(monto_pagado) FROM pagos WHERE cuota_id = c.id), 0)) as saldo_pendiente
      FROM cuotas c
      JOIN socios s ON c.socio_id = s.id
      WHERE 1=1
    `;
    const params = [];

    if (periodo) {
      query += ` AND c.periodo = ?`;
      params.push(periodo);
    }
    if (estado) {
      query += ` AND c.estado = ?`;
      params.push(estado);
    }
    if (search) {
      query += ` AND (s.nombre LIKE ? OR s.apellido LIKE ? OR s.numero_socio LIKE ? OR s.dni LIKE ?)`;
      const term = `%${search}%`;
      params.push(term, term, term, term);
    }

    query += ` ORDER BY c.id DESC`;
    const cuotas = db.prepare(query).all(...params);
    res.json(cuotas);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Modificar descuento / bonificación de una cuota
app.put('/api/cuotas/:id/descuento', (req, res) => {
  try {
    const cuotaId = req.params.id;
    const { descuento = 0, recargo = 0, motivo = '' } = req.body;

    const cuota = db.prepare('SELECT * FROM cuotas WHERE id = ?').get(cuotaId);
    if (!cuota) return res.status(404).json({ error: 'Cuota no encontrada' });

    const descNum = Math.max(0, parseFloat(descuento) || 0);
    const recNum = Math.max(0, parseFloat(recargo) || 0);
    const nuevoTotal = Math.max(0, cuota.monto_original - descNum + recNum);

    const pagosPrevios = db.prepare('SELECT COALESCE(SUM(monto_pagado), 0) as total FROM pagos WHERE cuota_id = ?').get(cuotaId).total;
    let nuevoEstado = 'Pendiente';
    if (pagosPrevios >= nuevoTotal) {
      nuevoEstado = 'Pagada';
    } else if (pagosPrevios > 0) {
      nuevoEstado = 'Parcial';
    }

    db.prepare(`
      UPDATE cuotas 
      SET descuento = ?, recargo = ?, monto_total = ?, estado = ?
      WHERE id = ?
    `).run(descNum, recNum, nuevoTotal, nuevoEstado, cuotaId);

    res.json({
      message: 'Descuento aplicado correctamente',
      monto_original: cuota.monto_original,
      descuento: descNum,
      recargo: recNum,
      monto_total: nuevoTotal,
      saldo_pendiente: Math.max(0, nuevoTotal - pagosPrevios),
      estado: nuevoEstado
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Generación Masiva de Cuotas
app.post('/api/cuotas/generar-masivo', (req, res) => {
  try {
    const { periodo, diaVencimiento = 10 } = req.body; // Formato: YYYY-MM
    if (!periodo || !/^\d{4}-\d{2}$/.test(periodo)) {
      return res.status(400).json({ error: 'Formato de período inválido. Use YYYY-MM (ej: 2026-11).' });
    }

    const [anioStr, mesStr] = periodo.split('-');
    const anio = parseInt(anioStr);
    const mes = parseInt(mesStr);
    const fechaVencimiento = `${periodo}-${String(diaVencimiento).padStart(2, '0')}`;
    const fechaCreacion = new Date().toISOString().split('T')[0];

    // Obtener socios activos
    const sociosActivos = db.prepare(`
      SELECT s.id, s.nombre, s.apellido, s.categoria_id, cat.nombre as categoria_nombre, cat.cuota_base
      FROM socios s
      JOIN categorias cat ON s.categoria_id = cat.id
      WHERE s.estado = 'Activo'
    `).all();

    let generadas = 0;
    let omitidas = 0;

    const checkCuota = db.prepare('SELECT id FROM cuotas WHERE socio_id = ? AND periodo = ?');
    const getDisciplinas = db.prepare(`
      SELECT d.nombre, d.arancel_mensual
      FROM socio_disciplinas sd
      JOIN disciplinas d ON sd.disciplina_id = d.id
      WHERE sd.socio_id = ?
    `);

    const insertCuota = db.prepare(`
      INSERT INTO cuotas (socio_id, periodo, mes, anio, concepto, monto_original, descuento, recargo, monto_total, fecha_vencimiento, estado, fecha_creacion)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Pendiente', ?)
    `);

    const transaction = db.transaction(() => {
      for (const socio of sociosActivos) {
        const existe = checkCuota.get(socio.id, periodo);
        if (existe) {
          omitidas++;
          continue;
        }

        const disciplinas = getDisciplinas.all(socio.id);
        const totalDisciplinas = disciplinas.reduce((sum, d) => sum + d.arancel_mensual, 0);
        const montoTotal = socio.cuota_base + totalDisciplinas;

        let concepto = `Cuota Social (${socio.categoria_nombre})`;
        if (disciplinas.length > 0) {
          concepto += ` + ${disciplinas.map(d => d.nombre).join(', ')}`;
        }

        insertCuota.run(
          socio.id,
          periodo,
          mes,
          anio,
          concepto,
          montoTotal,
          0,
          0,
          montoTotal,
          fechaVencimiento,
          fechaCreacion
        );
        generadas++;
      }
    });

    transaction();

    res.json({
      message: `Generación completada para el período ${periodo}.`,
      generadas,
      omitidas,
      totalSociosActivos: sociosActivos.length
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// -------------------------------------------------------------
// COBROS Y PAGOS
// -------------------------------------------------------------
app.post('/api/pagos', (req, res) => {
  try {
    const { cuota_id, medio_pago, monto_pagado, observaciones = '', cajero = 'Admin Recepción' } = req.body;

    if (!cuota_id || !medio_pago) {
      return res.status(400).json({ error: 'La cuota y el medio de pago son obligatorios.' });
    }

    const cuota = db.prepare('SELECT * FROM cuotas WHERE id = ?').get(cuota_id);
    if (!cuota) {
      return res.status(404).json({ error: 'Cuota no encontrada' });
    }
    if (cuota.estado === 'Pagada') {
      return res.status(400).json({ error: 'Esta cuota ya ha sido cobrada en su totalidad.' });
    }

    const pagosPrevios = db.prepare('SELECT COALESCE(SUM(monto_pagado), 0) as total FROM pagos WHERE cuota_id = ?').get(cuota_id).total;
    const saldoPendiente = Math.max(0, cuota.monto_total - pagosPrevios);

    if (saldoPendiente <= 0) {
      db.prepare("UPDATE cuotas SET estado = 'Pagada' WHERE id = ?").run(cuota_id);
      return res.status(400).json({ error: 'Esta cuota ya no tiene saldo pendiente por cobrar.' });
    }

    let montoFinal = monto_pagado !== undefined && monto_pagado !== null && monto_pagado !== ''
      ? parseFloat(monto_pagado)
      : saldoPendiente;

    if (isNaN(montoFinal) || montoFinal <= 0) {
      return res.status(400).json({ error: 'El monto a cobrar debe ser mayor a 0.' });
    }

    if (montoFinal > saldoPendiente) {
      montoFinal = saldoPendiente; // No exceder la deuda de la cuota
    }

    const fechaPago = new Date().toISOString().replace('T', ' ').substring(0, 19);

    const lastPago = db.prepare('SELECT id FROM pagos ORDER BY id DESC LIMIT 1').get();
    const nextPagoId = (lastPago ? lastPago.id : 0) + 1;
    const anioActual = new Date().getFullYear();
    const nroComprobante = `REC-${anioActual}-${String(nextPagoId).padStart(5, '0')}`;

    const transaction = db.transaction(() => {
      // Registrar pago
      const insertPago = db.prepare(`
        INSERT INTO pagos (cuota_id, socio_id, monto_pagado, medio_pago, nro_comprobante, fecha_pago, observaciones, cajero)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);
      const result = insertPago.run(cuota_id, cuota.socio_id, montoFinal, medio_pago, nroComprobante, fechaPago, observaciones, cajero);

      const nuevoTotalCobrado = pagosPrevios + montoFinal;
      const nuevoSaldo = Math.max(0, cuota.monto_total - nuevoTotalCobrado);

      // Actualizar estado de cuota
      if (nuevoSaldo <= 0.01) {
        db.prepare("UPDATE cuotas SET estado = 'Pagada' WHERE id = ?").run(cuota_id);
      } else {
        db.prepare("UPDATE cuotas SET estado = 'Parcial' WHERE id = ?").run(cuota_id);
      }

      return { pagoId: result.lastInsertRowid, saldoRestante: nuevoSaldo, nuevoTotalCobrado };
    });

    const { pagoId, saldoRestante, nuevoTotalCobrado } = transaction();

    const pagoCompleto = db.prepare(`
      SELECT p.*, s.nombre, s.apellido, s.numero_socio, s.dni, c.periodo, c.concepto, c.monto_total as cuota_monto_total
      FROM pagos p
      JOIN socios s ON p.socio_id = s.id
      JOIN cuotas c ON p.cuota_id = c.id
      WHERE p.id = ?
    `).get(pagoId);

    pagoCompleto.saldo_restante = saldoRestante;
    pagoCompleto.total_cobrado_cuota = nuevoTotalCobrado;
    pagoCompleto.es_parcial = saldoRestante > 0;

    const auditoriaId = registrarAuditoria(
      'PAGO',
      `Cobro de cuota ${cuota.periodo} a ${pagoCompleto.nombre} ${pagoCompleto.apellido}: $${montoFinal.toLocaleString('es-AR')} (${pagoCompleto.nro_comprobante})`,
      { cuota_id, estado_anterior: cuota.estado, pagos_previos: pagosPrevios },
      { pagoId, montoFinal, nroComprobante }
    );

    res.status(201).json({
      message: saldoRestante > 0
        ? `Pago registrado correctamente. Saldo restante: $${saldoRestante.toLocaleString('es-AR')}`
        : 'Cuota cancelada en su totalidad.',
      pago: pagoCompleto,
      auditoriaId
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Cancelar todas las cuotas adeudadas de un socio de una sola vez
app.post('/api/socios/:id/cancelar-deuda', (req, res) => {
  try {
    const socioId = req.params.id;
    const { medio_pago = 'Efectivo', observaciones = 'Cancelación total de deuda en ventanilla', cajero = 'Admin Recepción' } = req.body;

    const socio = db.prepare('SELECT * FROM socios WHERE id = ?').get(socioId);
    if (!socio) return res.status(404).json({ error: 'Socio no encontrado' });

    // Buscar cuotas exigibles con saldo pendiente (mes actual o anteriores)
    const cuotasAdeudadas = db.prepare(`
      SELECT c.*,
        (c.monto_total - COALESCE((SELECT SUM(monto_pagado) FROM pagos WHERE cuota_id = c.id), 0)) as saldo_pendiente
      FROM cuotas c
      WHERE c.socio_id = ? AND c.estado IN ('Pendiente', 'Vencida', 'Parcial') AND c.periodo <= '2026-10'
      ORDER BY c.periodo ASC
    `).all(socioId).filter(c => c.saldo_pendiente > 0);

    if (cuotasAdeudadas.length === 0) {
      return res.status(400).json({ error: 'El socio no tiene cuotas pendientes de pago.' });
    }

    const fechaPago = new Date().toISOString().replace('T', ' ').substring(0, 19);
    const anioActual = new Date().getFullYear();

    let totalPagadoGeneral = 0;
    const pagosGenerados = [];

    const transaction = db.transaction(() => {
      for (const cuota of cuotasAdeudadas) {
        const saldo = cuota.saldo_pendiente;
        totalPagadoGeneral += saldo;

        const lastPago = db.prepare('SELECT id FROM pagos ORDER BY id DESC LIMIT 1').get();
        const nextPagoId = (lastPago ? lastPago.id : 0) + 1;
        const nroComprobante = `REC-${anioActual}-${String(nextPagoId).padStart(5, '0')}`;

        db.prepare(`
          INSERT INTO pagos (cuota_id, socio_id, monto_pagado, medio_pago, nro_comprobante, fecha_pago, observaciones, cajero)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(cuota.id, socioId, saldo, medio_pago, nroComprobante, fechaPago, observaciones, cajero);

        db.prepare("UPDATE cuotas SET estado = 'Pagada' WHERE id = ?").run(cuota.id);

        pagosGenerados.push({
          periodo: cuota.periodo,
          concepto: cuota.concepto,
          monto_pagado: saldo,
          nro_comprobante: nroComprobante
        });
      }
    });

    transaction();

    const auditoriaId = registrarAuditoria(
      'CANCELAR_DEUDA',
      `Cancelación total de deuda a ${socio.nombre} ${socio.apellido}: $${totalPagadoGeneral.toLocaleString('es-AR')} (${cuotasAdeudadas.length} cuotas)`,
      { socioId, cuotasAdeudadas: cuotasAdeudadas.map(c => ({ id: c.id, estado: c.estado })) },
      { pagosGenerados, totalPagadoGeneral }
    );

    res.json({
      message: `Deuda total de $${totalPagadoGeneral.toLocaleString('es-AR')} cancelada exitosamente (${cuotasAdeudadas.length} cuotas).`,
      totalPagado: totalPagadoGeneral,
      cuotasCanceladas: cuotasAdeudadas.length,
      socio: `${socio.nombre} ${socio.apellido}`,
      auditoriaId
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/pagos', (req, res) => {
  try {
    const rows = db.prepare(`
      SELECT p.*, s.nombre, s.apellido, s.numero_socio, s.dni, c.periodo, c.concepto
      FROM pagos p
      JOIN socios s ON p.socio_id = s.id
      JOIN cuotas c ON p.cuota_id = c.id
      ORDER BY p.id DESC
      LIMIT 100
    `).all();
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// -------------------------------------------------------------
// CARNET DIGITAL / CONTROL DE ACCESO
// -------------------------------------------------------------
app.get('/api/socios/:id/carnet', (req, res) => {
  try {
    const socio = db.prepare(`
      SELECT s.*, cat.nombre as categoria_nombre
      FROM socios s
      JOIN categorias cat ON s.categoria_id = cat.id
      WHERE s.id = ?
    `).get(req.params.id);

    if (!socio) return res.status(404).json({ error: 'Socio no encontrado' });

    // Cuotas pendientes o con saldo parcial del mes actual o anteriores (vencidas)
    const deuda = db.prepare(`
      SELECT 
        COUNT(CASE WHEN (c.monto_total - COALESCE((SELECT SUM(p.monto_pagado) FROM pagos p WHERE p.cuota_id = c.id), 0)) > 0 THEN 1 END) as cuotas_adeudadas,
        COALESCE(SUM(c.monto_total - COALESCE((SELECT SUM(p.monto_pagado) FROM pagos p WHERE p.cuota_id = c.id), 0)), 0) as total_deuda
      FROM cuotas c
      WHERE c.socio_id = ? AND c.estado IN ('Pendiente', 'Vencida', 'Parcial') AND c.periodo <= '2026-10'
    `).get(req.params.id);

    const alDia = deuda.cuotas_adeudadas === 0 && socio.estado === 'Activo';

    res.json({
      socio,
      alDia,
      cuotasAdeudadas: deuda.cuotas_adeudadas,
      totalDeuda: deuda.total_deuda,
      qrData: JSON.stringify({
        id: socio.id,
        socio: socio.numero_socio,
        dni: socio.dni,
        estado: alDia ? 'HABILITADO' : 'INHABILITADO'
      })
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// -------------------------------------------------------------
// PORTAL DEL SOCIO
// -------------------------------------------------------------
app.get('/api/socio/perfil', (req, res) => {
  try {
    const { search } = req.query;
    if (!search) return res.status(400).json({ error: 'Ingrese DNI o N° de Socio' });

    const socio = db.prepare(`
      SELECT s.*, cat.nombre as categoria_nombre, cat.cuota_base
      FROM socios s
      JOIN categorias cat ON s.categoria_id = cat.id
      WHERE s.dni = ? OR s.numero_socio = ?
    `).get(search.trim(), search.trim());

    if (!socio) return res.status(404).json({ error: 'No se encontró ningún socio con esos datos.' });

    const disciplinas = db.prepare(`
      SELECT d.nombre, d.arancel_mensual, d.profesor, d.dias_horarios
      FROM socio_disciplinas sd
      JOIN disciplinas d ON sd.disciplina_id = d.id
      WHERE sd.socio_id = ?
    `).all(socio.id);

    // Cuotas con verificación de comprobante pendiente y saldos
    const cuotas = db.prepare(`
      SELECT c.*,
        COALESCE((SELECT SUM(monto_pagado) FROM pagos WHERE cuota_id = c.id), 0) as total_cobrado,
        (c.monto_total - COALESCE((SELECT SUM(monto_pagado) FROM pagos WHERE cuota_id = c.id), 0)) as saldo_pendiente,
        (SELECT id FROM comprobantes_transferencia ct 
         WHERE ct.cuota_id = c.id AND ct.estado = 'Pendiente' LIMIT 1) as comprobante_pendiente_id,
        (SELECT estado FROM comprobantes_transferencia ct 
         WHERE ct.cuota_id = c.id ORDER BY ct.id DESC LIMIT 1) as ultimo_comprobante_estado
      FROM cuotas c
      WHERE c.socio_id = ?
      ORDER BY c.periodo DESC
    `).all(socio.id);

    const deuda = db.prepare(`
      SELECT 
        COUNT(CASE WHEN (c.monto_total - COALESCE((SELECT SUM(p.monto_pagado) FROM pagos p WHERE p.cuota_id = c.id), 0)) > 0 THEN 1 END) as cuotas_adeudadas,
        COALESCE(SUM(c.monto_total - COALESCE((SELECT SUM(p.monto_pagado) FROM pagos p WHERE p.cuota_id = c.id), 0)), 0) as total_deuda
      FROM cuotas c
      WHERE c.socio_id = ? AND c.estado IN ('Pendiente', 'Vencida', 'Parcial') AND c.periodo <= '2026-10'
    `).get(socio.id);

    const alDia = deuda.cuotas_adeudadas === 0 && socio.estado === 'Activo';

    res.json({
      socio,
      disciplinas,
      cuotas,
      alDia,
      cuotasAdeudadas: deuda.cuotas_adeudadas,
      totalDeuda: deuda.total_deuda,
      datosBancarios: getDatosBancarios()
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Socio sube comprobante de transferencia
app.post('/api/socio/subir-comprobante', (req, res) => {
  try {
    const { socio_id, cuota_id, banco_origen, nro_transaccion, monto_declarado, archivo_url } = req.body;

    if (!socio_id || !cuota_id || !monto_declarado) {
      return res.status(400).json({ error: 'Faltan campos obligatorios' });
    }

    const cuota = db.prepare('SELECT * FROM cuotas WHERE id = ? AND socio_id = ?').get(cuota_id, socio_id);
    if (!cuota) return res.status(404).json({ error: 'Cuota no válida para este socio' });
    if (cuota.estado === 'Pagada') return res.status(400).json({ error: 'Esta cuota ya está saldada' });

    // Revisar si ya hay uno pendiente
    const pendiente = db.prepare("SELECT id FROM comprobantes_transferencia WHERE cuota_id = ? AND estado = 'Pendiente'").get(cuota_id);
    if (pendiente) {
      return res.status(400).json({ error: 'Ya enviaste un comprobante para esta cuota que está en proceso de revisión por tesorería.' });
    }

    const fechaSubida = new Date().toISOString().replace('T', ' ').substring(0, 19);

    const insert = db.prepare(`
      INSERT INTO comprobantes_transferencia (socio_id, cuota_id, banco_origen, nro_transaccion, monto_declarado, archivo_url, fecha_subida, estado)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'Pendiente')
    `);
    const result = insert.run(socio_id, cuota_id, banco_origen || '', nro_transaccion || '', monto_declarado, archivo_url || '', fechaSubida);

    res.status(201).json({
      message: 'Comprobante recibido con éxito. Será revisado por la tesorería del club a la brevedad.',
      id: result.lastInsertRowid
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// -------------------------------------------------------------
// TESORERÍA: BANDEJA DE CONCILIACIÓN DE COMPROBANTES
// -------------------------------------------------------------
app.get('/api/tesoreria/comprobantes', (req, res) => {
  try {
    const estado = req.query.estado || 'Pendiente';
    let query = `
      SELECT ct.*, 
             s.nombre, s.apellido, s.numero_socio, s.dni, s.telefono, s.email,
             c.periodo, c.concepto, c.monto_total as monto_cuota, c.estado as estado_cuota
      FROM comprobantes_transferencia ct
      JOIN socios s ON ct.socio_id = s.id
      JOIN cuotas c ON ct.cuota_id = c.id
    `;
    const params = [];
    if (estado !== 'Todos') {
      query += ` WHERE ct.estado = ?`;
      params.push(estado);
    }
    query += ` ORDER BY ct.id DESC`;

    const rows = db.prepare(query).all(...params);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Tesorero Aprueba comprobante
app.post('/api/tesoreria/comprobantes/:id/aprobar', (req, res) => {
  try {
    const compId = req.params.id;
    const comp = db.prepare('SELECT * FROM comprobantes_transferencia WHERE id = ?').get(compId);
    if (!comp) return res.status(404).json({ error: 'Comprobante no encontrado' });
    if (comp.estado !== 'Pendiente') return res.status(400).json({ error: `Este comprobante ya fue ${comp.estado.toLowerCase()}` });

    const cuota = db.prepare('SELECT * FROM cuotas WHERE id = ?').get(comp.cuota_id);
    if (!cuota) return res.status(404).json({ error: 'Cuota no encontrada' });

    const fechaAhora = new Date().toISOString().replace('T', ' ').substring(0, 19);

    const transaction = db.transaction(() => {
      // 1. Actualizar estado del comprobante
      db.prepare(`
        UPDATE comprobantes_transferencia 
        SET estado = 'Aprobado', revisado_por = 'Tesorero', fecha_revision = ?
        WHERE id = ?
      `).run(fechaAhora, compId);

      // 2. Marcar cuota como Pagada
      db.prepare("UPDATE cuotas SET estado = 'Pagada' WHERE id = ?").run(comp.cuota_id);

      // 3. Generar número de recibo e impactar en caja (pagos)
      const lastPago = db.prepare('SELECT id FROM pagos ORDER BY id DESC LIMIT 1').get();
      const nextPagoId = (lastPago ? lastPago.id : 0) + 1;
      const anioActual = new Date().getFullYear();
      const nroComprobante = `REC-${anioActual}-${String(nextPagoId).padStart(5, '0')}`;

      const obs = `Transferencia aprobada por Tesorería. Banco: ${comp.banco_origen || 'No esp.'} | Transacción #${comp.nro_transaccion || '-'}`;

      db.prepare(`
        INSERT INTO pagos (cuota_id, socio_id, monto_pagado, medio_pago, nro_comprobante, fecha_pago, observaciones, cajero)
        VALUES (?, ?, ?, 'Transferencia Bancaria', ?, ?, ?, 'Tesorería Online')
      `).run(comp.cuota_id, comp.socio_id, comp.monto_declarado, nroComprobante, fechaAhora, obs);

      return nroComprobante;
    });

    const nroRecibo = transaction();

    const auditoriaId = registrarAuditoria(
      'COMPROBANTE_APROBADO',
      `Aprobación comprobante #${compId} (Transf. $${comp.monto_declarado.toLocaleString('es-AR')}) - Recibo ${nroRecibo}`,
      { compId, cuota_id: comp.cuota_id, estado_cuota_anterior: cuota.estado },
      { nroComprobante: nroRecibo, monto: comp.monto_declarado }
    );

    res.json({
      message: 'Comprobante aprobado exitosamente. Se ha cancelado la cuota y acreditado el pago en caja.',
      nroRecibo,
      auditoriaId
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Tesorero Rechaza comprobante
app.post('/api/tesoreria/comprobantes/:id/rechazar', (req, res) => {
  try {
    const compId = req.params.id;
    const { motivo_rechazo = 'Comprobante no coincide con extracto bancario' } = req.body;

    const comp = db.prepare('SELECT * FROM comprobantes_transferencia WHERE id = ?').get(compId);
    if (!comp) return res.status(404).json({ error: 'Comprobante no encontrado' });
    if (comp.estado !== 'Pendiente') return res.status(400).json({ error: `Este comprobante ya fue ${comp.estado.toLowerCase()}` });

    const fechaAhora = new Date().toISOString().replace('T', ' ').substring(0, 19);

    db.prepare(`
      UPDATE comprobantes_transferencia 
      SET estado = 'Rechazado', motivo_rechazo = ?, revisado_por = 'Tesorero', fecha_revision = ?
      WHERE id = ?
    `).run(motivo_rechazo, fechaAhora, compId);

    const auditoriaId = registrarAuditoria(
      'COMPROBANTE_RECHAZADO',
      `Rechazo comprobante #${compId}: "${motivo_rechazo}"`,
      { compId },
      { motivo_rechazo }
    );

    res.json({
      message: 'Comprobante rechazado. El socio podrá volver a subir el comprobante correcto.',
      auditoriaId
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// -------------------------------------------------------------
// COPIA DE SEGURIDAD (BACKUP) DE LA BASE DE DATOS
// -------------------------------------------------------------
app.get('/api/admin/backup', (req, res) => {
  try {
    const fs = require('fs');
    const fecha = new Date().toISOString().split('T')[0];
    const backupFileName = `club-tercer-tiempo-backup-${fecha}.db`;
    const tempBackupPath = path.join(__dirname, 'temp-download-backup.db');

    db.pragma('wal_checkpoint(TRUNCATE)');

    db.backup(tempBackupPath).then(() => {
      res.download(tempBackupPath, backupFileName, (err) => {
        if (fs.existsSync(tempBackupPath)) {
          try { fs.unlinkSync(tempBackupPath); } catch (e) {}
        }
      });
    }).catch(err => {
      res.status(500).json({ error: 'Error al generar backup: ' + err.message });
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// -------------------------------------------------------------
// HISTORIAL DE AUDITORÍA Y DESHACER ACCIONES
// -------------------------------------------------------------
app.get('/api/acciones/ultimas', (req, res) => {
  try {
    const acciones = db.prepare(`
      SELECT id, tipo, descripcion, fecha, deshecho
      FROM auditoria_acciones
      ORDER BY id DESC
      LIMIT 20
    `).all();
    res.json(acciones);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/acciones/:id/deshacer', (req, res) => {
  try {
    const accionId = req.params.id;
    const accion = db.prepare('SELECT * FROM auditoria_acciones WHERE id = ?').get(accionId);
    if (!accion) return res.status(404).json({ error: 'Acción no encontrada.' });
    if (accion.deshecho === 1) return res.status(400).json({ error: 'Esta acción ya fue deshecha anteriormente.' });

    const anterior = accion.datos_anteriores ? JSON.parse(accion.datos_anteriores) : null;
    const nuevo = accion.datos_nuevos ? JSON.parse(accion.datos_nuevos) : null;

    const transaction = db.transaction(() => {
      switch (accion.tipo) {
        case 'PAGO': {
          if (nuevo && nuevo.pagoId) {
            db.prepare('DELETE FROM pagos WHERE id = ?').run(nuevo.pagoId);
          }
          if (anterior && anterior.cuota_id) {
            const cuotaId = anterior.cuota_id;
            const cuota = db.prepare('SELECT * FROM cuotas WHERE id = ?').get(cuotaId);
            if (cuota) {
              const pagosRestantes = db.prepare('SELECT COALESCE(SUM(monto_pagado), 0) as total FROM pagos WHERE cuota_id = ?').get(cuotaId).total;
              let restEstado = 'Pendiente';
              if (pagosRestantes >= cuota.monto_total) restEstado = 'Pagada';
              else if (pagosRestantes > 0) restEstado = 'Parcial';
              else restEstado = anterior.estado_anterior || 'Pendiente';
              db.prepare('UPDATE cuotas SET estado = ? WHERE id = ?').run(restEstado, cuotaId);
            }
          }
          break;
        }

        case 'COMPROBANTE_APROBADO': {
          if (nuevo && nuevo.nroComprobante) {
            db.prepare('DELETE FROM pagos WHERE nro_comprobante = ?').run(nuevo.nroComprobante);
          }
          if (anterior && anterior.cuota_id) {
            const estadoPrevio = anterior.estado_cuota_anterior || 'Pendiente';
            db.prepare('UPDATE cuotas SET estado = ? WHERE id = ?').run(estadoPrevio, anterior.cuota_id);
          }
          if (anterior && anterior.compId) {
            db.prepare("UPDATE comprobantes_transferencia SET estado = 'Pendiente', revisado_por = NULL, fecha_revision = NULL WHERE id = ?").run(anterior.compId);
          }
          break;
        }

        case 'COMPROBANTE_RECHAZADO': {
          if (anterior && anterior.compId) {
            db.prepare("UPDATE comprobantes_transferencia SET estado = 'Pendiente', motivo_rechazo = NULL, revisado_por = NULL, fecha_revision = NULL WHERE id = ?").run(anterior.compId);
          }
          break;
        }

        case 'CANCELAR_DEUDA': {
          if (nuevo && Array.isArray(nuevo.pagosGenerados)) {
            for (const p of nuevo.pagosGenerados) {
              db.prepare('DELETE FROM pagos WHERE nro_comprobante = ?').run(p.nro_comprobante);
            }
          }
          if (anterior && Array.isArray(anterior.cuotasAdeudadas)) {
            for (const c of anterior.cuotasAdeudadas) {
              db.prepare('UPDATE cuotas SET estado = ? WHERE id = ?').run(c.estado || 'Pendiente', c.id);
            }
          }
          break;
        }

        case 'CREAR_SOCIO': {
          if (nuevo && nuevo.socioId) {
            db.prepare('DELETE FROM comprobantes_transferencia WHERE socio_id = ?').run(nuevo.socioId);
            db.prepare('DELETE FROM pagos WHERE socio_id = ?').run(nuevo.socioId);
            db.prepare('DELETE FROM cuotas WHERE socio_id = ?').run(nuevo.socioId);
            db.prepare('DELETE FROM socio_disciplinas WHERE socio_id = ?').run(nuevo.socioId);
            db.prepare('DELETE FROM socios WHERE id = ?').run(nuevo.socioId);
          }
          break;
        }

        case 'ELIMINAR_SOCIO': {
          if (anterior && anterior.socio) {
            const s = anterior.socio;
            // Restaurar socio respetando campos completos
            db.prepare(`
              INSERT INTO socios (
                id, numero_socio, nombre, apellido, dni, email, telefono, categoria_id, fecha_alta, estado,
                grupo_familiar_id, fecha_nacimiento, edad, direccion, ocupacion, estado_civil,
                grupo_sanguineo, posee_obra_social, nombre_obra_social, alergias_condiciones,
                contacto_emergencia_nombre, contacto_emergencia_telefono, tutor_nombre, socio_proponente
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(
              s.id, s.numero_socio, s.nombre, s.apellido, s.dni, s.email, s.telefono, s.categoria_id, s.fecha_alta, s.estado,
              s.grupo_familiar_id, s.fecha_nacimiento, s.edad, s.direccion, s.ocupacion, s.estado_civil,
              s.grupo_sanguineo, s.posee_obra_social, s.nombre_obra_social, s.alergias_condiciones,
              s.contacto_emergencia_nombre, s.contacto_emergencia_telefono, s.tutor_nombre, s.socio_proponente
            );

            // Restaurar disciplinas
            if (Array.isArray(anterior.disciplinas)) {
              const insertDisc = db.prepare('INSERT OR IGNORE INTO socio_disciplinas (socio_id, disciplina_id) VALUES (?, ?)');
              for (const dId of anterior.disciplinas) {
                insertDisc.run(s.id, dId);
              }
            }

            // Restaurar cuotas
            if (Array.isArray(anterior.cuotas)) {
              const insertCuota = db.prepare(`
                INSERT INTO cuotas (id, socio_id, periodo, mes, anio, concepto, monto_original, descuento, recargo, monto_total, fecha_vencimiento, estado, fecha_creacion)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
              `);
              for (const c of anterior.cuotas) {
                insertCuota.run(c.id, c.socio_id, c.periodo, c.mes, c.anio, c.concepto, c.monto_original, c.descuento, c.recargo, c.monto_total, c.fecha_vencimiento, c.estado, c.fecha_creacion);
              }
            }

            // Restaurar pagos
            if (Array.isArray(anterior.pagos)) {
              const insertPago = db.prepare(`
                INSERT INTO pagos (id, cuota_id, socio_id, monto_pagado, medio_pago, nro_comprobante, fecha_pago, observaciones, cajero)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
              `);
              for (const p of anterior.pagos) {
                insertPago.run(p.id, p.cuota_id, p.socio_id, p.monto_pagado, p.medio_pago, p.nro_comprobante, p.fecha_pago, p.observaciones, p.cajero);
              }
            }

            // Restaurar comprobantes
            if (Array.isArray(anterior.comprobantes)) {
              const insertComp = db.prepare(`
                INSERT INTO comprobantes_transferencia (id, socio_id, cuota_id, banco_origen, nro_transaccion, monto_declarado, archivo_url, fecha_subida, estado, motivo_rechazo, revisado_por, fecha_revision)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
              `);
              for (const ct of anterior.comprobantes) {
                insertComp.run(ct.id, ct.socio_id, ct.cuota_id, ct.banco_origen, ct.nro_transaccion, ct.monto_declarado, ct.archivo_url, ct.fecha_subida, ct.estado, ct.motivo_rechazo, ct.revisado_por, ct.fecha_revision);
              }
            }
          }
          break;
        }

        default:
          throw new Error('Tipo de acción no soportada para revertir.');
      }

      // Marcar la acción como deshecha
      db.prepare('UPDATE auditoria_acciones SET deshecho = 1 WHERE id = ?').run(accionId);
    });

    transaction();

    res.json({
      message: `Acción deshecha exitosamente: "${accion.descripcion}".`,
      accionId
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`🚀 Servidor de Club iniciado en http://localhost:${PORT}`);
});
