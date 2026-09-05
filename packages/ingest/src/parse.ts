import type { Page } from '@fib/contracts';
import { LiteParse } from '@llamaindex/liteparse';

const parser = new LiteParse({ ocrEnabled: true, quiet: true });

export async function parsePdf(bytes: Uint8Array): Promise<Page[]> {
  const result = await parser.parse(bytes);
  return result.pages.map((page) => ({
    mergedPage: page.pageNum,
    width: page.width,
    height: page.height,
    items: page.textItems.map((item, index) => ({
      id: `p${page.pageNum}i${index}`,
      text: item.text,
      x: item.x,
      y: item.y,
      w: item.width,
      h: item.height,
    })),
  }));
}
