export interface HtmlToPdf {
  render(html: string): Promise<Uint8Array>;
}

export class PlaywrightHtmlToPdf implements HtmlToPdf {
  async render(html: string): Promise<Uint8Array> {
    const { chromium } = await import('playwright');
    const browser = await chromium.launch();
    try {
      const page = await browser.newPage();
      await page.setContent(html, { waitUntil: 'load' });
      const pdf = await page.pdf({ format: 'A4' });
      return new Uint8Array(pdf);
    } finally {
      await browser.close();
    }
  }
}
