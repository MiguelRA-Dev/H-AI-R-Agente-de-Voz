import { describe, test, expect } from "@jest/globals";
import {
  MARGEN_TURNOS_EXTRA,
  UMBRAL_APROBACION,
  MARCA_PREGUNTA_INICIO,
  MARCA_PREGUNTA_FIN,
  debeForzarCierre,
  esUltimaPreguntaPlaneada,
  construirMensajeConNota,
  extraerCierre,
  extraerPregunta,
  calcularAprobado,
  construirAlertas,
  calcularPuntajeGlobal,
} from "./entrevistaLogica.js";

describe("debeForzarCierre", () => {
  const total = 10;

  test("no fuerza el cierre mientras quedan preguntas planeadas", () => {
    expect(debeForzarCierre(1, total)).toBe(false);
    expect(debeForzarCierre(total, total)).toBe(false);
  });

  test("no fuerza el cierre dentro del margen de seguridad", () => {
    expect(debeForzarCierre(total + MARGEN_TURNOS_EXTRA, total)).toBe(false);
  });

  test("fuerza el cierre justo al pasar el margen de seguridad", () => {
    expect(debeForzarCierre(total + MARGEN_TURNOS_EXTRA + 1, total)).toBe(true);
  });

  test("respeta un margen custom si se pasa explícito", () => {
    expect(debeForzarCierre(total + 1, total, 0)).toBe(true);
    expect(debeForzarCierre(total, total, 0)).toBe(false);
  });
});

describe("esUltimaPreguntaPlaneada / construirMensajeConNota", () => {
  const total = 5;

  test("no agrega nota antes de la última pregunta", () => {
    expect(esUltimaPreguntaPlaneada(total - 1, total)).toBe(false);
    expect(construirMensajeConNota("hola", total - 1, total)).toBe("hola");
  });

  test("agrega la nota interna justo en la última pregunta planeada", () => {
    expect(esUltimaPreguntaPlaneada(total, total)).toBe(true);
    const mensaje = construirMensajeConNota("mi respuesta", total, total);
    expect(mensaje).toContain("mi respuesta");
    expect(mensaje).toContain("Nota interna");
    expect(mensaje).toContain("cierra la entrevista ahora mismo");
  });

  test("sigue agregando la nota si ya se pasó de la última pregunta (reintentos)", () => {
    expect(construirMensajeConNota("otra", total + 1, total)).toContain("Nota interna");
  });
});

describe("extraerCierre", () => {
  const MARCA = "[FIN_DE_PRUEBA]";

  test("no marca finalizada si el texto no trae la marca", () => {
    const resultado = extraerCierre("Cuéntame más sobre tu experiencia.", MARCA);
    expect(resultado).toEqual({ texto: "Cuéntame más sobre tu experiencia.", finalizada: false });
  });

  test("detecta la marca, la quita del texto y recorta espacios", () => {
    const resultado = extraerCierre(`Gracias por tu tiempo.  ${MARCA}`, MARCA);
    expect(resultado.finalizada).toBe(true);
    expect(resultado.texto).toBe("Gracias por tu tiempo.");
    expect(resultado.texto).not.toContain(MARCA);
  });

  test("funciona si la marca aparece en medio del texto", () => {
    const resultado = extraerCierre(`Antes ${MARCA} después`, MARCA);
    expect(resultado.finalizada).toBe(true);
    expect(resultado.texto).toBe("Antes  después");
  });
});

describe("extraerPregunta", () => {
  test("extrae la pregunta del bloque final y lo quita por completo del texto hablado", () => {
    const texto =
      "Qué interesante tu experiencia ahí. Cuéntame de una vez en la que tuviste que resolver un " +
      "problema bajo presión.\n" +
      `${MARCA_PREGUNTA_INICIO}Cuéntame de una vez en la que tuviste que resolver un problema bajo ` +
      `presión.${MARCA_PREGUNTA_FIN}`;
    const resultado = extraerPregunta(texto, MARCA_PREGUNTA_INICIO, MARCA_PREGUNTA_FIN);
    expect(resultado.pregunta).toBe("Cuéntame de una vez en la que tuviste que resolver un problema bajo presión.");
    expect(resultado.texto).toBe(
      "Qué interesante tu experiencia ahí. Cuéntame de una vez en la que tuviste que resolver un problema bajo presión."
    );
    expect(resultado.texto).not.toContain(MARCA_PREGUNTA_INICIO);
    expect(resultado.texto).not.toContain(MARCA_PREGUNTA_FIN);
  });

  test("pregunta vacía y texto intacto si el modelo no agregó el bloque (ej. el cierre)", () => {
    const resultado = extraerPregunta(
      "Gracias por tu tiempo y por tus respuestas.",
      MARCA_PREGUNTA_INICIO,
      MARCA_PREGUNTA_FIN
    );
    expect(resultado).toEqual({ texto: "Gracias por tu tiempo y por tus respuestas.", pregunta: "" });
  });

  test("si se truncó a mitad del bloque, corta ahí y no deja la marca de apertura filtrándose", () => {
    const resultado = extraerPregunta(
      `Respuesta normal. ${MARCA_PREGUNTA_INICIO}pregunta que se corta a la mitad`,
      MARCA_PREGUNTA_INICIO,
      MARCA_PREGUNTA_FIN
    );
    expect(resultado).toEqual({ texto: "Respuesta normal.", pregunta: "" });
  });

  test("pregunta vacía si las marcas están en el orden equivocado", () => {
    const resultado = extraerPregunta(
      `${MARCA_PREGUNTA_FIN} al revés ${MARCA_PREGUNTA_INICIO}`,
      MARCA_PREGUNTA_INICIO,
      MARCA_PREGUNTA_FIN
    );
    expect(resultado.pregunta).toBe("");
  });
});

describe("calcularAprobado", () => {
  test("usa el umbral fijo de 70 por defecto", () => {
    expect(UMBRAL_APROBACION).toBe(70);
  });

  test("aprueba justo en el umbral y por encima", () => {
    expect(calcularAprobado(70)).toBe(true);
    expect(calcularAprobado(100)).toBe(true);
  });

  test("no aprueba justo debajo del umbral ni en 0", () => {
    expect(calcularAprobado(69)).toBe(false);
    expect(calcularAprobado(0)).toBe(false);
  });

  test("mismo puntaje da el mismo resultado sin importar cuántas veces se llame", () => {
    // La garantía central del fix: el criterio no depende de qué tan generoso
    // haya estado Gemini en una evaluación puntual, siempre es el mismo umbral.
    expect(calcularAprobado(55)).toBe(calcularAprobado(55));
    expect(calcularAprobado(55)).toBe(false);
  });

  test("respeta un umbral custom si se pasa explícito", () => {
    expect(calcularAprobado(60, 60)).toBe(true);
    expect(calcularAprobado(59, 60)).toBe(false);
  });
});

describe("construirAlertas", () => {
  test("arma el objeto con las dos señales cuando ambas están presentes", () => {
    expect(construirAlertas(3, true, "Repitió lo mismo al repreguntar sobre Docker.")).toEqual({
      cambiosPantalla: 3,
      posibleUsoIA: true,
      justificacionUsoIA: "Repitió lo mismo al repreguntar sobre Docker.",
    });
  });

  test("normaliza valores ausentes/undefined a los defaults seguros", () => {
    expect(construirAlertas(undefined, undefined, undefined)).toEqual({
      cambiosPantalla: 0,
      posibleUsoIA: false,
      justificacionUsoIA: "",
    });
  });

  test("nunca devuelve un número negativo o inválido en cambiosPantalla", () => {
    expect(construirAlertas(NaN, false, "").cambiosPantalla).toBe(0);
    expect(construirAlertas("no-es-numero", false, "").cambiosPantalla).toBe(0);
  });
});

describe("calcularPuntajeGlobal", () => {
  test("promedia los 4 ejes de competencia y redondea", () => {
    expect(
      calcularPuntajeGlobal({
        conocimientoTecnico: 80,
        comunicacion: 70,
        resolucionProblemas: 90,
        fitRol: 60,
      })
    ).toBe(75);
  });

  test("redondea hacia el entero más cercano", () => {
    expect(
      calcularPuntajeGlobal({ conocimientoTecnico: 70, comunicacion: 70, resolucionProblemas: 70, fitRol: 71 })
    ).toBe(70);
    expect(
      calcularPuntajeGlobal({ conocimientoTecnico: 70, comunicacion: 70, resolucionProblemas: 70, fitRol: 72 })
    ).toBe(71);
  });

  test("devuelve 0 si no hay competencias", () => {
    expect(calcularPuntajeGlobal({})).toBe(0);
    expect(calcularPuntajeGlobal(undefined)).toBe(0);
  });

  test("mismo objeto de competencias siempre da el mismo puntaje", () => {
    const competencias = { conocimientoTecnico: 55, comunicacion: 65, resolucionProblemas: 45, fitRol: 75 };
    expect(calcularPuntajeGlobal(competencias)).toBe(calcularPuntajeGlobal(competencias));
  });
});
