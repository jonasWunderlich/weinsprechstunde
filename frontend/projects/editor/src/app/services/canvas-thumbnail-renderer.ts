import { Injectable } from '@angular/core';
import { ThumbnailRenderer, Thumbnail } from './file-system-access.service';

type CanvasLike = {
  width: number;
  height: number;
  getContext(
    id: '2d',
  ): { drawImage(image: ImageBitmap, dx: number, dy: number, dw: number, dh: number): void } | null;
};

/**
 * Default-Thumbnail-Renderer (Req 17.33): dekodiert das Originalbild über
 * `createImageBitmap` und zeichnet es seitenverhältniserhaltend verkleinert auf
 * ein `OffscreenCanvas` (falls verfügbar) bzw. ein `<canvas>`. Das Original wird
 * nie verändert (nur gelesen).
 *
 * In Tests (jsdom) fehlen `createImageBitmap`/Canvas; dort wird dieser Renderer
 * durch einen Fake ersetzt, der das Original unangetastet lässt und ein
 * verkleinertes Ergebnis mit erhaltenem Seitenverhältnis liefert.
 */
@Injectable()
export class CanvasThumbnailRenderer extends ThumbnailRenderer {
  override async render(blob: Blob, maxSize: number): Promise<Thumbnail> {
    // Das Originalbild bereits BEIM Dekodieren verkleinern, statt es erst in voller
    // Auflösung in den Speicher zu dekodieren. Sonst würden viele gleichzeitig
    // gerenderte Listen-Thumbnails ihre Vollbilder parallel dekodieren und den
    // Renderer-Prozess sprengen (Chrome-Crash "Fehlercode: 5", ohne JS-Konsolenfehler).
    const { bitmap, width, height } = await this.decodeDownscaled(blob, maxSize);
    try {
      const canvas = this.createCanvas(width, height);
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('2D-Canvas-Kontext nicht verfügbar.');
      ctx.drawImage(bitmap, 0, 0, width, height);
      const out = await this.toBlob(canvas);
      return { blob: out, width, height };
    } finally {
      bitmap.close();
    }
  }

  /**
   * Dekodiert `blob` seitenverhältniserhaltend auf höchstens `maxSize` (längere Kante),
   * ohne das Vollbild in den Speicher zu halten. Trick: Wird bei `createImageBitmap`
   * nur `resizeWidth` ODER nur `resizeHeight` gesetzt, skaliert der Browser die andere
   * Kante proportional mit (Seitenverhältnis bleibt erhalten). Wir begrenzen zuerst die
   * Breite auf `maxSize`; ist die proportional gewählte Höhe dann noch > `maxSize`
   * (Hochformat), dekodieren wir stattdessen an der Höhe begrenzt. So bleiben beide
   * Kanten <= `maxSize` und der Speicher-Peak ist gekappt. Unterstützt der Browser die
   * Resize-Optionen nicht, wird das Vollbild dekodiert und erst per Canvas verkleinert.
   */
  private async decodeDownscaled(
    blob: Blob,
    maxSize: number,
  ): Promise<{ bitmap: ImageBitmap; width: number; height: number }> {
    try {
      // 1. Breite auf maxSize begrenzen; Höhe skaliert der Browser proportional mit.
      let bmp = await createImageBitmap(blob, {
        resizeWidth: maxSize,
        resizeQuality: 'high',
      } as ImageBitmapOptions);
      // 2. Ist die (proportional gewählte) Höhe noch größer als maxSize, erneut an der
      //    Höhe begrenzt dekodieren. Beide Dekodierungen bleiben <= maxSize an der
      //    begrenzten Kante, also speicherbeschränkt.
      if (bmp.height > maxSize) {
        bmp.close();
        bmp = await createImageBitmap(blob, {
          resizeHeight: maxSize,
          resizeQuality: 'high',
        } as ImageBitmapOptions);
      }
      return { bitmap: bmp, width: bmp.width, height: bmp.height };
    } catch {
      // Resize-Optionen nicht unterstützt: Vollbild dekodieren, dann per scaleToFit
      // die Canvas-Zielgröße bestimmen.
      const bitmap = await createImageBitmap(blob);
      const { width, height } = scaleToFit(bitmap.width, bitmap.height, maxSize);
      return { bitmap, width, height };
    }
  }

  private createCanvas(width: number, height: number): CanvasLike {
    if (typeof OffscreenCanvas !== 'undefined') {
      return new OffscreenCanvas(width, height) as unknown as CanvasLike;
    }
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    return canvas as unknown as CanvasLike;
  }

  private async toBlob(canvas: CanvasLike): Promise<Blob> {
    if (canvas instanceof OffscreenCanvas) {
      return canvas.convertToBlob({ type: 'image/png' });
    }
    const htmlCanvas = canvas as unknown as HTMLCanvasElement;
    return new Promise<Blob>((resolve, reject) => {
      htmlCanvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error('toBlob lieferte null.'))),
        'image/png',
      );
    });
  }
}

/** Verkleinert (width,height) so, dass die längere Kante `maxSize` nicht überschreitet; Seitenverhältnis bleibt erhalten. */
export function scaleToFit(
  width: number,
  height: number,
  maxSize: number,
): { width: number; height: number } {
  if (width <= 0 || height <= 0) return { width: 1, height: 1 };
  const longest = Math.max(width, height);
  if (longest <= maxSize) return { width, height };
  const ratio = maxSize / longest;
  return {
    width: Math.max(1, Math.round(width * ratio)),
    height: Math.max(1, Math.round(height * ratio)),
  };
}
