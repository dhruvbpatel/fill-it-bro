import { BrowserWindow } from 'electron';
import type { HtmlToPdf } from '@fib/ingest';

/**
 * Renders HTML to a PDF. Implemented here via a hidden `BrowserWindow`;
 * `@fib/ingest`'s `.msg` pipeline (T04) will consume this interface to
 * turn email bodies into PDF pages.
 */
export class ElectronHtmlToPdf implements HtmlToPdf {
  async render(html: string): Promise<Buffer> {
    const window = new BrowserWindow({ show: false });
    try {
      const encoded = Buffer.from(html, 'utf-8').toString('base64');
      await window.loadURL(`data:text/html;base64,${encoded}`);
      return await window.webContents.printToPDF({ printBackground: true });
    } finally {
      window.destroy();
    }
  }
}
