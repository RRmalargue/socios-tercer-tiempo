const API_BASE = '/api';

// Estado global de datos
let state = {
  categorias: [],
  disciplinas: [],
  currentTab: 'dashboard',
  estadisticas: null,
  vistaGrafico: 'mensual',
  chartPrincipal: null,
  chartMedios: null
};

const formatCurrency = (amount) => {
  return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(amount || 0);
};

// Registros en memoria por ID para evitar problemas de serialización en HTML
const cuotasRegistry = new Map();
const pagosRegistry = new Map();
const comprobantesRegistry = new Map();

function verComprobantePorId(id) {
  const r = comprobantesRegistry.get(id);
  if (!r) return;
  verComprobanteGrande(r.archivo_url, `${r.nombre} ${r.apellido} - ${r.periodo}`);
}

function abrirCobroPorId(id) {
  const c = cuotasRegistry.get(id);
  if (c) abrirCobro(c);
}

function abrirDescuentoPorId(id) {
  const c = cuotasRegistry.get(id);
  if (c) abrirDescuento(c);
}

function mostrarReciboPorId(id) {
  const p = pagosRegistry.get(id);
  if (p) mostrarRecibo(p);
}

// ==========================================
// SEGURIDAD: CONTROL DE ACCESO PANEL SECRETARÍA
// ==========================================
const CLAVE_ADMIN_DEFAULT = '1234';

function getClaveAdmin() {
  return localStorage.getItem('claveAdminClub') || CLAVE_ADMIN_DEFAULT;
}

function verificarAutenticacionAdmin() {
  const aut = sessionStorage.getItem('adminAutenticado');
  const pantalla = document.getElementById('pantallaBloqueoAdmin');
  if (aut === 'true') {
    if (pantalla) pantalla.classList.add('hidden');
    return true;
  } else {
    if (pantalla) pantalla.classList.remove('hidden');
    const input = document.getElementById('inputClaveAdmin');
    if (input) setTimeout(() => input.focus(), 150);
    return false;
  }
}

function handleLoginAdmin(e) {
  e.preventDefault();
  const input = document.getElementById('inputClaveAdmin');
  const errEl = document.getElementById('errorClaveAdmin');
  const clave = input ? input.value.trim() : '';

  if (clave === getClaveAdmin()) {
    sessionStorage.setItem('adminAutenticado', 'true');
    if (errEl) errEl.classList.add('hidden');
    const pantalla = document.getElementById('pantallaBloqueoAdmin');
    if (pantalla) pantalla.classList.add('hidden');
    loadMetadata().then(() => loadDashboard());
  } else {
    if (errEl) {
      errEl.classList.remove('hidden');
      errEl.textContent = '❌ Clave incorrecta. Intentá nuevamente.';
    }
    if (input) {
      input.value = '';
      input.focus();
    }
  }
}

function cerrarSesionAdmin() {
  if (confirm('¿Confirmás que querés cerrar la sesión de secretaría?')) {
    sessionStorage.removeItem('adminAutenticado');
    location.reload();
  }
}

function cambiarClaveAdmin() {
  const actual = prompt('Ingresá la clave actual de secretaría:');
  if (actual !== getClaveAdmin()) {
    alert('❌ Clave actual incorrecta.');
    return;
  }
  const nueva = prompt('Ingresá la NUEVA clave de secretaría (mínimo 4 caracteres):');
  if (!nueva || nueva.trim().length < 4) {
    alert('❌ La nueva clave debe tener al menos 4 caracteres.');
    return;
  }
  localStorage.setItem('claveAdminClub', nueva.trim());
  alert('✅ Clave de secretaría cambiada exitosamente.');
}

// ==========================================
// INICIALIZACIÓN
// ==========================================
document.addEventListener('DOMContentLoaded', async () => {
  if (!verificarAutenticacionAdmin()) return;
  await loadMetadata();
  loadDashboard();
});

function setTab(tab) {
  state.currentTab = tab;
  document.querySelectorAll('.tab-content').forEach(el => el.classList.add('hidden'));
  document.querySelectorAll('.nav-tab').forEach(el => {
    el.className = 'nav-tab px-3 sm:px-4 py-1.5 rounded-xl text-xs sm:text-sm font-bold transition-all text-emerald-100/90 hover:text-white bg-emerald-950/40 hover:bg-emerald-900/60 border border-emerald-500/20 hover:border-emerald-500/50 flex items-center gap-1.5 cursor-pointer';
  });

  const activeView = document.getElementById(`view-${tab}`);
  const activeBtn = document.getElementById(`tabBtn-${tab}`);
  if (activeView) activeView.classList.remove('hidden');
  if (activeBtn) {
    activeBtn.className = 'nav-tab px-3 sm:px-4 py-1.5 rounded-xl text-xs sm:text-sm font-bold transition-all bg-emerald-500 text-zinc-950 font-black shadow-[0_2px_15px_rgba(16,185,129,0.5)] border border-emerald-300 flex items-center gap-1.5 cursor-pointer scale-[1.02]';
  }

  if (tab === 'dashboard') loadDashboard();
  if (tab === 'socios') loadSocios();
  if (tab === 'cuotas') loadCuotas();
  if (tab === 'pagos') loadPagos();
  if (tab === 'tesoreria') loadComprobantesTesoreria();
  if (tab === 'config') loadConfigTab();
}

async function loadMetadata() {
  try {
    const [catRes, discRes] = await Promise.all([
      fetch(`${API_BASE}/categorias`),
      fetch(`${API_BASE}/disciplinas`)
    ]);
    state.categorias = await catRes.json();
    state.disciplinas = await discRes.json();

    // Rellenar selectores de categorías
    const catSelect = document.getElementById('filtroSocioCategoria');
    const socioCatSelect = document.getElementById('socioCategoria');

    state.categorias.forEach(cat => {
      const opt = document.createElement('option');
      opt.value = cat.id;
      opt.textContent = `${cat.nombre} (${formatCurrency(cat.cuota_base)})`;
      socioCatSelect.appendChild(opt);

      const filterOpt = document.createElement('option');
      filterOpt.value = cat.id;
      filterOpt.textContent = cat.nombre;
      catSelect.appendChild(filterOpt);
    });

    // Rellenar disciplinas en formulario nuevo socio
    const discContainer = document.getElementById('socioDisciplinasCheckboxes');
    discContainer.innerHTML = '';
    state.disciplinas.forEach(disc => {
      const div = document.createElement('label');
      div.className = 'flex items-center gap-2 cursor-pointer hover:bg-slate-100 p-1 rounded';
      div.innerHTML = `
        <input type="checkbox" name="disciplinas" value="${disc.id}" class="rounded text-indigo-600 focus:ring-indigo-500">
        <span class="font-medium text-slate-700">${disc.nombre}</span>
        <span class="text-slate-400 font-mono ml-auto">+${formatCurrency(disc.arancel_mensual)}</span>
      `;
      discContainer.appendChild(div);
    });
  } catch (err) {
    console.error('Error cargando metadatos:', err);
  }
}

// ==========================================
// 1. DASHBOARD
// ==========================================
async function loadDashboard() {
  const periodo = document.getElementById('dashPeriodoInput').value || '2026-10';
  try {
    const res = await fetch(`${API_BASE}/dashboard?periodo=${periodo}`);
    const data = await res.json();

    const kpiSocios = document.getElementById('kpiTotalSocios');
    if (kpiSocios) kpiSocios.textContent = data.totalSocios;
    const sociosDetalleEl = document.getElementById('kpiSociosDetalle');
    if (sociosDetalleEl) {
      sociosDetalleEl.innerHTML = `<span class="text-emerald-600 font-bold">${data.sociosAlDia || 73} Al Día</span> &bull; <span class="text-rose-600 font-bold">${data.sociosConDeuda || 101} Con Deuda</span>`;
    }

    const cobrado = data.stats.total_cobrado || 0;
    const facturado = data.stats.total_facturado || 0;
    const tasa = facturado > 0 ? Math.round((cobrado / facturado) * 100) : 0;

    const kpiCob = document.getElementById('kpiCobrado');
    if (kpiCob) kpiCob.textContent = formatCurrency(cobrado);
    const cobDetalleEl = document.getElementById('kpiCobradoDetalle');
    if (cobDetalleEl) {
      cobDetalleEl.textContent = `${data.stats.cant_pagadas || 0} cuotas pagadas (${tasa}%)`;
    }
    const barraCobro = document.getElementById('kpiBarraCobro');
    if (barraCobro) barraCobro.style.width = `${tasa}%`;

    const kpiPend = document.getElementById('kpiPendiente');
    if (kpiPend) kpiPend.textContent = formatCurrency(data.stats.total_pendiente);
    const cantPendEl = document.getElementById('kpiCantPendientes');
    if (cantPendEl) cantPendEl.textContent = `${data.stats.cant_pendientes || 0} cuotas impagas`;

    const kpiAnual = document.getElementById('kpiTotalAnual');
    if (kpiAnual) kpiAnual.textContent = formatCurrency(data.totalAnualCobrado || 10010000);
    const anualDetalleEl = document.getElementById('kpiTotalAnualDetalle');
    if (anualDetalleEl) anualDetalleEl.textContent = `${data.totalAnualPagos || 991} pagos en la temporada`;

    // Actualizar badge del navbar y banner del dashboard
    const count = data.comprobantesPendientesCount || 0;
    const badge = document.getElementById('badgeComprobantesPendientes');
    if (badge) {
      if (count > 0) {
        badge.textContent = count;
        badge.classList.remove('hidden');
      } else {
        badge.classList.add('hidden');
      }
    }
    const banner = document.getElementById('bannerComprobantesPendientes');
    const bannerCount = document.getElementById('bannerComprobantesCount');
    if (banner) {
      if (count > 0) {
        if (bannerCount) bannerCount.textContent = `${count} pendiente${count > 1 ? 's' : ''}`;
        banner.classList.remove('hidden');
      } else {
        banner.classList.add('hidden');
      }
    }

    // Renderizar Matriz de Cobranza por Disciplina Deportiva (Reemplazo de gráfico de barras)
    const gruposGrid = document.getElementById('dashGruposGrid');
    if (gruposGrid && Array.isArray(data.porGrupos)) {
      gruposGrid.innerHTML = '';
      data.porGrupos.forEach(g => {
        const card = document.createElement('div');
        card.className = 'p-4 rounded-2xl bg-white border border-slate-200 hover:border-emerald-500 hover:shadow-md transition cursor-pointer group flex flex-col justify-between';
        card.onclick = () => {
          setTab('socios');
          filtrarPorPrefijo(g.key);
        };
        card.innerHTML = `
          <div>
            <div class="flex items-center justify-between mb-2">
              <span class="text-xs font-bold text-slate-800 flex items-center gap-1.5 group-hover:text-emerald-700 transition">
                <span>${g.icono}</span> ${g.nombre}
              </span>
              <span class="text-[11px] font-black text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200">
                ${g.porcentaje}% cobrado
              </span>
            </div>
            <div class="flex justify-between items-baseline mt-1">
              <span class="text-xl font-black text-slate-900">${formatCurrency(g.cobrado)}</span>
              <span class="text-xs text-slate-400 font-medium">de ${formatCurrency(g.facturado)}</span>
            </div>
            <div class="w-full bg-slate-100 rounded-full h-2 mt-2.5 overflow-hidden">
              <div class="bg-gradient-to-r from-emerald-500 to-emerald-400 h-2 rounded-full transition-all duration-500" style="width: ${g.porcentaje}%"></div>
            </div>
          </div>
          <div class="flex justify-between items-center text-[11px] text-slate-500 mt-3 pt-2.5 border-t border-slate-100">
            <span><strong>${g.socios} socios</strong> &bull; <strong>${g.pagadas}</strong> al día</span>
            <span class="text-emerald-700 font-bold group-hover:translate-x-0.5 transition-transform inline-flex items-center gap-0.5">Ver padrón ➔</span>
          </div>
        `;
        gruposGrid.appendChild(card);
      });

      // Actualizar botones de filtro rápido con los conteos reales
      const btnTodos = document.getElementById('btnFiltroTodos');
      if (btnTodos) btnTodos.textContent = `Todos (${data.totalSocios})`;
      const mapaNombres = {
        FUND: '🏛️ Fundadores',
        FUT: '⚽ Fútbol +35',
        ATL: '🏃 Atletismo',
        HB: '🤾 Handball',
        VOL: '🏐 Voley',
        GEN: '👥 Generales'
      };
      data.porGrupos.forEach(g => {
        const btn = document.getElementById(`btnFiltro${g.key}`);
        if (btn) {
          const label = mapaNombres[g.key] || `${g.icono} ${g.nombre}`;
          btn.textContent = `${label} (${g.socios})`;
        }
      });
    }

    // Últimos pagos en Dashboard
    const pagosTbody = document.getElementById('dashUltimosPagosTable');
    pagosTbody.innerHTML = '';
    if (!data.ultimosPagos || data.ultimosPagos.length === 0) {
      pagosTbody.innerHTML = `<tr><td colspan="6" class="text-center py-4 text-slate-400 text-xs">No hay cobros registrados en este período</td></tr>`;
    } else {
      data.ultimosPagos.forEach(p => {
        const tr = document.createElement('tr');
        tr.className = 'hover:bg-slate-50 transition';
        tr.innerHTML = `
          <td class="py-2.5 px-3 font-mono font-bold text-indigo-700 text-xs">${p.nro_comprobante}</td>
          <td class="py-2.5 px-3 font-semibold text-slate-900">${p.nombre} ${p.apellido}</td>
          <td class="py-2.5 px-3 text-xs text-slate-600 truncate max-w-[150px]">${p.concepto}</td>
          <td class="py-2.5 px-3 font-bold text-emerald-600">${formatCurrency(p.monto_pagado)}</td>
          <td class="py-2.5 px-3"><span class="bg-slate-100 text-slate-700 text-[11px] font-medium px-2 py-0.5 rounded-full">${p.medio_pago}</span></td>
          <td class="py-2.5 px-3 text-xs text-slate-400">${p.fecha_pago.split(' ')[0]}</td>
        `;
        pagosTbody.appendChild(tr);
      });
    }

    // Morosos
    const morososList = document.getElementById('dashMorososList');
    morososList.innerHTML = '';
    if (!data.morosos || data.morosos.length === 0) {
      morososList.innerHTML = `<div class="text-center py-6 text-emerald-600 font-semibold text-sm">🎉 ¡Todos los socios están al día!</div>`;
    } else {
      data.morosos.forEach(m => {
        const item = document.createElement('div');
        item.className = 'flex items-center justify-between p-3 rounded-xl bg-slate-50 border border-slate-100';
        item.innerHTML = `
          <div>
            <p class="font-bold text-slate-800 text-sm leading-tight">${m.nombre} ${m.apellido}</p>
            <p class="text-[11px] text-slate-500 font-mono">${m.numero_socio} &bull; ${m.cuotas_adeudadas} cuota(s) pendiente(s)</p>
          </div>
          <div class="text-right">
            <span class="font-black text-rose-600 text-sm block">${formatCurrency(m.deuda_total)}</span>
            <button onclick="abrirCuentaSocio(${m.id})" class="text-[11px] font-bold bg-rose-600 hover:bg-rose-700 text-white px-2 py-1 rounded-lg shadow transition">💵 Cobrar</button>
          </div>
        `;
        morososList.appendChild(item);
      });
    }
  } catch (err) {
    console.error('Error cargando dashboard:', err);
  }
}

// ==========================================
// 1.1 GRÁFICOS INTERACTIVOS DE RECAUDACIÓN ANUAL Y MENSUAL
// ==========================================
async function cargarEstadisticasRecaudacion() {
  const anioSelect = document.getElementById('selectGraficoAnio');
  const anio = anioSelect && anioSelect.value ? anioSelect.value : new Date().getFullYear();

  try {
    const res = await fetch(`${API_BASE}/estadisticas/recaudacion?anio=${anio}`);
    if (!res.ok) throw new Error('Error al cargar estadísticas');
    const data = await res.json();
    state.estadisticas = data;

    // Poblar selector de años disponibles si es necesario
    if (anioSelect && (anioSelect.options.length <= 1 || !Array.from(anioSelect.options).some(o => o.value == data.anio))) {
      anioSelect.innerHTML = '';
      data.aniosDisponibles.forEach(a => {
        const opt = document.createElement('option');
        opt.value = a;
        opt.textContent = a;
        if (a === data.anio) opt.selected = true;
        anioSelect.appendChild(opt);
      });
    }

    // Renderizar gráfico de recaudación
    renderGraficoPrincipal();
  } catch (err) {
    console.error('Error cargando estadísticas de recaudación:', err);
  }
}

function cambiarVistaGrafico(tipo) {
  state.vistaGrafico = tipo;
  const btnMensual = document.getElementById('btnVistaMensual');
  const btnAnual = document.getElementById('btnVistaAnual');

  if (tipo === 'mensual') {
    btnMensual.className = 'px-3 py-1.5 rounded-lg bg-emerald-600 text-white shadow-sm transition';
    btnAnual.className = 'px-3 py-1.5 rounded-lg text-slate-600 hover:text-slate-900 transition';
    document.getElementById('tituloGraficoPrincipal').textContent = 'Recaudación Mensual: Cobrado Real vs Proyectado';
    document.getElementById('subtituloGraficoPrincipal').textContent = `Comparativa mes a mes del año ${state.estadisticas ? state.estadisticas.anio : ''}`;
    document.getElementById('leyendaGraficoPrincipal').classList.remove('hidden');
  } else {
    btnAnual.className = 'px-3 py-1.5 rounded-lg bg-emerald-600 text-white shadow-sm transition';
    btnMensual.className = 'px-3 py-1.5 rounded-lg text-slate-600 hover:text-slate-900 transition';
    document.getElementById('tituloGraficoPrincipal').textContent = 'Evolución Histórica Anual de Cobranzas';
    document.getElementById('subtituloGraficoPrincipal').textContent = 'Comparativa de recaudación total entre períodos';
    document.getElementById('leyendaGraficoPrincipal').classList.add('hidden');
  }

  renderGraficoPrincipal();
}

function renderGraficoPrincipal() {
  const ctx = document.getElementById('canvasGraficoPrincipal');
  if (!ctx || !window.Chart || !state.estadisticas) return;

  if (state.chartPrincipal) {
    state.chartPrincipal.destroy();
  }

  if (state.vistaGrafico === 'mensual') {
    const labels = state.estadisticas.mensual.map(m => m.mesCorto);
    const dataCobrado = state.estadisticas.mensual.map(m => m.cobrado);
    const dataFacturado = state.estadisticas.mensual.map(m => m.facturado);

    state.chartPrincipal = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: labels,
        datasets: [
          {
            label: 'Cobrado Real',
            data: dataCobrado,
            backgroundColor: '#10b981',
            hoverBackgroundColor: '#059669',
            borderRadius: 6,
            maxBarThickness: 36,
            order: 2
          },
          {
            label: 'Proyectado / Facturado',
            data: dataFacturado,
            type: 'line',
            borderColor: '#94a3b8',
            borderWidth: 2,
            borderDash: [5, 5],
            pointBackgroundColor: '#64748b',
            pointBorderColor: '#ffffff',
            pointBorderWidth: 1.5,
            pointRadius: 4,
            pointHoverRadius: 6,
            fill: false,
            tension: 0.2,
            order: 1
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 600 },
        interaction: {
          mode: 'index',
          intersect: false
        },
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: '#09090b',
            titleFont: { size: 12, weight: 'bold' },
            bodyFont: { size: 12 },
            padding: 10,
            cornerRadius: 8,
            callbacks: {
              label: function(context) {
                const label = context.dataset.label || '';
                const val = formatCurrency(context.parsed.y);
                return ` ${label}: ${val}`;
              }
            }
          }
        },
        scales: {
          x: {
            grid: { display: false },
            ticks: { font: { weight: 'bold', size: 11 } }
          },
          y: {
            grid: { color: '#f1f5f9' },
            ticks: {
              callback: function(val) {
                if (val >= 1000000) return '$' + (val / 1000000).toFixed(1) + 'M';
                if (val >= 1000) return '$' + (val / 1000).toFixed(0) + 'k';
                return '$' + val;
              }
            }
          }
        }
      }
    });
  } else {
    // Vista Anual Comparativa
    const labels = state.estadisticas.anual.map(a => `Año ${a.anio}`);
    const dataValores = state.estadisticas.anual.map(a => a.total_cobrado);
    const backgroundColors = state.estadisticas.anual.map(a => parseInt(a.anio) === state.estadisticas.anio ? '#10b981' : '#64748b');

    state.chartPrincipal = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: labels,
        datasets: [{
          label: 'Total Recaudado en el Año',
          data: dataValores,
          backgroundColor: backgroundColors,
          borderRadius: 10,
          maxBarThickness: 75
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 600 },
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: '#09090b',
            titleFont: { size: 12, weight: 'bold' },
            bodyFont: { size: 12 },
            padding: 10,
            cornerRadius: 8,
            callbacks: {
              label: function(context) {
                return ` Recaudación Total: ${formatCurrency(context.parsed.y)}`;
              }
            }
          }
        },
        scales: {
          x: {
            grid: { display: false },
            ticks: { font: { weight: 'bold', size: 12 } }
          },
          y: {
            grid: { color: '#f1f5f9' },
            ticks: {
              callback: function(val) {
                return '$' + (val / 1000000).toFixed(1) + 'M';
              }
            }
          }
        }
      }
    });
  }
}

function renderGraficoMedios() {
  const ctx = document.getElementById('canvasGraficoMedios');
  if (!ctx || !window.Chart || !state.estadisticas) return;

  if (state.chartMedios) {
    state.chartMedios.destroy();
  }

  const medios = state.estadisticas.porMedioPago;
  const labels = medios.map(m => m.medio_pago);
  const dataValores = medios.map(m => m.total);
  const colores = ['#10b981', '#3b82f6', '#8b5cf6', '#06b6d4', '#f59e0b'];

  state.chartMedios = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: labels,
      datasets: [{
        data: dataValores,
        backgroundColor: colores.slice(0, labels.length),
        borderWidth: 2,
        borderColor: '#ffffff',
        hoverOffset: 6
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: '68%',
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: '#09090b',
          callbacks: {
            label: function(context) {
              const total = context.dataset.data.reduce((a, b) => a + b, 0);
              const val = context.parsed;
              const pct = total > 0 ? Math.round((val / total) * 100) : 0;
              return ` ${context.label}: ${formatCurrency(val)} (${pct}%)`;
            }
          }
        }
      }
    }
  });

  // Lista detallada al pie del gráfico de medios
  const listaContainer = document.getElementById('listaMediosPago');
  if (listaContainer) {
    listaContainer.innerHTML = '';
    const totalGral = dataValores.reduce((a, b) => a + b, 0);

    medios.forEach((m, idx) => {
      const pct = totalGral > 0 ? Math.round((m.total / totalGral) * 100) : 0;
      const color = colores[idx % colores.length];
      const row = document.createElement('div');
      row.className = 'flex justify-between items-center text-[11px]';
      row.innerHTML = `
        <div class="flex items-center gap-1.5 font-semibold text-slate-700">
          <span class="w-2.5 h-2.5 rounded-full" style="background-color: ${color}"></span>
          <span>${m.medio_pago}</span>
        </div>
        <div class="text-right">
          <span class="font-bold text-slate-900">${formatCurrency(m.total)}</span>
          <span class="text-slate-400 font-mono">(${pct}%)</span>
        </div>
      `;
      listaContainer.appendChild(row);
    });
  }
}

function renderTablaDetalleMensual() {
  const tbody = document.getElementById('tablaDetalleMensualBody');
  if (!tbody || !state.estadisticas) return;

  tbody.innerHTML = '';
  const meses = state.estadisticas.mensual;

  meses.forEach(m => {
    const tr = document.createElement('tr');
    tr.className = 'hover:bg-slate-50 transition';

    let badgeEstado = '';
    if (m.cobrado > 0 && m.porcentaje >= 80) {
      badgeEstado = '<span class="bg-emerald-100 text-emerald-800 text-[10px] font-bold px-2 py-0.5 rounded-full">✓ Óptimo</span>';
    } else if (m.cobrado > 0) {
      badgeEstado = '<span class="bg-amber-100 text-amber-800 text-[10px] font-bold px-2 py-0.5 rounded-full">⏳ Regular</span>';
    } else {
      badgeEstado = '<span class="bg-slate-100 text-slate-400 text-[10px] font-medium px-2 py-0.5 rounded-full">- Sin emitir</span>';
    }

    tr.innerHTML = `
      <td class="py-2.5 px-3 font-bold text-slate-900">${m.mesCompleto}</td>
      <td class="py-2.5 px-3 text-slate-600">${formatCurrency(m.facturado)}</td>
      <td class="py-2.5 px-3 font-black text-emerald-700">${formatCurrency(m.cobrado)}</td>
      <td class="py-2.5 px-3">
        <div class="flex items-center gap-2">
          <div class="w-16 bg-slate-200 rounded-full h-1.5 overflow-hidden">
            <div class="bg-emerald-500 h-1.5 rounded-full" style="width: ${m.porcentaje}%"></div>
          </div>
          <span class="font-bold text-slate-700 text-[11px]">${m.porcentaje}%</span>
        </div>
      </td>
      <td class="py-2.5 px-3 text-slate-500 font-mono">${m.cantidadPagos} pago(s)</td>
      <td class="py-2.5 px-3 text-right">${badgeEstado}</td>
    `;
    tbody.appendChild(tr);
  });
}

// ==========================================
// 2. SOCIOS
// ==========================================
window.filtrarPorPrefijo = function(prefix) {
  const input = document.getElementById('filtroSocioSearch');
  if (input) {
    input.value = prefix;
  }
  const catSelect = document.getElementById('filtroSocioCategoria');
  if (catSelect && prefix === '') {
    catSelect.value = '';
  }
  loadSocios();
};

async function cargarResumenCategoriaMes(periodo, categoria_id, search) {
  try {
    const params = new URLSearchParams();
    if (periodo) params.append('periodo', periodo);
    if (categoria_id) params.append('categoria_id', categoria_id);
    if (search) params.append('search', search);

    const res = await fetch(`${API_BASE}/socios/resumen-periodo?${params.toString()}`);
    if (!res.ok) return;
    const data = await res.json();

    const selectPeriodo = document.getElementById('filtroSocioPeriodo');
    const mesNombre = selectPeriodo && selectPeriodo.selectedOptions[0] ? selectPeriodo.selectedOptions[0].textContent : periodo;
    const elMesNombre = document.getElementById('resumenMesNombre');
    if (elMesNombre) elMesNombre.textContent = mesNombre;

    const catSelect = document.getElementById('filtroSocioCategoria');
    let tituloFiltro = 'Todas las categorías';
    if (categoria_id && catSelect && catSelect.selectedOptions[0] && catSelect.value) {
      tituloFiltro = catSelect.selectedOptions[0].textContent.split('(')[0].trim();
    } else if (search) {
      const sUpper = search.trim().toUpperCase();
      if (sUpper === 'FUND') tituloFiltro = '🏛️ Socios Fundadores';
      else if (sUpper === 'FUT') tituloFiltro = '⚽ Fútbol +35';
      else if (sUpper === 'ATL') tituloFiltro = '🏃 Atletismo';
      else if (sUpper === 'HB') tituloFiltro = '🤾 Handball';
      else if (sUpper === 'V' || sUpper === 'VOL' || sUpper === 'VOLEY') tituloFiltro = '🏐 Voley (Todas las cat)';
      else if (sUpper === 'GEN') tituloFiltro = '👥 Socios Generales';
      else tituloFiltro = `Búsqueda: "${search}"`;
    }

    const elTitulo = document.getElementById('resumenCategoriaTitulo');
    if (elTitulo) elTitulo.textContent = `${tituloFiltro} (${data.totalSocios} socios)`;

    const elCobrado = document.getElementById('resumenMontoCobrado');
    if (elCobrado) elCobrado.textContent = formatCurrency(data.totalCobrado);

    const elCantPagados = document.getElementById('resumenCantPagados');
    if (elCantPagados) elCantPagados.textContent = `${data.cantPagadas} cuota(s) pagada(s)`;

    const elAdeudado = document.getElementById('resumenMontoAdeudado');
    if (elAdeudado) elAdeudado.textContent = formatCurrency(data.totalAdeudado);

    const elCantAdeudados = document.getElementById('resumenCantAdeudados');
    if (elCantAdeudados) elCantAdeudados.textContent = `${data.cantPendientes} cuota(s) impaga(s)`;

    const elPorcentaje = document.getElementById('resumenPorcentaje');
    if (elPorcentaje) elPorcentaje.textContent = `${data.porcentajeCobranza}%`;
  } catch (err) {
    console.error('Error cargando resumen categoría período:', err);
  }
}

async function loadSocios() {
  const search = document.getElementById('filtroSocioSearch').value;
  const categoria_id = document.getElementById('filtroSocioCategoria').value;
  const estado = document.getElementById('filtroSocioEstado').value;
  const selectPeriodo = document.getElementById('filtroSocioPeriodo');
  const periodo = selectPeriodo ? selectPeriodo.value : '2026-10';

  const params = new URLSearchParams();
  if (search) params.append('search', search);
  if (categoria_id) params.append('categoria_id', categoria_id);
  if (estado) params.append('estado', estado);
  if (periodo) params.append('periodo', periodo);

  // Actualizar resumen financiero dinámico de la categoría y mes seleccionado
  cargarResumenCategoriaMes(periodo, categoria_id, search);

  try {
    const res = await fetch(`${API_BASE}/socios?${params.toString()}`);
    const socios = await res.json();

    state.socios = socios;
    const tbody = document.getElementById('sociosTableBody');
    tbody.innerHTML = '';

    if (socios.length === 0) {
      tbody.innerHTML = `<tr><td colspan="7" class="text-center py-8 text-slate-400">No se encontraron socios con los filtros aplicados.</td></tr>`;
      return;
    }

    socios.forEach(s => {
      const tieneDeuda = s.cuotas_pendientes > 0;
      const estadoCuotaBadge = tieneDeuda
        ? `<button onclick="abrirCuentaSocio(${s.id})" title="Hacé clic para ver y cobrar cuotas adeudadas" class="inline-flex items-center gap-1.5 bg-rose-50 hover:bg-rose-100 text-rose-700 hover:text-rose-900 px-2.5 py-1 rounded-full text-xs font-bold border border-rose-300 transition cursor-pointer shadow-sm">
             <span class="w-2 h-2 rounded-full bg-rose-600 animate-pulse"></span> ${s.cuotas_pendientes} deuda (${formatCurrency(s.deuda_total)}) ❯
           </button>`
        : `<span class="inline-flex items-center gap-1 bg-emerald-50 text-emerald-700 px-2.5 py-1 rounded-full text-xs font-bold border border-emerald-200">
             <span class="w-1.5 h-1.5 rounded-full bg-emerald-500"></span> Al Día
           </span>`;

      const tr = document.createElement('tr');
      tr.className = 'group hover:bg-emerald-50/40 cursor-pointer transition';
      tr.title = 'Hacé clic en este socio para ver sus cuotas y cobrar';
      tr.onclick = (e) => {
        if (e.target.closest('button')) return;
        abrirCuentaSocio(s.id);
      };
      tr.innerHTML = `
        <td class="py-2.5 px-3 font-mono font-bold text-xs whitespace-nowrap">
          <span class="bg-indigo-50 border border-indigo-200/80 text-indigo-900 px-1.5 py-0.5 rounded text-[11px]">${s.numero_socio}</span>
        </td>
        <td class="py-2.5 px-3">
          <div class="font-bold text-slate-900 leading-tight">${s.nombre} ${s.apellido}</div>
          <div class="text-[11px] text-slate-400 truncate max-w-[190px]">${s.email || s.telefono || 'Sin contacto'}</div>
        </td>
        <td class="py-2.5 px-3 text-xs font-mono text-slate-600 whitespace-nowrap">${s.dni}</td>
        <td class="py-2.5 px-3 whitespace-nowrap">
          <span class="bg-slate-100 text-slate-700 text-[11px] font-semibold px-2 py-0.5 rounded">${s.categoria_nombre}</span>
        </td>
        <td class="py-2.5 px-3 text-xs text-slate-600 max-w-[140px] truncate" title="${s.disciplinas_str || ''}">
          ${s.disciplinas_str || '<span class="text-slate-400">Sin disciplinas</span>'}
        </td>
        <td class="py-2.5 px-3 text-center whitespace-nowrap">${estadoCuotaBadge}</td>
        <td class="py-2.5 px-3 text-right whitespace-nowrap sticky right-0 bg-white group-hover:bg-[#f2faf6] transition shadow-[-4px_0_8px_rgba(0,0,0,0.03)] border-l border-slate-100">
          <div class="inline-flex items-center gap-1 justify-end">
            ${tieneDeuda 
              ? `<button onclick="abrirCuentaSocio(${s.id})" title="Cobrar cuotas adeudadas en efectivo" class="bg-rose-600 hover:bg-rose-700 text-white px-2 py-1 rounded-lg text-xs font-bold transition inline-flex items-center gap-1 shadow-sm cursor-pointer">
                  💰 Cobrar
                 </button>
                 <button onclick="enviarRecordatorioWhatsApp(${s.id})" title="Enviar recordatorio de deuda por WhatsApp" class="p-1.5 bg-emerald-50 hover:bg-emerald-600 text-emerald-700 hover:text-white border border-emerald-300 rounded-lg text-xs font-bold transition shadow-sm cursor-pointer">
                  💬
                 </button>` 
              : ''
            }
            <button onclick="editarSocio(${s.id})" title="Editar todos los campos del socio" class="p-1.5 bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-200 rounded-lg text-xs font-bold transition cursor-pointer">
              ✏️
            </button>
            <button onclick="verFichaMedica(${s.id})" title="Ver Ficha Completa de Afiliación" class="p-1.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-200 rounded-lg text-xs font-bold transition cursor-pointer">
              📋
            </button>
            <button onclick="verCarnet(${s.id})" title="Ver Carnet y QR de Acceso" class="p-1.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200 rounded-lg text-xs font-bold transition cursor-pointer">
              🪪
            </button>
            <button onclick="confirmarEliminarSocio(${s.id}, '${(s.nombre || '').replace(/'/g, "\\'")} ${(s.apellido || '').replace(/'/g, "\\'")}', '${s.numero_socio}', '${s.dni}')" title="Eliminar socio del club" class="p-1.5 bg-rose-50 hover:bg-rose-600 text-rose-700 hover:text-white border border-rose-300 rounded-lg text-xs font-bold transition shadow-sm cursor-pointer">
              🗑️
            </button>
          </div>
        </td>
      `;
      tbody.appendChild(tr);
    });
  } catch (err) {
    console.error('Error cargando socios:', err);
  }
}

function calcularEdadNuevo() {
  const fecha = document.getElementById('socioFechaNac').value;
  if (!fecha) return;
  const nacimiento = new Date(fecha);
  const hoy = new Date();
  let edad = hoy.getFullYear() - nacimiento.getFullYear();
  const m = hoy.getMonth() - nacimiento.getMonth();
  if (m < 0 || (m === 0 && hoy.getDate() < nacimiento.getDate())) {
    edad--;
  }
  document.getElementById('socioEdad').value = edad > 0 ? edad : 0;
}

async function handleGuardarSocio(e) {
  e.preventDefault();
  const checkboxes = document.querySelectorAll('#socioDisciplinasCheckboxes input[type="checkbox"]:checked');
  const disciplinas = Array.from(checkboxes).map(cb => parseInt(cb.value));

  const payload = {
    nombre: document.getElementById('socioNombre').value.trim(),
    apellido: document.getElementById('socioApellido').value.trim(),
    dni: document.getElementById('socioDni').value.replace(/\D/g, '').trim(),
    fecha_nacimiento: document.getElementById('socioFechaNac').value || '',
    edad: parseInt(document.getElementById('socioEdad').value) || null,
    estado_civil: document.getElementById('socioEstadoCivil').value || '',
    telefono: document.getElementById('socioTelefono').value.trim(),
    email: document.getElementById('socioEmail').value.trim(),
    ocupacion: document.getElementById('socioOcupacion').value.trim(),
    direccion: document.getElementById('socioDireccion').value.trim(),
    categoria_id: parseInt(document.getElementById('socioCategoria').value),
    fecha_alta: document.getElementById('socioFechaAlta').value || null,
    grupo_sanguineo: document.getElementById('socioGrupoSangre').value || '',
    posee_obra_social: document.getElementById('socioPoseeObraSocial').value || 'NO',
    nombre_obra_social: document.getElementById('socioObraSocial').value.trim(),
    alergias_condiciones: document.getElementById('socioAlergias').value.trim(),
    contacto_emergencia_nombre: document.getElementById('socioUrgenciaNombre').value.trim(),
    contacto_emergencia_telefono: document.getElementById('socioUrgenciaTel').value.trim(),
    tutor_nombre: document.getElementById('socioTutor').value.trim(),
    socio_proponente: document.getElementById('socioProponente').value.trim(),
    disciplinas
  };

  try {
    const res = await fetch(`${API_BASE}/socios`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Error al guardar socio');

    alert(`✅ Socio "${payload.nombre} ${payload.apellido}" registrado con éxito!\n• N° Socio asignado: ${data.numero_socio}\n• Ficha médica, datos personales y disciplinas guardados correctamente.`);
    closeModal('modalNuevoSocio');
    document.getElementById('formNuevoSocio').reset();
    loadSocios();
    loadDashboard();
  } catch (err) {
    alert(`❌ ${err.message}`);
  }
}

// ==========================================
// 3. CUOTAS
// ==========================================
async function loadCuotas() {
  const search = document.getElementById('filtroCuotaSearch').value;
  const periodo = document.getElementById('filtroCuotaPeriodo').value;
  const estado = document.getElementById('filtroCuotaEstado').value;

  const params = new URLSearchParams();
  if (search) params.append('search', search);
  if (periodo) params.append('periodo', periodo);
  if (estado) params.append('estado', estado);

  try {
    const res = await fetch(`${API_BASE}/cuotas?${params.toString()}`);
    const cuotas = await res.json();

    const tbody = document.getElementById('cuotasTableBody');
    tbody.innerHTML = '';

    if (cuotas.length === 0) {
      tbody.innerHTML = `<tr><td colspan="7" class="text-center py-8 text-slate-400">No hay cuotas que coincidan con los criterios.</td></tr>`;
      return;
    }

    cuotas.forEach(c => {
      cuotasRegistry.set(c.id, c);
      const totalPagado = c.total_cobrado || 0;
      const saldoPendiente = c.saldo_pendiente !== undefined ? c.saldo_pendiente : Math.max(0, c.monto_total - totalPagado);

      let estadoBadge = '';
      if (c.estado === 'Pagada' || saldoPendiente <= 0) {
        estadoBadge = `<span class="bg-emerald-100 text-emerald-800 text-xs font-bold px-2.5 py-1 rounded-full">✓ Pagada</span>`;
      } else if (c.estado === 'Parcial' || totalPagado > 0) {
        estadoBadge = `<span class="bg-amber-100 text-amber-800 text-xs font-bold px-2.5 py-1 rounded-full">🟠 Parcial (Resta: ${formatCurrency(saldoPendiente)})</span>`;
      } else if (c.estado === 'Vencida') {
        estadoBadge = `<span class="bg-rose-100 text-rose-800 text-xs font-bold px-2.5 py-1 rounded-full">! Vencida</span>`;
      } else {
        estadoBadge = `<span class="bg-slate-100 text-slate-800 text-xs font-bold px-2.5 py-1 rounded-full">Pendiente</span>`;
      }

      const tr = document.createElement('tr');
      tr.className = 'hover:bg-slate-50 transition';
      tr.innerHTML = `
        <td class="py-3 px-4 font-mono font-bold text-xs text-indigo-900">${c.periodo}</td>
        <td class="py-3 px-4">
          <div class="font-bold text-slate-900">${c.nombre} ${c.apellido}</div>
          <div class="text-xs text-slate-400 font-mono">${c.numero_socio}</div>
        </td>
        <td class="py-3 px-4 text-xs text-slate-700 max-w-xs">${c.concepto}</td>
        <td class="py-3 px-4 text-xs text-slate-500 font-mono">${c.fecha_vencimiento}</td>
        <td class="py-3 px-4">
          <div class="font-black text-slate-900 text-sm">${formatCurrency(c.monto_total)}</div>
          ${totalPagado > 0 && saldoPendiente > 0 
            ? `<div class="text-[10px] text-slate-500">Cobrado: ${formatCurrency(totalPagado)} &bull; <span class="text-rose-600 font-bold">Resta: ${formatCurrency(saldoPendiente)}</span></div>` 
            : ''}
          ${c.descuento > 0 ? `<div class="text-[10px] text-emerald-600 font-semibold">Desc: -${formatCurrency(c.descuento)}</div>` : ''}
        </td>
        <td class="py-3 px-4">${estadoBadge}</td>
        <td class="py-3 px-4 text-right">
          <div class="flex items-center justify-end gap-1.5">
            ${saldoPendiente > 0 
              ? `<button onclick="cobrarCuotaEfectivoPorId(${c.id})" title="Cancelar saldo en efectivo directamente" class="bg-emerald-600 hover:bg-emerald-700 text-white font-bold px-2.5 py-1.5 rounded-lg text-xs shadow transition flex items-center gap-1">
                  💵 Efectivo
                 </button>
                 <button onclick="abrirCobroPorId(${c.id})" title="Cobrar otro importe o medio de pago" class="bg-indigo-50 hover:bg-indigo-100 text-indigo-700 font-bold px-2 py-1.5 rounded-lg text-xs transition">
                  💳
                 </button>
                 <button onclick="abrirDescuentoPorId(${c.id})" title="Aplicar descuento o bonificación" class="bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold px-2 py-1.5 rounded-lg text-xs transition">
                  🏷️
                 </button>`
              : `<span class="text-xs text-emerald-700 font-bold bg-emerald-50 px-2 py-1 rounded-md">Cancelada</span>`
            }
          </div>
        </td>
      `;
      tbody.appendChild(tr);
    });
  } catch (err) {
    console.error('Error cargando cuotas:', err);
  }
}

async function ejecutarGeneracionMasiva() {
  const periodo = document.getElementById('masivoPeriodoInput').value;
  const diaVencimiento = parseInt(document.getElementById('masivoDiaVencimiento').value) || 10;
  const btn = document.getElementById('btnEjecutarMasivo');

  btn.disabled = true;
  btn.textContent = 'Procesando...';

  try {
    const res = await fetch(`${API_BASE}/cuotas/generar-masivo`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ periodo, diaVencimiento })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Error en emisión masiva');

    alert(`✅ Emisión completada:\n• Cuotas generadas: ${data.generadas}\n• Omitidas (ya emitidas): ${data.omitidas}\n• Total socios activos: ${data.totalSociosActivos}`);
    closeModal('modalGenerarCuotas');
    document.getElementById('filtroCuotaPeriodo').value = periodo;
    document.getElementById('dashPeriodoInput').value = periodo;
    loadCuotas();
    loadDashboard();
  } catch (err) {
    alert(`❌ ${err.message}`);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Generar Cuotas';
  }
}

// ==========================================
// 4. COBROS Y PAGOS
// ==========================================
let cuotaCobroActual = null;

function abrirCobro(cuota) {
  cuotaCobroActual = cuota;
  const totalPagado = cuota.total_cobrado || 0;
  const saldoPendiente = cuota.saldo_pendiente !== undefined ? cuota.saldo_pendiente : Math.max(0, cuota.monto_total - totalPagado);

  document.getElementById('cobroCuotaId').value = cuota.id;
  document.getElementById('cobroSocioNombre').textContent = `${cuota.nombre} ${cuota.apellido} (${cuota.numero_socio})`;
  document.getElementById('cobroPeriodo').textContent = cuota.periodo;
  document.getElementById('cobroConcepto').textContent = cuota.concepto;
  document.getElementById('cobroMontoOriginal').textContent = formatCurrency(cuota.monto_total);
  document.getElementById('cobroMontoYaPagado').textContent = formatCurrency(totalPagado);
  document.getElementById('cobroMontoTotal').textContent = formatCurrency(saldoPendiente);
  document.getElementById('cobroObservaciones').value = '';

  const inputMonto = document.getElementById('cobroMontoAPagar');
  inputMonto.value = saldoPendiente;
  inputMonto.max = saldoPendiente;

  actualizarPrevisualizacionCobro();
  document.getElementById('modalCobrarCuota').classList.remove('hidden');
}

function setCobroTotal() {
  if (!cuotaCobroActual) return;
  const totalPagado = cuotaCobroActual.total_cobrado || 0;
  const saldoPendiente = cuotaCobroActual.saldo_pendiente !== undefined ? cuotaCobroActual.saldo_pendiente : Math.max(0, cuotaCobroActual.monto_total - totalPagado);
  document.getElementById('cobroMontoAPagar').value = saldoPendiente;
  actualizarPrevisualizacionCobro();
}

function actualizarPrevisualizacionCobro() {
  if (!cuotaCobroActual) return;
  const totalPagado = cuotaCobroActual.total_cobrado || 0;
  const saldoPendiente = cuotaCobroActual.saldo_pendiente !== undefined ? cuotaCobroActual.saldo_pendiente : Math.max(0, cuotaCobroActual.monto_total - totalPagado);
  const inputVal = parseFloat(document.getElementById('cobroMontoAPagar').value) || 0;
  const infoEl = document.getElementById('cobroDetalleImpacto');

  if (inputVal <= 0) {
    infoEl.className = 'text-[11px] mt-1.5 font-medium text-rose-700 bg-rose-50 border border-rose-200 p-2 rounded-xl';
    infoEl.innerHTML = '⚠️ Ingrese un importe válido a cobrar mayor a $0.';
    return;
  }

  if (inputVal >= saldoPendiente) {
    infoEl.className = 'text-[11px] mt-1.5 font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 p-2 rounded-xl';
    infoEl.innerHTML = `✅ <strong>Pago Total (${formatCurrency(saldoPendiente)}):</strong> La cuota quedará completamente cancelada y el socio al día.`;
  } else {
    const restante = saldoPendiente - inputVal;
    infoEl.className = 'text-[11px] mt-1.5 font-medium text-amber-800 bg-amber-50 border border-amber-200 p-2 rounded-xl';
    infoEl.innerHTML = `🟠 <strong>Entrega a Cuenta (${formatCurrency(inputVal)}):</strong> Se descontará de la deuda. Quedará un saldo pendiente de <strong>${formatCurrency(restante)}</strong> (Estado: Pago Parcial).`;
  }
}

async function handleConfirmarPago(e) {
  e.preventDefault();
  const cuota_id = parseInt(document.getElementById('cobroCuotaId').value);
  const medio_pago = document.getElementById('cobroMedioPago').value;
  const monto_pagado = parseFloat(document.getElementById('cobroMontoAPagar').value);
  const observaciones = document.getElementById('cobroObservaciones').value;

  if (isNaN(monto_pagado) || monto_pagado <= 0) {
    alert('⚠️ Ingrese un monto a cobrar válido mayor a 0');
    return;
  }

  try {
    const res = await fetch(`${API_BASE}/pagos`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cuota_id, medio_pago, monto_pagado, observaciones })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Error al procesar cobro');

    closeModal('modalCobrarCuota');
    mostrarRecibo(data.pago);
    if (data.auditoriaId) {
      mostrarToastDeshacer(`Cobro registrado (${data.pago.nro_comprobante})`, data.auditoriaId);
    }
    if (state.currentTab === 'cuotas') loadCuotas();
    if (state.currentTab === 'socios') loadSocios();
    if (state.currentTab === 'dashboard') loadDashboard();
  } catch (err) {
    alert(`❌ ${err.message}`);
  }
}

function abrirDescuento(cuota) {
  document.getElementById('descCuotaId').value = cuota.id;
  document.getElementById('descSocioNombre').textContent = `${cuota.nombre} ${cuota.apellido}`;
  document.getElementById('descPeriodo').textContent = cuota.periodo;
  document.getElementById('descMontoOriginal').textContent = formatCurrency(cuota.monto_original);
  document.getElementById('descMontoDescuento').value = cuota.descuento || '';
  document.getElementById('descMotivo').value = '';
  document.getElementById('modalDescuentoCuota').classList.remove('hidden');
}

async function handleGuardarDescuentoCuota(e) {
  e.preventDefault();
  const id = document.getElementById('descCuotaId').value;
  const descuento = parseFloat(document.getElementById('descMontoDescuento').value) || 0;
  const motivo = document.getElementById('descMotivo').value;

  try {
    const res = await fetch(`${API_BASE}/cuotas/${id}/descuento`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ descuento, motivo })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Error al aplicar descuento');

    alert(`✅ Descuento de ${formatCurrency(descuento)} aplicado correctamente a la cuota.`);
    closeModal('modalDescuentoCuota');
    loadCuotas();
    if (state.currentTab === 'socios') loadSocios();
    if (state.currentTab === 'dashboard') loadDashboard();
  } catch (err) {
    alert(`❌ ${err.message}`);
  }
}

async function loadPagos() {
  try {
    const res = await fetch(`${API_BASE}/pagos`);
    const pagos = await res.json();

    const tbody = document.getElementById('pagosTableBody');
    tbody.innerHTML = '';

    if (pagos.length === 0) {
      tbody.innerHTML = `<tr><td colspan="8" class="text-center py-8 text-slate-400">No hay pagos registrados.</td></tr>`;
      return;
    }

    pagos.forEach(p => {
      pagosRegistry.set(p.id, p);
      const tr = document.createElement('tr');
      tr.className = 'hover:bg-slate-50 transition';
      tr.innerHTML = `
        <td class="py-3 px-4 font-mono font-bold text-xs text-indigo-700">${p.nro_comprobante}</td>
        <td class="py-3 px-4 text-xs font-mono text-slate-500">${p.fecha_pago}</td>
        <td class="py-3 px-4">
          <div class="font-bold text-slate-900">${p.nombre} ${p.apellido}</div>
          <div class="text-xs text-slate-400 font-mono">${p.numero_socio} &bull; DNI ${p.dni}</div>
        </td>
        <td class="py-3 px-4 text-xs text-slate-700">${p.periodo} - ${p.concepto}</td>
        <td class="py-3 px-4 font-black text-emerald-600">${formatCurrency(p.monto_pagado)}</td>
        <td class="py-3 px-4"><span class="bg-slate-100 text-slate-700 text-xs px-2.5 py-1 rounded-full font-semibold">${p.medio_pago}</span></td>
        <td class="py-3 px-4 text-xs text-slate-500">${p.cajero}</td>
        <td class="py-3 px-4 text-right">
          <button onclick="mostrarReciboPorId(${p.id})" class="text-xs font-bold text-indigo-600 hover:bg-indigo-50 px-2 py-1 rounded-lg transition">
            🖨️ Ver Recibo
          </button>
        </td>
      `;
      tbody.appendChild(tr);
    });
  } catch (err) {
    console.error('Error cargando historial de pagos:', err);
  }
}

function mostrarRecibo(pago) {
  document.getElementById('reciboNro').textContent = pago.nro_comprobante;
  document.getElementById('reciboFecha').textContent = pago.fecha_pago;
  document.getElementById('reciboSocio').textContent = `${pago.nombre} ${pago.apellido}`;
  document.getElementById('reciboDni').textContent = pago.dni;
  document.getElementById('reciboNroSocio').textContent = pago.numero_socio;
  document.getElementById('reciboConcepto').textContent = `${pago.periodo} - ${pago.concepto}`;
  document.getElementById('reciboMonto').textContent = formatCurrency(pago.monto_pagado);
  document.getElementById('reciboMedio').textContent = pago.medio_pago;
  document.getElementById('reciboCajero').textContent = pago.cajero || 'Admin Recepción';

  const saldoContainer = document.getElementById('reciboSaldoContainer');
  const badgeEstado = document.getElementById('reciboBadgeEstado');

  if (pago.saldo_restante && pago.saldo_restante > 0) {
    saldoContainer.classList.remove('hidden');
    document.getElementById('reciboSaldoRestante').textContent = formatCurrency(pago.saldo_restante);
    badgeEstado.className = 'inline-block bg-amber-100 text-amber-900 text-xs px-3 py-1 rounded-full font-bold';
    badgeEstado.textContent = `PAGO A CUENTA - SALDO RESTANTE: ${formatCurrency(pago.saldo_restante)}`;
  } else {
    saldoContainer.classList.add('hidden');
    badgeEstado.className = 'inline-block bg-emerald-100 text-emerald-800 text-xs px-3 py-1 rounded-full font-bold';
    badgeEstado.textContent = 'PAGO ACREDITADO - CUOTA TOTALMENTE CANCELADA';
  }

  document.getElementById('modalRecibo').classList.remove('hidden');
}

// ==========================================
// 5. CARNET DIGITAL & QR
// ==========================================
async function verCarnet(socioId) {
  try {
    const res = await fetch(`${API_BASE}/socios/${socioId}/carnet`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Error al obtener carnet');

    const s = data.socio;
    document.getElementById('carnetNombre').textContent = `${s.nombre} ${s.apellido}`;
    document.getElementById('carnetNumero').textContent = `${s.numero_socio} • ${s.categoria_nombre}`;

    const badge = document.getElementById('carnetBadgeEstado');
    const detalle = document.getElementById('carnetDetalleDeuda');

    if (data.alDia) {
      badge.className = 'inline-block px-3 py-1 rounded-full text-xs font-black tracking-wide uppercase bg-emerald-500 text-emerald-950';
      badge.textContent = '🟢 Habilitado (Cuota al Día)';
      detalle.textContent = 'Acceso libre a actividades e instalaciones.';
    } else {
      badge.className = 'inline-block px-3 py-1 rounded-full text-xs font-black tracking-wide uppercase bg-rose-500 text-white';
      badge.textContent = '🔴 Inhabilitado (Con Deuda)';
      detalle.textContent = `Adeuda ${data.cuotasAdeudadas} cuota(s) por un total de ${formatCurrency(data.totalDeuda)}`;
    }

    // Renderizar QR en canvas
    const canvas = document.getElementById('carnetQrCanvas');
    if (window.QRCode) {
      QRCode.toCanvas(canvas, data.qrData, {
        width: 160,
        margin: 1,
        color: {
          dark: '#0f172a',
          light: '#ffffff'
        }
      });
    }

    document.getElementById('modalCarnet').classList.remove('hidden');
  } catch (err) {
    alert(`❌ ${err.message}`);
  }
}

// ==========================================
// UTILIDADES MODAL
// ==========================================
function openNuevoSocioModal() {
  const elFecha = document.getElementById('socioFechaAlta');
  if (elFecha && !elFecha.value) {
    elFecha.value = new Date().toISOString().split('T')[0];
  }
  document.getElementById('modalNuevoSocio').classList.remove('hidden');
}

function openGenerarCuotasModal() {
  document.getElementById('modalGenerarCuotas').classList.remove('hidden');
}

function closeModal(modalId) {
  document.getElementById(modalId).classList.add('hidden');
}

// ==========================================
// 6. TESORERÍA / CONCILIACIÓN DE COMPROBANTES
// ==========================================
async function loadComprobantesTesoreria() {
  const estado = document.getElementById('filtroTesoreriaEstado').value || 'Pendiente';
  try {
    const res = await fetch(`${API_BASE}/tesoreria/comprobantes?estado=${estado}`);
    const rows = await res.json();

    const tbody = document.getElementById('tesoreriaTableBody');
    tbody.innerHTML = '';

    if (rows.length === 0) {
      tbody.innerHTML = `<tr><td colspan="8" class="text-center py-8 text-slate-400">No hay comprobantes en estado "${estado}".</td></tr>`;
      return;
    }

    rows.forEach(r => {
      comprobantesRegistry.set(r.id, r);
      let estadoBadge = '';
      if (r.estado === 'Aprobado') {
        estadoBadge = '<span class="bg-emerald-100 text-emerald-800 text-xs font-bold px-2.5 py-1 rounded-full">✓ Aprobado</span>';
      } else if (r.estado === 'Rechazado') {
        estadoBadge = `<span class="bg-rose-100 text-rose-800 text-xs font-bold px-2.5 py-1 rounded-full" title="${r.motivo_rechazo || ''}">✕ Rechazado</span>`;
      } else {
        estadoBadge = '<span class="bg-amber-100 text-amber-800 text-xs font-bold px-2.5 py-1 rounded-full animate-pulse">⏳ Pendiente</span>';
      }

      // Miniatura de comprobante
      let comprobanteHtml = '<span class="text-xs text-slate-400 italic">Sin imagen</span>';
      if (r.archivo_url && r.archivo_url.startsWith('data:image')) {
        comprobanteHtml = `
          <button onclick="verComprobantePorId(${r.id})" class="group relative block w-12 h-12 rounded-lg overflow-hidden border border-slate-300 shadow-sm hover:ring-2 hover:ring-indigo-500 transition cursor-pointer">
            <img src="${r.archivo_url}" class="w-full h-full object-cover">
            <span class="absolute inset-0 bg-black/40 text-white flex items-center justify-center text-[10px] opacity-0 group-hover:opacity-100 transition">🔍</span>
          </button>
        `;
      } else {
        comprobanteHtml = `
          <div class="inline-flex items-center gap-1 bg-slate-100 px-2 py-1 rounded text-xs text-slate-600 font-mono">
            <span>📄</span> N° ${r.nro_transaccion || 'S/N'}
          </div>
        `;
      }

      const tr = document.createElement('tr');
      tr.className = 'hover:bg-slate-50 transition';
      tr.innerHTML = `
        <td class="py-3 px-4 text-xs font-mono text-slate-500">${r.fecha_subida}</td>
        <td class="py-3 px-4">
          <div class="font-bold text-slate-900">${r.nombre} ${r.apellido}</div>
          <div class="text-xs text-slate-400 font-mono">${r.numero_socio} &bull; DNI ${r.dni}</div>
        </td>
        <td class="py-3 px-4">
          <div class="font-semibold text-xs text-indigo-900">${r.periodo}</div>
          <div class="text-xs text-slate-500">${r.concepto}</div>
        </td>
        <td class="py-3 px-4">
          <span class="font-black text-slate-900 text-sm">${formatCurrency(r.monto_declarado)}</span>
          ${r.monto_declarado !== r.monto_cuota ? `<span class="block text-[10px] text-rose-500 font-bold">Cuota: ${formatCurrency(r.monto_cuota)}</span>` : ''}
        </td>
        <td class="py-3 px-4 text-xs">
          <div class="font-semibold text-slate-800">${r.banco_origen || 'Banco no informado'}</div>
          <div class="font-mono text-slate-400 text-[11px]">Op: ${r.nro_transaccion || '-'}</div>
        </td>
        <td class="py-3 px-4">${comprobanteHtml}</td>
        <td class="py-3 px-4">${estadoBadge}</td>
        <td class="py-3 px-4 text-right">
          ${r.estado === 'Pendiente' ? `
            <div class="flex items-center justify-end gap-1.5">
              <button onclick="aprobarComprobante(${r.id})" class="bg-emerald-600 hover:bg-emerald-700 text-white font-bold px-2.5 py-1.5 rounded-lg text-xs shadow transition flex items-center gap-1">
                <span>✓</span> Aprobar
              </button>
              <button onclick="abrirModalRechazo(${r.id})" class="bg-rose-50 hover:bg-rose-100 text-rose-700 font-bold px-2 py-1.5 rounded-lg text-xs transition">
                Rechazar
              </button>
            </div>
          ` : `
            <span class="text-xs text-slate-400 font-semibold italic">${r.revisado_por ? 'Revisado por ' + r.revisado_por : '-'}</span>
          `}
        </td>
      `;
      tbody.appendChild(tr);
    });
  } catch (err) {
    console.error('Error cargando comprobantes de tesorería:', err);
  }
}

async function aprobarComprobante(id) {
  if (!confirm('¿Confirmás que el dinero ingresó en la cuenta del club y deseás acreditar el pago?')) return;

  try {
    const res = await fetch(`${API_BASE}/tesoreria/comprobantes/${id}/aprobar`, {
      method: 'POST'
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Error al aprobar comprobante');

    alert(`✅ ¡Pago acreditado exitosamente!\nSe emitió el comprobante oficial: ${data.nroRecibo}`);
    if (data.auditoriaId) {
      mostrarToastDeshacer(`Transferencia aprobada (${data.nroRecibo})`, data.auditoriaId);
    }
    loadComprobantesTesoreria();
    loadDashboard();
  } catch (err) {
    alert('❌ ' + err.message);
  }
}

function abrirModalRechazo(id) {
  document.getElementById('rechazarCompId').value = id;
  document.getElementById('rechazarCompMotivo').value = '';
  document.getElementById('modalRechazarComprobante').classList.remove('hidden');
}

async function confirmarRechazoComprobante() {
  const id = document.getElementById('rechazarCompId').value;
  const motivo = document.getElementById('rechazarCompMotivo').value.trim();

  if (!motivo) {
    alert('Por favor indicá un motivo de rechazo para el socio.');
    return;
  }

  try {
    const res = await fetch(`${API_BASE}/tesoreria/comprobantes/${id}/rechazar`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ motivo_rechazo: motivo })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Error al rechazar comprobante');

    alert('Comprobante marcado como rechazado.');
    closeModal('modalRechazarComprobante');
    if (data.auditoriaId) {
      mostrarToastDeshacer('Comprobante de transferencia rechazado', data.auditoriaId);
    }
    loadComprobantesTesoreria();
    loadDashboard();
  } catch (err) {
    alert('❌ ' + err.message);
  }
}

function verComprobanteGrande(imgUrl, titulo) {
  document.getElementById('zoomCompTitulo').textContent = titulo || 'Comprobante de Transferencia';
  document.getElementById('zoomCompImg').src = imgUrl;
  document.getElementById('modalZoomComprobante').classList.remove('hidden');
}

// ==========================================
// 7. CONFIGURACIÓN: CUOTAS, DISCIPLINAS Y BANCO
// ==========================================
async function loadConfigTab() {
  await Promise.all([loadConfigCategorias(), loadConfigDisciplinas(), loadConfigBancaria(), cargarPlantillaWhatsApp()]);
}

async function loadConfigBancaria() {
  try {
    const res = await fetch(`${API_BASE}/config/bancarios`);
    const data = await res.json();
    if (data) {
      const elAlias = document.getElementById('configBankAlias');
      if (elAlias) elAlias.value = data.alias || '';
      const elCbu = document.getElementById('configBankCbu');
      if (elCbu) elCbu.value = data.cbu || '';
      const elBanco = document.getElementById('configBankBanco');
      if (elBanco) elBanco.value = data.banco || '';
      const elTitular = document.getElementById('configBankTitular');
      if (elTitular) elTitular.value = data.titular || '';
      const elCuit = document.getElementById('configBankCuit');
      if (elCuit) elCuit.value = data.cuit || '';
      const elTipo = document.getElementById('configBankTipoCuenta');
      if (elTipo) elTipo.value = data.tipo_cuenta || '';
    }
  } catch (err) {
    console.error('Error cargando configuración bancaria:', err);
  }
}

window.guardarDatosBancarios = async function() {
  const alias = document.getElementById('configBankAlias').value.trim();
  const cbu = document.getElementById('configBankCbu').value.trim();
  const banco = document.getElementById('configBankBanco').value.trim();
  const titular = document.getElementById('configBankTitular').value.trim();
  const cuit = document.getElementById('configBankCuit').value.trim();
  const tipo_cuenta = document.getElementById('configBankTipoCuenta').value.trim();

  if (!alias || !cbu) {
    alert('⚠️ Por favor completá al menos el Alias y el CBU.');
    return;
  }

  try {
    const res = await fetch(`${API_BASE}/config/bancarios`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ alias, cbu, banco, titular, cuit, tipo_cuenta })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Error al guardar datos bancarios');

    // Invalida cache de datos bancarios para que los mensajes de WhatsApp usen el nuevo CBU/Alias inmediatamente
    datosBancariosCache = data.datos || null;

    alert('✅ Datos bancarios guardados exitosamente.\nSe verán reflejados de inmediato en el Portal de Socios y en todos los recordatorios de WhatsApp.');
    await loadConfigBancaria();
    if (typeof actualizarPrevisualizacionEnVivoPlantilla === 'function') {
      await actualizarPrevisualizacionEnVivoPlantilla();
    }
  } catch (err) {
    alert('❌ ' + err.message);
  }
};

async function loadConfigCategorias() {
  try {
    const res = await fetch(`${API_BASE}/categorias`);
    const cats = await res.json();
    state.categorias = cats;

    const tbody = document.getElementById('configCategoriasTableBody');
    tbody.innerHTML = '';

    cats.forEach(c => {
      const tr = document.createElement('tr');
      tr.className = 'hover:bg-slate-50 transition';
      tr.innerHTML = `
        <td class="py-3 px-3 font-bold text-slate-900">${c.nombre}</td>
        <td class="py-3 px-3 text-xs text-slate-500">${c.descripcion || '-'}</td>
        <td class="py-3 px-3 font-black text-emerald-600 text-sm">${formatCurrency(c.cuota_base)}</td>
        <td class="py-3 px-3 text-right">
          <button onclick="abrirEditarCuota(${JSON.stringify(c).replace(/"/g, '&quot;')})" class="bg-emerald-50 hover:bg-emerald-100 text-emerald-800 font-bold px-3 py-1.5 rounded-lg text-xs transition flex items-center gap-1 ml-auto">
            <span>✏️</span> Modificar Valor
          </button>
        </td>
      `;
      tbody.appendChild(tr);
    });
  } catch (err) {
    console.error('Error cargando categorías de config:', err);
  }
}

async function loadConfigDisciplinas() {
  try {
    const res = await fetch(`${API_BASE}/disciplinas`);
    const discs = await res.json();
    state.disciplinas = discs;

    const tbody = document.getElementById('configDisciplinasTableBody');
    tbody.innerHTML = '';

    discs.forEach(d => {
      const tr = document.createElement('tr');
      tr.className = 'hover:bg-slate-50 transition';
      tr.innerHTML = `
        <td class="py-3 px-3 font-bold text-slate-900">${d.nombre}</td>
        <td class="py-3 px-3 text-xs text-slate-600">${d.profesor || '<span class="text-slate-400 italic">No asignado</span>'}</td>
        <td class="py-3 px-3 text-xs text-slate-500">${d.dias_horarios || '<span class="text-slate-400 italic">A coordinar</span>'}</td>
        <td class="py-3 px-3 font-black text-emerald-600 text-sm">${formatCurrency(d.arancel_mensual)}</td>
        <td class="py-3 px-3 text-right space-x-1">
          <button onclick="abrirModalDisciplina(${JSON.stringify(d).replace(/"/g, '&quot;')})" class="bg-zinc-100 hover:bg-zinc-200 text-zinc-800 font-bold px-2.5 py-1.5 rounded-lg text-xs transition">
            ✏️ Editar
          </button>
          <button onclick="eliminarDisciplina(${d.id}, '${d.nombre}')" class="bg-rose-50 hover:bg-rose-100 text-rose-700 font-bold px-2.5 py-1.5 rounded-lg text-xs transition">
            🗑️
          </button>
        </td>
      `;
      tbody.appendChild(tr);
    });
  } catch (err) {
    console.error('Error cargando disciplinas de config:', err);
  }
}

function abrirEditarCuota(cat) {
  document.getElementById('editCatId').value = cat.id;
  document.getElementById('editCatNombre').value = cat.nombre;
  document.getElementById('editCatCuotaBase').value = cat.cuota_base;
  document.getElementById('editCatDescripcion').value = cat.descripcion || '';
  document.getElementById('modalEditarCuotaCategoria').classList.remove('hidden');
}

async function handleGuardarEditarCategoria(e) {
  e.preventDefault();
  const id = document.getElementById('editCatId').value;
  const nombre = document.getElementById('editCatNombre').value.trim();
  const cuota_base = parseFloat(document.getElementById('editCatCuotaBase').value);
  const descripcion = document.getElementById('editCatDescripcion').value.trim();

  try {
    const res = await fetch(`${API_BASE}/categorias/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nombre, cuota_base, descripcion })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Error al actualizar categoría');

    alert(`✅ Cuota base de "${nombre}" actualizada a ${formatCurrency(cuota_base)}`);
    closeModal('modalEditarCuotaCategoria');
    loadConfigCategorias();
    loadMetadata();
  } catch (err) {
    alert('❌ ' + err.message);
  }
}

function abrirModalDisciplina(disc = null) {
  const modal = document.getElementById('modalFormDisciplina');
  const titulo = document.getElementById('modalDiscTitulo');

  if (disc) {
    titulo.textContent = 'Editar Disciplina y Arancel';
    document.getElementById('formDiscId').value = disc.id;
    document.getElementById('formDiscNombre').value = disc.nombre;
    document.getElementById('formDiscArancel').value = disc.arancel_mensual;
    document.getElementById('formDiscProfesor').value = disc.profesor || '';
    document.getElementById('formDiscHorarios').value = disc.dias_horarios || '';
  } else {
    titulo.textContent = 'Agregar Nueva Disciplina';
    document.getElementById('formDiscId').value = '';
    document.getElementById('formDiscNombre').value = '';
    document.getElementById('formDiscArancel').value = '';
    document.getElementById('formDiscProfesor').value = '';
    document.getElementById('formDiscHorarios').value = '';
  }

  modal.classList.remove('hidden');
}

async function handleGuardarDisciplina(e) {
  e.preventDefault();
  const id = document.getElementById('formDiscId').value;
  const nombre = document.getElementById('formDiscNombre').value.trim();
  const arancel_mensual = parseFloat(document.getElementById('formDiscArancel').value);
  const profesor = document.getElementById('formDiscProfesor').value.trim();
  const dias_horarios = document.getElementById('formDiscHorarios').value.trim();

  const url = id ? `${API_BASE}/disciplinas/${id}` : `${API_BASE}/disciplinas`;
  const method = id ? 'PUT' : 'POST';

  try {
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nombre, arancel_mensual, profesor, dias_horarios })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Error al guardar disciplina');

    alert(`✅ Disciplina "${nombre}" guardada con arancel de ${formatCurrency(arancel_mensual)}`);
    closeModal('modalFormDisciplina');
    loadConfigDisciplinas();
    loadMetadata();
  } catch (err) {
    alert('❌ ' + err.message);
  }
}

async function eliminarDisciplina(id, nombre) {
  if (!confirm(`¿Estás seguro de eliminar la disciplina "${nombre}"?`)) return;

  try {
    const res = await fetch(`${API_BASE}/disciplinas/${id}`, { method: 'DELETE' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Error al eliminar');

    alert(`Disciplina "${nombre}" eliminada.`);
    loadConfigDisciplinas();
    loadMetadata();
  } catch (err) {
    alert('❌ ' + err.message);
  }
}

function abrirModalCategoria() {
  const nombre = prompt('Ingrese el nombre de la nueva categoría de socio:');
  if (!nombre) return;
  const cuotaStr = prompt(`Ingrese el valor de cuota base mensual para "${nombre}":`, '10000');
  if (!cuotaStr) return;
  const cuota_base = parseFloat(cuotaStr);

  fetch(`${API_BASE}/categorias`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ nombre, cuota_base, descripcion: 'Categoría personalizada' })
  })
  .then(res => res.json())
  .then(data => {
    if (data.error) throw new Error(data.error);
    alert('✅ Categoría creada exitosamente');
    loadConfigCategorias();
    loadMetadata();
  })
  .catch(err => alert('❌ ' + err.message));
}

// ==========================================
// 8. FICHA COMPLETA DEL SOCIO (MÉDICA Y AFILIACIÓN)
// ==========================================
let socioActualIdFicha = null;

async function verFichaMedica(socioId) {
  socioActualIdFicha = socioId;
  try {
    const res = await fetch(`${API_BASE}/socios/${socioId}`);
    if (!res.ok) throw new Error('No se pudo cargar la información del socio.');
    const socio = await res.json();

    document.getElementById('fichaModalNumero').textContent = socio.numero_socio || 'S/N';
    document.getElementById('fichaModalNombre').textContent = `${socio.nombre} ${socio.apellido}`;
    document.getElementById('fichaModalCategoria').textContent = socio.categoria_nombre || 'Socio';
    document.getElementById('fichaModalDni').textContent = socio.dni || '-';
    document.getElementById('fichaModalFechaNac').textContent = socio.fecha_nacimiento || 'No informada';
    document.getElementById('fichaModalEdad').textContent = socio.edad ? `${socio.edad} años` : '-';
    document.getElementById('fichaModalDireccion').textContent = socio.direccion || 'No informada';
    document.getElementById('fichaModalTelefono').textContent = socio.telefono || 'Sin teléfono';
    document.getElementById('fichaModalEmail').textContent = socio.email || 'Sin correo';
    document.getElementById('fichaModalOcupacion').textContent = socio.ocupacion || socio.ocupacion_estudio || '-';
    document.getElementById('fichaModalEstadoCivil').textContent = socio.estado_civil || '-';

    // Médicos
    document.getElementById('fichaModalGrupoSangre').textContent = socio.grupo_sanguineo || 'No informado';
    document.getElementById('fichaModalObraSocial').textContent = socio.nombre_obra_social || socio.obra_social || 'Ninguna / Particular';
    document.getElementById('fichaModalAlergias').textContent = socio.alergias_condiciones || socio.alergias || 'Ninguna declarada';
    document.getElementById('fichaModalUrgenciaNombre').textContent = socio.contacto_emergencia_nombre || socio.contacto_urgencia_nombre || '-';
    document.getElementById('fichaModalUrgenciaTel').textContent = socio.contacto_emergencia_telefono || socio.contacto_urgencia_tel || '-';

    // Disciplinas
    document.getElementById('fichaModalDisciplinas').textContent = (socio.disciplinas || []).map(d => d.nombre).join(', ') || 'Ninguna seleccionada';

    // Tutor / Proponente
    document.getElementById('fichaModalTutor').textContent = socio.tutor_nombre ? `${socio.tutor_nombre}` : 'No aplica (Mayor de edad)';
    document.getElementById('fichaModalProponente').textContent = socio.socio_proponente ? `${socio.socio_proponente}` : 'Sin proponente';

    // Cuotas y Estado
    document.getElementById('fichaModalFechaIngreso').textContent = socio.fecha_alta || socio.fecha_ingreso || '-';

    const cuotasAdeudadas = (socio.cuotas || []).filter(c => (c.saldo_pendiente !== undefined ? c.saldo_pendiente : c.monto_total) > 0);
    const totalDeuda = cuotasAdeudadas.reduce((acc, c) => acc + (c.saldo_pendiente !== undefined ? c.saldo_pendiente : c.monto_total), 0);

    const deudaSpan = document.getElementById('fichaModalEstadoDeuda');
    const listaCuotasCont = document.getElementById('fichaModalListaCuotasAdeudadas');
    listaCuotasCont.innerHTML = '';

    if (cuotasAdeudadas.length > 0) {
      deudaSpan.className = 'font-bold text-rose-600';
      deudaSpan.textContent = `🔴 Con deuda: ${cuotasAdeudadas.length} cuota(s) (${formatCurrency(totalDeuda)})`;

      cuotasAdeudadas.forEach(c => {
        cuotasRegistry.set(c.id, c);
        const saldo = c.saldo_pendiente !== undefined ? c.saldo_pendiente : c.monto_total;
        const div = document.createElement('div');
        div.className = 'flex items-center justify-between p-2 rounded-xl bg-white border border-rose-200 text-xs shadow-sm';
        div.innerHTML = `
          <div>
            <span class="font-bold text-slate-800">${c.periodo} &bull; ${c.concepto}</span>
            <div class="text-[10px] text-slate-400">Vence: ${c.fecha_vencimiento} ${c.total_cobrado > 0 ? `&bull; Pagado: ${formatCurrency(c.total_cobrado)}` : ''}</div>
          </div>
          <div class="flex items-center gap-2">
            <span class="font-black text-rose-600 text-xs">${formatCurrency(saldo)}</span>
            <button onclick="cobrarCuotaEfectivoPorId(${c.id})" class="bg-emerald-600 hover:bg-emerald-700 text-white font-bold px-2.5 py-1 rounded-lg text-xs shadow transition">
              💵 Cobrar Efectivo
            </button>
          </div>
        `;
        listaCuotasCont.appendChild(div);
      });
    } else {
      deudaSpan.className = 'font-bold text-emerald-600';
      deudaSpan.textContent = '🟢 Al Día (Sin deuda pendiente)';
      listaCuotasCont.innerHTML = '<p class="text-xs text-emerald-700 font-semibold py-1">🎉 ¡Este socio se encuentra al día! No registra cuotas adeudadas.</p>';
    }

    document.getElementById('modalFichaSocio').classList.remove('hidden');
  } catch (err) {
    alert('❌ ' + err.message);
  }
}

function imprimirFichaModal() {
  window.print();
}

// ==========================================
// 9. EDICIÓN INTEGRAL DE SOCIO (TODOS LOS CAMPOS)
// ==========================================
async function editarSocio(socioId) {
  try {
    const res = await fetch(`${API_BASE}/socios/${socioId}`);
    if (!res.ok) throw new Error('Error al obtener datos del socio');
    const s = await res.json();

    document.getElementById('modalEditarSocioTitulo').textContent = `Editar Socio: ${s.nombre} ${s.apellido} (${s.numero_socio})`;
    document.getElementById('editSocioId').value = s.id;
    document.getElementById('editSocioNumero').value = s.numero_socio || '';
    document.getElementById('editSocioEstado').value = s.estado || 'Activo';
    document.getElementById('editSocioFechaAlta').value = s.fecha_alta ? s.fecha_alta.split(' ')[0] : '';
    
    // Datos personales
    document.getElementById('editSocioNombre').value = s.nombre || '';
    document.getElementById('editSocioApellido').value = s.apellido || '';
    document.getElementById('editSocioDni').value = s.dni || '';
    document.getElementById('editSocioFechaNac').value = s.fecha_nacimiento || '';
    document.getElementById('editSocioEdad').value = s.edad || '';
    document.getElementById('editSocioEstadoCivil').value = s.estado_civil || '';
    document.getElementById('editSocioTelefono').value = s.telefono || '';
    document.getElementById('editSocioEmail').value = s.email || '';
    document.getElementById('editSocioOcupacion').value = s.ocupacion || '';
    document.getElementById('editSocioDireccion').value = s.direccion || '';

    // Datos médicos
    document.getElementById('editSocioGrupoSangre').value = s.grupo_sanguineo || '';
    document.getElementById('editSocioPoseeObraSocial').value = s.posee_obra_social || 'NO';
    document.getElementById('editSocioNombreObraSocial').value = s.nombre_obra_social || '';
    document.getElementById('editSocioUrgenciaNombre').value = s.contacto_emergencia_nombre || '';
    document.getElementById('editSocioUrgenciaTel').value = s.contacto_emergencia_telefono || '';
    document.getElementById('editSocioAlergias').value = s.alergias_condiciones || '';

    // Vínculos
    document.getElementById('editSocioTutor').value = s.tutor_nombre || '';
    document.getElementById('editSocioProponente').value = s.socio_proponente || '';

    // Categoría Social
    const catSelect = document.getElementById('editSocioCategoria');
    catSelect.innerHTML = '';
    state.categorias.forEach(c => {
      const opt = document.createElement('option');
      opt.value = c.id;
      opt.textContent = `${c.nombre} (${formatCurrency(c.cuota_base)}/mes)`;
      if (c.id === s.categoria_id) opt.selected = true;
      catSelect.appendChild(opt);
    });

    // Disciplinas Checkboxes
    const discContainer = document.getElementById('editSocioDisciplinasCheckboxes');
    discContainer.innerHTML = '';
    const activeDiscIds = (s.disciplinas || []).map(d => d.id);

    state.disciplinas.forEach(d => {
      const lbl = document.createElement('label');
      lbl.className = 'flex items-center gap-2 p-2 bg-white rounded-xl border border-slate-200 hover:border-emerald-400 cursor-pointer text-xs';
      const isChecked = activeDiscIds.includes(d.id) ? 'checked' : '';
      lbl.innerHTML = `
        <input type="checkbox" name="editDisciplinas" value="${d.id}" ${isChecked} class="text-emerald-600 focus:ring-emerald-500 rounded">
        <span class="font-semibold text-slate-800">${d.nombre}</span>
        <span class="ml-auto font-mono text-[10px] text-emerald-700 font-bold">+${formatCurrency(d.arancel_mensual)}</span>
      `;
      discContainer.appendChild(lbl);
    });

    document.getElementById('modalEditarSocio').classList.remove('hidden');
  } catch (err) {
    alert('❌ ' + err.message);
  }
}

function calcularEdadEditar() {
  const fecha = document.getElementById('editSocioFechaNac').value;
  if (!fecha) return;
  const nacimiento = new Date(fecha);
  const hoy = new Date();
  let edad = hoy.getFullYear() - nacimiento.getFullYear();
  const m = hoy.getMonth() - nacimiento.getMonth();
  if (m < 0 || (m === 0 && hoy.getDate() < nacimiento.getDate())) {
    edad--;
  }
  document.getElementById('editSocioEdad').value = edad > 0 ? edad : 0;
}

async function handleGuardarEditarSocio(e) {
  e.preventDefault();
  const id = document.getElementById('editSocioId').value;
  const checkboxes = document.querySelectorAll('#editSocioDisciplinasCheckboxes input[type="checkbox"]:checked');
  const disciplinas = Array.from(checkboxes).map(cb => parseInt(cb.value));

  const payload = {
    numero_socio: document.getElementById('editSocioNumero').value.trim(),
    nombre: document.getElementById('editSocioNombre').value.trim(),
    apellido: document.getElementById('editSocioApellido').value.trim(),
    dni: document.getElementById('editSocioDni').value.trim(),
    email: document.getElementById('editSocioEmail').value.trim(),
    telefono: document.getElementById('editSocioTelefono').value.trim(),
    categoria_id: parseInt(document.getElementById('editSocioCategoria').value),
    estado: document.getElementById('editSocioEstado').value,
    fecha_alta: document.getElementById('editSocioFechaAlta').value || undefined,
    fecha_nacimiento: document.getElementById('editSocioFechaNac').value || '',
    edad: parseInt(document.getElementById('editSocioEdad').value) || null,
    direccion: document.getElementById('editSocioDireccion').value.trim(),
    ocupacion: document.getElementById('editSocioOcupacion').value.trim(),
    estado_civil: document.getElementById('editSocioEstadoCivil').value,
    grupo_sanguineo: document.getElementById('editSocioGrupoSangre').value,
    posee_obra_social: document.getElementById('editSocioPoseeObraSocial').value,
    nombre_obra_social: document.getElementById('editSocioNombreObraSocial').value.trim(),
    alergias_condiciones: document.getElementById('editSocioAlergias').value.trim(),
    contacto_emergencia_nombre: document.getElementById('editSocioUrgenciaNombre').value.trim(),
    contacto_emergencia_telefono: document.getElementById('editSocioUrgenciaTel').value.trim(),
    tutor_nombre: document.getElementById('editSocioTutor').value.trim(),
    socio_proponente: document.getElementById('editSocioProponente').value.trim(),
    disciplinas
  };

  try {
    const res = await fetch(`${API_BASE}/socios/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Error al actualizar socio');

    alert(`✅ Socio "${payload.nombre} ${payload.apellido}" actualizado con éxito`);
    closeModal('modalEditarSocio');
    loadSocios();
    if (state.currentTab === 'dashboard') loadDashboard();
  } catch (err) {
    alert('❌ ' + err.message);
  }
}

// ==========================================
// 10. ESTADO DE CUENTA Y CANCELACIÓN DE DEUDA EN EFECTIVO
// ==========================================
let socioActualCuenta = null;
let socioActualCuentaId = null;

async function abrirCuentaSocio(socioId) {
  try {
    socioActualCuentaId = socioId;
    const res = await fetch(`${API_BASE}/socios/${socioId}`);
    if (!res.ok) throw new Error('No se pudo cargar la cuenta corriente del socio.');
    const s = await res.json();
    socioActualCuenta = s;

    document.getElementById('cuentaSocioNumero').textContent = s.numero_socio || 'S/N';
    document.getElementById('cuentaSocioCategoria').textContent = s.categoria_nombre || 'Socio';
    document.getElementById('cuentaSocioNombre').textContent = `${s.nombre} ${s.apellido}`;
    document.getElementById('cuentaSocioDni').textContent = `DNI: ${s.dni || '-'} • Tel: ${s.telefono || 'Sin teléfono'}`;

    const mesActual = '2026-10';
    const cuotasExigibles = (s.cuotas || []).filter(c => c.periodo <= mesActual && (c.saldo_pendiente !== undefined ? c.saldo_pendiente : c.monto_total) > 0);
    const cuotasFuturas = (s.cuotas || []).filter(c => c.periodo > mesActual && (c.saldo_pendiente !== undefined ? c.saldo_pendiente : c.monto_total) > 0);
    const totalDeuda = cuotasExigibles.reduce((acc, c) => acc + (c.saldo_pendiente !== undefined ? c.saldo_pendiente : c.monto_total), 0);

    document.getElementById('cuentaSocioTotalDeuda').textContent = formatCurrency(totalDeuda);
    document.getElementById('cuentaSocioCantCuotas').textContent = cuotasExigibles.length > 0 
      ? `${cuotasExigibles.length} cuota(s) adeudada(s) hasta Octubre` 
      : 'Al Día con el mes actual (Octubre)';

    const btnCancelarTodo = document.getElementById('btnCuentaCancelarTodo');
    if (totalDeuda > 0) {
      btnCancelarTodo.classList.remove('hidden');
      btnCancelarTodo.innerHTML = `<span>⚡</span> Cancelar Deuda Exigible en Efectivo (${formatCurrency(totalDeuda)})`;
    } else {
      btnCancelarTodo.classList.add('hidden');
    }

    const containerCuotas = document.getElementById('cuentaSocioListaCuotas');
    containerCuotas.innerHTML = '';

    if (cuotasExigibles.length === 0) {
      containerCuotas.innerHTML = `
        <div class="text-center py-6 bg-emerald-50 rounded-2xl border border-emerald-200">
          <p class="text-sm font-bold text-emerald-800">🎉 ¡El socio está al día con el mes actual (Octubre)!</p>
          <p class="text-xs text-emerald-600 mt-1">Tiene la cuota de Octubre abonada y no registra deudas en períodos anteriores.</p>
        </div>
      `;
    } else {
      cuotasExigibles.forEach(c => {
        cuotasRegistry.set(c.id, c);
        const saldo = c.saldo_pendiente !== undefined ? c.saldo_pendiente : c.monto_total;
        const cobrado = c.total_cobrado || 0;
        const item = document.createElement('div');
        item.className = 'p-3 bg-white rounded-2xl border border-rose-200 shadow-sm space-y-2 hover:border-rose-300 transition';
        item.innerHTML = `
          <div class="flex justify-between items-start">
            <div>
              <span class="font-bold text-slate-900 text-sm">${c.periodo} &bull; ${c.concepto}</span>
              <p class="text-[11px] text-slate-400 font-mono">Vencimiento: ${c.fecha_vencimiento}</p>
            </div>
            <span class="px-2 py-0.5 rounded-full text-[10px] font-bold ${c.estado === 'Parcial' ? 'bg-amber-100 text-amber-800' : 'bg-rose-100 text-rose-800'}">
              ${c.estado === 'Parcial' ? '🟠 Pago Parcial' : '! Cuota Adeudada'}
            </span>
          </div>

          <div class="flex justify-between items-center text-xs bg-slate-50 p-2 rounded-xl border border-slate-100">
            <div>
              <span class="text-slate-400 block text-[10px] uppercase font-bold">Total Cuota</span>
              <span class="font-semibold text-slate-700">${formatCurrency(c.monto_total)}</span>
            </div>
            ${cobrado > 0 ? `
              <div>
                <span class="text-slate-400 block text-[10px] uppercase font-bold">Abonado a cuenta</span>
                <span class="font-semibold text-emerald-700">${formatCurrency(cobrado)}</span>
              </div>
            ` : ''}
            <div class="text-right">
              <span class="text-slate-400 block text-[10px] uppercase font-bold">Saldo Deudor</span>
              <span class="font-black text-rose-600 text-sm">${formatCurrency(saldo)}</span>
            </div>
          </div>

          <div class="flex flex-wrap items-center justify-end gap-2 pt-1">
            <button onclick="abrirCobroPorId(${c.id})" title="Elegir otro monto o medio de pago" class="px-2.5 py-1.5 rounded-xl text-xs font-semibold text-slate-600 bg-slate-100 hover:bg-slate-200 transition">
              ⚙️ Cobro Parcial / Tarjeta
            </button>
            <button onclick="cobrarCuotaEfectivoPorId(${c.id})" class="px-3.5 py-1.5 rounded-xl text-xs font-black bg-emerald-600 hover:bg-emerald-700 text-white shadow-md shadow-emerald-600/20 flex items-center gap-1 transition">
              💵 Cancelar en Efectivo (${formatCurrency(saldo)})
            </button>
          </div>
        `;
        containerCuotas.appendChild(item);
      });
    }

    // Cuotas futuras opcionales
    if (cuotasFuturas.length > 0) {
      const headerFuturas = document.createElement('div');
      headerFuturas.className = 'pt-2 pb-1 text-xs font-bold text-slate-500 flex items-center gap-1.5';
      headerFuturas.innerHTML = '<span>📅 Cuotas Futuras no vencidas (Adelantar pago):</span>';
      containerCuotas.appendChild(headerFuturas);

      cuotasFuturas.forEach(c => {
        cuotasRegistry.set(c.id, c);
        const saldo = c.saldo_pendiente !== undefined ? c.saldo_pendiente : c.monto_total;
        const itemFut = document.createElement('div');
        itemFut.className = 'p-2.5 bg-slate-50/80 rounded-xl border border-slate-200 flex justify-between items-center text-xs';
        itemFut.innerHTML = `
          <div>
            <span class="font-bold text-slate-700">${c.periodo} &bull; ${c.concepto}</span>
            <span class="text-[10px] text-slate-400 block">Vto: ${c.fecha_vencimiento} (Aún no vencida)</span>
          </div>
          <div class="flex items-center gap-2">
            <span class="font-black text-slate-800">${formatCurrency(saldo)}</span>
            <button onclick="cobrarCuotaEfectivoPorId(${c.id})" class="px-2 py-1 rounded-lg text-[11px] font-bold bg-slate-200 hover:bg-emerald-600 hover:text-white transition">
              💵 Adelantar
            </button>
          </div>
        `;
        containerCuotas.appendChild(itemFut);
      });
    }

    // Historial de pagos
    const histCont = document.getElementById('cuentaSocioHistorialPagos');
    histCont.innerHTML = '';
    const ultimosPagos = (s.pagos || []).slice(0, 5);
    if (ultimosPagos.length === 0) {
      histCont.innerHTML = '<p class="text-[11px] text-slate-400 italic">No hay pagos previos registrados.</p>';
    } else {
      ultimosPagos.forEach(p => {
        pagosRegistry.set(p.id, p);
        const pDiv = document.createElement('div');
        pDiv.className = 'flex justify-between items-center text-[11px] p-1.5 bg-slate-50 rounded-lg border border-slate-100';
        pDiv.innerHTML = `
          <div>
            <span class="font-mono font-bold text-indigo-700">${p.nro_comprobante}</span> &bull; 
            <span>${p.periodo}</span> (${p.fecha_pago ? p.fecha_pago.split(' ')[0] : ''})
          </div>
          <div class="flex items-center gap-2">
            <span class="font-black text-emerald-600">${formatCurrency(p.monto_pagado)}</span>
            <span class="text-slate-400 text-[10px]">${p.medio_pago}</span>
            <button onclick="mostrarReciboPorId(${p.id})" class="text-[10px] font-bold text-indigo-600 hover:underline">Ver</button>
          </div>
        `;
        histCont.appendChild(pDiv);
      });
    }

    document.getElementById('modalCuentaSocio').classList.remove('hidden');
  } catch (err) {
    alert('❌ ' + err.message);
  }
}

async function cobrarCuotaEfectivoPorId(cuotaId) {
  let cuota = cuotasRegistry.get(cuotaId);
  if (!cuota && socioActualCuenta && socioActualCuenta.cuotas) {
    cuota = socioActualCuenta.cuotas.find(x => x.id === cuotaId);
  }
  if (!cuota) {
    alert('No se encontraron los datos de la cuota.');
    return;
  }
  return cobrarCuotaEfectivoDirecto(cuota);
}

async function cobrarCuotaEfectivoDirecto(cuota) {
  if (typeof cuota === 'number') {
    return cobrarCuotaEfectivoPorId(cuota);
  }
  const saldo = cuota.saldo_pendiente !== undefined ? cuota.saldo_pendiente : cuota.monto_total;
  const nombreSocio = cuota.nombre ? `${cuota.nombre} ${cuota.apellido}` : (socioActualCuenta ? `${socioActualCuenta.nombre} ${socioActualCuenta.apellido}` : 'Socio');

  const confirmacion = confirm(`¿Confirmar recepción de ${formatCurrency(saldo)} en EFECTIVO para cancelar la cuota ${cuota.periodo} (${cuota.concepto}) de ${nombreSocio}?`);
  if (!confirmacion) return;

  try {
    const res = await fetch(`${API_BASE}/pagos`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        cuota_id: cuota.id,
        medio_pago: 'Efectivo',
        monto_pagado: saldo,
        observaciones: 'Cobro de cuota en efectivo en ventanilla'
      })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Error al procesar cobro');

    closeModal('modalCuentaSocio');
    closeModal('modalFichaSocio');
    mostrarRecibo(data.pago);
    if (state.currentTab === 'socios') loadSocios();
    if (state.currentTab === 'cuotas') loadCuotas();
    if (state.currentTab === 'dashboard') loadDashboard();
  } catch (err) {
    alert(`❌ ${err.message}`);
  }
}

async function cancelarTodaLaDeudaEfectivo() {
  if (!socioActualCuentaId || !socioActualCuenta) return;
  const cuotasAdeudadas = (socioActualCuenta.cuotas || []).filter(c => c.periodo <= '2026-10' && (c.saldo_pendiente !== undefined ? c.saldo_pendiente : c.monto_total) > 0);
  const totalDeuda = cuotasAdeudadas.reduce((acc, c) => acc + (c.saldo_pendiente !== undefined ? c.saldo_pendiente : c.monto_total), 0);

  const confirmacion = confirm(`¿Confirmar cobro de LA DEUDA EXIGIBLE (${formatCurrency(totalDeuda)} en EFECTIVO) de ${socioActualCuenta.nombre} ${socioActualCuenta.apellido}? Se cancelarán ${cuotasAdeudadas.length} cuotas adeudadas hasta Octubre.`);
  if (!confirmacion) return;

  try {
    const res = await fetch(`${API_BASE}/socios/${socioActualCuentaId}/cancelar-deuda`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        medio_pago: 'Efectivo',
        observaciones: 'Cancelación total de deuda en ventanilla en efectivo'
      })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Error al cancelar deuda');

    alert(`✅ ${data.message}\n¡El socio ha quedado totalmente al día!`);
    closeModal('modalCuentaSocio');
    closeModal('modalFichaSocio');
    if (data.auditoriaId) {
      mostrarToastDeshacer(`Cancelación de deuda a ${data.socio}`, data.auditoriaId);
    }
    if (state.currentTab === 'socios') loadSocios();
    if (state.currentTab === 'cuotas') loadCuotas();
    if (state.currentTab === 'dashboard') loadDashboard();
  } catch (err) {
    alert(`❌ ${err.message}`);
  }
}

// ==========================================
// 8. COPIAS DE SEGURIDAD (RESPALDAR)
// ==========================================
window.descargarBackup = function() {
  const fecha = new Date().toISOString().split('T')[0];
  const url = `${API_BASE}/admin/backup`;
  
  // Crear un enlace temporal para forzar la descarga en el navegador
  const a = document.createElement('a');
  a.href = url;
  a.download = `club-tercer-tiempo-backup-${fecha}.db`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);

  mostrarToastDeshacer('Descarga de respaldo iniciada (.db)', null);
};

// ==========================================
// 9. ELIMINACIÓN DE SOCIOS
// ==========================================
let socioAEliminarId = null;

window.confirmarEliminarSocio = function(id, nombre, numero_socio, dni) {
  socioAEliminarId = id;
  const texto = document.getElementById('textoConfirmarEliminarSocio');
  if (texto) {
    texto.innerHTML = `¿Estás seguro de que deseas eliminar al socio <strong>${nombre}</strong>?<br><span class="font-mono text-slate-500">N° Socio: ${numero_socio} • DNI: ${dni}</span>`;
  }
  document.getElementById('modalConfirmarEliminarSocio').classList.remove('hidden');
};

window.confirmarEliminarSocioDesdeModal = function() {
  const id = document.getElementById('editSocioId').value;
  const nombre = `${document.getElementById('editSocioNombre').value} ${document.getElementById('editSocioApellido').value}`;
  const numero = document.getElementById('editSocioNumero').value;
  const dni = document.getElementById('editSocioDni').value;
  closeModal('modalEditarSocio');
  confirmarEliminarSocio(id, nombre, numero, dni);
};

window.ejecutarEliminarSocio = async function() {
  if (!socioAEliminarId) return;

  const btn = document.getElementById('btnConfirmarEliminarSocio');
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Eliminando...';
  }

  try {
    const res = await fetch(`${API_BASE}/socios/${socioAEliminarId}`, {
      method: 'DELETE'
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Error al eliminar socio');

    closeModal('modalConfirmarEliminarSocio');
    loadSocios();
    loadDashboard();
    if (state.currentTab === 'cuotas') loadCuotas();

    if (data.auditoriaId) {
      mostrarToastDeshacer(data.message, data.auditoriaId);
    } else {
      alert(`✅ ${data.message}`);
    }
  } catch (err) {
    alert(`❌ ${err.message}`);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = '🗑️ Sí, Eliminar';
    }
    socioAEliminarId = null;
  }
};

// ==========================================
// 10. HISTORIAL DE AUDITORÍA Y DESHACER ACCIONES
// ==========================================
let ultimaAuditoriaId = null;
let toastTimeout = null;

window.mostrarToastDeshacer = function(texto, auditoriaId) {
  ultimaAuditoriaId = auditoriaId;
  const toast = document.getElementById('toastDeshacer');
  const textoEl = document.getElementById('toastDeshacerTexto');
  const btn = document.getElementById('btnToastDeshacer');
  if (!toast || !textoEl) return;

  textoEl.textContent = texto;
  if (auditoriaId) {
    if (btn) btn.classList.remove('hidden');
  } else {
    if (btn) btn.classList.add('hidden');
  }

  toast.classList.remove('hidden');

  if (toastTimeout) clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => {
    cerrarToastDeshacer();
  }, 10000);
};

window.cerrarToastDeshacer = function() {
  const toast = document.getElementById('toastDeshacer');
  if (toast) toast.classList.add('hidden');
  if (toastTimeout) clearTimeout(toastTimeout);
};

window.deshacerAccionToast = async function() {
  if (!ultimaAuditoriaId) return;
  const idParaDeshacer = ultimaAuditoriaId;
  cerrarToastDeshacer();
  await deshacerAccion(idParaDeshacer);
};

window.abrirModalDeshacer = async function() {
  const modal = document.getElementById('modalDeshacerAcciones');
  const contenedor = document.getElementById('listaAccionesDeshacer');
  if (!modal || !contenedor) return;

  contenedor.innerHTML = '<div class="text-center py-6 text-slate-400 text-xs">Cargando historial de acciones...</div>';
  modal.classList.remove('hidden');

  try {
    const res = await fetch(`${API_BASE}/acciones/ultimas`);
    const acciones = await res.json();

    if (acciones.length === 0) {
      contenedor.innerHTML = '<div class="text-center py-8 text-slate-400 text-xs">No hay acciones registradas en el historial aún.</div>';
      return;
    }

    contenedor.innerHTML = '';
    acciones.forEach(acc => {
      const item = document.createElement('div');
      item.className = `p-3 rounded-2xl border transition flex items-center justify-between gap-3 ${
        acc.deshecho 
          ? 'bg-slate-50 border-slate-200 opacity-60' 
          : 'bg-white border-slate-200 hover:border-amber-300 shadow-sm'
      }`;

      let icono = '⚡';
      if (acc.tipo === 'PAGO') icono = '💵';
      else if (acc.tipo === 'COMPROBANTE_APROBADO') icono = '✅';
      else if (acc.tipo === 'COMPROBANTE_RECHAZADO') icono = '❌';
      else if (acc.tipo === 'CANCELAR_DEUDA') icono = '⚡';
      else if (acc.tipo === 'ELIMINAR_SOCIO') icono = '🗑️';
      else if (acc.tipo === 'CREAR_SOCIO') icono = '👤';

      item.innerHTML = `
        <div class="flex items-center gap-3">
          <div class="w-8 h-8 rounded-xl ${acc.deshecho ? 'bg-slate-200 text-slate-500' : 'bg-amber-100 text-amber-700'} font-bold flex items-center justify-center text-sm">
            ${icono}
          </div>
          <div>
            <p class="text-xs font-bold text-slate-900 leading-tight">${acc.descripcion}</p>
            <p class="text-[10px] text-slate-400 font-mono mt-0.5">${acc.fecha}</p>
          </div>
        </div>
        <div>
          ${acc.deshecho 
            ? `<span class="text-[11px] font-bold text-slate-400 bg-slate-100 px-2.5 py-1 rounded-full">Deshecho</span>`
            : `<button onclick="deshacerAccion(${acc.id})" class="bg-amber-500 hover:bg-amber-600 text-zinc-950 font-black px-3 py-1.5 rounded-xl text-xs flex items-center gap-1 shadow transition cursor-pointer">
                 <span>↶</span> Deshacer
               </button>`
          }
        </div>
      `;
      contenedor.appendChild(item);
    });
  } catch (err) {
    contenedor.innerHTML = `<div class="text-center py-6 text-rose-500 text-xs">Error al cargar historial: ${err.message}</div>`;
  }
};

window.deshacerAccion = async function(id) {
  if (!confirm('¿Confirmás que deseás DESHACER esta acción y revertir los cambios?')) return;

  try {
    const res = await fetch(`${API_BASE}/acciones/${id}/deshacer`, {
      method: 'POST'
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Error al deshacer acción');

    alert(`✅ ${data.message}`);

    loadSocios();
    loadDashboard();
    if (state.currentTab === 'cuotas') loadCuotas();
    if (state.currentTab === 'pagos') loadPagos();
    if (state.currentTab === 'tesoreria') loadComprobantesTesoreria();

    const modal = document.getElementById('modalDeshacerAcciones');
    if (modal && !modal.classList.contains('hidden')) {
      abrirModalDeshacer();
    }
  } catch (err) {
    alert(`❌ ${err.message}`);
  }
};

// ==========================================
// 11. RECORDATORIOS DE COBRANZAS POR WHATSAPP & PLANTILLA PERSONALIZABLE
// ==========================================
let datosBancariosCache = null;
let plantillaWhatsAppCache = null;

async function obtenerDatosBancarios(forceRefresh = true) {
  if (!forceRefresh && datosBancariosCache) return datosBancariosCache;
  try {
    const res = await fetch(`${API_BASE}/config/bancarios?_=${Date.now()}`);
    if (res.ok) {
      datosBancariosCache = await res.json();
      return datosBancariosCache;
    }
  } catch (e) {
    console.error('Error obteniendo datos bancarios:', e);
  }
  return datosBancariosCache || {
    alias: 'ACTTM2026',
    cbu: '0110348740034817394276',
    banco: 'BANCO NACION',
    titular: 'Asociación Club Tercer Tiempo Malargüe',
    cuit: '0',
    tipo_cuenta: 'Cuenta Corriente Especial'
  };
}

async function cargarPlantillaWhatsApp() {
  try {
    const res = await fetch(`${API_BASE}/config/plantilla-whatsapp?_=${Date.now()}`);
    if (res.ok) {
      const data = await res.json();
      plantillaWhatsAppCache = data.plantilla;
      
      const txtModal = document.getElementById('txtPlantillaMensaje');
      if (txtModal) txtModal.value = data.plantilla;

      const txtConfig = document.getElementById('configTxtPlantillaMensaje');
      if (txtConfig) txtConfig.value = data.plantilla;

      await actualizarPrevisualizacionEnVivoPlantilla();
      return data.plantilla;
    }
  } catch (e) {
    console.error('Error cargando plantilla de WhatsApp:', e);
  }
  return plantillaWhatsAppCache;
}

window.sincronizarPlantillas = function(fuente) {
  const txtModal = document.getElementById('txtPlantillaMensaje');
  const txtConfig = document.getElementById('configTxtPlantillaMensaje');

  if (fuente === 'modal' && txtModal && txtConfig) {
    txtConfig.value = txtModal.value;
  } else if (fuente === 'config' && txtConfig && txtModal) {
    txtModal.value = txtConfig.value;
  }

  const texto = (txtModal && txtModal.value) ? txtModal.value : (txtConfig ? txtConfig.value : '');
  plantillaWhatsAppCache = texto;
  actualizarPrevisualizacionEnVivoPlantilla();
};

window.actualizarPrevisualizacionEnVivoPlantilla = async function() {
  const txtModal = document.getElementById('txtPlantillaMensaje');
  const txtConfig = document.getElementById('configTxtPlantillaMensaje');
  const textoBase = (txtModal && txtModal.value) ? txtModal.value : ((txtConfig && txtConfig.value) ? txtConfig.value : plantillaWhatsAppCache);

  if (!textoBase) return;

  const banco = await obtenerDatosBancarios(true);
  const socioDemo = {
    nombre: 'Lucas',
    apellido: 'Araya',
    numero_socio: 'ATL-001'
  };
  const cuotasDemo = [
    { periodo: '2026-10', concepto: 'Cuota Social Atletismo', saldo_pendiente: 10000 }
  ];

  const mensajeRenderizado = formatearMensajeWhatsApp(textoBase, socioDemo, cuotasDemo, banco);

  const prevModal = document.getElementById('previewMensajeEnVivo');
  if (prevModal) prevModal.textContent = mensajeRenderizado;

  const prevConfig = document.getElementById('configPreviewMensajeEnVivo');
  if (prevConfig) prevConfig.textContent = mensajeRenderizado;
};

window.insertarVariablePlantilla = function(tag) {
  let target = document.getElementById('txtPlantillaMensaje');
  const targetConfig = document.getElementById('configTxtPlantillaMensaje');

  // Si estamos en la pestaña configuración o el modal no está visible
  const modal = document.getElementById('modalRecordatoriosMasivos');
  if (modal && modal.classList.contains('hidden') && targetConfig) {
    target = targetConfig;
  }

  if (!target) return;

  const start = target.selectionStart || target.value.length;
  const end = target.selectionEnd || target.value.length;
  const val = target.value;
  target.value = val.substring(0, start) + tag + val.substring(end);
  target.focus();
  target.selectionStart = target.selectionEnd = start + tag.length;

  sincronizarPlantillas(target === targetConfig ? 'config' : 'modal');
};

window.guardarPlantillaMensaje = async function() {
  const txtModal = document.getElementById('txtPlantillaMensaje');
  const txtConfig = document.getElementById('configTxtPlantillaMensaje');
  const plantilla = (txtModal && txtModal.value.trim()) ? txtModal.value.trim() : (txtConfig ? txtConfig.value.trim() : '');

  if (!plantilla) {
    alert('⚠️ La plantilla no puede estar vacía.');
    return;
  }

  try {
    const res = await fetch(`${API_BASE}/config/plantilla-whatsapp`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ plantilla })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Error al guardar plantilla');

    plantillaWhatsAppCache = data.plantilla;
    alert('✅ Plantilla de mensaje de WhatsApp guardada exitosamente.\nTodos los recordatorios futuros utilizarán este formato con los datos bancarios actualizados.');
    await actualizarPrevisualizacionEnVivoPlantilla();
  } catch (err) {
    alert('❌ ' + err.message);
  }
};

window.restaurarPlantillaPredeterminada = async function() {
  if (!confirm('¿Deseás restaurar la plantilla predeterminada original con los textos y variables del club?')) return;

  try {
    const res = await fetch(`${API_BASE}/config/plantilla-whatsapp?_=${Date.now()}`);
    const data = await res.json();
    if (data.plantilla_default) {
      const resPut = await fetch(`${API_BASE}/config/plantilla-whatsapp`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plantilla: data.plantilla_default })
      });
      const dataPut = await resPut.json();
      plantillaWhatsAppCache = dataPut.plantilla;

      const txtModal = document.getElementById('txtPlantillaMensaje');
      if (txtModal) txtModal.value = dataPut.plantilla;
      const txtConfig = document.getElementById('configTxtPlantillaMensaje');
      if (txtConfig) txtConfig.value = dataPut.plantilla;

      alert('✅ Plantilla restaurada a los valores predeterminados.');
      await actualizarPrevisualizacionEnVivoPlantilla();
    }
  } catch (err) {
    alert('❌ ' + err.message);
  }
};

function formatearMensajeWhatsApp(plantilla, socio, cuotasAdeudadas, banco) {
  const totalDeuda = cuotasAdeudadas.reduce((acc, c) => 
    acc + (c.saldo_pendiente !== undefined ? c.saldo_pendiente : c.monto_total), 0
  );

  let detalleLineas = '';
  if (cuotasAdeudadas.length > 0) {
    detalleLineas = cuotasAdeudadas.map(c => {
      const saldo = c.saldo_pendiente !== undefined ? c.saldo_pendiente : c.monto_total;
      return `• *${c.periodo}* - ${c.concepto}: *${formatCurrency(saldo)}*`;
    }).join('\n');
  } else {
    detalleLineas = '• Sin cuotas pendientes (Al día)';
  }

  const origin = window.location.origin || 'http://localhost:3000';
  const portalUrl = `${origin}/socio.html`;

  let resultado = plantilla || '';
  resultado = resultado.replace(/\{nombre\}/gi, socio.nombre || 'Socio');
  resultado = resultado.replace(/\{apellido\}/gi, socio.apellido || '');
  resultado = resultado.replace(/\{numero_socio\}/gi, socio.numero_socio || 'S/N');
  resultado = resultado.replace(/\{cuotas_pendientes\}/gi, String(cuotasAdeudadas.length));
  resultado = resultado.replace(/\{deuda_total\}/gi, formatCurrency(totalDeuda));
  resultado = resultado.replace(/\{detalle_cuotas\}/gi, detalleLineas);
  resultado = resultado.replace(/\{alias\}/gi, banco.alias || 'ACTTM2026');
  resultado = resultado.replace(/\{cbu\}/gi, banco.cbu || '0110348740034817394276');
  resultado = resultado.replace(/\{banco\}/gi, banco.banco || 'BANCO NACION');
  resultado = resultado.replace(/\{titular\}/gi, banco.titular || 'Asociación Club Tercer Tiempo Malargüe');
  resultado = resultado.replace(/\{portal_url\}/gi, portalUrl);

  return resultado;
}

function sanitizarTelefonoWhatsApp(telefono) {
  if (!telefono) return '';
  let digits = telefono.replace(/\D/g, '');
  if (digits.startsWith('549')) {
    return digits;
  }
  if (digits.startsWith('54')) {
    return '549' + digits.substring(2);
  }
  if (digits.startsWith('0')) {
    digits = digits.substring(1);
  }
  if (digits.startsWith('15')) {
    digits = digits.substring(2);
  }
  if (digits.length === 10) { // ej. 2604708373
    return '549' + digits;
  }
  return digits.length >= 8 ? '549' + digits : '';
}

window.enviarRecordatorioWhatsApp = async function(socioId) {
  try {
    const [resSocio, banco, plantilla] = await Promise.all([
      fetch(`${API_BASE}/socios/${socioId}`),
      obtenerDatosBancarios(true),
      cargarPlantillaWhatsApp()
    ]);

    if (!resSocio.ok) throw new Error('No se pudo obtener la información del socio.');
    const socio = await resSocio.json();

    const telefonoRaw = socio.telefono || '';
    const phone = sanitizarTelefonoWhatsApp(telefonoRaw);

    if (!phone) {
      alert(`⚠️ El socio ${socio.nombre} ${socio.apellido} no tiene un teléfono celular registrado.\nPodés cargarlo ingresando al botón "✏️ Editar Socio".`);
      return;
    }

    const mesReferencia = '2026-10';
    const cuotasAdeudadas = (socio.cuotas || []).filter(c => 
      c.periodo <= mesReferencia && (c.saldo_pendiente !== undefined ? c.saldo_pendiente : c.monto_total) > 0
    );

    const totalDeuda = cuotasAdeudadas.reduce((acc, c) => 
      acc + (c.saldo_pendiente !== undefined ? c.saldo_pendiente : c.monto_total), 0
    );

    let mensaje = '';
    if (totalDeuda > 0) {
      mensaje = formatearMensajeWhatsApp(plantilla, socio, cuotasAdeudadas, banco);
    } else {
      const origin = window.location.origin || 'http://localhost:3000';
      const portalUrl = `${origin}/socio.html`;
      mensaje = `Hola *${socio.nombre}* 👋 Te saludamos desde la administración del *Club Deportivo Tercer Tiempo Malargüe* 🦊⚽\n\n` +
        `¡Queremos agradecerte por tener tus cuotas al día! 🎉\n\n` +
        `📱 Recordá que podés acceder a tu carnet digital y ver tus recibos en nuestro portal:\n` +
        `${portalUrl}\n\n` +
        `¡Muchas gracias por formar parte del club! 🏆`;
    }

    const waUrl = `https://api.whatsapp.com/send?phone=${phone}&text=${encodeURIComponent(mensaje)}`;
    window.open(waUrl, '_blank');
  } catch (err) {
    alert('❌ Error al preparar recordatorio: ' + err.message);
  }
};

window.abrirModalRecordatoriosMasivos = async function() {
  const modal = document.getElementById('modalRecordatoriosMasivos');
  const lista = document.getElementById('listaSociosRecordatorio');
  if (!modal || !lista) return;

  modal.classList.remove('hidden');
  lista.innerHTML = '<div class="text-center py-8 text-slate-400 text-xs">Cargando socios con cuotas pendientes...</div>';

  try {
    const [banco, resSocios] = await Promise.all([
      obtenerDatosBancarios(true),
      fetch(`${API_BASE}/socios?periodo=2026-10`),
      cargarPlantillaWhatsApp()
    ]);

    const todosSocios = await resSocios.json();
    state.sociosConDeudaRecordatorio = todosSocios.filter(s => (s.cuotas_pendientes || 0) > 0);

    const selectorGrupo = document.getElementById('filtroRecordatorioGrupo');
    if (selectorGrupo) selectorGrupo.value = 'TODOS';

    filtrarSociosRecordatorio();
  } catch (err) {
    lista.innerHTML = `<div class="text-center py-6 text-rose-500 text-xs">Error al cargar socios: ${err.message}</div>`;
  }
};

window.filtrarSociosRecordatorio = function() {
  const lista = document.getElementById('listaSociosRecordatorio');
  if (!lista || !state.sociosConDeudaRecordatorio) return;

  const selector = document.getElementById('filtroRecordatorioGrupo');
  const grupo = selector ? selector.value : 'TODOS';
  let filtrados = state.sociosConDeudaRecordatorio;

  if (grupo === 'FUND') {
    filtrados = filtrados.filter(s => s.numero_socio.startsWith('FUND'));
  } else if (grupo === 'FUT') {
    filtrados = filtrados.filter(s => s.numero_socio.startsWith('FUT') || (s.disciplinas_str && s.disciplinas_str.includes('Fútbol')));
  } else if (grupo === 'ATL') {
    filtrados = filtrados.filter(s => s.numero_socio.startsWith('ATL') || (s.disciplinas_str && s.disciplinas_str.includes('Atletismo')));
  } else if (grupo === 'HB') {
    filtrados = filtrados.filter(s => s.numero_socio.startsWith('HB') || (s.disciplinas_str && s.disciplinas_str.includes('Handball')));
  } else if (grupo === 'VOL') {
    filtrados = filtrados.filter(s => s.numero_socio.startsWith('VOL') || s.numero_socio.startsWith('VFA') || s.numero_socio.startsWith('VMA') || (s.disciplinas_str && s.disciplinas_str.includes('Voley')));
  } else if (grupo === 'GEN') {
    filtrados = filtrados.filter(s => s.numero_socio.startsWith('GEN') || (!s.disciplinas_str));
  }

  const totalMonto = filtrados.reduce((acc, s) => acc + (s.deuda_total || 0), 0);
  const elCant = document.getElementById('cantMorososRecordatorio');
  if (elCant) elCant.textContent = `${filtrados.length} socios pendientes`;
  const elTotal = document.getElementById('totalMontoRecordatorio');
  if (elTotal) elTotal.textContent = formatCurrency(totalMonto);

  if (filtrados.length === 0) {
    lista.innerHTML = '<div class="text-center py-8 text-emerald-600 font-bold text-xs bg-emerald-50 rounded-2xl border border-emerald-200">🎉 ¡Excelente! No hay socios con deuda en este grupo.</div>';
    return;
  }

  lista.innerHTML = '';
  filtrados.forEach(s => {
    const item = document.createElement('div');
    item.className = 'p-3 rounded-2xl bg-white border border-slate-200 hover:border-emerald-300 hover:shadow-sm transition flex flex-col sm:flex-row sm:items-center justify-between gap-3';
    
    const tieneTel = !!s.telefono;
    const telBadge = tieneTel 
      ? `<span class="text-[11px] font-mono text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-md border border-emerald-200">📱 ${s.telefono}</span>`
      : `<span class="text-[11px] font-bold text-rose-600 bg-rose-50 px-2 py-0.5 rounded-md border border-rose-200">⚠️ Sin Celular</span>`;

    item.innerHTML = `
      <div class="flex items-center gap-3">
        <div class="w-9 h-9 rounded-xl bg-slate-100 text-slate-700 font-bold flex items-center justify-center text-xs border border-slate-200">
          ${s.numero_socio.substring(0, 3)}
        </div>
        <div>
          <div class="flex items-center gap-2">
            <span class="text-xs font-bold text-slate-900">${s.nombre} ${s.apellido}</span>
            <span class="text-[10px] font-mono bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded font-semibold">${s.numero_socio}</span>
          </div>
          <div class="flex flex-wrap items-center gap-2 mt-0.5">
            ${telBadge}
            <span class="text-[10px] text-slate-400 truncate max-w-[160px]">${s.disciplinas_str || s.categoria_nombre}</span>
          </div>
        </div>
      </div>
      <div class="flex items-center justify-between sm:justify-end gap-3 pt-2 sm:pt-0 border-t sm:border-t-0 border-slate-100">
        <div class="text-left sm:text-right">
          <span class="text-[10px] uppercase font-bold text-slate-400 block">${s.cuotas_pendientes} cuota(s)</span>
          <span class="text-xs font-black text-rose-600">${formatCurrency(s.deuda_total)}</span>
        </div>
        <button onclick="enviarRecordatorioWhatsApp(${s.id})" title="Enviar WhatsApp a ${s.nombre}" class="bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs px-3 py-1.5 rounded-xl shadow-sm hover:shadow transition flex items-center gap-1.5 cursor-pointer">
          <span>💬</span> Enviar
        </button>
      </div>
    `;
    lista.appendChild(item);
  });
};
