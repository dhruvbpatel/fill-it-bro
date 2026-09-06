import { BaseWindow, WebContentsView } from 'electron';

const FORM_WIDTH = 1150;
const PANEL_WIDTH = 450;
const WINDOW_WIDTH = FORM_WIDTH + PANEL_WIDTH;
const WINDOW_HEIGHT = 1000;

export interface HostWindow {
  window: BaseWindow;
  formView: WebContentsView;
  panelView: WebContentsView;
}

/** Left form view + right panel view split, panel pinned to `PANEL_WIDTH`, form taking the rest. */
export function createHostWindow(preloadPath: string): HostWindow {
  const window = new BaseWindow({ width: WINDOW_WIDTH, height: WINDOW_HEIGHT });

  const formView = new WebContentsView();
  const panelView = new WebContentsView({
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      // The preload is bundled as ESM; Electron only loads ESM preloads with the
      // sandbox disabled (the bridge itself stays isolation-safe).
      sandbox: false,
    },
  });

  window.contentView.addChildView(formView);
  window.contentView.addChildView(panelView);

  const layout = (): void => {
    const { width, height } = window.getContentBounds();
    formView.setBounds({ x: 0, y: 0, width: Math.max(0, width - PANEL_WIDTH), height });
    panelView.setBounds({ x: Math.max(0, width - PANEL_WIDTH), y: 0, width: PANEL_WIDTH, height });
  };
  layout();
  window.on('resize', layout);

  return { window, formView, panelView };
}
