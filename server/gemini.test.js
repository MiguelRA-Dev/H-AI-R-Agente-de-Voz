import { describe, test, expect } from "@jest/globals";
import { normalizarPlan, PREGUNTA_INTRO } from "./gemini.js";

function preguntasDePrueba(cantidad) {
  return Array.from({ length: cantidad }, (_, i) => ({
    tema: `Tema ${i + 1}`,
    pregunta: `Pregunta técnica ${i + 1}`,
  }));
}

describe("normalizarPlan", () => {
  test("antepone la pregunta de presentación personal como la primera", () => {
    const { preguntas } = normalizarPlan(preguntasDePrueba(5));
    expect(preguntas[0]).toBe(PREGUNTA_INTRO);
    expect(preguntas[0].tema).toBe("Presentación personal");
  });

  test("totalPreguntas cuenta la intro más las técnicas", () => {
    const { preguntas, totalPreguntas } = normalizarPlan(preguntasDePrueba(5));
    expect(totalPreguntas).toBe(6);
    expect(preguntas).toHaveLength(6);
  });

  test("recorta a máximo 20 preguntas técnicas antes de anteponer la intro", () => {
    const { preguntas, totalPreguntas } = normalizarPlan(preguntasDePrueba(30));
    // 20 técnicas + 1 de presentación
    expect(totalPreguntas).toBe(21);
    expect(preguntas).toHaveLength(21);
    expect(preguntas[1].tema).toBe("Tema 1");
    expect(preguntas[20].tema).toBe("Tema 20");
  });

  test("mantiene el orden original de las preguntas técnicas después de la intro", () => {
    const { preguntas } = normalizarPlan(preguntasDePrueba(3));
    expect(preguntas.slice(1)).toEqual(preguntasDePrueba(3));
  });

  test("con idioma 'en' antepone la intro en inglés, no la de español", () => {
    const { preguntas } = normalizarPlan(preguntasDePrueba(3), "en");
    expect(preguntas[0]).not.toBe(PREGUNTA_INTRO);
    expect(preguntas[0].tema).toBe("Personal introduction");
  });

  test("un idioma desconocido cae de vuelta a la intro en español", () => {
    const { preguntas } = normalizarPlan(preguntasDePrueba(3), "fr");
    expect(preguntas[0]).toBe(PREGUNTA_INTRO);
  });
});
