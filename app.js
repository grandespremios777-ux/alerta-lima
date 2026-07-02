// Inicializar Firebase
firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();
const auth = firebase.auth();
const providerGoogle = new firebase.auth.GoogleAuthProvider();

auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL)
  .then(() => {
    console.log("Persistencia de sesión activada");
  })
  .catch((error) => {
    console.error("Error configurando persistencia:", error);
  });

// Mapa centrado en Lima
const map = L.map('map').setView([-12.0464, -77.0428], 13);

L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 19,
  attribution: '&copy; OpenStreetMap'
}).addTo(map);

let ubicacionSeleccionada = null;
let marcadorUsuario = null;
let marcadorSeleccion = null;
let siguiendoUsuario = true;
let temporizadorReencuadre = null;
let usuarioActual = null;
let perfilUsuario = null;
function esAdmin() {
  return perfilUsuario && perfilUsuario.rol === "admin";
}

function esPremium() {
  return esAdmin() || (perfilUsuario && perfilUsuario.premium === true);
}

function actualizarEstiloPremiumUsuario() {
  const usuarioInfo = document.getElementById('usuario-info');

  if (!usuarioInfo) return;

  let etiquetaPremium = document.getElementById('etiqueta-premium');

  if (esPremium()) {
    usuarioInfo.classList.add('usuario-premium');

    if (!etiquetaPremium) {
      etiquetaPremium = document.createElement('span');
      etiquetaPremium.id = 'etiqueta-premium';
      etiquetaPremium.className = 'etiqueta-premium';
      etiquetaPremium.textContent = '⭐ PREMIUM';

      const botonSalir = document.getElementById('btn-logout');

      if (botonSalir) {
        usuarioInfo.insertBefore(etiquetaPremium, botonSalir);
      } else {
        usuarioInfo.appendChild(etiquetaPremium);
      }
    }
  } else {
    usuarioInfo.classList.remove('usuario-premium');

    if (etiquetaPremium) {
      etiquetaPremium.remove();
    }
  }
}

let ubicacionUsuarioActual = null;


const marcadoresAlertas = {};
const alertasEnMemoria = {};

/*
  Los comentarios y votos ya no se guardan dentro del documento principal
  de la alerta. Android usa subcolecciones y la web queda alineada:
  alertas/{alertaId}/comentarios/{comentarioId}
  alertas/{alertaId}/votos/{uidUsuario}
*/
const comentariosPorAlerta = {};
const votosUsuarioPorAlerta = {};
const listenersComentariosPorAlerta = {};
const listenersVotosPorAlerta = {};
let alertaPopupAbiertaId = null;

let anguloAuto = 0;

/* Tu imagen fue recortada con la parte frontal hacia abajo.
   Este ajuste hace que al iniciar mire hacia arriba del mapa. */
const AJUSTE_ORIENTACION_AUTO = 180;

const autosPorColor = {
  rojo: "img/auto-rojo.png",
  blanco: "img/auto-blanco.png",
  negro: "img/auto-negro.png",
  azul: "img/auto-azul.png",
  amarillo: "img/auto-amarillo.png"
};

const nombresColorAuto = {
  rojo: "Rojo",
  blanco: "Blanco",
  negro: "Negro",
  azul: "Azul",
  amarillo: "Amarillo"
};

function obtenerColorAutoActual() {
  const colorGuardado = perfilUsuario?.colorAuto;

  /* Gratis y visitante siempre ven el auto rojo */
  if (!esPremium()) {
    return "rojo";
  }

  /* Premium usa su color guardado; rojo es el predeterminado */
  if (autosPorColor[colorGuardado]) {
    return colorGuardado;
  }

  return "rojo";
}

function crearIconoAuto(angulo = 0) {
  const colorAuto = obtenerColorAutoActual();
  const imagenAuto = autosPorColor[colorAuto];

  return L.divIcon({
    className: "icono-auto-cenital",
    html: `
      <img
        src="${imagenAuto}"
        alt="Tu ubicación"
        style="transform: rotate(${angulo + AJUSTE_ORIENTACION_AUTO}deg);"
      >
    `,
    iconSize: [54, 54],
    iconAnchor: [27, 27]
  });
}

function actualizarIconoAuto() {
  if (!marcadorUsuario) return;

  marcadorUsuario.setIcon(crearIconoAuto(anguloAuto));
}

function calcularAnguloDireccion(origen, destino) {
  const lat1 = origen.lat * Math.PI / 180;
  const lng1 = origen.lng * Math.PI / 180;
  const lat2 = destino.lat * Math.PI / 180;
  const lng2 = destino.lng * Math.PI / 180;

  const diferenciaLng = lng2 - lng1;

  const y = Math.sin(diferenciaLng) * Math.cos(lat2);

  const x =
    Math.cos(lat1) * Math.sin(lat2) -
    Math.sin(lat1) * Math.cos(lat2) * Math.cos(diferenciaLng);

  const grados = Math.atan2(y, x) * 180 / Math.PI;

  return (grados + 360) % 360;
}

const tiposAlerta = {
  "Manifestación": { emoji: "📢", color: "#ff9800" },
  "Robo": { emoji: "🚨", color: "#d10000" },
  "Choque": { emoji: "💥", color: "#e53935" },
  "Atunes": { icono: "img/casco-azul.png", color: "#c8daec" },
  "Calle cerrada": { emoji: "⛔", color: "#424242" },
  
"Radar de velocidad": {
  icono: "img/camara-velocidad.png",
  color: "#ffffff"
},

"Incendio": { emoji: "🔥", color: "#464646" },
"Radar temporal": { emoji: "📡", color: "#ffffff" }
};

function obtenerEstadoAlerta(confirmaciones, negativos) {
  if (negativos >= 3 && negativos > confirmaciones) {
    return {
      texto: "Dudosa / posible falsa",
      emoji: "🔴",
      color: "#d32f2f"
    };
  }

  if (confirmaciones >= 3) {
    return {
      texto: "Confirmada por usuarios",
      emoji: "🟢",
      color: "#2e7d32"
    };
  }

  return {
    texto: "Poca confirmación",
    emoji: "🟡",
    color: "#f9a825"
  };
}

function crearIconoAlerta(tipo, confirmaciones = 0, negativos = 0) {
  const data = tiposAlerta[tipo] || { emoji: "⚠️", color: "#d10000" };
  const estado = obtenerEstadoAlerta(confirmaciones, negativos);

  if (data.icono) {
    return L.divIcon({
      className: 'icono-alerta-img',
      html: `
        <div style="border-color:${estado.color}" class="burbuja-alerta-img">
          <img src="${data.icono}" alt="${tipo}" />
        </div>
      `,
      iconSize: [52, 52],
      iconAnchor: [26, 26]
    });
  }

  return L.divIcon({
    className: 'icono-alerta',
    html: `
      <div style="background:${data.color}; border-color:${estado.color}" class="burbuja-alerta">
        ${data.emoji}
      </div>
    `,
    iconSize: [42, 42],
    iconAnchor: [21, 21]
  });
}

function calcularDistanciaMetros(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const rad = Math.PI / 180;

  const dLat = (lat2 - lat1) * rad;
  const dLng = (lng2 - lng1) * rad;

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * rad) *
    Math.cos(lat2 * rad) *
    Math.sin(dLng / 2) *
    Math.sin(dLng / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c;
}

function formatearDistancia(metros) {
  if (metros < 1000) {
    return `${Math.round(metros)} m`;
  }

  return `${(metros / 1000).toFixed(1)} km`;
}

function obtenerFechaVencimiento(alerta) {
  if (alerta.expiresAt && alerta.expiresAt.toDate) {
    return alerta.expiresAt.toDate();
  }

  if (alerta.expiresAt) {
    return new Date(alerta.expiresAt);
  }

  return null;
}

function formatearHoraComentario(hora) {
  if (!hora) return "Ahora";

  let fechaComentario;

  if (hora.toDate) {
    fechaComentario = hora.toDate();
  } else {
    fechaComentario = new Date(hora);
  }

  const diferencia = Date.now() - fechaComentario.getTime();
  const minutos = Math.floor(diferencia / (1000 * 60));
  const horas = Math.floor(minutos / 60);

  if (minutos < 1) return "Ahora";
  if (minutos < 60) return `Hace ${minutos} min`;
  if (horas < 24) return `Hace ${horas} h`;

  return fechaComentario.toLocaleDateString("es-PE", {
    day: "2-digit",
    month: "short"
  });
}

function escaparHtml(valor) {
  return String(valor ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

window.mostrarInfoLogin = function(accion) {
  alert(`Inicia sesión con Google para ${accion}.`);
};

window.mostrarInfoPremium = function(funcion) {
  alert(`${funcion} es una función Premium. Activa Premium para desbloquearla.`);
};

function crearPopupAlerta(id, alerta) {
  const vence = obtenerFechaVencimiento(alerta);
  const esAlertaPermanente = alerta.permanente === true;
  const bloqueEliminarAdmin =
    esAdmin() && esAlertaPermanente
      ? `
        <button
          onclick="eliminarAlertaPermanente('${id}')"
          style="
            width:100%;
            margin-top:10px;
            padding:8px;
            border:1px solid #d62828;
            border-radius:9px;
            background:#fff4f4;
            color:#b00000;
            font-weight:800;
            cursor:pointer;
          "
        >
          🗑 Eliminar alerta permanente
        </button>
      `
      : "";

  const confirmaciones = alerta.confirmaciones || 0;
  const negativos = alerta.negativos || 0;
  const estado = obtenerEstadoAlerta(confirmaciones, negativos);
  const alertaEsPremium = alerta.creadorPremium === true;

  const clasePremiumPopup = alertaEsPremium
    ? " popup-alerta-premium"
    : "";

  const clasePremiumCreador = alertaEsPremium
    ? " creador-alerta-premium"
    : "";

  const etiquetaPremiumCreador = alertaEsPremium
    ? `<span class="badge-creador-premium">⭐ PREMIUM</span>`
    : "";

  const claseVistaUsuario = !usuarioActual
    ? " vista-visitante"
    : esPremium()
      ? " vista-premium"
      : " vista-google";

  /*
    Compatibilidad: los comentarios antiguos creados por la web estaban
    dentro de alerta.comentarios. Los nuevos llegan desde la subcolección
    igual que en Android.
  */
  const comentariosModernos = comentariosPorAlerta[id] || [];
  const comentariosAntiguos = Array.isArray(alerta.comentarios)
    ? alerta.comentarios.map((comentario, indice) => ({
        id: `antiguo-${indice}`,
        texto: typeof comentario === "string"
          ? comentario
          : comentario.texto,
        nombre: typeof comentario === "string"
          ? "Usuario"
          : comentario.nombre,
        foto: typeof comentario === "string"
          ? ""
          : comentario.foto,
        hora: typeof comentario === "string"
          ? null
          : comentario.hora
      }))
    : [];

  const comentarios = [
    ...comentariosModernos,
    ...comentariosAntiguos
  ].slice(0, 6);

  const votoActual = usuarioActual
    ? votosUsuarioPorAlerta[id] || null
    : null;

  let distanciaTexto = "Ubicación no disponible";

  if (ubicacionUsuarioActual) {
    const distancia = calcularDistanciaMetros(
      ubicacionUsuarioActual.lat,
      ubicacionUsuarioActual.lng,
      alerta.lat,
      alerta.lng
    );

    distanciaTexto = formatearDistancia(distancia);
  }

  const listaComentarios = comentariosPorAlerta[id] === undefined &&
    comentariosAntiguos.length === 0
    ? `
      <li class="comentarios-cargando">
        Cargando comentarios…
      </li>
    `
    : comentarios.length
      ? comentarios.map((comentario) => `
          <li class="comentario-item">
            <div class="comentario-header">
              ${
                comentario.foto
                  ? `
                    <img
                      src="${escaparHtml(comentario.foto)}"
                      class="comentario-foto"
                      alt=""
                    >
                  `
                  : ""
              }

              <div>
                <span class="comentario-nombre">
                  ${escaparHtml(comentario.nombre || "Usuario")}
                </span>
                <br>
                <span class="comentario-hora">
                  ${formatearHoraComentario(comentario.hora)}
                </span>
              </div>
            </div>

            <p>${escaparHtml(comentario.texto || "")}</p>
          </li>
        `).join("")
      : "<li class=\"comentarios-vacios\">Aún no hay comentarios</li>";

  const bloqueDetalle = esPremium()
    ? `<p>${escaparHtml(alerta.descripcion || "Sin detalle adicional.")}</p>`
    : alerta.descripcion === "Alerta rápida" || !alerta.descripcion
      ? `<p>Alerta rápida</p>`
      : `
        <div style="display:flex; gap:6px; margin:8px 0;">
          <button
            onclick="mostrarInfoPremium('Ver el detalle completo')"
            style="flex:1; padding:8px; border:none; border-radius:8px; background:#eeeeee; color:#333;"
          >
            🔒 Ver detalle completo
          </button>

          <button
            onclick="mostrarInfoPremium('Ver el detalle completo')"
            style="padding:8px; border:none; border-radius:8px; background:#ffb300; color:#111; font-weight:800;"
          >
            ⭐ Premium
          </button>
        </div>
      `;

  const bloqueComentarios = `
    <strong>💬 Comentarios</strong>
    <ul class="lista-comentarios">
      ${listaComentarios}
    </ul>
  `;

  const bloqueComentar = usuarioActual
    ? `
      <input
        id="comentario-${id}"
        type="text"
        maxlength="280"
        placeholder="Escribe un comentario..."
        style="width:100%; padding:8px; box-sizing:border-box; margin-top:8px;"
      />

      <button
        onclick="comentarAlerta('${id}')"
        style="width:100%; margin-top:6px; padding:8px; border:none; border-radius:8px; background:#222; color:white;"
      >
        💬 Publicar comentario
      </button>
    `
    : `
      <button
        onclick="mostrarInfoLogin('comentar una alerta')"
        style="width:100%; margin-top:8px; padding:8px; border:none; border-radius:8px; background:#1976d2; color:white; font-weight:800;"
      >
        🔐 Entra con Google para comentar
      </button>
    `;

  const textoConfirmar = votoActual === "confirmar"
    ? "✓ Marcaste activa"
    : "✅ Sigue activo";

  const textoNegar = votoActual === "negativo"
    ? "✓ Marcaste ya pasó"
    : "⚠️ Ya pasó / falso";

  const miniBotonVoto = usuarioActual
    ? ""
    : `
      <button
        onclick="mostrarInfoLogin('votar una alerta')"
        style="padding:8px; border:none; border-radius:8px; background:#1976d2; color:white; font-weight:800;"
      >
        🔐
      </button>
    `;

  const bloqueVotos = usuarioActual && !esPremium()
    ? `
      <div class="votos-google">
        <button
          onclick="confirmarAlerta('${id}')"
          class="btn-voto-google btn-voto-activo"
        >
          ${textoConfirmar}
        </button>

        <button
          onclick="negarAlerta('${id}')"
          class="btn-voto-google btn-voto-paso"
        >
          ${textoNegar}
        </button>
      </div>
    `
    : `
      <div style="display:flex; gap:6px;">
        <button
          onclick="confirmarAlerta('${id}')"
          style="flex:1; padding:8px; border:none; border-radius:8px; background:#2e7d32; color:white;"
        >
          ${textoConfirmar}
        </button>

        ${miniBotonVoto}
      </div>

      <div style="display:flex; gap:6px; margin-top:6px;">
        <button
          onclick="negarAlerta('${id}')"
          style="flex:1; padding:8px; border:none; border-radius:8px; background:#d32f2f; color:white;"
        >
          ${textoNegar}
        </button>

        ${miniBotonVoto}
      </div>
    `;

  return `
    <div class="popup-alerta${clasePremiumPopup}${claseVistaUsuario}">
      <strong>${escaparHtml(alerta.tipo || "Alerta")}</strong><br>

      ${bloqueDetalle}

      <div class="creador-alerta${clasePremiumCreador}">
        ${
          alerta.creadoPorFoto
            ? `
              <img
                src="${escaparHtml(alerta.creadoPorFoto)}"
                alt="Usuario creador"
              >
            `
            : ""
        }

        <div class="creador-alerta-texto">
          <span class="creado-por-label">Creado por</span>
          <span class="creador-alerta-nombre">
            ${escaparHtml(alerta.creadoPorNombre || "Usuario")}
          </span>
        </div>

        ${etiquetaPremiumCreador}
      </div>

      <div style="margin:8px 0; padding:6px; border-radius:8px; background:${estado.color}; color:white;">
        ${estado.emoji} ${estado.texto}
      </div>

      <small>✅ Sigue activo: ${confirmaciones}</small><br>
      <small>⚠️ Ya pasó / falso: ${negativos}</small><br>
      <small>📍 A ${distanciaTexto} de ti</small><br>
      <small>
        ${
          esAlertaPermanente
            ? "📌 Alerta permanente"
            : `Se borra: ${vence ? vence.toLocaleTimeString() : "pronto"}`
        }
      </small>

      <hr>

      ${bloqueVotos}

      <hr>

      ${bloqueComentarios}

      ${bloqueComentar}

      ${bloqueEliminarAdmin}
    </div>
  `;
}

window.eliminarAlertaPermanente = function(id) {
  if (!esAdmin()) {
    alert("Solo un administrador puede eliminar esta alerta.");
    return;
  }

  const confirmar = confirm(
    "¿Eliminar esta alerta permanente?\n\nEsta acción no se puede deshacer."
  );

  if (!confirmar) return;

  db.collection("alertas").doc(id).delete()
    .then(() => {
      alert("Alerta eliminada correctamente.");
    })
    .catch((error) => {
      console.error("Error eliminando alerta:", error);
      alert("No se pudo eliminar la alerta.");
    });
};

async function registrarVotoUnico(id, tipoNuevo) {
  if (!usuarioActual) {
    window.mostrarInfoLogin("votar una alerta");
    return;
  }

  const referenciaAlerta = db.collection("alertas").doc(id);
  const referenciaVoto = referenciaAlerta
    .collection("votos")
    .doc(usuarioActual.uid);

  try {
    const resultado = await db.runTransaction(async (transaccion) => {
      const documentoAlerta = await transaccion.get(referenciaAlerta);
      const documentoVoto = await transaccion.get(referenciaVoto);

      if (!documentoAlerta.exists) {
        throw new Error("La alerta ya no existe.");
      }

      const datosAlerta = documentoAlerta.data();
      const confirmacionesActuales = datosAlerta.confirmaciones || 0;
      const negativosActuales = datosAlerta.negativos || 0;
      const tipoAnterior = documentoVoto.exists
        ? documentoVoto.data().tipo
        : null;

      if (tipoAnterior === tipoNuevo) {
        return "sin-cambios";
      }

      let nuevasConfirmaciones = confirmacionesActuales;
      let nuevosNegativos = negativosActuales;

      if (tipoNuevo === "confirmar") {
        nuevasConfirmaciones += 1;

        if (tipoAnterior === "negativo") {
          nuevosNegativos = Math.max(0, nuevosNegativos - 1);
        }
      } else {
        nuevosNegativos += 1;

        if (tipoAnterior === "confirmar") {
          nuevasConfirmaciones = Math.max(
            0,
            nuevasConfirmaciones - 1
          );
        }
      }

      transaccion.update(referenciaAlerta, {
        confirmaciones: nuevasConfirmaciones,
        negativos: nuevosNegativos
      });

      const datosVoto = {
        tipo: tipoNuevo,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      };

      if (!documentoVoto.exists) {
        datosVoto.createdAt =
          firebase.firestore.FieldValue.serverTimestamp();
      }

      transaccion.set(
        referenciaVoto,
        datosVoto,
        { merge: true }
      );

      return tipoAnterior ? "cambiado" : "nuevo";
    });

    const textoTipo = tipoNuevo === "confirmar"
      ? "sigue activa"
      : "ya pasó";

    if (resultado === "sin-cambios") {
      alert("Ya habías registrado este voto.");
    } else if (resultado === "cambiado") {
      alert(`Tu voto cambió a: ${textoTipo}.`);
    } else {
      alert(`Voto registrado: ${textoTipo}.`);
    }
  } catch (error) {
    console.error("Error registrando voto:", error);
    alert("No se pudo registrar el voto.");
  }
}

window.confirmarAlerta = function(id) {
  registrarVotoUnico(id, "confirmar");
};

window.negarAlerta = function(id) {
  registrarVotoUnico(id, "negativo");
};

window.comentarAlerta = async function(id) {
  if (!usuarioActual) {
    window.mostrarInfoLogin("comentar una alerta");
    return;
  }

  const input = document.getElementById(`comentario-${id}`);

  if (!input) return;

  const texto = input.value.trim();

  if (texto.length < 2) {
    alert("Escribe un comentario más claro.");
    return;
  }

  const referenciaAlerta = db.collection("alertas").doc(id);
  const referenciaComentario = referenciaAlerta
    .collection("comentarios")
    .doc();

  try {
    const lote = db.batch();

    lote.set(referenciaComentario, {
      texto: texto.slice(0, 280),
      creadoPorUid: usuarioActual.uid,
      creadoPorNombre: usuarioActual.displayName || "Usuario",
      creadoPorFoto: usuarioActual.photoURL || "",
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });

    lote.update(referenciaAlerta, {
      comentariosCount: firebase.firestore.FieldValue.increment(1)
    });

    await lote.commit();
    input.value = "";
  } catch (error) {
    console.error("Error agregando comentario:", error);
    alert("No se pudo agregar el comentario.");
  }
};

function refrescarPopupAlerta(id) {
  const alerta = alertasEnMemoria[id];
  const marcador = marcadoresAlertas[id];

  if (!alerta || !marcador) return;

  const campoComentario = document.getElementById(`comentario-${id}`);
  const estaEscribiendo =
    campoComentario && document.activeElement === campoComentario;

  if (!estaEscribiendo) {
    marcador.setPopupContent(crearPopupAlerta(id, alerta));
  }
}

function iniciarEscuchasDetalleAlerta(id) {
  if (!listenersComentariosPorAlerta[id]) {
    listenersComentariosPorAlerta[id] = db
      .collection("alertas")
      .doc(id)
      .collection("comentarios")
      .orderBy("createdAt", "desc")
      .limit(4)
      .onSnapshot(
        (snapshot) => {
          comentariosPorAlerta[id] = snapshot.docs.map((documento) => {
            const comentario = documento.data();

            return {
              id: documento.id,
              texto: comentario.texto || "",
              nombre: comentario.creadoPorNombre || "Usuario",
              foto: comentario.creadoPorFoto || "",
              hora: comentario.createdAt || null
            };
          });

          refrescarPopupAlerta(id);
        },
        (error) => {
          console.error("Error leyendo comentarios:", error);
          comentariosPorAlerta[id] = [];
          refrescarPopupAlerta(id);
        }
      );
  }

  if (usuarioActual && !listenersVotosPorAlerta[id]) {
    listenersVotosPorAlerta[id] = db
      .collection("alertas")
      .doc(id)
      .collection("votos")
      .doc(usuarioActual.uid)
      .onSnapshot(
        (documento) => {
          votosUsuarioPorAlerta[id] = documento.exists
            ? documento.data().tipo || null
            : null;

          refrescarPopupAlerta(id);
        },
        (error) => {
          console.error("Error leyendo voto actual:", error);
          votosUsuarioPorAlerta[id] = null;
          refrescarPopupAlerta(id);
        }
      );
  }
}

function detenerEscuchasDetalleAlerta(id) {
  if (listenersComentariosPorAlerta[id]) {
    listenersComentariosPorAlerta[id]();
    delete listenersComentariosPorAlerta[id];
  }

  if (listenersVotosPorAlerta[id]) {
    listenersVotosPorAlerta[id]();
    delete listenersVotosPorAlerta[id];
  }

  delete votosUsuarioPorAlerta[id];
}


function actualizarUbicacionUsuario(posicion) {
  const lat = posicion.coords.latitude;
  const lng = posicion.coords.longitude;
  const nuevaUbicacion = [lat, lng];

  const ubicacionNueva = L.latLng(lat, lng);

  let distanciaMovimiento = 0;

 if (ubicacionUsuarioActual) {
  distanciaMovimiento = ubicacionUsuarioActual.distanceTo(ubicacionNueva);

  /* Evita que pequeños saltos del GPS hagan girar el auto raro */
  if (distanciaMovimiento >= 3) {
    anguloAuto = calcularAnguloDireccion(
      ubicacionUsuarioActual,
      ubicacionNueva
    );
  }
}

ubicacionUsuarioActual = ubicacionNueva;
actualizarMarcadoresPorRango();

  ubicacionUsuarioActual = ubicacionNueva;
  actualizarMarcadoresPorRango();

  if (!marcadorUsuario) {
   marcadorUsuario = L.marker(nuevaUbicacion, {
  icon: crearIconoAuto(anguloAuto)
})
      .addTo(map)
      .bindPopup('Tu ubicación');

    map.setView(nuevaUbicacion, 15);
  } else {
    marcadorUsuario.setLatLng(nuevaUbicacion);
    marcadorUsuario.setIcon(crearIconoAuto(anguloAuto));

    if (siguiendoUsuario || distanciaMovimiento > 20) {
      siguiendoUsuario = true;
      map.panTo(nuevaUbicacion);
    }
  }
}

map.on('dragstart zoomstart', function() {
  siguiendoUsuario = false;

  clearTimeout(temporizadorReencuadre);

  temporizadorReencuadre = setTimeout(() => {
    siguiendoUsuario = true;

    if (marcadorUsuario) {
      const ubicacionActual = marcadorUsuario.getLatLng();
      map.setView(ubicacionActual, 15);
    }
  }, 30000);
});

function errorUbicacion() {
  console.log('No se pudo obtener la ubicación del usuario.');
}

navigator.geolocation.watchPosition(
  actualizarUbicacionUsuario,
  errorUbicacion,
  {
    enableHighAccuracy: true,
    maximumAge: 0,
    timeout: 10000
  }
);

map.on('click', function(e) {
  ubicacionSeleccionada = e.latlng;

  if (marcadorSeleccion) {
    marcadorSeleccion.setLatLng(e.latlng);
  } else {
    marcadorSeleccion = L.marker(e.latlng)
      .addTo(map)
      .bindPopup('Punto seleccionado para alerta');
  }

  marcadorSeleccion.openPopup();
});

function configurarFormularioAlertaSegunPermiso() {
  const tipo = document.getElementById('tipo');
  const descripcion = document.getElementById('descripcion');

    const opcionPermanente = document.getElementById('opcion-alerta-permanente');
  const alertaPermanente = document.getElementById('alerta-permanente');

  if (esAdmin()) {
    opcionPermanente.classList.remove('oculto');
  } else {
    opcionPermanente.classList.add('oculto');
    alertaPermanente.checked = false;
  }

  let filaPremium = document.getElementById('fila-detalle-premium');

  if (!filaPremium) {
    filaPremium = document.createElement('div');
    filaPremium.id = 'fila-detalle-premium';

    filaPremium.innerHTML = `
      <span style="font-size:12px; color:#666;">
        🔒 Detalle completo
      </span>

      <button
        id="btn-detalle-premium"
        type="button"
        style="
          margin-left:auto;
          border:none;
          border-radius:8px;
          padding:6px 9px;
          background:#ffb300;
          color:#111;
          font-weight:800;
          cursor:pointer;
        "
      >
        ⭐ Premium
      </button>
    `;

    descripcion.insertAdjacentElement('afterend', filaPremium);

    document.getElementById('btn-detalle-premium').addEventListener('click', function() {
      alert('Agregar detalles a una alerta es una función Premium.');
    });
  }

  if (esPremium()) {
    Array.from(tipo.options).forEach((opcion) => {
      opcion.hidden = false;
      opcion.disabled = false;
    });

    descripcion.value = '';
    descripcion.readOnly = false;
    descripcion.disabled = false;
    descripcion.placeholder = 'Describe brevemente qué está pasando...';
    descripcion.style.display = 'block';
    descripcion.style.background = '';
    descripcion.style.cursor = '';
    descripcion.style.opacity = '';
    descripcion.onfocus = null;

    filaPremium.style.display = 'none';
    return;
  }

  Array.from(tipo.options).forEach((opcion) => {
    const esAtunes = opcion.value === 'Atunes';

    opcion.hidden = !esAtunes;
    opcion.disabled = !esAtunes;
  });

  tipo.value = 'Atunes';

  descripcion.value = '';
  descripcion.disabled = false;
  descripcion.readOnly = true;
  descripcion.placeholder = '🔒 Detalle completo disponible con Premium';
  descripcion.style.display = 'block';
  descripcion.style.background = '#f1f3f5';
  descripcion.style.cursor = 'pointer';
  descripcion.style.opacity = '0.9';

  descripcion.onfocus = function() {
    this.blur();
    alert('Agregar detalles a una alerta es una función Premium.');
  };

  filaPremium.style.display = 'flex';
  filaPremium.style.alignItems = 'center';
  filaPremium.style.gap = '8px';
  filaPremium.style.marginTop = '6px';
}

document.getElementById('btn-alerta').addEventListener('click', function() {
  if (!usuarioActual) {
    alert('Debes iniciar sesión con Google para crear una alerta.');
    return;
  }

  configurarFormularioAlertaSegunPermiso();

  document.getElementById('panel-alerta').classList.remove('oculto');
});

document.getElementById('cerrar').addEventListener('click', function() {
  document.getElementById('panel-alerta').classList.add('oculto');
});

document.getElementById('btn-login-google').addEventListener('click', function() {
  auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL)
    .then(() => {
      return auth.signInWithPopup(providerGoogle);
    })
    .then((resultado) => {
      if (resultado && resultado.user) {
        crearOActualizarUsuario(resultado.user);
      }
    })
    .catch((error) => {
      console.error("Error iniciando sesión con popup:", error);
      alert("No se pudo iniciar sesión con Google.");
    });
});

auth.getRedirectResult()
  .then((resultado) => {
    if (resultado.user) {
      crearOActualizarUsuario(resultado.user);
      console.log("Login con Google completado por redirect");
    }
  })
  .catch((error) => {
    console.error("Error en redirect Google:", error);
    alert("No se pudo iniciar sesión con Google.");
  });

document.getElementById('btn-logout').addEventListener('click', function() {
  auth.signOut()
    .then(() => {
      console.log("Sesión cerrada");
    })
    .catch((error) => {
      console.error("Error cerrando sesión:", error);
    });
});

function crearOActualizarUsuario(usuario) {
  if (!usuario) return;

  const referenciaUsuario = db.collection("usuarios").doc(usuario.uid);

  referenciaUsuario.get().then((doc) => {
    if (!doc.exists) {
      referenciaUsuario.set({
        nombre: usuario.displayName || "",
        email: usuario.email || "",
        foto: usuario.photoURL || "",
        premium: false,
        rol: "usuario",
        estado: "activo",
        vencePremium: null,
        creado: firebase.firestore.FieldValue.serverTimestamp()
      });
    } else {
      referenciaUsuario.update({
        nombre: usuario.displayName || "",
        email: usuario.email || "",
        foto: usuario.photoURL || ""
      });
    }
  });
}

auth.onAuthStateChanged(function(usuario) {
  const btnLogin = document.getElementById('btn-login-google');
  const usuarioInfo = document.getElementById('usuario-info');
  const usuarioFoto = document.getElementById('usuario-foto');
  const usuarioNombre = document.getElementById('usuario-nombre');

  if (usuario) {
    usuarioActual = usuario;
    perfilUsuario = null;
actualizarMarcadoresPorRango();

    crearOActualizarUsuario(usuario);

    db.collection("usuarios").doc(usuario.uid).get()
      .then((doc) => {
  if (doc.exists) {
    perfilUsuario = doc.data();
    console.log("Perfil cargado:", perfilUsuario);
  } else {
    perfilUsuario = {
      premium: false,
      colorAuto: "rojo",
      rol: "usuario",
      estado: "activo"
    };
  }

  actualizarMarcadoresPorRango();
  actualizarEstiloPremiumUsuario();
  actualizarIconoAuto();
});

    btnLogin.classList.add('oculto');
    usuarioInfo.classList.remove('oculto');

    usuarioFoto.src = usuario.photoURL || "";
    usuarioNombre.textContent = usuario.displayName || "Usuario";
  } else {
    usuarioActual = null;
    perfilUsuario = null;
    actualizarMarcadoresPorRango();
    actualizarEstiloPremiumUsuario();

    btnLogin.classList.remove('oculto');
    usuarioInfo.classList.add('oculto');

    usuarioFoto.src = "";
    usuarioNombre.textContent = "";
  }
});

document.getElementById('btn-centrar').addEventListener('click', function() {
  siguiendoUsuario = true;

  if (marcadorUsuario) {
    const ubicacionActual = marcadorUsuario.getLatLng();
    map.setView(ubicacionActual, 15);
  } else {
    alert('Todavía no se detectó tu ubicación.');
  }
});

document.getElementById('publicar').addEventListener('click', function() {
  const tipo = document.getElementById('tipo').value;
  const descripcion = document.getElementById('descripcion').value.trim();

  if (!ubicacionSeleccionada) {
    alert('Primero toca el mapa donde ocurrió la alerta.');
    return;
  }

 if (esPremium() && descripcion.length < 5) {
  alert('Escribe una descripción un poco más clara.');
  return;
}

  const latAlerta = ubicacionSeleccionada.lat;
  const lngAlerta = ubicacionSeleccionada.lng;

  const ahora = new Date();
  const vence = new Date(ahora.getTime() + 2 * 60 * 60 * 1000);
  const alertaPermanente =
  esAdmin() &&
  document.getElementById('alerta-permanente').checked;

  db.collection("alertas").add({
  tipo: tipo,
 descripcion: esPremium() ? descripcion : "Alerta rápida",
  lat: latAlerta,
  lng: lngAlerta,
  createdAt: firebase.firestore.FieldValue.serverTimestamp(),
  expiresAt: alertaPermanente ? null : vence,
permanente: alertaPermanente,
  comentariosCount: 0,
  confirmaciones: 0,
  negativos: 0,

  creadoPorUid: usuarioActual ? usuarioActual.uid : null,
  creadoPorNombre: usuarioActual ? usuarioActual.displayName : "Usuario",
  creadoPorFoto: usuarioActual ? usuarioActual.photoURL : "",
creadorPremium: esPremium(),
creadoPorAdmin: esAdmin()
})

  .then(() => {
    console.log("Alerta guardada en Firebase");

    document.getElementById('descripcion').value = '';
    document.getElementById('alerta-permanente').checked = false;
    document.getElementById('panel-alerta').classList.add('oculto');

    if (marcadorSeleccion) {
      map.removeLayer(marcadorSeleccion);
      marcadorSeleccion = null;
    }

    ubicacionSeleccionada = null;
  })
  .catch((error) => {
    console.error("Error guardando alerta:", error);
    alert("No se pudo guardar la alerta.");
  });
});

function obtenerLimiteRangoAlertas() {
  if (esPremium()) {
    return Infinity;
  }

  if (usuarioActual) {
    return 5000;
  }

  return 2000;
}

function quitarMarcadorAlerta(id) {
  if (alertaPopupAbiertaId === id) {
    alertaPopupAbiertaId = null;
    detenerEscuchasDetalleAlerta(id);
  }

  if (marcadoresAlertas[id]) {
    map.removeLayer(marcadoresAlertas[id]);
    delete marcadoresAlertas[id];
  }
}

function alertaEstaDentroDelRango(alerta) {
  if (!ubicacionUsuarioActual) {
    return false;
  }

  if (esPremium()) {
    return true;
  }

  const distancia = calcularDistanciaMetros(
    ubicacionUsuarioActual.lat,
    ubicacionUsuarioActual.lng,
    alerta.lat,
    alerta.lng
  );

  return distancia <= obtenerLimiteRangoAlertas();
}

function actualizarMarcadoresPorRango() {
  Object.entries(alertasEnMemoria).forEach(([id, alerta]) => {
    dibujarAlerta(id, alerta);
  });
}

function dibujarAlerta(id, alerta) {
  if (typeof alerta.lat !== "number" || typeof alerta.lng !== "number") {
    quitarMarcadorAlerta(id);
    return;
  }

  const vence = obtenerFechaVencimiento(alerta);
  const esAlertaPermanente = alerta.permanente === true;

  if (vence && vence <= new Date()) {
    quitarMarcadorAlerta(id);
    return;
  }

  if (!alertaEstaDentroDelRango(alerta)) {
    quitarMarcadorAlerta(id);
    return;
  }

  const confirmaciones = alerta.confirmaciones || 0;
  const negativos = alerta.negativos || 0;
  const icono = crearIconoAlerta(alerta.tipo, confirmaciones, negativos);

  if (marcadoresAlertas[id]) {
  marcadoresAlertas[id].setIcon(icono);

  const campoComentario = document.getElementById(`comentario-${id}`);
  const estaEscribiendo =
    campoComentario && document.activeElement === campoComentario;

  if (!estaEscribiendo) {
    marcadoresAlertas[id].setPopupContent(crearPopupAlerta(id, alerta));
  }

  return;
}

  const marcador = L.marker([alerta.lat, alerta.lng], { icon: icono })
    .addTo(map)
    .bindPopup(crearPopupAlerta(id, alerta));

  marcador.on("popupopen", () => {
    alertaPopupAbiertaId = id;
    iniciarEscuchasDetalleAlerta(id);
  });

  marcador.on("popupclose", () => {
    if (alertaPopupAbiertaId === id) {
      alertaPopupAbiertaId = null;
    }

    detenerEscuchasDetalleAlerta(id);
  });

  marcadoresAlertas[id] = marcador;

  if (vence) {
    const tiempoRestante = vence.getTime() - Date.now();

    setTimeout(() => {
      if (marcadoresAlertas[id]) {
        map.removeLayer(marcadoresAlertas[id]);
        delete marcadoresAlertas[id];
      }
    }, tiempoRestante);
  }
}

db.collection("alertas").onSnapshot((snapshot) => {
  snapshot.docChanges().forEach((change) => {
    const id = change.doc.id;

    if (change.type === "removed") {
      delete alertasEnMemoria[id];
      quitarMarcadorAlerta(id);
      return;
    }

    const alerta = change.doc.data();

    alertasEnMemoria[id] = alerta;
    dibujarAlerta(id, alerta);
  });
});


let wakeLock = null;

async function activarPantallaSiempreEncendida() {
  try {
    if ('wakeLock' in navigator) {
      wakeLock = await navigator.wakeLock.request('screen');
      console.log('Pantalla siempre encendida activada');
    }
  } catch (error) {
    console.log('No se pudo activar pantalla siempre encendida:', error);
  }
}

document.addEventListener('visibilitychange', async () => {
  if (wakeLock !== null && document.visibilityState === 'visible') {
    await activarPantallaSiempreEncendida();
  }
});

activarPantallaSiempreEncendida();

/* =========================================
   MENÚ DE USUARIO Y PLANES
   ========================================= */

const btnMenuUsuario = document.getElementById("btn-menu-usuario");
const btnMenuVisitante = document.getElementById("btn-menu-visitante");
const overlayMenu = document.getElementById("overlay-menu");
const menuUsuarioPanel = document.getElementById("menu-usuario-panel");
const panelPlanes = document.getElementById("panel-planes");
const btnCerrarMenu = document.getElementById("btn-cerrar-menu");
const btnMenuPlanes = document.getElementById("btn-menu-planes");
const btnVolverMenu = document.getElementById("btn-volver-menu");
const btnCerrarPlanes = document.getElementById("btn-cerrar-planes");
const btnActivarPremium = document.getElementById("btn-activar-premium");

const selectorColorAuto = document.getElementById("selector-color-auto");
const estadoColorAuto = document.getElementById("estado-color-auto");
const textoColorAuto = document.getElementById("texto-color-auto");
const botonesColorAuto = document.querySelectorAll(".boton-color-auto");

function actualizarSelectorColorAuto() {
  if (!selectorColorAuto) return;

  const puedeCambiarColor = !!usuarioActual && esPremium();
  const colorActual = obtenerColorAutoActual();

  selectorColorAuto.classList.toggle(
    "selector-color-auto-bloqueado",
    !puedeCambiarColor
  );

  botonesColorAuto.forEach((boton) => {
    const colorBoton = boton.dataset.color;
    const estaSeleccionado = puedeCambiarColor && colorBoton === colorActual;

    boton.classList.toggle("seleccionado", estaSeleccionado);
    boton.setAttribute("aria-pressed", estaSeleccionado ? "true" : "false");
  });

  if (puedeCambiarColor) {
    estadoColorAuto.textContent = "⭐ PREMIUM";
    textoColorAuto.textContent =
      `Color actual: ${nombresColorAuto[colorActual] || "Rojo"}`;
  } else {
    estadoColorAuto.textContent = "🔒 Premium";
    textoColorAuto.textContent =
      "Personaliza tu auto GPS con Premium";
  }
}

botonesColorAuto.forEach((boton) => {
  boton.addEventListener("click", function() {
    const colorElegido = this.dataset.color;

    if (!usuarioActual) {
      mostrarInfoLogin("cambiar el color de tu auto");
      return;
    }

    if (!esPremium()) {
      mostrarInfoPremium("Cambiar el color de tu auto GPS");
      return;
    }

    if (!autosPorColor[colorElegido]) return;

    db.collection("usuarios").doc(usuarioActual.uid).set(
      {
        colorAuto: colorElegido
      },
      { merge: true }
    )
    .then(() => {
      perfilUsuario = {
        ...perfilUsuario,
        colorAuto: colorElegido
      };

      actualizarIconoAuto();
      actualizarSelectorColorAuto();
    })
    .catch((error) => {
      console.error("Error guardando color del auto:", error);
      alert("No se pudo guardar el color del auto.");
    });
  });
});

function cerrarPanelesCuenta() {
  overlayMenu.classList.add("oculto");
  menuUsuarioPanel.classList.add("oculto");
  panelPlanes.classList.add("oculto");

  menuUsuarioPanel.setAttribute("aria-hidden", "true");
  panelPlanes.setAttribute("aria-hidden", "true");

  btnMenuUsuario.setAttribute("aria-expanded", "false");
}

function abrirMenuUsuario() {
      actualizarSelectorColorAuto();

  overlayMenu.classList.remove("oculto");
  panelPlanes.classList.add("oculto");
  menuUsuarioPanel.classList.remove("oculto");

  panelPlanes.setAttribute("aria-hidden", "true");
  menuUsuarioPanel.setAttribute("aria-hidden", "false");

  btnMenuUsuario.setAttribute("aria-expanded", "true");
}

function abrirPanelPlanes() {
  overlayMenu.classList.remove("oculto");
  menuUsuarioPanel.classList.add("oculto");
  panelPlanes.classList.remove("oculto");

  menuUsuarioPanel.setAttribute("aria-hidden", "true");
  panelPlanes.setAttribute("aria-hidden", "false");
}

btnMenuUsuario.addEventListener("click", abrirMenuUsuario);
btnMenuVisitante.addEventListener("click", abrirMenuUsuario);

btnCerrarMenu.addEventListener("click", cerrarPanelesCuenta);
btnCerrarPlanes.addEventListener("click", cerrarPanelesCuenta);

overlayMenu.addEventListener("click", cerrarPanelesCuenta);

btnMenuPlanes.addEventListener("click", abrirPanelPlanes);

btnVolverMenu.addEventListener("click", abrirMenuUsuario);

btnActivarPremium.addEventListener("click", function() {
  if (!usuarioActual) {
    alert("Inicia sesión con Google para solicitar Premium.");
    return;
  }

  if (esPremium()) {
    alert("Tu cuenta ya tiene Premium activo.");
    return;
  }

  const nombre = usuarioActual.displayName || "Usuario";
  const correo = usuarioActual.email || "No disponible";

  const mensaje = [
    "Hola, quiero solicitar Alerta Lima Premium.",
    "",
    `Nombre: ${nombre}`,
    `Correo de mi cuenta: ${correo}`,
    "",
    "Me interesa activar el plan Premium.",
   "Opciones: S/4.99 mensual o S/29.90 anual (50% OFF)."
  ].join("\n");

  const urlWhatsApp =
    `https://wa.me/51978206205?text=${encodeURIComponent(mensaje)}`;

  window.location.href = urlWhatsApp;
});

document.getElementById("btn-logout").addEventListener("click", cerrarPanelesCuenta);

document.addEventListener("keydown", function(evento) {
  if (evento.key === "Escape") {
    cerrarPanelesCuenta();
  }
});