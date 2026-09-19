import type { Page, Locator } from 'playwright';
import { sleep, uglyRandom } from '../utils/delay.js';

export interface Point {
  x: number;
  y: number;
}

export class HumanInput {
  /**
   * Mueve el mouse siguiendo una curva suave de Bézier cúbica con fluctuaciones de velocidad
   */
  async moveMouse(page: Page, target: Point): Promise<void> {
    const steps = Math.floor(uglyRandom(15, 30));
    // Punto de origen aproximado o central si no se conoce
    const start: Point = { x: uglyRandom(200, 600), y: uglyRandom(200, 500) };

    // Puntos de control intermedios para generar la curva orgánica
    const cp1: Point = {
      x: start.x + (target.x - start.x) * uglyRandom(0.2, 0.4) + uglyRandom(-40, 40),
      y: start.y + (target.y - start.y) * uglyRandom(0.1, 0.3) + uglyRandom(-40, 40),
    };
    const cp2: Point = {
      x: start.x + (target.x - start.x) * uglyRandom(0.6, 0.8) + uglyRandom(-30, 30),
      y: start.y + (target.y - start.y) * uglyRandom(0.7, 0.9) + uglyRandom(-30, 30),
    };

    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      // Fórmula de Bézier cúbica: (1-t)^3*P0 + 3(1-t)^2*t*P1 + 3(1-t)*t^2*P2 + t^3*P3
      const x =
        Math.pow(1 - t, 3) * start.x +
        3 * Math.pow(1 - t, 2) * t * cp1.x +
        3 * (1 - t) * Math.pow(t, 2) * cp2.x +
        Math.pow(t, 3) * target.x;

      const y =
        Math.pow(1 - t, 3) * start.y +
        3 * Math.pow(1 - t, 2) * t * cp1.y +
        3 * (1 - t) * Math.pow(t, 2) * cp2.y +
        Math.pow(t, 3) * target.y;

      await page.mouse.move(x, y);
      await sleep(uglyRandom(8, 22));
    }
  }

  /**
   * Realiza un scroll suave fraccionado con velocidad no constante
   */
  async smoothScroll(page: Page, direction: 'up' | 'down', totalPixels: number): Promise<void> {
    const sign = direction === 'down' ? 1 : -1;
    let scrolled = 0;

    while (scrolled < totalPixels) {
      const chunk = Math.min(uglyRandom(60, 160), totalPixels - scrolled);
      await page.mouse.wheel(0, chunk * sign);
      scrolled += chunk;
      await sleep(uglyRandom(25, 65));
    }
  }

  /**
   * Simula un scroll exploratorio por una página (baja un poco, pausa, sube, mira)
   */
  async browseScroll(page: Page, durationMs: number): Promise<void> {
    const endTime = Date.now() + durationMs;

    while (Date.now() < endTime) {
      const scrollDown = Math.random() > 0.3;
      const amount = uglyRandom(200, 600);

      await this.smoothScroll(page, scrollDown ? 'down' : 'up', amount);
      // Pausa como si estuviera leyendo o mirando portadas
      await sleep(uglyRandom(1200, 3400));
    }
  }

  /**
   * Hace click en un elemento moviendo previamente el mouse con offset aleatorio
   */
  async humanClick(page: Page, locator: Locator): Promise<void> {
    const box = await locator.boundingBox();
    if (box) {
      // Offset aleatorio para no clickear siempre el centro exacto del elemento
      const targetPoint: Point = {
        x: box.x + box.width * uglyRandom(0.25, 0.75),
        y: box.y + box.height * uglyRandom(0.25, 0.75),
      };

      await this.moveMouse(page, targetPoint);
      await sleep(uglyRandom(150, 450));
      await page.mouse.click(targetPoint.x, targetPoint.y);
    } else {
      await locator.click();
    }
  }

  /**
   * Escribe texto simulando pulsaciones con cadencia humana
   */
  async humanType(page: Page, selector: string, text: string): Promise<void> {
    await page.click(selector);
    for (const char of text) {
      await page.keyboard.type(char);
      await sleep(uglyRandom(60, 190));
    }
  }
}
